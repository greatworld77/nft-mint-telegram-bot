import hre from 'hardhat';

async function main() {
  const [deployer] = await hre.ethers.getSigners();
  console.log('Deploying with:', deployer.address);

  const NFT = await hre.ethers.getContractFactory('PixelMintNFT');
  const nft = await NFT.deploy(deployer.address);
  await nft.waitForDeployment();

  console.log('PixelMintNFT deployed to:', await nft.getAddress());
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
