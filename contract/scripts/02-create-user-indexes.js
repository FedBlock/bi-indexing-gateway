#!/usr/bin/env node

const path = require('path');
const crypto = require('crypto');
const IndexingClient = require('../../indexing-client-package/lib/indexing-client');

// 지갑 주소 해시 함수
function hashWalletAddress(address) {
  const hash = crypto.createHash('sha256').update(address).digest('hex');
  return hash.slice(0, 8);
}

async function createUserIndexes() {
  console.log('🚀 사용자별 인덱스 생성 시작\n');

  const indexingClient = new IndexingClient({
    serverAddr: 'localhost:50052',
    protoPath: path.join(process.cwd(), '../idxmngr-go/protos/index_manager.proto')
  });

  try {
    // 연결 완료 대기
    await new Promise(resolve => setTimeout(resolve, 1000));
    
    // Hardhat 테스트 계정들
    const testAddresses = [
      "0x70997970C51812dc3A010C7d01b50e0d17dc79C8",  // Hardhat Account #0
      "0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC",  // Hardhat Account #1
      "0x90F79bf6EB2c4f870365E785982E1f101E93b906",  // Hardhat Account #2
      "0x15d34AAf54267DB7D7c367839AAf71A00a2C6A65"   // Hardhat Account #3
    ];

    console.log(`📋 생성할 사용자 인덱스들:`);
    testAddresses.forEach((address, index) => {
      const shortHash = hashWalletAddress(address);
      console.log(`   ${index + 1}. ${address.slice(0, 10)}... → user_${shortHash}_001`);
    });
    console.log('');

    // 각 사용자별 인덱스 생성
    for (let i = 0; i < testAddresses.length; i++) {
      const address = testAddresses[i];
      const shortHash = hashWalletAddress(address);
      
      const userIndexInfo = {
        IndexID: `user_${shortHash}_001`,
        IndexName: `User ${address.slice(0, 10)}... Personal Index`,
        KeyCol: 'UserId',
        FilePath: `data/hardhat-local/user_${shortHash}_001.bf`,
        KeySize: 64,
        Network: 'hardhat'
      };
      
      console.log(`🔨 사용자 ${i + 1} 인덱스 생성 중: ${userIndexInfo.IndexID}`);
      
      try {
        await indexingClient.createIndex(userIndexInfo);
        console.log(`   ✅ 생성 성공: ${userIndexInfo.IndexID}`);
        
        // 인덱스 생성 간격
        await new Promise(resolve => setTimeout(resolve, 500));
        
      } catch (error) {
        console.error(`   ❌ 생성 실패: ${error.message}`);
      }
    }
    
    console.log('\n🎉 사용자별 인덱스 생성 완료!');
    
  } catch (error) {
    console.error(`❌ 사용자별 인덱스 생성 중 오류 발생: ${error.message}`);
  } finally {
    indexingClient.close();
  }
}

// 메인 실행
if (require.main === module) {
  createUserIndexes().catch(console.error);
}

module.exports = { createUserIndexes };
