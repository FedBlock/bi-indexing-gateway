const hre = require("hardhat");
const IndexingClient = require('../../indexing-client-package/lib/indexing-client');

/**
 * Samsung Access Request + Indexing 스크립트
 * 삼성전자 접근 요청을 생성하고 인덱스에 저장
 */
async function main() {
  console.log("🏢 Samsung Access Request + Indexing 시작...");

  // 계정 및 컨트랙트 설정
  const [samsungAccount] = await hre.ethers.getSigners();
  const contractAddress = "0xa513E6E4b8f2a923D98304ec87F64353C4D5C853";
  
  console.log(`📱 Samsung 계정: ${samsungAccount.address}`);
  console.log(`📍 컨트랙트 주소: ${contractAddress}`);

  // AccessManagement 컨트랙트 인스턴스 생성
  const AccessManagement = await hre.ethers.getContractFactory("AccessManagement");
  const accessManagement = AccessManagement.attach(contractAddress);

  // Samsung 조직 정보
  const organizationName = "삼성전자";

  console.log(`\n📋 Access Request 정보:`);
  console.log(`   Organization: ${organizationName}`);

  // IndexingClient 인스턴스 생성
  const indexingClient = new IndexingClient({
    serverAddr: 'localhost:50052',
    protoPath: '../../idxmngr-go/protos/index_manager.proto'
  });

  try {
    // 연결 완료 대기
    await new Promise(resolve => setTimeout(resolve, 1000));

    // 1. saveRequest 함수 호출
    console.log(`\n🚀 saveRequest 함수 호출 중...`);
    const tx = await accessManagement.saveRequest(
      "0x8626f6940E2eb28930eFb4CeF49B2d1F2C9C1199", // resourceOwner
      "Business Partnership", // purpose
      organizationName
    );
    console.log(`📝 트랜잭션 전송됨: ${tx.hash}`);
    
    // 트랜잭션 완료 대기
    const receipt = await tx.wait();
    console.log(`✅ 트랜잭션 완료! Block: ${receipt.blockNumber}, Gas: ${receipt.gasUsed.toString()}`);

    // 2. 트랜잭션 해시를 직접 사용
    const txId = receipt.hash;
    console.log(`\n📊 트랜잭션 해시: ${txId}`);

    // 3. 인덱스에 데이터 삽입
    console.log(`\n📊 인덱스에 데이터 삽입 중...`);
    
    // 간단한 중복 체크: 이미 존재하는 TxId인지 확인
    console.log(`🔍 중복 체크 중...`);
    try {
      const searchRequest = {
        IndexID: 'samsung_001',
        Field: 'IndexableData',  // 이제 IndexableData로 검색 가능
        Value: organizationName,
        ComOp: 'Eq'
      };
      
      const existingData = await indexingClient.searchData(searchRequest);
      const existingTxIds = existingData.IdxData || [];
      
      if (existingTxIds.includes(txId)) {
        console.log(`⚠️  이미 존재하는 TxId: ${txId}`);
        console.log(`📊 현재 인덱스 상태: ${existingTxIds.length}개 데이터`);
        return {
          txHash: txId,
          requestId: txId,
          indexData: {
            txHash: txId,
            organization: organizationName,
            status: 'already_exists'
          }
        };
      }
      
      console.log(`✅ 중복 없음, 새 데이터 삽입 진행`);
    } catch (error) {
      console.log(`⚠️  중복 체크 실패, 삽입 진행: ${error.message}`);
    }
    
    const insertRequest = {
      IndexID: 'samsung_001',
      BcList: [{
        TxId: txId,
        key_col: 'IndexableData',
        IndexableData: {
          OrganizationName: organizationName  // 인덱싱에 실제로 사용되는 key
        }
      }],
      ColName: 'IndexableData',
      FilePath: '/home/blockchain/bi-index-migration/bi-index/fileindex-go/samsung.bf'
    };

    await indexingClient.insertData(insertRequest);
    console.log(`✅ 인덱스 서버 삽입 성공!`);

    return {
      txHash: txId,
      requestId: txId,
      indexData: {
        txHash: txId,
        organization: organizationName
      }
    };

  } catch (error) {
    console.error(`❌ 테스트 실패: ${error.message}`);
    throw error;
  } finally {
    indexingClient.close();
  }
}

main()
  .then((result) => {
    console.log(`\n🎉 Samsung Access Request + Indexing 성공!`);
    console.log(`   Tx Hash: ${result.txHash}`);
    console.log(`\n📋 다음 단계: 인덱스에서 데이터 검색 테스트`);
    process.exit(0);
  })
  .catch((error) => {
    console.error("❌ 테스트 실패:", error);
    process.exit(1);
  });