const hre = require("hardhat");

// 설정
const DEPLOYMENT_INFO = require("./pvd-deployment.json");
const CONTRACT_ADDRESS = DEPLOYMENT_INFO.contractAddress;
const INDEXING_API_BASE_URL = process.env.INDEXING_API_URL || "http://localhost:3001";
const NETWORK = DEPLOYMENT_INFO.network || "kaia";
const SPEED_LIMIT_INDEXING = 60; // 인덱싱 기준

/**
 * 블록체인에서 최근 N개 PVD 이벤트 조회
 */
async function getRecentBlockchainEvents(contract, count = 20) {
  console.log(`🔍 블록체인에서 최근 ${count}개 이벤트 조회 중...\n`);
  
  try {
    const filter = contract.filters.PvdUpdated();
    const events = await contract.queryFilter(filter);
    
    // 블록 번호 기준 최신순 정렬
    const sorted = events.sort((a, b) => b.blockNumber - a.blockNumber);
    const recent = sorted.slice(0, count);
    
    console.log(`✅ 블록체인 총 이벤트: ${events.length}개`);
    console.log(`✅ 최근 ${count}개 이벤트 추출 완료\n`);
    
    return recent.map(event => ({
      txHash: event.transactionHash,
      blockNumber: event.blockNumber,
      obuId: event.args.pvd.obuId,
      collectionDt: event.args.pvd.collectionDt,
      speed: parseInt(event.args.pvd.speed),
      latitude: event.args.pvd.startvectorLatitude,
      longitude: event.args.pvd.startvectorLongitude
    }));
  } catch (error) {
    console.error("❌ 블록체인 이벤트 조회 실패:", error.message);
    return [];
  }
}

/**
 * 인덱스에서 저장된 모든 데이터 조회
 */
async function getIndexedData() {
  console.log("🔍 인덱스에서 저장된 데이터 조회 중...\n");
  
  try {
    const response = await fetch(`${INDEXING_API_BASE_URL}/api/pvd/speeding/by-index`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        minSpeed: 0,  // 모든 데이터 조회
        network: NETWORK
      })
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    const result = await response.json();
    
    if (!result.success) {
      throw new Error(result.error || '데이터 조회 실패');
    }

    // Map으로 변환 (key: obuId_collectionDt)
    const indexedMap = new Map();
    
    if (result.data?.features) {
      result.data.features.forEach(feature => {
        const props = feature.properties;
        const key = `${props.obuId}_${props.collectionDt}`;
        indexedMap.set(key, {
          obuId: props.obuId,
          collectionDt: props.collectionDt,
          speed: parseInt(props.speed),
          blockNumber: parseInt(props.blockNumber),
          latitude: feature.geometry.coordinates[1],
          longitude: feature.geometry.coordinates[0]
        });
      });
    }
    
    console.log(`✅ 인덱스에 저장된 데이터: ${indexedMap.size}개\n`);
    
    return indexedMap;
  } catch (error) {
    console.error("❌ 인덱스 데이터 조회 실패:", error.message);
    return new Map();
  }
}

/**
 * 블록체인과 인덱스 최신 데이터 비교
 */
function compareData(blockchainEvents, indexedMap) {
  console.log("=".repeat(70));
  console.log("📊 블록체인 vs 인덱스 비교 결과\n");
  
  const missing = [];
  const matched = [];
  
  for (const event of blockchainEvents) {
    const key = `${event.obuId}_${event.collectionDt}`;
    const isIndexed = indexedMap.has(key);
    const shouldBeIndexed = event.speed >= SPEED_LIMIT_INDEXING;
    
    if (shouldBeIndexed && !isIndexed) {
      missing.push(event);
    } else if (isIndexed) {
      matched.push(event);
    }
  }
  
  return { missing, matched };
}

/**
 * 메인 함수
 */
async function main() {
  console.log("🔍 블록체인 <-> 인덱스 동기화 상태 확인\n");
  console.log("=".repeat(70));
  console.log(`📊 설정:`);
  console.log(`   - 컨트랙트 주소: ${CONTRACT_ADDRESS}`);
  console.log(`   - 네트워크: ${NETWORK}`);
  console.log(`   - 인덱싱 기준: ${SPEED_LIMIT_INDEXING}km/h 이상`);
  console.log(`   - 인덱싱 API: ${INDEXING_API_BASE_URL}`);
  console.log("=".repeat(70) + "\n");

  try {
    // 1. 컨트랙트 연결
    const [signer] = await hre.ethers.getSigners();
    const contract = await hre.ethers.getContractAt("PvdRecord", CONTRACT_ADDRESS, signer);
    
    console.log(`📡 컨트랙트 연결 완료`);
    console.log(`   서명자: ${await signer.getAddress()}`);
    console.log(`   네트워크: ${hre.network.name}\n`);

    // 2. 블록체인에서 최근 데이터 조회
    const recentBlockchainEvents = await getRecentBlockchainEvents(contract, 50);
    
    if (recentBlockchainEvents.length === 0) {
      console.log("⚠️  블록체인에 저장된 이벤트가 없습니다.");
      return;
    }

    // 3. 인덱스에서 모든 데이터 조회
    const indexedMap = await getIndexedData();

    // 4. 비교 분석
    const { missing, matched } = compareData(recentBlockchainEvents, indexedMap);

    // 5. 결과 출력
    console.log("=".repeat(70));
    console.log("📊 최근 블록체인 데이터 분석 (최신 50개)\n");
    
    console.log(`✅ 인덱스에 저장된 데이터: ${matched.length}개`);
    console.log(`❌ 인덱스에 누락된 데이터: ${missing.length}개 (${SPEED_LIMIT_INDEXING}km/h 이상)\n`);
    
    // 6. 블록체인 최신 데이터 표시
    console.log("=".repeat(70));
    console.log("🔝 블록체인 최신 데이터 (최근 10개)\n");
    
    recentBlockchainEvents.slice(0, 10).forEach((event, idx) => {
      const key = `${event.obuId}_${event.collectionDt}`;
      const isIndexed = indexedMap.has(key);
      const shouldBeIndexed = event.speed >= SPEED_LIMIT_INDEXING;
      
      let status = "";
      if (shouldBeIndexed && isIndexed) {
        status = "✅ 인덱싱됨";
      } else if (shouldBeIndexed && !isIndexed) {
        status = "❌ 누락됨";
      } else {
        status = `⚪ 건너뜀 (${event.speed}km/h < ${SPEED_LIMIT_INDEXING}km/h)`;
      }
      
      console.log(`${idx + 1}. 블록 #${event.blockNumber} - ${status}`);
      console.log(`   OBU ID: ${event.obuId}`);
      console.log(`   속도: ${event.speed}km/h`);
      console.log(`   수집시간: ${event.collectionDt}`);
      console.log(`   TxHash: ${event.txHash}`);
      console.log("");
    });

    // 7. 누락된 데이터 상세 표시
    if (missing.length > 0) {
      console.log("=".repeat(70));
      console.log(`⚠️  인덱스에 누락된 데이터 (${missing.length}개)\n`);
      
      // 가장 오래된 누락 데이터부터 표시
      const sortedMissing = missing.sort((a, b) => a.blockNumber - b.blockNumber);
      
      console.log(`📍 가장 오래된 누락 데이터 (블록 #${sortedMissing[0].blockNumber}):`);
      console.log(`   OBU ID: ${sortedMissing[0].obuId}`);
      console.log(`   속도: ${sortedMissing[0].speed}km/h`);
      console.log(`   수집시간: ${sortedMissing[0].collectionDt}`);
      console.log(`   TxHash: ${sortedMissing[0].txHash}\n`);
      
      console.log(`📍 가장 최근 누락 데이터 (블록 #${sortedMissing[sortedMissing.length - 1].blockNumber}):`);
      console.log(`   OBU ID: ${sortedMissing[sortedMissing.length - 1].obuId}`);
      console.log(`   속도: ${sortedMissing[sortedMissing.length - 1].speed}km/h`);
      console.log(`   수집시간: ${sortedMissing[sortedMissing.length - 1].collectionDt}`);
      console.log(`   TxHash: ${sortedMissing[sortedMissing.length - 1].txHash}\n`);
      
      console.log("=".repeat(70));
      console.log("💡 재인덱싱 방법:");
      console.log("   node scripts/reindex-missing-data.js");
      console.log("=".repeat(70));
    } else {
      console.log("=".repeat(70));
      console.log("✅ 최근 데이터가 모두 인덱스에 저장되어 있습니다!");
      console.log("=".repeat(70));
    }

    // 8. 전체 통계
    console.log("\n" + "=".repeat(70));
    console.log("📈 전체 통계\n");
    
    const filter = contract.filters.PvdUpdated();
    const allEvents = await contract.queryFilter(filter);
    
    console.log(`블록체인 전체 이벤트: ${allEvents.length}개`);
    console.log(`인덱스 전체 데이터: ${indexedMap.size}개`);
    
    // 인덱싱 대상 계산
    let shouldBeIndexedCount = 0;
    for (const event of allEvents) {
      const speed = parseInt(event.args.pvd.speed);
      if (speed >= SPEED_LIMIT_INDEXING) {
        shouldBeIndexedCount++;
      }
    }
    
    console.log(`인덱싱 대상 (${SPEED_LIMIT_INDEXING}km/h 이상): ${shouldBeIndexedCount}개`);
    console.log(`인덱싱 비율: ${((indexedMap.size / shouldBeIndexedCount) * 100).toFixed(1)}%`);
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

