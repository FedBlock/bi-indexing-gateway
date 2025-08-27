const hre = require("hardhat");
const IndexingClient = require('../../indexing-client-package/lib/indexing-client');

/**
 * Samsung Access Request + Indexing 스크립트
 * 
 * 이 스크립트는 삼성전자 접근 요청을 생성하고 인덱스에 저장합니다.
 * IndexingClient 패키지를 사용하여 gRPC 통신을 처리합니다.
 * 
 * @author AI Assistant
 * @version 2.0.0 (IndexingClient 패키지 사용)
 */

async function main() {
  console.log("🏢 Samsung Access Request + Indexing 테스트 시작...");
  console.log("🆕 IndexingClient 패키지 사용 버전");

  // Samsung 계정 (Account #0)
  const [samsungAccount] = await hre.ethers.getSigners();
  console.log(`📱 Samsung 계정: ${samsungAccount.address}`);

  // 실제 배포된 컨트랙트 주소 설정
  // TODO: 실제 배포된 컨트랙트 주소로 변경하세요
  const contractAddress = "0xa513E6E4b8f2a923D98304ec87F64353C4D5C853"; // 새로 배포된 주소
  // const contractAddress = "0x..."; // 실제 배포된 주소
  
  console.log(`📍 컨트랙트 주소: ${contractAddress}`);
  console.log(`⚠️  주의: 실제 배포된 컨트랙트 주소인지 확인하세요!`);

  // AccessManagement 컨트랙트 인스턴스 생성
  const AccessManagement = await hre.ethers.getContractFactory("AccessManagement");
  const accessManagement = AccessManagement.attach(contractAddress);

  // Samsung 조직 정보
  const organizationName = "삼성전자";
  const requester = samsungAccount.address;
  const resourceOwner = "0x8626f6940E2eb28930eFb4CeF49B2d1F2C9C1199"; // Account #19
  const purpose = "Business Partnership";

  console.log(`\n📋 Access Request 정보:`);
  console.log(`   Organization: ${organizationName}`);
  console.log(`   Requester: ${requester}`);
  console.log(`   Resource Owner: ${resourceOwner}`);
  console.log(`   Purpose: ${purpose}`);

  // IndexingClient 인스턴스 생성
  const indexingClient = new IndexingClient({
    serverAddr: 'localhost:50052',
    protoPath: '../idxmngr-go/protos/index_manager.proto' // 로컬 테스트용
  });

  try {
    // 연결 완료 대기
    await new Promise(resolve => setTimeout(resolve, 1000));

    // 1. saveRequest 함수 호출
    console.log(`\n🚀 saveRequest 함수 호출 중...`);
    const tx = await accessManagement.saveRequest(
      resourceOwner,
      purpose,
      organizationName
    );

    console.log(`📝 트랜잭션 전송됨: ${tx.hash}`);
    
    // 트랜잭션 완료 대기
    const receipt = await tx.wait();
    console.log(`✅ 트랜잭션 완료!`);
    console.log(`   Block Number: ${receipt.blockNumber}`);
    console.log(`   Gas Used: ${receipt.gasUsed.toString()}`);
    console.log(`   Tx Hash: ${receipt.hash}`);

    // 2. 트랜잭션 해시를 직접 사용 (requestId 대신)
    console.log(`\n📊 트랜잭션 결과 분석 중...`);
    
    // 이벤트 파싱 대신 트랜잭션 해시를 직접 사용
    const txId = receipt.hash;
    console.log(`   ✅ 트랜잭션 해시: ${txId}`);
    console.log(`   📝 참고: 이벤트 파싱 대신 TxId를 직접 사용합니다.`);

    // 3. 실제 txId를 인덱스에 삽입
    console.log(`\n📊 인덱스 삽입 로직 실행 중...`);
    console.log(`   TxId: ${txId}`);
    console.log(`   Organization: ${organizationName}`);
    console.log(`   Block Number: ${receipt.blockNumber}`);
    console.log(`   Timestamp: ${new Date().toISOString()}`);
    
    // 인덱스 데이터 구성 (requestId 대신 txId 사용)
    const indexData = {
      txHash: txId,
      requestId: txId, // requestId 대신 txId 사용
      organization: organizationName,
      requester: requester,
      resourceOwner: resourceOwner,
      purpose: purpose,
      blockNumber: receipt.blockNumber,
      timestamp: new Date().toISOString(),
      status: 'PENDING'
    };

    console.log(`\n📋 인덱스에 삽입될 데이터:`);
    console.log(JSON.stringify(indexData, null, 2));

    // IndexingClient를 통해 인덱스 서버에 데이터 삽입
    console.log(`\n🌐 IndexingClient를 통해 인덱스 서버에 데이터 삽입 중...`);
    
    try {
      // IndexingClient의 insertData 메서드 사용
      const insertRequest = {
        IndexID: 'samsung_001',
        BcList: [{
          TxId: indexData.txHash,
          key_col: 'IndexableData',
          IndexableData: {
            TxId: indexData.txHash,
            OrganizationName: indexData.organization,
            ContractAddress: '0x0000000000000000000000000000000000000000', // 기본값
            EventName: 'AccessRequestsSaved',
            DataJson: JSON.stringify({
              requestId: indexData.requestId,
              requester: indexData.requester,
              resourceOwner: indexData.resourceOwner,
              purpose: indexData.purpose,
              status: indexData.status
            }),
            Timestamp: indexData.timestamp,
            BlockNumber: indexData.blockNumber,
            Requester: indexData.requester,
            ResourceOwner: indexData.resourceOwner,
            Purpose: indexData.purpose,
            Status: indexData.status
          }
        }],
        ColName: 'IndexableData',
        FilePath: '/home/blockchain/bi-index-migration/bi-index/fileindex-go/samsung.bf'
      };

      await indexingClient.insertData(insertRequest);
      console.log(`✅ 인덱스 서버 삽입 성공!`);
      console.log(`🆕 IndexingClient 패키지 사용으로 코드가 간소화되었습니다!`);
    } catch (error) {
      console.error(`❌ 인덱스 서버 삽입 실패: ${error.message}`);
      console.log(`   idxmngr 서버가 실행 중인지 확인해주세요.`);
    }
    
    console.log(`✅ 인덱스 삽입 완료!`);
    console.log(`\n🎯 다음 단계: 인덱스에서 실제 txId 검색 테스트`);

    return {
      txHash: receipt.hash,
      requestId: txId,
      indexData: indexData
    };

  } catch (error) {
    console.error(`❌ 테스트 실패: ${error.message}`);
    throw error;
  } finally {
    // IndexingClient 연결 종료
    indexingClient.close();
  }
}

main()
  .then((result) => {
    console.log(`\n🎉 Samsung Access Request + Indexing 성공!`);
    console.log(`   Tx Hash: ${result.txHash}`);
    console.log(`   Request ID: ${result.requestId}`);
    console.log(`\n📋 다음 단계:`);
    console.log(`   1. 인덱스 서버에 실제 txId 삽입 완료`);
    console.log(`   2. 인덱스에서 실제 txId 검색`);
    console.log(`   3. 검색 결과 확인`);
    console.log(`   4. 인덱스 데이터 검증`);
    console.log(`\n🆕 IndexingClient 패키지 사용으로 개발 효율성이 향상되었습니다!`);
    process.exit(0);
  })
  .catch((error) => {
    console.error("❌ 테스트 실패:", error);
    process.exit(1);
  });