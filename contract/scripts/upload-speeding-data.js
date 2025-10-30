const hre = require("hardhat");
const fs = require("fs");
const path = require("path");

// 설정
const DEPLOYMENT_INFO = require("./pvd-deployment.json");
const CONTRACT_ADDRESS = DEPLOYMENT_INFO.contractAddress;
const CSV_FILE = path.join(__dirname, "pvd_hist_20k.csv");
const INDEXING_API_BASE_URL = process.env.INDEXING_API_URL || "http://localhost:3001";
const NETWORK = DEPLOYMENT_INFO.network || "hardhat-local"; // 배포 파일에서 네트워크 자동 감지
const SPEED_LIMIT_STORAGE = 0; // 저장 기준 (0 = 전체 저장)
const SPEED_LIMIT_INDEXING = 60; // 인덱싱 기준 (60km/h 이상만 인덱싱)
const MAX_RECORDS = null;  // null이면 전체 업로드, 숫자면 해당 개수만 업로드
const UPLOAD_ALL_DATA = true; // true면 전체 데이터, false면 필터링된 데이터만
const START_INDEX = 6157; // 시작 인덱스 (0부터 시작, 6157이면 6158번째 레코드부터)
const BATCH_SIZE = 10; // 진행률 표시 간격
const RATE_LIMIT_MS = NETWORK === "kaia" ? 500 : 100; // Kaia는 500ms, 로컬은 100ms

// 인덱스 ID 캐시
let cachedIndexId = null;

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
 * 과속 데이터 필터링
 */
function filterSpeedingData(records) {
  return records.filter(record => {
    const speed = parseInt(record.SPEED);
    return speed >= SPEED_LIMIT && speed !== 589; // 589는 무효값
  });
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
 * 블록체인에 PVD 데이터 저장
 * @returns {Object|null} { txHash, blockNumber, gasCost } 또는 null (실패 시)
 */
async function savePvdToBlockchain(contract, record, index) {
  try {
    // PvdHist 구조체 생성 (음수 값을 0으로 변환)
    const pvdData = {
      obuId: record.OBU_ID,
      collectionDt: record.COLLECTION_DT,
      startvectorLatitude: record.STARTVECTOR_LATITUDE,
      startvectorLongitude: record.STARTVECTOR_LONGITUDE,
      transmisstion: record.TRANSMISSTION || "-",
      speed: Math.max(0, parseInt(record.SPEED) || 0),
      hazardLights: record.HAZARD_LIGHTS || "OFF",
      leftTurnSignalOn: record.LEFT_TURN_SIGNAL_ON || "OFF",
      rightTurnSignalOn: record.RIGHT_TURN_SIGNAL_ON || "OFF",
      steering: Math.max(0, parseInt(record.STEERING) || 0),
      rpm: Math.max(0, parseInt(record.RPM) || 0),  // 음수 방지
      footbrake: record.FOOTBRAKE || "-",
      gear: record.GEAR || "0",
      accelator: Math.max(0, parseInt(record.ACCELATOR) || 0),  // 음수 방지
      wipers: record.WIPERS || "-",
      tireWarnLeftF: record.TIRE_WARN_LEFT_F || "-",
      tireWarnLeftR: record.TIRE_WARN_LEFT_R || "-",
      tireWarnRightF: record.TIRE_WARN_RIGHT_F || "-",
      tireWarnRightR: record.TIRE_WARN_RIGHT_R || "-",
      tirePsiLeftF: Math.max(0, parseInt(record.TIRE_PSI_LEFT_F) || 0),
      tirePsiLeftR: Math.max(0, parseInt(record.TIRE_PSI_LEFT_R) || 0),
      tirePsiRightF: Math.max(0, parseInt(record.TIRE_PSI_RIGHT_F) || 0),
      tirePsiRightR: Math.max(0, parseInt(record.TIRE_PSI_RIGHT_R) || 0),
      fuelPercent: Math.max(0, parseInt(record.FUEL_PERCENT) || 0),
      fuelLiter: Math.max(0, parseInt(record.FUEL_LITER) || 0),
      totaldist: Math.max(0, parseInt(record.TOTALDIST) || 0),  // 음수 방지
      rsuId: record.RSU_ID || "",
      msgId: record.MSG_ID || "",
      startvectorHeading: Math.max(0, parseInt(record.STARTVECTOR_HEADING) || 0),
      timestamp: 0,
      blockNumber: 0
    };
    
    // 블록체인에 저장 (유니크 키: obuId + collectionDt)
    const uniqueKey = `${record.OBU_ID}_${record.COLLECTION_DT}`;
    const tx = await contract.createUpdatePvd(uniqueKey, pvdData);
    const receipt = await tx.wait();
    
    const txHash = tx.hash;
    const blockNumber = receipt.blockNumber;
    const gasUsed = receipt.gasUsed.toString();
    const effectiveGasPrice = receipt.effectiveGasPrice ? receipt.effectiveGasPrice.toString() : '0';
    const gasCost = hre.ethers.formatEther(
      BigInt(gasUsed) * BigInt(effectiveGasPrice)
    );
    
    console.log(`✅ 레코드 ${index + 1} 저장 완료 - TxID: ${txHash.substring(0, 10)}... | Gas: ${gasCost.substring(0, 10)} ${NETWORK === 'kaia' ? 'KAIA' : 'ETH'}`);
    
    // 인덱싱 처리
    const indexed = await indexSpeedingData(
      txHash,
      record.OBU_ID,
      record.COLLECTION_DT,
      record.SPEED,
      record.STARTVECTOR_LATITUDE,
      record.STARTVECTOR_LONGITUDE,
      blockNumber
    );
    
    return { 
      txHash, 
      blockNumber, 
      gasCost: parseFloat(gasCost),
      indexed: indexed  // 인덱싱 성공 여부
    };
    
  } catch (error) {
    console.error(`\n❌ 레코드 ${index + 1} 저장 실패:`);
    console.error(`   OBU ID: ${record.OBU_ID}, CollectionDt: ${record.COLLECTION_DT}`);
    console.error(`   에러 메시지: ${error.message}`);
    
    // 상세 에러 정보 출력
    if (error.code) {
      console.error(`   에러 코드: ${error.code}`);
    }
    if (error.reason) {
      console.error(`   에러 원인: ${error.reason}`);
    }
    if (error.error) {
      console.error(`   내부 에러:`, error.error);
    }
    if (error.transaction) {
      console.error(`   트랜잭션 정보:`, JSON.stringify(error.transaction, null, 2));
    }
    
    // 잔액 부족 에러일 경우 특별 처리
    if (error.message.includes('insufficient funds')) {
      console.error(`\n⚠️  잔액 부족 감지! 현재 계정의 잔액을 확인하세요.`);
      console.error(`   계정 주소를 확인하고 테스트넷 토큰을 충전해야 합니다.\n`);
    }
    
    // 실패해도 계속 진행
    return null;
  }
}

/**
 * 인덱싱 처리 (조건부 - 속도 기준)
 * @returns {boolean} 인덱싱 성공 여부
 */
async function indexSpeedingData(txHash, obuId, collectionDt, speed, lat, lng, blockNumber) {
  try {
    // 속도 필터링: SPEED_LIMIT_INDEXING 이상만 인덱싱
    const speedValue = parseInt(speed);
    if (speedValue < SPEED_LIMIT_INDEXING) {
      // 인덱싱 건너뛰기 (저장은 되었지만 인덱스에는 추가 안 함)
      return false; // 건너뛰기
    }
    
    const indexId = await getIndexId();
    if (!indexId) {
      console.error(`⚠️  인덱스 ID를 찾을 수 없어 인덱싱을 건너뜁니다.`);
      return false;
    }
    
    // 복합 키 생성: spd::{speed}::{obuId}::{collectionDt}
    const paddedSpeed = String(speed).padStart(3, '0');
    const speedingKey = `spd::${paddedSpeed}::${obuId}::${collectionDt}`;
    
    const indexingPayload = {
      indexId: indexId,
      txId: txHash,
      data: {
        speeding: speedingKey,  // 인덱스 키 (fileindex-go가 이 필드를 B+tree 키로 사용)
        obuId: obuId,
        collectionDt: collectionDt,
        speed: speed,
        latitude: lat,
        longitude: lng,
        blockNumber: blockNumber,
        timestamp: new Date().toISOString(),
        eventName: "PvdUpdated"
      },
      network: NETWORK,
      contractAddress: CONTRACT_ADDRESS,
      schema: "speeding",
      indexingKey: "speeding",  // config.yaml의 indexingkey와 매칭
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
  console.log("🚀 데이터 업로드 시작\n");
  console.log(`📊 설정:`);
  console.log(`   - 컨트랙트 주소: ${CONTRACT_ADDRESS}`);
  console.log(`   - 네트워크: ${NETWORK}`);
  console.log(`   - 업로드 모드: ${UPLOAD_ALL_DATA ? '전체 데이터' : '필터링된 데이터만'}`);
  console.log(`   - 저장 기준: ${SPEED_LIMIT_STORAGE === 0 ? '전체 (속도 무관)' : SPEED_LIMIT_STORAGE + 'km/h 이상'}`);
  console.log(`   - 인덱싱 기준: ${SPEED_LIMIT_INDEXING}km/h 이상`);
  console.log(`   - 최대 레코드: ${MAX_RECORDS === null ? '제한 없음 (전체)' : MAX_RECORDS + '건'}`);
  console.log(`   - 인덱싱 API: ${INDEXING_API_BASE_URL}`);
  console.log(`   - Rate Limit: ${RATE_LIMIT_MS}ms\n`);
  
  try {
    // CSV 파싱
    console.log("📖 CSV 파일 읽는 중...");
    const allRecords = parseCSV(CSV_FILE);
    console.log(`✅ 총 ${allRecords.length}개 레코드 로드\n`);
    
    // 데이터 선택 (전체 or 과속만)
    let selectedRecords;
    if (UPLOAD_ALL_DATA) {
      console.log("📋 전체 데이터 선택...");
      selectedRecords = allRecords;
    } else {
      console.log("🔍 과속 데이터 필터링 중...");
      selectedRecords = filterSpeedingData(allRecords);
      console.log(`✅ 과속 레코드: ${selectedRecords.length}건 발견\n`);
    }
    
    // 개수 제한 적용
    const recordsToUpload = MAX_RECORDS === null ? selectedRecords : selectedRecords.slice(0, MAX_RECORDS);
    
    // 시작 인덱스 적용
    const finalRecords = recordsToUpload.slice(START_INDEX);
    console.log(`📤 업로드할 레코드: ${finalRecords.length}건 (${START_INDEX}번부터 시작)\n`);
    
    // 컨트랙트 연결 (Hardhat이 네트워크 설정을 자동 처리)
    const [signer] = await hre.ethers.getSigners();
    const contract = await hre.ethers.getContractAt("PvdRecord", CONTRACT_ADDRESS, signer);
    
    const signerAddress = await signer.getAddress();
    const balance = await hre.ethers.provider.getBalance(signerAddress);
    const balanceInEther = hre.ethers.formatEther(balance);
    
    console.log(`📡 컨트랙트 연결 완료`);
    console.log(`   서명자: ${signerAddress}`);
    console.log(`   잔액: ${balanceInEther} ${NETWORK === 'kaia' ? 'KAIA' : 'ETH'}`);
    console.log(`   네트워크: ${hre.network.name}`);
    console.log(`   Chain ID: ${(await hre.ethers.provider.getNetwork()).chainId}`);
    
    // 잔액 경고
    if (parseFloat(balanceInEther) < 0.1) {
      console.log(`\n⚠️  경고: 잔액이 부족합니다! (${balanceInEther} ${NETWORK === 'kaia' ? 'KAIA' : 'ETH'})`);
      console.log(`   업로드 중 실패할 수 있으니 토큰을 충전하세요.`);
    }
    console.log();
    
    // 업로드 시작
    const startTime = Date.now();
    let successCount = 0;
    let failCount = 0;
    let totalGasCost = 0;
    let indexedCount = 0;      // 인덱싱 성공 카운트
    let indexedFailCount = 0;  // 인덱싱 실패 카운트
    let indexedSkipCount = 0;  // 인덱싱 건너뛰기 카운트 (속도 기준 미달)
    
    console.log("⏳ 데이터 업로드 시작...\n");
    
    for (let i = 0; i < finalRecords.length; i++) {
      const actualIndex = START_INDEX + i; // 실제 레코드 인덱스
      const result = await savePvdToBlockchain(contract, finalRecords[i], actualIndex);
      
      if (result) {
        successCount++;
        totalGasCost += result.gasCost || 0;
        
        // 인덱싱 결과 추적
        if (result.indexed === true) {
          indexedCount++;
        } else if (result.indexed === false) {
          // 속도 기준 확인
          const speed = parseInt(finalRecords[i].SPEED);
          if (speed < SPEED_LIMIT_INDEXING) {
            indexedSkipCount++;
          } else {
            indexedFailCount++;
          }
        }
      } else {
        failCount++;
      }
      
      // 진행률 표시 (BATCH_SIZE마다 또는 마지막)
      if ((i + 1) % BATCH_SIZE === 0 || i === finalRecords.length - 1) {
        const progress = ((i + 1) / finalRecords.length * 100).toFixed(1);
        const elapsed = (Date.now() - startTime) / 1000;
        const avgSpeed = successCount / elapsed;
        const estimated = (finalRecords.length - (i + 1)) / avgSpeed;
        
        // 현재 잔액 확인 (50개마다)
        let balanceInfo = '';
        if ((i + 1) % 50 === 0) {
          const currentBalance = await hre.ethers.provider.getBalance(signerAddress);
          const currentBalanceInEther = hre.ethers.formatEther(currentBalance);
          balanceInfo = ` | 잔액: ${parseFloat(currentBalanceInEther).toFixed(4)} ${NETWORK === 'kaia' ? 'KAIA' : 'ETH'}`;
        }
        
        console.log(`📊 진행률: ${i + 1}/${finalRecords.length} (${progress}%) | 저장: ${successCount} | 실패: ${failCount} | 인덱싱: ${indexedCount}/${indexedCount + indexedSkipCount + indexedFailCount}${balanceInfo}`);
        console.log(`   가스 총합: ${totalGasCost.toFixed(6)} | 예상 남은 시간: ${estimated.toFixed(0)}초\n`);
      }
      
      // Rate limiting
      await new Promise(resolve => setTimeout(resolve, RATE_LIMIT_MS));
    }
    
    const totalTime = Date.now() - startTime;
    
    // 최종 잔액 확인
    const finalBalance = await hre.ethers.provider.getBalance(signerAddress);
    const finalBalanceInEther = hre.ethers.formatEther(finalBalance);
    const usedBalance = parseFloat(balanceInEther) - parseFloat(finalBalanceInEther);
    
    console.log("\n" + "=".repeat(70));
    console.log("✅ 업로드 완료!");
    console.log("=".repeat(70));
    console.log(`\n📊 블록체인 저장 결과:`);
    console.log(`   성공: ${successCount}/${finalRecords.length}건`);
    console.log(`   실패: ${failCount}건`);
    console.log(`\n📇 인덱싱 결과:`);
    console.log(`   인덱싱 성공: ${indexedCount}건`);
    console.log(`   인덱싱 건너뜀: ${indexedSkipCount}건 (${SPEED_LIMIT_INDEXING}km/h 미만)`);
    console.log(`   인덱싱 실패: ${indexedFailCount}건`);
    console.log(`   총 인덱싱 대상: ${indexedCount + indexedFailCount}건 (${SPEED_LIMIT_INDEXING}km/h 이상)`);
    console.log(`\n⏱️  성능:`);
    console.log(`   소요 시간: ${(totalTime / 1000).toFixed(2)}초 (${(totalTime / 1000 / 60).toFixed(2)}분)`);
    console.log(`   평균 속도: ${(successCount / (totalTime / 1000)).toFixed(2)}건/초`);
    console.log(`\n💰 가스 사용:`);
    console.log(`   총 가스 비용: ${totalGasCost.toFixed(6)} ${NETWORK === 'kaia' ? 'KAIA' : 'ETH'}`);
    console.log(`   시작 잔액: ${parseFloat(balanceInEther).toFixed(6)} ${NETWORK === 'kaia' ? 'KAIA' : 'ETH'}`);
    console.log(`   최종 잔액: ${parseFloat(finalBalanceInEther).toFixed(6)} ${NETWORK === 'kaia' ? 'KAIA' : 'ETH'}`);
    console.log(`   사용한 금액: ${usedBalance.toFixed(6)} ${NETWORK === 'kaia' ? 'KAIA' : 'ETH'}`);
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

