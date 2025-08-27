const hre = require("hardhat");

async function main() {
  console.log("🚀 AccessManagement 컨트랙트 배포 시작...");

  // AccessManagement 컨트랙트 배포
  const AccessManagement = await hre.ethers.getContractFactory("AccessManagement");
  const accessManagement = await AccessManagement.deploy();
  await accessManagement.waitForDeployment();

  const address = await accessManagement.getAddress();
  console.log(`✅ AccessManagement 컨트랙트 배포 완료!`);
  console.log(`📍 컨트랙트 주소: ${address}`);

  // 배포된 컨트랙트 주소를 파일에 저장 (Go 코드에서 사용)
  const fs = require('fs');
  const deploymentInfo = {
    contractAddress: address,
    network: 'hardhat',
    deployedAt: new Date().toISOString()
  };
  
  fs.writeFileSync('deployment.json', JSON.stringify(deploymentInfo, null, 2));
  console.log(`📄 배포 정보가 deployment.json에 저장되었습니다.`);

  return address;
}

main()
  .then((address) => {
    console.log(`\n🎉 배포 성공! 컨트랙트 주소: ${address}`);
    process.exit(0);
  })
  .catch((error) => {
    console.error("❌ 배포 실패:", error);
    process.exit(1);
  });
