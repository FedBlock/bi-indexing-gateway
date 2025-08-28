/**
 * gRPC 연결 테스트 전용 스크립트
 * idxmngr 서버에 연결이 되는지 확인
 */
async function main() {
  console.log("🔌 gRPC 연결 테스트 시작...");

  try {
    // gRPC 클라이언트로 idxmngr에 직접 요청
    const grpc = require('@grpc/grpc-js');
    const protoLoader = require('@grpc/proto-loader');
    
    // protobuf 로드
    console.log("📁 protobuf 파일 로드 중...");
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
    
    console.log("✅ protobuf 로드 완료");
    console.log("🔗 idxmngr 서버에 연결 시도 중... (localhost:50052)");
    
    // idxmngr 서버에 연결
    const client = new idxmngr.Index_manager(
      'localhost:50052',
      grpc.credentials.createInsecure()
    );
    
    console.log("✅ gRPC 클라이언트 생성 완료");
    
    // 간단한 연결 테스트 - GetIndexList 호출
    console.log("📋 GetIndexList 호출 테스트...");
    
    const result = await new Promise((resolve, reject) => {
      client.GetIndexList({
        RequestMsg: 'INDEX LIST PLEASE'
      }, (error, response) => {
        if (error) {
          reject(error);
        } else {
          resolve(response);
        }
      });
    });
    
    console.log("✅ GetIndexList 호출 성공!");
    console.log(`   응답: ${JSON.stringify(result)}`);
    
    return {
      status: 'success',
      message: 'gRPC 연결 및 GetIndexList 호출 성공'
    };

  } catch (error) {
    console.error(`❌ gRPC 연결 테스트 실패: ${error.message}`);
    console.error(`   오류 상세: ${error.stack}`);
    throw error;
  }
}

main()
  .then((result) => {
    console.log(`\n🎉 gRPC 연결 테스트 성공!`);
    console.log(`   Status: ${result.status}`);
    console.log(`   Message: ${result.message}`);
    process.exit(0);
  })
  .catch((error) => {
    console.error("❌ gRPC 연결 테스트 실패:", error);
    process.exit(1);
  });
