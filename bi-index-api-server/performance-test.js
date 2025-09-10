#!/usr/bin/env node

const axios = require('axios');

const BASE_URL = 'http://localhost:3001';

async function testPerformance() {
  console.log('🚀 인덱스 vs 블록체인 직접 검색 성능 비교 테스트');
  console.log('=' .repeat(60));
  
  const testCases = [
    { purpose: '혈압', description: '혈압 데이터 검색' },
    { purpose: '수면', description: '수면 데이터 검색' },
    { purpose: '심박수', description: '심박수 데이터 검색' }
  ];
  
  for (const testCase of testCases) {
    console.log(`\n📊 ${testCase.description} 테스트`);
    console.log('-' .repeat(40));
    
    // 1. 인덱스 기반 검색 (빠름)
    console.log('🔍 인덱스 기반 검색 중...');
    const indexedStart = Date.now();
    
    try {
      const indexedResponse = await axios.get(`${BASE_URL}/api/blockchain-search`, {
        params: {
          network: 'hardhat-local',
          purpose: testCase.purpose,
          indexed: 'true'
        },
        timeout: 30000
      });
      
      const indexedTime = Date.now() - indexedStart;
      const serverTime = indexedResponse.data.processingTime;
      
      console.log(`   ✅ 인덱스 검색 완료`);
      console.log(`   📈 클라이언트 측정 시간: ${indexedTime}ms`);
      console.log(`   📈 서버 처리 시간: ${serverTime}`);
      console.log(`   📝 결과 개수: ${indexedResponse.data.totalCount || 0}개`);
      
    } catch (error) {
      console.log(`   ❌ 인덱스 검색 실패: ${error.message}`);
    }
    
    // 잠시 대기
    await new Promise(resolve => setTimeout(resolve, 1000));
    
    // 2. 블록체인 직접 검색 (느림)
    console.log('🔗 블록체인 직접 검색 중...');
    const directStart = Date.now();
    
    try {
      const directResponse = await axios.get(`${BASE_URL}/api/blockchain-search`, {
        params: {
          network: 'hardhat-local',
          purpose: testCase.purpose,
          indexed: 'false'
        },
        timeout: 60000
      });
      
      const directTime = Date.now() - directStart;
      const serverTime = directResponse.data.processingTime;
      
      console.log(`   ✅ 직접 검색 완료`);
      console.log(`   📈 클라이언트 측정 시간: ${directTime}ms`);
      console.log(`   📈 서버 처리 시간: ${serverTime}`);
      console.log(`   📝 결과 개수: ${directResponse.data.totalCount || 0}개`);
      
    } catch (error) {
      console.log(`   ❌ 직접 검색 실패: ${error.message}`);
    }
    
    console.log('');
  }
  
  console.log('🎯 성능 비교 테스트 완료!');
}

// 메인 실행
if (require.main === module) {
  testPerformance().catch(console.error);
}

module.exports = { testPerformance };
