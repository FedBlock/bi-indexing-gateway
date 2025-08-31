#!/usr/bin/env node

const path = require('path');
const IndexingClient = require('../../indexing-client-package/lib/indexing-client');

async function checkIndexStatus() {
  console.log('🔍 현재 인덱스 상태 확인 시작\n');

  const indexingClient = new IndexingClient({
    serverAddr: 'localhost:50052',
    protoPath: path.join(process.cwd(), '../idxmngr-go/protos/index_manager.proto')
  });

  try {
    // 연결 완료 대기
    await new Promise(resolve => setTimeout(resolve, 1000));
    
    // 확인할 인덱스들
    const indexesToCheck = [
      "samsung_001",
      "user_d8321319_001",
      "user_575a3a49_001", 
      "user_eb5d27fd_001",
      "user_519b178b_001"
    ];

    console.log('📊 인덱스 상태 확인 중...\n');

    for (const indexID of indexesToCheck) {
      try {
        const request = {
          IndexID: indexID,
          IndexName: "",
          KeyCol: "",
          FilePath: "",
          KeySize: 0,
          Network: ""
        };

        const response = await indexingClient.getIndexInfo(request);
        console.log(`✅ ${indexID}:`);
        console.log(`   🔍 전체 응답 구조:`);
        console.log(JSON.stringify(response, null, 2));
        console.log('');
        console.log(`   📝 IndexName: ${response.IndexName || 'N/A'}`);
        console.log(`   🔑 KeyCol: ${response.KeyCol || 'N/A'}`);
        console.log(`   📁 FilePath: ${response.FilePath || 'N/A'}`);
        console.log(`   📏 KeySize: ${response.KeySize || 'N/A'}`);
        console.log(`   📊 KeyCnt: ${response.KeyCnt || 'N/A'}`);
        console.log(`   📈 IndexDataCnt: ${response.IndexDataCnt || 'N/A'}`);
        console.log('');

      } catch (error) {
        console.error(`❌ ${indexID} 조회 실패: ${error.message}`);
      }
    }

    console.log('🎉 인덱스 상태 확인 완료!');

  } catch (error) {
    console.error(`❌ 인덱스 상태 확인 중 오류 발생: ${error.message}`);
  } finally {
    indexingClient.close();
  }
}

// 메인 실행
if (require.main === module) {
  checkIndexStatus().catch(console.error);
}

module.exports = { checkIndexStatus };
