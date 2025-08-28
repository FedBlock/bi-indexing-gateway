const IndexingClient = require('../../indexing-client-package/lib/indexing-client');

/**
 * Samsung 인덱스 생성 전용 스크립트
 * samsung_001 인덱스를 먼저 생성
 */
async function main() {
  console.log("️ Samsung 인덱스 생성 시작...");

  // IndexingClient 인스턴스 생성
  const indexingClient = new IndexingClient({
    serverAddr: 'localhost:50052',
    protoPath: '../../idxmngr-go/protos/index_manager.proto'
  });

  try {
    // 연결 완료 대기
    await new Promise(resolve => setTimeout(resolve, 1000));

    // Samsung 인덱스 정보
    const indexInfo = {
      IndexID: 'samsung_001',
      IndexName: 'Samsung Access Request Index',
      KeyCol: 'IndexableData',
      FilePath: '/home/blockchain/bi-index-migration/bi-index/fileindex-go/samsung.bf',
      KeySize: 32,
      BlockNum: 0,
      CallCnt: 0,
      KeyCnt: 0,
      IndexDataCnt: 0,
      Param: ''
    };

    console.log(`\n 생성할 인덱스 정보:`);
    console.log(`   IndexID: ${indexInfo.IndexID}`);
    console.log(`   IndexName: ${indexInfo.IndexName}`);
    console.log(`   KeyCol: ${indexInfo.KeyCol}`);
    console.log(`   FilePath: ${indexInfo.FilePath}`);
    console.log(`   KeySize: ${indexInfo.KeySize}`);

    // 1. 인덱스 정보 확인 (이미 존재하는지)
    console.log(`\n🔍 1️⃣ 인덱스 정보 확인...`);
    try {
      const existingInfo = await indexingClient.getIndexInfo({
        RequestMsg: 'GetIndexInfo',
        KeyCol: 'IndexableData',
        Param: 'samsung_001'
      });
      console.log(`✅ 인덱스 정보: ${JSON.stringify(existingInfo)}`);
      
      if (existingInfo.ResponseCode === 500) {
        console.log(`ℹ️  인덱스가 이미 존재함: ${existingInfo.ResponseMessage}`);
        return {
          indexID: indexInfo.IndexID,
          status: 'already_exists',
          message: existingInfo.ResponseMessage
        };
      }
    } catch (error) {
      console.log(`ℹ️  인덱스 정보 조회 실패: ${error.message}`);
    }

    // 2. 인덱스 생성
    console.log(`\n🏗️ 2️⃣ 인덱스 생성 중...`);
    const result = await indexingClient.createIndex(indexInfo);
    console.log(`✅ 인덱스 생성 성공!`);
    console.log(`   결과: ${JSON.stringify(result)}`);

    return {
      indexID: indexInfo.IndexID,
      status: 'created',
      result: result
    };

  } catch (error) {
    console.error(`❌ 인덱스 생성 실패: ${error.message}`);
    throw error;
  } finally {
    indexingClient.close();
  }
}

main()
  .then((result) => {
    console.log(`\n Samsung 인덱스 생성 완료!`);
    console.log(`   IndexID: ${result.indexID}`);
    console.log(`   Status: ${result.status}`);
    if (result.status === 'created') {
      console.log(`\n📋 다음 단계: 데이터 삽입 테스트`);
    }
    process.exit(0);
  })
  .catch((error) => {
    console.error("❌ 인덱스 생성 실패:", error);
    process.exit(1);
  });