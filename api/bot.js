import 'dotenv/config';
import { Telegraf } from 'telegraf';
import { ethers } from 'ethers';

import { connectDB } from '../lib/db.js';
import MintRequest from '../models/MintRequest.js';

import { uploadBuffer } from '../lib/cloudinary.js';
import { getTelegramFileBuffer } from '../lib/telegram.js';
import { verifyPayment } from '../lib/payment.js';
import { createPixelArtWithNovita } from '../lib/novita.js';
import { mintNFT } from '../lib/mint.js';

const bot = new Telegraf(process.env.TELEGRAM_BOT_TOKEN);

function getErrorMessage(error) {
  if (error.response?.data) {
    return JSON.stringify(error.response.data);
  }

  return error.message || 'Unknown error';
}

async function getActiveRequest(ctx) {
  await connectDB();

  const telegramUserId = String(ctx.from.id);
  const chatId = String(ctx.chat.id);

  let request = await MintRequest.findOne({
    telegramUserId,
    step: { $nin: ['DONE', 'FAILED'] }
  }).sort({ createdAt: -1 });

  if (!request) {
    request = await MintRequest.create({
      telegramUserId,
      chatId,
      step: 'AWAITING_IMAGE'
    });
  }

  return request;
}

bot.catch(async (err, ctx) => {
  console.error('BOT ERROR:', err);

  try {
    await ctx.reply(`Something went wrong: ${getErrorMessage(err)}`);
  } catch {}
});

bot.start(async (ctx) => {
  await connectDB();

  await MintRequest.updateMany(
    {
      telegramUserId: String(ctx.from.id),
      step: { $nin: ['DONE', 'FAILED'] }
    },
    {
      $set: {
        step: 'FAILED',
        error: 'Restarted by user'
      }
    }
  );

  await MintRequest.create({
    telegramUserId: String(ctx.from.id),
    chatId: String(ctx.chat.id),
    step: 'AWAITING_IMAGE'
  });

  return ctx.reply(
`Welcome to Pixel NFT Mint Bot.

How to use this bot:

1. Send an image.
2. Send your wallet address.
3. Pay ${process.env.MINT_PRICE_ETH} Sepolia ETH to:

${process.env.PAYMENT_RECEIVER_ADDRESS}

4. Send your transaction hash.
5. Your image will become an NFT.
6. The NFT will be minted to your wallet.

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

  return ctx.reply('Cancelled. Send /start to begin again.');
});

bot.on('photo', async (ctx) => {
  try {
    await ctx.reply('Image received. Uploading now...');

    const request = await getActiveRequest(ctx);

    if (request.step !== 'AWAITING_IMAGE') {
      return ctx.reply(
        'I already received your image. Please continue with the next step.'
      );
    }

    const photos = ctx.message.photo;

    if (!photos || photos.length === 0) {
      return ctx.reply('No image found. Please send the image again.');
    }

    const largestPhoto = photos[photos.length - 1];

    const buffer = await getTelegramFileBuffer(largestPhoto.file_id);

    const upload = await uploadBuffer(
      buffer,
      'telegram-nft/originals'
    );

    if (!upload?.secure_url) {
      throw new Error('Cloudinary upload failed. No image URL returned.');
    }

    request.originalImageUrl = upload.secure_url;
    request.originalCloudinaryPublicId = upload.public_id;
    request.step = 'AWAITING_WALLET';

    await request.save();

    return ctx.reply(
      'Your image is received. Now send your ETH wallet address where you want to receive the NFT.'
    );
  } catch (error) {
    console.error('PHOTO ERROR:', error);

    return ctx.reply(
      `Image upload failed.\n\nError: ${getErrorMessage(error)}`
    );
  }
});

bot.on('document', async (ctx) => {
  try {
    const document = ctx.message.document;

    if (!document) {
      return ctx.reply('No file found. Please send an image.');
    }

    const mime = document.mime_type || '';

    if (!mime.startsWith('image/')) {
      return ctx.reply('Please send an image file only.');
    }

    await ctx.reply('Image file received. Uploading now...');

    const request = await getActiveRequest(ctx);

    if (request.step !== 'AWAITING_IMAGE') {
      return ctx.reply(
        'I already received your image. Please continue with the next step.'
      );
    }

    const buffer = await getTelegramFileBuffer(document.file_id);

    const upload = await uploadBuffer(
      buffer,
      'telegram-nft/originals'
    );

    if (!upload?.secure_url) {
      throw new Error('Cloudinary upload failed. No image URL returned.');
    }

    request.originalImageUrl = upload.secure_url;
    request.originalCloudinaryPublicId = upload.public_id;
    request.step = 'AWAITING_WALLET';

    await request.save();

    return ctx.reply(
      'Your image is received. Now send your ETH wallet address where you want to receive the NFT.'
    );
  } catch (error) {
    console.error('DOCUMENT ERROR:', error);

    return ctx.reply(
      `Image upload failed.\n\nError: ${getErrorMessage(error)}`
    );
  }
});

bot.on('text', async (ctx) => {
  const text = ctx.message.text.trim();

  if (text.startsWith('/')) return;

  const request = await getActiveRequest(ctx);

  if (request.step === 'AWAITING_IMAGE') {
    return ctx.reply('Please send an image first.');
  }

  if (request.step === 'AWAITING_WALLET') {
    if (!ethers.isAddress(text)) {
      return ctx.reply(
        'Invalid wallet address. Please send a valid ETH wallet address.'
      );
    }

    request.userWallet = text;
    request.step = 'AWAITING_TX';

    await request.save();

    return ctx.reply(
`Wallet saved.

Please pay ${process.env.MINT_PRICE_ETH} Sepolia ETH to:

${process.env.PAYMENT_RECEIVER_ADDRESS}

After payment, send me the transaction hash.`
    );
  }

  if (request.step === 'AWAITING_TX') {
    if (!/^0x([A-Fa-f0-9]{64})$/.test(text)) {
      return ctx.reply('Invalid transaction hash. Please send a valid tx hash.');
    }

    const duplicate = await MintRequest.findOne({ txHash: text });

    if (duplicate) {
      return ctx.reply(
        'This transaction hash was already used. Please send a new valid transaction hash.'
      );
    }

    request.txHash = text;
    request.step = 'PROCESSING';

    await request.save();

    await ctx.reply('Checking your payment...');

    try {
      const verified = await verifyPayment(text);

      if (!verified.ok) {
        request.step = 'AWAITING_TX';
        request.error = verified.reason;

        await request.save();

        return ctx.reply(`Payment not confirmed: ${verified.reason}`);
      }

      await ctx.reply(
        'Your payment is received successfully. Creating your NFT now.'
      );

      const pixelUrl = await createPixelArtWithNovita(request.originalImageUrl);

      const metadata = {
        name: 'Pixel Mint NFT',
        description: 'NFT created from a Telegram user image.',
        image: pixelUrl,
        attributes: [
          {
            trait_type: 'Style',
            value: 'Pixel Art'
          },
          {
            trait_type: 'Network',
            value: 'Sepolia'
          }
        ]
      };

      const metadataBase64 = Buffer.from(
        JSON.stringify(metadata)
      ).toString('base64');

      const tokenURI = `data:application/json;base64,${metadataBase64}`;

      const mint = await mintNFT(
        request.userWallet,
        tokenURI
      );

      request.pixelImageUrl = pixelUrl;
      request.metadataUrl = tokenURI;
      request.mintTxHash = mint.txHash;
      request.tokenId = mint.tokenId;
      request.step = 'DONE';

      await request.save();

      return ctx.reply(
`NFT minted successfully.

Token ID: ${mint.tokenId || 'Check transaction'}
Mint TX: ${mint.txHash}
Image: ${pixelUrl}`
      );
    } catch (error) {
      request.step = 'FAILED';
      request.error = getErrorMessage(error);

      await request.save();

      console.error('MINT ERROR:', error);

      return ctx.reply(
        `Mint failed: ${getErrorMessage(error)}\n\nSend /start to try again.`
      );
    }
  }

  if (request.step === 'PROCESSING') {
    return ctx.reply('Your NFT is still processing. Please wait.');
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
    await bot.handleUpdate(req.body);
    return res.status(200).send('OK');
  } catch (error) {
    console.error('WEBHOOK ERROR:', error);

    if (!res.headersSent) {
      return res.status(500).send('Bot error');
    }
  }
}
