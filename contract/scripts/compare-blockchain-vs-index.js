const hre = require("hardhat");
const fs = require("fs");
const path = require("path");

// 설정
const DEPLOYMENT_INFO = require("./pvd-deployment.json");
const CONTRACT_ADDRESS = DEPLOYMENT_INFO.contractAddress;
const INDEXING_API_BASE_URL = process.env.INDEXING_API_URL || "https://grnd.bimatrix.co.kr/bc/idx";
const NETWORK = DEPLOYMENT_INFO.network || "kaia";
const MIN_SPEED = 60; // 비교할 최소 속도

/**
 * 블록체인에서 히스토리 조회 (모든 업데이트 포함)
 */
async function getBlockchainData(contract, minSpeed) {
  console.log(`\n📜 블록체인에서 히스토리 조회 중... (${minSpeed}km/h 이상, 모든 업데이트 포함)`);
  
  const startTime = Date.now();
  
  // 1. 모든 키 목록 가져오기
  console.log(`   키 목록 조회 중...`);
  const allKeys = await contract.getKeyLists();
  console.log(`   총 ${allKeys.length}개 키 발견`);
  
  // 2. 배치로 각 키의 히스토리 조회
  const BATCH_SIZE = 50;  // 히스토리 조회는 더 무거우므로 50개씩
  const allHistory = [];
  const dataMap = new Map();
  let totalHistoryCount = 0;
  let processedCount = 0;
  
  for (let i = 0; i < allKeys.length; i += BATCH_SIZE) {
    const batchKeys = allKeys.slice(i, Math.min(i + BATCH_SIZE, allKeys.length));
    
    // 배치 내 모든 키의 히스토리를 병렬로 조회
    const batchPromises = batchKeys.map(async (key) => {
      try {
        const history = await contract.getHistoryForKey(key);
        return { key, history };
      } catch (error) {
        console.warn(`   ⚠️  키 ${key} 히스토리 조회 실패`);
        return { key, history: [] };
      }
    });
    
    const batchResults = await Promise.all(batchPromises);
    
    // 각 히스토리 항목에 대해 속도 필터링
    batchResults.forEach(({ key, history }) => {
      history.forEach((pvd, idx) => {
        const speed = Number(pvd.speed);
        if (speed >= minSpeed) {
          totalHistoryCount++;
          const dataKey = `${pvd.obuId}_${pvd.collectionDt}`;
          
          // 히스토리의 모든 버전을 배열에 저장
          allHistory.push({
            obuId: pvd.obuId,
            collectionDt: pvd.collectionDt,
            speed: speed,
            blockNumber: Number(pvd.blockNumber),
            latitude: pvd.startvectorLatitude,
            longitude: pvd.startvectorLongitude,
            historyIndex: idx,
            totalVersions: history.length
          });
          
          // dataMap에는 최신 버전만 저장 (마지막 업데이트)
          dataMap.set(dataKey, allHistory[allHistory.length - 1]);
        }
      });
    });
    
    processedCount += batchKeys.length;
    
    // 진행률 표시 (매 500개마다)
    if (processedCount % 500 === 0 || processedCount === allKeys.length) {
      const progress = (processedCount / allKeys.length * 100).toFixed(1);
      console.log(`   진행: ${processedCount}/${allKeys.length} (${progress}%) | 히스토리: ${totalHistoryCount}건 | 고유: ${dataMap.size}건`);
    }
    
    // 배치 간 짧은 대기 (RPC 서버 부하 방지)
    if (i + BATCH_SIZE < allKeys.length) {
      await new Promise(resolve => setTimeout(resolve, 100));
    }
  }
  
  const queryTime = Date.now() - startTime;
  console.log(`✅ 블록체인 히스토리 조회 완료 (${queryTime}ms)`);
  console.log(`   전체 키: ${allKeys.length}개`);
  console.log(`   전체 히스토리 (${minSpeed}km/h 이상): ${totalHistoryCount}건`);
  console.log(`   고유 키 (${minSpeed}km/h 이상): ${dataMap.size}건`);
  console.log(`   업데이트 횟수: ${totalHistoryCount - dataMap.size}건\n`);
  
  return {
    count: totalHistoryCount,         // 모든 히스토리 포함
    uniqueCount: dataMap.size,        // 고유 키 개수
    duplicateCount: totalHistoryCount - dataMap.size,  // 업데이트 횟수
    queryTime: queryTime,
    dataMap: dataMap,
    allHistory: allHistory
  };
}

/**
 * 인덱스에서 데이터 조회
 */
async function getIndexData(minSpeed) {
  console.log(`📇 인덱스에서 데이터 조회 중... (${minSpeed}km/h 이상)`);
  
  const startTime = Date.now();
  
  try {
    const response = await fetch(`${INDEXING_API_BASE_URL}/api/pvd/speeding/by-index`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        minSpeed: minSpeed,
        network: NETWORK
      })
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    const result = await response.json();
    
    if (!result.success) {
      throw new Error(result.error || '데이터 조회 실패');
    }

    const queryTime = Date.now() - startTime;
    
    // 디버깅: 첫 번째 데이터 구조 출력
    if (result.data?.features && result.data.features.length > 0) {
      console.log(`\n   🔍 첫 번째 데이터 구조 확인:`);
      const first = result.data.features[0];
      console.log(`   - Type: ${first.type}`);
      console.log(`   - Geometry:`, JSON.stringify(first.geometry).substring(0, 100));
      console.log(`   - Properties:`, JSON.stringify(first.properties).substring(0, 200));
    }
    
    // obuId + collectionDt를 키로 하는 Map 생성
    const dataMap = new Map();
    const duplicates = [];
    const invalidData = [];
    
    if (result.data?.features) {
      result.data.features.forEach((feature, idx) => {
        const props = feature.properties;
        
        // 데이터 유효성 검사
        if (!props || !props.obuId || !props.collectionDt) {
          invalidData.push(idx);
          return;
        }
        
        const key = `${props.obuId}_${props.collectionDt}`;
        
        // 중복 체크
        if (dataMap.has(key)) {
          duplicates.push(key);
        }
        
        dataMap.set(key, {
          obuId: props.obuId,
          collectionDt: props.collectionDt,
          speed: Number(props.speed),
          blockNumber: Number(props.blockNumber),
          latitude: feature.geometry.coordinates[1],
          longitude: feature.geometry.coordinates[0]
        });
      });
    }
    
    if (invalidData.length > 0) {
      console.log(`   ⚠️  유효하지 않은 데이터: ${invalidData.length}건`);
    }
    
    console.log(`✅ 인덱스 조회 완료: ${result.data?.features?.length || 0}건 (${queryTime}ms)`);
    console.log(`   고유 데이터: ${dataMap.size}건`);
    console.log(`   중복 데이터: ${duplicates.length}건\n`);
    
    return {
      count: result.data?.features?.length || 0,
      uniqueCount: dataMap.size,
      duplicateCount: duplicates.length,
      duplicates: duplicates,
      queryTime: queryTime,
      dataMap: dataMap
    };
    
  } catch (error) {
    console.error(`❌ 인덱스 조회 실패:`, error.message);
    return {
      count: 0,
      uniqueCount: 0,
      duplicateCount: 0,
      duplicates: [],
      queryTime: 0,
      dataMap: new Map()
    };
  }
}

/**
 * 메인 함수
 */
async function main() {
  console.log("🔍 블록체인 vs 인덱스 데이터 비교");
  console.log("=".repeat(70));
  console.log(`📊 설정:`);
  console.log(`   - 컨트랙트 주소: ${CONTRACT_ADDRESS}`);
  console.log(`   - 네트워크: ${NETWORK}`);
  console.log(`   - 최소 속도: ${MIN_SPEED}km/h`);
  console.log(`   - 인덱싱 API: ${INDEXING_API_BASE_URL}`);
  console.log("=".repeat(70));

  try {
    // 1. 컨트랙트 연결
    const [signer] = await hre.ethers.getSigners();
    const contract = await hre.ethers.getContractAt("PvdRecord", CONTRACT_ADDRESS, signer);
    
    console.log(`\n📡 컨트랙트 연결 완료`);
    console.log(`   서명자: ${await signer.getAddress()}`);
    console.log(`   네트워크: ${hre.network.name}`);

    // 2. 블록체인 데이터 조회
    const blockchainResult = await getBlockchainData(contract, MIN_SPEED);

    // 3. 인덱스 데이터 조회
    const indexResult = await getIndexData(MIN_SPEED);

    // 4. 비교 분석
    console.log("=".repeat(70));
    console.log("📊 비교 결과");
    console.log("=".repeat(70));
    
    console.log(`\n📈 개수 비교 (${MIN_SPEED}km/h 이상):`);
    console.log(`   블록체인 히스토리 (전체): ${blockchainResult.count}건`);
    console.log(`   블록체인 히스토리 (고유): ${blockchainResult.uniqueCount}건`);
    console.log(`   블록체인 업데이트 횟수:   ${blockchainResult.duplicateCount}건`);
    console.log(`   인덱스 (전체):           ${indexResult.count}건`);
    console.log(`   인덱스 (고유):           ${indexResult.uniqueCount}건`);
    
    const diff = indexResult.count - blockchainResult.count;
    console.log(`\n📊 차이 분석:`);
    console.log(`   인덱스 - 블록체인 히스토리 = ${diff}건`);
    
    if (diff > 0) {
      console.log(`   → 인덱스가 ${diff}건 더 많음`);
    } else if (diff < 0) {
      console.log(`   → 블록체인이 ${Math.abs(diff)}건 더 많음`);
    } else {
      console.log(`   → 완벽하게 일치!`);
    }

    // 5. 중복 데이터 분석
    if (indexResult.duplicateCount > 0) {
      console.log(`\n⚠️  인덱스 중복 데이터 발견: ${indexResult.duplicateCount}건`);
      console.log(`   중복 제거 후: ${indexResult.uniqueCount}건`);
      
      if (indexResult.duplicates.length > 0) {
        console.log(`\n   중복 예시 (최대 5개):`);
        indexResult.duplicates.slice(0, 5).forEach((dup, idx) => {
          console.log(`   ${idx + 1}. ${dup}`);
        });
      }
    }

    // 6. 누락/추가 데이터 분석
    console.log(`\n🔍 상세 비교:`);
    
    // 블록체인에는 있지만 인덱스에는 없는 데이터
    const missingInIndex = [];
    blockchainResult.dataMap.forEach((data, key) => {
      if (!indexResult.dataMap.has(key)) {
        missingInIndex.push(key);
      }
    });
    
    // 인덱스에는 있지만 블록체인에는 없는 데이터
    const extraInIndex = [];
    indexResult.dataMap.forEach((data, key) => {
      if (!blockchainResult.dataMap.has(key)) {
        extraInIndex.push(key);
      }
    });
    
    console.log(`   블록체인에만 있음: ${missingInIndex.length}건`);
    console.log(`   인덱스에만 있음:   ${extraInIndex.length}건`);
    console.log(`   공통:             ${blockchainResult.dataMap.size - missingInIndex.length}건`);

    if (missingInIndex.length > 0) {
      console.log(`\n   📋 블록체인에만 있는 데이터 (최대 5개):`);
      missingInIndex.slice(0, 5).forEach((key, idx) => {
        const data = blockchainResult.dataMap.get(key);
        console.log(`   ${idx + 1}. ${key}`);
        console.log(`      속도: ${data.speed}km/h, 블록: #${data.blockNumber}`);
      });
    }

    if (extraInIndex.length > 0) {
      console.log(`\n   📋 인덱스에만 있는 데이터 (최대 5개):`);
      extraInIndex.slice(0, 5).forEach((key, idx) => {
        const data = indexResult.dataMap.get(key);
        console.log(`   ${idx + 1}. ${key}`);
        console.log(`      속도: ${data.speed}km/h, 블록: #${data.blockNumber}`);
      });
    }

    // 7. 성능 비교
    console.log(`\n⚡ 성능 비교:`);
    console.log(`   블록체인 조회 시간: ${blockchainResult.queryTime}ms`);
    console.log(`   인덱스 조회 시간:   ${indexResult.queryTime}ms`);
    
    if (indexResult.queryTime > 0) {
      const speedup = blockchainResult.queryTime / indexResult.queryTime;
      console.log(`   성능 향상:         ${speedup.toFixed(2)}배`);
    }

    // 8. 결론
    console.log(`\n💡 결론:`);
    if (diff === 0) {
      console.log(`   ✅ 블록체인 히스토리와 인덱스가 완벽하게 일치!`);
      console.log(`   ✅ 인덱싱이 정상적으로 작동하고 있습니다.`);
      console.log(`   📊 ${blockchainResult.duplicateCount}건의 업데이트가 모두 인덱싱됨`);
    } else if (Math.abs(diff) <= 10) {
      console.log(`   ✅ 거의 일치 (차이: ${Math.abs(diff)}건, ${(Math.abs(diff) / blockchainResult.count * 100).toFixed(2)}%)`);
      console.log(`   💡 소수의 누락/추가는 정상 범위입니다.`);
    } else {
      console.log(`   ⚠️  블록체인과 인덱스 간 차이 존재 (${Math.abs(diff)}건)`);
      if (missingInIndex.length > 0) {
        console.log(`   💡 ${missingInIndex.length}건이 인덱싱되지 않음 → 재인덱싱 필요`);
      }
      if (extraInIndex.length > 0) {
        console.log(`   💡 ${extraInIndex.length}건이 블록체인에 없음 → 잘못된 인덱싱`);
      }
    }
    
    console.log(`\n📝 요약:`);
    console.log(`   블록체인: ${blockchainResult.uniqueCount}개의 고유 키, ${blockchainResult.count}개의 히스토리`);
    console.log(`   인덱스:   ${indexResult.count}개의 트랜잭션 인덱싱`);
    console.log(`   업데이트: ${blockchainResult.duplicateCount}번`)

    console.log("\n=".repeat(70));
    console.log("✅ 비교 완료!");
    console.log("=".repeat(70));

  } catch (error) {
    console.error("\n❌ 스크립트 실행 실패:", error.message);
    if (error.stack) {
      console.error(error.stack);
    }
    process.exit(1);
  }
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });

