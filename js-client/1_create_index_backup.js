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

class IndexCreator {
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

  // 범용 조직 인덱스 생성
  async createHyundaiIndex() {
    console.log('\n🏗️ Creating Hyundai Access Request Index...');
    
    try {
      const indexInfo = {
        IndexID: 'hyundai_003',
        IndexName: 'Hyundai Access Request Index',
        KeyCol: 'IndexableData',
        FilePath: '/home/blockchain/bi-index-migration/bi-index/fileindex-go/hyundai.bf',
        KeySize: 32
      };

      return new Promise((resolve, reject) => {
        this.client.CreateIndexRequest(indexInfo, (error, response) => {
          if (error) {
            console.error(`❌ CreateIndexRequest failed: ${error.message}`);
            reject(error);
          } else {
            console.log(`✅ Index created successfully:`);
            console.log(`   Response Code: ${response.ResponseCode}`);
            console.log(`   Response Message: ${response.ResponseMessage}`);
            console.log(`   Duration: ${response.Duration}ns`);
            console.log(`   Index ID: ${response.IndexID}`);
            resolve(response);
          }
        });
      });

    } catch (error) {
      console.error(`❌ Index creation failed: ${error.message}`);
      throw error;
    }
  }

  // 인덱스 정보 확인
  async checkIndexInfo() {
    console.log('\n🔍 Checking index info...');
    
    try {
      const request = { 
        IndexID: 'hyundai_003',
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
  const creator = new IndexCreator();
  
  try {
    // 연결 완료 대기
    await new Promise(resolve => setTimeout(resolve, 1000));
    
    // 1. 인덱스 생성
    await creator.createHyundaiIndex();
    
    // 2. 잠시 대기
    console.log('\n⏳ Waiting for index creation to complete... (3초)');
    await new Promise(resolve => setTimeout(resolve, 3000));
    
    // 3. 인덱스 정보 확인
    await creator.checkIndexInfo();
    
    console.log('\n🎉 Index creation test completed successfully!');
    
  } catch (error) {
    console.error('\n💥 Index creation test failed:', error.message);
  } finally {
    creator.close();
  }
}

// 스크립트가 직접 실행될 때만 main 함수 실행
if (require.main === module) {
  main();
}

module.exports = IndexCreator;
