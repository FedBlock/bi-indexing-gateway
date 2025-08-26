const IdxmngrClient = require('./idxmngr-client');

async function insertDataTest() {
  console.log('🧪 Insert Data Test\n');
  
  const client = new IdxmngrClient();
  
  try {
    // 연결 대기
    await new Promise(resolve => setTimeout(resolve, 1000));
    
    // 1. 현재 데이터 검색 (비어있을 것)
    console.log('🔍 Current data search (should be empty):');
    const beforeSearch = await client.searchData('org_samsung', 'IndexableData_OrganizationName', '삼성전자');
    console.log(`Found ${beforeSearch?.IdxData?.length || 0} records before insertion\n`);
    
    // 2. 데이터 삽입
    console.log('📝 Inserting contract transaction data...');
    const txHash = '0x' + Math.random().toString(16).substr(2, 64);
    console.log(`Using transaction hash: ${txHash}`);
    
    const insertResult = await client.insertData('org_samsung', txHash, '삼성전자');
    console.log(`✅ Insert Result: ${JSON.stringify(insertResult)}\n`);
    
    // 3. 삽입 후 데이터 검색
    console.log('🔍 Searching for inserted data:');
    const afterSearch = await client.searchData('org_samsung', 'IndexableData_OrganizationName', '삼성전자');
    console.log(`Found ${afterSearch?.IdxData?.length || 0} records after insertion\n`);
    
    // 4. 추가 데이터 삽입 (여러 개)
    console.log('📝 Inserting multiple transactions...');
    const txHashes = [
      '0x' + Math.random().toString(16).substr(2, 64),
      '0x' + Math.random().toString(16).substr(2, 64),
      '0x' + Math.random().toString(16).substr(2, 64)
    ];
    
    for (let i = 0; i < txHashes.length; i++) {
      console.log(`Inserting transaction ${i + 1}: ${txHashes[i]}`);
      await client.insertData('org_samsung', txHashes[i], '삼성전자');
    }
    console.log('✅ Multiple insertions completed\n');
    
    // 5. 최종 검색
    console.log('🔍 Final search for all data:');
    const finalSearch = await client.searchData('org_samsung', 'IndexableData_OrganizationName', '삼성전자');
    console.log(`Found ${finalSearch?.IdxData?.length || 0} total records\n`);
    
  } catch (error) {
    console.error('❌ Test failed:', error.message);
  } finally {
    client.close();
  }
}

// 실행
insertDataTest().catch(console.error);
