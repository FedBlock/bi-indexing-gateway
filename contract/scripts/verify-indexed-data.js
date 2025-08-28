const IndexingClient = require('../../indexing-client-package/lib/indexing-client');

/**
 * Samsung 인덱스 데이터 검증 스크립트
 * 삼성전자 관련 블록체인 데이터가 인덱스에 제대로 저장되었는지 확인
 */

class SamsungDataSearcher {
  constructor(serverAddr = 'localhost:50052') {
    this.indexingClient = new IndexingClient({
      serverAddr: serverAddr,
      protoPath: '../idxmngr-go/protos/index_manager.proto'
    });
  }

  /**
   * 삼성전자 데이터 정확한 검색 (Hardhat 인덱스용)
   */
  async searchSamsungExact() {
    console.log('\n🔍 삼성전자 정확한 검색 (Hardhat 인덱스)...');
    
    const searchRequest = {
      IndexID: 'hardhat_a513E6E4_speed',
      Field: 'IndexableData',  // IndexableData로 검색
      Value: 'samsung',
      ComOp: 'Eq'
    };

    console.log('📤 검색 요청:', JSON.stringify(searchRequest, null, 2));

    const response = await this.indexingClient.searchData(searchRequest);
    
    console.log(`✅ 검색 성공: ${response.IdxData ? response.IdxData.length : 0}개 결과`);
    
    if (response.IdxData && response.IdxData.length > 0) {
      console.log('📋 검색된 TxId 목록:');
      response.IdxData.forEach((txId, index) => {
        console.log(`  [${index + 1}] ${txId}`);
      });
    } else {
      console.log('📭 검색 결과가 없습니다.');
    }
    
    return response;
  }

  /**
   * 삼성전자 데이터 범위 검색 (Hardhat 인덱스용)
   */
  async searchSamsungRange() {
    console.log('\n🔍 삼성전자 범위 검색 (Hardhat 인덱스)...');
    
    const searchRequest = {
      IndexID: 'hardhat_a513E6E4_speed',
      Field: 'IndexableData',
      Begin: 's',         // "s"로 시작하는 모든 데이터
      End: 't',           // "t"까지의 범위 (samsung 포함)
      ComOp: 'Range'
    };

    console.log('📤 범위 검색 요청:', JSON.stringify(searchRequest, null, 2));

    const response = await this.indexingClient.searchData(searchRequest);
    
    console.log(`✅ 범위 검색 성공: ${response.IdxData ? response.IdxData.length : 0}개 결과`);
    
    if (response.IdxData && response.IdxData.length > 0) {
      console.log('📋 범위 검색된 TxId 목록:');
      response.IdxData.forEach((txId, index) => {
        console.log(`  [${index + 1}] ${txId}`);
      });
    } else {
      console.log('📭 범위 검색 결과가 없습니다.');
    }
    
    return response;
  }


  /**
   * Hardhat 삼성 인덱스 정보 확인
   */
  async checkSamsungIndexInfo() {
    console.log('\n🔍 Hardhat 삼성 인덱스 정보 확인...');
    
    const request = { 
      IndexID: 'hardhat_a513E6E4_speed',
      KeyCol: 'IndexableData'
    };

    const response = await this.indexingClient.getIndexInfo(request);
    
    console.log(`✅ 인덱스 정보: ${response.ResponseCode} - ${response.ResponseMessage}`);
    
    return response;
  }

  close() {
    if (this.indexingClient) {
      this.indexingClient.close();
      console.log('🔌 연결 종료');
    }
  }
}

/**
 * 메인 실행 함수
 */
async function main() {
  console.log("🔍 Samsung 인덱스 데이터 검증 시작...");
  
  const searcher = new SamsungDataSearcher();
  
  try {
    await new Promise(resolve => setTimeout(resolve, 1000));
    
    console.log(`\n📋 검증할 데이터:`);
    console.log(`   Organization: samsung`);
    console.log(`   IndexID: hardhat_a513E6E4_speed`);
    
    // 1. 삼성 인덱스 정보 확인
    console.log(`\n${'='.repeat(50)}`);
    console.log(`1️⃣ 삼성 인덱스 정보 확인`);
    console.log(`${'='.repeat(50)}`);
    await searcher.checkSamsungIndexInfo();
    
    // 2. 삼성전자 정확한 검색
    console.log(`\n${'='.repeat(50)}`);
    console.log(`2️⃣ 삼성전자 정확한 검색`);
    console.log(`${'='.repeat(50)}`);
    const searchResult = await searcher.searchSamsungExact();
    
    // 3. 삼성전자 범위 검색
    console.log(`\n${'='.repeat(50)}`);
    console.log(`3️⃣ 삼성전자 범위 검색`);
    console.log(`${'='.repeat(50)}`);
    const rangeResult = await searcher.searchSamsungRange();

    
    // 6. 검색 결과 요약
    console.log(`\n${'='.repeat(50)}`);
    console.log(`6️⃣ 검색 결과 요약`);
    console.log(`${'='.repeat(50)}`);
    
    // Samsung 정확한 검색 결과
    if (searchResult.IdxData && searchResult.IdxData.length > 0) {
      console.log(`✅ Samsung 정확한 검색: ${searchResult.IdxData.length}개 결과`);
    } else {
      console.log(`❌ Samsung 정확한 검색: 결과 없음`);
    }
    
    // Samsung 범위 검색 결과
    if (rangeResult.IdxData && rangeResult.IdxData.length > 0) {
      console.log(`✅ Samsung 범위 검색: ${rangeResult.IdxData.length}개 결과`);
    } else {
      console.log(`❌ Samsung 범위 검색: 결과 없음`);
    }
    


    
    console.log('\n🎉 Samsung 인덱스 데이터 검증 완료!');
    
  } catch (error) {
    console.error('\n💥 Samsung 인덱스 데이터 검증 실패:', error.message);
  } finally {
    searcher.close();
  }
}

if (require.main === module) {
  main();
}

module.exports = SamsungDataSearcher;
