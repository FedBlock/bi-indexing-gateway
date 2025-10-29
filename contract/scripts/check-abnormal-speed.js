const hre = require("hardhat");

async function main() {
  console.log("\n🔍 비정상적인 속도 데이터 확인 중...\n");

  // 컨트랙트 주소 로드
  const deployment = require('./pvd-deployment.json');
  const contractAddress = deployment.contractAddress;
  
  console.log(`📍 컨트랙트 주소: ${contractAddress}`);

  // 컨트랙트 연결
  const PvdRecord = await hre.ethers.getContractFactory("PvdRecord");
  const pvdRecord = PvdRecord.attach(contractAddress);

  // 모든 키 가져오기
  const keys = await pvdRecord.getKeyLists();
  console.log(`📋 총 ${keys.length}개의 키 발견\n`);

  const abnormalData = [];
  const speedStats = {
    min: Infinity,
    max: 0,
    total: 0,
    count: 0
  };

  // 배치로 데이터 조회
  const BATCH_SIZE = 50;
  for (let i = 0; i < keys.length; i += BATCH_SIZE) {
    const batchKeys = keys.slice(i, Math.min(i + BATCH_SIZE, keys.length));
    
    const batchPromises = batchKeys.map(async (key) => {
      try {
        const data = await pvdRecord.readPvd(key);
        const speed = Number(data.speed);
        
        // 통계 업데이트
        speedStats.min = Math.min(speedStats.min, speed);
        speedStats.max = Math.max(speedStats.max, speed);
        speedStats.total += speed;
        speedStats.count++;
        
        // 비정상적인 속도 체크 (200km/h 이상)
        if (speed >= 200) {
          return {
            obuId: data.obuId,
            collectionDt: data.collectionDt,
            speed: speed,
            latitude: data.startvectorLatitude,
            longitude: data.startvectorLongitude
          };
        }
        return null;
      } catch (error) {
        return null;
      }
    });
    
    const batchResults = await Promise.all(batchPromises);
    abnormalData.push(...batchResults.filter(d => d !== null));
    
    // 진행상황 표시
    if ((i + BATCH_SIZE) % 500 === 0 || i + BATCH_SIZE >= keys.length) {
      console.log(`🔄 진행: ${Math.min(i + BATCH_SIZE, keys.length)}/${keys.length}`);
    }
    
    // Rate limit
    await new Promise(resolve => setTimeout(resolve, 100));
  }

  console.log("\n" + "=".repeat(80));
  console.log("📊 속도 통계");
  console.log("=".repeat(80));
  console.log(`최소 속도: ${speedStats.min} km/h`);
  console.log(`최대 속도: ${speedStats.max} km/h`);
  console.log(`평균 속도: ${(speedStats.total / speedStats.count).toFixed(2)} km/h`);
  console.log(`총 데이터: ${speedStats.count}건`);

  if (abnormalData.length > 0) {
    console.log("\n" + "=".repeat(80));
    console.log(`⚠️  비정상적인 속도 데이터 (200km/h 이상): ${abnormalData.length}건`);
    console.log("=".repeat(80));
    
    // 속도 순으로 정렬
    abnormalData.sort((a, b) => b.speed - a.speed);
    
    // 상위 20개만 출력
    abnormalData.slice(0, 20).forEach((data, index) => {
      console.log(`\n${index + 1}. 속도: ${data.speed} km/h`);
      console.log(`   차량: ${data.obuId}`);
      console.log(`   시간: ${data.collectionDt}`);
      console.log(`   위치: (${data.latitude}, ${data.longitude})`);
    });
    
    if (abnormalData.length > 20) {
      console.log(`\n... 외 ${abnormalData.length - 20}건`);
    }
  } else {
    console.log("\n✅ 비정상적인 속도 데이터 없음");
  }
  
  console.log("\n" + "=".repeat(80));
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });

