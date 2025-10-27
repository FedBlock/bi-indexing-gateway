const hre = require("hardhat");

// 설정 - Kaia 테스트넷
const CONTRACT_ADDRESS = "0xcBf9a9d52b75218D06af17f03D8a236550db879F"; // Kaia 테스트넷
const REQUESTER_ADDRESS = "0xa5cc9D9F1f68546060852f7c685B99f0cD532229"; // 요청자 주소
const REQUESTER_PRIV = "d67ceaf47fbb661f7746872e539db56b2d4c9e402e52df4a4c88de22e9904ea8"; // Kaia 계정 Private Key
const RESOURCE_OWNERS = [
  "0x96c205b16bf94412b83cf21d32ea5cbd71da3d94",
  "0x21f8814f066283411015ceffa752e4d991fb3990"
]; // 리소스 소유자들
const ORGANIZATION_NAME = "BIHEALTH"; // 고정 조직명

const NETWORK = 'kaia'; // Kaia 테스트넷
const INDEXING_API_BASE_URL = process.env.REACT_APP_INDEXING_API_URL || "https://grnd.bimatrix.co.kr/bc/idx";

// Purpose별 통계 추적
const purposeStats = {
  '심박수': 0,
  '혈당': 0,
  '혈압': 0
};

// 인덱스 ID 캐시
let cachedIndexId = null;

/**
 * 단일 요청 생성 및 인덱싱
 */
async function createRequest(contract, requester, purpose, organizationName, index, resourceOwner) {
  try {
    // 컨트랙트에 요청 생성
    const tx = await contract.saveRequest(resourceOwner, purpose, organizationName);
    const receipt = await tx.wait();
    
    const txHash = tx.hash;
    const blockNumber = receipt.blockNumber;
    
    console.log(`✅ 요청 ${index + 1} 완료 - TxID: ${txHash}`);
    
    // 바로 인덱싱 처리
    await indexData(txHash, purpose, organizationName, blockNumber, resourceOwner);
    
    purposeStats[purpose]++;
    return { txHash, blockNumber };
    
  } catch (error) {
    console.error(`❌ 요청 ${index + 1} 실패:`, error.message);
    return null;
  }
}

/**
 * 인덱스 ID 조회 (첫 요청 시 한 번만)
 */
async function getIndexId() {
  if (cachedIndexId) {
    return cachedIndexId;
  }
  
  try {
    const response = await fetch(`${INDEXING_API_BASE_URL}/api/index/list`, {
      signal: AbortSignal.timeout(5000)
    });
    
    if (!response.ok) {
      throw new Error(`인덱스 목록 조회 실패: HTTP ${response.status}`);
    }
    
    const indexData = await response.json();
    const purposeIndex = indexData.data?.indexes?.find(idx => 
      idx.indexingKey === 'purpose' && idx.network === NETWORK
    );
    
    if (!purposeIndex) {
      throw new Error(`${NETWORK} 네트워크에 purpose 인덱스가 생성되지 않았습니다.`);
    }
    
    cachedIndexId = purposeIndex.indexId;
    console.log(`✅ 인덱스 ID 조회 완료: ${cachedIndexId}`);
    return cachedIndexId;
    
  } catch (error) {
    console.error(`❌ 인덱스 ID 조회 실패:`, error.message);
    return null;
  }
}

/**
 * 데이터 인덱싱 (백엔드 API 사용)
 */
async function indexData(txHash, purpose, organizationName, blockNumber, resourceOwner) {
  try {
    // 인덱스 ID 가져오기
    const indexId = await getIndexId();
    if (!indexId) {
      console.error(`⚠️  인덱스 ID를 찾을 수 없어 인덱싱을 건너뜁니다.`);
      return;
    }
    
    const indexingPayload = {
      indexId: indexId,  // 실제 indexId 사용 (예: "001")
      txId: txHash,
      data: {
        purpose: purpose,
        organization: organizationName,
        requester: REQUESTER_ADDRESS,
        blockNumber: blockNumber,
        txStatus: 1,
        resourceOwner: resourceOwner,
        client_id: 'script'
      },
      network: NETWORK,
      contractAddress: CONTRACT_ADDRESS,
      schema: "purpose",
      indexingKey: "purpose"
    };
    
    const indexingResponse = await fetch(`${INDEXING_API_BASE_URL}/api/index/insert`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(indexingPayload),
      signal: AbortSignal.timeout(5000)
    });
    
    if (indexingResponse.ok) {
      const result = await indexingResponse.json();
      console.log(`✅ 인덱싱 완료!`);
    } else {
      const errorData = await indexingResponse.json();
      console.error(`❌ 인덱싱 실패 (HTTP ${indexingResponse.status}):`, errorData);
    }
    
  } catch (error) {
    console.error(`❌ 인덱싱 에러:`, error.message);
  }
}

/**
 * 메인 함수
 */
async function main() {
  // ============================================
  // 설정: 각 purpose별 생성할 개수를 지정하세요
  // ============================================
  const PURPOSE_COUNTS = {
    '심박수': 350,  // 심박수 요청 350건
    '혈당': 330,   // 혈당 요청 330건
    '혈압': 320    // 혈압 요청 320건
  };
  
  // ============================================
  
  // 명령행 인수에서 개수 오버라이드
  const args = process.argv.slice(2);
  const heartRateCount = parseInt(args.find(arg => arg.startsWith('-심박수='))?.split('=')[1]) || PURPOSE_COUNTS['심박수'];
  const bloodSugarCount = parseInt(args.find(arg => arg.startsWith('-혈당='))?.split('=')[1]) || PURPOSE_COUNTS['혈당'];
  const bloodPressureCount = parseInt(args.find(arg => arg.startsWith('-혈압='))?.split('=')[1]) || PURPOSE_COUNTS['혈압'];
  
  const finalCounts = {
    '심박수': heartRateCount,
    '혈당': bloodSugarCount,
    '혈압': bloodPressureCount
  };
  
  const TOTAL_COUNT = finalCounts['심박수'] + finalCounts['혈당'] + finalCounts['혈압'];
  
  console.log('🏥 건강 데이터 요청 생성 스크립트 시작');
  console.log('📊 생성할 요청:');
  console.log(`   - 심박수: ${finalCounts['심박수']}건`);
  console.log(`   - 혈당: ${finalCounts['혈당']}건`);
  console.log(`   - 혈압: ${finalCounts['혈압']}건`);
  console.log(`   총 ${TOTAL_COUNT}건`);
  console.log(`🌐 인덱싱 API: ${INDEXING_API_BASE_URL}`);
  console.log('');
  
  const purposes = ['심박수', '혈당', '혈압'];
  
  // 각 purpose별 요청 리스트 생성
  const requestList = [];
  Object.entries(finalCounts).forEach(([purpose, count]) => {
    for (let i = 0; i < count; i++) {
      requestList.push(purpose);
    }
  });
  
  // 랜덤 순서로 섞기
  for (let i = requestList.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [requestList[i], requestList[j]] = [requestList[j], requestList[i]];
  }
  
  try {
    // Kaia 테스트넷 provider 설정
    const provider = new hre.ethers.JsonRpcProvider("https://public-en-kairos.node.kaia.io");
    const requester = new hre.ethers.Wallet(REQUESTER_PRIV, provider);
    const contract = await hre.ethers.getContractAt("AccessManagement", CONTRACT_ADDRESS, requester);
    
    console.log('📡 컨트랙트 연결 정보:');
    console.log(`   요청자 주소: ${requester.address}`);
    console.log(`   컨트랙트 주소: ${CONTRACT_ADDRESS}`);
    console.log(`   조직명: ${ORGANIZATION_NAME}`);
    console.log(`   리소스 소유자: ${RESOURCE_OWNERS.join(', ')}`);
    console.log('');
    
    // 요청 생성 시작
    const startTime = Date.now();
    let successCount = 0;
    
    console.log('🚀 요청 생성 시작...');
    console.log('');
    
    for (let i = 0; i < requestList.length; i++) {
      const purpose = requestList[i];
      const organizationName = ORGANIZATION_NAME; // 고정 조직명
      const resourceOwner = RESOURCE_OWNERS[Math.floor(Math.random() * RESOURCE_OWNERS.length)]; // 랜덤 리소스 소유자
      
      const result = await createRequest(contract, requester, purpose, organizationName, i, resourceOwner);
      
      if (result) {
        successCount++;
      }
      
      // 진행률 표시
      if ((i + 1) % 100 === 0 || i === requestList.length - 1) {
        const progress = ((i + 1) / requestList.length * 100).toFixed(1);
        console.log(`📊 진행률: ${i + 1}/${requestList.length} (${progress}%)`);
      }
      
      // Rate limiting - 트랜잭션이 성공적으로 처리되도록 대기
      await new Promise(resolve => setTimeout(resolve, 200));
    }
    
    const totalTime = Date.now() - startTime;
    
    console.log('');
    console.log('═══════════════════════════════════════');
    console.log('✅ 모든 요청 생성 완료!');
    console.log(`📊 총 생성 요청: ${successCount}/${requestList.length}건`);
    console.log(`⏱️  소요 시간: ${totalTime}ms (약 ${Math.round(totalTime / 1000)}초)`);
    console.log(`📈 평균 처리 속도: ${Math.round(successCount / (totalTime / 1000))}건/초`);
    console.log('');
    console.log('📊 Purpose별 통계:');
    Object.entries(purposeStats).forEach(([purpose, count]) => {
      const expected = finalCounts[purpose];
      console.log(`   - ${purpose}: ${count}건 (목표: ${expected}건)`);
    });
    console.log('═══════════════════════════════════════');
    
  } catch (error) {
    console.error('');
    console.error('❌ 스크립트 실행 실패:', error.message);
    if (error.stack) {
      console.error('스택 트레이스:', error.stack);
    }
    process.exit(1);
  }
}

// 스크립트 실행
main();

