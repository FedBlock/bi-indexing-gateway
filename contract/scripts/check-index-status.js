// Node.js 18+ 네이티브 fetch 사용 (별도 import 불필요)

// 설정
const INDEXING_API_BASE_URL = process.env.INDEXING_API_URL || "http://localhost:3001";
const NETWORK = "kaia"; // 확인할 네트워크

/**
 * 인덱스 목록 조회
 */
async function getIndexList() {
  try {
    const response = await fetch(`${INDEXING_API_BASE_URL}/api/index/list`);
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }
    const data = await response.json();
    return data;
  } catch (error) {
    console.error("❌ 인덱스 목록 조회 실패:", error.message);
    return null;
  }
}

/**
 * 특정 속도 이상의 데이터 개수 확인
 */
async function checkSpeedingCount(minSpeed) {
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
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    const result = await response.json();
    return result;
  } catch (error) {
    console.error(`❌ ${minSpeed}km/h 이상 데이터 조회 실패:`, error.message);
    return null;
  }
}

/**
 * 메인 함수
 */
async function main() {
  console.log("🔍 인덱스 상태 확인\n");
  console.log("=".repeat(70));
  console.log(`📡 API 서버: ${INDEXING_API_BASE_URL}`);
  console.log(`🌐 네트워크: ${NETWORK}`);
  console.log("=".repeat(70) + "\n");

  // 1. 인덱스 목록 확인
  console.log("📋 인덱스 목록 조회 중...");
  const indexData = await getIndexList();
  
  if (!indexData || !indexData.success) {
    console.error("❌ 인덱스 목록을 가져올 수 없습니다.");
    return;
  }

  const speedingIndex = indexData.data?.indexes?.find(idx => 
    idx.indexingKey === "speeding" && idx.network === NETWORK
  );

  if (!speedingIndex) {
    console.error(`❌ ${NETWORK} 네트워크에 speeding 인덱스가 없습니다.`);
    return;
  }

  console.log("✅ Speeding 인덱스 발견");
  console.log(`   - Index ID: ${speedingIndex.indexId}`);
  console.log(`   - Indexing Key: ${speedingIndex.indexingKey}`);
  console.log(`   - Network: ${speedingIndex.network}`);
  console.log(`   - Contract Address: ${speedingIndex.contractAddress}`);
  console.log("");

  // 2. 각 속도 구간별 데이터 개수 확인
  console.log("📊 속도 구간별 데이터 개수 확인\n");
  
  const speedLimits = [0, 60, 80, 100, 120];
  let latestData = null;
  
  for (const minSpeed of speedLimits) {
    console.log(`🔍 ${minSpeed}km/h 이상 데이터 조회 중...`);
    const result = await checkSpeedingCount(minSpeed);
    
    if (result && result.success) {
      const count = result.data?.features?.length || 0;
      console.log(`   ✅ 인덱스 조회 시간: ${result.indexQueryTime}`);
      console.log(`   ✅ 총 조회 시간: ${result.totalQueryTime}`);
      console.log(`   📊 인덱스에서 찾은 트랜잭션: ${result.indexCount}건`);
      console.log(`   📊 실제 조회된 데이터: ${count}건`);
      
      // 최근 데이터 5개 추출 (0km/h 조회 시)
      if (minSpeed === 0 && count > 0) {
        const features = result.data.features;
        // blockNumber 기준 정렬 (최신순)
        const sorted = features.sort((a, b) => 
          parseInt(b.properties.blockNumber) - parseInt(a.properties.blockNumber)
        );
        latestData = sorted.slice(0, 5);
      }
      console.log("");
    } else {
      console.log(`   ❌ 조회 실패\n`);
    }
    
    // API 부하 방지
    await new Promise(resolve => setTimeout(resolve, 500));
  }

  // 3. 최근 저장된 데이터 표시
  if (latestData && latestData.length > 0) {
    console.log("=".repeat(70));
    console.log("🕒 최근 저장된 데이터 (최신 5개)\n");
    
    latestData.forEach((feature, idx) => {
      // 데이터 유효성 검사
      if (!feature || !feature.properties || !feature.geometry) {
        console.log(`${idx + 1}. ❌ 유효하지 않은 데이터\n`);
        return;
      }
      
      const props = feature.properties;
      const coords = feature.geometry.coordinates;
      
      console.log(`${idx + 1}. OBU ID: ${props.obuId || 'N/A'}`);
      console.log(`   속도: ${props.speed || 'N/A'}km/h`);
      console.log(`   수집시간: ${props.collectionDt || 'N/A'}`);
      console.log(`   블록: #${props.blockNumber || 'N/A'}`);
      
      if (coords && coords.length >= 2 && coords[0] != null && coords[1] != null) {
        console.log(`   위치: (${coords[1].toFixed(4)}, ${coords[0].toFixed(4)})`);
      } else {
        console.log(`   위치: N/A`);
      }
      console.log("");
    });
  }

  console.log("=".repeat(70));
  console.log("✅ 인덱스 상태 확인 완료");
  console.log("=".repeat(70));
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error("❌ 실행 실패:", error);
    process.exit(1);
  });

