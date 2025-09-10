const IndexingClient = require('../lib/indexing-client');

/**
 * IndexingClient 기본 사용법 예제
 */
async function main() {
  console.log('🚀 IndexingClient 기본 사용법 예제 시작...');
  
  // 1. 기본 설정으로 클라이언트 생성
  const client = new IndexingClient();
  
  try {
    // 연결 완료 대기
    await new Promise(resolve => setTimeout(resolve, 1000));
    
    // 2. 인덱스 정보 조회
    console.log('\n📊 인덱스 정보 조회...');
    const indexInfo = await client.getIndexInfo({
      IndexID: 'samsung_001',
      KeyCol: 'IndexableData'
    });
    console.log('✅ 인덱스 정보:', indexInfo);
    
    // 3. 삼성전자 데이터 검색
    console.log('\n🔍 삼성전자 데이터 검색...');
    const searchResult = await client.searchData({
      IndexID: 'samsung_001',
      Field: 'IndexableData',
      Value: '삼성전자',
      ComOp: 'Eq'
    });
    console.log('✅ 검색 결과:', searchResult);
    
    // 4. 새 데이터 삽입 예제
    console.log('\n📝 새 데이터 삽입 예제...');
    const newData = {
      IndexID: 'test_001',
      BcList: [{
        TxId: 'test_tx_001',
        key_col: 'IndexableData',
        IndexableData: {
          TxId: 'test_tx_001',
          OrganizationName: '테스트기업',
          ContractAddress: '0x0000000000000000000000000000000000000000',
          EventName: 'TestEvent',
          DataJson: JSON.stringify({ test: 'data' }),
          Timestamp: new Date().toISOString(),
          BlockNumber: 999,
          Requester: 'test_user',
          ResourceOwner: 'test_owner',
          Purpose: 'Testing',
          Status: 'PENDING'
        }
      }],
      ColName: 'IndexableData',
      FilePath: '/tmp/test.bf'
    };
    
    const insertResult = await client.insertData(newData);
    console.log('✅ 삽입 결과:', insertResult);
    
    console.log('\n🎉 기본 사용법 예제 완료!');
    
  } catch (error) {
    console.error('\n💥 예제 실행 실패:', error.message);
  } finally {
    // 연결 종료
    client.close();
  }
}

// 스크립트가 직접 실행될 때만 main 함수 실행
if (require.main === module) {
  main();
}

module.exports = main;
