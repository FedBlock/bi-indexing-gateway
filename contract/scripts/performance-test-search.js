#!/usr/bin/env node

/**
 * 검색 성능 테스트 스크립트
 * 블록체인 직접 검색 vs 인덱스 기반 검색의 성능을 비교합니다.
 * 멀티스레드로 병렬 검색 처리합니다.
 */

const ethers = require('ethers');
const { Worker, isMainThread, parentPort, workerData } = require('worker_threads');
const path = require('path');
const fs = require('fs');

// 설정
const INDEXING_API_BASE_URL = "https://grnd.bimatrix.co.kr/bc/idx";
const CONTRACT_ADDRESS = '0xcBf9a9d52b75218D06af17f03D8a236550db879F';
const NETWORK = 'kaia';
const PURPOSES = ['심박수', '혈당', '혈압'];

// Worker 스레드에서 실행되는 코드
if (!isMainThread) {
  performIndexSearch(workerData.purpose, workerData.index)
    .then(result => {
      parentPort.postMessage({ success: true, result });
    })
    .catch(error => {
      parentPort.postMessage({ success: false, error: error.message });
    });
}

/**
 * 인덱스 기반 검색 수행 (Worker 스레드에서 실행)
 * 1. 인덱스에서 tx 해시 목록 가져오기
 * 2. 블록체인에서 병렬로 상세 정보 조회
 */
async function performIndexSearch(purpose, workerIndex) {
  const startTime = Date.now();
  
  try {
    console.log(`[Worker ${workerIndex}] 🔍 인덱스 검색 시작: ${purpose}`);
    
    // 1. 인덱싱 API로 트랜잭션 해시 검색
    const response = await fetch(`${INDEXING_API_BASE_URL}/api/index/search`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        IndexName: 'purpose',
        Field: 'IndexableData',
        Value: purpose,
        KeySize: 64,
        ComOp: 'Eq'
      })
    });

    if (!response.ok) {
      throw new Error(`API 요청 실패: ${response.status}`);
    }

    const data = await response.json();
    const txIds = data.data?.IdxData || [];
    
    console.log(`[Worker ${workerIndex}] 📊 ${txIds.length}개 트랜잭션 발견`);
    
    if (txIds.length === 0) {
      const endTime = Date.now();
      return {
        purpose,
        count: 0,
        responseTime: endTime - startTime,
        success: true
      };
    }
    
    // 2. 트랜잭션 해시 목록만 반환 (상세 조회는 옵션)
    console.log(`[Worker ${workerIndex}] ✅ ${txIds.length}개 트랜잭션 해시 조회 완료`);
    
    const endTime = Date.now();
    
    return {
      purpose,
      count: txIds.length,
      responseTime: endTime - startTime,
      success: true
    };
  } catch (error) {
    const endTime = Date.now();
    return {
      purpose,
      count: 0,
      responseTime: endTime - startTime,
      success: false,
      error: error.message
    };
  }
}

/**
 * 블록체인 직접 검색 (Provider 사용)
 */
async function performBlockchainDirectSearch(provider, purpose) {
  const startTime = Date.now();
  
  console.log(`🔗 블록체인 직접 검색 시작: ${purpose}`);
  
  try {
    const ABI_PATH = path.join(__dirname, '../artifacts/contracts/AccessManagement.sol/AccessManagement.json');
    const abiFile = JSON.parse(fs.readFileSync(ABI_PATH, 'utf8'));
    const abi = abiFile.abi; // artifacts 파일에서 abi 추출
    
    const contract = new ethers.Contract(CONTRACT_ADDRESS, abi, provider);
    
    // 1. 전체 요청 개수 조회
    const totalCount = await contract.getTotalRequestCount();
    console.log(`📊 전체 요청 개수: ${totalCount.toString()}`);
    
    if (totalCount.toString() === "0") {
      console.log(`⚠️ 데이터가 없습니다.`);
      const endTime = Date.now();
      return {
        purpose,
        count: 0,
        responseTime: endTime - startTime,
        success: true
      };
    }
    
    // 2. 전체 요청 가져오기 (한 번에)
    console.log(`📥 전체 데이터 조회 중...`);
    const allRequests = await contract.getRequestsInRange(1, totalCount.toString());
    console.log(`✅ 전체 ${allRequests.length}개 요청 조회 완료`);
    
    // 3. 클라이언트 측 필터링
    const statusMap = ['PENDING', 'APPROVED', 'REJECTED'];
    const filteredResults = allRequests
      .map((request, index) => ({
        requestId: index + 1,
        requester: request.requester,
        resourceOwner: request.resourceOwner,
        purpose: request.purpose,
        organizationName: request.organizationName,
        status: statusMap[Number(request.status)] || 'PENDING'
      }))
      .filter(request => request.purpose === purpose);
    
    console.log(`🔍 필터링 결과: ${filteredResults.length}개 (검색 목적: "${purpose}")`);
    
    const endTime = Date.now();
    
    return {
      purpose,
      count: filteredResults.length,
      responseTime: endTime - startTime,
      success: true,
      requests: filteredResults
    };
  } catch (error) {
    const endTime = Date.now();
    return {
      purpose,
      count: 0,
      responseTime: endTime - startTime,
      success: false,
      error: error.message
    };
  }
}

/**
 * 메인 테스트 실행
 */
async function runPerformanceTest() {
  console.log('\n🚀 ===== 검색 성능 테스트 시작 =====\n');
  
  // Provider 연결
  const networkConfig = {
    kaia: 'https://public-en-kairos.node.kaia.io'
  };
  
  const provider = new ethers.JsonRpcProvider(networkConfig[NETWORK]);
  console.log(`✅ ${NETWORK} Provider 연결 완료\n`);
  
  const results = {
    blockchain: [],
    index: []
  };
  
  // 🚀 특정 검색어로 병렬 검색 테스트
  const TEST_PURPOSE = '심박수'; // 테스트할 목적 선택
  console.log(`\n🚀 === 병렬 검색 시작 (${TEST_PURPOSE}) ===\n`);
  
  // 0. 먼저 컨트랙트에 데이터가 있는지 확인
  const ABI_PATH_CHECK = path.join(__dirname, '../artifacts/contracts/AccessManagement.sol/AccessManagement.json');
  const abiFileCheck = JSON.parse(fs.readFileSync(ABI_PATH_CHECK, 'utf8'));
  const abiCheck = abiFileCheck.abi;
  const contractCheck = new ethers.Contract(CONTRACT_ADDRESS, abiCheck, provider);
  
  try {
    const totalCount = await contractCheck.getTotalRequestCount();
    console.log(`📊 컨트랙트 전체 요청 개수: ${totalCount.toString()}`);
    
    if (totalCount.toString() === "0") {
      console.log(`\n⚠️ 컨트랙트에 데이터가 없습니다. 인덱스 검색만 수행합니다.\n`);
    } else {
      // 첫 번째 요청 확인
      const firstRequest = await contractCheck.getRequestById(1);
      console.log(`📝 첫 번째 요청 목적: "${firstRequest.purpose}"\n`);
    }
  } catch (err) {
    console.log(`⚠️ 컨트랙트 조회 실패: ${err.message}\n`);
  }
  
  // 1. 인덱스에서 tx 해시 목록만 가져오기 (상세 조회 없음)
  console.log(`🔍 인덱스 검색: tx 해시 목록만 조회`);
  const indexStartTime = Date.now();
  
  const indexResponse = await fetch(`${INDEXING_API_BASE_URL}/api/index/search`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      IndexName: 'purpose',
      Field: 'IndexableData',
      Value: TEST_PURPOSE,
      KeySize: 64,
      ComOp: 'Eq'
    })
  });
  
  const indexData = await indexResponse.json();
  const txIds = indexData.data?.IdxData || [];
  const indexTime = Date.now() - indexStartTime;
  
  console.log(`✅ 인덱스 검색 완료: ${txIds.length}개 트랜잭션 발견 (${indexTime}ms)\n`);
  
  // 2. 인덱스 기반 병렬 조회
  console.log(`⚡ 인덱스 기반 병렬 검색: ${txIds.length}개 tx 상세 정보 조회`);
  const indexParallelStartTime = Date.now();
  
  const ABI_PATH = path.join(__dirname, '../artifacts/contracts/AccessManagement.sol/AccessManagement.json');
  const abiFile = JSON.parse(fs.readFileSync(ABI_PATH, 'utf8'));
  const abi = abiFile.abi;
  const contract = new ethers.Contract(CONTRACT_ADDRESS, abi, provider);
  
  // 병렬로 트랜잭션 조회
  const blockchainPromises = txIds.map(async (txId, index) => {
    try {
      const receipt = await provider.getTransactionReceipt(txId);
      if (!receipt || !receipt.logs || receipt.logs.length === 0) {
        return { success: false };
      }
      
      const iface = new ethers.Interface(abi);
      for (const log of receipt.logs) {
        try {
          const parsed = iface.parseLog(log);
          
          if (parsed && parsed.name === 'AccessRequestsSaved') {
            const args = parsed.args;
            const rawRequestId = args.requestId !== undefined ? args.requestId : args[0];
            const eventRequestId = rawRequestId ? 
              (typeof rawRequestId === 'object' && rawRequestId._isBigNumber ? 
                rawRequestId.toNumber() : 
                Number(rawRequestId)) : 
              null;
            
            if (eventRequestId !== null && eventRequestId !== undefined) {
              try {
                const requestDetails = await contract.getRequestById(eventRequestId);
                return { requestDetails, success: true };
              } catch (err) {
                // 컨트랙트 조회 실패 무시
              }
            }
          }
        } catch (e) {
          // 이벤트 파싱 실패는 정상
        }
      }
    } catch (err) {
      // tx 조회 실패 무시
    }
    return { success: false };
  });
  
  const indexParallelResults = await Promise.all(blockchainPromises);
  const indexParallelValid = indexParallelResults.filter(r => r.success === true);
  const indexParallelTime = Date.now() - indexParallelStartTime;
  
  console.log(`✅ 병렬 조회 완료: ${indexParallelValid.length}개 성공 (${indexParallelTime}ms)\n`);
  
  // 3. 블록체인 직접 검색
  console.log(`🔗 블록체인 직접 검색 시작`);
  const directSearchResult = await performBlockchainDirectSearch(provider, TEST_PURPOSE);
  
  // 4. 결과 비교
  console.log('\n═══════════════════════════════════════');
  console.log('📊 성능 비교 결과');
  console.log('═══════════════════════════════════════');
  console.log(`검색 목적: ${TEST_PURPOSE}`);
  console.log(`\n1️⃣ 인덱스 기반 검색:`);
  console.log(`   📝 인덱스 검색: ${indexTime}ms → ${txIds.length}개 tx 발견`);
  console.log(`   ⚡ 병렬 상세 조회: ${indexParallelTime}ms → ${indexParallelValid.length}개 조회`);
  const totalIndexTime = indexTime + indexParallelTime;
  console.log(`   📊 총 시간: ${indexTime}ms + ${indexParallelTime}ms = ${totalIndexTime}ms`);
  
  console.log(`\n2️⃣ 블록체인 직접 검색:`);
  console.log(`   📥 전체 데이터 조회: ${directSearchResult.responseTime}ms → ${directSearchResult.count}개 발견`);
  
  console.log(`\n✨ 성능 비교:`);
  if (totalIndexTime < directSearchResult.responseTime) {
    const diff = ((directSearchResult.responseTime / totalIndexTime - 1) * 100).toFixed(1);
    console.log(`   인덱스 기반이 ${diff}% 빠름!`);
    console.log(`   시간 절약: ${directSearchResult.responseTime - totalIndexTime}ms`);
  } else {
    const diff = ((totalIndexTime / directSearchResult.responseTime - 1) * 100).toFixed(1);
    console.log(`   블록체인 직접이 ${diff}% 빠름`);
  }
  
  console.log(`\n💡 분석:`);
  console.log(`   - 인덱스: 필요한 ${txIds.length}개만 조회`);
  console.log(`   - 직접: 전체 1000개 조회 후 필터링`);
  console.log(`   - 병렬 처리로 각 tx 조회 시간 단축\n`);
  
  // 결과 저장 (비교용)
  results.blockchain.push({
    purpose: TEST_PURPOSE,
    count: directSearchResult.count,
    responseTime: directSearchResult.responseTime,
    success: directSearchResult.success
  });
  
  results.index.push({
    purpose: TEST_PURPOSE,
    count: indexParallelValid.length,
    responseTime: indexTime + indexParallelTime,
    success: true
  });
  
  // 전체 결과 요약
  console.log('\n\n🏆 ===== 전체 성능 비교 요약 =====\n');
  
  const blockchainAvg = results.blockchain.reduce((sum, r) => sum + r.responseTime, 0) / results.blockchain.length;
  const indexAvg = results.index.reduce((sum, r) => sum + r.responseTime, 0) / results.index.length;
  
  console.log(`📊 평균 응답 시간:`);
  console.log(`   블록체인 직접: ${blockchainAvg.toFixed(2)}ms`);
  console.log(`   인덱스 기반: ${indexAvg.toFixed(2)}ms`);
  
  if (blockchainAvg < indexAvg) {
    const diff = ((indexAvg / blockchainAvg - 1) * 100).toFixed(1);
    console.log(`\n✨ 블록체인 직접 검색이 평균 ${diff}% 빠름!\n`);
  } else if (indexAvg < blockchainAvg) {
    const diff = ((blockchainAvg / indexAvg - 1) * 100).toFixed(1);
    console.log(`\n✨ 인덱스 기반 검색이 평균 ${diff}% 빠름!\n`);
  } else {
    console.log(`\n✨ 평균 속도 동일\n`);
  }
  
  console.log(`📊 결과 개수 비교:`);
  results.blockchain.forEach((r, i) => {
    console.log(`   ${PURPOSES[i]}: 직접=${r.count}, 인덱스=${results.index[i].count}`);
  });
  
  console.log('\n✅ 테스트 완료!\n');
}

// 메인 스레드에서만 실행
if (isMainThread) {
  runPerformanceTest()
    .then(() => process.exit(0))
    .catch(error => {
      console.error('❌ 테스트 실패:', error);
      process.exit(1);
    });
}

