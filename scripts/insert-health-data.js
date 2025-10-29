#!/usr/bin/env node

/**
 * 건강 데이터 요청 1000건 생성 스크립트
 * 검색 목적: 심박수, 혈당, 혈압
 * AccessManagement 컨트랙트에 요청을 생성하고 인덱싱
 */

const hre = require('hardhat');
const IndexingClient = require('../lib/indexing-client');

// 설정
const CONTRACT_ADDRESS = "0x5FbDB2315678afecb367f032d93F642f64180aa3";
const RESOURCE_OWNER = "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266";
const REQUESTER_PRIV = "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d";

const PROTO_PATH = '/home/blockchain/fedblock/bi-index/idxmngr-go/protos/index_manager.proto';
const NETWORK = 'hardhat-local';

// Purpose별 통계 추적
const purposeStats = {
  '심박수': 0,
  '혈당': 0,
  '혈압': 0
};

/**
 * 단일 요청 생성 및 인덱싱
 */
async function createRequest(contract, requester, purpose, organizationName, index) {
  try {
    console.log(`📤 요청 ${index + 1} 전송 중... (purpose: ${purpose})`);
    
    // 컨트랙트에 요청 생성
    const tx = await contract.saveRequest(RESOURCE_OWNER, purpose, organizationName);
    const receipt = await tx.wait();
    
    // 이벤트에서 requestId 추출
    const event = receipt.logs?.find((log) => {
      try {
        const parsedLog = contract.interface.parseLog(log);
        return parsedLog && parsedLog.name === 'AccessRequestsSaved';
      } catch {
        return false;
      }
    });
    
    if (event) {
      const parsedLog = contract.interface.parseLog(event);
      const requestId = parsedLog.args.requestId.toString();
      const txHash = tx.hash;
      
      console.log(`✅ 요청 ${index + 1} 완료 - TxID: ${txHash}`);
      
      // 인덱싱 처리
      await indexData(txHash, purpose, organizationName, receipt.blockNumber);
      
      purposeStats[purpose]++;
      return { requestId, txHash };
    } else {
      console.log(`⚠️  이벤트를 찾을 수 없음`);
      return null;
    }
    
  } catch (error) {
    console.error(`❌ 요청 ${index + 1} 실패:`, error.message);
    return null;
  }
}

/**
 * 데이터 인덱싱
 */
async function indexData(txHash, purpose, organizationName, blockNumber) {
  try {
    const indexingClient = new IndexingClient({
      serverAddr: 'localhost:50052',
      protoPath: PROTO_PATH
    });
    
    await indexingClient.connect();
    
    const indexID = 'purpose';
    const filePath = `data/${NETWORK}/purpose.bf`;
    const timestamp = new Date().toISOString();
    
    const insertRequest = {
      IndexID: indexID,
      BcList: [{
        TxId: txHash,
        KeyCol: 'IndexableData',
        IndexableData: {
          TxId: txHash,
          ContractAddress: CONTRACT_ADDRESS,
          EventName: 'AccessRequestsSaved',
          Timestamp: timestamp,
          BlockNumber: blockNumber,
          DynamicFields: {
            key: purpose,
            purpose: purpose,
            organizationName: organizationName,
            network: NETWORK,
            timestamp: timestamp
          },
          SchemaVersion: '1.0'
        }
      }],
      ColName: 'IndexableData',
      ColIndex: indexID,
      FilePath: filePath,
      Network: NETWORK
    };
    
    await indexingClient.insertData(insertRequest);
    await indexingClient.close();
    
  } catch (error) {
    console.error('❌ 인덱싱 실패:', error.message);
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
  console.log('');
  
  const purposes = ['심박수', '혈당', '혈압'];
  const organizations = [
    '서울대학교병원',
    '세브란스병원',
    '삼성서울병원',
    '아산병원',
    '가톨릭의대',
    '한양대학교병원',
    '분당서울대학교병원',
    '순천향대학교병원',
    '경희대학교병원',
    '고려대학교병원'
  ];
  
  // 각 purpose별 요청 리스트 생성
  const requestList = [];
  Object.entries(finalCounts).forEach(([purpose, count]) => {
    for (let i = 0; i < count; i++) {
      requestList.push(purpose);
    }
  });
  
  // 랜덤 순서로 섞기 (섞지 않으려면 이 줄 삭제)
  for (let i = requestList.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [requestList[i], requestList[j]] = [requestList[j], requestList[i]];
  }
  
  try {
    // Hardhat provider 설정
    const provider = hre.ethers.provider;
    const requester = new hre.ethers.Wallet(REQUESTER_PRIV, provider);
    const contract = await hre.ethers.getContractAt("AccessManagement", CONTRACT_ADDRESS, requester);
    
    console.log('📡 컨트랙트 연결 정보:');
    console.log(`   요청자 주소: ${requester.address}`);
    console.log(`   컨트랙트 주소: ${CONTRACT_ADDRESS}`);
    console.log(`   리소스 소유자: ${RESOURCE_OWNER}`);
    console.log('');
    
    // 요청 생성 시작
    const startTime = Date.now();
    let successCount = 0;
    
    console.log('🚀 요청 생성 시작...');
    console.log('');
    
    for (let i = 0; i < requestList.length; i++) {
      const purpose = requestList[i];
      const organizationName = organizations[Math.floor(Math.random() * organizations.length)];
      
      const result = await createRequest(contract, requester, purpose, organizationName, i);
      
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
