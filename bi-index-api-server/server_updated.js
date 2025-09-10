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
// 통합 블록체인 검색 API (인덱스/직접 검색 통합)
// =========================

app.get('/api/blockchain-search', async (req, res) => {
  const startTime = Date.now();
  
  try {
    let { network, purpose, indexed = 'true', ...customFilters } = req.query;
    
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
        example: '/api/blockchain-search?network=hardhat-local&purpose=수면&indexed=true'
      });
    }
    
    if (!purpose) {
      return res.status(400).json({
        success: false,
        error: 'purpose 파라미터가 필요합니다',
        example: '/api/blockchain-search?network=hardhat-local&purpose=수면&indexed=true'
      });
    }
    
    const useIndexed = indexed === 'true';
    console.log(`🔍 검색 시작: ${purpose} (인덱스: ${useIndexed ? 'ON' : 'OFF'})`);
    
    if (useIndexed) {
      // ======================
      // 인덱스 기반 검색
      // ======================
      const purposes = purpose.split(',').map(p => p.trim());
      const operationType = purposes.length > 1 ? 'OR' : 'SINGLE';
      
      console.log(`📊 1단계: purpose 인덱스 검색 중... (${purposes.length}개: ${purposes.join(', ')}, 연산: ${operationType})`);
      
      const IndexingClient = require('../bi-indexing-gateway/lib/indexing-client');
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
          method: 'indexed-search',
          indexed: true,
          network,
          purpose,
          operator: operationType,
          filters: customFilters,
          totalCount: 0,
          transactions: [],
          message: `"${purpose}" 목적${filterDescription}의 트랜잭션을 찾을 수 없습니다`,
          processingTime: `${Date.now() - startTime}ms`,
          timestamp: new Date().toISOString()
        });
      }
      
      // 각 트랜잭션 상세 조회 및 이벤트 파싱
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
        method: 'indexed-search',
        indexed: true,
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
      
    } else {
      // ======================
      // 블록체인 직접 검색
      // ======================
      console.log(`🔗 블록체인 직접 검색 시작: ${purpose}`);
      
      // hardhat-local만 지원
      if (network !== 'hardhat-local') {
        return res.status(400).json({
          success: false,
          error: 'blockchain-search는 hardhat-local 네트워크만 지원합니다',
          timestamp: new Date().toISOString()
        });
      }
      
      // ethers 설정
      const provider = new ethers.JsonRpcProvider('http://localhost:8545');
      const contractAddress = '0x5FbDB2315678afecb367f032d93F642f64180aa3';
      const abiPath = require('path').join(__dirname, '../contract/artifacts/contracts/AccessManagement.sol/AccessManagement.json');
      const contractArtifact = JSON.parse(require('fs').readFileSync(abiPath, 'utf8'));
      const contract = new ethers.Contract(contractAddress, contractArtifact.abi, provider);
      
      // 최신 블록 번호 조회
      const latestBlock = await provider.getBlockNumber();
      console.log(`📊 블록 범위: 0 ~ ${latestBlock}`);
      
      // purpose를 keccak256 해시로 변환 (indexed 파라미터용)
      const purposeHash = ethers.keccak256(ethers.toUtf8Bytes(purpose));
      
      // 이벤트 로그 조회 (전체 블록 범위)
      const filter = contract.filters.AccessRequestsSaved();
      const allEvents = await contract.queryFilter(filter, 0, latestBlock);
      
      console.log(`📋 전체 이벤트 수: ${allEvents.length}`);
      
      // purpose로 필터링
      const events = allEvents.filter(event => {
        const args = event.args;
        if (args && args.purpose) {
          // Indexed 객체의 hash 속성과 비교
          const eventPurposeHash = args.purpose.hash || args.purpose;
          return eventPurposeHash === purposeHash;
        }
        return false;
      });
      
      console.log(`🎯 필터링된 이벤트 수: ${events.length}`);
      
      // 트랜잭션 상세 정보 조회
      const transactions = [];
      for (const event of events) {
        try {
          const tx = await provider.getTransaction(event.transactionHash);
          const receipt = await provider.getTransactionReceipt(event.transactionHash);
          const block = await provider.getBlock(tx.blockNumber);
          
          // 이벤트 파라미터에서 데이터 추출
          const args = event.args;
          
          const transaction = {
            txId: event.transactionHash,
            blockNumber: tx.blockNumber,
            timestamp: block.timestamp,
            date: new Date(block.timestamp * 1000).toISOString(),
            status: receipt.status === 1 ? 'success' : 'failed',
            requestId: args.requestId?.toString() || 'N/A',
            requester: args.requester || 'N/A',
            resourceOwner: args.resourceOwner || 'N/A',
            purpose: purpose, // 원본 purpose 사용
            organizationName: 'N/A', // 블록체인에서는 조직명을 직접 추출할 수 없음
            gasUsed: receipt.gasUsed?.toString() || 'N/A',
            gasPrice: tx.gasPrice?.toString() || 'N/A'
          };
          
          transactions.push(transaction);
        } catch (txError) {
          console.error(`❌ 트랜잭션 처리 실패 ${event.transactionHash}:`, txError.message);
        }
      }
      
      const processingTime = Date.now() - startTime;
      
      res.json({
        success: true,
        method: 'blockchain-direct',
        indexed: false,
        network,
        purpose,
        blockRange: `0-${latestBlock} (전체)`,
        totalCount: transactions.length,
        transactions,
        processingTime: `${processingTime}ms`,
        timestamp: new Date().toISOString()
      });
    }
    
  } catch (error) {
    console.error('❌ 블록체인 검색 실패:', error);
    res.status(500).json({
      success: false,
      error: error.message,
      timestamp: new Date().toISOString()
    });
  }
});

// =========================
// 기존 인덱스 기반 API (호환성 유지)
// =========================

app.get('/api/indexed-transactions', async (req, res) => {
  // 새로운 통합 API로 리다이렉트
  const queryParams = new URLSearchParams(req.query);
  queryParams.set('indexed', 'true');
  
  console.log('🔄 /api/indexed-transactions → /api/blockchain-search (indexed=true)');
  
  // 내부 리다이렉트
  req.query = Object.fromEntries(queryParams);
  req.url = '/api/blockchain-search';
  
  // 동일한 핸들러 재사용
  return app._router.handle(req, res);
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
    const IndexingClient = require('../bi-indexing-gateway/lib/indexing-client');
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
// 서버 시작
// =========================

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(`🚀 BI-Index API Server running on http://localhost:${PORT}`);
  console.log('Available endpoints:');
  console.log('  GET  /api/health');
  console.log('  GET  /api/blockchain-search  (통합 검색 API - 메인)');
  console.log('  GET  /api/indexed-transactions  (호환성 유지 - 리다이렉트)');
  console.log('  POST /api/register-custom-index  (사용자 정의 인덱스 등록)');
  console.log('');
  console.log('📋 통합 검색 API 사용법:');
  console.log('  GET /api/blockchain-search?network=hardhat-local&purpose=수면&indexed=true   (인덱스 검색 - 빠름)');
  console.log('  GET /api/blockchain-search?network=hardhat-local&purpose=수면&indexed=false  (블록체인 직접 - 느림)');
  console.log('  GET /api/blockchain-search?network=hardhat-local&purpose=수면,혈압&indexed=true  (다중 purpose)');
  console.log('  GET /api/blockchain-search?network=hardhat-local&purpose=혈압&gender=남자&indexed=true  (복합 필터)');
});
