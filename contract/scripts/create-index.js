const path = require('path');
const INDEXING_CLIENT_PATH = path.resolve(__dirname, '../../../bi-indexing-gateway/lib/indexing-client');
const IndexingClient = require(INDEXING_CLIENT_PATH);

// 설정
const PROTO_PATH = path.join(__dirname, '../../idxmngr-go/protos/index_manager.proto');
const NETWORK = 'hardhat-local';

/**
 * 인덱스 생성
 */
async function createPurposeIndex() {
  try {
    console.log('🔧 Purpose 인덱스 생성 중...');
    
    const indexingClient = new IndexingClient({
      serverAddr: 'localhost:50052',
      protoPath: PROTO_PATH
    });
    
    await indexingClient.connect();
    
    const indexID = 'purpose';
    const filePath = `data/${NETWORK}/purpose.bf`;
    
    const createRequest = {
      IndexID: indexID,
      IndexName: indexID,
      KeyCol: 'IndexableData',
      FilePath: filePath,
      KeySize: 64,
      Network: NETWORK
    };
    
    console.log(`🔧 인덱스 생성 요청:`, JSON.stringify(createRequest, null, 2));
    
    const response = await indexingClient.createIndex(createRequest);
    console.log(`✅ Purpose 인덱스 생성 성공!`);
    console.log(`📁 인덱스 파일: ${filePath}`);
    
    await indexingClient.close();
    
    return true;
    
  } catch (error) {
    console.error('❌ 인덱스 생성 실패:', error.message);
    throw error;
  }
}

/**
 * 메인 함수
 */
async function main() {
  console.log('🏥 Purpose 인덱스 생성 스크립트\n');
  
  try {
    await createPurposeIndex();
    console.log('\n✅ 완료!');
  } catch (error) {
    console.error('\n❌ 실패:', error.message);
    process.exit(1);
  }
}

main();


