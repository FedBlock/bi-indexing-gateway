const hre = require("hardhat");
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

class IndexClient {
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

  // 인덱스에 데이터 삽입
  async insertTransaction(indexData) {
    console.log('\n🚀 Inserting transaction data into index...');
    
    try {
      // BcDataList로 변환
      const bcDataList = [{
        TxId: indexData.txHash,
        key_col: 'IndexableData',
        IndexableData: {
          TxId: indexData.txHash,
          OrganizationName: indexData.organization,
          ContractAddress: '0x0000000000000000000000000000000000000000', // 기본값
          EventName: 'AccessRequestsSaved',
          DataJson: JSON.stringify({
            requestId: indexData.requestId,
            requester: indexData.requester,
            resourceOwner: indexData.resourceOwner,
            purpose: indexData.purpose,
            status: indexData.status
          }),
          Timestamp: indexData.timestamp,
          BlockNumber: indexData.blockNumber,
          Requester: indexData.requester,
          ResourceOwner: indexData.resourceOwner,
          Purpose: indexData.purpose,
          Status: indexData.status
        }
      }];

      const insertData = {
        IndexID: 'samsung_001',
        BcList: bcDataList,
        ColName: 'IndexableData',
        FilePath: '/home/blockchain/bi-index-migration/bi-index/fileindex-go/samsung.bf'
      };

      console.log('📤 Insert data structure:');
      console.log(JSON.stringify(insertData, null, 2));

      // 스트림을 통한 데이터 삽입
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

async function main() {
  console.log("🏢 Samsung Access Request + Indexing 테스트 시작...");

  // Samsung 계정 (Account #0)
  const [samsungAccount] = await hre.ethers.getSigners();
  console.log(`📱 Samsung 계정: ${samsungAccount.address}`);

  // 실제 배포된 컨트랙트 주소 설정
  // TODO: 실제 배포된 컨트랙트 주소로 변경하세요
  const contractAddress = "0x5FbDB2315678afecb367f032d93F642f64180aa3"; // 하드햃 기본 주소
  // const contractAddress = "0x..."; // 실제 배포된 주소
  
  console.log(`📍 컨트랙트 주소: ${contractAddress}`);
  console.log(`⚠️  주의: 실제 배포된 컨트랙트 주소인지 확인하세요!`);

  // AccessManagement 컨트랙트 인스턴스 생성
  const AccessManagement = await hre.ethers.getContractFactory("AccessManagement");
  const accessManagement = AccessManagement.attach(contractAddress);

  // Samsung 조직 정보
  const organizationName = "삼성전자";
  const requester = samsungAccount.address;
  const resourceOwner = "0x8626f6940E2eb28930eFb4CeF49B2d1F2C9C1199"; // Account #19
  const purpose = "Business Partnership";

  console.log(`\n📋 Access Request 정보:`);
  console.log(`   Organization: ${organizationName}`);
  console.log(`   Requester: ${requester}`);
  console.log(`   Resource Owner: ${resourceOwner}`);
  console.log(`   Purpose: ${purpose}`);

  // 인덱스 클라이언트 생성
  const indexClient = new IndexClient();

  try {
    // 연결 완료 대기
    await new Promise(resolve => setTimeout(resolve, 1000));

    // 1. saveRequest 함수 호출
    console.log(`\n🚀 saveRequest 함수 호출 중...`);
    const tx = await accessManagement.saveRequest(
      resourceOwner,
      purpose,
      organizationName
    );

    console.log(`📝 트랜잭션 전송됨: ${tx.hash}`);
    
    // 트랜잭션 완료 대기
    const receipt = await tx.wait();
    console.log(`✅ 트랜잭션 완료!`);
    console.log(`   Block Number: ${receipt.blockNumber}`);
    console.log(`   Gas Used: ${receipt.gasUsed.toString()}`);
    console.log(`   Tx Hash: ${receipt.hash}`);

    // 2. saveRequest 함수 호출 결과로 받은 requestId 사용
    console.log(`\n📊 saveRequest 함수 호출 결과 분석 중...`);
    
    // saveRequest 함수는 requestId를 반환하므로 트랜잭션 결과에서 확인
    // 트랜잭션 결과에서 requestId를 추출하기 위해 이벤트 로그를 확인
    let requestId = null;
    
    // AccessRequestsSaved 이벤트에서 requestId 추출
    for (const log of receipt.logs) {
      try {
        const parsedLog = accessManagement.interface.parseLog(log);
        if (parsedLog.name === 'AccessRequestsSaved') {
          requestId = parsedLog.args.requestId.toString();
          console.log(`   ✅ AccessRequestsSaved 이벤트에서 Request ID 추출: ${requestId}`);
          break;
        }
      } catch (error) {
        // 다른 컨트랙트의 로그일 수 있음, 무시
        continue;
      }
    }

    if (!requestId) {
      throw new Error("AccessRequestsSaved 이벤트에서 requestId를 찾을 수 없습니다.");
    }

    // 3. 실제 txId와 requestId를 인덱스에 삽입
    console.log(`\n📊 인덱스 삽입 로직 실행 중...`);
    console.log(`   TxId: ${receipt.hash}`);
    console.log(`   Request ID: ${requestId}`);
    console.log(`   Organization: ${organizationName}`);
    console.log(`   Block Number: ${receipt.blockNumber}`);
    console.log(`   Timestamp: ${new Date().toISOString()}`);
    
    // 인덱스 데이터 구성
    const indexData = {
      txHash: receipt.hash,
      requestId: requestId,
      organization: organizationName,
      requester: requester,
      resourceOwner: resourceOwner,
      purpose: purpose,
      blockNumber: receipt.blockNumber,
      timestamp: new Date().toISOString(),
      status: 'PENDING'
    };

    console.log(`\n📋 인덱스에 삽입될 데이터:`);
    console.log(JSON.stringify(indexData, null, 2));

    // gRPC를 통해 인덱스 서버에 데이터 삽입
    console.log(`\n🌐 gRPC를 통해 인덱스 서버에 데이터 삽입 중...`);
    
    try {
      await indexClient.insertTransaction(indexData);
      console.log(`✅ 인덱스 서버 삽입 성공!`);
    } catch (error) {
      console.error(`❌ 인덱스 서버 삽입 실패: ${error.message}`);
      console.log(`   idxmngr 서버가 실행 중인지 확인해주세요.`);
    }
    
    console.log(`✅ 인덱스 삽입 완료!`);
    console.log(`\n🎯 다음 단계: 인덱스에서 실제 txId 검색 테스트`);

    return {
      txHash: receipt.hash,
      requestId: requestId,
      indexData: indexData
    };

  } catch (error) {
    console.error(`❌ 테스트 실패: ${error.message}`);
    throw error;
  } finally {
    // 인덱스 클라이언트 연결 종료
    indexClient.close();
  }
}

main()
  .then((result) => {
    console.log(`\n🎉 Samsung Access Request + Indexing 성공!`);
    console.log(`   Tx Hash: ${result.txHash}`);
    console.log(`   Request ID: ${result.requestId}`);
    console.log(`\n📋 다음 단계:`);
    console.log(`   1. 인덱스 서버에 실제 txId 삽입 완료`);
    console.log(`   2. 인덱스에서 실제 txId 검색`);
    console.log(`   3. 검색 결과 확인`);
    console.log(`   4. 인덱스 데이터 검증`);
    process.exit(0);
  })
  .catch((error) => {
    console.error("❌ 테스트 실패:", error);
    process.exit(1);
  });