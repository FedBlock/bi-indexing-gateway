const { ethers } = require("hardhat");

async function main() {
  console.log("=== 🚀 MONAD 테스트넷 조직A 단일 트랜잭션 발생 스크립트 ===");

  // 1. 환경변수에서 실제 MONAD 계정 private key 가져오기
  const privateKey = "0x523d1790742f1749f8bd7c68a41b0e3592f776d9b429f0bb220a0b613a8f4216";
  if (!privateKey) {
    throw new Error("❌ PRIVATE_KEY 환경변수가 설정되지 않았습니다!");
  }

  // 2. 실제 MONAD 계정으로 서명자 생성
  const signer = new ethers.Wallet(privateKey, ethers.provider);
  console.log("🔐 실제 MONAD 계정 주소:", signer.address);
  
  // 3. 계정 잔액 확인
  const balance = await ethers.provider.getBalance(signer.address);
  console.log("💰 계정 잔액:", ethers.formatEther(balance), "MONAD");

  // 4. 컨트랙트 주소 (실제 배포된 주소)
  const contractAddress = "0xA0c655728a64DaB4E10EE1f4a1ac0E56a29EcCd1";
  console.log("📍 컨트랙트 주소:", contractAddress);
  
  // 5. 컨트랙트 인스턴스 생성
  const AccessManagement = await ethers.getContractFactory("AccessManagement");
  const contract = AccessManagement.attach(contractAddress);
  
  try {
    // 6. 조직A 데이터 접근 요청 트랜잭션 발생 (1개만!)
    console.log("\n🏢 조직A - 데이터 접근 요청 트랜잭션 발생 중...");
    console.log("   👤 서명자:", signer.address);
    console.log("   📝 조직A 데이터 접근 요청");
    console.log("   🎯 목적: 동적 인덱싱 시스템 테스트");
    
    // 트랜잭션 전송
    const tx = await contract.connect(signer).saveRequest(
      "0xa5cc9D9F1f68546060852f7c685B99f0cD532229",  // resourceOwner
      "동적 인덱싱 시스템 테스트",  // purpose
      "조직A"  // organizationName
    );
    
    console.log("      ⏳ 트랜잭션 전송됨:", tx.hash);
    
    // 트랜잭션 확인 대기
    const receipt = await tx.wait();
    console.log("      ✅ 트랜잭션 확인됨! 블록:", receipt.blockNumber);
    console.log("      📋 조직A 이벤트 발생 완료");
    
    // 7. 결과 요약
    console.log("\n=== 🎉 MONAD 테스트넷 단일 트랜잭션 발생 완료 ===");
    console.log("📊 발생된 트랜잭션: 1개");
    console.log("🏢 조직A: 데이터 접근 요청");
    console.log("🎯 목적: 동적 인덱싱 시스템 테스트");
    console.log("\n💡 이제 이벤트 리스너로 데이터를 확인할 수 있습니다!");
    
    // 8. 트랜잭션 해시 출력
    console.log("\n📋 발생된 트랜잭션 해시:");
    console.log("   ", tx.hash);
    
    // 9. 다음 단계 안내
    console.log("\n🔍 다음 단계:");
    console.log("   1. 이벤트 리스너 실행: go run examples/5_monad_organization_event_listener.go");
    console.log("   2. 데이터 조회: go run examples/6_query_organization_data.go -type=event -org=조직A");
    
  } catch (error) {
    console.error("❌ 트랜잭션 발생 중 오류 발생:", error);
    
    // 오류 상세 정보 출력
    if (error.reason) {
      console.error("   📝 오류 사유:", error.reason);
    }
    if (error.code) {
      console.error("   🔢 오류 코드:", error.code);
    }
    
    process.exit(1);
  }
}

// 스크립트 실행
main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error("❌ 스크립트 실행 실패:", error);
    process.exit(1);
  });
