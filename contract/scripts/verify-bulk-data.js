/**
 * 100개 대량 데이터 검증 스크립트 (Hardhat 환경)
 * 사용법: npx hardhat run verify-bulk-data.js --network [hardhat|monad|fabric]
 * 예시: npx hardhat run verify-bulk-data.js --network hardhat
 */

const path = require('path');
const IndexingClient = require('../../indexing-client-package/lib/indexing-client');

/**
 * 대량 데이터 검증기
 */
class BulkDataVerifier {
  constructor(serverAddr = 'localhost:50052') {
    this.indexingClient = new IndexingClient({
      serverAddr: serverAddr,
      protoPath: path.join(process.cwd(), '../idxmngr-go/protos/index_manager.proto')
    });
  }

  /**
   * 네트워크별 설정 정보 (새로 생성한 인덱스 ID 사용)
   */
  getNetworkConfig(network) {
    const configs = {
          hardhat: {
      IndexID: 'hardhat_1756621655134_samsung', // 새로 생성한 인덱스 ID
      IndexName: 'Hardhat Network - Samsung Index',
      KeyCol: 'IndexableData',
      FilePath: 'data/hardhat/samsung_1756621655134.bf',
      Network: 'hardhat'
    },
      monad: {
        IndexID: 'monad_1756621048516_samsung',
        IndexName: 'Monad Network - Samsung Index',
        KeyCol: 'IndexableData',
        FilePath: 'data/monad/samsung_1756621048516.bf',
        Network: 'monad'
      },
      fabric: {
        IndexID: 'fabric_1756621048516_samsung',
        IndexName: 'Fabric Network - Samsung Index',
        KeyCol: 'IndexableData',
        FilePath: 'data/fabric/samsung_1756621048516.bf',
        Network: 'fabric'
      }
    };
    
    return configs[network];
  }

  /**
   * 인덱스 정보 조회
   */
  async getIndexInfo(network) {
    const config = this.getNetworkConfig(network);
    console.log(`\n📋 ${network.toUpperCase()} 네트워크 - 인덱스 정보 조회...`);
    
    try {
      const response = await this.indexingClient.getIndexInfo({
        IndexID: config.IndexID,
        IndexName: config.IndexName,
        KeyCol: config.KeyCol,
        FilePath: config.FilePath,
        KeySize: 32
      });
      
      console.log(`✅ 인덱스 정보 조회 성공:`);
      console.log(`   IndexID: ${response.IndexID || config.IndexID}`);
      console.log(`   ResponseCode: ${response.ResponseCode}`);
      console.log(`   ResponseMessage: ${response.ResponseMessage}`);
      console.log(`   Duration: ${response.Duration}`);
      
      return response;
    } catch (error) {
      console.error(`❌ 인덱스 정보 조회 실패: ${error.message}`);
      throw error;
    }
  }

  /**
   * 전체 데이터 개수 확인
   */
  async countTotalData(network) {
    const config = this.getNetworkConfig(network);
    console.log(`\n🔢 ${network.toUpperCase()} 네트워크 - 전체 데이터 개수 확인...`);
    
    try {
      // 'samsung'으로 검색하여 전체 개수 확인
      const searchRequest = {
        IndexID: config.IndexID,
        Field: config.KeyCol,
        Value: 'samsung',
        ComOp: 'Eq'
      };

      console.log('📤 검색 요청:', JSON.stringify(searchRequest, null, 2));

      const response = await this.indexingClient.searchData(searchRequest);
      
      console.log(`✅ 전체 데이터 개수: ${response.IdxData ? response.IdxData.length : 0}개`);
      
      return response.IdxData ? response.IdxData.length : 0;
    } catch (error) {
      console.error(`❌ 데이터 개수 확인 실패: ${error.message}`);
      throw error;
    }
  }

  /**
   * 특정 데이터 검색 (예: samsung_001, samsung_050, samsung_100)
   */
  async searchSpecificData(network, organizationName) {
    const config = this.getNetworkConfig(network);
    console.log(`\n🔍 ${network.toUpperCase()} 네트워크 - 특정 데이터 검색: ${organizationName}`);
    
    try {
      const searchRequest = {
        IndexID: config.IndexID,
        Field: config.KeyCol,
        Value: organizationName,
        ComOp: 'Eq'
      };

      console.log('📤 검색 요청:', JSON.stringify(searchRequest, null, 2));

      const response = await this.indexingClient.searchData(searchRequest);
      
      console.log(`✅ 검색 성공: ${response.IdxData ? response.IdxData.length : 0}개 결과`);
      
      if (response.IdxData && response.IdxData.length > 0) {
        console.log('📋 검색된 데이터:');
        response.IdxData.forEach((data, index) => {
          console.log(`  [${index + 1}] ${JSON.stringify(data)}`);
        });
      } else {
        console.log('📭 검색 결과가 없습니다.');
      }
      
      return response;
    } catch (error) {
      console.error(`❌ 검색 실패: ${error.message}`);
      throw error;
    }
  }

  /**
   * 범위 검색 (예: samsung_001 ~ samsung_010)
   */
  async searchRangeData(network, begin, end) {
    const config = this.getNetworkConfig(network);
    console.log(`\n🔍 ${network.toUpperCase()} 네트워크 - 범위 검색: ${begin} ~ ${end}`);
    
    try {
      const searchRequest = {
        IndexID: config.IndexID,
        Field: config.KeyCol,
        Begin: begin,
        End: end,
        ComOp: 'Range'
      };

      console.log('📤 범위 검색 요청:', JSON.stringify(searchRequest, null, 2));

      const response = await this.indexingClient.searchData(searchRequest);
      
      console.log(`✅ 범위 검색 성공: ${response.IdxData ? response.IdxData.length : 0}개 결과`);
      
      if (response.IdxData && response.IdxData.length > 0) {
        console.log('📋 범위 검색된 데이터:');
        response.IdxData.forEach((data, index) => {
          console.log(`  [${index + 1}] ${JSON.stringify(data)}`);
        });
      } else {
        console.log('📭 범위 검색 결과가 없습니다.');
      }
      
      return response;
    } catch (error) {
      console.error(`❌ 범위 검색 실패: ${error.message}`);
      throw error;
    }
  }

  /**
   * 샘플 데이터 검색 (처음, 중간, 마지막)
   */
  async searchSampleData(network) {
    console.log(`\n📊 ${network.toUpperCase()} 네트워크 - 샘플 데이터 검색...`);
    
    try {
      // 1. 첫 번째 데이터 (samsung_001)
      console.log(`\n🔍 1️⃣ 첫 번째 데이터 검색: samsung_001`);
      await this.searchSpecificData(network, 'samsung_001');
      
      // 2. 중간 데이터 (samsung_050)
      console.log(`\n🔍 2️⃣ 중간 데이터 검색: samsung_050`);
      await this.searchSpecificData(network, 'samsung_050');
      
      // 3. 마지막 데이터 (samsung_100)
      console.log(`\n🔍 3️⃣ 마지막 데이터 검색: samsung_100`);
      await this.searchSpecificData(network, 'samsung_100');
      
      // 4. 범위 검색 (samsung_001 ~ samsung_010)
      console.log(`\n🔍 4️⃣ 범위 검색: samsung_001 ~ samsung_100`);
      await this.searchRangeData(network, 'samsung_001', 'samsung_100');
      0
    } catch (error) {
      console.error(`❌ 샘플 데이터 검색 실패: ${error.message}`);
      throw error;
    }
  }

  /**
   * 연결 종료
   */
  close() {
    this.indexingClient.close();
  }
}

// Hardhat 환경에서 네트워크 정보 가져오기
function getNetworkInfo() {
  const hardhatNetwork = process.env.HARDHAT_NETWORK || 'hardhat';
  
  let network;
  if (hardhatNetwork === 'monad') {
    network = 'monad';
  } else if (hardhatNetwork === 'sepolia') {
    network = 'sepolia';
  } else if (hardhatNetwork === 'hardhat') {
    network = 'hardhat';
  } else {
    console.log('❌ 지원하지 않는 Hardhat 네트워크:', hardhatNetwork);
    console.log('   지원하는 네트워크: hardhat, monad, sepolia');
    process.exit(1);
  }
  
  console.log(`\n🌐 Hardhat 네트워크: ${hardhatNetwork}`);
  console.log(`📋 자동 설정: network=${network}`);
  
  return { network, hardhatNetwork };
}

// 메인 실행 함수
async function main() {
  const verifier = new BulkDataVerifier();
  
  try {
    const { network, hardhatNetwork } = getNetworkInfo();
    
    console.log(`\n🚀 === ${network.toUpperCase()} 네트워크 100개 대량 데이터 검증 시작 ===`);
    
    // 1. 인덱스 정보 조회
    console.log(`\n📋 1️⃣ 인덱스 정보 조회...`);
    await verifier.getIndexInfo(network);
    
    // 2. 전체 데이터 개수 확인
    console.log(`\n🔢 2️⃣ 전체 데이터 개수 확인...`);
    const totalCount = await verifier.countTotalData(network);
    console.log(`\n📊 전체 데이터 개수: ${totalCount}개`);
    
    if (totalCount === 100) {
      console.log(`✅ 100개 데이터가 모두 정상적으로 저장되었습니다!`);
    } else {
      console.log(`⚠️  예상: 100개, 실제: ${totalCount}개`);
    }
    
    // 3. 샘플 데이터 검색
    console.log(`\n🔍 3️⃣ 샘플 데이터 검색...`);
    await verifier.searchSampleData(network);
    
    console.log(`\n✅ ${network.toUpperCase()} 네트워크 100개 대량 데이터 검증 완료!`);
    
  } catch (error) {
    console.error(`\n💥 대량 데이터 검증 실패: ${error.message}`);
    process.exit(1);
  } finally {
    verifier.close();
  }
}

// 스크립트 실행
if (require.main === module) {
  main();
}

module.exports = { BulkDataVerifier };
