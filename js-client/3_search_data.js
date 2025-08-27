const grpc = require('@grpc/grpc-js');
const protoLoader = require('@grpc/proto-loader');

// Protobuf 파일 경로
const PROTO_PATH = '../idxmngr-go/protos/index_manager.proto';

// gRPC 옵션 설정
const options = {
  keepCase: true,
  longs: String,
  enums: String,
  defaults: true,
  oneofs: true
};

// Protobuf 로드
const packageDefinition = protoLoader.loadSync(PROTO_PATH, options);
const idxmngr = grpc.loadPackageDefinition(packageDefinition).idxmngrapi;

class DataSearcher {
  constructor(serverAddr = 'localhost:50052') {
    this.serverAddr = serverAddr;
    this.client = null;
    this.connect();
  }

  // gRPC 서버에 연결
  connect() {
    try {
      this.client = new idxmngr.Index_manager(
        this.serverAddr,
        grpc.credentials.createInsecure()
      );
      console.log(`✅ Connected to idxmngr server at ${this.serverAddr}`);
    } catch (error) {
      console.error(`❌ Failed to connect to idxmngr server: ${error.message}`);
    }
  }

  // fexactorg 테스트 - 범용 조직 인덱스에서 정확한 검색
  async searchExactOrg() {
    console.log('\n🔍 Testing fexactorg (범용 조직 인덱스 정확한 검색)...');
    
    try {
      const searchRequest = {
        IndexID: 'lg_002',
        Field: 'IndexableData',
        Value: 'LG전자',
        ComOp: 'Eq' // ComparisonOps.Eq
      };

      console.log('📤 Search request:');
      console.log(JSON.stringify(searchRequest, null, 2));

      return new Promise((resolve, reject) => {
        this.client.GetindexDataByFieldM(searchRequest, (error, response) => {
          if (error) {
            console.error(`❌ fexactorg search failed: ${error.message}`);
            reject(error);
          } else {
            console.log(`✅ fexactorg search successful:`);
            console.log(`📊 검색 결과 TxId 개수: ${response.IdxData ? response.IdxData.length : 0}`);
            
            if (response.IdxData && response.IdxData.length > 0) {
              console.log('📋 검색된 TxId 목록:');
              response.IdxData.forEach((txId, index) => {
                console.log(`  [${index + 1}] ${txId}`);
              });
            } else {
              console.log('📭 검색 결과가 없습니다.');
            }
            
            resolve(response);
          }
        });
      });

    } catch (error) {
      console.error(`❌ fexactorg test failed: ${error.message}`);
      throw error;
    }
  }



  // 인덱스 정보 확인
  async checkIndexInfo() {
    console.log('\n🔍 Checking index info...');
    
    try {
      const request = { 
        IndexID: 'lg_002',
        KeyCol: 'IndexableData'
      };

      return new Promise((resolve, reject) => {
        this.client.GetIndexInfo(request, (error, response) => {
          if (error) {
            console.error(`❌ GetIndexInfo failed: ${error.message}`);
            reject(error);
          } else {
            console.log(`✅ Index info retrieved:`);
            console.log(`   Response Code: ${response.ResponseCode}`);
            console.log(`   Response Message: ${response.ResponseMessage}`);
            resolve(response);
          }
        });
      });

    } catch (error) {
      console.error(`❌ Index info check failed: ${error.message}`);
      throw error;
    }
  }

  // 연결 종료
  close() {
    if (this.client) {
      this.client.close();
      console.log('🔌 Connection closed');
    }
  }
}

  // 메인 실행 함수
  async function main() {
    const searcher = new DataSearcher();
    
    try {
      // 연결 완료 대기
      await new Promise(resolve => setTimeout(resolve, 1000));
      
      // 1. 인덱스 정보 확인
      await searcher.checkIndexInfo();
      
      // 2. 정확한 검색 테스트 (fexactorg)
      await searcher.searchExactOrg();
      
      console.log('\n🎉 Data search test completed successfully!');
      
    } catch (error) {
      console.error('\n💥 Data search test failed:', error.message);
    } finally {
      searcher.close();
    }
  }

// 스크립트가 직접 실행될 때만 main 함수 실행
if (require.main === module) {
  main();
}

module.exports = DataSearcher;
