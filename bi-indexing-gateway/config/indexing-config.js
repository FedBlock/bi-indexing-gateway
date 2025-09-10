/**
 * Indexing Client 기본 설정
 * 환경변수나 사용자 옵션으로 오버라이드 가능
 */
module.exports = {
  // gRPC 서버 주소
  serverAddr: process.env.INDEXING_SERVER_ADDR || 'localhost:50052',
  
  // Protobuf 파일 경로 (URL 또는 로컬 경로)
  protoPath: process.env.PROTO_PATH || 'https://api.bi-index.com/protos/index_manager.proto',
  
  // 기본 gRPC 옵션
  grpcOptions: {
    keepCase: true,
    longs: String,
    enums: String,
    defaults: true,
    oneofs: true
  },
  
  // 기본 인덱스 설정
  defaultIndex: {
    indexID: 'default_001',
    colName: 'IndexableData'
  },
  
  // 연결 타임아웃 (밀리초)
  connectionTimeout: process.env.CONNECTION_TIMEOUT || 5000,
  
  // 재시도 설정
  retry: {
    maxAttempts: process.env.MAX_RETRY_ATTEMPTS || 3,
    delay: process.env.RETRY_DELAY || 1000
  },
  
  // 로깅 설정
  logging: {
    enabled: process.env.LOGGING_ENABLED !== 'false',
    level: process.env.LOG_LEVEL || 'info'
  }
};
