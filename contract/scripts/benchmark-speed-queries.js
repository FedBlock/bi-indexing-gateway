require('dotenv').config();
const hre = require('hardhat');
const fs = require('fs');

/**
 * 블록체인 vs 인덱스 조회 성능 비교 벤치마크
 * - 시속 60km 이상 조건별 조회
 * - 시속 80km 이상 조건별 조회
 * - 성능 측정 및 비교 분석
 */

const DEPLOYMENT_FILE = './scripts/pvd-deployment.json';
const INDEXING_API_URL = process.env.INDEXING_API_URL || 'https://grnd.bimatrix.co.kr/bc/idx';

// 벤치마크 설정
const BENCHMARK_CONFIG = {
  speedThresholds: [60, 80],  // 테스트할 속도 임계값
  iterations: 5,              // 각 테스트 반복 횟수
  warmupIterations: 2         // 워밍업 반복 횟수
};

/**
 * 블록체인에서 직접 조회 (속도 조건별)
 */
async function queryBlockchainBySpeed(minSpeed) {
  try {
    const startTime = Date.now();
    
    // 배포된 컨트랙트 주소 로드
    const deploymentInfo = JSON.parse(fs.readFileSync(DEPLOYMENT_FILE, 'utf8'));
    const contractAddress = deploymentInfo.contractAddress;
    
    // 컨트랙트 연결
    const PvdRecord = await hre.ethers.getContractFactory('PvdRecord');
    const pvdRecord = PvdRecord.attach(contractAddress);
    
    // 전체 데이터 조회
    const allPvdData = await pvdRecord.getPvdWorldStates();
    
    // 속도 조건별 필터링
    const filteredData = allPvdData.filter(pvd => Number(pvd.speed) >= minSpeed);
    
    const queryTime = Date.now() - startTime;
    
    return {
      success: true,
      count: filteredData.length,
      totalCount: allPvdData.length,
      queryTime: queryTime,
      data: filteredData.slice(0, 10) // 샘플 데이터만 반환 (성능 측정용)
    };
    
  } catch (error) {
    console.error(`❌ 블록체인 조회 실패 (${minSpeed}km/h 이상):`, error.message);
    return {
      success: false,
      error: error.message,
      count: 0,
      queryTime: 0
    };
  }
}

/**
 * 인덱스에서 범위 조회 (속도 조건별)
 */
async function queryIndexBySpeedRange(minSpeed) {
  try {
    const startTime = Date.now();
    
    // 패딩된 속도로 검색 키 생성
    const paddedMinSpeed = String(minSpeed).padStart(3, '0');
    const searchKey = `spd::${paddedMinSpeed}::`;
    
    console.log(`🔍 인덱스 범위 검색: ${searchKey} (${minSpeed}km/h 이상)`);
    
    const response = await fetch(`${INDEXING_API_URL}/api/index/search`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        IndexName: 'speeding',
        Field: 'IndexableData',
        Value: searchKey,
        ComOp: 2  // Gt (Greater than)
      })
    });
    
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }
    
    const result = await response.json();
    const queryTime = Date.now() - startTime;
    
    return {
      success: true,
      count: result.data?.IdxData?.length || 0,
      queryTime: queryTime,
      data: result.data?.IdxData?.slice(0, 10) || [] // 샘플 데이터만 반환
    };
    
  } catch (error) {
    console.error(`❌ 인덱스 조회 실패 (${minSpeed}km/h 이상):`, error.message);
    return {
      success: false,
      error: error.message,
      count: 0,
      queryTime: 0
    };
  }
}

/**
 * 인덱스에서 정확한 속도 검색 (특정 속도값)
 */
async function queryIndexByExactSpeed(speed) {
  try {
    const startTime = Date.now();
    
    // 패딩된 속도로 검색 키 생성
    const paddedSpeed = String(speed).padStart(3, '0');
    const searchKey = `spd::${paddedSpeed}::`;
    
    console.log(`🔍 인덱스 정확 검색: ${searchKey} (정확히 ${speed}km/h)`);
    
    const response = await fetch(`${INDEXING_API_URL}/api/index/search`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        IndexName: 'speeding',
        Field: 'IndexableData',
        Value: searchKey,
        ComOp: 5  // StartsWith
      })
    });
    
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }
    
    const result = await response.json();
    const queryTime = Date.now() - startTime;
    
    return {
      success: true,
      count: result.data?.IdxData?.length || 0,
      queryTime: queryTime,
      data: result.data?.IdxData?.slice(0, 10) || []
    };
    
  } catch (error) {
    console.error(`❌ 인덱스 정확 검색 실패 (${speed}km/h):`, error.message);
    return {
      success: false,
      error: error.message,
      count: 0,
      queryTime: 0
    };
  }
}

/**
 * 성능 측정 함수
 */
async function measurePerformance(testFunction, testName, iterations = BENCHMARK_CONFIG.iterations) {
  console.log(`\n📊 ${testName} 성능 측정 시작 (${iterations}회 반복)...`);
  
  const results = [];
  
  // 워밍업
  for (let i = 0; i < BENCHMARK_CONFIG.warmupIterations; i++) {
    await testFunction();
  }
  
  // 실제 측정
  for (let i = 0; i < iterations; i++) {
    const result = await testFunction();
    results.push(result);
    
    if (result.success) {
      console.log(`  ${i + 1}/${iterations}: ${result.queryTime}ms (${result.count}건)`);
    } else {
      console.log(`  ${i + 1}/${iterations}: 실패 - ${result.error}`);
    }
    
    // 요청 간 딜레이
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  
  // 통계 계산
  const successfulResults = results.filter(r => r.success);
  if (successfulResults.length === 0) {
    return {
      testName,
      success: false,
      error: '모든 테스트 실패',
      results: []
    };
  }
  
  const queryTimes = successfulResults.map(r => r.queryTime);
  const counts = successfulResults.map(r => r.count);
  
  const stats = {
    testName,
    success: true,
    iterations: successfulResults.length,
    avgQueryTime: queryTimes.reduce((a, b) => a + b, 0) / queryTimes.length,
    minQueryTime: Math.min(...queryTimes),
    maxQueryTime: Math.max(...queryTimes),
    avgCount: counts.reduce((a, b) => a + b, 0) / counts.length,
    results: successfulResults
  };
  
  console.log(`✅ ${testName} 완료:`);
  console.log(`   평균 조회시간: ${stats.avgQueryTime.toFixed(2)}ms`);
  console.log(`   최소 조회시간: ${stats.minQueryTime}ms`);
  console.log(`   최대 조회시간: ${stats.maxQueryTime}ms`);
  console.log(`   평균 결과수: ${stats.avgCount.toFixed(0)}건`);
  
  return stats;
}

/**
 * 결과 비교 및 분석
 */
function analyzeResults(blockchainResults, indexResults) {
  console.log('\n' + '='.repeat(80));
  console.log('📈 성능 비교 분석');
  console.log('='.repeat(80));
  
  const comparisons = [];
  
  BENCHMARK_CONFIG.speedThresholds.forEach(speed => {
    const blockchainKey = `blockchain_${speed}`;
    const indexKey = `index_range_${speed}`;
    
    const blockchain = blockchainResults.find(r => r.testName === blockchainKey);
    const index = indexResults.find(r => r.testName === indexKey);
    
    if (blockchain && index && blockchain.success && index.success) {
      const speedup = blockchain.avgQueryTime / index.avgQueryTime;
      const comparison = {
        speedThreshold: speed,
        blockchain: {
          avgTime: blockchain.avgQueryTime,
          avgCount: blockchain.avgCount
        },
        index: {
          avgTime: index.avgQueryTime,
          avgCount: index.avgCount
        },
        speedup: speedup,
        efficiency: speedup > 1 ? '인덱스가 빠름' : '블록체인이 빠름'
      };
      
      comparisons.push(comparison);
      
      console.log(`\n🚀 ${speed}km/h 이상 조회 비교:`);
      console.log(`   블록체인 직접 조회: ${comparison.blockchain.avgTime.toFixed(2)}ms (${comparison.blockchain.avgCount.toFixed(0)}건)`);
      console.log(`   인덱스 범위 조회:   ${comparison.index.avgTime.toFixed(2)}ms (${comparison.index.avgCount.toFixed(0)}건)`);
      console.log(`   성능 향상:         ${speedup.toFixed(2)}배 (${comparison.efficiency})`);
    }
  });
  
  // 전체 평균 성능 향상
  if (comparisons.length > 0) {
    const avgSpeedup = comparisons.reduce((sum, c) => sum + c.speedup, 0) / comparisons.length;
    console.log(`\n📊 전체 평균 성능 향상: ${avgSpeedup.toFixed(2)}배`);
    
    if (avgSpeedup > 1) {
      console.log(`✅ 인덱스 조회가 블록체인 직접 조회보다 평균 ${avgSpeedup.toFixed(2)}배 빠름`);
    } else {
      console.log(`⚠️  블록체인 직접 조회가 인덱스 조회보다 평균 ${(1/avgSpeedup).toFixed(2)}배 빠름`);
    }
  }
  
  return comparisons;
}

/**
 * 결과를 JSON 파일로 저장
 */
function saveResults(blockchainResults, indexResults, comparisons) {
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const filename = `benchmark-results-${timestamp}.json`;
  const filepath = `./scripts/${filename}`;
  
  const results = {
    timestamp: new Date().toISOString(),
    config: BENCHMARK_CONFIG,
    blockchainResults,
    indexResults,
    comparisons,
    summary: {
      totalTests: blockchainResults.length + indexResults.length,
      successfulTests: blockchainResults.filter(r => r.success).length + indexResults.filter(r => r.success).length,
      avgSpeedup: comparisons.length > 0 ? comparisons.reduce((sum, c) => sum + c.speedup, 0) / comparisons.length : 0
    }
  };
  
  fs.writeFileSync(filepath, JSON.stringify(results, null, 2));
  console.log(`\n💾 결과가 저장되었습니다: ${filepath}`);
  
  return filepath;
}

/**
 * 메인 벤치마크 함수
 */
async function main() {
  console.log('\n🚀 블록체인 vs 인덱스 조회 성능 벤치마크 시작');
  console.log('='.repeat(80));
  console.log(`📋 설정:`);
  console.log(`   속도 임계값: ${BENCHMARK_CONFIG.speedThresholds.join(', ')}km/h`);
  console.log(`   반복 횟수: ${BENCHMARK_CONFIG.iterations}회`);
  console.log(`   워밍업: ${BENCHMARK_CONFIG.warmupIterations}회`);
  console.log(`   인덱싱 API: ${INDEXING_API_URL}`);
  
  // 배포 파일 확인
  if (!fs.existsSync(DEPLOYMENT_FILE)) {
    console.error('❌ 배포 정보를 찾을 수 없습니다:', DEPLOYMENT_FILE);
    console.error('먼저 deploy-pvd.js를 실행하세요.');
    process.exit(1);
  }
  
  const deploymentInfo = JSON.parse(fs.readFileSync(DEPLOYMENT_FILE, 'utf8'));
  console.log(`📍 컨트랙트 주소: ${deploymentInfo.contractAddress}\n`);
  
  const blockchainResults = [];
  const indexResults = [];
  
  // 각 속도 임계값에 대해 테스트
  for (const speed of BENCHMARK_CONFIG.speedThresholds) {
    console.log(`\n🔍 ${speed}km/h 이상 데이터 조회 테스트`);
    console.log('-'.repeat(50));
    
    // 블록체인 직접 조회 테스트
    const blockchainTest = () => queryBlockchainBySpeed(speed);
    const blockchainResult = await measurePerformance(
      blockchainTest, 
      `blockchain_${speed}`,
      BENCHMARK_CONFIG.iterations
    );
    blockchainResults.push(blockchainResult);
    
    // 인덱스 범위 조회 테스트
    const indexRangeTest = () => queryIndexBySpeedRange(speed);
    const indexRangeResult = await measurePerformance(
      indexRangeTest,
      `index_range_${speed}`,
      BENCHMARK_CONFIG.iterations
    );
    indexResults.push(indexRangeResult);
    
    // 인덱스 정확 검색 테스트 (특정 속도값)
    const indexExactTest = () => queryIndexByExactSpeed(speed);
    const indexExactResult = await measurePerformance(
      indexExactTest,
      `index_exact_${speed}`,
      BENCHMARK_CONFIG.iterations
    );
    indexResults.push(indexExactResult);
  }
  
  // 결과 분석
  const comparisons = analyzeResults(blockchainResults, indexResults);
  
  // 결과 저장
  const resultFile = saveResults(blockchainResults, indexResults, comparisons);
  
  console.log('\n🎉 벤치마크 완료!');
  console.log(`📄 상세 결과: ${resultFile}`);
  
  // 요약 출력
  console.log('\n📋 요약:');
  console.log(`   총 테스트: ${blockchainResults.length + indexResults.length}개`);
  console.log(`   성공한 테스트: ${blockchainResults.filter(r => r.success).length + indexResults.filter(r => r.success).length}개`);
  
  if (comparisons.length > 0) {
    const avgSpeedup = comparisons.reduce((sum, c) => sum + c.speedup, 0) / comparisons.length;
    console.log(`   평균 성능 향상: ${avgSpeedup.toFixed(2)}배`);
  }
}

// 스크립트 실행
if (require.main === module) {
  main()
    .then(() => process.exit(0))
    .catch((error) => {
      console.error('❌ 벤치마크 실행 실패:', error);
      process.exit(1);
    });
}

module.exports = {
  queryBlockchainBySpeed,
  queryIndexBySpeedRange,
  queryIndexByExactSpeed,
  measurePerformance,
  analyzeResults
};
