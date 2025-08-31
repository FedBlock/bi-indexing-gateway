#!/usr/bin/env node

const path = require('path');
const crypto = require('crypto');
const IndexingClient = require('../../indexing-client-package/lib/indexing-client');

// 지갑 주소 해시 함수
function hashWalletAddress(address) {
  const hash = crypto.createHash('sha256').update(address).digest('hex');
  return hash.slice(0, 8);
}

// 실제 트랜잭션으로 저장된 양방향 인덱싱 데이터 조회
async function searchBidirectionalData() {
  console.log('🔍 실제 트랜잭션으로 저장된 양방향 인덱싱 데이터 조회 시작\n');

  const indexingClient = new IndexingClient({
    serverAddr: 'localhost:50052',
    protoPath: path.join(process.cwd(), '../idxmngr-go/protos/index_manager.proto')
  });

  try {
    // 연결 완료 대기
    await new Promise(resolve => setTimeout(resolve, 1000));
    
    // Hardhat 테스트 계정들 (기존 순서와 맞춤)
    const testAddresses = [
      "0x70997970C51812dc3A010C7d01b50e0d17dc79C8",  // Hardhat Account #1 (조직)
      "0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC",  // Hardhat Account #2 (사용자1)
      "0x90F79bf6EB2c4f870365E785982E1f101E93b906",  // Hardhat Account #3 (사용자2)
      "0x15d34AAf54267DB7D7c367839AAf71A00a2C6A65"   // Hardhat Account #4 (사용자3)
    ];

    console.log('📊 양방향 인덱싱 데이터 조회 시작\n');

    // 1. 조직별 조회 (samsung_001)
    console.log('🏢 === 조직별 인덱스 조회 (samsung_001) ===');
    const orgSearchRequest = {
      IndexID: "samsung_001",
      Field: "IndexableData",
      Value: "samsung",
      FilePath: "data/hardhat/samsung_001.bf",
      KeySize: 64,
      ComOp: "Eq"
    };

          try {
        const orgResponse = await indexingClient.searchData(orgSearchRequest);
        console.log('🔍 조직 인덱스 응답 구조 디버깅:');
        console.log(JSON.stringify(orgResponse, null, 2));
        console.log('');
        
        const orgResults = orgResponse.IdxData || [];
        console.log(`✅ 조직 인덱스 조회 성공: ${orgResults.length}개 결과`);
        
        if (orgResults.length > 0) {
          console.log('📋 조직별 저장된 요청들:');
          console.log('🔍 첫 번째 결과 구조:');
          console.log(JSON.stringify(orgResults[0], null, 2));
          console.log('');
          
          orgResults.forEach((result, index) => {
            console.log(`   ${index + 1}. TxId: ${result || 'N/A'}`);
            console.log(`      🔗 트랜잭션 해시: ${result}`);
            console.log(`      📝 상세 정보: 블록체인에서 조회 필요`);
            console.log('');
          });
        }
      } catch (error) {
        console.error(`❌ 조직 인덱스 조회 실패: ${error.message}`);
      }

    console.log('');

    // 2. 사용자별 조회 (각 사용자 인덱스)
    console.log('👤 === 사용자별 인덱스 조회 ===');
    
    for (let i = 0; i < testAddresses.length; i++) {
      const address = testAddresses[i];
      const shortHash = hashWalletAddress(address);
      const userIndexID = `user_${shortHash}_001`;
      
      console.log(`\n🔍 사용자 ${i + 1} (${address.slice(0, 10)}...):`);
      console.log(`   🆔 인덱스 ID: ${userIndexID}`);
      console.log(`   🔑 해시: ${shortHash}`);
      
      const userSearchRequest = {
        IndexID: userIndexID,
        Field: "UserId",
        Value: address,
        FilePath: `data/hardhat/user_${shortHash}_001.bf`,
        KeySize: 64,
        ComOp: "Eq"
      };

      try {
        const userResponse = await indexingClient.searchData(userSearchRequest);
        const userResults = userResponse.IdxData || [];
        console.log(`   ✅ 사용자 인덱스 조회 성공: ${userResults.length}개 결과`);
        
        if (userResults.length > 0) {
          console.log('   📋 사용자별 저장된 요청들:');
          userResults.forEach((result, index) => {
            console.log(`      ${index + 1}. TxId: ${result || 'N/A'}`);
            console.log(`         🔗 트랜잭션 해시: ${result}`);
            console.log(`         📝 상세 정보: 블록체인에서 조회 필요`);
          });
        }
      } catch (error) {
        console.error(`   ❌ 사용자 인덱스 조회 실패: ${error.message}`);
      }
    }

    console.log('\n🎉 양방향 인덱싱 데이터 조회 완료!');
    console.log('\n📊 요약:');
    console.log(`   - 조직 인덱스 (samsung_001): 조직별 요청 데이터`);
    console.log(`   - 사용자 인덱스 (user_${hashWalletAddress(testAddresses[0])}_001 등): 사용자별 요청 데이터`);
    console.log(`   - 양방향 저장: 하나의 요청이 두 곳에 모두 저장됨`);

  } catch (error) {
    console.error(`❌ 양방향 인덱싱 데이터 조회 중 오류 발생: ${error.message}`);
  } finally {
    indexingClient.close();
  }
}

// 메인 실행
if (require.main === module) {
  searchBidirectionalData().catch(console.error);
}

module.exports = { searchBidirectionalData };
