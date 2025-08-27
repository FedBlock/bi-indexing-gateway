const IndexingClient = require('../../indexing-client-package/lib/indexing-client');

/**
 * Samsung 인덱스 데이터 검증 스크립트
 * 
 * 이 스크립트는 삼성전자 관련 블록체인 데이터가 인덱스에 제대로 저장되었는지 확인합니다.
 * 
 * 주요 기능:
 * 1. 삼성 인덱스 정보 확인
 * 2. 삼성전자로 데이터 검색 (fexactorg 방식)
 * 
 * 사용법:
 * cd contract
 * node scripts/verify-indexed-data.js
 * 
 * @author AI Assistant
 * @version 2.0.0 (IndexingClient 패키지 사용)
 */

/**
 * Samsung 데이터 검색 클래스
 * IndexingClient를 사용하여 삼성전자 관련 인덱스 데이터를 검색합니다.
 */
class SamsungDataSearcher {
  /**
   * @param {string} serverAddr - gRPC 서버 주소 (기본값: localhost:50052)
   */
  constructor(serverAddr = 'localhost:50052') {
    this.indexingClient = new IndexingClient({
      serverAddr: serverAddr,
      protoPath: '../idxmngr-go/protos/index_manager.proto' // 로컬 테스트용
    });
  }

  /**
   * 삼성전자 데이터 정확한 검색 (fexactorg 방식)
   * IndexableData 컬럼에서 "삼성전자" 값으로 검색하여 관련된 모든 TxId를 반환합니다.
   * 
   * @returns {Promise<Object>} 검색 결과 (IdxData 배열 포함)
   * @throws {Error} 검색 실패 시 에러 발생
   */
  async searchSamsungExact() {
    console.log('\n🔍 Testing fexactorg for Samsung (삼성전자 정확한 검색)...');
    
    try {
      const searchRequest = {
        IndexID: 'samsung_001',
        Field: 'IndexableData',
        Value: '삼성전자',
        ComOp: 'Eq' // ComparisonOps.Eq
      };

      console.log('📤 Search request:');
      console.log(JSON.stringify(searchRequest, null, 2));

      const response = await this.indexingClient.searchData(searchRequest);
      
      console.log(`✅ Samsung fexactorg search successful:`);
      console.log(`📊 검색 결과 TxId 개수: ${response.IdxData ? response.IdxData.length : 0}`);
      
      if (response.IdxData && response.IdxData.length > 0) {
        console.log('📋 검색된 TxId 목록:');
        response.IdxData.forEach((txId, index) => {
          console.log(`  [${index + 1}] ${txId}`);
        });
      } else {
        console.log('📭 검색 결과가 없습니다.');
      }
      
      return response;

    } catch (error) {
      console.error(`❌ Samsung fexactorg test failed: ${error.message}`);
      throw error;
    }
  }

  /**
   * 삼성 인덱스 정보 확인
   * samsung_001 인덱스의 상태와 설정 정보를 조회합니다.
   * 
   * @returns {Promise<Object>} 인덱스 정보 (ResponseCode, ResponseMessage 등)
   * @throws {Error} 정보 조회 실패 시 에러 발생
   */
  async checkSamsungIndexInfo() {
    console.log('\n🔍 Checking Samsung index info...');
    
    try {
      const request = { 
        IndexID: 'samsung_001',
        KeyCol: 'IndexableData'
      };

      const response = await this.indexingClient.getIndexInfo(request);
      
      console.log(`✅ Samsung Index info retrieved:`);
      console.log(`   Response Code: ${response.ResponseCode}`);
      console.log(`   Response Message: ${response.ResponseMessage}`);
      
      return response;

    } catch (error) {
      console.error(`❌ Samsung Index info check failed: ${error.message}`);
      throw error;
    }
  }

  /**
   * IndexingClient 연결 종료
   */
  close() {
    if (this.indexingClient) {
      this.indexingClient.close();
      console.log('🔌 Connection closed');
    }
  }
}

/**
 * 메인 실행 함수
 * 삼성 인덱스 데이터 검증을 순차적으로 실행합니다.
 */
async function main() {
  console.log("🔍 Samsung 인덱스 데이터 검증 시작...");
  console.log("📋 이 스크립트는 삼성전자 관련 블록체인 데이터가 인덱스에 제대로 저장되었는지 확인합니다.");
  console.log("🆕 IndexingClient 패키지 사용 버전");
  
  const searcher = new SamsungDataSearcher();
  
  try {
    // 연결 완료 대기
    await new Promise(resolve => setTimeout(resolve, 1000));
    
    console.log(`\n📋 검증할 데이터:`);
    console.log(`   Organization: 삼성전자`);
    console.log(`   IndexID: samsung_001`);
    console.log(`   Search Method: fexactorg (IndexableData 컬럼에서 "삼성전자" 값으로 검색)`);
    
    // 1. 삼성 인덱스 정보 확인
    console.log(`\n${'='.repeat(60)}`);
    console.log(`1️⃣ 삼성 인덱스 정보 확인`);
    console.log(`${'='.repeat(60)}`);
    await searcher.checkSamsungIndexInfo();
    
    // 2. 삼성전자 정확한 검색 (fexactorg)
    console.log(`\n${'='.repeat(60)}`);
    console.log(`2️⃣ 삼성전자 정확한 검색 (fexactorg)`);
    console.log(`${'='.repeat(60)}`);
    const searchResult = await searcher.searchSamsungExact();
    
    // 3. 검색 결과 요약
    console.log(`\n${'='.repeat(60)}`);
    console.log(`3️⃣ 검색 결과 요약`);
    console.log(`${'='.repeat(60)}`);
    if (searchResult.IdxData && searchResult.IdxData.length > 0) {
      console.log(`✅ 성공: ${searchResult.IdxData.length}개의 트랜잭션이 인덱스에 저장되어 있습니다.`);
      console.log(`📊 첫 번째 TxId: ${searchResult.IdxData[0]}`);
      console.log(`🎯 검색 방식: IndexableData 컬럼에서 "삼성전자" 값으로 검색`);
      console.log(`🆕 IndexingClient 패키지 사용으로 코드가 간소화되었습니다!`);
    } else {
      console.log(`❌ 실패: 인덱스에 삼성전자 관련 데이터가 없습니다.`);
    }
    
    console.log('\n🎉 Samsung 인덱스 데이터 검증 완료!');
    
  } catch (error) {
    console.error('\n💥 Samsung 인덱스 데이터 검증 실패:', error.message);
  } finally {
    searcher.close();
  }
}

// 스크립트가 직접 실행될 때만 main 함수 실행
if (require.main === module) {
  main();
}

module.exports = SamsungDataSearcher;
