const IndexingClient = require('../../indexing-client-package/lib/indexing-client');

/**
 * Samsung 인덱스 데이터 검증 스크립트
 * 삼성전자 관련 블록체인 데이터가 인덱스에 제대로 저장되었는지 확인
 */

class SamsungDataSearcher {
  constructor(serverAddr = 'localhost:50052') {
    this.indexingClient = new IndexingClient({
      serverAddr: serverAddr,
      protoPath: '../../idxmngr-go/protos/index_manager.proto'
    });
  }

  /**
   * 삼성전자 데이터 정확한 검색 (fexactorg 방식)
   */
  async searchSamsungExact() {
    console.log('\n🔍 삼성전자 정확한 검색 (fexactorg)...');
    
    const searchRequest = {
      IndexID: 'samsung_001',
      Field: 'IndexableData',  // 이제 IndexableData로 검색 가능
      Value: '삼성전자',
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
   * 삼성전자 데이터 범위 검색 (frangorg 방식)
   */
  async searchSamsungRange() {
    console.log('\n🔍 삼성전자 범위 검색 (frangorg)...');
    
    const searchRequest = {
      IndexID: 'samsung_001',
      Field: 'IndexableData',
      Begin: '삼성',      // "삼성"으로 시작하는 모든 데이터
      End: '삼성전자z',   // "삼성전자z"까지의 범위
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
   * Universal Organization 범위 검색 (franguniversalorg 방식)
   */
  async searchUniversalOrgRange() {
    console.log('\n🔍 Universal Organization 범위 검색 (franguniversalorg)...');
    
    const searchRequest = {
      IndexID: 'fileidx_universal_org',
      Field: 'IndexableData',
      Begin: 'Org_',      // "Org_"로 시작하는 모든 데이터
      End: 'Org_z',       // "Org_z"까지의 범위
      ComOp: 'Range'
    };

    console.log('📤 Universal Organization 범위 검색 요청:', JSON.stringify(searchRequest, null, 2));

    const response = await this.indexingClient.searchData(searchRequest);
    
    console.log(`✅ Universal Organization 범위 검색 성공: ${response.IdxData ? response.IdxData.length : 0}개 결과`);
    
    if (response.IdxData && response.IdxData.length > 0) {
      console.log('📋 범위 검색된 TxId 목록:');
      response.IdxData.forEach((txId, index) => {
        console.log(`  [${index + 1}] ${txId}`);
      });
    } else {
      console.log('📭 Universal Organization 범위 검색 결과가 없습니다.');
    }
    
    return response;
  }

  /**
   * PVD Speed 범위 검색 (franges 방식)
   */
  async searchPvdSpeedRange() {
    console.log('\n🔍 PVD Speed 범위 검색 (franges)...');
    
    const searchRequest = {
      IndexID: 'fileidx_sp',
      Field: 'Speed',
      Begin: '80',        // Speed 80부터
      End: '90',          // Speed 90까지
      ComOp: 'Range'
    };

    console.log('📤 PVD Speed 범위 검색 요청:', JSON.stringify(searchRequest, null, 2));

    const response = await this.indexingClient.searchData(searchRequest);
    
    console.log(`✅ PVD Speed 범위 검색 성공: ${response.IdxData ? response.IdxData.length : 0}개 결과`);
    
    if (response.IdxData && response.IdxData.length > 0) {
      console.log('📋 범위 검색된 TxId 목록:');
      response.IdxData.forEach((txId, index) => {
        console.log(`  [${index + 1}] ${txId}`);
      });
    } else {
      console.log('📭 PVD Speed 범위 검색 결과가 없습니다.');
    }
    
    return response;
  }

  /**
   * 삼성 인덱스 정보 확인
   */
  async checkSamsungIndexInfo() {
    console.log('\n🔍 삼성 인덱스 정보 확인...');
    
    const request = { 
      IndexID: 'samsung_001',
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
    console.log(`   Organization: 삼성전자`);
    console.log(`   IndexID: samsung_001`);
    
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
    
    // 4. Universal Organization 범위 검색
    console.log(`\n${'='.repeat(50)}`);
    console.log(`4️⃣ Universal Organization 범위 검색`);
    console.log(`${'='.repeat(50)}`);
    const universalOrgResult = await searcher.searchUniversalOrgRange();
    
    // 5. PVD Speed 범위 검색
    console.log(`\n${'='.repeat(50)}`);
    console.log(`5️⃣ PVD Speed 범위 검색`);
    console.log(`${'='.repeat(50)}`);
    const pvdSpeedResult = await searcher.searchPvdSpeedRange();
    
    // 6. 검색 결과 요약
    console.log(`\n${'='.repeat(50)}`);
    console.log(`6️⃣ 검색 결과 요약`);
    console.log(`${'='.repeat(50)}`);
    
    // 삼성전자 정확한 검색 결과
    if (searchResult.IdxData && searchResult.IdxData.length > 0) {
      console.log(`✅ 삼성전자 정확한 검색: ${searchResult.IdxData.length}개 결과`);
    } else {
      console.log(`❌ 삼성전자 정확한 검색: 결과 없음`);
    }
    
    // 삼성전자 범위 검색 결과
    if (rangeResult.IdxData && rangeResult.IdxData.length > 0) {
      console.log(`✅ 삼성전자 범위 검색: ${rangeResult.IdxData.length}개 결과`);
    } else {
      console.log(`❌ 삼성전자 범위 검색: 결과 없음`);
    }
    
    // Universal Organization 범위 검색 결과
    if (universalOrgResult.IdxData && universalOrgResult.IdxData.length > 0) {
      console.log(`✅ Universal Organization 범위 검색: ${universalOrgResult.IdxData.length}개 결과`);
    } else {
      console.log(`❌ Universal Organization 범위 검색: 결과 없음`);
    }
    
    // PVD Speed 범위 검색 결과
    if (pvdSpeedResult.IdxData && pvdSpeedResult.IdxData.length > 0) {
      console.log(`✅ PVD Speed 범위 검색: ${pvdSpeedResult.IdxData.length}개 결과`);
    } else {
      console.log(`❌ PVD Speed 범위 검색: 결과 없음`);
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
