#!/usr/bin/env node

/**
 * 통합 인덱스 생성 스크립트
 * 사용법: node create-index.js --cmd [network]
 * 예시: node create-index.js --cmd hardhat
 *       node create-index.js --cmd monad
 *       node create-index.js --cmd fabric
 */

const IndexingClient = require('../../indexing-client-package/lib/indexing-client');

// 명령행 인자 파싱
function parseArgs() {
  const args = process.argv.slice(2);
  const cmdIndex = args.indexOf('--cmd');
  
  if (cmdIndex === -1 || cmdIndex + 1 >= args.length) {
    console.log('❌ 사용법: node create-index.js --cmd [network]');
    console.log('   지원하는 네트워크: hardhat, monad, fabric');
    console.log('   예시: node create-index.js --cmd hardhat');
    process.exit(1);
  }
  
  const network = args[cmdIndex + 1].toLowerCase();
  
  if (!['hardhat', 'monad', 'fabric'].includes(network)) {
    console.log('❌ 지원하지 않는 네트워크:', network);
    console.log('   지원하는 네트워크: hardhat, monad, fabric');
    process.exit(1);
  }
  
  console.log(`\n🌐 네트워크: ${network}`);
  console.log(`📋 인덱스 생성 시작...`);
  
  return { network };
}

// 네트워크별 인덱스 정보 생성
function getIndexInfo(network) {
  const baseInfo = {
    hardhat: {
      IndexID: '001_samsung',
      IndexName: 'Samsung Index',
      KeyCol: 'IndexableData',
      FilePath: 'data/hardhat/samsung.bf',
      KeySize: 32, // "samsung" 문자열을 32자로 패딩
      Network: 'hardhat' // 서버에 전달할 네트워크명만
    },
    monad: {
      IndexID: '002_samsung',
      IndexName: 'Samsung Index',
      KeyCol: 'IndexableData',
      FilePath: 'data/monad/samsung.bf',
      KeySize: 32, // "samsung" 문자열을 32자로 패딩
      Network: 'monad' // 서버에 전달할 네트워크명만
    },
    fabric: {
      IndexID: '003_samsung',
      IndexName: 'Samsung Index',
      KeyCol: 'IndexableData',
      FilePath: 'data/fabric/samsung.bf',
      KeySize: 32, // "samsung" 문자열을 32자로 패딩
      Network: 'fabric' // 서버에 전달할 네트워크명만
    }
  };
  
  return baseInfo[network];
}

// 인덱스 생성
async function createIndex(network) {
  const indexInfo = getIndexInfo(network);
  
  console.log(`\n🚀 ${network.toUpperCase()} 네트워크 - 인덱스 생성 시작...`);
  
  console.log(`\n📋 생성할 인덱스 정보:`);
  console.log(`   IndexID: ${indexInfo.IndexID}`);
  console.log(`   IndexName: ${indexInfo.IndexName}`);
  console.log(`   KeyCol: ${indexInfo.KeyCol}`);
  console.log(`   FilePath: ${indexInfo.FilePath}`);
  console.log(`   KeySize: ${indexInfo.KeySize}`);
  console.log(`   Network: ${indexInfo.Network}`);

  // IndexingClient 인스턴스 생성
  const indexingClient = new IndexingClient({
    serverAddr: 'localhost:50052',
    protoPath: '../../idxmngr-go/protos/index_manager.proto'
  });

  try {
    // 연결 완료 대기
    await new Promise(resolve => setTimeout(resolve, 1000));
    
    // 1. 인덱스 정보 확인 (이미 존재하는지)
    console.log(`\n🔍 1️⃣ 인덱스 정보 확인...`);
    try {
      const existingInfo = await indexingClient.getIndexInfo({
        IndexID: indexInfo.IndexID,
        IndexName: indexInfo.IndexName,
        KeyCol: indexInfo.KeyCol,
        FilePath: indexInfo.FilePath,
        KeySize: indexInfo.KeySize
      });
      
      console.log(`✅ 인덱스 정보: ${JSON.stringify(existingInfo)}`);
      
      if (existingInfo.ResponseCode === 200) {
        console.log(`ℹ️  인덱스가 이미 존재함: ${existingInfo.ResponseMessage}`);
        return {
          indexID: indexInfo.IndexID,
          status: 'already_exists',
          message: existingInfo.ResponseMessage,
          network: indexInfo.Network
        };
      }
    } catch (error) {
      console.log(`ℹ️  인덱스 정보 조회 실패: ${error.message}`);
    }

    // 2. 인덱스 생성
    console.log(`\n🏗️ 2️⃣ 인덱스 생성 중...`);
    const result = await indexingClient.createIndex({
      IndexID: indexInfo.IndexID,
      IndexName: indexInfo.IndexName,
      KeyCol: indexInfo.KeyCol,
      FilePath: indexInfo.FilePath,
      KeySize: indexInfo.KeySize,
      BlockNum: 0,
      CallCnt: 0,
      KeyCnt: 0,
      IndexDataCnt: 0,
      Param: ''
    });
    
    console.log(`✅ 인덱스 생성 성공!`);
    console.log(`   결과: ${JSON.stringify(result)}`);

    return {
      indexID: indexInfo.IndexID,
      status: 'created',
      message: 'Index created successfully',
      network: indexInfo.Network
    };

  } catch (error) {
    console.error(`❌ 인덱스 생성 실패: ${error.message}`);
    throw error;
  } finally {
    indexingClient.close();
  }
}

// 메인 실행 함수
async function main() {
  try {
    const { network } = parseArgs();
    const result = await createIndex(network);
    
    console.log(`\n🎉 ${network.toUpperCase()} 네트워크 - 인덱스 생성 완료!`);
    console.log(`   IndexID: ${result.indexID}`);
    console.log(`   Status: ${result.status}`);
    console.log(`   Network: ${result.network}`);
    
    if (result.status === 'created') {
      console.log(`\n📋 다음 단계: 데이터 삽입 테스트`);
      if (network === 'fabric') {
        console.log(`   예시: node fabric-with-indexing.js`);
      } else {
        console.log(`   예시: npx hardhat run insert-data.js --network ${network === 'monad' ? 'monad' : 'hardhat'}`);
      }
    }
    
  } catch (error) {
    console.error('\n💥 인덱스 생성 실패:', error.message);
    process.exit(1);
  }
}

if (require.main === module) {
  main();
}

module.exports = { createIndex, getIndexInfo };
