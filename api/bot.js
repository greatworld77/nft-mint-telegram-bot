import 'dotenv/config';
import { Telegraf } from 'telegraf';
import { ethers } from 'ethers';
import axios from 'axios';

import { connectDB } from '../lib/db.js';
import MintRequest from '../models/MintRequest.js';
import { uploadBuffer, uploadJson } from '../lib/cloudinary.js';
import { getTelegramFileBuffer } from '../lib/telegram.js';
import { verifyPayment } from '../lib/payment.js';
import { createPixelArtWithNovita } from '../lib/novita.js';
import { mintNFT } from '../lib/mint.js';

const bot = new Telegraf(process.env.TELEGRAM_BOT_TOKEN);

async function getActiveRequest(ctx) {
  await connectDB();

  const telegramUserId = String(ctx.from.id);
  const chatId = String(ctx.chat.id);

  let req = await MintRequest.findOne({
    telegramUserId,
    step: { $nin: ['DONE', 'FAILED'] }
  }).sort({ createdAt: -1 });

  if (!req) {
    req = await MintRequest.create({
      telegramUserId,
      chatId,
      step: 'AWAITING_IMAGE'
    });
  }

  return req;
}

bot.start(async (ctx) => {
  await connectDB();

  const telegramUserId = String(ctx.from.id);
  const chatId = String(ctx.chat.id);

  await MintRequest.create({
    telegramUserId,
    chatId,
    step: 'AWAITING_IMAGE'
  });

  await ctx.reply(
`Welcome to Pixel NFT Mint Bot.

How it works:
1. Send me an image.
2. Send your wallet address.
3. Pay ${process.env.MINT_PRICE_ETH} Sepolia ETH to:
${process.env.PAYMENT_RECEIVER_ADDRESS}
4. Send the transaction hash.
5. I will create a pixelated NFT and mint it to your wallet.

Please send your image now.`
  );
});

bot.command('cancel', async (ctx) => {
  await connectDB();

  await MintRequest.updateMany(
    {
      telegramUserId: String(ctx.from.id),
      step: { $nin: ['DONE', 'FAILED'] }
    },
    {
      $set: {
        step: 'FAILED',
        error: 'Cancelled by user'
      }
    }
  );

  await ctx.reply('Cancelled. Send /start to begin again.');
});

bot.on('photo', async (ctx) => {
  const req = await getActiveRequest(ctx);

  if (req.step !== 'AWAITING_IMAGE') {
    return ctx.reply('I already received your image. Please continue with the next step.');
  }

  const photos = ctx.message.photo;
  const largest = photos[photos.length - 1];

  const buffer = await getTelegramFileBuffer(largest.file_id);
  const upload = await uploadBuffer(buffer, 'telegram-nft/originals');

  req.originalImageUrl = upload.secure_url;
  req.originalCloudinaryPublicId = upload.public_id;
  req.step = 'AWAITING_WALLET';

  await req.save();

  await ctx.reply('Your image is received. Now send your ETH wallet address where you want to receive the NFT.');
});

bot.on('document', async (ctx) => {
  const mime = ctx.message.document?.mime_type || '';

  if (!mime.startsWith('image/')) {
    return ctx.reply('Please send an image file only.');
  }

  const req = await getActiveRequest(ctx);

  if (req.step !== 'AWAITING_IMAGE') {
    return ctx.reply('I already received your image. Please continue with the next step.');
  }

  const buffer = await getTelegramFileBuffer(ctx.message.document.file_id);
  const upload = await uploadBuffer(buffer, 'telegram-nft/originals');

  req.originalImageUrl = upload.secure_url;
  req.originalCloudinaryPublicId = upload.public_id;
  req.step = 'AWAITING_WALLET';

  await req.save();

  await ctx.reply('Your image is received. Now send your ETH wallet address where you want to receive the NFT.');
});

bot.on('text', async (ctx) => {
  const text = ctx.message.text.trim();

  if (text.startsWith('/')) return;

  const req = await getActiveRequest(ctx);

  if (req.step === 'AWAITING_IMAGE') {
    return ctx.reply('Please send an image first.');
  }

  if (req.step === 'AWAITING_WALLET') {
    if (!ethers.isAddress(text)) {
      return ctx.reply('Invalid wallet address. Please send a valid ETH wallet address.');
    }

    req.userWallet = text;
    req.step = 'AWAITING_TX';

    await req.save();

    return ctx.reply(
`Wallet saved.

Please pay ${process.env.MINT_PRICE_ETH} Sepolia ETH to:
${process.env.PAYMENT_RECEIVER_ADDRESS}

After payment, send me the transaction hash.`
    );
  }

  if (req.step === 'AWAITING_TX') {
    if (!/^0x([A-Fa-f0-9]{64})$/.test(text)) {
      return ctx.reply('Invalid transaction hash. Please send a valid tx hash.');
    }

    const duplicate = await MintRequest.findOne({ txHash: text });

    if (duplicate) {
      return ctx.reply('This transaction hash was already used. Please send a new valid transaction hash.');
    }

    req.txHash = text;
    req.step = 'PROCESSING';

    await req.save();

    await ctx.reply('Checking your payment...');

    try {
      const verified = await verifyPayment(text);

      if (!verified.ok) {
        req.step = 'AWAITING_TX';
        req.error = verified.reason;

        await req.save();

        return ctx.reply(`Payment not confirmed: ${verified.reason}`);
      }

      await ctx.reply('Your payment is received successfully. Creating your pixelated NFT now.');

      const pixelUrl = await createPixelArtWithNovita(req.originalImageUrl);

      const pixelImage = await axios.get(pixelUrl, {
        responseType: 'arraybuffer'
      });

      const pixelUpload = await uploadBuffer(
        Buffer.from(pixelImage.data),
        'telegram-nft/pixelated'
      );

      const metadata = {
        name: 'Pixel Mint NFT',
        description: 'Pixelated NFT created from a Telegram user image.',
        image: pixelUpload.secure_url,
        attributes: [
          { trait_type: 'Style', value: 'Pixel Art' },
          { trait_type: 'Network', value: 'Sepolia' }
        ]
      };

      const metadataUpload = await uploadJson(metadata, 'telegram-nft/metadata');

      const mint = await mintNFT(req.userWallet, metadataUpload.secure_url);

      req.pixelImageUrl = pixelUpload.secure_url;
      req.metadataUrl = metadataUpload.secure_url;
      req.mintTxHash = mint.txHash;
      req.tokenId = mint.tokenId;
      req.step = 'DONE';

      await req.save();

      return ctx.reply(
`NFT minted successfully.

Token ID: ${mint.tokenId || 'Check transaction logs'}
Mint TX: ${mint.txHash}
Image: ${pixelUpload.secure_url}`
      );
    } catch (err) {
      req.step = 'FAILED';
      req.error = err.message;

      await req.save();

      console.error(err);

      return ctx.reply(`Mint failed: ${err.message}\nSend /start to try again.`);
    }
  }

  if (req.step === 'PROCESSING') {
    return ctx.reply('Your NFT is still processing. Please wait for the result.');
  }

  return ctx.reply('Send /start to begin.');
});

export default async function handler(req, res) {
  if (req.method === 'GET') {
    return res.status(200).send('Pixel NFT Telegram Bot is running.');
  }

  if (req.method !== 'POST') {
    return res.status(405).send('Method not allowed');
  }

  const secret = req.headers['x-telegram-bot-api-secret-token'];

  if (
    process.env.TELEGRAM_WEBHOOK_SECRET &&
    secret !== process.env.TELEGRAM_WEBHOOK_SECRET
  ) {
    return res.status(401).send('Unauthorized');
  }

  try {
    await bot.handleUpdate(req.body, res);
  } catch (err) {
    console.error(err);

    if (!res.headersSent) {
      res.status(500).send('Bot error');
    }
  }
}
