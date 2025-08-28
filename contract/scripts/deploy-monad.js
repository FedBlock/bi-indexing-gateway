const hre = require("hardhat");

/**
 * Monad 테스트넷에 AccessManagement 컨트랙트 배포 스크립트
 */

async function main() {
  console.log("🚀 Monad 테스트넷 - AccessManagement 컨트랙트 배포 시작...");

  // 배포할 계정 확인
  const [deployer] = await hre.ethers.getSigners();
  console.log(`📱 배포 계정: ${deployer.address}`);
  console.log(`💰 계정 잔액: ${hre.ethers.formatEther(await deployer.provider.getBalance(deployer.address))} ETH`);

  // 네트워크 정보 확인
  const network = await hre.ethers.provider.getNetwork();
  console.log(`🌐 네트워크: ${network.name} (Chain ID: ${network.chainId})`);

  try {
    // 1. AccessManagement 컨트랙트 팩토리 생성
    console.log(`\n🏗️ AccessManagement 컨트랙트 컴파일 중...`);
    const AccessManagement = await hre.ethers.getContractFactory("AccessManagement");

    // 2. 컨트랙트 배포
    console.log(`\n📦 AccessManagement 컨트랙트 배포 중...`);
    const accessManagement = await AccessManagement.deploy();
    
    console.log(`📝 배포 트랜잭션 해시: ${accessManagement.deploymentTransaction().hash}`);
    console.log(`⏳ 배포 완료 대기 중...`);

    // 3. 배포 완료 대기
    await accessManagement.waitForDeployment();
    const deployedAddress = await accessManagement.getAddress();
    
    console.log(`✅ 배포 완료!`);
    console.log(`📍 컨트랙트 주소: ${deployedAddress}`);

    // 4. 배포된 컨트랙트 정보 확인
    console.log(`\n📋 배포된 컨트랙트 정보:`);
    console.log(`   컨트랙트 주소: ${deployedAddress}`);
    console.log(`   배포자: ${deployer.address}`);
    console.log(`   네트워크: Monad 테스트넷`);
    console.log(`   Chain ID: ${network.chainId}`);

    // 5. 배포 결과 반환
    return {
      contractAddress: deployedAddress,
      deployer: deployer.address,
      network: 'monadTest',
      chainId: network.chainId,
      txHash: accessManagement.deploymentTransaction().hash
    };

  } catch (error) {
    console.error(`❌ 배포 실패: ${error.message}`);
    throw error;
  }
}

main()
  .then((result) => {
    console.log(`\n🎉 Monad 테스트넷 배포 성공!`);
    console.log(`   컨트랙트 주소: ${result.contractAddress}`);
    console.log(`   네트워크: ${result.network}`);
    console.log(`   Chain ID: ${result.chainId}`);
    console.log(`\n📋 다음 단계:`);
    console.log(`   1. create-monad-index.js로 인덱스 생성`);
    console.log(`   2. monad-with-indexing.js로 데이터 인덱싱`);
    console.log(`   3. verify-monad-indexed-data.js로 데이터 검증`);
    process.exit(0);
  })
  .catch((error) => {
    console.error("💥 배포 실패:", error);
    process.exit(1);
  });
