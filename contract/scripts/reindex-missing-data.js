const hre = require("hardhat");

// 설정
const DEPLOYMENT_INFO = require("./pvd-deployment.json");
const CONTRACT_ADDRESS = DEPLOYMENT_INFO.contractAddress;
const INDEXING_API_BASE_URL = process.env.INDEXING_API_URL || "http://localhost:3001";
const NETWORK = DEPLOYMENT_INFO.network || "kaia";
const SPEED_LIMIT_INDEXING = 60; // 인덱싱 기준 (60km/h 이상만 인덱싱)
const BATCH_SIZE = 10; // 진행률 표시 간격
const RATE_LIMIT_MS = 300; // API 요청 간격

// 인덱스 ID 캐시
let cachedIndexId = null;

/**
 * 인덱스 ID 조회
 */
async function getIndexId() {
  if (cachedIndexId) {
    return cachedIndexId;
  }
  
  try {
    const response = await fetch(`${INDEXING_API_BASE_URL}/api/index/list`);
    if (!response.ok) {
      throw new Error(`인덱스 목록 조회 실패: HTTP ${response.status}`);
    }
    
    const indexData = await response.json();
    const speedingIndex = indexData.data?.indexes?.find(idx => 
      idx.indexingKey === "speeding" && idx.network === NETWORK
    );
    
    if (!speedingIndex) {
      throw new Error(`${NETWORK} 네트워크에 speeding 인덱스가 생성되지 않았습니다.`);
    }
    
    cachedIndexId = speedingIndex.indexId;
    console.log(`✅ 인덱스 ID 조회 완료: ${cachedIndexId}`);
    return cachedIndexId;
    
  } catch (error) {
    console.error(`❌ 인덱스 ID 조회 실패:`, error.message);
    return null;
  }
}

/**
 * 블록체인에서 모든 PVD 이벤트 조회
 */
async function getAllPvdEventsFromBlockchain(contract) {
  console.log("🔍 블록체인에서 모든 PVD 이벤트 조회 중...");
  
  try {
    // PvdUpdated 이벤트 필터
    const filter = contract.filters.PvdUpdated();
    const events = await contract.queryFilter(filter);
    
    console.log(`✅ 블록체인에서 ${events.length}개 이벤트 발견\n`);
    
    return events.map(event => ({
      txHash: event.transactionHash,
      blockNumber: event.blockNumber,
      args: event.args
    }));
  } catch (error) {
    console.error("❌ 블록체인 이벤트 조회 실패:", error.message);
    return [];
  }
}

/**
 * 인덱스에서 이미 저장된 트랜잭션 ID 조회
 */
async function getIndexedTransactions() {
  console.log("🔍 인덱스에서 이미 저장된 데이터 조회 중...");
  
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

    // 인덱스된 트랜잭션 해시 집합 생성
    const indexedTxSet = new Set();
    
    // 주의: 인덱스 API가 txId를 반환하지 않을 수 있으므로
    // obuId + collectionDt 조합으로 확인
    const indexedKeys = new Set();
    if (result.data?.features) {
      result.data.features.forEach(feature => {
        const props = feature.properties;
        const key = `${props.obuId}_${props.collectionDt}`;
        indexedKeys.add(key);
      });
    }
    
    console.log(`✅ 인덱스에 ${indexedKeys.size}개 데이터 저장됨\n`);
    
    return indexedKeys;
  } catch (error) {
    console.error("❌ 인덱스 데이터 조회 실패:", error.message);
    return new Set();
  }
}

/**
 * 인덱싱 처리
 */
async function indexPvdData(txHash, pvdData, blockNumber) {
  try {
    const indexId = await getIndexId();
    if (!indexId) {
      console.error(`⚠️  인덱스 ID를 찾을 수 없어 인덱싱을 건너뜁니다.`);
      return false;
    }
    
    // 속도 필터링
    const speedValue = parseInt(pvdData.speed);
    if (speedValue < SPEED_LIMIT_INDEXING) {
      return false; // 건너뛰기
    }
    
    // 복합 키 생성
    const paddedSpeed = String(pvdData.speed).padStart(3, '0');
    const speedingKey = `spd::${paddedSpeed}::${pvdData.obuId}::${pvdData.collectionDt}`;
    
    const indexingPayload = {
      indexId: indexId,
      txId: txHash,
      data: {
        speeding: speedingKey,
        obuId: pvdData.obuId,
        collectionDt: pvdData.collectionDt,
        speed: pvdData.speed.toString(),
        latitude: pvdData.startvectorLatitude,
        longitude: pvdData.startvectorLongitude,
        blockNumber: blockNumber.toString(),
        timestamp: new Date().toISOString(),
        eventName: "PvdUpdated"
      },
      network: NETWORK,
      contractAddress: CONTRACT_ADDRESS,
      schema: "speeding",
      indexingKey: "speeding",
      eventName: "PvdUpdated"
    };
    
    const indexingResponse = await fetch(`${INDEXING_API_BASE_URL}/api/index/insert`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(indexingPayload)
    });
    
    if (indexingResponse.ok) {
      console.log(`✅ 인덱싱 완료: ${speedingKey}`);
      return true;
    } else {
      const errorData = await indexingResponse.json();
      console.error(`❌ 인덱싱 실패 (HTTP ${indexingResponse.status}):`, errorData.error);
      return false;
    }
    
  } catch (error) {
    console.error(`❌ 인덱싱 에러:`, error.message);
    return false;
  }
}

/**
 * 메인 함수
 */
async function main() {
  console.log("🔄 누락된 데이터 재인덱싱 시작\n");
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

    // 2. 블록체인에서 모든 이벤트 조회
    const allEvents = await getAllPvdEventsFromBlockchain(contract);
    
    if (allEvents.length === 0) {
      console.log("⚠️  블록체인에 저장된 이벤트가 없습니다.");
      return;
    }

    // 3. 인덱스에서 이미 저장된 데이터 조회
    const indexedKeys = await getIndexedTransactions();

    // 4. 누락된 데이터 찾기
    console.log("🔍 누락된 데이터 확인 중...\n");
    const missingEvents = [];
    
    for (const event of allEvents) {
      const pvdData = event.args.pvd;
      const key = `${pvdData.obuId}_${pvdData.collectionDt}`;
      
      if (!indexedKeys.has(key)) {
        // 속도 필터링 (60km/h 이상만)
        const speed = parseInt(pvdData.speed);
        if (speed >= SPEED_LIMIT_INDEXING) {
          missingEvents.push(event);
        }
      }
    }

    console.log("=".repeat(70));
    console.log(`📊 분석 결과:`);
    console.log(`   블록체인 전체 이벤트: ${allEvents.length}개`);
    console.log(`   인덱스 저장된 데이터: ${indexedKeys.size}개`);
    console.log(`   누락된 데이터 (${SPEED_LIMIT_INDEXING}km/h 이상): ${missingEvents.length}개`);
    console.log("=".repeat(70) + "\n");

    if (missingEvents.length === 0) {
      console.log("✅ 누락된 데이터가 없습니다! 모든 데이터가 인덱싱되어 있습니다.");
      return;
    }

    // 5. 누락된 데이터 인덱싱
    console.log(`⏳ ${missingEvents.length}개의 누락된 데이터 인덱싱 시작...\n`);
    
    const startTime = Date.now();
    let successCount = 0;
    let failCount = 0;

    for (let i = 0; i < missingEvents.length; i++) {
      const event = missingEvents[i];
      const pvdData = event.args.pvd;
      
      console.log(`🔄 [${i + 1}/${missingEvents.length}] 인덱싱 중: ${pvdData.obuId} (${pvdData.collectionDt})`);
      
      const success = await indexPvdData(
        event.txHash,
        pvdData,
        event.blockNumber
      );
      
      if (success) {
        successCount++;
      } else {
        failCount++;
      }

      // 진행률 표시
      if ((i + 1) % BATCH_SIZE === 0 || i === missingEvents.length - 1) {
        const progress = ((i + 1) / missingEvents.length * 100).toFixed(1);
        const elapsed = (Date.now() - startTime) / 1000;
        const avgSpeed = (i + 1) / elapsed;
        const estimated = (missingEvents.length - (i + 1)) / avgSpeed;
        console.log(`\n📊 진행률: ${i + 1}/${missingEvents.length} (${progress}%) | 성공: ${successCount} | 실패: ${failCount} | 예상 남은 시간: ${estimated.toFixed(0)}초\n`);
      }

      // Rate limiting
      await new Promise(resolve => setTimeout(resolve, RATE_LIMIT_MS));
    }

    const totalTime = Date.now() - startTime;

    console.log("\n" + "=".repeat(70));
    console.log("✅ 재인덱싱 완료!");
    console.log("=".repeat(70));
    console.log(`📊 결과:`);
    console.log(`   인덱싱 성공: ${successCount}/${missingEvents.length}건`);
    console.log(`   인덱싱 실패: ${failCount}건`);
    console.log(`\n⏱️  성능:`);
    console.log(`   소요 시간: ${(totalTime / 1000).toFixed(2)}초 (${(totalTime / 1000 / 60).toFixed(2)}분)`);
    console.log(`   평균 속도: ${(successCount / (totalTime / 1000)).toFixed(2)}건/초`);
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

