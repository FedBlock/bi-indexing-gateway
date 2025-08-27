const hre = require("hardhat");

async function main() {
  console.log("🚀 실제 블록체인 이벤트 생성 시작...");

  // 배포된 컨트랙트 주소 읽기
  const fs = require('fs');
  let deploymentInfo;
  try {
    deploymentInfo = JSON.parse(fs.readFileSync('deployment.json', 'utf8'));
  } catch (error) {
    console.error("❌ deployment.json을 찾을 수 없습니다. 먼저 컨트랙트를 배포해주세요.");
    process.exit(1);
  }

  const contractAddress = deploymentInfo.contractAddress;
  console.log(`📍 컨트랙트 주소: ${contractAddress}`);

  // 컨트랙트 인스턴스 생성
  const AccessManagement = await hre.ethers.getContractFactory("AccessManagement");
  const accessManagement = AccessManagement.attach(contractAddress);

  // 테스트 계정들 가져오기
  const [owner, requester1, requester2, requester3, resourceOwner] = await hre.ethers.getSigners();

  console.log(`\n👥 테스트 계정들:`);
  console.log(`   Owner: ${owner.address}`);
  console.log(`   Requester1: ${requester1.address}`);
  console.log(`   Requester2: ${requester2.address}`);
  console.log(`   Requester3: ${requester3.address}`);
  console.log(`   ResourceOwner: ${resourceOwner.address}`);

  // 이벤트 리스너 설정
  accessManagement.on("AccessRequestsSaved", (requestId, requester, resourceOwner, purpose, organizationName) => {
    console.log(`\n📡 이벤트 발생: AccessRequestsSaved`);
    console.log(`   RequestID: ${requestId}`);
    console.log(`   Requester: ${requester}`);
    console.log(`   ResourceOwner: ${resourceOwner}`);
    console.log(`   Purpose: ${purpose}`);
    console.log(`   Organization: ${organizationName}`);
  });

  // 실제 이벤트 발생시키기
  console.log(`\n📝 실제 블록체인 이벤트 생성 중...`);

  try {
    // 1. 첫 번째 요청 (Requester1)
    console.log(`\n   1️⃣ Requester1이 요청 생성...`);
    const tx1 = await accessManagement.connect(requester1).saveRequest(
      resourceOwner.address,
      "데이터 접근 요청 - 사용자 인증",
      "테스트 조직 A"
    );
    await tx1.wait();
    console.log(`   ✅ 트랜잭션 완료: ${tx1.hash}`);

    // 2. 두 번째 요청 (Requester2)
    console.log(`\n   2️⃣ Requester2가 요청 생성...`);
    const tx2 = await accessManagement.connect(requester2).saveRequest(
      resourceOwner.address,
      "시스템 접근 요청 - 관리자 권한",
      "테스트 조직 B"
    );
    await tx2.wait();
    console.log(`   ✅ 트랜잭션 완료: ${tx2.hash}`);

    // 3. 세 번째 요청 (Requester3)
    console.log(`\n   3️⃣ Requester3이 요청 생성...`);
    const tx3 = await accessManagement.connect(requester3).saveRequest(
      resourceOwner.address,
      "API 접근 요청 - 외부 서비스 연동",
      "테스트 조직 C"
    );
    await tx3.wait();
    console.log(`   ✅ 트랜잭션 완료: ${tx3.hash}`);

    console.log(`\n🎉 모든 이벤트 생성 완료!`);
    console.log(`💡 이제 Go 인덱스 서버에서 이 이벤트들을 감지하고 인덱싱할 수 있습니다.`);

  } catch (error) {
    console.error("❌ 이벤트 생성 실패:", error);
    process.exit(1);
  }
}

main()
  .then(() => {
    console.log(`\n✅ 이벤트 생성 성공!`);
    process.exit(0);
  })
  .catch((error) => {
    console.error("❌ 스크립트 실행 실패:", error);
    process.exit(1);
  });
