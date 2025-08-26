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

class IdxmngrClient {
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

  // 인덱스 생성
  async createIndex(indexID, indexName, keyCol, filePath, keySize) {
    return new Promise((resolve, reject) => {
      if (!this.client) {
        reject(new Error('Client not connected'));
        return;
      }

      const request = {
        IndexID: indexID,
        IndexName: indexName,
        KeyCol: keyCol,
        FilePath: filePath,
        KeySize: keySize
      };

      this.client.CreateIndexRequest(request, (error, response) => {
        if (error) {
          console.error(`❌ CreateIndexRequest failed: ${error.message}`);
          reject(error);
        } else {
          console.log(`✅ Index created successfully: ${JSON.stringify(response)}`);
          resolve(response);
        }
      });
    });
  }

  // 인덱스 정보 조회
  async getIndexInfo(indexID) {
    return new Promise((resolve, reject) => {
      if (!this.client) {
        reject(new Error('Client not connected'));
        return;
      }

      const request = { IndexID: indexID };

      this.client.GetIndexInfo(request, (error, response) => {
        if (error) {
          console.error(`❌ GetIndexInfo failed: ${error.message}`);
          reject(error);
        } else {
          console.log(`✅ Index info: ${JSON.stringify(response)}`);
          resolve(response);
        }
      });
    });
  }

  // 인덱스 리스트 조회
  async getIndexList() {
    return new Promise((resolve, reject) => {
      if (!this.client) {
        reject(new Error('Client not connected'));
        return;
      }

      const request = { RequestMsg: "INDEX LIST PLEASE" };

      this.client.GetIndexList(request, (error, response) => {
        if (error) {
          console.error(`❌ GetIndexList failed: ${error.message}`);
          reject(error);
        } else {
          console.log(`✅ Index list: ${JSON.stringify(response)}`);
          resolve(response);
        }
      });
    });
  }

  // 데이터 삽입 (단일)
  async insertData(indexID, txId, organizationName) {
    return new Promise((resolve, reject) => {
      if (!this.client) {
        reject(new Error('Client not connected'));
        return;
      }

      console.log(`📝 Inserting data: IndexID=${indexID}, TxId=${txId}, Org=${organizationName}`);

      try {
        // 클라이언트 사이드 스트리밍 생성
        const stream = this.client.InsertIndexRequest((error, response) => {
          if (error) {
            console.error(`❌ InsertIndexRequest failed: ${error.message}`);
            reject(error);
          } else {
            console.log(`✅ Insert response received: ${JSON.stringify(response)}`);
            resolve(response);
          }
        });

        // 데이터 준비 (Go 코드와 정확히 동일한 구조)
        const insertData = {
          IndexID: indexID,
          BcList: [{
            TxId: txId,
            IndexableData: {
              TxId: txId,
              OrganizationName: organizationName
            }
          }],
          ColName: "IndexableData_OrganizationName",
          FilePath: `fileindex-go/${organizationName.toLowerCase().replace('전자', '')}.bf`
        };

        console.log('📤 Sending data structure:', JSON.stringify(insertData, null, 2));

        // 데이터 전송
        stream.write(insertData);
        
        // 스트림 종료
        stream.end();

      } catch (error) {
        console.error(`❌ Failed to create stream: ${error.message}`);
        reject(error);
      }
    });
  }

  // 데이터 검색
  async searchData(indexID, field, value, comparisonOp = 'Eq') {
    return new Promise((resolve, reject) => {
      if (!this.client) {
        reject(new Error('Client not connected'));
        return;
      }

      const request = {
        IndexID: indexID,
        Field: field,
        Value: value,
        ComOp: comparisonOp
      };

      this.client.GetindexDataByFieldM(request, (error, response) => {
        if (error) {
          console.error(`❌ Search failed: ${error.message}`);
          reject(error);
        } else {
          console.log(`✅ Search results: ${JSON.stringify(response)}`);
          
          // Go 코드와 동일하게 TxId 리스트 추출
          const txList = response.IdxData || [];
          console.log(`📊 Found ${txList.length} transactions`);
          
          if (txList.length > 0) {
            console.log('📋 Transaction IDs:');
            txList.forEach((txId, index) => {
              console.log(`  [${index + 1}] ${txId}`);
            });
          }
          
          resolve(response);
        }
      });
    });
  }

  // 연결 종료
  close() {
    if (this.client) {
      this.client.close();
      console.log('🔌 Connection closed');
    }
  }
}

// 사용 예제
async function main() {
  const client = new IdxmngrClient();
  
  try {
    // 잠시 대기 (연결 완료 대기)
    await new Promise(resolve => setTimeout(resolve, 1000));
    
    // 1. 인덱스 리스트 조회
    console.log('\n📋 Getting index list...');
    await client.getIndexList();
    
    // 2. 특정 인덱스 정보 조회
    console.log('\n🔍 Getting index info for org_samsung...');
    await client.getIndexInfo('org_samsung');
    
    // 3. 스마트 컨트랙트 트랜잭션 인덱싱
    console.log('\n📝 Inserting contract transaction...');
    await client.insertData(
      'org_samsung',
      '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef',
      '삼성전자'
    );
    
    // 4. 인덱싱된 데이터 검색
    console.log('\n🔍 Searching for indexed data...');
    await client.searchData('org_samsung', 'IndexableData_OrganizationName', '삼성전자');
    
  } catch (error) {
    console.error('❌ Error in main:', error.message);
  } finally {
    // 연결 종료
    client.close();
  }
}

// 스크립트가 직접 실행될 때만 main 함수 실행
if (require.main === module) {
  main();
}

module.exports = IdxmngrClient;
