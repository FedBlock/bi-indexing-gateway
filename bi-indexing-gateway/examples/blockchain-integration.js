const IndexingClient = require('../lib/indexing-client');

/**
 * IndexingClient 블록체인 통합 기능 예제
 * 이더리움 네트워크와 인덱싱 서버를 모두 사용하는 통합 예제
 */
async function main() {
  console.log('🚀 IndexingClient 블록체인 통합 기능 예제 시작...');
  
  try {
    // 1. IndexingClient 생성
    const client = new IndexingClient({
      serverAddr: 'localhost:50052',
      protoPath: require('path').join(__dirname, '../../idxmngr-go/protos/index_manager.proto')
    });
    
    console.log('✅ IndexingClient 생성 완료');
    
    // 2. 이더리움 네트워크 연결
    await client.connectEthereumNetwork('hardhat-local');
    
    // 3. 통합 검색 예제: 인덱스 + 블록체인
    console.log('\n📊 통합 검색 예제 실행 중...');
    const searchResult = await client.searchBlockchainAndIndex(
      '수면',  // 검색할 목적
      'hardhat-local',  // 네트워크
      '0x5FbDB2315678afecb367f032d93F642f64180aa3'  // 컨트랙트 주소
    );
    
    console.log('\n🎯 검색 결과:');
    console.log(`- 방법: ${searchResult.method}`);
    console.log(`- 네트워크: ${searchResult.network}`);
    console.log(`- 목적: ${searchResult.purpose}`);
    console.log(`- 총 개수: ${searchResult.totalCount}개`);
    
    if (searchResult.transactions && searchResult.transactions.length > 0) {
      console.log('\n📋 트랜잭션 목록:');
      searchResult.transactions.slice(0, 3).forEach((tx, index) => {
        console.log(`  ${index + 1}. TxID: ${tx.txId.substring(0, 10)}...`);
        console.log(`     블록: ${tx.blockNumber}, 상태: ${tx.status}`);
        console.log(`     요청자: ${tx.requester}`);
        console.log(`     목적: ${tx.purpose}`);
        console.log('');
      });
      
      if (searchResult.transactions.length > 3) {
        console.log(`     ... 외 ${searchResult.transactions.length - 3}개 더`);
      }
    }
    
    // 4. 개별 트랜잭션 조회 예제
    if (searchResult.transactions && searchResult.transactions.length > 0) {
      const firstTx = searchResult.transactions[0];
      console.log('\n🔍 개별 트랜잭션 상세 조회 예제:');
      
      const txDetails = await client.getTransactionDetails(firstTx.txId);
      console.log(`- 트랜잭션 해시: ${txDetails.tx.hash}`);
      console.log(`- 블록 번호: ${txDetails.tx.blockNumber}`);
      console.log(`- 가스 사용량: ${txDetails.receipt.gasUsed.toString()}`);
      console.log(`- 상태: ${txDetails.receipt.status === 1 ? 'SUCCESS' : 'FAILED'}`);
      console.log(`- 타임스탬프: ${new Date(txDetails.block.timestamp * 1000).toISOString()}`);
    }
    
    // 5. 컨트랙트 이벤트 조회 예제
    console.log('\n📡 컨트랙트 이벤트 조회 예제:');
    const events = await client.queryContractEvents(
      '0x5FbDB2315678afecb367f032d93F642f64180aa3',
      require('path').join(__dirname, '../../contract/artifacts/contracts/AccessManagement.sol/AccessManagement.json'),
      'AccessRequestsSaved',
      0,
      'latest'
    );
    
    console.log(`✅ 총 ${events.length}개의 AccessRequestsSaved 이벤트 발견`);
    
    // 6. 연결 종료
    await client.close();
    console.log('\n✅ IndexingClient 블록체인 통합 기능 예제 완료!');
    
  } catch (error) {
    console.error('❌ 예제 실행 중 오류:', error.message);
    console.error('스택 트레이스:', error.stack);
  }
}

// 스크립트 직접 실행시
if (require.main === module) {
  main().catch(console.error);
}

module.exports = main;
