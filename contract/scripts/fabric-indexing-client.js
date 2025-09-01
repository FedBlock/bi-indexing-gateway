#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const grpc = require('@grpc/grpc-js');
const protoLoader = require('@grpc/proto-loader');

/**
 * Fabric 전용 인덱싱 클라이언트
 * idxmngr-go 서버와 통신하여 Fabric 네트워크 데이터를 인덱싱
 */
class FabricIndexingClient {
  constructor(options = {}) {
    this.serverAddr = options.serverAddr || 'localhost:50052';
    this.protoPath = options.protoPath || '/home/blockchain/bi-index-migration/bi-index/idxmngr-go/protos/index_manager.proto';
    this.client = null;
    this.connected = false;
    this.serviceDefinition = null;
  }

  /**
   * proto 파일 로드 및 서비스 정의 생성
   */
  loadProto() {
    try {
      const packageDefinition = protoLoader.loadSync(this.protoPath, {
        keepCase: true,
        longs: String,
        enums: String,
        defaults: true,
        oneofs: true
      });
      
      this.serviceDefinition = grpc.loadPackageDefinition(packageDefinition);
      console.log('✅ Proto 파일 로드 완료');
      return true;
    } catch (error) {
      console.error('❌ Proto 파일 로드 실패:', error.message);
      throw error;
    }
  }

  /**
   * idxmngr-go 서버에 연결
   */
  async connect() {
    try {
      console.log(`🔗 Fabric 인덱싱 서버 연결 시도: ${this.serverAddr}`);
      
      // Proto 파일 로드
      this.loadProto();
      
      // gRPC 클라이언트 생성
      if (this.serviceDefinition && this.serviceDefinition.idxmngrapi) {
        this.client = new this.serviceDefinition.idxmngrapi.Index_manager(
          this.serverAddr,
          grpc.credentials.createInsecure()
        );
        
        // 연결 테스트
        await this.testConnection();
        this.connected = true;
        console.log('✅ Fabric 인덱싱 서버 연결 성공');
        return true;
      } else {
        throw new Error('Proto 서비스 정의를 찾을 수 없습니다');
      }
      
    } catch (error) {
      console.error('❌ Fabric 인덱싱 서버 연결 실패:', error.message);
      throw error;
    }
  }

  /**
   * 연결 테스트
   */
  testConnection() {
    return new Promise((resolve, reject) => {
      const deadline = new Date();
      deadline.setSeconds(deadline.getSeconds() + 5);
      
      this.client.waitForReady(deadline, (error) => {
        if (error) {
          reject(error);
        } else {
          resolve();
        }
      });
    });
  }

  /**
   * Fabric 인덱스 생성
   * @param {Object} indexInfo - 인덱스 정보
   * @param {string} indexInfo.IndexID - 인덱스 ID
   * @param {string} indexInfo.IndexName - 인덱스 이름
   * @param {string} indexInfo.KeyCol - 키 컬럼
   * @param {string} indexInfo.FilePath - 파일 경로
   * @param {number} indexInfo.KeySize - 키 크기
   * @param {string} indexInfo.Network - 네트워크 타입
   */
  async createIndex(indexInfo) {
    try {
      if (!this.connected || !this.client) {
        throw new Error('서버에 연결되지 않음. connect() 메서드를 먼저 호출하세요.');
      }

      console.log(`📊 Fabric 인덱스 생성 중: ${indexInfo.IndexID}`);
      
      return new Promise((resolve, reject) => {
        this.client.CreateIndexRequest(indexInfo, (error, response) => {
          if (error) {
            console.error(`❌ Fabric 인덱스 생성 실패: ${error.message}`);
            reject(error);
          } else {
            console.log(`✅ Fabric 인덱스 생성 완료: ${indexInfo.IndexID}`);
            console.log(`📁 파일 경로: ${indexInfo.FilePath}`);
            resolve(response);
          }
        });
      });
      
    } catch (error) {
      console.error(`❌ Fabric 인덱스 생성 실패: ${error.message}`);
      throw error;
    }
  }

  /**
   * Fabric 데이터 인덱싱
   * @param {Object} indexData - 인덱싱할 데이터
   * @param {string} indexData.IndexID - 인덱스 ID
   * @param {Array} indexData.BcList - 블록체인 데이터 리스트
   * @param {string} indexData.ColName - 컬럼 이름
   * @param {string} indexData.ColIndex - 컬럼 인덱스
   * @param {string} indexData.FilePath - 파일 경로
   * @param {string} indexData.Network - 네트워크 타입
   */
  async insertData(indexData) {
    try {
      if (!this.connected || !this.client) {
        throw new Error('서버에 연결되지 않음. connect() 메서드를 먼저 호출하세요.');
      }

      console.log(`📊 Fabric 데이터 인덱싱 중: ${indexData.IndexID}`);
      
      return new Promise((resolve, reject) => {
        this.client.InsertIndexRequest(indexData, (error, response) => {
          if (error) {
            console.error(`❌ Fabric 데이터 인덱싱 실패: ${error.message}`);
            reject(error);
          } else {
            console.log(`✅ Fabric 데이터 인덱싱 완료: ${indexData.IndexID}`);
            console.log(`📁 인덱스 파일: ${indexData.FilePath}`);
            console.log(`📊 인덱싱된 데이터 수: ${indexData.BcList ? indexData.BcList.length : 0}`);
            resolve(response);
          }
        });
      });
      
    } catch (error) {
      console.error(`❌ Fabric 데이터 인덱싱 실패: ${error.message}`);
      throw error;
    }
  }

  /**
   * Fabric 인덱스 조회
   * @param {string} indexID - 조회할 인덱스 ID
   */
  async getIndex(indexID) {
    try {
      if (!this.connected || !this.client) {
        throw new Error('서버에 연결되지 않음. connect() 메서드를 먼저 호출하세요.');
      }

      console.log(`🔍 Fabric 인덱스 조회 중: ${indexID}`);
      
      return new Promise((resolve, reject) => {
        this.client.GetIndex({ IndexID: indexID }, (error, response) => {
          if (error) {
            console.error(`❌ Fabric 인덱스 조회 실패: ${error.message}`);
            reject(error);
          } else {
            console.log(`✅ Fabric 인덱스 조회 완료: ${indexID}`);
            resolve(response);
          }
        });
      });
      
    } catch (error) {
      console.error(`❌ Fabric 인덱스 조회 실패: ${error.message}`);
      throw error;
    }
  }

  /**
   * Fabric 인덱스 삭제
   * @param {string} indexID - 삭제할 인덱스 ID
   */
  async deleteIndex(indexID) {
    try {
      if (!this.connected || !this.client) {
        throw new Error('서버에 연결되지 않음. connect() 메서드를 먼저 호출하세요.');
      }

      console.log(`🗑️ Fabric 인덱스 삭제 중: ${indexID}`);
      
      return new Promise((resolve, reject) => {
        this.client.DeleteIndex({ IndexID: indexID }, (error, response) => {
          if (error) {
            console.error(`❌ Fabric 인덱스 삭제 실패: ${error.message}`);
            reject(error);
          } else {
            console.log(`✅ Fabric 인덱스 삭제 완료: ${indexID}`);
            resolve(response);
          }
        });
      });
      
    } catch (error) {
      console.error(`❌ Fabric 인덱스 삭제 실패: ${error.message}`);
      throw error;
    }
  }

  /**
   * Fabric 데이터 검색
   * @param {Object} searchRequest - 검색 요청
   * @param {string} searchRequest.IndexID - 인덱스 ID
   * @param {string} searchRequest.Field - 검색 필드
   * @param {string} searchRequest.Value - 검색값
   * @param {string} searchRequest.FilePath - 파일 경로
   * @param {number} searchRequest.KeySize - 키 크기
   * @param {string} searchRequest.ComOp - 비교 연산자 (Eq, Greater 등)
   */
  async searchData(searchRequest) {
    try {
      if (!this.connected || !this.client) {
        throw new Error('서버에 연결되지 않음. connect() 메서드를 먼저 호출하세요.');
      }

      console.log(`🔍 Fabric 데이터 검색 중: ${searchRequest.IndexID}`);
      console.log(`   📊 검색 필드: ${searchRequest.Field}`);
      console.log(`   🔎 검색값: ${searchRequest.Value}`);
      
      return new Promise((resolve, reject) => {
        this.client.GetindexDataByFieldM(searchRequest, (error, response) => {
          if (error) {
            console.error(`❌ Fabric 데이터 검색 실패: ${error.message}`);
            reject(error);
          } else {
            console.log(`✅ Fabric 데이터 검색 완료: ${searchRequest.IndexID}`);
            console.log(`📊 검색 결과 수: ${response.IdxData ? response.IdxData.length : 0}`);
            resolve(response);
          }
        });
      });
      
    } catch (error) {
      console.error(`❌ Fabric 데이터 검색 실패: ${error.message}`);
      throw error;
    }
  }

  /**
   * 연결 상태 확인
   */
  isConnected() {
    return this.connected && this.client;
  }

  /**
   * 서버 연결 종료
   */
  close() {
    if (this.client) {
      this.client.close();
      this.connected = false;
      console.log('🔌 Fabric 인덱싱 서버 연결 종료');
    }
  }
}

module.exports = FabricIndexingClient;
