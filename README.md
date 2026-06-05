# Pixel NFT Telegram Bot

This bot receives a user's image, asks for Sepolia ETH payment, verifies the transaction, creates a pixelated version using Novita AI, stores files on Cloudinary, and mints the NFT to the user's wallet.

## Mobile Setup

You can create this project using only mobile:

1. Create GitHub repo.
2. Add all files manually using GitHub mobile browser.
3. Deploy Solidity contract using Remix.
4. Deploy bot using Vercel.
5. Set Telegram webhook.

## Required Environment Variables

Add these in Vercel:

TELEGRAM_BOT_TOKEN
TELEGRAM_WEBHOOK_SECRET
BOT_PUBLIC_URL
MONGODB_URI
CLOUDINARY_CLOUD_NAME
CLOUDINARY_API_KEY
CLOUDINARY_API_SECRET
SEPOLIA_RPC_URL
PAYMENT_RECEIVER_ADDRESS
MINT_PRICE_ETH
MIN_CONFIRMATIONS
NFT_CONTRACT_ADDRESS
MINTER_PRIVATE_KEY
NOVITA_API_KEY
NOVITA_API_BASE

## Telegram Webhook

Use this URL format:

https://api.telegram.org/botYOUR_BOT_TOKEN/setWebhook?url=https://YOUR_VERCEL_URL/api/bot&secret_token=YOUR_SECRET

Open it in your mobile browser.

## Important

Use Sepolia first. Do not use mainnet until everything works perfectly.
