const grpc = require('@grpc/grpc-js');
const protoLoader = require('@grpc/proto-loader');
const path = require('path');

async function createSingleRequest() {
  try {
    console.log('🔧 단일 Access Management 요청 생성 테스트...');
    
    // gRPC 클라이언트 설정
    const PROTO_PATH = path.join(__dirname, '../../grpc-go/accessapi/access_management.proto');
    const packageDefinition = protoLoader.loadSync(PROTO_PATH, {
      keepCase: true,
      longs: String,
      enums: String,
      defaults: true,
      oneofs: true
    });
    
    const accessProto = grpc.loadPackageDefinition(packageDefinition).accessapi;
    const client = new accessProto.AccessManagementService('localhost:19001', grpc.credentials.createInsecure());
    
    // 테스트 요청 데이터
    const testRequest = {
      resourceOwner: "test_user_new",
      purpose: "심박수_테스트",
      organizationName: "TEST_INDEXING_ORG"
    };
    
    console.log('📋 요청 데이터:', testRequest);
    
    // 요청 전송
    const response = await new Promise((resolve, reject) => {
      client.SaveAccessRequest(testRequest, (error, response) => {
        if (error) reject(error);
        else resolve(response);
      });
    });
    
    console.log('✅ 요청 생성 성공:', response);
    
    client.close();
    
    // 잠시 대기 (인덱싱 시간)
    console.log('⏳ 인덱싱 완료를 위해 3초 대기...');
    await new Promise(resolve => setTimeout(resolve, 3000));
    
    console.log('🎉 테스트 완료!');
    
  } catch (error) {
    console.error('❌ 테스트 실패:', error.message);
  }
}

// 실행ㅊㅚ근
createSingleRequest();
