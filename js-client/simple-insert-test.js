const IdxmngrClient = require('./idxmngr-client');

async function simpleInsertTest() {
  console.log('🧪 Simple Insert Test\n');
  
  const client = new IdxmngrClient();
  
  try {
    // 연결 대기
    await new Promise(resolve => setTimeout(resolve, 1000));
    
    // 1. 현재 데이터 확인
    console.log('🔍 Current data:');
    const currentData = await client.searchData('org_samsung', 'IndexableData_OrganizationName', '삼성전자');
    console.log(`Found ${currentData?.IdxData?.length || 0} records\n`);
    
    // 2. 간단한 데이터 삽입 시도
    console.log('📝 Trying simple insert...');
    
    // Go 코드와 정확히 동일한 구조
    const testData = {
      IndexID: 'org_samsung',
      BcList: [{
        TxId: 'test_js_tx_1',
        IndexableData: {
          TxId: 'test_js_tx_1',
          OrganizationName: '삼성전자'
        }
      }],
      ColName: 'IndexableData_OrganizationName',
      FilePath: 'fileindex-go/samsung.bf'
    };
    
    console.log('Test data structure:', JSON.stringify(testData, null, 2));
    
    // 스트리밍 시도
    const stream = client.client.InsertIndexRequest();
    
    stream.on('data', (response) => {
      console.log(`✅ Response received: ${JSON.stringify(response)}`);
    });
    
    stream.on('error', (error) => {
      console.error(`❌ Stream error: ${error.message}`);
    });
    
    stream.on('end', () => {
      console.log('Stream ended');
    });
    
    // 데이터 전송
    try {
      stream.write(testData);
      stream.end();
      console.log('✅ Data sent to stream');
    } catch (error) {
      console.error(`❌ Failed to write: ${error.message}`);
    }
    
    // 잠시 대기
    await new Promise(resolve => setTimeout(resolve, 2000));
    
  } catch (error) {
    console.error('❌ Test failed:', error.message);
  } finally {
    client.close();
  }
}

// 실행
simpleInsertTest().catch(console.error);
