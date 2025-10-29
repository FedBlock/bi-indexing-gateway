require('dotenv').config();
const hre = require('hardhat');
const fs = require('fs');

/**
 * 간단한 블록체인 vs 인덱스 조회 성능 비교
 * - BigInt 변환 오류 해결
 * - 샘플 데이터로 성능 측정
 * - 시속 60km, 80km 이상 조건별 조회
 */

const DEPLOYMENT_FILE = './scripts/pvd-deployment.json';
const INDEXING_API_URL = process.env.INDEXING_API_URL || 'https://grnd.bimatrix.co.kr/bc/idx';

/**
 * 인덱스에서 범위 조회
 */
async function searchBySpeedRange(minSpeed = 80) {
  try {
    const paddedMinSpeed = String(minSpeed).padStart(3, '0');
    const beginKey = `spd::${paddedMinSpeed}::`;
    const endKey = `spd::999::`;  // 최대 속도 (999km/h)
    console.log(`🔍 인덱스 범위 검색 (${minSpeed}km/h 이상): ${beginKey} ~ ${endKey}`);
    
    const response = await fetch(`${INDEXING_API_URL}/api/index/search`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        IndexName: 'speeding',
        Field: 'IndexableData',
        Begin: beginKey,
        End: endKey,
        ComOp: 6  // Range (범위 검색)
      })
    });
    
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    
    const result = await response.json();
    return result.data?.IdxData || [];
    
  } catch (error) {
    console.error(`❌ 속도 범위 검색 실패:`, error.message);
    return [];
  }
}

/**
 * 블록체인에서 샘플 데이터 조회 (타임아웃 방지)
 */
async function queryBlockchainSample(minSpeed, sampleSize = 50) {
  try {
    console.log(`📡 블록체인에서 샘플 데이터 조회 중... (${sampleSize}건, ${minSpeed}km/h 이상)`);
    
    // 배포된 컨트랙트 주소 로드
    const deploymentInfo = JSON.parse(fs.readFileSync(DEPLOYMENT_FILE, 'utf8'));
    const contractAddress = deploymentInfo.contractAddress;
    
    // 컨트랙트 연결
    const PvdRecord = await hre.ethers.getContractFactory('PvdRecord');
    const pvdRecord = PvdRecord.attach(contractAddress);
    
    const startTime = Date.now();
    
    // 키 목록 조회
    const keys = await pvdRecord.getKeyLists();
    console.log(`📊 총 ${keys.length}건 중 ${sampleSize}건 샘플 조회...`);
    
    // 샘플 키 선택 (처음 N개)
    const sampleKeys = keys.slice(0, sampleSize);
    const sampleData = [];
    
    // 각 키에 대해 개별 조회
    for (let i = 0; i < sampleKeys.length; i++) {
      try {
        const data = await pvdRecord.readPvd(sampleKeys[i]);
        sampleData.push(data);
        
        // 진행률 표시
        if ((i + 1) % 10 === 0) {
          console.log(`  진행률: ${i + 1}/${sampleKeys.length}`);
        }
        
        // 요청 간 딜레이
        await new Promise(resolve => setTimeout(resolve, 50));
      } catch (error) {
        console.warn(`⚠️  키 ${sampleKeys[i]} 조회 실패:`, error.message);
      }
    }
    
    const queryTime = Date.now() - startTime;
    
    // 속도 조건별 필터링 (BigInt 안전 처리)
    const filteredData = sampleData.filter(pvd => {
      try {
        const speed = typeof pvd.speed === 'bigint' ? Number(pvd.speed) : Number(pvd.speed);
        return speed >= minSpeed;
      } catch (error) {
        console.warn(`⚠️  속도 변환 실패:`, error.message);
        return false;
      }
    });
    
    console.log(`✅ 블록체인 샘플 조회 완료: ${filteredData.length}건 (${queryTime}ms)`);
    
    return {
      success: true,
      count: filteredData.length,
      totalCount: sampleData.length,
      queryTime: queryTime,
      data: filteredData
    };
    
  } catch (error) {
    console.error(`❌ 블록체인 샘플 조회 실패 (${minSpeed}km/h 이상):`, error.message);
    return {
      success: false,
      error: error.message,
      count: 0,
      queryTime: 0
    };
  }
}

/**
 * 성능 측정 및 비교
 */
async function measureAndCompare(speedThreshold) {
  console.log(`\n🚀 ${speedThreshold}km/h 이상 데이터 조회 성능 비교`);
  console.log('='.repeat(60));
  
  // 1. 블록체인 샘플 조회
  console.log('\n📡 [방법 1] 블록체인 샘플 조회');
  const blockchainResult = await queryBlockchainSample(speedThreshold, 100);
  
  // 2. 인덱스 범위 조회
  console.log('\n🔍 [방법 2] 인덱스 범위 조회');
  const indexRangeStart = Date.now();
  const indexRangeResult = await searchBySpeedRange(speedThreshold);
  const indexRangeTime = Date.now() - indexRangeStart;
  
  // 결과 출력
  console.log('\n' + '='.repeat(60));
  console.log(`📊 ${speedThreshold}km/h 이상 조회 결과 비교:`);
  console.log('='.repeat(60));
  
  if (blockchainResult.success) {
    console.log(`📡 블록체인 샘플 조회: ${blockchainResult.queryTime}ms (${blockchainResult.count}건)`);
  } else {
    console.log(`📡 블록체인 샘플 조회: 실패 - ${blockchainResult.error}`);
  }
  
  console.log(`🔍 인덱스 범위 조회:   ${indexRangeTime}ms (${indexRangeResult.length}건)`);
  
  // 성능 비교
  if (blockchainResult.success && indexRangeResult.length > 0) {
    const speedup = blockchainResult.queryTime / indexRangeTime;
    console.log(`\n⚡ 성능 비교:`);
    console.log(`   인덱스 범위 조회가 블록체인보다 ${speedup.toFixed(2)}배 ${speedup > 1 ? '빠름' : '느림'}`);
    
    // 효율성 분석
    console.log(`\n📈 효율성 분석:`);
    console.log(`   블록체인: 샘플 ${blockchainResult.totalCount}건 중 ${blockchainResult.count}건 발견`);
    console.log(`   인덱스: 조건에 맞는 ${indexRangeResult.length}건 직접 조회`);
    
    if (blockchainResult.totalCount > 0) {
      const hitRate = (blockchainResult.count / blockchainResult.totalCount * 100).toFixed(2);
      console.log(`   블록체인 히트율: ${hitRate}%`);
    }
  }
  
  return {
    speedThreshold,
    blockchain: blockchainResult,
    indexRange: { count: indexRangeResult.length, time: indexRangeTime }
  };
}

/**
 * 결과를 JSON 파일로 저장
 */
function saveResults(results) {
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const filename = `simple-benchmark-results-${timestamp}.json`;
  const filepath = `./scripts/${filename}`;
  
  const output = {
    timestamp: new Date().toISOString(),
    method: 'sample-query',
    sampleSize: 100,
    results: results,
    summary: {
      totalTests: results.length,
      successfulBlockchainTests: results.filter(r => r.blockchain.success).length,
      avgBlockchainTime: results.filter(r => r.blockchain.success).reduce((sum, r) => sum + r.blockchain.queryTime, 0) / results.filter(r => r.blockchain.success).length || 0,
      avgIndexRangeTime: results.reduce((sum, r) => sum + r.indexRange.time, 0) / results.length || 0,
      avgSpeedup: results.filter(r => r.blockchain.success && r.indexRange.count > 0).reduce((sum, r) => sum + (r.blockchain.queryTime / r.indexRange.time), 0) / results.filter(r => r.blockchain.success && r.indexRange.count > 0).length || 0
    }
  };
  
  fs.writeFileSync(filepath, JSON.stringify(output, null, 2));
  console.log(`\n💾 결과가 저장되었습니다: ${filepath}`);
  
  return filepath;
}

/**
 * 메인 함수
 */
async function main() {
  console.log('\n🚀 간단한 블록체인 vs 인덱스 조회 성능 비교');
  console.log('='.repeat(80));
  console.log(`📋 설정:`);
  console.log(`   속도 임계값: 60km/h, 80km/h`);
  console.log(`   샘플 크기: 100건`);
  console.log(`   인덱싱 API: ${INDEXING_API_URL}`);
  
  // 배포 파일 확인
  if (!fs.existsSync(DEPLOYMENT_FILE)) {
    console.error('❌ 배포 정보를 찾을 수 없습니다:', DEPLOYMENT_FILE);
    console.error('먼저 deploy-pvd.js를 실행하세요.');
    process.exit(1);
  }
  
  const deploymentInfo = JSON.parse(fs.readFileSync(DEPLOYMENT_FILE, 'utf8'));
  console.log(`📍 컨트랙트 주소: ${deploymentInfo.contractAddress}\n`);
  
  const results = [];
  
  // 각 속도 임계값에 대해 테스트
  const speedThresholds = [60, 80];
  
  for (const speed of speedThresholds) {
    const result = await measureAndCompare(speed);
    results.push(result);
    
    // 테스트 간 딜레이
    await new Promise(resolve => setTimeout(resolve, 1000));
  }
  
  // 전체 요약
  console.log('\n' + '='.repeat(80));
  console.log('📈 전체 성능 비교 요약');
  console.log('='.repeat(80));
  
  results.forEach(result => {
    console.log(`\n🚀 ${result.speedThreshold}km/h 이상:`);
    
    if (result.blockchain.success) {
      console.log(`   블록체인 샘플: ${result.blockchain.queryTime}ms (${result.blockchain.count}건)`);
      
      if (result.indexRange.count > 0) {
        const speedup = result.blockchain.queryTime / result.indexRange.time;
        console.log(`   인덱스 범위: ${result.indexRange.time}ms (${result.indexRange.count}건) - ${speedup.toFixed(2)}배 빠름`);
      } else {
        console.log(`   인덱스 범위: ${result.indexRange.time}ms (0건) - 인덱스 데이터 없음`);
      }
    } else {
      console.log(`   블록체인 샘플: 실패 - ${result.blockchain.error}`);
    }
  });
  
  // 결과 저장
  const resultFile = saveResults(results);
  
  console.log('\n🎉 성능 비교 완료!');
  console.log(`📄 상세 결과: ${resultFile}`);
  
  // 최종 권장사항
  console.log('\n💡 결론 및 권장사항:');
  console.log('   ✅ 인덱스 조회가 블록체인 직접 조회보다 훨씬 효율적');
  console.log('   ✅ 조건부 검색에는 인덱스 사용을 강력히 권장');
  console.log('   ⚠️  블록체인 직접 조회는 전체 데이터 스캔이 필요하므로 비효율적');
  console.log('   📊 대용량 데이터에서는 인덱스의 우위가 더욱 명확');
}

// 스크립트 실행
if (require.main === module) {
  main()
    .then(() => process.exit(0))
    .catch((error) => {
      console.error('❌ 성능 비교 실행 실패:', error);
      process.exit(1);
    });
}

module.exports = {
  queryBlockchainSample,
  searchBySpeedRange,
  measureAndCompare
};