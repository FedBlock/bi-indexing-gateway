#!/usr/bin/env node

/**
 * 사용자별 통합 인덱스 생성 스크립트
 * 사용법: node create-user-indexes.js [userAddress]
 * 예시: node create-user-indexes.js 0x123...
 */

const path = require('path');
const IndexingClient = require('../../indexing-client-package/lib/indexing-client');

// 사용자 주소 (명령행 인자 또는 기본값)
const userAddress = process.argv[2] || '0x1234567890123456789012345678901234567890';

// 사용자별 통합 인덱스 정보
const userIndexInfo = {
  IndexID: `user_${userAddress.slice(2, 8)}`,  // user_123456 (짧게)
  IndexName: `User ${userAddress} Data Requests Index`,
  KeyCol: 'IndexableData',
  FilePath: `data/hardhat/users/user_${userAddress.slice(2, 8)}.bf`,
  KeySize: 64,  // userId + organizationName 조합
  Network: 'hardhat'
};

// 사용자 인덱스 생성
async function createUserIndex() {
  console.log(`\n🚀 사용자별 통합 인덱스 생성 시작...`);
  console.log(`👤 사용자 주소: ${userAddress}`);
  
  const indexingClient = new IndexingClient({
    serverAddr: 'localhost:50052',
    protoPath: path.join(process.cwd(), '../idxmngr-go/protos/index_manager.proto')
  });

  try {
    // 연결 완료 대기
    await new Promise(resolve => setTimeout(resolve, 1000));
    
    console.log(`\n📋 생성할 인덱스 정보:`);
    console.log(`   IndexID: ${userIndexInfo.IndexID}`);
    console.log(`   IndexName: ${userIndexInfo.IndexName}`);
    console.log(`   KeyCol: ${userIndexInfo.KeyCol}`);
    console.log(`   FilePath: ${userIndexInfo.FilePath}`);
    console.log(`   KeySize: ${userIndexInfo.KeySize}`);
    console.log(`   Network: ${userIndexInfo.Network}`);

    try {
      // 인덱스 생성
      console.log(`🏗️ 사용자 인덱스 생성 중...`);
      const createRequest = {
        IndexID: userIndexInfo.IndexID,
        IndexName: userIndexInfo.IndexName,
        KeyCol: userIndexInfo.KeyCol,
        FilePath: userIndexInfo.FilePath,
        KeySize: userIndexInfo.KeySize,
        Network: userIndexInfo.Network
      };
      
      const createResponse = await indexingClient.createIndex(createRequest);
      console.log(`✅ User Index created: ${createResponse.ResponseCode} - ${createResponse.ResponseMessage}`);
      
      console.log(`\n🎉 사용자별 통합 인덱스 생성 완료!`);
      console.log(`📋 사용법:`);
      console.log(`   - 조직별 요청 조회: samsung_001, lg_002 등`);
      console.log(`   - 사용자별 요청 조회: ${userIndexInfo.IndexID}`);
      
    } catch (error) {
      if (error.message.includes('already exists')) {
        console.log(`ℹ️ 사용자 인덱스가 이미 존재함: ${userIndexInfo.IndexID}`);
      } else {
        console.error(`❌ 사용자 인덱스 생성 실패: ${error.message}`);
      }
    }
    
  } catch (error) {
    console.error(`❌ 사용자 인덱스 생성 중 오류 발생: ${error.message}`);
  } finally {
    indexingClient.close();
  }
}

// 메인 실행
if (require.main === module) {
  createUserIndex().catch(console.error);
}

module.exports = { createUserIndex, userIndexInfo };

