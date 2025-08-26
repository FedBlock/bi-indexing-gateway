const IdxmngrClient = require('./idxmngr-client');

async function createIndexTest() {
  console.log('🧪 Create Index Test\n');
  
  const client = new IdxmngrClient();
  
  try {
    // 연결 대기
    await new Promise(resolve => setTimeout(resolve, 1000));
    
    // 1. 현재 인덱스 리스트 확인
    console.log('📋 Current Index List:');
    const currentList = await client.getIndexList();
    console.log(`Found ${currentList?.IndexCnt || 0} indexes\n`);
    
    // 2. 새로운 인덱스 생성
    console.log('🔨 Creating new index...');
    const newIndexResult = await client.createIndex(
      'test_org_hyundai',                    // IndexID
      'Test_Organization_Hyundai',           // IndexName
      'IndexableData_OrganizationName',      // KeyCol
      'hyundai.bf',                          // FilePath
      32                                     // KeySize
    );
    console.log(`✅ Create Index Result: ${JSON.stringify(newIndexResult)}\n`);
    
    // 3. 생성된 인덱스 확인
    console.log('🔍 Checking created index...');
    const indexInfo = await client.getIndexInfo('test_org_hyundai');
    console.log(`✅ Index Info: ${JSON.stringify(indexInfo)}\n`);
    
    // 4. 업데이트된 인덱스 리스트 확인
    console.log('📋 Updated Index List:');
    const updatedList = await client.getIndexList();
    console.log(`Found ${updatedList?.IndexCnt || 0} indexes\n`);
    
  } catch (error) {
    console.error('❌ Test failed:', error.message);
  } finally {
    client.close();
  }
}

// 실행
createIndexTest().catch(console.error);
