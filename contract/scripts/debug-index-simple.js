require('dotenv').config();

/**
 * 인덱스 API 단계별 디버깅
 * - 인덱스 목록 확인
 * - 다양한 검색 방법 테스트
 * - 60km/h 이상 데이터 조회
 */

const INDEXING_API_URL = process.env.INDEXING_API_URL || 'https://grnd.bimatrix.co.kr/bc/idx';

/**
 * 인덱스 목록 조회
 */
async function getIndexList() {
  try {
    console.log('🔍 인덱스 목록 조회 중...');
    console.log(`📍 API URL: ${INDEXING_API_URL}`);
    
    const response = await fetch(`${INDEXING_API_URL}/api/index/list`, {
      method: 'GET',
      headers: { 'Content-Type': 'application/json' }
    });
    
    console.log(`📡 응답 상태: ${response.status} ${response.statusText}`);
    
    if (response.ok) {
      const result = await response.json();
      console.log('✅ 인덱스 목록:');
      console.log(JSON.stringify(result, null, 2));
      return result;
    } else {
      const errorText = await response.text();
      console.log(`❌ 오류: ${errorText}`);
      return null;
    }
    
  } catch (error) {
    console.error('❌ 연결 실패:', error.message);
    return null;
  }
}

/**
 * 단순한 검색 테스트 (모든 데이터)
 */
async function testSimpleSearch() {
  try {
    console.log('\n🔍 단순한 검색 테스트 (모든 speeding 데이터)...');
    
    const response = await fetch(`${INDEXING_API_URL}/api/index/search`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        IndexName: 'speeding',
        Field: 'IndexableData',
        Value: 'spd::',
        ComOp: 5  // GreaterThanEq (StartsWith 대신)
      })
    });
    
    console.log(`📡 응답 상태: ${response.status} ${response.statusText}`);
    
    if (response.ok) {
      const result = await response.json();
      const dataCount = result.data?.IdxData?.length || 0;
      console.log(`✅ 성공: ${dataCount}건 조회됨`);
      
      if (dataCount > 0) {
        console.log(`📋 샘플 데이터 (처음 5개):`);
        result.data.IdxData.slice(0, 5).forEach((item, i) => {
          console.log(`  ${i + 1}. ${item}`);
        });
      }
      
      return result.data?.IdxData || [];
    } else {
      const errorText = await response.text();
      console.log(`❌ 실패: ${errorText}`);
      return [];
    }
    
  } catch (error) {
    console.log(`❌ 에러: ${error.message}`);
    return [];
  }
}

/**
 * 60km/h 이상 데이터 검색 (다양한 방법)
 */
async function search60kmPlus() {
  console.log('\n🔍 60km/h 이상 데이터 검색 테스트...');
  
  const testCases = [
    {
      name: '60km/h 이상 (Greater)',
      payload: {
        IndexName: 'speeding',
        Field: 'IndexableData',
        Value: 'spd::060::',
        ComOp: 4  // Greater
      }
    },
    {
      name: '60km/h 이상 (GreaterThanEq)',
      payload: {
        IndexName: 'speeding',
        Field: 'IndexableData',
        Value: 'spd::060::',
        ComOp: 5  // GreaterThanEq
      }
    },
    {
      name: '정확히 60km/h',
      payload: {
        IndexName: 'speeding',
        Field: 'IndexableData',
        Value: 'spd::060::',
        ComOp: 0  // Eq
      }
    },
    {
      name: '70km/h 이상',
      payload: {
        IndexName: 'speeding',
        Field: 'IndexableData',
        Value: 'spd::070::',
        ComOp: 4  // Greater
      }
    },
    {
      name: '80km/h 이상',
      payload: {
        IndexName: 'speeding',
        Field: 'IndexableData',
        Value: 'spd::080::',
        ComOp: 4  // Greater
      }
    }
  ];
  
  for (const testCase of testCases) {
    console.log(`\n📊 ${testCase.name} 테스트...`);
    
    try {
      const startTime = Date.now();
      
      const response = await fetch(`${INDEXING_API_URL}/api/index/search`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(testCase.payload)
      });
      
      const queryTime = Date.now() - startTime;
      
      console.log(`  응답 상태: ${response.status} ${response.statusText}`);
      console.log(`  응답 시간: ${queryTime}ms`);
      
      if (response.ok) {
        const result = await response.json();
        const dataCount = result.data?.IdxData?.length || 0;
        console.log(`  ✅ 성공: ${dataCount}건 조회됨`);
        
        if (dataCount > 0) {
          console.log(`  📋 샘플 데이터 (처음 3개):`);
          result.data.IdxData.slice(0, 3).forEach((item, i) => {
            console.log(`    ${i + 1}. ${item}`);
          });
        }
      } else {
        const errorText = await response.text();
        console.log(`  ❌ 실패: ${errorText}`);
      }
      
    } catch (error) {
      console.log(`  ❌ 에러: ${error.message}`);
    }
    
    // 요청 간 딜레이
    await new Promise(resolve => setTimeout(resolve, 500));
  }
}

/**
 * 메인 함수
 */
async function main() {
  console.log('\n🔍 인덱스 API 단계별 디버깅');
  console.log('='.repeat(60));
  
  // 1. 인덱스 목록 확인
  const indexList = await getIndexList();
  
  // 2. 단순한 검색 테스트
  const allData = await testSimpleSearch();
  
  // 3. 60km/h 이상 데이터 검색
  await search60kmPlus();
  
  // 4. 결과 요약
  console.log('\n' + '='.repeat(60));
  console.log('📈 디버깅 결과 요약');
  console.log('='.repeat(60));
  console.log(`🔗 인덱스 API 연결: ${indexList ? '✅ 성공' : '❌ 실패'}`);
  console.log(`📊 전체 데이터 조회: ${allData.length}건`);
  
  if (allData.length > 0) {
    console.log(`📋 데이터 샘플:`);
    allData.slice(0, 3).forEach((item, i) => {
      console.log(`  ${i + 1}. ${item}`);
    });
  }
  
  console.log('\n🎉 디버깅 완료!');
}

// 스크립트 실행
if (require.main === module) {
  main()
    .then(() => process.exit(0))
    .catch((error) => {
      console.error('❌ 디버깅 실행 실패:', error);
      process.exit(1);
    });
}

module.exports = {
  getIndexList,
  testSimpleSearch,
  search60kmPlus
};
