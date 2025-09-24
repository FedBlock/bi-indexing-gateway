const axios = require('axios');

// API 비교 테스트 함수
async function compareAPIs() {
  const baseURL = 'http://192.168.10.30:3001/api/blockchain-search';
  const network = 'hardhat-local';
  const purpose = '수면'; // 또는 다른 목적으로 변경 가능
  
  console.log('🚀 API 성능 비교 테스트 시작');
  console.log(`📝 검색 조건: network=${network}, purpose=${purpose}\n`);
  
  // 세 가지 API 요청 설정
  const batchSize = 15; // 🔧 배치 크기 설정
  const adaptiveBatch = true; // 🔧 적응형 배치 활성화
  
  const apiRequests = [
    {
      name: '인덱스 기반 조회',
      emoji: '⚡',
      url: `${baseURL}?network=${network}&purpose=${encodeURIComponent(purpose)}&indexed=true&batchSize=${batchSize}&adaptiveBatch=${adaptiveBatch}`,
      type: 'indexed=true'
    },
    {
      name: '이벤트 인덱스 조회',
      emoji: '🔍',
      url: `${baseURL}?network=${network}&purpose=${encodeURIComponent(purpose)}&indexed=event&batchSize=${batchSize}&adaptiveBatch=${adaptiveBatch}`,
      type: 'indexed=event'
    },
    {
      name: '블록체인 직접 조회',
      emoji: '🐌',
      url: `${baseURL}?network=${network}&indexed=false`,
      type: 'indexed=false'
    }
  ];
  
  const startTime = Date.now();
  
  try {
    // 🚀 병렬로 모든 API 호출
    console.log('📡 세 가지 API 동시 호출 중...\n');
    
    const promises = apiRequests.map(async (api) => {
      const apiStart = Date.now();
      
      try {
        const response = await axios.get(api.url, {
          timeout: 30000 // 30초 타임아웃
        });
        
        const apiTime = Date.now() - apiStart;
        
        return {
          ...api,
          success: true,
          responseTime: apiTime,
          data: response.data,
          dataCount: response.data.data ? response.data.data.length : 0,
          status: response.status
        };
        
      } catch (error) {
        const apiTime = Date.now() - apiStart;
        
        return {
          ...api,
          success: false,
          responseTime: apiTime,
          error: error.message,
          status: error.response?.status || 'timeout'
        };
      }
    });
    
    // 모든 요청 완료 대기
    const results = await Promise.all(promises);
    const totalTime = Date.now() - startTime;
    
    // 📊 결과 분석 및 출력
    console.log('📊 ===== API 비교 결과 =====\n');
    
    results.forEach((result, index) => {
      console.log(`${result.emoji} ${result.name} (${result.type})`);
      console.log(`   ⏱️  응답시간: ${result.responseTime}ms`);
      console.log(`   📊 상태: ${result.success ? '✅ 성공' : '❌ 실패'}`);
      
      if (result.success) {
        console.log(`   📋 데이터 개수: ${result.dataCount}개`);
        console.log(`   🔧 처리시간: ${result.data.processingTime || 'N/A'}`);
        
        // 첫 번째 데이터 샘플 출력
        if (result.dataCount > 0 && result.data.data[0]) {
          const sample = result.data.data[0];
          console.log(`   📝 샘플 데이터:`);
          console.log(`      txId: ${sample.txId?.substring(0, 10)}...`);
          console.log(`      purpose: ${sample.purpose || 'N/A'}`);
          console.log(`      organizationName: ${sample.organizationName || 'N/A'}`);
        }
      } else {
        console.log(`   ❌ 에러: ${result.error}`);
        console.log(`   📊 상태코드: ${result.status}`);
      }
      console.log('');
    });
    
    // 📈 성능 순위
    const successResults = results.filter(r => r.success);
    if (successResults.length > 0) {
      console.log('🏆 ===== 성능 순위 =====');
      const sortedBySpeed = [...successResults].sort((a, b) => a.responseTime - b.responseTime);
      
      sortedBySpeed.forEach((result, index) => {
        const medal = ['🥇', '🥈', '🥉'][index] || '🏅';
        console.log(`${medal} ${index + 1}위: ${result.name} - ${result.responseTime}ms`);
      });
      console.log('');
    }
    
    // 📋 데이터 일치성 검사
    console.log('🔍 ===== 데이터 일치성 검사 =====');
    const dataResults = results.filter(r => r.success && r.dataCount > 0);
    
    if (dataResults.length >= 2) {
      const firstResult = dataResults[0];
      let allMatch = true;
      
      for (let i = 1; i < dataResults.length; i++) {
        const currentResult = dataResults[i];
        
        if (firstResult.dataCount !== currentResult.dataCount) {
          console.log(`⚠️  데이터 개수 불일치: ${firstResult.name}(${firstResult.dataCount}) vs ${currentResult.name}(${currentResult.dataCount})`);
          allMatch = false;
        }
        
        // 첫 번째 데이터의 txId 비교 (있는 경우)
        if (firstResult.data.data[0]?.txId && currentResult.data.data[0]?.txId) {
          if (firstResult.data.data[0].txId !== currentResult.data.data[0].txId) {
            console.log(`⚠️  첫 번째 txId 불일치: ${firstResult.name} vs ${currentResult.name}`);
            allMatch = false;
          }
        }
      }
      
      if (allMatch) {
        console.log('✅ 모든 API 결과가 일치합니다!');
      }
    } else {
      console.log('⚠️  비교할 데이터가 부족합니다.');
    }
    
    console.log(`\n⏰ 전체 테스트 시간: ${totalTime}ms`);
    console.log('🎉 API 비교 테스트 완료!\n');
    
    // 📊 요약 테이블
    console.log('📊 ===== 요약 테이블 =====');
    console.log('┌─────────────────────────┬─────────────┬─────────────┬─────────────┐');
    console.log('│ API 방식                │ 응답시간    │ 상태        │ 데이터 개수 │');
    console.log('├─────────────────────────┼─────────────┼─────────────┼─────────────┤');
    
    results.forEach(result => {
      const name = result.name.padEnd(23);
      const time = `${result.responseTime}ms`.padEnd(11);
      const status = (result.success ? '성공' : '실패').padEnd(11);
      const count = `${result.dataCount || 0}개`.padEnd(11);
      
      console.log(`│ ${name} │ ${time} │ ${status} │ ${count} │`);
    });
    
    console.log('└─────────────────────────┴─────────────┴─────────────┴─────────────┘');
    
  } catch (error) {
    console.error('❌ 테스트 실행 중 오류 발생:', error.message);
  }
}

// 커스텀 목적으로 테스트하는 함수
async function testWithCustomPurpose(customPurpose) {
  console.log(`🔧 커스텀 목적으로 테스트: "${customPurpose}"\n`);
  
  // 임시로 목적 변경해서 테스트
  const originalScript = compareAPIs.toString();
  const modifiedScript = originalScript.replace("const purpose = '수면';", `const purpose = '${customPurpose}';`);
  
  // 새로운 함수 실행
  await eval(`(${modifiedScript})()`)
}

// 메인 실행
if (require.main === module) {
  const args = process.argv.slice(2);
  
  if (args.length > 0) {
    // 커스텀 목적이 제공된 경우
    testWithCustomPurpose(args[0]);
  } else {
    // 기본 테스트 실행
    compareAPIs();
  }
}

module.exports = { compareAPIs, testWithCustomPurpose };
