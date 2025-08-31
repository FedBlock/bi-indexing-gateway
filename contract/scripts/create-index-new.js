#!/usr/bin/env node

/**
 * 새로운 인덱스 생성 스크립트 (중복 방지)
 * 사용법: node create-index-new.js --cmd [network]
 * 예시: node create-index-new.js --cmd hardhat
 *       node create-index-new.js --cmd monad
 *       node create-index-new.js --cmd fabric
 */

const path = require('path');
const IndexingClient = require('../../indexing-client-package/lib/indexing-client');

// 명령행 인자 파싱
function parseArgs() {
  const args = process.argv.slice(2);
  const networkIndex = args.indexOf('--network');
  
  if (networkIndex === -1 || networkIndex + 1 >= args.length) {
    console.log('❌ 사용법: node create-index-new.js --network [network]');
    console.log('   지원하는 네트워크: hardhat, monad, fabric');
    console.log('   예시: node create-index-new.js --network hardhat');
    process.exit(1);
  }
  
  const network = args[networkIndex + 1].toLowerCase();
  
  if (!['hardhat', 'monad', 'fabric'].includes(network)) {
    console.log('❌ 지원하지 않는 네트워크:', network);
    console.log('   지원하는 네트워크: hardhat, monad, fabric');
    process.exit(1);
  }
  
  console.log(`\n🌐 네트워크: ${network}`);
  console.log(`📋 새로운 인덱스 생성 시작...`);
  
  return { network };
}

// hardhat 네트워크용 조직 인덱스 정보 생성
function getIndexInfo(network) {
  // hardhat만 지원
  if (network !== 'hardhat') {
    throw new Error('현재 hardhat 네트워크만 지원됩니다.');
  }
  
  return {
    IndexID: `samsung_001`,  // Hardhat = samsung_001
    IndexName: `Hardhat Network - Samsung Index`,
    KeyCol: 'IndexableData',
    FilePath: `data/hardhat/samsung_001.bf`,  // 타임스탬프 제거
    KeySize: 64,
    Network: 'hardhat'
  };
}

// 인덱스 생성
async function createIndex(network) {
  const indexInfo = getIndexInfo(network);
  
  console.log(`\n🚀 ${network.toUpperCase()} 네트워크 - 새로운 인덱스 생성 시작...`);
  
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
    protoPath: path.join(process.cwd(), '../idxmngr-go/protos/index_manager.proto')
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
      
      if (existingInfo.ResponseCode === 200) {
        console.log(`✅ 인덱스가 이미 존재함: ${existingInfo.ResponseMessage}`);
        return {
          IndexID: indexInfo.IndexID,
          Status: 'already_exists',
          Network: network
        };
      } else if (existingInfo.ResponseCode === 500 && existingInfo.ResponseMessage.includes('already exists')) {
        console.log(`✅ 인덱스가 이미 존재함: ${existingInfo.ResponseMessage}`);
        return {
          IndexID: indexInfo.IndexID,
          Status: 'already_exists',
          Network: network
        };
      }
    } catch (error) {
      console.log(`ℹ️  인덱스 정보 확인 실패 (새로 생성): ${error.message}`);
    }
    
    // 2. 인덱스 생성
    console.log(`\n🏗️ 2️⃣ 인덱스 생성 중...`);
    const createRequest = {
      IndexID: indexInfo.IndexID,
      IndexName: indexInfo.IndexName,
      KeyCol: indexInfo.KeyCol,
      FilePath: indexInfo.FilePath,
      KeySize: indexInfo.KeySize,
      Network: indexInfo.Network
    };
    
    const createResponse = await indexingClient.createIndex(createRequest);
    console.log(`✅ Index created: ${createResponse.ResponseCode} - ${createResponse.ResponseMessage}`);
    
    if (createResponse.ResponseCode === 200) {
      console.log(`✅ 인덱스 생성 성공!`);
      console.log(`   결과: ${JSON.stringify(createResponse, null, 2)}`);
    } else {
      throw new Error(`인덱스 생성 실패: ${createResponse.ResponseMessage}`);
    }
    
    return {
      IndexID: indexInfo.IndexID,
      Status: 'created',
      Network: network
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
    
    console.log(`\n🚀 === ${network.toUpperCase()} 네트워크 새로운 인덱스 생성 시작 ===`);
    
    const result = await createIndex(network);
    
    console.log(`\n🎉 ${network.toUpperCase()} 네트워크 - 새로운 인덱스 생성 완료!`);
    console.log(`   IndexID: ${result.IndexID}`);
    console.log(`   Status: ${result.Status}`);
    console.log(`   Network: ${result.Network}`);
    
    console.log(`\n📋 다음 단계: 새로운 인덱스로 데이터 삽입 테스트`);
    console.log(`   예시: node insert-data-new.js --network ${network}`);
    
  } catch (error) {
    console.error(`\n💥 새로운 인덱스 생성 실패: ${error.message}`);
    process.exit(1);
  }
}

// 스크립트 실행
if (require.main === module) {
  main();
}

module.exports = { createIndex, getIndexInfo };
