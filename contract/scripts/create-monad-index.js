const IndexingClient = require('../../indexing-client-package/lib/indexing-client');

/**
 * Monad 네트워크용 Samsung 인덱스 생성 스크립트
 * monad_abcdef12_speed 인덱스를 생성
 */

async function main() {
  console.log("🏗️ Monad 네트워크 - Samsung 인덱스 생성 시작...");

  // IndexingClient 인스턴스 생성
  const indexingClient = new IndexingClient({
    serverAddr: 'localhost:50052',
    protoPath: '../idxmngr-go/protos/index_manager.proto'
  });

  try {
    // 연결 완료 대기
    await new Promise(resolve => setTimeout(resolve, 1000));
    
    // CreateIndexRequest 구조체 생성 (Monad 네트워크용)
    const createRequest = {
      IndexID: 'monad_abcdef12_speed',
      IndexName: 'Monad Network - Samsung Speed Index',
      KeyCol: 'IndexableData',  // IndexableData로 설정
      FilePath: 'monad_abcdef12_speed.bf',
      KeySize: 7,  // "samsung" 문자열 길이에 맞춤
      Network: 'monad'  // Monad 네트워크 지정
    };

    console.log(`\n🔌 IndexingClient로 CreateIndexRequest 호출 시작...`);
    console.log(`   서버 주소: localhost:50052`);
    console.log(`   요청 데이터: ${JSON.stringify(createRequest, null, 2)}`);
    
    // IndexingClient를 사용해서 인덱스 생성
    await indexingClient.createIndex(createRequest);
    console.log(`✅ Monad 네트워크 인덱스 생성 성공!`);
    
    console.log(`\n📋 생성된 인덱스 정보:`);
    console.log(`   IndexID: ${createRequest.IndexID}`);
    console.log(`   IndexName: ${createRequest.IndexName}`);
    console.log(`   KeyCol: ${createRequest.KeyCol}`);
    console.log(`   FilePath: ${createRequest.FilePath}`);
    console.log(`   KeySize: ${createRequest.KeySize}`);
    console.log(`   Network: ${createRequest.Network}`);

  } catch (error) {
    console.error(`❌ Monad 네트워크 인덱스 생성 실패: ${error.message}`);
    throw error;
  } finally {
    indexingClient.close();
  }

  console.log(`\n🎉 Monad 네트워크 - Samsung 인덱스 생성 완료!`);
  console.log(`   다음 단계: monad-with-indexing.js로 데이터 인덱싱 테스트`);
}

main()
  .then(() => {
    console.log(`\n✅ Monad 네트워크 인덱스 생성 성공!`);
    process.exit(0);
  })
  .catch((error) => {
    console.error("❌ Monad 네트워크 인덱스 생성 실패:", error);
    process.exit(1);
  });
