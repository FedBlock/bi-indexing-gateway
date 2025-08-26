const IdxmngrClient = require('./idxmngr-client');

async function simpleTest() {
  console.log('🧪 Simple gRPC Test\n');
  
  const client = new IdxmngrClient();
  
  try {
    // 연결 대기
    await new Promise(resolve => setTimeout(resolve, 1000));
    
    // 1. 인덱스 리스트 조회 (단순 호출)
    console.log('📋 Test: Get Index List');
    const indexList = await client.getIndexList();
    console.log(`✅ Success: Found ${indexList?.IndexCnt || 0} indexes\n`);
    
    // 2. 특정 인덱스 정보 조회 (단순 호출)
    console.log('🔍 Test: Get Index Info');
    const indexInfo = await client.getIndexInfo('org_samsung');
    console.log(`✅ Success: ${indexInfo?.ResponseMessage || 'Unknown'}\n`);
    
    // 3. 데이터 검색 (단순 호출)
    console.log('🔍 Test: Search Data');
    const searchResults = await client.searchData('org_samsung', 'IndexableData_OrganizationName', '삼성전자');
    console.log(`✅ Success: Search completed\n`);
    
  } catch (error) {
    console.error('❌ Test failed:', error.message);
  } finally {
    client.close();
  }
}

// 실행
simpleTest().catch(console.error);
