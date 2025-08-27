const hre = require("hardhat");

async function main() {
  console.log("🚀 간단한 트랜잭션 테스트 시작...\n");

  try {
    // 1. 컨트랙트 배포
    console.log("🏗️ AccessManagement 컨트랙트 배포 중...");
    const AccessManagement = await hre.ethers.getContractFactory("AccessManagement");
    const accessManagement = await AccessManagement.deploy();
    await accessManagement.waitForDeployment();

    const contractAddress = await accessManagement.getAddress();
    console.log(`✅ 컨트랙트 배포 완료! 주소: ${contractAddress}\n`);

    // 2. 간단한 트랜잭션 실행
    console.log("📝 간단한 트랜잭션 실행 중...");
    const tx = await accessManagement.saveRequest(
      '0x1234567890123456789012345678901234567890', // resourceOwner
      '테스트 목적', // purpose
      '테스트기관' // organizationName
    );
    
    console.log(`⏳ 트랜잭션 전송됨: ${tx.hash}`);
    console.log("트랜잭션 완료 대기 중...");
    
    // 3. 트랜잭션 완료 대기
    const receipt = await tx.wait();
    console.log(`✅ 트랜잭션 완료!`);
    console.log(`   - Hash: ${receipt.hash}`);
    console.log(`   - Block Number: ${receipt.blockNumber}`);
    console.log(`   - Gas Used: ${receipt.gasUsed.toString()}`);
    
    // 4. 이벤트 확인
    console.log("\n🔍 이벤트 확인 중...");
    const events = await accessManagement.queryFilter(accessManagement.filters.AccessRequestsSaved());
    console.log(`발생한 이벤트 수: ${events.length}`);
    
    if (events.length > 0) {
      const latestEvent = events[events.length - 1];
      console.log("최신 이벤트:", {
        requestId: latestEvent.args.requestId.toString(),
        requester: latestEvent.args.requester,
        organizationName: latestEvent.args.organizationName,
        blockNumber: latestEvent.blockNumber
      });
    }

    console.log("\n🎉 테스트 완료!");

  } catch (error) {
    console.error("❌ 오류 발생:", error);
  }
}

main()
  .then(() => {
    console.log("\n✅ 간단한 테스트 성공!");
    process.exit(0);
  })
  .catch((error) => {
    console.error("❌ 테스트 실패:", error);
    process.exit(1);
  });
