const IdxmngrClient = require('./idxmngr-client');

// 테스트 함수들
async function testBasicOperations() {
  console.log('🚀 Starting basic operations test...\n');
  
  const client = new IdxmngrClient();
  
  try {
    // 연결 대기
    await new Promise(resolve => setTimeout(resolve, 1000));
    
    // 1. 인덱스 리스트 조회
    console.log('📋 Test 1: Get Index List');
    const indexList = await client.getIndexList();
    console.log(`Found ${indexList?.IndexCnt || 0} indexes\n`);
    
    // 2. 특정 인덱스 정보 조회
    console.log('🔍 Test 2: Get Index Info');
    const indexInfo = await client.getIndexInfo('org_samsung');
    console.log(`Index status: ${indexInfo?.ResponseMessage || 'Unknown'}\n`);
    
  } catch (error) {
    console.error('❌ Test failed:', error.message);
  } finally {
    client.close();
  }
}

async function testContractIndexing() {
  console.log('🚀 Starting contract indexing test...\n');
  
  const client = new IdxmngrClient();
  
  try {
    // 연결 대기
    await new Promise(resolve => setTimeout(resolve, 1000));
    
    // 스마트 컨트랙트 트랜잭션 인덱싱
    console.log('📝 Test: Insert Contract Transaction');
    const txHash = '0x' + Math.random().toString(16).substr(2, 64);
    console.log(`Using transaction hash: ${txHash}`);
    
    await client.insertData('org_samsung', txHash, '삼성전자');
    console.log('✅ Contract transaction indexed successfully\n');
    
    // 인덱싱된 데이터 검색
    console.log('🔍 Test: Search Indexed Data');
    await client.searchData('org_samsung', 'IndexableData_OrganizationName', '삼성전자');
    
  } catch (error) {
    console.error('❌ Test failed:', error.message);
  } finally {
    client.close();
  }
}

// 메인 테스트 실행
async function runTests() {
  console.log('🧪 Idxmngr gRPC Client Tests\n');
  console.log('=' .repeat(50));
  
  await testBasicOperations();
  
  console.log('=' .repeat(50));
  
  await testContractIndexing();
  
  console.log('\n🎉 All tests completed!');
}

// 스크립트 실행
if (require.main === module) {
  runTests().catch(console.error);
}
