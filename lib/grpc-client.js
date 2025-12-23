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
 * Blockchain Indexing gRPC Client
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
      console.log('🔍 Protobuf 파일 로드 시도:', this.config.protoPath);
      const packageDefinition = protoLoader.loadSync(this.config.protoPath, {
        keepCase: this.config.grpcOptions.keepCase,
        longs: String,
        enums: String,
        defaults: true,
        oneofs: true,
      });
      console.log('✅ Protobuf 파일 로드 성공');

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
      console.log('🔗 gRPC 서버에 연결 중...');
      await this.connect();
    }

    return new Promise((resolve, reject) => {
      try {
        const networkKey = resolveNetworkKey(indexData.Network || indexData.network);
        const normalizedIndexId = indexData.IndexID || indexData.indexId || buildIndexId(networkKey);
        const normalizedFilePath = indexData.FilePath || indexData.filePath || buildIndexFilePath(networkKey);
        const keySize = Number(indexData.KeySize || indexData.keySize || INDEX_KEY_SIZE);

        // ColIndex는 indexingKey를 사용해야 함 (예: "purpose")
        const colIndex = indexData.ColIndex || indexData.IndexName || indexData.indexingKey || 'purpose';
        
        const payload = {
          ...indexData,
          IndexID: normalizedIndexId,
          ColIndex: colIndex,
          FilePath: normalizedFilePath,
          Network: networkKey,
          KeySize: keySize,
        };
        
        console.log(`📤 InsertData - ColIndex: ${colIndex}, IndexID: ${normalizedIndexId}`);

        const stream = this.client.InsertIndexRequest((error, response) => {
          if (error) {
            console.error(`InsertIndexRequest failed: ${error.message}`);
            reject(error);
          } else {
            console.log(`✅ Insert response received: ${JSON.stringify(response)}`);
            resolve(response);
          }
        });

        // 데이터 전송 전 로그 추가
        console.log('🔍 전송할 payload:', JSON.stringify(payload, null, 2));
        console.log('🔍 BcList 길이:', payload.BcList ? payload.BcList.length : 'undefined');
        if (payload.BcList && payload.BcList.length > 0) {
          // fileindex-go로 전달되는 트랜잭션 해시 출력
          const txIds = payload.BcList.map(bc => bc.TxId || bc.IndexableData?.TxId || 'unknown').filter(Boolean);
          console.log(`📝 fileindex-go로 전달되는 트랜잭션 해시: ${txIds.join(', ')}`);
          console.log('🔍 BcList[0]:', JSON.stringify(payload.BcList[0], null, 2));
        }
        
        // 데이터 전송
        console.log(`📤 fileindex-go로 데이터 전송 시작 (gRPC)`);
        stream.write(payload);
        stream.end();
        console.log('✅ Data sent to stream');
        
      } catch (error) {
        console.error(`Failed to create stream: ${error.message}`);
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
      const defaultAbiPath = path.join(__dirname, '../../etri-index/contract/artifacts/contracts/AccessManagement.sol/AccessManagement.json');
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
}

module.exports = IndexingClient;

