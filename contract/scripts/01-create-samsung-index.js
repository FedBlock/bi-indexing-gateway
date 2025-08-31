#!/usr/bin/env node

const path = require('path');
const IndexingClient = require('../../indexing-client-package/lib/indexing-client');

async function createSamsungIndex() {
  console.log('🚀 Samsung 조직 인덱스 생성 시작\n');

  const indexingClient = new IndexingClient({
    serverAddr: 'localhost:50052',
    protoPath: path.join(process.cwd(), '../idxmngr-go/protos/index_manager.proto')
  });

  try {
    // 연결 완료 대기
    await new Promise(resolve => setTimeout(resolve, 1000));
    
    const indexInfo = {
      IndexID: "samsung_001",
      IndexName: "Samsung Organization Index",
      KeyCol: 'IndexableData',
      FilePath: "data/hardhat/samsung_001.bf",
      KeySize: 64,
      Network: 'hardhat'
    };
    
    console.log(`📋 생성할 Samsung 인덱스 정보:`);
    console.log(`   🆔 IndexID: ${indexInfo.IndexID}`);
    console.log(`   📝 IndexName: ${indexInfo.IndexName}`);
    console.log(`   🔑 KeyCol: ${indexInfo.KeyCol}`);
    console.log(`   📁 FilePath: ${indexInfo.FilePath}`);
    console.log(`   📏 KeySize: ${indexInfo.KeySize}`);
    console.log(`   🌐 Network: ${indexInfo.Network}\n`);
    
    try {
      await indexingClient.createIndex(indexInfo);
      console.log(`✅ Samsung 인덱스 생성 성공: ${indexInfo.IndexID}`);
      
    } catch (error) {
      console.error(`❌ Samsung 인덱스 생성 실패: ${error.message}`);
    }
    
  } catch (error) {
    console.error(`❌ Samsung 인덱스 생성 중 오류 발생: ${error.message}`);
  } finally {
    indexingClient.close();
  }
}

// 메인 실행
if (require.main === module) {
  createSamsungIndex().catch(console.error);
}

module.exports = { createSamsungIndex };
