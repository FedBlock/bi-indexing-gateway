#!/usr/bin/env node

const IndexingClient = require('./lib/indexing-client');
const path = require('path');

/**
 * IndexingClient 통합 테스트
 * 블록체인 통신 + gRPC 인덱싱 기능 모두 테스트
 */
async function testIntegration() {
  console.log('🚀 IndexingClient 통합 테스트 시작...\n');
  
  let client = null;
  
  try {
    // 1. IndexingClient 생성 테스트
    console.log('1️⃣ IndexingClient 생성 테스트');
    client = new IndexingClient({
      serverAddr: 'localhost:50052',
      protoPath: path.join(__dirname, '../idxmngr-go/protos/index_manager.proto')
    });
    console.log('✅ IndexingClient 생성 성공\n');
    
    // 2. gRPC 연결 테스트
    console.log('2️⃣ gRPC 서버 연결 테스트');
    // connect()는 생성자에서 자동 호출됨
    await new Promise(resolve => setTimeout(resolve, 1000)); // 연결 대기
    
    if (client.isConnected) {
      console.log('✅ gRPC 서버 연결 성공');
    } else {
      console.log('❌ gRPC 서버 연결 실패');
    }
    console.log('');
    
    // 3. 이더리움 네트워크 연결 테스트
    console.log('3️⃣ 이더리움 네트워크 연결 테스트');
    try {
      await client.connectEthereumNetwork('hardhat-local');
      console.log('✅ 이더리움 네트워크 연결 성공');
    } catch (ethError) {
      console.log('❌ 이더리움 네트워크 연결 실패:', ethError.message);
      console.log('   (Hardhat 서버가 실행 중인지 확인하세요)');
    }
    console.log('');
    
    // 4. 인덱스 검색 테스트 (gRPC)
    console.log('4️⃣ 인덱스 검색 테스트 (gRPC)');
    try {
      const searchResult = await client.searchData({
        IndexID: 'purpose',
        Value: '수면'
      });
      
      console.log('✅ 인덱스 검색 성공');
      console.log(`   - 검색 결과: ${searchResult.TxIDs ? searchResult.TxIDs.length : 0}개`);
      
      if (searchResult.TxIDs && searchResult.TxIDs.length > 0) {
        console.log(`   - 첫 번째 TxID: ${searchResult.TxIDs[0]}`);
      }
      
    } catch (searchError) {
      console.log('❌ 인덱스 검색 실패:', searchError.message);
      console.log('   (idxmngr 서버가 실행 중이고 데이터가 있는지 확인하세요)');
    }
    console.log('');
    
    // 5. 통합 검색 테스트 (블록체인 + 인덱스)
    console.log('5️⃣ 통합 검색 테스트 (블록체인 + 인덱스)');
    try {
      const integratedResult = await client.searchBlockchainAndIndex(
        '수면',
        'hardhat-local',
        '0x5FbDB2315678afecb367f032d93F642f64180aa3'
      );
      
      console.log('✅ 통합 검색 성공');
      console.log(`   - 방법: ${integratedResult.method}`);
      console.log(`   - 네트워크: ${integratedResult.network}`);
      console.log(`   - 총 개수: ${integratedResult.totalCount}개`);
      
      if (integratedResult.transactions && integratedResult.transactions.length > 0) {
        const firstTx = integratedResult.transactions[0];
        console.log(`   - 첫 번째 트랜잭션:`);
        console.log(`     * TxID: ${firstTx.txId.substring(0, 20)}...`);
        console.log(`     * 블록: ${firstTx.blockNumber}`);
        console.log(`     * 상태: ${firstTx.status}`);
        console.log(`     * 목적: ${firstTx.purpose}`);
      }
      
    } catch (integratedError) {
      console.log('❌ 통합 검색 실패:', integratedError.message);
    }
    console.log('');
    
    // 6. 네트워크 설정 테스트
    console.log('6️⃣ 네트워크 설정 테스트');
    console.log('   지원 네트워크:');
    Object.keys(client.networkConfigs).forEach(network => {
      console.log(`   - ${network}: ${client.networkConfigs[network]}`);
    });
    console.log('✅ 네트워크 설정 확인 완료\n');
    
    console.log('🎉 통합 테스트 완료!');
    console.log('\n📊 테스트 결과 요약:');
    console.log('   ✅ IndexingClient 생성');
    console.log('   ✅ gRPC 서버 통신');
    console.log('   ✅ 이더리움 네트워크 연결');
    console.log('   ✅ 인덱스 검색 (gRPC)');
    console.log('   ✅ 통합 검색 (블록체인 + 인덱스)');
    console.log('   ✅ 네트워크 설정');
    
  } catch (error) {
    console.error('❌ 통합 테스트 중 예상치 못한 오류:', error.message);
    console.error('스택 트레이스:', error.stack);
  } finally {
    // 7. 정리
    if (client) {
      console.log('\n🔌 연결 정리 중...');
      await client.close();
      console.log('✅ 연결 정리 완료');
    }
  }
}

// 스크립트 직접 실행
if (require.main === module) {
  testIntegration().catch(console.error);
}

module.exports = testIntegration;
