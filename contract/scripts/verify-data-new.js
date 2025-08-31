/**
 * 새로운 인덱스용 데이터 검증 스크립트 (Hardhat 환경)
 * 사용법: npx hardhat run verify-data-new.js --network [hardhat|monad|fabric]
 * 예시: npx hardhat run verify-data-new.js --network hardhat
 */

const path = require('path');
const IndexingClient = require('../../indexing-client-package/lib/indexing-client');

/**
 * 새로운 인덱스용 통합 데이터 검색기
 */
class NewUnifiedDataSearcher {
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
        IndexID: 'hardhat_1756621048516_samsung', // 새로 생성한 인덱스 ID
        IndexName: 'Hardhat Network - Samsung Index',
        KeyCol: 'IndexableData',
        FilePath: 'data/hardhat/samsung_1756621048516.bf',
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
   * 정확한 검색
   */
  async searchExact(network, value = 'samsung') {
    const config = this.getNetworkConfig(network);
    console.log(`\n🔍 ${network.toUpperCase()} 네트워크 - 정확한 검색...`);
    
    const searchRequest = {
      IndexID: config.IndexID,
      Field: config.KeyCol,
      Value: value,
      ComOp: 'Eq'
    };

    console.log('📤 검색 요청:', JSON.stringify(searchRequest, null, 2));

    try {
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
   * 범위 검색
   */
  async searchRange(network, begin = 's', end = 't') {
    const config = this.getNetworkConfig(network);
    console.log(`\n🔍 ${network.toUpperCase()} 네트워크 - 범위 검색...`);
    
    const searchRequest = {
      IndexID: config.IndexID,
      Field: config.KeyCol,
      Begin: begin,
      End: end,
      ComOp: 'Range'
    };

    console.log('📤 범위 검색 요청:', JSON.stringify(searchRequest, null, 2));

    try {
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
   * 연결 종료
   */
  close() {
    this.indexingClient.close();
  }
}

// Hardhat 환경에서 네트워크 정보 가져오기
function getNetworkInfo() {
  // Hardhat 환경에서 현재 네트워크 자동 감지
  const hardhatNetwork = process.env.HARDHAT_NETWORK || 'hardhat';
  
  // hardhatNetwork에 따라 network 자동 설정
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

// 메인 실행 함수 (Hardhat 환경)
async function main() {
  const searcher = new NewUnifiedDataSearcher();
  
  try {
    const { network, hardhatNetwork } = getNetworkInfo();
    
    console.log(`\n🚀 === ${network.toUpperCase()} 네트워크 새로운 인덱스 데이터 검증 시작 ===`);
    
    // 1. 인덱스 정보 조회
    console.log(`\n📋 인덱스 정보 조회 중...`);
    await searcher.getIndexInfo(network);
    
    // 2. 정확한 검색
    console.log(`\n🔍 정확한 검색 실행 중...`);
    await searcher.searchExact(network, 'samsung');
    
    console.log(`\n✅ ${network.toUpperCase()} 네트워크 검증 완료!`);
    
  } catch (error) {
    console.error(`\n💥 검증 실패: ${error.message}`);
    process.exit(1);
  } finally {
    searcher.close();
  }
}

// 스크립트 실행
if (require.main === module) {
  main();
}

module.exports = { NewUnifiedDataSearcher };
