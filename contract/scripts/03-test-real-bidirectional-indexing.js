#!/usr/bin/env node

const path = require('path');
const crypto = require('crypto');
const { ethers } = require('hardhat');
const IndexingClient = require('../../indexing-client-package/lib/indexing-client');

// 지갑 주소 해시 함수
function hashWalletAddress(address) {
  const hash = crypto.createHash('sha256').update(address).digest('hex');
  return hash.slice(0, 8);
}

// 실제 트랜잭션으로 양방향 인덱싱 테스트
async function testRealBidirectionalIndexing() {
  console.log('🚀 실제 컨트랙트 트랜잭션으로 양방향 인덱싱 테스트 시작\n');

      // 1. Hardhat 계정들 가져오기 (기존 순서와 맞춤)
    const [deployer, user1, user2, user3, user4, user5] = await ethers.getSigners();
    const org1 = user1; // 첫 번째 사용자를 조직으로 사용
    
    console.log('👥 테스트 계정들:');
    console.log(`   🏗️  배포자: ${deployer.address}`);
    console.log(`   🏢 조직1: ${org1.address}`);
    console.log(`   👤 사용자1: ${user2.address}`);
    console.log(`   👤 사용자2: ${user3.address}`);
    console.log(`   👤 사용자3: ${user4.address}`);
    console.log(`   👤 사용자4: ${user5.address}\n`);

  // 2. AccessManagement 컨트랙트 배포
  console.log('🏗️ AccessManagement 컨트랙트 배포 중...');
  const AccessManagement = await ethers.getContractFactory('AccessManagement');
  const accessManagement = await AccessManagement.deploy();
  await accessManagement.waitForDeployment();
  
  const contractAddress = await accessManagement.getAddress();
  console.log(`✅ 컨트랙트 배포 완료: ${contractAddress}\n`);

  // 3. IndexingClient 연결
  const indexingClient = new IndexingClient({
    serverAddr: 'localhost:50052',
    protoPath: path.join(process.cwd(), '../idxmngr-go/protos/index_manager.proto')
  });

  try {
    // 연결 완료 대기
    await new Promise(resolve => setTimeout(resolve, 1000));
    
    // 4. 실제 트랜잭션으로 데이터 요청 생성
    console.log('📝 실제 트랜잭션으로 데이터 요청 생성 중...\n');
    
    const testRequests = [
      {
        organizationName: "samsung",
        purpose: "데이터 공유 요청",
        description: "삼성이 사용자1에게 데이터 공유 요청"
      },
      {
        organizationName: "samsung", 
        purpose: "데이터 접근 요청",
        description: "삼성이 사용자2에게 데이터 접근 요청"
      },
      {
        organizationName: "samsung",
        purpose: "데이터 수정 요청", 
        description: "삼성이 사용자3에게 데이터 수정 요청"
      },
      {
        organizationName: "samsung",
        purpose: "데이터 삭제 요청",
        description: "삼성이 사용자4에게 데이터 삭제 요청"
      }
    ];

    const users = [user1, user2, user3, user4];
    
    for (let i = 0; i < testRequests.length; i++) {
      const request = testRequests[i];
      const user = users[i];
      
      console.log(`📋 테스트 요청 ${i + 1}:`);
      console.log(`   🏢 조직: ${request.organizationName}`);
      console.log(`   👤 사용자: ${user.address.slice(0, 10)}...`);
      console.log(`   📝 목적: ${request.purpose}`);
      
      try {
        // 5. 실제 컨트랙트 호출
        console.log(`   🔗 컨트랙트 호출 중...`);
        const tx = await accessManagement.connect(org1).saveRequest(
          user.address,
          request.purpose,
          request.organizationName
        );
        
        // 6. 트랜잭션 완료 대기
        const receipt = await tx.wait();
        const requestId = i + 1;
        
        console.log(`   ✅ 트랜잭션 성공: ${tx.hash}`);
        console.log(`   🔍 트랜잭션 해시 확인:`);
        console.log(`      tx.hash: ${tx.hash}`);
        console.log(`      receipt.transactionHash: ${receipt.transactionHash}`);
        console.log(`      receipt.hash: ${receipt.hash}`);
        console.log(`   🆔 Request ID: ${requestId}`);
        console.log(`   ⛽ 가스 사용량: ${receipt.gasUsed.toString()}\n`);
        
        // 7. 양방향 인덱싱
        await indexBidirectionalData(
          indexingClient,
          requestId,
          receipt,
          request,
          user.address,
          org1.address,
          accessManagement
        );
        
        // 트랜잭션 간격
        await new Promise(resolve => setTimeout(resolve, 1000));
        
      } catch (error) {
        console.error(`   ❌ 트랜잭션 실패: ${error.message}\n`);
      }
    }
    
    console.log('🎉 실제 트랜잭션으로 양방향 인덱싱 테스트 완료!');
    
  } catch (error) {
    console.error(`❌ 실제 트랜잭션 테스트 중 오류 발생: ${error.message}`);
  } finally {
    indexingClient.close();
  }
}

// 양방향 인덱싱 함수
async function indexBidirectionalData(indexingClient, requestId, receipt, request, userAddress, orgAddress, accessManagement) {
  try {
    const txId = receipt.transactionHash || receipt.hash || 'unknown';
    const shortHash = hashWalletAddress(userAddress);
    
    console.log(`   🔍 양방향 인덱싱 시작: ${txId}`);
    console.log(`   🔍 트랜잭션 해시 상세:`);
    console.log(`      receipt.transactionHash: ${receipt.transactionHash}`);
    console.log(`      receipt.hash: ${receipt.hash}`);
    console.log(`      사용할 txId: ${txId}`);
    
    // 1. 조직 인덱스에 저장 (samsung_001)
    const orgRequest = {
      IndexID: "samsung_001",
      BcList: [{
        TxId: txId,
        KeySize: 64,
        KeyCol: 'IndexableData',
        IndexableData: {
          TxId: txId,
          ContractAddress: await accessManagement.getAddress(),
          EventName: 'AccessRequestsSaved',
          Timestamp: new Date().toISOString(),
          BlockNumber: receipt.blockNumber,
          DynamicFields: {
            "organizationName": request.organizationName,
            "targetUserId": userAddress,
            "requestType": request.purpose,
            "description": request.description,
            "requestId": requestId.toString(),
            "timestamp": new Date().toISOString()
          },
          SchemaVersion: "1.0"
        }
      }],
      ColName: 'IndexableData',
      ColIndex: "samsung_001",
      FilePath: "data/hardhat/samsung_001.bf",
      Network: 'hardhat'
    };

    // 2. 사용자 인덱스에 저장 (user_${hash}_001)
    const userRequest = {
      IndexID: `user_${shortHash}_001`,
      BcList: [{
        TxId: txId,
        KeySize: 64,
        KeyCol: 'UserId',
        IndexableData: {
          TxId: txId,
          ContractAddress: await accessManagement.getAddress(),
          EventName: 'AccessRequestsSaved',
          Timestamp: new Date().toISOString(),
          BlockNumber: receipt.blockNumber,
          DynamicFields: {
            "userId": userAddress,
            "requestingOrg": request.organizationName,
            "requestType": request.purpose,
            "description": request.description,
            "requestId": requestId.toString(),
            "timestamp": new Date().toISOString()
          },
          SchemaVersion: "1.0"
        }
      }],
      ColName: 'UserId',
      ColIndex: `user_${shortHash}_001`,
      FilePath: `data/hardhat/user_${shortHash}_001.bf`,
      Network: 'hardhat'
    };
    
    // 3. 양방향 인덱싱 실행
    console.log(`   🔍 조직 요청 데이터 구조:`);
    console.log(JSON.stringify(orgRequest, null, 2));
    console.log('');
    
    console.log(`   🔍 사용자 요청 데이터 구조:`);
    console.log(JSON.stringify(userRequest, null, 2));
    console.log('');
    
    await indexingClient.insertData(orgRequest);
    console.log(`   ✅ 조직 인덱스 저장 성공`);
    
    await indexingClient.insertData(userRequest);
    console.log(`   ✅ 사용자 인덱스 저장 성공`);
    
  } catch (error) {
    console.error(`   ❌ 양방향 인덱싱 실패: ${error.message}`);
  }
}

// 메인 실행
if (require.main === module) {
  testRealBidirectionalIndexing().catch(console.error);
}

module.exports = { testRealBidirectionalIndexing };
