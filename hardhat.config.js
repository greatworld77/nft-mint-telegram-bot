import 'dotenv/config';
import '@nomicfoundation/hardhat-ethers';

export default {
  solidity: '0.8.28',
  networks: {
    sepolia: {
      url: process.env.SEPOLIA_RPC_URL || '',
      accounts: process.env.MINTER_PRIVATE_KEY ? [process.env.MINTER_PRIVATE_KEY] : []
    }
  }
};
