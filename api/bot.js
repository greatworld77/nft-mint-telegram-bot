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

  let request = await MintRequest.findOne({
    telegramUserId,
    step: {
      $nin: ['DONE', 'FAILED']
    }
  }).sort({
    createdAt: -1
  });

  if (!request) {
    request = await MintRequest.create({
      telegramUserId,
      chatId,
      step: 'AWAITING_IMAGE'
    });
  }

  return request;
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

How to use this bot:

1. Send an image.
2. Send your wallet address.
3. Pay ${process.env.MINT_PRICE_ETH} Sepolia ETH to:

${process.env.PAYMENT_RECEIVER_ADDRESS}

4. Send your transaction hash.
5. Your image will become a pixelated NFT.
6. The NFT will be minted to your wallet.

Please send your image now.`
  );
});

bot.command('cancel', async (ctx) => {
  await connectDB();

  await MintRequest.updateMany(
    {
      telegramUserId: String(ctx.from.id),
      step: {
        $nin: ['DONE', 'FAILED']
      }
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
  try {
    await ctx.reply('Image received. Uploading now...');

    const request = await getActiveRequest(ctx);

    if (request.step !== 'AWAITING_IMAGE') {
      return ctx.reply(
        'I already received your image. Please continue with the next step.'
      );
    }

    const photos = ctx.message.photo;
    const largestPhoto = photos[photos.length - 1];

    const buffer = await getTelegramFileBuffer(largestPhoto.file_id);

    const upload = await uploadBuffer(
      buffer,
      'telegram-nft/originals'
    );

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
      `Image upload failed. Please check Cloudinary/MongoDB settings.\n\nError: ${error.message}`
    );
  }
});
  const buffer = await getTelegramFileBuffer(
    ctx.message.document.file_id
  );

  const upload = await uploadBuffer(
    buffer,
    'telegram-nft/originals'
  );

  request.originalImageUrl = upload.secure_url;
  request.originalCloudinaryPublicId = upload.public_id;
  request.step = 'AWAITING_WALLET';

  await request.save();

  await ctx.reply(
    'Your image is received. Now send your ETH wallet address where you want to receive the NFT.'
  );
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
      return ctx.reply(
        'Invalid transaction hash. Please send a valid tx hash.'
      );
    }

    const duplicate = await MintRequest.findOne({
      txHash: text
    });

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

        return ctx.reply(
          `Payment not confirmed: ${verified.reason}`
        );
      }

      await ctx.reply(
        'Your payment is received successfully. Creating your pixelated NFT now.'
      );

      const pixelUrl = await createPixelArtWithNovita(
        request.originalImageUrl
      );

      const pixelImage = await axios.get(pixelUrl, {
        responseType: 'arraybuffer'
      });

      const pixelUpload = await uploadBuffer(
        Buffer.from(pixelImage.data),
        'telegram-nft/pixelated'
      );

      const metadata = {
        name: 'Pixel Mint NFT',
        description:
          'Pixelated NFT created from a Telegram user image.',
        image: pixelUpload.secure_url,
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

      const metadataUpload = await uploadJson(
        metadata,
        'telegram-nft/metadata'
      );

      const mint = await mintNFT(
        request.userWallet,
        metadataUpload.secure_url
      );

      request.pixelImageUrl = pixelUpload.secure_url;
      request.metadataUrl = metadataUpload.secure_url;
      request.mintTxHash = mint.txHash;
      request.tokenId = mint.tokenId;
      request.step = 'DONE';

      await request.save();

      return ctx.reply(
`NFT minted successfully.

Token ID: ${mint.tokenId || 'Check transaction'}
Mint TX: ${mint.txHash}
Image: ${pixelUpload.secure_url}`
      );
    } catch (error) {
      request.step = 'FAILED';
      request.error = error.message;

      await request.save();

      console.error(error);

      return ctx.reply(
        `Mint failed: ${error.message}\n\nSend /start to try again.`
      );
    }
  }

  if (request.step === 'PROCESSING') {
    return ctx.reply(
      'Your NFT is still processing. Please wait.'
    );
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
  } catch (error) {
    console.error(error);

    if (!res.headersSent) {
      res.status(500).send('Bot error');
    }
  }
}
