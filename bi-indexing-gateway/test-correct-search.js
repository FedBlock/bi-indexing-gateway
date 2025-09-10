#!/usr/bin/env node

const IndexingClient = require('./lib/indexing-client');
const path = require('path');

/**
 * 올바른 검색 방법 테스트 (server.js와 동일한 방식)
 */
async function testCorrectSearch() {
  console.log('🔍 올바른 검색 방법 테스트 시작...\n');
  
  let client = null;
  
  try {
    // IndexingClient 생성
    client = new IndexingClient({
      serverAddr: 'localhost:50052',
      protoPath: path.join(__dirname, '../idxmngr-go/protos/index_manager.proto')
    });
    
    await new Promise(resolve => setTimeout(resolve, 1000)); // 연결 대기
    console.log('✅ IndexingClient 연결 완료\n');
    
    // server.js와 동일한 방식으로 검색
    console.log('1️⃣ server.js 방식으로 purpose 검색...');
    
    const searchRequest = {
      IndexID: 'purpose',
      Field: 'IndexableData',
      Value: '수면',
      FilePath: 'data/hardhat-local/purpose.bf',
      KeySize: 64,
      ComOp: 'Eq'
    };
    
    console.log('📋 검색 요청:', JSON.stringify(searchRequest, null, 2));
    
    try {
      const searchResult = await client.searchData(searchRequest);
      console.log('📥 검색 응답:', JSON.stringify(searchResult, null, 2));
      
      const txHashes = searchResult.IdxData || [];
      console.log(`✅ "${searchRequest.Value}" 검색 완료: ${txHashes.length}개 트랜잭션 발견`);
      
      if (txHashes.length > 0) {
        console.log('📋 트랜잭션 목록:');
        txHashes.forEach((txHash, index) => {
          console.log(`   ${index + 1}. ${txHash}`);
        });
      }
      
    } catch (error) {
      console.log('❌ 검색 실패:', error.message);
    }
    
    // 다른 목적들도 테스트
    console.log('\n2️⃣ 다른 목적들 테스트...');
    const testPurposes = ['교육', '연구', '개발', '학습', '업무'];
    
    for (const purpose of testPurposes) {
      const request = {
        IndexID: 'purpose',
        Field: 'IndexableData', 
        Value: purpose,
        FilePath: 'data/hardhat-local/purpose.bf',
        KeySize: 64,
        ComOp: 'Eq'
      };
      
      try {
        const result = await client.searchData(request);
        const txHashes = result.IdxData || [];
        console.log(`   - "${purpose}": ${txHashes.length}개`);
        
        if (txHashes.length > 0) {
          console.log(`     첫 번째 TxID: ${txHashes[0]}`);
        }
      } catch (error) {
        console.log(`   - "${purpose}": 오류 - ${error.message}`);
      }
    }
    
    // 3. 범위 검색 테스트
    console.log('\n3️⃣ 범위 검색 테스트...');
    const rangeRequest = {
      IndexID: 'purpose',
      Field: 'IndexableData',
      Begin: '',
      End: 'zzz',
      FilePath: 'data/hardhat-local/purpose.bf',
      KeySize: 64,
      ComOp: 'Range'
    };
    
    try {
      const rangeResult = await client.searchData(rangeRequest);
      const allTxHashes = rangeResult.IdxData || [];
      console.log(`✅ 전체 범위 검색: ${allTxHashes.length}개 트랜잭션`);
      
      if (allTxHashes.length > 0) {
        console.log('📋 처음 5개 트랜잭션:');
        allTxHashes.slice(0, 5).forEach((txHash, index) => {
          console.log(`   ${index + 1}. ${txHash}`);
        });
      }
    } catch (error) {
      console.log('❌ 범위 검색 실패:', error.message);
    }
    
  } catch (error) {
    console.error('❌ 테스트 중 오류:', error.message);
  } finally {
    if (client) {
      await client.close();
      console.log('\n✅ 연결 정리 완료');
    }
  }
}

// 스크립트 직접 실행
if (require.main === module) {
  testCorrectSearch().catch(console.error);
}

module.exports = testCorrectSearch;
