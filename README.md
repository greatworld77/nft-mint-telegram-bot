# NFT Mint Telegram Bot

Telegram bot that receives an image, verifies Sepolia ETH payment, creates a pixel-art version with Novita AI, stores assets on Cloudinary, prevents duplicate transactions with MongoDB Atlas, and mints an ERC-721 NFT to the user's wallet.

## Stack

- Telegram Bot API via Telegraf
- Vercel Serverless Function webhook
- MongoDB Atlas
- Cloudinary
- Novita AI
- ethers v6
- Hardhat + Solidity ERC-721
- Sepolia now, mainnet later

## Setup

```bash
npm install
cp .env.example .env
