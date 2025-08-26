const IdxmngrClient = require('./idxmngr-client');

async function singleInsertTest() {
  console.log('🧪 Single Data Insert Test\n');
  
  const client = new IdxmngrClient();
  
  try {
    // 연결 대기
    await new Promise(resolve => setTimeout(resolve, 1000));
    
    // 1. 현재 데이터 확인
    console.log('🔍 Current data count:');
    const currentData = await client.searchData('org_samsung', 'IndexableData_OrganizationName', '삼성전자');
    console.log(`Found ${currentData?.IdxData?.length || 0} records\n`);
    
    // 2. 단일 데이터 삽입
    console.log('📝 Inserting single transaction...');
    const singleTxId = '0x' + Math.random().toString(16).substr(2, 64);
    console.log(`Using transaction hash: ${singleTxId}`);
    
    const insertResult = await client.insertData('org_samsung', singleTxId, '삼성전자');
    console.log(`✅ Single insert result: ${JSON.stringify(insertResult)}\n`);
    
    // 3. 삽입 후 데이터 확인
    console.log('🔍 Data after insertion:');
    const afterData = await client.searchData('org_samsung', 'IndexableData_OrganizationName', '삼성전자');
    console.log(`Found ${afterData?.IdxData?.length || 0} records`);
    
    // 4. 새로 추가된 데이터 확인
    const newDataCount = afterData?.IdxData?.length - currentData?.IdxData?.length;
    console.log(`📊 Newly added: ${newDataCount} record(s)`);
    
    if (newDataCount > 0) {
      console.log('✅ Single data insertion successful!');
    } else {
      console.log('❌ No new data found');
    }
    
  } catch (error) {
    console.error('❌ Test failed:', error.message);
  } finally {
    client.close();
  }
}

// 실행
singleInsertTest().catch(console.error);
