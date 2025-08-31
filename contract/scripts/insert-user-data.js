#!/usr/bin/env node

/**
 * 사용자별 인덱스에 데이터 삽입 스크립트
 * 사용법: node insert-user-data.js [userAddress] [organizationName]
 * 예시: node insert-user-data.js 0x123... samsung
 */

const path = require('path');
const IndexingClient = require('../../indexing-client-package/lib/indexing-client');

// 명령행 인자 파싱
const userAddress = process.argv[2] || '0x1234567890123456789012345678901234567890';
const organizationName = process.argv[3] || 'samsung';

// 사용자별 인덱스 설정
const userIndexConfig = {
  IndexID: `user_${userAddress.slice(2, 8)}`,  // user_123456
  KeyCol: 'IndexableData',
  FilePath: `data/hardhat/users/user_${userAddress.slice(2, 8)}.bf`,
  Network: 'hardhat'
};

// 사용자 인덱스에 데이터 삽입
async function insertUserData() {
  console.log(`\n🚀 사용자별 인덱스에 데이터 삽입 시작...`);
  console.log(`👤 사용자: ${userAddress}`);
  console.log(`🏢 조직: ${organizationName}`);
  
  const indexingClient = new IndexingClient({
    serverAddr: 'localhost:50052',
    protoPath: path.join(process.cwd(), '../idxmngr-go/protos/index_manager.proto')
  });

  try {
    // 연결 완료 대기
    await new Promise(resolve => setTimeout(resolve, 1000));
    
    // 샘플 데이터 생성 (실제로는 블록체인에서 가져와야 함)
    const sampleData = {
      TxId: `0x${Math.random().toString(16).slice(2, 66)}`,
      ContractAddress: '0xSampleContractAddress',
      EventName: 'dataRequest',
      Timestamp: new Date().toISOString(),
      BlockNumber: Math.floor(Math.random() * 10000),
      DynamicFields: {
        "organizationName": organizationName,
        "organizationId": "001",
        "userId": userAddress,
        "requestType": "personal_data",
        "purpose": "마케팅 분석",
        "status": "pending",
        "dataScope": "contact_info,preferences"
      },
      SchemaVersion: "1.0"
    };

    console.log(`\n📝 데이터 삽입 중...`);
    console.log(`   TxId: ${sampleData.TxId}`);
    console.log(`   Organization: ${organizationName}`);
    console.log(`   User: ${userAddress}`);

    const insertRequest = {
      IndexID: userIndexConfig.IndexID,
      BcList: [{
        TxId: sampleData.TxId,
        KeyCol: userIndexConfig.KeyCol,
        IndexableData: sampleData
      }],
      ColName: userIndexConfig.KeyCol,
      TxId: sampleData.TxId,
      FilePath: userIndexConfig.FilePath,
      Network: userIndexConfig.Network
    };

    const insertResponse = await indexingClient.insertData(insertRequest);
    console.log(`✅ 데이터 삽입 성공: ${insertResponse.ResponseCode}`);
    
    console.log(`\n🎉 사용자별 인덱스 데이터 삽입 완료!`);
    console.log(`📋 검색 방법:`);
    console.log(`   - 특정 조직 요청만 조회: Field='DynamicFields.organizationName', Value='${organizationName}'`);
    
  } catch (error) {
    console.error(`❌ 데이터 삽입 실패: ${error.message}`);
  } finally {
    indexingClient.close();
  }
}

// 메인 실행
if (require.main === module) {
  insertUserData().catch(console.error);
}

module.exports = { insertUserData, userIndexConfig };

