import { ethers } from 'ethers';

const ABI = [
  'function safeMint(address to, string memory uri) external returns (uint256)',
  'event Transfer(address indexed from, address indexed to, uint256 indexed tokenId)'
];

export async function mintNFT(to, tokenURI) {
  const provider = new ethers.JsonRpcProvider(process.env.SEPOLIA_RPC_URL);

  const wallet = new ethers.Wallet(
    process.env.MINTER_PRIVATE_KEY,
    provider
  );

  const contract = new ethers.Contract(
    process.env.NFT_CONTRACT_ADDRESS,
    ABI,
    wallet
  );

  const tx = await contract.safeMint(to, tokenURI);
  const receipt = await tx.wait();

  let tokenId = null;

  for (const log of receipt.logs) {
    try {
      const parsed = contract.interface.parseLog(log);

      if (parsed && parsed.name === 'Transfer') {
        tokenId = parsed.args.tokenId.toString();
      }
    } catch {}
  }

  return {
    txHash: tx.hash,
    tokenId
  };
}
