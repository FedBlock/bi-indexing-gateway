const hre = require("hardhat");

async function main() {
  console.log("=== 🚀 조직별 트랜잭션 발생 스크립트 시작 ===");

  // 1. 컨트랙트 주소 확인
  const contractAddress = "0x5FbDB2315678afecb367f032d93F642f64180aa3";
  console.log("📍 컨트랙트 주소:", contractAddress);

  // 2. 컨트랙트 인스턴스 가져오기
  const AccessManagement = await hre.ethers.getContractFactory("AccessManagement");
  const accessManagement = AccessManagement.attach(contractAddress);

  // 3. 계정 가져오기 (각 조직별로 다른 계정 사용)
  const signers = await hre.ethers.getSigners();
  console.log("👤 사용 가능한 계정 개수:", signers.length);

  // 4. 조직별 트랜잭션 설정
  const organizationTransactions = [
    {
      name: "삼성전자",
      indexID: "001",
      count: 3,  // 3개 트랜잭션
      signerIndex: 0,  // 첫 번째 계정
      purposes: [
        "삼성전자 데이터 접근 요청",
        "삼성전자 시스템 관리 권한",
        "삼성전자 보안 감사 수행"
      ]
    },
    {
      name: "네이버", 
      indexID: "002",
      count: 2,  // 2개 트랜잭션
      signerIndex: 1,  // 두 번째 계정
      purposes: [
        "네이버 데이터 접근 요청",
        "네이버 시스템 점검"
      ]
    },
    {
      name: "비아이",
      indexID: "003", 
      count: 1,  // 1개 트랜잭션
      signerIndex: 2,  // 세 번째 계정
      purposes: [
        "비아이 데이터 접근 요청"
      ]
    }
  ];

  console.log("\n📡 조직별 트랜잭션 발생 중...");
  
  let totalTransactions = 0;
  
  for (const org of organizationTransactions) {
    console.log(`\n🏢 ${org.name} (IndexID: ${org.indexID}) - ${org.count}개 트랜잭션 발생 중...`);
    
    const signer = signers[org.signerIndex];
    console.log(`   👤 서명자: ${signer.address} (계정 ${org.signerIndex})`);
    
    for (let i = 0; i < org.count; i++) {
      const purpose = org.purposes[i];
      
      console.log(`   📝 [${i+1}/${org.count}] ${purpose}`);
      
      try {
        const tx = await accessManagement.connect(signer).saveRequest(
          signer.address,   // resourceOwner (자신의 주소)
          purpose,          // purpose
          org.name,         // organizationName
          { gasLimit: 500000 }
        );

        console.log(`      ⏳ 트랜잭션 전송됨: ${tx.hash}`);
        
        // 트랜잭션 확인 대기
        const receipt = await tx.wait();
        console.log(`      ✅ 트랜잭션 확인됨! 블록: ${receipt.blockNumber}`);
        
        // 이벤트 로그 확인
        if (receipt.logs.length > 0) {
          console.log(`      📋 ${org.name} 이벤트 발생 완료`);
        }
        
        totalTransactions++;
        
      } catch (error) {
        console.log(`      ❌ ${org.name} 트랜잭션 실패: ${error.message}`);
      }
      
      // 트랜잭션 간 간격 (블록 생성 대기)
      if (i < org.count - 1) {
        console.log("      ⏳ 다음 트랜잭션 대기 중...");
        await new Promise(resolve => setTimeout(resolve, 2000)); // 2초 대기
      }
    }
    
    // 조직 간 간격
    if (org !== organizationTransactions[organizationTransactions.length - 1]) {
      console.log("   ⏳ 다음 조직 대기 중...");
      await new Promise(resolve => setTimeout(resolve, 3000)); // 3초 대기
    }
  }

  console.log("\n=== 🎉 조직별 트랜잭션 발생 완료 ===");
  console.log("📊 총 발생된 트랜잭션:", totalTransactions);
  console.log("🏢 조직별 트랜잭션 요약:");
  for (const org of organizationTransactions) {
    console.log(`   ${org.name} (IndexID: ${org.indexID}): ${org.count}개`);
  }
  console.log("\n💡 이제 이벤트 리스너로 데이터를 확인할 수 있습니다!");
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error("❌ 에러 발생:", error);
    process.exit(1);
  });
