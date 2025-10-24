const grpc = require('@grpc/grpc-js');
const protoLoader = require('@grpc/proto-loader');
const config = require('../config/indexing-config');
const { ethers } = require('ethers');
const fs = require('fs');
const path = require('path');
const {
  INDEX_SCHEMA,
  INDEX_KEY_SIZE,
  resolveNetworkKey,
  buildIndexId,
  buildIndexFilePath,
} = require('./indexing-constants');

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
    
    // 🚀 성능 모니터링 설정
    this.batchSize = options.batchSize || 10;
    this.adaptiveBatch = options.adaptiveBatch || false;
    this.performanceHistory = []; // 성능 기록
    this.maxBatchSize = options.maxBatchSize || 50;
    this.minBatchSize = options.minBatchSize || 5;
    
    // 이더리움 블록체인 설정
    this.ethProvider = null;
    this.ethContracts = {};
    this.networkConfigs = {
      'hardhat-local': 'http://localhost:8545',
      'hardhat': 'http://localhost:8545',
      'kaia': 'https://public-en-kairos.node.kaia.io',
      'monad': 'https://testnet-rpc.monad.xyz',
      'fabric': process.env.FABRIC_RPC_URL || 'http://localhost:7051'
    };
    
    // 자동 연결 제거 - 명시적으로 connect() 호출해야 함
  }

  /**
   * 네트워크 입력 검증
   * @param {string} network
   * @returns {string}
   * @private
   */
  ensureNetwork(network) {
    const normalized = resolveNetworkKey(network);
    if (!normalized) {
      throw new Error('Network parameter is required');
    }
    return normalized;
  }

  /**
   * 현재 성능 통계 조회
   */
  getPerformanceStats() {
    if (this.performanceHistory.length === 0) {
      return { message: '성능 데이터 없음' };
    }

    const recent = this.performanceHistory.slice(-5);
    const avgThroughput = recent.reduce((sum, p) => sum + p.throughput, 0) / recent.length;
    const avgProcessingTime = recent.reduce((sum, p) => sum + p.processingTime, 0) / recent.length;

    return {
      currentBatchSize: this.batchSize,
      adaptiveBatch: this.adaptiveBatch,
      avgThroughput: Math.round(avgThroughput * 100) / 100,
      avgProcessingTime: Math.round(avgProcessingTime),
      recentHistory: recent.map(p => ({
        batchSize: p.batchSize,
        throughput: Math.round(p.throughput * 100) / 100,
        processingTime: p.processingTime
      }))
    };
  }

  /**
   * gRPC 서버에 연결
   * @private
   */
  async connect() {
    try {
      const packageDefinition = protoLoader.loadSync(this.config.protoPath, {
        keepCase: true,
        longs: String,
        enums: String,
        defaults: true,
        oneofs: true,
      });

      this.proto = grpc.loadPackageDefinition(packageDefinition);
        
      // 🔧 수정: 올바른 패키지와 서비스 이름 사용
      this.client = new this.proto.idxmngrapi.Index_manager(
        this.config.serverAddr,
        grpc.credentials.createInsecure(),
        this.config.grpcOptions || {}
      );

      this.isConnected = true;
      console.log('✅ gRPC 서버 연결 성공');
    } catch (error) {
      console.error('❌ gRPC 서버 연결 실패:', error.message);
      throw error;
    }
  }

  /**
   * gRPC 연결 종료
   */
  async close() {
    if (this.client) {
      this.client.close();
      this.isConnected = false;
      console.log('🔌 gRPC 연결 종료');
    }
  }

  /**
   * 데이터 검색
   * @param {Object} searchParams - 검색 매개변수
   * @returns {Promise<Object>} 검색 결과
   */
  async searchData(searchParams) {
    return new Promise((resolve, reject) => {
      if (!this.isConnected) {
        reject(new Error('gRPC 서버에 연결되지 않음'));
        return;
      }

      // 🔧 수정: 올바른 메소드 이름 사용
      this.client.GetindexDataByFieldM(searchParams, (error, response) => {
        if (error) {
          console.error('❌ 데이터 검색 실패:', error.message);
          reject(error);
        } else {
          resolve(response);
        }
      });
    });
  }

  /**
   * 생성된 인덱스 목록 조회
   * @param {string} [requestMsg] - 서버 로그 등에 남길 요청 메시지
   * @returns {Promise<Object>} 인덱스 목록 결과
   */
  async getIndexList(requestMsg = 'list-all-indexes') {
    if (!this.isConnected) {
      throw new Error('Client is not connected to server');
    }

    const payload = {
      RequestMsg: requestMsg,
    };

    return new Promise((resolve, reject) => {
      this.client.GetIndexList(payload, (error, response) => {
        if (error) {
          console.error(`❌ GetIndexList failed: ${error.message}`);
          reject(error);
        } else {
          resolve(response);
        }
      });
    });
  }

  /**
   * 인덱스 생성
   * @param {Object} indexInfo - 인덱스 정보
   * @param {number} [indexInfo.FromBlock] - 인덱싱을 시작할 최초 블록(미지정 시 BlockNum 또는 0)
   * @returns {Promise<Object>} 생성 결과
   */
  async createIndex(indexInfo) {
    if (!this.isConnected) {
      throw new Error('Client is not connected to server');
    }

    const networkKey = resolveNetworkKey(indexInfo.Network || indexInfo.network);

    const payload = {
      ...indexInfo,
    };

    payload.IndexID = indexInfo.IndexID || indexInfo.indexId || buildIndexId(networkKey);
    payload.IndexName = indexInfo.IndexName || indexInfo.indexName || payload.IndexID;
    payload.Schema = indexInfo.Schema || indexInfo.schema || INDEX_SCHEMA;
    payload.FilePath = indexInfo.FilePath || indexInfo.filePath || buildIndexFilePath(networkKey);
    payload.Network = networkKey;
    payload.KeySize = Number(indexInfo.KeySize || indexInfo.keySize || INDEX_KEY_SIZE);

    if (!payload.IndexingKey) {
      payload.IndexingKey = indexInfo.IndexingKey ?? indexInfo.indexingKey ?? payload.IndexName ?? payload.IndexID;
    }

    // 기본 시작 블록이 명시되지 않았다면 BlockNum 혹은 0으로 초기화한다
    if (payload.FromBlock === undefined || payload.FromBlock === null) {
      payload.FromBlock = typeof payload.BlockNum === 'number' ? payload.BlockNum : 0;
    }

    payload.FromBlock = Number(payload.FromBlock);

    return new Promise((resolve, reject) => {
      try {
        this.client.CreateIndexRequest(payload, (error, response) => {
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
        const networkKey = resolveNetworkKey(indexData.Network || indexData.network);
        const normalizedIndexId = indexData.IndexID || indexData.indexId || buildIndexId(networkKey);
        const normalizedFilePath = indexData.FilePath || indexData.filePath || buildIndexFilePath(networkKey);
        const keySize = Number(indexData.KeySize || indexData.keySize || INDEX_KEY_SIZE);

        const payload = {
          ...indexData,
          IndexID: normalizedIndexId,
          ColIndex: indexData.ColIndex || normalizedIndexId,
          FilePath: normalizedFilePath,
          Network: networkKey,
          KeySize: keySize,
        };

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
        stream.write(payload);
        stream.end();
        console.log('✅ Data sent to stream');
        
      } catch (error) {
        console.error(`❌ Failed to create stream: ${error.message}`);
        reject(error);
      }
    });
  }

  /**
   * 이더리움 네트워크 연결
   * @param {string} network - 네트워크 이름
   * @private
   */
  async connectEthereumNetwork(network) {
    try {
      const rpcUrl = this.networkConfigs[network];
      if (!rpcUrl) {
        throw new Error(`지원하지 않는 네트워크: ${network}`);
      }

      this.ethProvider = new ethers.JsonRpcProvider(rpcUrl);
      
      // 연결 테스트
      await this.ethProvider.getBlockNumber();
      console.log(`✅ 이더리움 네트워크 연결 성공: ${network}`);
      
    } catch (error) {
      console.error(`❌ 이더리움 네트워크 연결 실패 (${network}):`, error.message);
      throw error;
    }
  }

  /**
   * 트랜잭션 상세 정보 조회
   * @param {string} txHash - 트랜잭션 해시
   * @returns {Object} 트랜잭션 상세 정보
   * @private
   */
  async getTransactionDetails(txHash) {
    try {
      const [tx, receipt] = await Promise.all([
        this.ethProvider.getTransaction(txHash),
        this.ethProvider.getTransactionReceipt(txHash)
      ]);

      if (!tx) {
        throw new Error(`트랜잭션을 찾을 수 없습니다: ${txHash}`);
      }

      const block = await this.ethProvider.getBlock(tx.blockNumber);

      return { tx, receipt, block };
    } catch (error) {
      console.error(`❌ 트랜잭션 상세 정보 조회 실패 (${txHash}):`, error.message);
      throw error;
    }
  }

  /**
   * 트랜잭션 ABI 디코딩
   * @param {Object} tx - 트랜잭션 객체
   * @param {Object} receipt - 트랜잭션 영수증
   * @param {string} abiPath - ABI 파일 경로
   * @returns {Object} 디코딩된 정보
   * @private
   */
  decodeTransactionABI(tx, receipt, abiPath = null) {
    try {
      const defaultAbiPath = path.join(__dirname, '../../bi-index/contract/artifacts/contracts/AccessManagement.sol/AccessManagement.json');
      const contractArtifact = JSON.parse(fs.readFileSync(abiPath || defaultAbiPath, 'utf8'));
      
      const iface = new ethers.Interface(contractArtifact.abi);
      const decodedEvents = [];

      if (receipt && receipt.logs) {
        receipt.logs.forEach((log, index) => {
          try {
            const decoded = iface.parseLog(log);
            if (decoded) {
              decodedEvents.push({
                name: decoded.name,
                parameters: decoded.args.map((arg, i) => ({
                  name: decoded.fragment.inputs[i].name,
                  type: decoded.fragment.inputs[i].type,
                  value: arg.toString()
                }))
              });
            }
          } catch (decodeError) {
            // 디코딩할 수 없는 로그는 무시
          }
        });
      }

      return {
        events: decodedEvents,
        functionCall: tx.data ? this.decodeFunctionCall(iface, tx.data) : null
      };

    } catch (error) {
      console.error('❌ ABI 디코딩 실패:', error.message);
      return { events: [], functionCall: null };
    }
  }

  /**
   * 함수 호출 디코딩
   * @param {Object} iface - 인터페이스 객체
   * @param {string} data - 트랜잭션 데이터
   * @returns {Object} 디코딩된 함수 호출
   * @private
   */
  decodeFunctionCall(iface, data) {
    try {
      const decoded = iface.parseTransaction({ data });
      if (decoded) {
        return {
          name: decoded.name,
          parameters: decoded.args.map((arg, i) => ({
            name: decoded.fragment.inputs[i].name,
            type: decoded.fragment.inputs[i].type,
            value: arg.toString()
          }))
        };
      }
    } catch (error) {
      // 디코딩 실패는 무시
    }
    return null;
  }

  /**
   * 데이터 인덱싱
   * @param {Object} indexParams - 인덱싱 매개변수
   * @returns {Promise<Object>} 인덱싱 결과
   */
  async indexData(indexParams) {
    return new Promise((resolve, reject) => {
      if (!this.isConnected) {
        reject(new Error('gRPC 서버에 연결되지 않음'));
        return;
      }

      this.client.InsertIndexRequest(indexParams, (error, response) => {
        if (error) {
          console.error('❌ 데이터 인덱싱 실패:', error.message);
          reject(error);
        } else {
          console.log('✅ 데이터 인덱싱 성공');
          resolve(response);
        }
      });
    });
  }

  /**
   * 블록체인과 인덱스 통합 검색
   * @param {string} purpose - 검색할 목적
   * @param {string} network - 네트워크 이름
   * @param {string} contractAddress - 컨트랙트 주소
   * @param {string} abiPath - ABI 파일 경로
   * @returns {Object} 검색 결과
   */
  async searchBlockchainAndIndex(purpose, network, contractAddress = '0x23EC7332865ecD204539f5C3535175C22D2C6388', abiPath = null) {
    const targetNetwork = this.ensureNetwork(network);
    console.log(`🔍 통합 검색 시작: ${purpose} (${targetNetwork})`);
    
    try {

      // 1. 이더리움 네트워크 연결
      await this.connectEthereumNetwork(targetNetwork);
      
      // 2. 인덱스에서 TxID 검색 (server.js와 동일한 방식)
      const indexResult = await this.searchData({ 
        IndexID: buildIndexId(targetNetwork),
        Field: 'IndexableData',
        Value: purpose,
        FilePath: buildIndexFilePath(targetNetwork),
        KeySize: INDEX_KEY_SIZE,
        ComOp: 'Eq'
      });
      
      const txIds = indexResult.IdxData || [];
      if (txIds.length === 0) {
        return {
          success: true,
          method: 'integrated-search',
          network: targetNetwork,
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
      
      const batchSize = this.batchSize; // 서버에서 설정된 배치 크기 사용
      const transactions = [];
      const errors = [];
      
      for (let i = 0; i < txIds.length; i += batchSize) {
        const batch = txIds.slice(i, i + batchSize);
        
        const batchPromises = batch.map(async (txId) => {
          try {
            const { tx, receipt, block } = await this.getTransactionDetails(txId);
            
            // ABI 디코딩
            const decoded = this.decodeTransactionABI(tx, receipt, abiPath);
            const accessEvent = decoded.events.find(event => event.name === 'AccessRequestsSaved');
            
            let eventData = {};
            if (accessEvent && accessEvent.parameters) {
              accessEvent.parameters.forEach(param => {
                eventData[param.name] = param.value;
              });
            }
            
            return {
              txId: txId,
              blockNumber: tx.blockNumber,
              timestamp: block.timestamp,
              date: new Date(block.timestamp * 1000).toISOString(),
              status: receipt.status === 1 ? 'success' : 'failed',
              requestId: eventData.requestId?.toString() || 'N/A',
              requester: eventData.requester || 'N/A',
              resourceOwner: eventData.resourceOwner || 'N/A',
              purpose: eventData.purpose || purpose,
              organizationName: eventData.organizationName || 'N/A',
              gasUsed: receipt.gasUsed?.toString() || 'N/A',
              gasPrice: tx.gasPrice?.toString() || 'N/A'
            };
          } catch (txError) {
            console.error(`❌ 트랜잭션 처리 실패 ${txId}:`, txError.message);
            errors.push({ txId, error: txError.message });
            return null;
          }
        });
        
        const batchResults = await Promise.all(batchPromises);
        transactions.push(...batchResults.filter(tx => tx !== null));
        
        console.log(`📊 진행률: ${Math.min(i + batchSize, txIds.length)}/${txIds.length}`);
      }
      
      const txTime = Date.now() - txStart;
      console.log(`✅ 트랜잭션 조회 완료: ${txTime}ms (인덱스 기반)`);
      
      return {
        success: true,
        method: 'integrated-search',
        network: targetNetwork,
        purpose,
        totalCount: transactions.length,
        transactions,
        errors: errors.length > 0 ? errors : undefined,
        processingTime: txTime
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
  async searchBlockchainDirect(purpose, network, contractAddress = '0x23EC7332865ecD204539f5C3535175C22D2C6388', abiPath = null) {
    const targetNetwork = this.ensureNetwork(network);
    console.log(`🔍 블록체인 직접 검색 시작: ${purpose} (${targetNetwork})`);
    
    try {
      // 1. 이더리움 네트워크 연결
      await this.connectEthereumNetwork(targetNetwork);
      
      // 2. 컨트랙트 설정
      const defaultAbiPath = path.join(__dirname, '../../bi-index/contract/artifacts/contracts/AccessManagement.sol/AccessManagement.json');
      const contractArtifact = JSON.parse(fs.readFileSync(abiPath || defaultAbiPath, 'utf8'));
      const contract = new ethers.Contract(contractAddress, contractArtifact.abi, this.ethProvider);
      
      // 3. 최신 블록 번호 조회
      const latestBlock = await this.ethProvider.getBlockNumber();
      console.log(`📊 블록 범위: 0 ~ ${latestBlock}`);
      
      // 4. purpose를 keccak256 해시로 변환
      const purposeHash = ethers.keccak256(ethers.toUtf8Bytes(purpose));
      console.log(`🔍 검색할 purpose 해시: ${purposeHash}`);
      
      // 5. 순차 검색: 블록별로 이벤트 조회하며 purpose 필터링
      console.log(`⚡ 블록별 순차 검색 시작...`);
      
      const queryStart = Date.now();
      const events = [];
      const blockBatchSize = Math.max(100, this.batchSize * 10); // 동적 블록 배치 크기 (최소 100)
      
      for (let fromBlock = 0; fromBlock <= latestBlock; fromBlock += blockBatchSize) {
        const toBlock = Math.min(fromBlock + blockBatchSize - 1, latestBlock);
        
        try {
          // 블록 범위별로 이벤트 조회
          const filter = contract.filters.AccessRequestsSaved();
          const blockEvents = await contract.queryFilter(filter, fromBlock, toBlock);
          
          // purpose와 일치하는 이벤트만 수집
          for (const event of blockEvents) {
            const args = event.args;
            if (args && args.purpose) {
              const eventPurposeHash = args.purpose.hash || args.purpose;
              if (eventPurposeHash === purposeHash) {
                events.push(event);
              }
            }
          }
          
          // 진행률 표시
          const progress = Math.min(toBlock + 1, latestBlock + 1);
          console.log(`📊 블록 검색 진행률: ${progress}/${latestBlock + 1} (발견된 이벤트: ${events.length}개)`);
          
        } catch (blockError) {
          console.error(`❌ 블록 ${fromBlock}-${toBlock} 검색 실패:`, blockError.message);
          // 개별 블록 실패해도 계속 진행
        }
      }
      
      const queryTime = Date.now() - queryStart;
      console.log(`🎯 순차 검색 완료: ${events.length}개 이벤트 발견 (검색 시간: ${queryTime}ms)`);
      
      // 7. 🚀 최적화: 병렬 트랜잭션 조회
      console.log(`⚡ ${events.length}개 트랜잭션 병렬 조회 중...`);
      const txStart = Date.now();
      
      const batchSize = this.batchSize; // 서버에서 설정된 배치 크기 사용
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
            
            // ABI 디코딩으로 완전한 조직명 가져오기
            const decoded = this.decodeTransactionABI(tx, receipt, abiPath);
            const accessEvent = decoded.events.find(event => event.name === 'AccessRequestsSaved');
            
            let eventData = {};
            if (accessEvent && accessEvent.parameters) {
              accessEvent.parameters.forEach(param => {
                eventData[param.name] = param.value;
              });
            }
            
            return {
              txId: event.transactionHash,
              blockNumber: tx.blockNumber,
              timestamp: block.timestamp,
              date: new Date(block.timestamp * 1000).toISOString(),
              status: receipt.status === 1 ? 'success' : 'failed',
              requestId: eventData.requestId?.toString() || 'N/A',
              requester: eventData.requester || 'N/A',
              resourceOwner: eventData.resourceOwner || 'N/A',
              purpose: eventData.purpose || purpose,
              organizationName: eventData.organizationName || 'N/A',
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
        network: targetNetwork,
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

  /**
   * 컨트랙트에서 총 요청 개수 조회
   * @param {string} network - 네트워크 이름
   */
  async getTotalRequestCount(network) {
    try {
      const targetNetwork = this.ensureNetwork(network);

      // 이더리움 네트워크 연결
      await this.connectEthereumNetwork(targetNetwork);
      
      // 컨트랙트 설정
      const defaultAbiPath = path.join(__dirname, '../../bi-index/contract/artifacts/contracts/AccessManagement.sol/AccessManagement.json');
      const contractArtifact = JSON.parse(fs.readFileSync(defaultAbiPath, 'utf8'));
      const contract = new ethers.Contract('0x23EC7332865ecD204539f5C3535175C22D2C6388', contractArtifact.abi, this.ethProvider);
      
      // 총 요청 개수 조회
      const totalCount = await contract.getTotalRequestCount();
      return Number(totalCount);
      
    } catch (error) {
      console.error('❌ 총 요청 개수 조회 실패:', error.message);
      throw error;
    }
  }

  /**
   * 컨트랙트에서 범위별 요청 데이터 조회
   * @param {number} startId - 시작 ID
   * @param {number} endId - 끝 ID  
   * @param {string} network - 네트워크 이름
   */
  async getRequestsInRange(startId, endId, network) {
    try {
      const targetNetwork = this.ensureNetwork(network);
      console.log(`🔗 컨트랙트 직접 조회: ${startId} ~ ${endId} (${targetNetwork})`);
      
      // 이더리움 네트워크 연결
      await this.connectEthereumNetwork(targetNetwork);
      
      // 컨트랙트 설정
      const defaultAbiPath = path.join(__dirname, '../../bi-index/contract/artifacts/contracts/AccessManagement.sol/AccessManagement.json');
      const contractArtifact = JSON.parse(fs.readFileSync(defaultAbiPath, 'utf8'));
      const contract = new ethers.Contract('0x23EC7332865ecD204539f5C3535175C22D2C6388', contractArtifact.abi, this.ethProvider);
      
      // 범위별 요청 데이터 조회
      const queryStart = Date.now();
      const requestDetails = await contract.getRequestsInRange(startId, endId);
      const queryTime = Date.now() - queryStart;
      
      console.log(`📊 컨트랙트 조회 완료: ${requestDetails.length}개 (${queryTime}ms)`);
      
      // 결과 포맷팅
      const formattedRequests = requestDetails.map((request, index) => ({
        requestId: startId + index,
        requester: request.requester,
        resourceOwner: request.resourceOwner,
        status: Number(request.status), // enum 값
        purpose: request.purpose,
        organizationName: request.organizationName
      }));
      
      return {
        success: true,
        method: 'contract-direct-query',
        network: targetNetwork,
        rangeQuery: `${startId}-${endId}`,
        totalCount: formattedRequests.length,
        requests: formattedRequests,
        queryTime: `${queryTime}ms`
      };
      
    } catch (error) {
      console.error('❌ 범위별 요청 조회 실패:', error.message);
      throw error;
    }
  }

  /**
   * 전체 요청 데이터를 페이징 방식으로 조회
   * @param {number} pageSize - 페이지 크기
   * @param {string} network - 네트워크 이름
   */
  async getAllRequestsWithPaging(pageSize = 100, network) {
    try {
      const targetNetwork = this.ensureNetwork(network);
      console.log(`🔗 전체 데이터 페이징 조회 시작 (페이지 크기: ${pageSize}, 네트워크: ${targetNetwork})`);
      
      // 1. 총 개수 조회
      const totalCount = await this.getTotalRequestCount(targetNetwork);
      console.log(`📊 총 요청 개수: ${totalCount}`);
      
      if (totalCount === 0) {
        return {
          success: true,
          method: 'contract-paging-query',
          network: targetNetwork,
          totalCount: 0,
          requests: [],
          totalPages: 0
        };
      }
      
      // 2. 페이징으로 전체 조회
      const allRequests = [];
      const totalPages = Math.ceil(totalCount / pageSize);
      
      for (let startId = 1; startId <= totalCount; startId += pageSize) {
        const endId = Math.min(startId + pageSize - 1, totalCount);
        const currentPage = Math.floor((startId - 1) / pageSize) + 1;
        
        console.log(`📄 페이지 ${currentPage}/${totalPages} 조회 중: ${startId} ~ ${endId}`);
        
        const rangeResult = await this.getRequestsInRange(startId, endId, targetNetwork);
        allRequests.push(...rangeResult.requests);
      }
      
      console.log(`✅ 전체 조회 완료: ${allRequests.length}개`);
      
      return {
        success: true,
        method: 'contract-paging-query',
        network: targetNetwork,
        totalCount: totalCount,
        requests: allRequests,
        totalPages: totalPages,
        pageSize: pageSize
      };
      
    } catch (error) {
      console.error('❌ 전체 페이징 조회 실패:', error.message);
      throw error;
    }
  }

  /**
   * purpose로 필터링된 요청 데이터 조회 (페이징 + 필터링 + 시간 측정)
   * @param {string} purpose - 검색할 목적
   * @param {number} pageSize - 페이지 크기
   * @param {string} network - 네트워크 이름
   */
  async getFilteredRequestsByPurpose(purpose, pageSize = 100, network) {
    const totalStartTime = Date.now();
    
    try {
      const targetNetwork = this.ensureNetwork(network);
      console.log(`🔍 purpose '${purpose}' 필터링 조회 시작 (배치 크기: ${pageSize}, 네트워크: ${targetNetwork})`);
      
      // 1. 총 개수 조회
      const countStart = Date.now();
      const totalCount = await this.getTotalRequestCount(targetNetwork);
      const countTime = Date.now() - countStart;
      console.log(`📊 총 요청 개수: ${totalCount}개 (조회 시간: ${countTime}ms)`);
      
      if (totalCount === 0) {
        return {
          success: true,
          method: 'contract-filtered-query',
          network: targetNetwork,
          purpose: purpose,
          totalScanned: 0,
          totalCount: 0,
          requests: [],
          processingTime: `${Date.now() - totalStartTime}ms`,
          batchInfo: { totalBatches: 0, batchSize: pageSize }
        };
      }
      
      const filteredRequests = [];
      const batchTimes = [];
      const totalBatches = Math.ceil(totalCount / pageSize);
      
      // 2. 배치별 조회 및 필터링
      for (let startId = 1; startId <= totalCount; startId += pageSize) {
        const endId = Math.min(startId + pageSize - 1, totalCount);
        const batchNumber = Math.floor((startId - 1) / pageSize) + 1;
        
        const batchStart = Date.now();
        console.log(`📄 배치 ${batchNumber}/${totalBatches} 조회 중: ${startId} ~ ${endId}`);
        
        // 배치 데이터 조회
        const rangeResult = await this.getRequestsInRange(startId, endId, targetNetwork);
        
        // purpose로 필터링
        const matchedInThisBatch = rangeResult.requests.filter(request => 
          request.purpose === purpose
        );
        
        // 필터링된 결과를 배열에 추가
        filteredRequests.push(...matchedInThisBatch);
        
        const batchTime = Date.now() - batchStart;
        batchTimes.push(batchTime);
        
        console.log(`🎯 배치 ${batchNumber}: ${matchedInThisBatch.length}개 발견 (${batchTime}ms), 누적: ${filteredRequests.length}개`);
      }
      
      const totalTime = Date.now() - totalStartTime;
      const avgBatchTime = batchTimes.reduce((sum, time) => sum + time, 0) / batchTimes.length;
      
      console.log(`✅ 필터링 완료: '${purpose}' ${filteredRequests.length}개 발견 (전체 시간: ${totalTime}ms)`);
      
      return {
        success: true,
        method: 'contract-filtered-query',
        network: targetNetwork,
        purpose: purpose,
        totalScanned: totalCount,
        totalCount: filteredRequests.length,
        requests: filteredRequests,
        processingTime: `${totalTime}ms`,
        performanceStats: {
          totalBatches: totalBatches,
          batchSize: pageSize,
          avgBatchTime: `${Math.round(avgBatchTime)}ms`,
          totalCountTime: `${countTime}ms`,
          filteringEfficiency: `${((filteredRequests.length / totalCount) * 100).toFixed(2)}%`,
          batchTimes: batchTimes
        }
      };
      
    } catch (error) {
      console.error('❌ purpose 필터링 조회 실패:', error.message);
      throw error;
    }
  }
}

module.exports = IndexingClient;
