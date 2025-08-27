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

class DataInserter {
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

  // IndexableData 더미 데이터 생성
  generateIndexableDataDummy() {
    const dummyDataList = [];

    // LG전자 관련 더미 데이터
    for (let i = 0; i < 7; i++) {
      const dummyData = {
        TxId: `lg_tx_${i + 1}`,
        OrganizationName: 'LG전자',
        ContractAddress: `0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef${i}`,
        EventName: 'OrganizationCreated',
        DataJson: JSON.stringify({
          orgName: 'LG전자',
          orgType: 'Electronics',
          country: 'Korea',
          employeeCount: 100000 + i * 1000
        }),
        Timestamp: new Date().toISOString(),
        BlockNumber: 1000000 + i,
        Requester: `user_${i + 1}`,
        ResourceOwner: 'LG전자',
        Purpose: 'Business Partnership',
        Status: 'Active'
      };
      dummyDataList.push(dummyData);
    }

    return dummyDataList;
  }

  // 범용 조직 인덱스에 데이터 삽입
  async insertUniversalOrgData() {
    console.log('\n🚀 Inserting data into Universal Organization Index...');
    
    try {
      // 더미 데이터 생성
      const dummyDataList = this.generateIndexableDataDummy();
      console.log(`📊 Generated dummy data: ${dummyDataList.length} records`);

      // BcDataList로 변환
      const bcDataList = dummyDataList.map(data => ({
        TxId: data.TxId,
        key_col: 'IndexableData',
        IndexableData: data
      }));

      const insertData = {
        IndexID: 'lg_002',
        BcList: bcDataList,
        ColName: 'IndexableData',
        FilePath: '/home/blockchain/bi-index-migration/bi-index/fileindex-go/lg.bf'
      };

      console.log('📤 Insert data structure:');
      console.log(JSON.stringify(insertData, null, 2));

      // 스트림을 통한 데이터 삽입
      return new Promise((resolve, reject) => {
        try {
          // idxmngr-client.js와 동일한 방식으로 콜백 전달
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
          stream.write(insertData);
          stream.end();
          console.log('✅ Data sent to stream');
          
        } catch (error) {
          console.error(`❌ Failed to create stream: ${error.message}`);
          reject(error);
        }
      });

    } catch (error) {
      console.error(`❌ Data insertion failed: ${error.message}`);
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
  const inserter = new DataInserter();
  
  try {
    // 연결 완료 대기
    await new Promise(resolve => setTimeout(resolve, 1000));
    
    // 데이터 삽입
    await inserter.insertUniversalOrgData();
    
    console.log('\n🎉 Data insertion test completed successfully!');
    
  } catch (error) {
    console.error('\n💥 Data insertion test failed:', error.message);
  } finally {
    inserter.close();
  }
}

// 스크립트가 직접 실행될 때만 main 함수 실행
if (require.main === module) {
  main();
}

module.exports = DataInserter;
