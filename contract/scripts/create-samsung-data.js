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

// Samsung 데이터 생성 (기존 작동 코드 기반)
async function createSamsungData() {
  console.log('🚀 Samsung 데이터 생성 시작\n');

  // 1. Hardhat 계정들 가져오기
  const [deployer, user1, user2, user3, org1] = await ethers.getSigners();
  
  console.log('👥 테스트 계정들:');
  console.log(`   🏗️  배포자: ${deployer.address}`);
  console.log(`   🏢 Samsung 조직: ${org1.address}`);
  console.log(`   👤 사용자1: ${user1.address}`);
  console.log(`   👤 사용자2: ${user2.address}`);
  console.log(`   👤 사용자3: ${user3.address}\n`);

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
    await new Promise(resolve => setTimeout(resolve, 1000));
    
    // 4. Samsung이 3명의 사용자에게 데이터 요청하는 시나리오
    console.log('📝 Samsung → 사용자들 데이터 요청 생성 중...\n');
    
    const samsungRequests = [
      {
        user: user1,
        purpose: "sleep_quality_monitoring",
        description: "삼성이 사용자1에게 수면 품질 모니터링 데이터 요청"
      },
      {
        user: user2,
        purpose: "sleep_duration_tracking", 
        description: "삼성이 사용자2에게 수면 시간 추적 데이터 요청"
      },
      {
        user: user3,
        purpose: "sleep_stage_analysis",
        description: "삼성이 사용자3에게 수면 단계 분석 데이터 요청"
      }
    ];

    const samsungOrgHash = hashWalletAddress(org1.address);
    
    for (let i = 0; i < samsungRequests.length; i++) {
      const request = samsungRequests[i];
      
      console.log(`📋 Samsung 요청 ${i + 1}:`);
      console.log(`   🏢 조직: samsung`);
      console.log(`   👤 대상 사용자: ${request.user.address.slice(0, 10)}...`);
      console.log(`   📝 목적: ${request.purpose}`);
      
      try {
        // 5. 실제 컨트랙트 호출
        console.log(`   🔗 컨트랙트 호출 중...`);
        const tx = await accessManagement.connect(org1).saveRequest(
          request.user.address,
          request.purpose,
          "samsung"  // organizationName
        );
        
        // 6. 트랜잭션 완료 대기
        const receipt = await tx.wait();
        const requestId = i + 1;
        
        console.log(`   ✅ 트랜잭션 성공: ${tx.hash}`);
        console.log(`   🆔 Request ID: ${requestId}`);
        console.log(`   ⛽ 가스 사용량: ${receipt.gasUsed.toString()}`);
        
        // 7. Samsung 조직 인덱스에 저장 (samsung_575a3a49 형태로)
        await indexSamsungData(
          indexingClient,
          receipt,
          request,
          samsungOrgHash,
          contractAddress
        );
        
        // 트랜잭션 간격
        await new Promise(resolve => setTimeout(resolve, 1000));
        
      } catch (error) {
        console.error(`   ❌ 트랜잭션 실패: ${error.message}\n`);
      }
    }
    
    console.log('🎉 Samsung 데이터 생성 완료!');
    console.log(`📊 생성된 데이터: samsung_${samsungOrgHash} 인덱스에 3개 트랜잭션 저장`);
    
  } catch (error) {
    console.error(`❌ Samsung 데이터 생성 중 오류 발생: ${error.message}`);
  } finally {
    indexingClient.close();
  }
}

// Samsung 조직 인덱스에 데이터 저장
async function indexSamsungData(indexingClient, receipt, request, orgHash, contractAddress) {
  try {
    const txId = receipt.transactionHash;
    
    console.log(`   🔍 Samsung 인덱싱 시작: ${txId}`);
    
    // Samsung 조직 인덱스에 저장 (기존 코드 구조 참고)
    const samsungRequest = {
      IndexID: `samsung_${orgHash}`,  // samsung_575a3a49 형태
      BcList: [{
        TxId: txId,
        KeySize: 64,
        KeyCol: 'IndexableData',  // 중요: ColName과 일치해야 함
        IndexableData: {
          TxId: txId,
          ContractAddress: contractAddress,
          EventName: 'AccessRequestsSaved',
          Timestamp: new Date().toISOString(),
          BlockNumber: receipt.blockNumber,
          DynamicFields: {
            "organizationName": "samsung",  // 검색 키로 사용됨
            "targetUserId": request.user.address,
            "requestType": request.purpose,
            "description": request.description,
            "timestamp": new Date().toISOString()
          },
          SchemaVersion: "1.0"
        }
      }],
      ColName: 'IndexableData',  // 중요: 반드시 설정해야 함
      ColIndex: `samsung_${orgHash}`,
      FilePath: `data/hardhat-local/samsung_${orgHash}.bf`,
      Network: 'hardhat-local'  // hardhat-local로 설정
    };

    console.log(`   📝 인덱싱 요청 구조:`);
    console.log(`      IndexID: ${samsungRequest.IndexID}`);
    console.log(`      ColName: ${samsungRequest.ColName}`);
    console.log(`      Network: ${samsungRequest.Network}`);
    console.log(`      TxId: ${txId}`);
    console.log(`      OrganizationName: ${samsungRequest.BcList[0].IndexableData.DynamicFields.organizationName}`);
    
    await indexingClient.insertData(samsungRequest);
    console.log(`   ✅ Samsung 인덱스 저장 성공\n`);
    
  } catch (error) {
    console.error(`   ❌ Samsung 인덱싱 실패: ${error.message}`);
  }
}

// 메인 실행
if (require.main === module) {
  createSamsungData().catch(console.error);
}

module.exports = { createSamsungData };
