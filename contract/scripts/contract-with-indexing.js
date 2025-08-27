const hre = require("hardhat");
const path = require("path");

// idxmngr 클라이언트 로드
const IdxmngrClient = require("../../js-client/idxmngr-client");

async function main() {
  console.log("🚀 스마트 컨트랙트 배포 및 인덱싱 통합 테스트 시작...\n");

  // 1. idxmngr 클라이언트 초기화
  console.log("📡 idxmngr 클라이언트 연결 중...");
  const idxmngrClient = new IdxmngrClient();
  await new Promise(resolve => setTimeout(resolve, 1000)); // 연결 대기

  try {
    // 2. AccessManagement 컨트랙트 배포
    console.log("🏗️ AccessManagement 컨트랙트 배포 중...");
    const AccessManagement = await hre.ethers.getContractFactory("AccessManagement");
    const accessManagement = await AccessManagement.deploy();
    await accessManagement.waitForDeployment();

    const contractAddress = await accessManagement.getAddress();
    console.log(`✅ 컨트랙트 배포 완료! 주소: ${contractAddress}\n`);

    // 3. 인덱스 생성 (삼성전자용)
    console.log("🔨 삼성전자 인덱스 생성 중...");
    const indexResult = await idxmngrClient.createIndex(
      'org_samsung',
      'Organization_Samsung',
      'IndexableData_OrganizationName',
      'samsung.bf',
      32
    );
    console.log(`✅ 인덱스 생성 결과: ${JSON.stringify(indexResult)}\n`);

    // 4. 여러 조직의 트랜잭션 실행 및 인덱싱
    const organizations = [
      { name: '삼성전자', indexId: 'org_samsung' },
      { name: 'LG전자', indexId: 'org_lg' }
    ];

    for (const org of organizations) {
      console.log(`📝 ${org.name} 트랜잭션 실행 및 인덱싱...`);
      
      // 트랜잭션 실행
      const tx = await accessManagement.saveRequest(
        '0x1234567890123456789012345678901234567890', // resourceOwner
        '데이터 분석 목적', // purpose
        org.name // organizationName
      );
      
      // 트랜잭션 완료 대기
      const receipt = await tx.wait();
      const txHash = receipt.hash;
      
      console.log(`✅ 트랜잭션 완료: ${txHash}`);
      console.log(`📊 Gas 사용량: ${receipt.gasUsed.toString()}`);
      
      // idxmngr로 인덱싱
      console.log(`🔍 idxmngr로 인덱싱 중...`);
      const indexingResult = await idxmngrClient.insertData(
        org.indexId,
        txHash,
        org.name
      );
      
      console.log(`✅ 인덱싱 완료: ${JSON.stringify(indexingResult)}\n`);
      
      // 잠시 대기
      await new Promise(resolve => setTimeout(resolve, 1000));
    }

    // 5. 인덱싱된 데이터 검색 테스트
    console.log("🔍 인덱싱된 데이터 검색 테스트...");
    
    for (const org of organizations) {
      const searchResults = await idxmngrClient.searchData(
        org.indexId,
        'IndexableData_OrganizationName',
        org.name
      );
      
      console.log(`${org.name} 검색 결과:`);
      console.log(`- 찾은 트랜잭션 수: ${searchResults?.IdxData?.length || 0}`);
      if (searchResults?.IdxData?.length > 0) {
        console.log(`- 트랜잭션 해시: ${searchResults.IdxData[0]}`);
      }
      console.log('');
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
    console.log("\n✅ 통합 테스트 성공!");
    process.exit(0);
  })
  .catch((error) => {
    console.error("❌ 통합 테스트 실패:", error);
    process.exit(1);
  });
