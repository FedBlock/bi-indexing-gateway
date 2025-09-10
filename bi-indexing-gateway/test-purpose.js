#!/usr/bin/env node

const IndexingClient = require('./lib/indexing-client');
const path = require('path');

/**
 * Purpose 인덱스 테스트
 */
async function testPurposeIndex() {
  console.log('🔍 Purpose 인덱스 테스트 시작...\n');
  
  let client = null;
  
  try {
    // IndexingClient 생성
    client = new IndexingClient({
      serverAddr: 'localhost:50052',
      protoPath: path.join(__dirname, '../idxmngr-go/protos/index_manager.proto')
    });
    
    await new Promise(resolve => setTimeout(resolve, 1000)); // 연결 대기
    console.log('✅ IndexingClient 연결 완료\n');
    
    // 1. Purpose 인덱스 직접 검색
    console.log('1️⃣ Purpose 인덱스에서 "수면" 검색...');
    try {
      const result1 = await client.searchData({
        IndexID: 'purpose',
        Value: '수면'
      });
      
      console.log('✅ Purpose 검색 완료');
      console.log(`   - 결과 개수: ${result1.TxIDs ? result1.TxIDs.length : 0}개`);
      if (result1.TxIDs && result1.TxIDs.length > 0) {
        console.log(`   - 첫 번째 TxID: ${result1.TxIDs[0]}`);
      }
    } catch (error) {
      console.log('❌ Purpose 검색 실패:', error.message);
    }
    
    // 2. 다른 목적들도 시도
    const testPurposes = ['교육', '연구', '개발', '테스트', '학습'];
    
    console.log('\n2️⃣ 다른 목적들 검색 테스트...');
    for (const purpose of testPurposes) {
      try {
        const result = await client.searchData({
          IndexID: 'purpose',
          Value: purpose
        });
        
        console.log(`   - "${purpose}": ${result.TxIDs ? result.TxIDs.length : 0}개`);
      } catch (error) {
        console.log(`   - "${purpose}": 오류 - ${error.message}`);
      }
    }
    
    // 3. 인덱스 정보 조회
    console.log('\n3️⃣ Purpose 인덱스 정보 조회...');
    try {
      const indexInfo = await client.getIndexInfo({
        IndexID: 'purpose'
      });
      
      console.log('✅ 인덱스 정보 조회 성공');
      console.log(`   - 응답 코드: ${indexInfo.ResponseCode}`);
      console.log(`   - 메시지: ${indexInfo.ResponseMessage}`);
    } catch (error) {
      console.log('❌ 인덱스 정보 조회 실패:', error.message);
    }
    
    // 4. 사용 가능한 인덱스 확인
    console.log('\n4️⃣ 다양한 인덱스 ID 테스트...');
    const testIndexes = ['purpose', 'wallet', 'requester', 'organization', 'network'];
    
    for (const indexId of testIndexes) {
      try {
        const result = await client.searchData({
          IndexID: indexId,
          Value: 'test'
        });
        
        console.log(`   - "${indexId}": 인덱스 존재 (${result.TxIDs ? result.TxIDs.length : 0}개 결과)`);
      } catch (error) {
        if (error.message.includes('not found')) {
          console.log(`   - "${indexId}": 인덱스 없음`);
        } else {
          console.log(`   - "${indexId}": 오류 - ${error.message}`);
        }
      }
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
  testPurposeIndex().catch(console.error);
}

module.exports = testPurposeIndex;
