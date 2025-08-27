const grpc = require('@grpc/grpc-js');
const protoLoader = require('@grpc/proto-loader');

// Protobuf 파일 경로 (idxmngr-go의 protobuf 사용)
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

class UniversalOrgTestClient {
  constructor(serverAddr = 'localhost:50052') {
    this.serverAddr = serverAddr;
    this.client = null;
    this.connect();
  }

  // gRPC 서버에 연결
  connect() {
    try {
      // Index_manager 서비스 클라이언트 생성
      this.client = new idxmngr.Index_manager(
        this.serverAddr,
        grpc.credentials.createInsecure()
      );
      console.log(`✅ Connected to idxmngr server at ${this.serverAddr}`);
    } catch (error) {
      console.error(`❌ Failed to connect to idxmngr server: ${error.message}`);
    }
  }

  // fcreateuniversalorg 테스트 - 범용 조직 인덱스 생성
  async testFcreateuniversalorg() {
    console.log('\n🏗️ Testing fcreateuniversalorg (범용 조직 인덱스 생성)...');
    
    try {
      const indexInfo = {
        IndexID: 'fileidx_universal_org',
        IndexName: 'Universal Organization Index',
        KeyCol: 'IndexableData',
        FilePath: '/home/blockchain/bi-index-migration/bi-index/fileindex-go/universal_org_file.bf',
        KeySize: 32
      };

      return new Promise((resolve, reject) => {
        this.client.CreateIndexRequest(indexInfo, (error, response) => {
          if (error) {
            console.error(`❌ CreateIndexRequest failed: ${error.message}`);
            reject(error);
          } else {
            console.log(`✅ Index created successfully: ${JSON.stringify(response)}`);
            resolve(response);
          }
        });
      });

    } catch (error) {
      console.error(`❌ fcreateuniversalorg test failed: ${error.message}`);
      throw error;
    }
  }

  // finsertuniversalorg 테스트 - 범용 조직 인덱스에 데이터 삽입
  async testFinsertuniversalorg() {
    console.log('\n🚀 Testing finsertuniversalorg (범용 조직 인덱스 데이터 삽입)...');
    
    try {
      // 더미 데이터 생성 (삼성전자 관련)
      const dummyDataList = this.generateIndexableDataDummy();
      console.log(`📊 생성된 더미 데이터: ${dummyDataList.length}개`);

      // BcDataList로 변환
      const bcDataList = dummyDataList.map(data => ({
        TxId: data.TxId,
        key_col: 'IndexableData',
        IndexableData: data
      }));

      const insertData = {
        IndexID: 'fileidx_universal_org',
        BcList: bcDataList,
        ColName: 'IndexableData',
        FilePath: '/home/blockchain/bi-index-migration/bi-index/fileindex-go/universal_org_file.bf'
      };

      // 스트림을 통한 데이터 삽입
      return new Promise((resolve, reject) => {
        const stream = this.client.InsertIndexRequest();
        
        stream.on('data', (response) => {
          console.log(`📥 Insert response: ${JSON.stringify(response)}`);
        });

        stream.on('end', () => {
          console.log('✅ Data insertion stream completed');
          resolve();
        });

        stream.on('error', (error) => {
          console.error(`❌ Stream error: ${error.message}`);
          reject(error);
        });

        // 데이터 전송
        try {
          stream.write(insertData);
          stream.end();
          console.log('✅ Data sent to stream');
        } catch (error) {
          console.error(`❌ Failed to write: ${error.message}`);
          reject(error);
        }
      });

    } catch (error) {
      console.error(`❌ finsertuniversalorg test failed: ${error.message}`);
      throw error;
    }
  }

  // fexactorg 테스트 - 범용 조직 인덱스에서 정확한 검색
  async testFexactorg() {
    console.log('\n🔍 Testing fexactorg (범용 조직 인덱스 정확한 검색)...');
    
    try {
      const searchRequest = {
        IndexID: 'fileidx_universal_org',
        Field: 'IndexableData',
        Value: '삼성전자',
        ComOp: 'Eq' // ComparisonOps.Eq
      };

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

  // IndexableData 더미 데이터 생성
  generateIndexableDataDummy() {
    const dummyDataList = [];

    // 삼성전자 관련 더미 데이터
    for (let i = 0; i < 7; i++) {
      const dummyData = {
        TxId: `samsung_tx_${i + 1}`,
        OrganizationName: '삼성전자',
        ContractAddress: `0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef${i}`,
        EventName: 'OrganizationCreated',
        DataJson: JSON.stringify({
          orgName: '삼성전자',
          orgType: 'Electronics',
          country: 'Korea',
          employeeCount: 100000 + i * 1000
        }),
        Timestamp: new Date().toISOString(),
        BlockNumber: 1000000 + i,
        Requester: `user_${i + 1}`,
        ResourceOwner: '삼성전자',
        Purpose: 'Business Partnership',
        Status: 'Active'
      };
      dummyDataList.push(dummyData);
    }

    return dummyDataList;
  }

  // 전체 테스트 실행
  async runAllTests() {
    console.log('🧪 Universal Organization Index Tests 시작...\n');
    
    try {
      // 1. 인덱스 생성 테스트
      await this.testFcreateuniversalorg();
      
      // 잠시 대기 (인덱스 생성 시간 고려)
      console.log('⏳ 인덱스 생성 대기 중... (3초)');
      await new Promise(resolve => setTimeout(resolve, 3000));
      
      // 2. 데이터 삽입 테스트
      await this.testFinsertuniversalorg();
      
      // 잠시 대기 (데이터 삽입 완료 대기)
      console.log('⏳ 데이터 삽입 완료 대기 중... (2초)');
      await new Promise(resolve => setTimeout(resolve, 2000));
      
      // 3. 데이터 검색 테스트
      await this.testFexactorg();
      
      console.log('\n🎉 모든 테스트가 성공적으로 완료되었습니다!');
      
    } catch (error) {
      console.error('\n💥 테스트 실행 중 오류가 발생했습니다:', error.message);
    }
  }
}

// 테스트 실행
if (require.main === module) {
  const client = new UniversalOrgTestClient();
  
  // 서버 연결 대기
  setTimeout(async () => {
    await client.runAllTests();
  }, 1000);
}

module.exports = UniversalOrgTestClient;
