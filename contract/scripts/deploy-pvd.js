const hre = require("hardhat");

async function main() {
  console.log("🚀 PvdRecord 컨트랙트 배포 시작...\n");

  // 배포자 계정 확인
  const [deployer] = await hre.ethers.getSigners();
  console.log(`📝 배포자 주소: ${deployer.address}`);
  
  const balance = await hre.ethers.provider.getBalance(deployer.address);
  console.log(`💰 배포자 잔액: ${hre.ethers.formatEther(balance)} ETH\n`);

  // PvdRecord 컨트랙트 배포
  console.log("📦 PvdRecord 컨트랙트 배포 중...");
  const PvdRecord = await hre.ethers.getContractFactory("PvdRecord");
  const pvdRecord = await PvdRecord.deploy();
  
  await pvdRecord.waitForDeployment();
  const contractAddress = await pvdRecord.getAddress();
  
  console.log(`✅ PvdRecord 배포 완료!`);
  console.log(`📍 컨트랙트 주소: ${contractAddress}\n`);

  // 배포 정보 저장
  const deploymentInfo = {
    network: hre.network.name,
    contractAddress: contractAddress,
    deployer: deployer.address,
    deployedAt: new Date().toISOString(),
    blockNumber: await hre.ethers.provider.getBlockNumber()
  };

  const fs = require('fs');
  const path = require('path');
  const deploymentPath = path.join(__dirname, 'pvd-deployment.json');
  fs.writeFileSync(deploymentPath, JSON.stringify(deploymentInfo, null, 2));
  console.log(`📄 배포 정보 저장: ${deploymentPath}\n`);

  console.log("=" .repeat(50));
  console.log("🎉 배포 완료!");
  console.log("=" .repeat(50));
  console.log(`네트워크: ${hre.network.name}`);
  console.log(`컨트랙트 주소: ${contractAddress}`);
  console.log(`배포자: ${deployer.address}`);
  console.log("=" .repeat(50));
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error("❌ 배포 실패:", error);
    process.exit(1);
  });

