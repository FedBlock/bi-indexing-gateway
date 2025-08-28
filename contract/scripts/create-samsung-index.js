/**
 * Hardhat 네트워크용 Samsung 인덱스 생성 전용 스크립트
 * hardhat_a513E6E4_speed 인덱스를 먼저 생성
 */
async function main() {
  console.log("️ Hardhat 네트워크 - Samsung 인덱스 생성 시작...");

  try {
    // gRPC 클라이언트로 idxmngr에 직접 요청
    const grpc = require('@grpc/grpc-js');
    const protoLoader = require('@grpc/proto-loader');
    
    // protobuf 로드
    const packageDefinition = protoLoader.loadSync(
      '../idxmngr-go/protos/index_manager.proto',
      {
        keepCase: true,
        longs: String,
        enums: String,
        defaults: true,
        oneofs: true
      }
    );
    
    const protoDescriptor = grpc.loadPackageDefinition(packageDefinition);
    const idxmngr = protoDescriptor.idxmngrapi;
    
    // idxmngr 서버에 연결
    const client = new idxmngr.Index_manager(
      'localhost:50052',
      grpc.credentials.createInsecure()
    );

    // Hardhat 네트워크용 인덱스 정보
    const indexInfo = {
      IndexID: 'hardhat_a513E6E4_speed',
      IndexName: 'Hardhat Network - Samsung Speed Index',
      KeyCol: 'IndexableData',
      FilePath: 'hardhat_a513E6E4_speed.bf',
      KeySize: 32,
      BlockNum: 0,
      CallCnt: 0,
      KeyCnt: 0,
      IndexDataCnt: 0,
      Param: ''
    };

    console.log(`\n📋 생성할 인덱스 정보:`);
    console.log(`   IndexID: ${indexInfo.IndexID}`);
    console.log(`   IndexName: ${indexInfo.IndexName}`);
    console.log(`   KeyCol: ${indexInfo.KeyCol}`);
    console.log(`   FilePath: ${indexInfo.FilePath}`);
    console.log(`   KeySize: ${indexInfo.KeySize}`);
    console.log(`   Network: hardhat`);

    // 1. 인덱스 정보 확인 (이미 존재하는지)
    console.log(`\n🔍 1️⃣ 인덱스 정보 확인...`);
    try {
      const existingInfo = await new Promise((resolve, reject) => {
        client.GetIndexInfo({
          IndexID: indexInfo.IndexID,
          IndexName: indexInfo.IndexName,
          KeyCol: indexInfo.KeyCol,
          FilePath: indexInfo.FilePath,
          KeySize: indexInfo.KeySize
        }, (error, response) => {
          if (error) reject(error);
          else resolve(response);
        });
      });
      
      console.log(`✅ 인덱스 정보: ${JSON.stringify(existingInfo)}`);
      
      if (existingInfo.ResponseCode === 200) {
        console.log(`ℹ️  인덱스가 이미 존재함: ${existingInfo.ResponseMessage}`);
        return {
          indexID: indexInfo.IndexID,
          status: 'already_exists',
          message: existingInfo.ResponseMessage,
          network: 'hardhat'
        };
      }
    } catch (error) {
      console.log(`ℹ️  인덱스 정보 조회 실패: ${error.message}`);
    }

    // 2. 인덱스 생성
    console.log(`\n🏗️ 2️⃣ 인덱스 생성 중...`);
    const result = await new Promise((resolve, reject) => {
      client.CreateIndexRequest({
        IndexID: indexInfo.IndexID,
        IndexName: indexInfo.IndexName,
        KeyCol: indexInfo.KeyCol,
        FilePath: indexInfo.FilePath,
        KeySize: indexInfo.KeySize,
        BlockNum: indexInfo.BlockNum,
        CallCnt: indexInfo.CallCnt,
        KeyCnt: indexInfo.KeyCnt,
        IndexDataCnt: indexInfo.IndexDataCnt,
        Param: indexInfo.Param
      }, (error, response) => {
        if (error) reject(error);
        else resolve(response);
      });
    });
    
    console.log(`✅ 인덱스 생성 성공!`);
    console.log(`   결과: ${JSON.stringify(result)}`);

    return {
      indexID: indexInfo.IndexID,
      status: 'created',
      result: result,
      network: 'hardhat'
    };

  } catch (error) {
    console.error(`❌ 인덱스 생성 실패: ${error.message}`);
    throw error;
  }
}

main()
  .then((result) => {
    console.log(`\n🎉 Hardhat 네트워크 - Samsung 인덱스 생성 완료!`);
    console.log(`   IndexID: ${result.indexID}`);
    console.log(`   Status: ${result.status}`);
    console.log(`   Network: ${result.network}`);
    if (result.status === 'created') {
      console.log(`\n📋 다음 단계: 데이터 삽입 테스트`);
    }
    process.exit(0);
  })
  .catch((error) => {
    console.error("❌ 인덱스 생성 실패:", error);
    process.exit(1);
  });