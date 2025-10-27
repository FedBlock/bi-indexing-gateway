const hre = require("hardhat");

// 설정 - Kaia 테스트넷
const NETWORK = 'kaia';
const INDEXING_API_BASE_URL = process.env.REACT_APP_INDEXING_API_URL || "https://grnd.bimatrix.co.kr/bc/idx";

/**
 * 인덱스 목록 조회
 */
async function getIndexList() {
  try {
    console.log('📋 생성된 인덱스 목록 조회 중...');
    
    const response = await fetch(`${INDEXING_API_BASE_URL}/api/index/list`, {
      signal: AbortSignal.timeout(5000)
    });
    
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    
    const result = await response.json();
    
    if (result.data?.indexes) {
      console.log(`✅ 인덱스 목록 (총 ${result.data.indexes.length}개):\n`);
      result.data.indexes.forEach((index, idx) => {
        console.log(`  ${idx + 1}. ID: ${index.indexId}, Name: ${index.indexName}, Network: ${index.network}`);
        console.log(`     IndexingKey: ${index.indexingKey}, KeyCount: ${index.keyCount || 0}`);
      });
      
      // Kaia 네트워크의 purpose 인덱스 찾기
      const purposeIndex = result.data.indexes.find(idx => 
        idx.indexingKey === 'purpose' && idx.network === NETWORK
      );
      
      return purposeIndex;
    } else {
      console.log('  인덱스가 없습니다.');
      return null;
    }
    
  } catch (error) {
    console.error('❌ 인덱스 목록 조회 실패:', error.message);
    return null;
  }
}

/**
 * Purpose별 데이터 검색
 */
async function searchByPurpose(purpose) {
  try {
    console.log(`\n🔍 "${purpose}" 검색 중...`);
    
    const searchParams = {
      IndexName: 'purpose',
      Field: 'IndexableData',
      Value: purpose,
      KeySize: 64,
      ComOp: 'Eq'
    };
    
    console.log(`  [검색 파라미터]`, JSON.stringify(searchParams, null, 2));
    
    const response = await fetch(`${INDEXING_API_BASE_URL}/api/index/search`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(searchParams),
      signal: AbortSignal.timeout(10000)
    });
    
    if (!response.ok) {
      const errorData = await response.json();
      console.error(`  ❌ 검색 실패 (HTTP ${response.status}):`, errorData.error);
      return 0;
    }
    
    const result = await response.json();
    
    // data.IdxData가 올바른 경로
    const txIds = result.data?.IdxData || result.IdxData || result.data?.txIds || [];
    
    if (txIds && txIds.length > 0) {
      const count = txIds.length;
      console.log(`  ✅ ${count}건 발견`);
      
      // 처음 5개만 출력
      const showCount = Math.min(5, count);
      for (let i = 0; i < showCount; i++) {
        const txId = txIds[i];
        console.log(`    ${i + 1}. ${txId}`);
      }
      
      if (count > showCount) {
        console.log(`    ... 외 ${count - showCount}건`);
      }
      
      return count;
    } else {
      console.log(`  ❌ 데이터 없음`);
      return 0;
    }
    
  } catch (error) {
    console.error(`  ❌ "${purpose}" 검색 실패:`, error.message);
    return 0;
  }
}

/**
 * 메인 함수
 */
async function main() {
  console.log('🏥 건강 데이터 조회 스크립트');
  console.log(`🌐 네트워크: ${NETWORK}`);
  console.log(`🌐 API: ${INDEXING_API_BASE_URL}\n`);
  
  try {
    // 1. 인덱스 목록 조회
    const purposeIndex = await getIndexList();
    
    if (!purposeIndex) {
      console.error('\n❌ Purpose 인덱스를 찾을 수 없습니다.');
      console.error(`   ${NETWORK} 네트워크에 인덱스가 생성되어 있는지 확인하세요.`);
      return;
    }
    
    console.log(`\n✅ Purpose 인덱스 발견: ID=${purposeIndex.indexId}\n`);
    
    // 2. Purpose별 데이터 검색
    console.log('═══════════════════════════════════════');
    console.log('📊 Purpose별 데이터 조회');
    console.log('═══════════════════════════════════════');
    
    const purposes = ['심박수', '혈당', '혈압'];
    const results = {};
    
    for (const purpose of purposes) {
      const count = await searchByPurpose(purpose);
      results[purpose] = count;
    }
    
    // 3. 통계 요약
    const totalCount = Object.values(results).reduce((sum, count) => sum + count, 0);
    
    console.log('\n═══════════════════════════════════════');
    console.log('📊 검색 결과 요약');
    console.log('═══════════════════════════════════════');
    console.log(`총 데이터: ${totalCount}건\n`);
    
    Object.entries(results).forEach(([purpose, count]) => {
      const percentage = totalCount > 0 ? ((count / totalCount) * 100).toFixed(1) : '0.0';
      console.log(`  - ${purpose}: ${count}건 (${percentage}%)`);
    });
    
    console.log('═══════════════════════════════════════');
    console.log('✅ 조회 완료!\n');
    
  } catch (error) {
    console.error('\n❌ 스크립트 실행 실패:', error.message);
    process.exit(1);
  }
}

main();
