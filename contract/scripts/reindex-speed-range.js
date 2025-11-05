const hre = require("hardhat");
const fs = require("fs");
const path = require("path");

// 설정
const DEPLOYMENT_INFO = require("./pvd-deployment.json");
const CONTRACT_ADDRESS = DEPLOYMENT_INFO.contractAddress;
const CSV_FILE = path.join(__dirname, "pvd_hist_20k.csv");
const INDEXING_API_BASE_URL = process.env.INDEXING_API_URL || "http://localhost:3001";
const NETWORK = DEPLOYMENT_INFO.network || "hardhat-local";
const MIN_SPEED = 30; // 최소 속도 (30km/h 이상)
const MAX_SPEED = 59; // 최대 속도 (59km/h 이하)
const BATCH_SIZE = 10; // 진행률 표시 간격
const RATE_LIMIT_MS = NETWORK === "kaia" ? 500 : 100;
const PROGRESS_FILE = path.join(__dirname, "reindex-progress.json");
const FAILED_RECORDS_FILE = path.join(__dirname, "failed-records.json");

// 인덱스 ID 캐시
let cachedIndexId = null;

/**
 * 진행 상태 저장
 */
function saveProgress(index, successCount, failCount, notFoundCount, failedRecords) {
  const progress = {
    lastIndex: index,
    successCount,
    failCount,
    notFoundCount,
    failedRecords,
    timestamp: new Date().toISOString()
  };
  fs.writeFileSync(PROGRESS_FILE, JSON.stringify(progress, null, 2));
}

/**
 * 진행 상태 복구
 */
function loadProgress() {
  if (fs.existsSync(PROGRESS_FILE)) {
    try {
      const data = fs.readFileSync(PROGRESS_FILE, 'utf-8');
      return JSON.parse(data);
    } catch (error) {
      console.log("⚠️  진행 상태 파일을 읽을 수 없습니다. 처음부터 시작합니다.");
      return null;
    }
  }
  return null;
}

/**
 * 진행 상태 파일 삭제
 */
function clearProgress() {
  if (fs.existsSync(PROGRESS_FILE)) {
    fs.unlinkSync(PROGRESS_FILE);
  }
}

/**
 * CSV 파일 파싱
 */
function parseCSV(filePath) {
  const content = fs.readFileSync(filePath, "utf-8");
  const lines = content.trim().split("\n");
  const headers = lines[0].split(",");
  
  const records = [];
  for (let i = 1; i < lines.length; i++) {
    const values = lines[i].split(",");
    if (values.length !== headers.length) continue;
    
    const record = {};
    headers.forEach((header, index) => {
      record[header] = values[index];
    });
    records.push(record);
  }
  
  return records;
}

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
 * 블록 범위별로 이벤트 조회 (타임아웃 방지)
 * @returns {Map} uniqueKey -> {txHash, blockNumber}
 */
async function loadEventsInBatches(contract, provider, startBlock, currentBlock) {
  console.log("🔍 블록체인 이벤트 조회 중 (블록 범위별)...");
  const eventMap = new Map();
  
  try {
    const BLOCK_RANGE = 10000; // 10000 블록씩 조회
    const totalBlocks = currentBlock - startBlock;
    let processedBlocks = 0;
    
    console.log(`📊 조회 범위: ${startBlock} ~ ${currentBlock} (총 ${totalBlocks}블록)\n`);
    
    for (let fromBlock = startBlock; fromBlock <= currentBlock; fromBlock += BLOCK_RANGE) {
      const toBlock = Math.min(fromBlock + BLOCK_RANGE - 1, currentBlock);
      
      try {
        // PvdUpdated와 PvdCreated 이벤트 조회
        const updatedFilter = contract.filters.PvdUpdated();
        const createdFilter = contract.filters.PvdCreated();
        
        const [updatedEvents, createdEvents] = await Promise.all([
          contract.queryFilter(updatedFilter, fromBlock, toBlock),
          contract.queryFilter(createdFilter, fromBlock, toBlock)
        ]);
        
        const allEvents = [...updatedEvents, ...createdEvents];
        
        // 이벤트를 맵에 추가 (트랜잭션 데이터 디코딩)
        for (const event of allEvents) {
          try {
            // 트랜잭션 데이터 가져오기
            const tx = await provider.getTransaction(event.transactionHash);
            if (!tx) {
              if (eventMap.size === 0) {
                console.log(`   ⚠️  트랜잭션을 찾을 수 없음: ${event.transactionHash}`);
              }
              continue;
            }
            
            // 함수 호출 디코딩 (createUpdatePvd 함수: string obuId, PvdHist pvd)
            // PvdHist는 구조체이므로 tuple로 디코딩
            const iface = new ethers.Interface([
              "function createUpdatePvd(string obuId, tuple(string obuId, string collectionDt, string startvectorLatitude, string startvectorLongitude, string transmisstion, uint256 speed, string hazardLights, string leftTurnSignalOn, string rightTurnSignalOn, uint256 steering, uint256 rpm, string footbrake, string gear, uint256 accelator, string wipers, string tireWarnLeftF, string tireWarnLeftR, string tireWarnRightF, string tireWarnRightR, uint256 tirePsiLeftF, uint256 tirePsiLeftR, uint256 tirePsiRightF, uint256 tirePsiRightR, uint256 fuelPercent, uint256 fuelLiter, uint256 totaldist, string rsuId, string msgId, uint256 startvectorHeading, uint256 timestamp, uint256 blockNumber) pvd)"
            ]);
            
            const decoded = iface.parseTransaction({ data: tx.data });
            if (!decoded) {
              if (eventMap.size === 0) {
                console.log(`   ⚠️  디코딩 실패 (decoded null)`);
              }
              continue;
            }
            
            const uniqueKey = decoded.args[0]; // 첫 번째 파라미터가 obuId (uniqueKey)
            
            // 디버깅: 처음 5개 이벤트 키 출력
            if (eventMap.size < 5) {
              console.log(`   🔍 이벤트 키 샘플 #${eventMap.size + 1}: "${uniqueKey}"`);
            }
            
            eventMap.set(uniqueKey, {
              txHash: event.transactionHash,
              blockNumber: event.blockNumber
            });
          } catch (decodeError) {
            // 디코딩 실패 디버깅 (첫 번째 에러만 출력)
            if (eventMap.size === 0) {
              console.log(`   ⚠️  디코딩 예외: ${decodeError.message}`);
            }
            continue;
          }
        }
        
        processedBlocks += (toBlock - fromBlock + 1);
        const progress = (processedBlocks / totalBlocks * 100).toFixed(1);
        console.log(`   블록 ${fromBlock}~${toBlock}: ${allEvents.length}개 이벤트 | 총: ${eventMap.size}건 (${progress}%)`);
        
        // Rate limiting
        await new Promise(resolve => setTimeout(resolve, 100));
        
      } catch (error) {
        console.error(`   ⚠️  블록 ${fromBlock}~${toBlock} 조회 실패:`, error.message);
        continue;
      }
    }
    
    console.log(`\n✅ 총 ${eventMap.size}개 이벤트 발견`);
    
    // 디버깅: 이벤트 맵의 처음 5개 키 출력
    console.log("\n🔍 이벤트 키 샘플 (맵에 저장된 실제 키):");
    let count = 0;
    for (const [key, value] of eventMap.entries()) {
      if (count >= 5) break;
      console.log(`   ${count + 1}. "${key}" → txHash: ${value.txHash.substring(0, 10)}...`);
      count++;
    }
    console.log();
    
    return eventMap;
    
  } catch (error) {
    console.error("❌ 이벤트 조회 실패:", error.message);
    return new Map();
  }
}

/**
 * 블록체인에서 직접 PVD 데이터 조회 및 txHash 찾기
 */
async function getPvdFromBlockchain(contract, provider, uniqueKey) {
  try {
    // 1. 블록체인에 데이터가 있는지 확인
    const pvdData = await contract.readPvd(uniqueKey);
    
    // 데이터가 없으면 null 반환
    if (!pvdData || !pvdData.obuId || pvdData.blockNumber.toString() === '0') {
      return null;
    }
    
    const blockNumber = parseInt(pvdData.blockNumber.toString());
    
    // 2. 해당 블록에서 uniqueKey를 포함하는 트랜잭션 찾기
    const txHash = await findTxHashInBlock(provider, blockNumber, CONTRACT_ADDRESS, uniqueKey);
    
    if (!txHash) {
      return null;
    }
    
    return {
      txHash,
      blockNumber
    };
    
  } catch (error) {
    // 조용히 실패 처리 (너무 많은 로그 방지)
    return null;
  }
}

/**
 * 블록에서 uniqueKey를 포함하는 트랜잭션 찾기
 */
async function findTxHashInBlock(provider, blockNumber, contractAddress, uniqueKey) {
  try {
    // 블록 정보 가져오기 (트랜잭션 해시만)
    const block = await provider.getBlock(blockNumber);
    
    if (!block || !block.transactions || block.transactions.length === 0) {
      return null;
    }
    
    // uniqueKey를 hex로 변환 (트랜잭션 데이터에서 검색)
    const ethers = require("ethers");
    
    // 각 트랜잭션 확인
    for (const txHash of block.transactions) {
      try {
        const tx = await provider.getTransaction(txHash);
        
        if (!tx || !tx.to || tx.to.toLowerCase() !== contractAddress.toLowerCase()) {
          continue;
        }
        
        if (!tx.data || tx.data.length < 10) {
          continue;
        }
        
        // 트랜잭션 데이터 디코딩
        const iface = new ethers.Interface([
          "function createUpdatePvd(string obuId, tuple(string obuId, string collectionDt, string startvectorLatitude, string startvectorLongitude, string transmisstion, uint256 speed, string hazardLights, string leftTurnSignalOn, string rightTurnSignalOn, uint256 steering, uint256 rpm, string footbrake, string gear, uint256 accelator, string wipers, string tireWarnLeftF, string tireWarnLeftR, string tireWarnRightF, string tireWarnRightR, uint256 tirePsiLeftF, uint256 tirePsiLeftR, uint256 tirePsiRightF, uint256 tirePsiRightR, uint256 fuelPercent, uint256 fuelLiter, uint256 totaldist, string rsuId, string msgId, uint256 startvectorHeading, uint256 timestamp, uint256 blockNumber) pvd)"
        ]);
        
        const decoded = iface.parseTransaction({ data: tx.data });
        if (decoded && decoded.args[0] === uniqueKey) {
          // 진짜 트랜잭션 검증 완료: uniqueKey가 정확히 일치
          return txHash;
        }
      } catch (decodeError) {
        // 디코딩 실패는 조용히 무시
        continue;
      }
    }
    
    return null;
  } catch (error) {
    // 조용히 실패 처리
    return null;
  }
}

/**
 * 인덱싱 처리 (30~59km/h만)
 */
async function indexSpeedingData(txHash, record, blockNumber) {
  try {
    const speed = parseInt(record.SPEED);
    
    // 속도 필터링: 30 ~ 59km/h만 인덱싱
    if (speed < MIN_SPEED || speed > MAX_SPEED) {
      return false; // 범위 밖은 건너뛰기
    }
    
    const indexId = await getIndexId();
    if (!indexId) {
      console.error(`⚠️  인덱스 ID를 찾을 수 없어 인덱싱을 건너뜁니다.`);
      return false;
    }
    
    // txHash가 없으면 실패
    if (!txHash) {
      console.error(`⚠️  트랜잭션 해시를 찾을 수 없습니다.`);
      return false;
    }
    
    // 디버깅: 첫 번째 호출만 로그
    if (!indexSpeedingData.firstCall) {
      console.log(`\n🔍 첫 번째 인덱싱 시도: ${record.OBU_ID} (${speed}km/h)`);
      indexSpeedingData.firstCall = true;
    }
    
    // 복합 키 생성: spd::{speed}::{obuId}::{collectionDt}
    const paddedSpeed = String(speed).padStart(3, '0');
    const speedingKey = `spd::${paddedSpeed}::${record.OBU_ID}::${record.COLLECTION_DT}`;
    
    const indexingPayload = {
      indexId: indexId,
      txId: txHash,
      data: {
        speeding: speedingKey,
        obuId: record.OBU_ID,
        collectionDt: record.COLLECTION_DT,
        speed: speed.toString(),
        latitude: record.STARTVECTOR_LATITUDE,
        longitude: record.STARTVECTOR_LONGITUDE,
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
    
    // 타임아웃 설정 (30초)
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 30000);
    
    try {
      const indexingResponse = await fetch(`${INDEXING_API_BASE_URL}/api/index/insert`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(indexingPayload),
        signal: controller.signal
      });
      
      clearTimeout(timeoutId);
      
      if (indexingResponse.ok) {
        return true;
      } else {
        const errorData = await indexingResponse.json();
        const errorMsg = errorData.error || '';
        
        // 중복 데이터는 경고만 하고 성공으로 처리
        if (errorMsg.includes('duplicate') || errorMsg.includes('already exists') || errorMsg.includes('중복')) {
          // 중복은 조용히 성공으로 처리 (10개마다 한 번만 로그)
          if (Math.random() < 0.1) {
            console.log(`⚠️  중복 데이터 건너뛰기: ${record.OBU_ID} (이미 인덱싱됨)`);
          }
          return true;
        }
        
        // 실제 에러만 로그 출력
        console.error(`❌ 인덱싱 실패 (HTTP ${indexingResponse.status}):`, errorMsg);
        return false;
      }
    } catch (fetchError) {
      clearTimeout(timeoutId);
      if (fetchError.name === 'AbortError') {
        console.error(`❌ 인덱싱 타임아웃 (30초 초과)`);
      } else {
        console.error(`❌ 인덱싱 요청 실패:`, fetchError.message);
      }
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
  console.log("🔄 속도 범위별 재인덱싱 시작\n");
  console.log("=".repeat(70));
  console.log(`📊 설정:`);
  console.log(`   - 컨트랙트 주소: ${CONTRACT_ADDRESS}`);
  console.log(`   - 네트워크: ${NETWORK}`);
  console.log(`   - 속도 범위: ${MIN_SPEED}~${MAX_SPEED}km/h`);
  console.log(`   - CSV 파일: ${CSV_FILE}`);
  console.log(`   - 인덱싱 API: ${INDEXING_API_BASE_URL}`);
  console.log(`   - Rate Limit: ${RATE_LIMIT_MS}ms`);
  console.log("=".repeat(70) + "\n");

  try {
    // 1. CSV 파일 읽기
    console.log("📖 CSV 파일 읽는 중...");
    const allRecords = parseCSV(CSV_FILE);
    console.log(`✅ 총 ${allRecords.length}개 레코드 로드\n`);
    
    // 2. 속도 범위로 필터링
    console.log(`🔍 속도 범위 필터링 중 (${MIN_SPEED}~${MAX_SPEED}km/h)...`);
    const targetRecords = allRecords.filter(record => {
      const speed = parseInt(record.SPEED);
      return speed >= MIN_SPEED && speed <= MAX_SPEED && speed !== 589; // 589는 무효값
    });
    console.log(`✅ 대상 레코드: ${targetRecords.length}건\n`);
    
    if (targetRecords.length === 0) {
      console.log("⚠️  해당 속도 범위의 레코드가 없습니다.");
      return;
    }
    
    // 3. 컨트랙트 연결
    const [signer] = await hre.ethers.getSigners();
    const contract = await hre.ethers.getContractAt("PvdRecord", CONTRACT_ADDRESS, signer);
    const provider = hre.ethers.provider;
    
    console.log(`📡 컨트랙트 연결 완료`);
    console.log(`   서명자: ${await signer.getAddress()}`);
    console.log(`   네트워크: ${hre.network.name}\n`);

    // 4. 현재 블록 번호 가져오기
    const currentBlock = await provider.getBlockNumber();
    const deployBlock = DEPLOYMENT_INFO.blockNumber || 0;
    console.log(`📦 현재 블록: ${currentBlock} | 배포 블록: ${deployBlock}\n`);
    
    // 5. 블록 범위별로 이벤트 조회
    const eventMap = await loadEventsInBatches(contract, provider, deployBlock, currentBlock);
    
    if (eventMap.size === 0) {
      console.log("⚠️  블록체인에서 이벤트를 찾을 수 없습니다.");
      console.log("   - 컨트랙트 주소가 올바른지 확인하세요.");
      console.log("   - 배포 블록 번호가 올바른지 확인하세요.");
      return;
    }

    // 6. 진행 상태 복구
    const savedProgress = loadProgress();
    let startIndex = 0;
    let successCount = 0;
    let failCount = 0;
    let notFoundCount = 0;
    let failedRecords = [];
    
    if (savedProgress) {
      startIndex = savedProgress.lastIndex + 1;
      successCount = savedProgress.successCount || 0;
      failCount = savedProgress.failCount || 0;
      notFoundCount = savedProgress.notFoundCount || 0;
      failedRecords = savedProgress.failedRecords || [];
      
      console.log("\n🔄 이전 진행 상태를 발견했습니다!");
      console.log(`   마지막 처리: ${savedProgress.lastIndex + 1}/${targetRecords.length}`);
      console.log(`   성공: ${successCount} | 실패: ${failCount} | 미발견: ${notFoundCount}`);
      console.log(`   ${startIndex}번째부터 이어서 진행합니다.\n`);
    } else {
      console.log("🔄 CSV 레코드와 이벤트 매칭 중...\n");
      
      // 디버깅: 처음 5개 CSV 키 출력
      console.log("📋 CSV 키 샘플:");
      for (let i = 0; i < Math.min(5, targetRecords.length); i++) {
        const sampleKey = `${targetRecords[i].OBU_ID}_${targetRecords[i].COLLECTION_DT}`;
        console.log(`   ${i + 1}. "${sampleKey}"`);
      }
      console.log();
    }
    
    const startTime = Date.now();

    for (let i = startIndex; i < targetRecords.length; i++) {
      const record = targetRecords[i];
      const speed = parseInt(record.SPEED);
      
      // uniqueKey 생성 (컨트랙트에서 사용하는 키)
      const uniqueKey = `${record.OBU_ID}_${record.COLLECTION_DT}`;
      
      // 이벤트 맵에서 찾기
      let eventData = eventMap.get(uniqueKey);
      
      // 이벤트에 없으면 블록체인에서 직접 조회
      if (!eventData) {
        // 블록체인에서 직접 조회 시도
        eventData = await getPvdFromBlockchain(contract, provider, uniqueKey);
        
        if (!eventData) {
          notFoundCount++;
          if ((i + 1) % BATCH_SIZE === 0 || i === targetRecords.length - 1) {
            console.log(`⚠️  [${i + 1}/${targetRecords.length}] ${uniqueKey} - 블록체인에도 없음`);
          }
          continue;
        }
        
        // 블록체인에서 찾았다면 로그 출력 (진짜 트랜잭션 확인)
        if ((i + 1) % BATCH_SIZE === 0 || notFoundCount < 10) {
          console.log(`🔍 [${i + 1}/${targetRecords.length}] ${uniqueKey}`);
          console.log(`   ✅ 블록체인 직접 조회 성공 → 진짜 TX: ${eventData.txHash.substring(0, 16)}... (블록: ${eventData.blockNumber})`);
        }
      }
      
      // 인덱싱 수행 (실제 txHash 사용)
      const success = await indexSpeedingData(
        eventData.txHash,
        record,
        eventData.blockNumber
      );
      
      if (success) {
        successCount++;
        if ((i + 1) % BATCH_SIZE === 0 || i === targetRecords.length - 1) {
          console.log(`✅ [${i + 1}/${targetRecords.length}] ${record.OBU_ID} (${speed}km/h) - 인덱싱 완료`);
        }
      } else {
        failCount++;
        // 실패한 레코드 저장
        failedRecords.push({
          index: i + 1,
          obuId: record.OBU_ID,
          collectionDt: record.COLLECTION_DT,
          speed: speed,
          txHash: eventData.txHash,
          uniqueKey: uniqueKey
        });
      }
      
      // Rate limiting
      await new Promise(resolve => setTimeout(resolve, RATE_LIMIT_MS));
      
      // 진행 상태 저장 (100개마다)
      if ((i + 1) % 100 === 0) {
        saveProgress(i, successCount, failCount, notFoundCount, failedRecords);
      }

      // 진행률 표시
      if ((i + 1) % (BATCH_SIZE * 5) === 0 || i === targetRecords.length - 1) {
        const progress = ((i + 1) / targetRecords.length * 100).toFixed(1);
        const elapsed = (Date.now() - startTime) / 1000;
        const avgSpeed = (i + 1) / elapsed;
        const estimated = (targetRecords.length - (i + 1)) / avgSpeed;
        
        console.log(`\n📊 진행률: ${i + 1}/${targetRecords.length} (${progress}%)`);
        console.log(`   인덱싱 성공: ${successCount} | 실패: ${failCount} | 미발견: ${notFoundCount}`);
        console.log(`   예상 남은 시간: ${estimated.toFixed(0)}초\n`);
      }
    }

    const totalTime = Date.now() - startTime;

    console.log("\n" + "=".repeat(70));
    console.log("✅ 재인덱싱 완료!");
    console.log("=".repeat(70));
    console.log(`📊 결과:`);
    console.log(`   대상 레코드: ${targetRecords.length}건`);
    console.log(`   인덱싱 성공: ${successCount}건`);
    console.log(`   인덱싱 실패: ${failCount}건`);
    console.log(`   블록체인 미발견: ${notFoundCount}건`);
    console.log(`\n⏱️  성능:`);
    console.log(`   소요 시간: ${(totalTime / 1000).toFixed(2)}초 (${(totalTime / 1000 / 60).toFixed(2)}분)`);
    if (successCount > 0) {
      console.log(`   평균 속도: ${(successCount / (totalTime / 1000)).toFixed(2)}건/초`);
    }
    console.log("=".repeat(70));
    
    // 실패한 레코드 상세 출력
    if (failedRecords.length > 0) {
      console.log(`\n❌ 실패한 레코드 상세:`);
      console.log("=".repeat(70));
      failedRecords.forEach((rec, idx) => {
        console.log(`   ${idx + 1}. [${rec.index}/${targetRecords.length}] ${rec.obuId} (${rec.speed}km/h)`);
        console.log(`      - 수집 시각: ${rec.collectionDt}`);
        console.log(`      - 트랜잭션: ${rec.txHash}`);
      });
      
      // 실패한 레코드를 파일로 저장
      fs.writeFileSync(FAILED_RECORDS_FILE, JSON.stringify(failedRecords, null, 2));
      console.log(`\n💾 실패한 레코드가 ${FAILED_RECORDS_FILE}에 저장되었습니다.`);
      console.log("=".repeat(70));
    }
    
    // 진행 상태 파일 정리 (완료 시)
    clearProgress();
    console.log("\n🧹 진행 상태 파일이 정리되었습니다.");

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

