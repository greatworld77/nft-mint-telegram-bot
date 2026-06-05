import mongoose from 'mongoose';

const MintRequestSchema = new mongoose.Schema(
  {
    telegramUserId: { type: String, required: true, index: true },
    chatId: { type: String, required: true, index: true },
    step: {
      type: String,
      enum: ['AWAITING_IMAGE', 'AWAITING_WALLET', 'AWAITING_TX', 'PROCESSING', 'DONE', 'FAILED'],
      default: 'AWAITING_IMAGE',
      index: true
    },
    userWallet: { type: String },
    originalImageUrl: { type: String },
    originalCloudinaryPublicId: { type: String },
    pixelImageUrl: { type: String },
    metadataUrl: { type: String },
    txHash: { type: String, sparse: true, unique: true },
    mintTxHash: { type: String },
    tokenId: { type: String },
    error: { type: String }
  },
  { timestamps: true }
);

export default mongoose.models.MintRequest || mongoose.model('MintRequest', MintRequestSchema);
