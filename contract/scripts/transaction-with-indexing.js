const hre = require("hardhat");
const fs = require("fs");

// idxmngr 클라이언트 로드
const IdxmngrClient = require("../../js-client/idxmngr-client");

async function main() {
  console.log("🚀 트랜잭션 실행 및 인덱싱 테스트 시작...\n");

  // 1. 배포된 컨트랙트 주소 로드
  let contractAddress;
  try {
    const deploymentInfo = JSON.parse(fs.readFileSync('deployment.json', 'utf8'));
    contractAddress = deploymentInfo.contractAddress;
    console.log(`📄 배포된 컨트랙트 주소: ${contractAddress}`);
  } catch (error) {
    console.log("❌ deployment.json 파일을 찾을 수 없습니다. 먼저 컨트랙트를 배포해주세요.");
    console.log("   npm run deploy 또는 npx hardhat run scripts/deploy.js");
    return;
  }

  // 2. idxmngr 클라이언트 초기화
  console.log("📡 idxmngr 클라이언트 연결 중...");
  const idxmngrClient = new IdxmngrClient();
  await new Promise(resolve => setTimeout(resolve, 1000));

  try {
    // 3. 컨트랙트 인스턴스 생성
    const AccessManagement = await hre.ethers.getContractFactory("AccessManagement");
    const accessManagement = AccessManagement.attach(contractAddress);
    console.log(`✅ 컨트랙트 인스턴스 생성 완료\n`);

    // 4. 트랜잭션 실행 및 인덱싱
    const organizations = [
      { name: '삼성전자', indexId: 'org_samsung' },
      { name: 'LG전자', indexId: 'org_lg' },
      { name: '현대자동차', indexId: 'test_org_hyundai' }
    ];

    for (const org of organizations) {
      console.log(`📝 ${org.name} 트랜잭션 실행 중...`);
      
      // 트랜잭션 실행
      const tx = await accessManagement.saveRequest(
        '0x1234567890123456789012345678901234567890', // resourceOwner
        `${org.name} 데이터 접근 요청`, // purpose
        org.name // organizationName
      );
      
      console.log(`⏳ 트랜잭션 처리 중... (Hash: ${tx.hash})`);
      
      // 트랜잭션 완료 대기
      const receipt = await tx.wait();
      const txHash = receipt.hash;
      
      console.log(`✅ 트랜잭션 완료!`);
      console.log(`   - Hash: ${txHash}`);
      console.log(`   - Gas 사용량: ${receipt.gasUsed.toString()}`);
      console.log(`   - Block Number: ${receipt.blockNumber}`);
      
      // idxmngr로 인덱싱
      console.log(`🔍 idxmngr로 인덱싱 중...`);
      try {
        const indexingResult = await idxmngrClient.insertData(
          org.indexId,
          txHash,
          org.name
        );
        
        console.log(`✅ 인덱싱 성공: ${JSON.stringify(indexingResult)}\n`);
      } catch (indexError) {
        console.log(`❌ 인덱싱 실패: ${indexError.message}\n`);
      }
      
      // 잠시 대기
      await new Promise(resolve => setTimeout(resolve, 2000));
    }

    // 5. 인덱싱된 데이터 검색
    console.log("🔍 인덱싱된 데이터 검색...");
    
    for (const org of organizations) {
      try {
        const searchResults = await idxmngrClient.searchData(
          org.indexId,
          'IndexableData_OrganizationName',
          org.name
        );
        
        console.log(`${org.name} 검색 결과:`);
        console.log(`   - 찾은 트랜잭션 수: ${searchResults?.IdxData?.length || 0}`);
        if (searchResults?.IdxData?.length > 0) {
          console.log(`   - 최신 트랜잭션: ${searchResults.IdxData[0]}`);
        }
        console.log('');
      } catch (searchError) {
        console.log(`${org.name} 검색 실패: ${searchError.message}\n`);
      }
    }

    console.log("🎉 모든 테스트 완료!");

  } catch (error) {
    console.error("❌ 오류 발생:", error);
  } finally {
    // 연결 종료
    idxmngrClient.close();
  }
}

main()
  .then(() => {
    console.log("\n✅ 트랜잭션 및 인덱싱 테스트 성공!");
    process.exit(0);
  })
  .catch((error) => {
    console.error("❌ 테스트 실패:", error);
    process.exit(1);
  });
