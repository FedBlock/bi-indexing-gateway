require('dotenv').config();
const hre = require('hardhat');
const fs = require('fs');

/**
 * 과속 데이터 조회 스크립트
 * - 블록체인 직접 조회
 * - 인덱싱 API를 통한 조회
 */

const DEPLOYMENT_FILE = './scripts/pvd-deployment.json';
const INDEXING_API_URL = process.env.INDEXING_API_URL || 'https://grnd.bimatrix.co.kr/bc/idx';

/**
 * 인덱싱 API를 통한 검색 (새 키 형식)
 */
async function searchByIndex(obuId, collectionDt, speed) {
  try {
    // 새 키 형식: spd::{speed}::{obuId}::{collectionDt}
    const paddedSpeed = String(speed).padStart(3, '0');
    const searchKey = `spd::${paddedSpeed}::${obuId}::${collectionDt}`;
    console.log(`🔍 인덱스 검색: ${searchKey}`);
    
    const response = await fetch(`${INDEXING_API_URL}/api/index/search`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        IndexName: 'speeding',
        Field: 'IndexableData',
        Value: searchKey,
        ComOp: 0  // Eq (Equal)
      })
    });
    
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    
    const result = await response.json();
    return result.data?.IdxData || [];
    
  } catch (error) {
    console.error(`❌ 인덱스 검색 실패:`, error.message);
    return [];
  }
}

/**
 * 속도 범위 검색 (80km/h 이상)
 */
async function searchBySpeedRange(minSpeed = 80) {
  try {
    const paddedMinSpeed = String(minSpeed).padStart(3, '0');
    const searchKey = `spd::${paddedMinSpeed}::`;
    console.log(`🔍 속도 범위 검색 (${minSpeed}km/h 이상): ${searchKey}`);
    
    const response = await fetch(`${INDEXING_API_URL}/api/index/search`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        IndexName: 'speeding',
        Field: 'IndexableData',
        Value: searchKey,
        ComOp: 4  // Greater (80km/h 이상)
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
 * 특정 차량의 과속 데이터 검색
 */
async function searchByVehicle(obuId) {
  try {
    const searchKey = `spd::060::${obuId}::`;  // 60km/h 이상
    console.log(`🔍 차량별 검색: ${searchKey}`);
    
    const response = await fetch(`${INDEXING_API_URL}/api/index/search`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        IndexName: 'speeding',
        Field: 'IndexableData',
        Value: searchKey,
        ComOp: 5  // GreaterThanEq (60km/h 이상)
      })
    });
    
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    
    const result = await response.json();
    return result.data?.IdxData || [];
    
  } catch (error) {
    console.error(`❌ 차량별 검색 실패:`, error.message);
    return [];
  }
}

async function main() {
  console.log('\n🔍 과속 데이터 조회 시작...\n');
  console.log('=' .repeat(80));
  
  // 배포된 컨트랙트 주소 로드
  if (!fs.existsSync(DEPLOYMENT_FILE)) {
    console.error('❌ 배포 정보를 찾을 수 없습니다:', DEPLOYMENT_FILE);
    console.error('먼저 deploy-pvd.js를 실행하세요.');
    process.exit(1);
  }
  
  const deploymentInfo = JSON.parse(fs.readFileSync(DEPLOYMENT_FILE, 'utf8'));
  const contractAddress = deploymentInfo.contractAddress;
  
  console.log(`📍 컨트랙트 주소: ${contractAddress}`);
  console.log(`🔗 인덱싱 API: ${INDEXING_API_URL}\n`);
  
  // 컨트랙트 연결
  const PvdRecord = await hre.ethers.getContractFactory('PvdRecord');
  const pvdRecord = PvdRecord.attach(contractAddress);
  
  // ==========================================
  // 1. 블록체인 직접 조회
  // ==========================================
  console.log('📡 [방법 1] 블록체인에서 직접 조회 중...\n');
  const startTime1 = Date.now();
  
  const allPvdData = await pvdRecord.getPvdWorldStates();
  const queryTime1 = Date.now() - startTime1;
  
  console.log(`✅ 총 ${allPvdData.length}건의 PVD 데이터 조회 완료 (${queryTime1}ms)\n`);
  
  // 과속 데이터만 필터링 (speed > 80 km/h)
  const speedingData = allPvdData.filter(pvd => Number(pvd.speed) > 80);
  
  console.log(`🚨 과속 데이터: ${speedingData.length}건 (80km/h 초과)\n`);
  
  // 60km/h 이상 데이터도 확인
  const speedingData60 = allPvdData.filter(pvd => Number(pvd.speed) >= 60);
  console.log(`🚨 과속 데이터: ${speedingData60.length}건 (60km/h 이상)\n`);
  
  // ==========================================
  // 2. 인덱싱 API를 통한 특정 차량 검색
  // ==========================================
  if (speedingData.length > 0) {
    console.log('=' .repeat(80));
    console.log('\n🔍 [방법 2] 인덱싱 API를 통한 특정 차량 검색\n');
    
    // 첫 번째 과속 데이터로 테스트
    const testData = speedingData[0];
    console.log(`🎯 테스트 대상: ${testData.obuId} (${testData.collectionDt})`);
    
    const startTime2 = Date.now();
    const txIds = await searchByIndex(testData.obuId, testData.collectionDt, testData.speed);
    const queryTime2 = Date.now() - startTime2;
    
    console.log(`✅ 인덱스 검색 완료: ${txIds.length}건 발견 (${queryTime2}ms)\n`);
    
    if (txIds.length > 0) {
      console.log(`📋 트랜잭션 ID 목록:`);
      txIds.slice(0, 5).forEach((txId, i) => {
        console.log(`  ${i + 1}. ${txId}`);
      });
      if (txIds.length > 5) {
        console.log(`  ... 외 ${txIds.length - 5}개`);
      }
    }
    
    // 성능 비교
    console.log('\n' + '='.repeat(80));
    console.log('\n⚡ 성능 비교:');
    console.log(`  블록체인 직접 조회: ${queryTime1}ms (전체 ${allPvdData.length}건 스캔)`);
    console.log(`  인덱싱 API 조회:    ${queryTime2}ms (특정 키 검색)`);
    console.log(`  속도 향상:          ${(queryTime1 / queryTime2).toFixed(2)}배`);
    
    // 추가 성능 비교 (60km/h, 80km/h 이상)
    console.log('\n📊 조건별 성능 비교:');
    console.log(`  80km/h 이상 - 블록체인: ${queryTime1}ms (${speedingData.length}건)`);
    console.log(`  80km/h 이상 - 인덱스:   ${queryTime3}ms (${speedRangeData.length}건)`);
    if (queryTime3 > 0) {
      console.log(`  80km/h 이상 속도 향상: ${(queryTime1 / queryTime3).toFixed(2)}배`);
    }
    
    console.log(`  60km/h 이상 - 블록체인: ${queryTime1}ms (${speedingData60.length}건)`);
    console.log(`  60km/h 이상 - 인덱스:   ${queryTime5}ms (${speedRangeData60.length}건)`);
    if (queryTime5 > 0) {
      console.log(`  60km/h 이상 속도 향상: ${(queryTime1 / queryTime5).toFixed(2)}배`);
    }
    
    // ==========================================
    // 3. 새로운 검색 기능 테스트
    // ==========================================
    console.log('\n' + '='.repeat(80));
    console.log('\n🔍 [방법 3] 새로운 검색 기능 테스트\n');
    
    // 80km/h 이상 검색
    console.log('📊 80km/h 이상 과속 데이터 검색...');
    const startTime3 = Date.now();
    const speedRangeData = await searchBySpeedRange(80);
    const queryTime3 = Date.now() - startTime3;
    console.log(`✅ 속도 범위 검색 완료: ${speedRangeData.length}건 발견 (${queryTime3}ms)\n`);
    
    // 60km/h 이상 검색도 테스트
    console.log('📊 60km/h 이상 과속 데이터 검색...');
    const startTime5 = Date.now();
    const speedRangeData60 = await searchBySpeedRange(60);
    const queryTime5 = Date.now() - startTime5;
    console.log(`✅ 60km/h 이상 검색 완료: ${speedRangeData60.length}건 발견 (${queryTime5}ms)\n`);
    
    // 특정 차량 검색
    if (speedingData.length > 0) {
      const testVehicle = speedingData[0].obuId;
      console.log(`🚗 특정 차량(${testVehicle})의 과속 데이터 검색...`);
      const startTime4 = Date.now();
      const vehicleData = await searchByVehicle(testVehicle);
      const queryTime4 = Date.now() - startTime4;
      console.log(`✅ 차량별 검색 완료: ${vehicleData.length}건 발견 (${queryTime4}ms)\n`);
    }
  }
  
  console.log('\n' + '='.repeat(80));
  
  // 과속 데이터 출력 (처음 10개만)
  if (speedingData.length > 0) {
    console.log('\n📊 과속 데이터 샘플 (처음 10개):\n');
    
    speedingData.slice(0, 10).forEach((pvd, index) => {
      console.log(`[${index + 1}] 차량 ID: ${pvd.obuId}`);
      console.log(`  🚗 속도: ${pvd.speed} km/h`);
      console.log(`  📍 위치: (${pvd.startvectorLatitude}, ${pvd.startvectorLongitude})`);
      console.log(`  📅 수집시간: ${pvd.collectionDt}`);
      console.log(`  🔢 블록번호: ${pvd.blockNumber}`);
      console.log(`  ⏰ 타임스탬프: ${pvd.timestamp}\n`);
    });
    
    if (speedingData.length > 10) {
      console.log(`... 외 ${speedingData.length - 10}건`);
    }
    
    console.log('\n' + '='.repeat(80));
    
    // 통계 출력
    const speeds = speedingData.map(pvd => Number(pvd.speed));
    const maxSpeed = Math.max(...speeds);
    const minSpeed = Math.min(...speeds);
    const avgSpeed = (speeds.reduce((a, b) => a + b, 0) / speeds.length).toFixed(2);
    
    console.log('\n📊 과속 통계:');
    console.log(`  최고 속도: ${maxSpeed} km/h`);
    console.log(`  최저 속도: ${minSpeed} km/h`);
    console.log(`  평균 속도: ${avgSpeed} km/h`);
    
    // 차량별 그룹화
    const vehicleStats = {};
    speedingData.forEach(pvd => {
      const obuId = pvd.obuId;
      if (!vehicleStats[obuId]) {
        vehicleStats[obuId] = {
          count: 0,
          speeds: []
        };
      }
      vehicleStats[obuId].count++;
      vehicleStats[obuId].speeds.push(Number(pvd.speed));
    });
    
    console.log('\n🚙 차량별 과속 횟수:');
    Object.entries(vehicleStats).forEach(([obuId, stats]) => {
      const maxVehicleSpeed = Math.max(...stats.speeds);
      console.log(`  ${obuId}: ${stats.count}회 (최고 ${maxVehicleSpeed} km/h)`);
    });
    
    // GeoJSON 파일로 저장
    const geoJSON = {
      type: 'FeatureCollection',
      features: speedingData.map(pvd => ({
        type: 'Feature',
        geometry: {
          type: 'Point',
          coordinates: [
            parseFloat(pvd.startvectorLongitude),
            parseFloat(pvd.startvectorLatitude)
          ]
        },
        properties: {
          obuId: pvd.obuId,
          speed: Number(pvd.speed),
          collectionDt: pvd.collectionDt,
          timestamp: Number(pvd.timestamp),
          blockNumber: Number(pvd.blockNumber),
          heading: Number(pvd.startvectorHeading)
        }
      }))
    };
    
    const outputFile = './scripts/speeding-data.geojson';
    fs.writeFileSync(outputFile, JSON.stringify(geoJSON, null, 2));
    console.log(`\n💾 GeoJSON 파일 저장: ${outputFile}`);
    
  } else {
    console.log('\n⚠️  과속 데이터가 없습니다.');
  }
  
  console.log('\n✅ 조회 완료!\n');
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error('\n❌ 에러 발생:', error);
    process.exit(1);
  });

