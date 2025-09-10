const grpc = require('@grpc/grpc-js');
const protoLoader = require('@grpc/proto-loader');
const config = require('../config/indexing-config');
const { ethers } = require('ethers');
const fs = require('fs');
const path = require('path');

/**
 * Blockchain Indexing Client
 * gRPC를 통해 idxmngr 서버와 통신하는 클라이언트
 * 이더리움 블록체인 통신 기능도 포함
 * 
 * @class IndexingClient
 */
class IndexingClient {
  /**
   * @param {Object} options - 클라이언트 옵션
   * @param {string} options.serverAddr - gRPC 서버 주소
   * @param {string} options.protoPath - Protobuf 파일 경로
   * @param {Object} options.grpcOptions - gRPC 옵션
   */
  constructor(options = {}) {
    this.config = { ...config, ...options };
    this.client = null;
    this.proto = null;
    this.isConnected = false;
    
    // 이더리움 블록체인 설정
    this.ethProvider = null;
    this.ethContracts = {};
    this.networkConfigs = {
      'hardhat-local': 'http://localhost:8545',
      'hardhat': 'http://localhost:8545',
      'monad': 'https://testnet1.monad.xyz'
    };
    
    // 자동 연결 제거 - 명시적으로 connect() 호출해야 함
  }

  /**
   * gRPC 서버에 연결
   * @private
   */
  async connect() {
    try {
      // Protobuf 로드
      const packageDefinition = protoLoader.loadSync(
        this.config.protoPath, 
        this.config.grpcOptions
      );
      
      this.proto = grpc.loadPackageDefinition(packageDefinition).idxmngrapi;
      
      // gRPC 클라이언트 생성
      this.client = new this.proto.Index_manager(
        this.config.serverAddr,
        grpc.credentials.createInsecure()
      );
      
      this.isConnected = true;
      // console.log(`✅ Connected to idxmngr server at ${this.config.serverAddr}`);
    } catch (error) {
      console.error(`❌ Failed to connect: ${error.message}`);
      this.isConnected = false;
      throw error;
    }
  }

/**
   * 인덱스 생성
   * @param {Object} indexInfo - 인덱스 정보
   * @returns {Promise<Object>} 생성 결과
   */
  async createIndex(indexInfo) {
    if (!this.isConnected) {
      throw new Error('Client is not connected to server');
    }

    return new Promise((resolve, reject) => {
      try {
        this.client.CreateIndexRequest(indexInfo, (error, response) => {
          if (error) {
            console.error(`❌ CreateIndex failed: ${error.message}`);
            reject(error);
          } else {
            console.log(`✅ Index created: ${response.ResponseCode} - ${response.ResponseMessage}`);
            resolve(response);
          }
        });
        
      } catch (error) {
        console.error(`❌ CreateIndex request failed: ${error.message}`);
        reject(error);
      }
    });
  }

  /**
   * 인덱스에 데이터 삽입
   * @param {Object} indexData - 삽입할 인덱스 데이터
   * @returns {Promise<Object>} 삽입 결과
   */
  async insertData(indexData) {
    if (!this.isConnected) {
      throw new Error('Client is not connected to server');
    }

    return new Promise((resolve, reject) => {
      try {
        const stream = this.client.InsertIndexRequest((error, response) => {
          if (error) {
            console.error(`❌ InsertIndexRequest failed: ${error.message}`);
            reject(error);
          } else {
            console.log(`✅ Insert response received: ${JSON.stringify(response)}`);
            resolve(response);
          }
        });

        // 데이터 전송
        stream.write(indexData);
        stream.end();
        console.log('✅ Data sent to stream');
        
      } catch (error) {
        console.error(`❌ Failed to create stream: ${error.message}`);
        reject(error);
      }
    });
  }

  /**
   * 인덱스에서 데이터 검색 (fexactorg 방식)
   * @param {Object} searchRequest - 검색 요청
   * @returns {Promise<Object>} 검색 결과
   */
  async searchData(searchRequest) {
    if (!this.isConnected) {
      throw new Error('Client is not connected to server');
    }

    return new Promise((resolve, reject) => {
      try {
        this.client.GetindexDataByFieldM(searchRequest, (error, response) => {
          if (error) {
            console.error(`❌ Search failed: ${error.message}`);
            reject(error);
          } else {
            console.log(`✅ Search successful: ${response.IdxData ? response.IdxData.length : 0} items found`);
            
            // 상세한 결과 로그 추가
            // if (response.IdxData && response.IdxData.length > 0) {
            //   console.log(`📋 상세 결과:`);
            //   response.IdxData.forEach((item, index) => {
            //     console.log(`   ${index + 1}. ${item || '(빈 값)'}`);
            //   });
            // } else {
            //   console.log(`⚠️ 검색 결과가 없습니다.`);
            // }
            
            resolve(response);
          }
        });
        
      } catch (error) {
        console.error(`❌ Search request failed: ${error.message}`);
        reject(error);
      }
    });
  }

  /**
   * 인덱스 정보 조회
   * @param {Object} request - 인덱스 정보 요청
   * @returns {Promise<Object>} 인덱스 정보
   */
  async getIndexInfo(request) {
    if (!this.isConnected) {
      throw new Error('Client is not connected to server');
    }

    return new Promise((resolve, reject) => {
      try {
        this.client.GetIndexInfo(request, (error, response) => {
          if (error) {
            console.error(`❌ GetIndexInfo failed: ${error.message}`);
            reject(error);
          } else {
            console.log(`✅ Index info retrieved: ${response.ResponseCode}`);
            resolve(response);
          }
        });
        
      } catch (error) {
        console.error(`❌ Index info request failed: ${error.message}`);
        reject(error);
      }
    });
  }

  /**
   * 연결 상태 확인
   * @returns {boolean} 연결 상태
   */
  isConnected() {
    return this.isConnected;
  }

  /**
   * 연결 종료
   */
  close() {
    if (this.client) {
      this.client.close();
      this.isConnected = false;
      console.log('🔌 Connection closed');
    }
  }

  // =============================
  // 이더리움 블록체인 통신 기능
  // =============================

  /**
   * 이더리움 네트워크에 연결
   * @param {string} network - 네트워크 이름 (hardhat-local, hardhat, monad)
   */
  async connectEthereumNetwork(network) {
    const rpcUrl = this.networkConfigs[network];
    if (!rpcUrl) {
      throw new Error(`지원하지 않는 네트워크: ${network}`);
    }
    
    this.ethProvider = new ethers.JsonRpcProvider(rpcUrl);
    console.log(`✅ ${network} 네트워크 연결 완료: ${rpcUrl}`);
    
    // 연결 테스트
    try {
      const blockNumber = await this.ethProvider.getBlockNumber();
      console.log(`📊 현재 블록 번호: ${blockNumber}`);
    } catch (error) {
      console.error(`❌ 네트워크 연결 실패: ${error.message}`);
      throw error;
    }
  }

  /**
   * 트랜잭션 ABI 디코딩 (server.js에서 가져온 함수)
   * @param {Object} tx - 트랜잭션 객체
   * @param {Object} receipt - 트랜잭션 영수증
   * @param {string} contractAbiPath - 컨트랙트 ABI 파일 경로
   * @returns {Object} 디코딩된 함수 및 이벤트 정보
   */
  decodeTransactionABI(tx, receipt, contractAbiPath = null) {
    let decodedFunction = null;
    let decodedLogs = [];
    let functionStringParams = {};

    try {
      // 기본 ABI 경로 설정
      const defaultAbiPath = path.join(__dirname, '../../contract/artifacts/contracts/AccessManagement.sol/AccessManagement.json');
      const abiPath = contractAbiPath || defaultAbiPath;
      
      const AccessManagementArtifact = JSON.parse(fs.readFileSync(abiPath, 'utf8'));
      const contractInterface = new ethers.Interface(AccessManagementArtifact.abi);

      console.log(`🔍 ABI 디코딩 시도: ${tx.hash?.substring(0, 10)}... (${tx.data?.substring(0, 10)}...)`);

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
                  if (typeof arg === 'string') {
                    value = arg;
                  } else if (arg && typeof arg === 'object' && arg.toString && arg.toString() !== '[object Object]') {
                    value = arg.toString();
                  } else if (arg && typeof arg === 'object' && arg.value !== undefined) {
                    value = String(arg.value);
                  } else if (arg) {
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
                
                // string 파라미터는 나중에 이벤트 디코딩에서 사용하기 위해 저장
                if (param && param.type === 'string' && typeof value === 'string') {
                  const hash = ethers.keccak256(ethers.toUtf8Bytes(value));
                  functionStringParams[hash] = value;
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
                  
                  if (param && param.type === 'string') {
                    if (typeof arg === 'string') {
                      value = arg;
                    } else if (arg && typeof arg === 'object' && arg._isIndexed && arg.hash) {
                      value = functionStringParams[arg.hash] || `Unknown (${arg.hash})`;
                    } else if (arg && typeof arg === 'object' && arg.toString && arg.toString() !== '[object Object]') {
                      value = arg.toString();
                    } else if (arg && typeof arg === 'object' && arg.value !== undefined) {
                      value = String(arg.value);
                    } else if (arg) {
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
                  
                  return {
                    name: param ? (param.name || `param${index}`) : `param${index}`,
                    type: param ? (param.type || 'unknown') : 'unknown',
                    value: value
                  };
                }) : []
            });
          } catch (logError) {
            console.log(`❌ 이벤트 디코딩 실패: ${logError.message}`);
          }
        }
      }

    } catch (error) {
      console.error(`❌ ABI 디코딩 전체 실패: ${error.message}`);
    }

    return {
      function: decodedFunction,
      events: decodedLogs,
      stringParams: functionStringParams
    };
  }

  /**
   * 트랜잭션 상세 정보 조회
   * @param {string} txId - 트랜잭션 ID
   * @returns {Object} 트랜잭션 상세 정보
   */
  async getTransactionDetails(txId) {
    if (!this.ethProvider) {
      throw new Error('이더리움 네트워크에 먼저 연결해주세요');
    }

    try {
      const [tx, receipt] = await Promise.all([
        this.ethProvider.getTransaction(txId),
        this.ethProvider.getTransactionReceipt(txId)
      ]);
      
      if (!tx || !receipt) {
        throw new Error(`트랜잭션을 찾을 수 없습니다: ${txId}`);
      }
      
      const block = await this.ethProvider.getBlock(tx.blockNumber);
      
      return { tx, receipt, block };
    } catch (error) {
      console.error(`❌ 트랜잭션 조회 실패 ${txId}:`, error.message);
      throw error;
    }
  }

  /**
   * 컨트랙트 이벤트 조회
   * @param {string} contractAddress - 컨트랙트 주소
   * @param {string} abiPath - ABI 파일 경로
   * @param {string} eventName - 이벤트 이름
   * @param {number} fromBlock - 시작 블록
   * @param {number} toBlock - 끝 블록
   * @returns {Array} 이벤트 목록
   */
  async queryContractEvents(contractAddress, abiPath, eventName, fromBlock = 0, toBlock = 'latest') {
    if (!this.ethProvider) {
      throw new Error('이더리움 네트워크에 먼저 연결해주세요');
    }

    try {
      const contractArtifact = JSON.parse(fs.readFileSync(abiPath, 'utf8'));
      const contract = new ethers.Contract(contractAddress, contractArtifact.abi, this.ethProvider);
      
      const filter = contract.filters[eventName]();
      const events = await contract.queryFilter(filter, fromBlock, toBlock);
      
      console.log(`✅ ${eventName} 이벤트 조회 완료: ${events.length}개`);
      return events;
    } catch (error) {
      console.error(`❌ 이벤트 조회 실패:`, error.message);
      throw error;
    }
  }

  /**
   * 통합 기능: 블록체인 데이터 조회 + 인덱싱
   * @param {string} purpose - 검색할 목적
   * @param {string} network - 네트워크 이름
   * @param {string} contractAddress - 컨트랙트 주소
   * @param {string} abiPath - ABI 파일 경로
   * @returns {Object} 검색 결과
   */
  async searchBlockchainAndIndex(purpose, network, contractAddress = '0x5FbDB2315678afecb367f032d93F642f64180aa3', abiPath = null) {
    console.log(`🔍 통합 검색 시작: ${purpose} (${network})`);
    
    try {
      // 1. 이더리움 네트워크 연결
      await this.connectEthereumNetwork(network);
      
      // 2. 인덱스에서 TxID 검색 (server.js와 동일한 방식)
      const networkDir = (network === 'hardhat' || network === 'localhost') ? 'hardhat-local' : network;
      const indexResult = await this.searchData({ 
        IndexID: 'purpose',
        Field: 'IndexableData',
        Value: purpose,
        FilePath: `data/${networkDir}/purpose.bf`,
        KeySize: 64,
        ComOp: 'Eq'
      });
      
      const txIds = indexResult.IdxData || [];
      if (txIds.length === 0) {
        return {
          success: true,
          method: 'integrated-search',
          network,
          purpose,
          totalCount: 0,
          transactions: [],
          message: `"${purpose}" 목적의 트랜잭션을 찾을 수 없습니다`
        };
      }
      
      console.log(`📊 인덱스 검색 결과: ${txIds.length}개 트랜잭션`);
      
      // 3. 🚀 최적화: 병렬 트랜잭션 상세 조회
      console.log(`⚡ ${txIds.length}개 트랜잭션 병렬 조회 중... (인덱스 기반)`);
      const txStart = Date.now();
      
      const batchSize = 10; // 동시 처리할 트랜잭션 수
      const transactions = [];
      const errors = [];
      
      for (let i = 0; i < txIds.length; i += batchSize) {
        const batch = txIds.slice(i, i + batchSize);
        
        const batchPromises = batch.map(async (txId) => {
          try {
            const { tx, receipt, block } = await this.getTransactionDetails(txId);
            
            // ABI 디코딩
            const decoded = this.decodeTransactionABI(tx, receipt, abiPath);
            
            // AccessRequestsSaved 이벤트 찾기
            const accessEvent = decoded.events.find(event => event.name === 'AccessRequestsSaved');
            
            const transaction = {
              txId: tx.hash,
              blockNumber: tx.blockNumber,
              timestamp: block ? block.timestamp : null,
              date: block ? new Date(block.timestamp * 1000).toISOString() : null,
              status: receipt.status === 1 ? 'success' : 'failed',
              gasUsed: receipt.gasUsed?.toString() || 'N/A',
              gasPrice: tx.gasPrice?.toString() || 'N/A'
            };
            
            if (accessEvent && accessEvent.parameters) {
              const eventData = {};
              accessEvent.parameters.forEach(param => {
                eventData[param.name] = param.value;
              });
              
              transaction.requestId = eventData.requestId || null;
              transaction.requester = eventData.requester || null;
              transaction.resourceOwner = eventData.resourceOwner || null;
              transaction.purpose = eventData.purpose || purpose;
              transaction.organizationName = eventData.organizationName || null;
            } else {
              transaction.purpose = purpose;
              transaction.error = 'AccessRequestsSaved 이벤트를 찾을 수 없습니다';
            }
            
            return transaction;
          } catch (error) {
            console.error(`❌ 트랜잭션 처리 실패 ${txId}:`, error.message);
            errors.push({ txId, error: error.message });
            return null;
          }
        });
        
        // 배치 결과 대기 및 수집
        const batchResults = await Promise.all(batchPromises);
        transactions.push(...batchResults.filter(tx => tx !== null));
        
        console.log(`📊 진행률: ${Math.min(i + batchSize, txIds.length)}/${txIds.length} (인덱스 기반)`);
      }
      
      const txTime = Date.now() - txStart;
      console.log(`✅ 트랜잭션 조회 완료: ${txTime}ms (인덱스 기반)`);
      
      // 타임스탬프 기준 내림차순 정렬 (최신순)
      transactions.sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));
      
      return {
        success: true,
        method: 'integrated-search',
        network,
        purpose,
        totalCount: transactions.length,
        errorCount: errors.length,
        transactions,
        errors
      };
      
    } catch (error) {
      console.error(`❌ 통합 검색 실패:`, error.message);
      throw error;
    }
  }

  /**
   * 블록체인 직접 검색 (인덱스 없이)
   * @param {string} purpose - 검색할 목적
   * @param {string} network - 네트워크 이름
   * @param {string} contractAddress - 컨트랙트 주소
   * @param {string} abiPath - ABI 파일 경로
   * @returns {Object} 검색 결과
   */
  async searchBlockchainDirect(purpose, network, contractAddress = '0x5FbDB2315678afecb367f032d93F642f64180aa3', abiPath = null) {
    console.log(`🔍 블록체인 직접 검색 시작: ${purpose} (${network})`);
    
    try {
      // 1. 이더리움 네트워크 연결
      await this.connectEthereumNetwork(network);
      
      // 2. 컨트랙트 설정
      const defaultAbiPath = path.join(__dirname, '../../contract/artifacts/contracts/AccessManagement.sol/AccessManagement.json');
      const contractArtifact = JSON.parse(fs.readFileSync(abiPath || defaultAbiPath, 'utf8'));
      const contract = new ethers.Contract(contractAddress, contractArtifact.abi, this.ethProvider);
      
      // 3. 최신 블록 번호 조회
      const latestBlock = await this.ethProvider.getBlockNumber();
      console.log(`📊 블록 범위: 0 ~ ${latestBlock}`);
      
      // 4. purpose를 keccak256 해시로 변환
      const purposeHash = ethers.keccak256(ethers.toUtf8Bytes(purpose));
      console.log(`🔍 검색할 purpose 해시: ${purposeHash}`);
      
      // 5. 이벤트 로그 조회 (전체 블록 범위)
      const filter = contract.filters.AccessRequestsSaved();
      console.log(`⚡ 이벤트 쿼리 실행 중...`);
      
      const queryStart = Date.now();
      const allEvents = await contract.queryFilter(filter, 0, latestBlock);
      const queryTime = Date.now() - queryStart;
      
      console.log(`📋 전체 이벤트 수: ${allEvents.length} (쿼리 시간: ${queryTime}ms)`);
      
      // 6. purpose로 필터링
      const events = allEvents.filter(event => {
        const args = event.args;
        if (args && args.purpose) {
          const eventPurposeHash = args.purpose.hash || args.purpose;
          return eventPurposeHash === purposeHash;
        }
        return false;
      });
      
      console.log(`🎯 필터링된 이벤트 수: ${events.length}`);
      
      // 7. 🚀 최적화: 병렬 트랜잭션 조회
      console.log(`⚡ ${events.length}개 트랜잭션 병렬 조회 중...`);
      const txStart = Date.now();
      
      const batchSize = 10; // 동시 처리할 트랜잭션 수
      const transactions = [];
      
      for (let i = 0; i < events.length; i += batchSize) {
        const batch = events.slice(i, i + batchSize);
        
        const batchPromises = batch.map(async (event) => {
          try {
            // 병렬로 트랜잭션, 영수증, 블록 조회
            const [tx, receipt] = await Promise.all([
              this.ethProvider.getTransaction(event.transactionHash),
              this.ethProvider.getTransactionReceipt(event.transactionHash)
            ]);
            const block = await this.ethProvider.getBlock(tx.blockNumber);
            
            const args = event.args;
            return {
              txId: event.transactionHash,
              blockNumber: tx.blockNumber,
              timestamp: block.timestamp,
              date: new Date(block.timestamp * 1000).toISOString(),
              status: receipt.status === 1 ? 'success' : 'failed',
              requestId: args.requestId?.toString() || 'N/A',
              requester: args.requester || 'N/A',
              resourceOwner: args.resourceOwner || 'N/A',
              purpose: purpose,
              gasUsed: receipt.gasUsed?.toString() || 'N/A',
              gasPrice: tx.gasPrice?.toString() || 'N/A'
            };
          } catch (txError) {
            console.error(`❌ 트랜잭션 처리 실패 ${event.transactionHash}:`, txError.message);
            return null;
          }
        });
        
        // 배치 결과 대기 및 수집
        const batchResults = await Promise.all(batchPromises);
        transactions.push(...batchResults.filter(tx => tx !== null));
        
        console.log(`📊 진행률: ${Math.min(i + batchSize, events.length)}/${events.length}`);
      }
      
      const txTime = Date.now() - txStart;
      console.log(`✅ 트랜잭션 조회 완료: ${txTime}ms`);
      
      return {
        success: true,
        method: 'blockchain-direct',
        network,
        purpose,
        blockRange: `0-${latestBlock}`,
        totalCount: transactions.length,
        transactions
      };
      
    } catch (error) {
      console.error(`❌ 블록체인 직접 검색 실패:`, error.message);
      throw error;
    }
  }
}

module.exports = IndexingClient;
