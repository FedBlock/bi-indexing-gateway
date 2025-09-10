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
// 인덱스 기반 트랜잭션 목록 조회 (메인 API)
// =========================

app.get('/api/indexed-transactions/:network/:purpose', async (req, res) => {
  try {
    const { network, purpose } = req.params;
    
    console.log(`🔍 인덱스 기반 트랜잭션 목록 조회: ${network}/${purpose}`);
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
    console.log(`📊 1단계: "${purpose}" 인덱스 검색 중...`);
    
    const IndexingClient = require('../indexing-client-package/lib/indexing-client');
    const indexingClient = new IndexingClient({
      serverAddr: 'localhost:50052',
      protoPath: require('path').join(__dirname, '../idxmngr-go/protos/index_manager.proto')
    });
    
    await indexingClient.connect();
    
    const networkDir = (network === 'hardhat' || network === 'localhost') ? 'hardhat-local' : network;
    const searchRequest = {
      IndexID: 'purpose',
      Field: 'IndexableData', 
      Value: purpose,
      FilePath: `data/${networkDir}/purpose.bf`,
      KeySize: 64,
      ComOp: 'Eq'
    };
    
    const searchResult = await indexingClient.searchData(searchRequest);
    indexingClient.close();
    
    const txHashes = searchResult.IdxData || [];
    console.log(`📝 인덱스에서 ${txHashes.length}개 트랜잭션 발견`);
    
    if (txHashes.length === 0) {
      return res.json({
        success: true,
        network,
        purpose,
        totalCount: 0,
        transactions: [],
        message: `"${purpose}" 목적의 트랜잭션을 찾을 수 없습니다`,
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
// 서버 시작
// =========================

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(`🚀 BI-Index API Server running on http://localhost:${PORT}`);
  console.log('Available endpoints:');
  console.log('  GET  /api/health');
  console.log('  GET  /api/indexed-transactions/:network/:purpose  (메인 API)');
  console.log('');
  console.log('📋 지원되는 네트워크: hardhat-local, hardhat, monad');
  console.log('📋 사용 예시:');
  console.log('  GET /api/indexed-transactions/hardhat-local/혈압');
  console.log('  GET /api/indexed-transactions/monad/수면');
});
