const { ethers } = require("hardhat");

async function main() {
  console.log("🚀 AccessManagement 컨트랙트 테스트 시작...");

  try {
    // 1. 컨트랙트 팩토리 가져오기
    const AccessManagement = await ethers.getContractFactory("AccessManagement");
    console.log("✅ 컨트랙트 팩토리 로드 완료");

    // 2. 컨트랙트 배포
    console.log("📝 컨트랙트 배포 중...");
    const accessManagement = await AccessManagement.deploy();
    await accessManagement.waitForDeployment();

    const address = await accessManagement.getAddress();
    console.log(`✅ 컨트랙트 배포 완료! 주소: ${address}`);

    // 3. 사용 가능한 함수들 확인
    console.log("\n📋 컨트랙트 함수 목록:");
    try {
      const functions = Object.keys(accessManagement.interface.functions);
      functions.forEach((func, index) => {
        console.log(`  [${index + 1}] ${func}`);
      });
    } catch (error) {
      console.log("⚠️  함수 목록 가져오기 실패, 계속 진행...");
    }

    // 4. saveRequest 함수 테스트
    console.log("\n🧪 saveRequest 함수 테스트...");
    
    const [signer] = await ethers.getSigners();
    const resourceOwner = await signer.getAddress();
    const purpose = "Test indexing";
    const organizationName = "samsung";

    console.log(`   Resource Owner: ${resourceOwner}`);
    console.log(`   Purpose: ${purpose}`);
    console.log(`   Organization: ${organizationName}`);

    // saveRequest 호출
    const tx = await accessManagement.saveRequest(resourceOwner, purpose, organizationName);
    console.log(`📝 saveRequest 트랜잭션 전송됨: ${tx.hash}`);

    // 트랜잭션 완료 대기
    const receipt = await tx.wait();
    console.log(`✅ 트랜잭션 완료! Block: ${receipt.blockNumber}, Gas: ${receipt.gasUsed}`);

    // 5. 결과 확인
    console.log("\n🔍 결과 확인...");
    const requestId = await accessManagement.getRequestById(1);
    console.log(`   Request ID: 1`);
    console.log(`   Requester: ${requestId.requester}`);
    console.log(`   Resource Owner: ${requestId.resourceOwner}`);
    console.log(`   Purpose: ${requestId.purpose}`);
    console.log(`   Organization: ${requestId.organizationName}`);
    console.log(`   Status: ${requestId.status}`);

    console.log("\n🎉 모든 테스트 완료!");

  } catch (error) {
    console.error("❌ 테스트 실패:", error);
    process.exit(1);
  }
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
