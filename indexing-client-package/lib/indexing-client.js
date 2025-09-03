const grpc = require('@grpc/grpc-js');
const protoLoader = require('@grpc/proto-loader');
const config = require('../config/indexing-config');

/**
 * Blockchain Indexing Client
 * gRPC를 통해 idxmngr 서버와 통신하는 클라이언트
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
    this.connect();
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
      console.log(`✅ Connected to idxmngr server at ${this.config.serverAddr}`);
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
}

module.exports = IndexingClient;
