#!/usr/bin/env node

const IndexingClient = require('../../indexing-client-package/lib/indexing-client');

/**
 * 통합 데이터 검증 스크립트
 * 사용법: node verify-data.js --cmd [network] [--search exact|range] [--info]
 * 예시: node verify-data.js --cmd hardhat --search exact
 *       node verify-data.js --cmd monad --search range
 *       node verify-data.js --cmd fabric --info
 */

class UnifiedDataSearcher {
  constructor(serverAddr = 'localhost:50052') {
    this.indexingClient = new IndexingClient({
      serverAddr: serverAddr,
      protoPath: '../../idxmngr-go/protos/index_manager.proto'
    });
  }

  /**
   * 네트워크별 설정 정보
   */
  getNetworkConfig(network) {
    const configs = {
      hardhat: {
        IndexID: '001_samsung',
        IndexName: 'Samsung Index',
        KeyCol: 'IndexableData',
        FilePath: 'data/hardhat/samsung.bf',
        Network: 'hardhat'
      },
      monad: {
        IndexID: '002_samsung',
        IndexName: 'Samsung Index',
        KeyCol: 'IndexableData',
        FilePath: 'data/monad/samsung.bf',
        Network: 'monad'
      },
      fabric: {
        IndexID: '003_samsung',
        IndexName: 'Samsung Index',
        KeyCol: 'IndexableData',
        FilePath: 'data/fabric/samsung.bf',
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
   * 인덱스 정보 확인
   */
  async checkIndexInfo(network) {
    const config = this.getNetworkConfig(network);
    console.log(`\n🔍 ${network.toUpperCase()} 네트워크 - 인덱스 정보 확인...`);
    
    const request = { 
      IndexID: config.IndexID,
      KeyCol: config.KeyCol
    };

    try {
      const response = await this.indexingClient.getIndexInfo(request);
      
      console.log(`✅ 인덱스 정보: ${response.ResponseCode} - ${response.ResponseMessage}`);
      console.log('📋 전체 응답 객체:', JSON.stringify(response, null, 2));
      
      if (response.ResponseCode === 200) {
        console.log('📋 인덱스 상세 정보:');
        console.log(`   IndexID: ${response.IndexID || 'N/A'}`);
        console.log(`   IndexName: ${response.IndexName || 'N/A'}`);
        console.log(`   KeyCol: ${response.KeyCol || 'N/A'}`);
        console.log(`   FilePath: ${response.FilePath || 'N/A'}`);
        console.log(`   KeySize: ${response.KeySize || 'N/A'}`);
        console.log(`   Network: ${response.Network || 'N/A'}`);
      }
      
      return response;
    } catch (error) {
      console.error(`❌ 인덱스 정보 조회 실패: ${error.message}`);
      throw error;
    }
  }



  /**
   * 모든 검증 수행
   */
  async runAllVerifications(network) {
    console.log(`\n🚀 ${network.toUpperCase()} 네트워크 - 전체 검증 시작...`);
    
    try {
      // 1. 인덱스 정보 확인
      await this.checkIndexInfo(network);
      
      // 2. 정확한 검색
      await this.searchExact(network);
      
      // 3. 범위 검색
      await this.searchRange(network);
      
      console.log(`\n🎉 ${network.toUpperCase()} 네트워크 - 전체 검증 완료!`);
      
    } catch (error) {
      console.error(`\n💥 ${network.toUpperCase()} 네트워크 - 검증 실패: ${error.message}`);
      throw error;
    }
  }

  close() {
    if (this.indexingClient) {
      this.indexingClient.close();
      console.log('🔌 연결 종료');
    }
  }
}

// 명령행 인자 파싱
function parseArgs() {
  const args = process.argv.slice(2);
  const cmdIndex = args.indexOf('--cmd');
  const searchIndex = args.indexOf('--search');
  const infoIndex = args.indexOf('--info');
  
  if (cmdIndex === -1 || cmdIndex + 1 >= args.length) {
    console.log('❌ 사용법: node verify-data.js --cmd [network] [--search exact|range] [--info]');
    console.log('   지원하는 네트워크: hardhat, monad, fabric');
    console.log('   예시: node verify-data.js --cmd hardhat --search exact');
    console.log('   예시: node verify-data.js --cmd monad --search range');
    console.log('   예시: node verify-data.js --cmd fabric --info');
    process.exit(1);
  }
  
  const network = args[cmdIndex + 1].toLowerCase();
  
  if (!['hardhat', 'monad', 'fabric'].includes(network)) {
    console.log('❌ 지원하지 않는 네트워크:', network);
    console.log('   지원하는 네트워크: hardhat, monad, fabric');
    process.exit(1);
  }
  
  let searchType = null;
  if (searchIndex !== -1 && searchIndex + 1 < args.length) {
    searchType = args[searchIndex + 1].toLowerCase();
    if (!['exact', 'range'].includes(searchType)) {
      console.log('❌ 지원하지 않는 검색 타입:', searchType);
      console.log('   지원하는 검색 타입: exact, range');
      process.exit(1);
    }
  }
  
  const showInfo = infoIndex !== -1;
  
  return { network, searchType, showInfo };
}

// 메인 실행 함수
async function main() {
  try {
    const { network, searchType, showInfo } = parseArgs();
    
    console.log(`\n🌐 네트워크: ${network}`);
    console.log(`🔍 검색 타입: ${searchType || '전체'}`);
    console.log(`📋 정보 표시: ${showInfo ? '예' : '아니오'}`);
    
    const searcher = new UnifiedDataSearcher();
    
    try {
      if (showInfo) {
        // 인덱스 정보만 확인
        await searcher.checkIndexInfo(network);
      } else if (searchType === 'exact') {
        // 정확한 검색만
        await searcher.searchExact(network);
      } else if (searchType === 'range') {
        // 범위 검색만
        await searcher.searchRange(network);
      } else {
        // 전체 검증
        await searcher.runAllVerifications(network);
      }
      
      console.log(`\n✅ ${network.toUpperCase()} 네트워크 검증 완료!`);
      
    } finally {
      searcher.close();
    }
    
  } catch (error) {
    console.error('\n💥 검증 실패:', error.message);
    process.exit(1);
  }
}

if (require.main === module) {
  main();
}

module.exports = { UnifiedDataSearcher, getNetworkConfig: (network) => {
  const searcher = new UnifiedDataSearcher();
  return searcher.getNetworkConfig(network);
}};
