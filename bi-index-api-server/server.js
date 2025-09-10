const express = require('express');
const cors = require('cors');
const path = require('path');
const { ethers } = require('ethers');

// =========================
// ABI 디코딩 공통 함수
// =========================

/**
 * 트랜잭션 ABI 디코딩 (AccessManagement 전용)
 * @param {Object} tx - 트랜잭션 객체
 * @param {Object} receipt - 트랜잭션 영수증
 * @returns {Object} 디코딩된 함수 및 이벤트 정보
 */
function decodeTransactionABI(tx, receipt) {
  let decodedFunction = null;
  let decodedLogs = [];
  let functionStringParams = {}; // 함수에서 추출한 string 파라미터들

  try {
    // AccessManagement 컨트랙트 ABI 로드
    const AccessManagementArtifact = require('../contract/artifacts/contracts/AccessManagement.sol/AccessManagement.json');
    const contractInterface = new ethers.Interface(AccessManagementArtifact.abi);

    console.log(`🔍 AccessManagement ABI로 디코딩 시도: ${tx.data?.substring(0, 10)}...`);

    // 함수 디코딩
    if (tx.data && tx.data !== '0x') {
      try {
        const decodedData = contractInterface.parseTransaction({
          data: tx.data,
          value: tx.value
        });

        if (decodedData && decodedData.name) {
          console.log(`✅ 함수 디코딩 성공: ${decodedData.name}`);

          decodedFunction = {
            name: decodedData.name || 'Unknown',
            signature: decodedData.signature || 'Unknown',
            parameters: []
          };

          if (decodedData.args && decodedData.fragment && decodedData.fragment.inputs) {
            decodedFunction.parameters = decodedData.args.map((arg, index) => {
              const param = decodedData.fragment.inputs[index];
              let value;
              
              // 타입별 적절한 변환 처리
              if (param && param.type === 'string') {
                // string 타입의 경우 더 안전한 변환
                if (typeof arg === 'string') {
                  value = arg;
                } else if (arg && typeof arg === 'object' && arg.toString && arg.toString() !== '[object Object]') {
                  value = arg.toString();
                } else if (arg && typeof arg === 'object' && arg.value !== undefined) {
                  value = String(arg.value);
                } else if (arg) {
                  // 최후의 수단: JSON.stringify 시도
                  try {
                    const stringified = JSON.stringify(arg);
                    value = stringified !== '{}' ? stringified : String(arg);
                  } catch {
                    value = String(arg);
                  }
                } else {
                  value = 'null';
                }
              } else if (param && param.type === 'address') {
                value = arg ? arg.toString() : 'null';
              } else if (param && param.type.startsWith('uint')) {
                value = arg ? arg.toString() : 'null';
              } else {
                value = arg ? arg.toString() : 'null';
              }
              
              console.log(`🔧 함수 파라미터 디코딩: ${param?.name} (${param?.type}) = ${value}`);
              
              // string 파라미터는 나중에 이벤트 디코딩에서 사용하기 위해 저장
              if (param && param.type === 'string' && typeof value === 'string') {
                const hash = ethers.keccak256(ethers.toUtf8Bytes(value));
                functionStringParams[hash] = value;
                console.log(`📝 String 파라미터 저장: ${value} -> ${hash}`);
              }
              
              return {
                name: param ? (param.name || `param${index}`) : `param${index}`,
                type: param ? (param.type || 'unknown') : 'unknown',
                value: value
              };
            });
          }
        }
      } catch (decodeError) {
        console.log(`❌ 함수 디코딩 실패: ${decodeError.message}`);
      }
    }

    // 이벤트 로그 디코딩
    if (receipt && receipt.logs && receipt.logs.length > 0) {
      for (const log of receipt.logs) {
        try {
          const parsedLog = contractInterface.parseLog(log);
          console.log(`✅ 이벤트 디코딩 성공: ${parsedLog.name}`);
          
          decodedLogs.push({
            name: parsedLog.name || 'UnknownEvent',
            signature: parsedLog.signature || 'Unknown',
            address: log.address,
            parameters: parsedLog.args && parsedLog.fragment && parsedLog.fragment.inputs ?
              parsedLog.args.map((arg, index) => {
                const param = parsedLog.fragment.inputs[index];
                let value;
                
                // 타입별 적절한 변환 처리
                if (param && param.type === 'string') {
                  // string 타입의 경우 더 안전한 변환
                  if (typeof arg === 'string') {
                    value = arg;
                  } else if (arg && typeof arg === 'object' && arg._isIndexed && arg.hash) {
                    // indexed string 파라미터 - 함수에서 추출한 값들로 매핑
                    value = functionStringParams[arg.hash] || `Unknown (${arg.hash})`;
                    console.log(`🔍 Indexed string hash: ${arg.hash} -> ${value}`);
                  } else if (arg && typeof arg === 'object' && arg.toString && arg.toString() !== '[object Object]') {
                    value = arg.toString();
                  } else if (arg && typeof arg === 'object' && arg.value !== undefined) {
                    value = String(arg.value);
                  } else if (arg) {
                    // 최후의 수단: JSON.stringify 시도
                    try {
                      const stringified = JSON.stringify(arg);
                      value = stringified !== '{}' ? stringified : String(arg);
                    } catch {
                      value = String(arg);
                    }
                  } else {
                    value = 'null';
                  }
                } else if (param && param.type === 'address') {
                  value = arg ? arg.toString() : 'null';
                } else if (param && param.type.startsWith('uint')) {
                  value = arg ? arg.toString() : 'null';
                } else {
                  value = arg ? arg.toString() : 'null';
                }
                
                console.log(`🔧 파라미터 디코딩: ${param?.name} (${param?.type}) = ${value}`);
                
                return {
                  name: param ? (param.name || `param${index}`) : `param${index}`,
                  type: param ? (param.type || 'unknown') : 'unknown',
                  value: value
                };
              }) : []
          });
        } catch (logDecodeError) {
          console.log(`❌ 이벤트 디코딩 실패: ${logDecodeError.message}`);
          
          // 디코딩 실패한 로그는 원본 그대로
          decodedLogs.push({
            name: 'UnknownEvent',
            address: log.address,
            topics: log.topics,
            data: log.data,
            error: logDecodeError.message
          });
        }
      }
    }

  } catch (error) {
    console.log(`⚠️ ABI 디코딩 실패: ${error.message}`);
  }

  return {
    function: decodedFunction,
    events: decodedLogs
  };
}

// =========================
// Express 서버 설정
// =========================

const app = express();

// 미들웨어 설정
app.use(cors());
app.use(express.json());

// 헬스체크 엔드포인트
app.get('/api/health', (req, res) => {
    res.json({
      success: true,
    message: 'BI-Index API Server is running',
      timestamp: new Date().toISOString()
  });
});

// =========================
// 트랜잭션 목록 조회 (메인 API)
// =========================

app.get('/api/indexed-transactions', async (req, res) => {
  try {
    let { network, purpose, ...customFilters } = req.query; // network, purpose는 필수, 나머지는 필터
    
    // URL 디코딩 처리
    if (purpose) purpose = decodeURIComponent(purpose);
    if (network) network = decodeURIComponent(network);
    
    // 필터들도 URL 디코딩
    for (const [key, value] of Object.entries(customFilters)) {
      customFilters[key] = decodeURIComponent(value);
    }
    
    // 필수 파라미터 검증
    if (!network) {
      return res.status(400).json({
      success: false,
        error: 'network 파라미터가 필요합니다',
        example: '/api/indexed-transactions?network=hardhat-local&purpose=수면&gender=여자'
      });
    }
    
    if (!purpose) {
      return res.status(400).json({
        success: false,
        error: 'purpose 파라미터가 필요합니다',
        example: '/api/indexed-transactions?network=hardhat-local&purpose=수면&gender=여자'
      });
    }
    
    
    const filterInfo = Object.keys(customFilters).length > 0 ? 
      ` (필터: ${Object.entries(customFilters).map(([k,v]) => `${k}=${v}`).join(', ')})` : '';
    console.log(`🔍 인덱스 기반 트랜잭션 목록 조회: ${network}/${purpose}${filterInfo}`);
    const startTime = Date.now();
    
    // 지원되는 네트워크 확인
    const supportedNetworks = ['hardhat-local', 'hardhat', 'monad'];
    if (!supportedNetworks.includes(network)) {
      return res.status(400).json({
      success: false,
        error: `지원되지 않는 네트워크입니다. 지원되는 네트워크: ${supportedNetworks.join(', ')}`,
        network,
        purpose
      });
    }
    
    // 1. 인덱스에서 트랜잭션 ID 목록 조회
    // 다중 purpose 지원 (쉼표로 구분, OR 연산만)
    const purposes = purpose.includes(',') ? purpose.split(',').map(p => p.trim()) : [purpose];
    const operationType = purposes.length > 1 ? 'OR' : 'SINGLE';
    
    console.log(`📊 1단계: purpose 인덱스 검색 중... (${purposes.length}개: ${purposes.join(', ')}, 연산: ${operationType})`);
    
    const IndexingClient = require('../indexing-client-package/lib/indexing-client');
    const networkDir = (network === 'hardhat' || network === 'localhost') ? 'hardhat-local' : network;
    
    let allTxHashes = [];
    let purposeResults = []; // 각 purpose별 결과를 저장
    
    // 각 purpose에 대해 검색
    for (const singlePurpose of purposes) {
    const indexingClient = new IndexingClient({
        serverAddr: 'localhost:50052',
      protoPath: require('path').join(__dirname, '../idxmngr-go/protos/index_manager.proto')
      });
      
        await indexingClient.connect();
        
    const searchRequest = {
        IndexID: 'purpose',
      Field: 'IndexableData',
        Value: singlePurpose,
        FilePath: `data/${networkDir}/purpose.bf`,
      KeySize: 64,
      ComOp: 'Eq'
    };
    
      try {
        const searchResult = await indexingClient.searchData(searchRequest);
        const purposeTxHashes = searchResult.IdxData || [];
        console.log(`📝 "${singlePurpose}" 인덱스에서 ${purposeTxHashes.length}개 트랜잭션 발견`);
        
        purposeResults.push(purposeTxHashes);
      } catch (error) {
        console.log(`⚠️ "${singlePurpose}" 검색 실패: ${error.message}`);
        purposeResults.push([]);
      } finally {
        indexingClient.close();
      }
    }
    
    // 연산 타입에 따라 결과 계산
    if (operationType === 'OR' && purposeResults.length > 1) {
      // 합집합 계산 (중복 제거)
      allTxHashes = [...new Set(purposeResults.flat())];
      console.log(`📝 합집합(OR) 연산 결과: ${allTxHashes.length}개 트랜잭션`);
    } else {
      // 단일 purpose
      allTxHashes = purposeResults.flat();
      console.log(`📝 단일 검색 결과: ${allTxHashes.length}개 트랜잭션`);
    }
    
    let txHashes = allTxHashes;
    console.log(`📝 전체 purpose 검색 결과: ${txHashes.length}개 트랜잭션 발견`);
    
    // 사용자 정의 필터들 적용
    if (Object.keys(customFilters).length > 0 && txHashes.length > 0) {
      console.log(`🔍 사용자 정의 필터 적용: ${Object.keys(customFilters).length}개`);
      
      for (const [filterType, filterValue] of Object.entries(customFilters)) {
        console.log(`🔍 ${filterType} 필터 적용: ${filterValue}`);
        
        // 새로운 클라이언트 연결 생성
        const filterClient = new IndexingClient({
      serverAddr: 'localhost:50052',
      protoPath: require('path').join(__dirname, '../idxmngr-go/protos/index_manager.proto')
    });
    
        const filterSearchRequest = {
          IndexID: filterType,
      Field: 'IndexableData',
          Value: filterValue,
          FilePath: `data/${networkDir}/${filterType}.bf`,
      KeySize: 64,
      ComOp: 'Eq'
    };
    
        try {
          await filterClient.connect();
          const filterSearchResult = await filterClient.searchData(filterSearchRequest);
          filterClient.close();
          const filterTxHashes = filterSearchResult.IdxData || [];
          console.log(`📝 ${filterType} 인덱스에서 ${filterTxHashes.length}개 트랜잭션 발견`);
          
          // 교집합 계산 (기존 결과 ∩ 새 필터)
          txHashes = txHashes.filter(txId => filterTxHashes.includes(txId));
          console.log(`🔗 ${filterType} 필터 적용 후: ${txHashes.length}개 트랜잭션`);
          
          // 결과가 0개면 더 이상 검색할 필요 없음
          if (txHashes.length === 0) break;
        } catch (filterError) {
          console.log(`⚠️ ${filterType} 인덱스 검색 실패: ${filterError.message}`);
          // 해당 인덱스가 없어도 계속 진행
        }
      }
    }
    
    if (txHashes.length === 0) {
      const filterDescription = Object.keys(customFilters).length > 0 ?
        ` (필터: ${Object.entries(customFilters).map(([k,v]) => `${k}=${v}`).join(', ')})` : '';
      
      return res.json({
        success: true,
      network,
        purpose,
        operator: operationType,
        filters: customFilters,
        totalCount: 0,
        transactions: [],
        message: `"${purpose}" 목적${filterDescription}의 트랜잭션을 찾을 수 없습니다`,
        processingTime: `${Date.now() - startTime}ms`
      });
    }
    
    // 2. 각 트랜잭션 상세 조회 및 이벤트 파싱
    console.log(`🔧 2단계: ${txHashes.length}개 트랜잭션 상세 조회 중...`);
    
    // EVM 프로바이더 설정
      let provider;
      if (network === 'hardhat-local' || network === 'hardhat') {
        provider = new ethers.JsonRpcProvider('http://localhost:8545');
    } else if (network === 'monad') {
      provider = new ethers.JsonRpcProvider('https://testnet1.monad.xyz');
    }
    
    const transactions = [];
    const errors = [];
    
    // 병렬 처리로 성능 최적화 (최대 5개씩 동시 처리)
    const batchSize = 5;
    for (let i = 0; i < txHashes.length; i += batchSize) {
      const batch = txHashes.slice(i, i + batchSize);
      const batchPromises = batch.map(async (txId) => {
      try {
        // 트랜잭션과 영수증 조회
        const [tx, receipt] = await Promise.all([
          provider.getTransaction(txId),
          provider.getTransactionReceipt(txId)
        ]);
        
          if (!tx || !receipt) {
            throw new Error(`트랜잭션을 찾을 수 없습니다: ${txId}`);
          }
          
          // 블록 정보 조회 (타임스탬프 필요)
          const block = await provider.getBlock(tx.blockNumber);
          
          // ABI 디코딩
        const decoded = decodeTransactionABI(tx, receipt);
        
          // AccessRequestsSaved 이벤트 찾기
          const accessEvent = decoded.events.find(event => event.name === 'AccessRequestsSaved');
          
          if (accessEvent && accessEvent.parameters) {
            const eventData = {};
            accessEvent.parameters.forEach(param => {
              eventData[param.name] = param.value;
            });
            
            return {
              txId: tx.hash,
              blockNumber: tx.blockNumber,
              timestamp: block ? block.timestamp : null,
              date: block ? new Date(block.timestamp * 1000).toISOString() : null,
              status: receipt.status === 1 ? 'success' : 'failed',
              
              // 이벤트 데이터를 직접 펼치기
              requestId: eventData.requestId || null,
              requester: eventData.requester || null,
              resourceOwner: eventData.resourceOwner || null,
              purpose: eventData.purpose || purpose,
              organizationName: eventData.organizationName || null
            };
        } else {
            // AccessRequestsSaved 이벤트가 없는 경우
            return {
              txId: tx.hash,
              blockNumber: tx.blockNumber,
              timestamp: block ? block.timestamp : null,
              date: block ? new Date(block.timestamp * 1000).toISOString() : null,
              status: receipt.status === 1 ? 'success' : 'failed',
              purpose: purpose,
              error: 'AccessRequestsSaved 이벤트를 찾을 수 없습니다'
            };
    }
    
  } catch (error) {
          console.error(`❌ 트랜잭션 처리 실패 (${txId}):`, error.message);
          errors.push({ txId, error: error.message });
          return null;
        }
      });
      
      const batchResults = await Promise.all(batchPromises);
      transactions.push(...batchResults.filter(result => result !== null));
      
      console.log(`📋 배치 ${Math.floor(i/batchSize) + 1} 완료: ${batchResults.filter(r => r).length}/${batch.length} 성공`);
    }
    
    // 타임스탬프 기준 내림차순 정렬 (최신순)
    transactions.sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));
    
    const processingTime = Date.now() - startTime;
    console.log(`✅ 처리 완료: ${transactions.length}개 성공, ${errors.length}개 실패 (${processingTime}ms)`);
      
      res.json({
        success: true,
      network,
      purpose,
      operator: operationType,
      filters: customFilters,
      totalCount: transactions.length,
      errorCount: errors.length,
      transactions,
      errors: errors.length > 0 ? errors : undefined,
      processingTime: `${processingTime}ms`,
        timestamp: new Date().toISOString()
      });
      
    } catch (error) {
    console.error('❌ 인덱스 기반 트랜잭션 조회 실패:', error);
    res.status(500).json({
      success: false,
      error: error.message,
      network: req.params.network,
      purpose: req.params.purpose,
      timestamp: new Date().toISOString()
    });
  }
});

// =========================
// 사용자 정의 인덱스 등록 API
// =========================

app.post('/api/register-custom-index', async (req, res) => {
  try {
    const { network, txId, indexType, indexValue } = req.body;
    
    console.log(`📝 사용자 정의 인덱스 등록: ${network}/${txId} -> ${indexType}:${indexValue}`);
    
    // 입력값 검증
    if (!network || !txId || !indexType || !indexValue) {
      return res.status(400).json({
        success: false,
        error: '필수 파라미터가 누락되었습니다: network, txId, indexType, indexValue'
      });
    }
    
    // 인덱스 타입 검증 (영문, 숫자, 하이픈만 허용)
    if (!/^[a-zA-Z0-9-]+$/.test(indexType)) {
      return res.status(400).json({
        success: false,
        error: 'indexType은 영문, 숫자, 하이픈만 사용 가능합니다 (예: gender, age, region)'
      });
    }
    
    const supportedNetworks = ['hardhat-local', 'hardhat', 'monad'];
    if (!supportedNetworks.includes(network)) {
      return res.status(400).json({
        success: false,
        error: `지원되지 않는 네트워크입니다. 지원되는 네트워크: ${supportedNetworks.join(', ')}`
      });
    }
    
    // IndexingClient 연결
    const IndexingClient = require('../indexing-client-package/lib/indexing-client');
    const indexingClient = new IndexingClient({
      serverAddr: 'localhost:50052',
      protoPath: require('path').join(__dirname, '../idxmngr-go/protos/index_manager.proto')
    });
    
    await indexingClient.connect();
    
    const networkDir = (network === 'hardhat' || network === 'localhost') ? 'hardhat-local' : network;
    
    // 사용자 정의 인덱스가 없다면 생성
    try {
      const indexInfo = {
        IndexID: indexType,
        FilePath: `data/${networkDir}/${indexType}.bf`,
        KeySize: 64
      };
      
      await indexingClient.createIndex(indexInfo);
      console.log(`✅ ${indexType} 인덱스 생성 완료 (또는 이미 존재)`);
    } catch (createError) {
      console.log(`⚠️ ${indexType} 인덱스 생성 실패 (이미 존재할 수 있음): ${createError.message}`);
    }
    
    // 사용자 정의 데이터 삽입
    const indexData = {
      IndexID: indexType,
      Key: txId,
      IndexableData: indexValue,
      FilePath: `data/${networkDir}/${indexType}.bf`,
      KeySize: 64
    };
    
    await indexingClient.insertData(indexData);
    indexingClient.close();
    
    console.log(`✅ 사용자 정의 인덱스 등록 완료: ${txId} -> ${indexType}:${indexValue}`);
    
    res.json({
      success: true,
      message: '사용자 정의 인덱스 등록 완료',
      network,
          txId,
      indexType,
      indexValue,
      timestamp: new Date().toISOString()
    });
    
  } catch (error) {
    console.error('❌ 사용자 정의 인덱스 등록 실패:', error);
    res.status(500).json({
      success: false,
      error: error.message,
      timestamp: new Date().toISOString()
    });
  }
});

// =========================
// 블록체인 직접 조회 API
// =========================

app.get('/api/blockchain-search', async (req, res) => {
  try {
    let { network, purpose } = req.query;
    
    // URL 디코딩 처리
    if (purpose) purpose = decodeURIComponent(purpose);
    if (network) network = decodeURIComponent(network);
    
    // 필수 파라미터 검증
    if (!network) {
      return res.status(400).json({
        success: false,
        error: 'network 파라미터가 필요합니다',
        example: '/api/blockchain-search?network=hardhat-local&purpose=수면'
      });
    }
    
    if (!purpose) {
        return res.status(400).json({
          success: false,
        error: 'purpose 파라미터가 필요합니다',
        example: '/api/blockchain-search?network=hardhat-local&purpose=수면'
      });
    }
    
    console.log(`🔍 블록체인 직접 조회: ${network}/${purpose}`);
    const startTime = Date.now();
    
    // hardhat-local 네트워크만 지원
    if (network !== 'hardhat-local') {
      return res.status(400).json({
            success: false,
        error: 'hardhat-local 네트워크만 지원됩니다',
            network,
        purpose
      });
    }
    
    // EVM 프로바이더 설정 (hardhat-local 전용)
    const provider = new ethers.JsonRpcProvider('http://localhost:8545');
    
    // 컨트랙트 주소 설정 (실제 배포된 주소 사용)
    const contractAddress = '0x5FbDB2315678afecb367f032d93F642f64180aa3';
    
    // hardhat-local 네트워크만 지원
    if (network !== 'hardhat-local') {
      return res.status(400).json({
          success: false,
        error: 'hardhat-local 네트워크만 지원됩니다'
      });
    }
    
    // ABI 로드
    const fs = require('fs');
    const abiPath = require('path').join(__dirname, '../contract/artifacts/contracts/AccessManagement.sol/AccessManagement.json');
    const contractABI = JSON.parse(fs.readFileSync(abiPath, 'utf8')).abi;
    const contract = new ethers.Contract(contractAddress, contractABI, provider);
    
    // purpose를 keccak256 해시로 변환
    const purposeHash = ethers.keccak256(ethers.toUtf8Bytes(purpose));
    console.log(`📝 Purpose "${purpose}" 해시: ${purposeHash}`);
    
    // 블록 0부터 최신 블록까지 전체 검색
    const currentBlock = await provider.getBlockNumber();
    const fromBlock = 0;
    
    console.log(`🔍 블록 범위: ${fromBlock} - ${currentBlock} (전체 블록 검색)`);
    
    // 먼저 모든 AccessRequestsSaved 이벤트를 가져와서 확인해보기
    const allFilter = contract.filters.AccessRequestsSaved();
    const allEvents = await contract.queryFilter(allFilter, fromBlock, currentBlock);
    console.log(`📝 전체 AccessRequestsSaved 이벤트: ${allEvents.length}개`);
    
    // 디버깅 정보 (필요시에만)
    if (allEvents.length === 0) {
      console.log(`❌ AccessRequestsSaved 이벤트를 찾을 수 없음`);
      console.log(`🔍 사용 중인 컨트랙트 주소: ${contractAddress}`);
    }
    
    // purpose로 필터링된 이벤트 찾기
    const events = allEvents.filter(event => {
      const args = event.args;
      if (args && args.purpose) {
        // Indexed 객체의 hash 속성과 비교
        const eventPurposeHash = args.purpose.hash || args.purpose;
        return eventPurposeHash === purposeHash;
      }
      return false;
    });
    
    console.log(`📝 "${purpose}" 목적으로 필터링된 이벤트: ${events.length}개`);
    
    const transactions = [];
    
    // 각 이벤트에서 트랜잭션 정보 추출
    for (const event of events) {
      try {
        const tx = await provider.getTransaction(event.transactionHash);
        const receipt = await provider.getTransactionReceipt(event.transactionHash);
        const block = await provider.getBlock(event.blockNumber);
        
        // 이벤트 파라미터 파싱
        const args = event.args;
        
        transactions.push({
          txId: event.transactionHash,
          blockNumber: event.blockNumber,
              timestamp: block.timestamp,
          date: new Date(block.timestamp * 1000).toISOString(),
          status: receipt.status === 1 ? 'success' : 'failed',
          requestId: args.requestId ? args.requestId.toString() : 'N/A',
          requester: args.requester || 'N/A',
          resourceOwner: args.resourceOwner || 'N/A',
          purpose: purpose, // 검색한 목적 그대로 표시
          organizationName: 'N/A', // 이벤트에서 해시된 값이라 복원 어려움
          gasUsed: receipt.gasUsed ? receipt.gasUsed.toString() : 'N/A',
          gasPrice: tx.gasPrice ? tx.gasPrice.toString() : 'N/A'
        });
      } catch (error) {
        console.error(`❌ 트랜잭션 ${event.transactionHash} 처리 실패:`, error.message);
      }
    }
    
    // 타임스탬프 기준 내림차순 정렬 (최신순)
    transactions.sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));
    
    const processingTime = Date.now() - startTime;
    console.log(`✅ 블록체인 직접 조회 완료: ${transactions.length}개 발견 (${processingTime}ms)`);
    
    res.json({
      success: true,
      method: 'blockchain-direct',
      network,
      purpose,
      blockRange: `${fromBlock}-${currentBlock} (전체)`,
      totalCount: transactions.length,
      transactions,
      processingTime: `${processingTime}ms`,
      timestamp: new Date().toISOString()
    });
    
  } catch (error) {
    console.error('❌ 블록체인 직접 조회 실패:', error);
    res.status(500).json({
      success: false,
      method: 'blockchain-direct',
      error: error.message,
      network: req.query.network,
      purpose: req.query.purpose,
      timestamp: new Date().toISOString()
    });
  }
});

// =========================
// 주소 불일치 검증 API
// =========================

app.get('/api/verify-addresses', async (req, res) => {
  try {
    const network = 'hardhat-local';
    
    console.log(`🔍 주소 불일치 검증 시작`);
    
    // EVM 프로바이더 설정
    const provider = new ethers.JsonRpcProvider('http://localhost:8545');
    
    // 인덱스 API에서 트랜잭션 목록 가져오기
    const indexResponse = await fetch(`http://localhost:3001/api/indexed-transactions?network=${network}&purpose=%EC%88%98%EB%A9%B4`);
    const indexData = await indexResponse.json();
    
    console.log(`📝 인덱스에서 가져온 트랜잭션 수: ${indexData.transactions.length}`);
    
    const addressAnalysis = {
      deployedContractAddress: '0x5FbDB2315678afecb367f032d93F642f64180aa3', // 실제 배포된 주소
      unknownContractAddress: '0xe7f1725E7734CE288F8367e1Bb143E90bb3F0512', // 알 수 없는 주소
      transactions: []
    };
    
    // 처음 3개 트랜잭션만 확인
    const sampleTxs = indexData.transactions.slice(0, 3);
    
    for (const tx of sampleTxs) {
      try {
        const txDetails = await provider.getTransaction(tx.txId);
        const receipt = await provider.getTransactionReceipt(tx.txId);
        
        const analysis = {
          txId: tx.txId,
          indexedPurpose: tx.purpose,
          transactionToAddress: txDetails.to,
          eventLogAddress: receipt.logs.length > 0 ? receipt.logs[0].address : null,
          matchesDeployedAddress: txDetails.to === addressAnalysis.deployedContractAddress,
          matchesUnknownAddress: txDetails.to === addressAnalysis.unknownContractAddress
        };
        
        addressAnalysis.transactions.push(analysis);
        
        console.log(`📋 ${tx.txId.slice(0, 10)}... → to: ${txDetails.to}, log: ${analysis.eventLogAddress}`);
    
  } catch (error) {
        console.error(`❌ 트랜잭션 ${tx.txId} 분석 실패: ${error.message}`);
      }
    }
    
    // 결과 요약
    const summary = {
      totalChecked: addressAnalysis.transactions.length,
      matchingDeployedAddress: addressAnalysis.transactions.filter(t => t.matchesDeployedAddress).length,
      matchingUnknownAddress: addressAnalysis.transactions.filter(t => t.matchesUnknownAddress).length,
      addressMismatchDetected: addressAnalysis.transactions.some(t => !t.matchesDeployedAddress)
    };
    
    console.log(`📊 검증 완료: 인덱스 주소 일치 ${summary.matchingIndexAddress}/${summary.totalChecked}, 블록체인 주소 일치 ${summary.matchingBlockchainAddress}/${summary.totalChecked}`);
    
    res.json({
      success: true,
      summary,
      addressAnalysis,
      timestamp: new Date().toISOString()
    });
    
  } catch (error) {
    console.error('❌ 주소 검증 실패:', error);
    res.status(500).json({
      success: false,
      error: error.message,
      timestamp: new Date().toISOString()
    });
  }
});

// =========================
// 서버 시작
// =========================

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(`🚀 BI-Index API Server running on http://localhost:${PORT}`);
  console.log('Available endpoints:');
  console.log('  GET  /api/health');
  console.log('  GET  /api/indexed-transactions  (인덱스 기반 메인 API)');
  console.log('  GET  /api/blockchain-search  (블록체인 직접 조회 API)');
  console.log('  POST /api/register-custom-index  (사용자 정의 인덱스 등록)');
  console.log('');
  console.log('📋 지원되는 네트워크: hardhat-local, hardhat, monad');
  console.log('📋 인덱스 기반 검색:');
  console.log('  GET /api/transactions?network=hardhat-local&purpose=혈압');
  console.log('  GET /api/transactions?network=hardhat-local&purpose=수면,혈당  (다중 purpose)');
  console.log('  GET /api/transactions?network=hardhat-local&purpose=혈압&gender=남자  (복합 검색)');
  console.log('📋 블록체인 직접 검색:');
  console.log('  GET /api/blockchain-search?network=hardhat-local&purpose=수면');
});
