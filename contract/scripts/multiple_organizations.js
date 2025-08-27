const hre = require("hardhat");

async function main() {
  console.log("=== 🚀 여러 조직 트랜잭션 발생 스크립트 시작 ===");

  // 1. 컨트랙트 주소 확인
  const contractAddress = "0x5FbDB2315678afecb367f032d93F642f64180aa3";
  console.log("📍 컨트랙트 주소:", contractAddress);

  // 2. 컨트랙트 인스턴스 가져오기
  const AccessManagement = await hre.ethers.getContractFactory("AccessManagement");
  const accessManagement = AccessManagement.attach(contractAddress);

  // 3. 계정 가져오기
  const [signer] = await hre.ethers.getSigners();
  console.log("👤 서명자:", signer.address);

  // 4. 여러 조직에 대해 트랜잭션 발생
  const organizations = [
    "삼성전자",
    "LG전자", 
    "SK하이닉스",
    "현대자동차",
    "NAVER"
  ];

  console.log("\n📡 여러 조직 트랜잭션 발생 중...");
  
  for (let i = 0; i < organizations.length; i++) {
    const orgName = organizations[i];
    const purpose = `${orgName} 데이터 접근 요청`;
    
    console.log(`\n🏢 [${i+1}/${organizations.length}] ${orgName} 트랜잭션 발생 중...`);
    
    try {
      const tx = await accessManagement.saveRequest(
        signer.address,   // resourceOwner
        purpose,          // purpose
        orgName,          // organizationName
        { gasLimit: 500000 }
      );

      console.log(`   ⏳ 트랜잭션 전송됨: ${tx.hash}`);
      
      // 트랜잭션 확인 대기
      const receipt = await tx.wait();
      console.log(`   ✅ 트랜잭션 확인됨! 블록: ${receipt.blockNumber}`);
      
      // 이벤트 로그 확인
      if (receipt.logs.length > 0) {
        console.log(`   📋 ${orgName} 이벤트 발생 완료`);
      }
      
    } catch (error) {
      console.log(`   ❌ ${orgName} 트랜잭션 실패: ${error.message}`);
    }
    
    // 트랜잭션 간 간격 (블록 생성 대기)
    if (i < organizations.length - 1) {
      console.log("   ⏳ 다음 트랜잭션 대기 중...");
      await new Promise(resolve => setTimeout(resolve, 2000)); // 2초 대기
    }
  }

  console.log("\n=== 🎉 여러 조직 트랜잭션 발생 완료 ===");
  console.log("📊 총 발생된 트랜잭션:", organizations.length);
  console.log("🏢 조직 목록:", organizations.join(", "));
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error("❌ 에러 발생:", error);
    process.exit(1);
  });
