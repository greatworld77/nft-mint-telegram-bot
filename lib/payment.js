import { ethers } from 'ethers';

export function getProvider() {
  return new ethers.JsonRpcProvider(process.env.SEPOLIA_RPC_URL);
}

export async function verifyPayment(txHash) {
  const provider = getProvider();

  const tx = await provider.getTransaction(txHash);

  if (!tx) {
    return {
      ok: false,
      reason: 'Transaction not found yet.'
    };
  }

  const receipt = await provider.getTransactionReceipt(txHash);

  if (!receipt) {
    return {
      ok: false,
      reason: 'Transaction is not confirmed yet.'
    };
  }

  if (receipt.status !== 1) {
    return {
      ok: false,
      reason: 'Transaction failed.'
    };
  }

  const currentBlock = await provider.getBlockNumber();
  const confirmations = currentBlock - receipt.blockNumber + 1;
  const required = Number(process.env.MIN_CONFIRMATIONS || 1);

  if (confirmations < required) {
    return {
      ok: false,
      reason: `Waiting for confirmations: ${confirmations}/${required}`
    };
  }

  const expectedTo = process.env.PAYMENT_RECEIVER_ADDRESS.toLowerCase();

  if (!tx.to || tx.to.toLowerCase() !== expectedTo) {
    return {
      ok: false,
      reason: 'Payment was not sent to the correct wallet.'
    };
  }

  const requiredWei = ethers.parseEther(process.env.MINT_PRICE_ETH || '0');

  if (tx.value < requiredWei) {
    return {
      ok: false,
      reason: 'Payment amount is too low.'
    };
  }

  return {
    ok: true,
    tx,
    receipt,
    confirmations
  };
}
