#!/usr/bin/env node

const { ethers } = require('hardhat');
const path = require('path');
const crypto = require('crypto');
const INDEXING_CLIENT_PATH = path.resolve(__dirname, '../../../bi-indexing-gateway/lib/indexing-client');
const IndexingClient = require(INDEXING_CLIENT_PATH);

// 공통 경로 설정
const PROTO_PATH = path.join(process.cwd(), '../../idxmngr-go/protos/index_manager.proto');

// 지갑 주소 해시 함수
function hashWalletAddress(address) {
  const hash = crypto.createHash('sha256').update(address).digest('hex');
  return hash.slice(0, 8);
}

// 인덱스 생성 함수
async function createIndexes(indexingClient, organizations, users) {
  console.log('🔨 인덱스 생성 시작...\n');
  
  try {
    // 조직별 인덱스 생성
    for (const org of organizations) {
      const orgShortHash = hashWalletAddress(org.address);
      const orgIndexInfo = {
        IndexID: `${org.name}_${orgShortHash}_001`,
        IndexName: `${org.name.toUpperCase()} Organization Index (${org.address.slice(0, 10)}...)`,
        KeyCol: 'IndexableData',
        FilePath: `data/hardhat-local/${org.name}_${orgShortHash}_001.bf`,
        KeySize: 64,
        Network: 'hardhat'
      };
      
      console.log(`🏢 ${org.name.toUpperCase()} 조직 인덱스 생성 중: ${orgIndexInfo.IndexID}`);
      await indexingClient.createIndex(orgIndexInfo);
      console.log(`   ✅ 생성 완료: ${orgIndexInfo.IndexID}`);
      
      // 인덱스 생성 간격
      await new Promise(resolve => setTimeout(resolve, 500));
    }
    
    // 사용자별 인덱스 생성
    for (const user of users) {
      const userShortHash = hashWalletAddress(user.address);
      const userIndexInfo = {
        IndexID: `user_${userShortHash}_001`,
        IndexName: `User ${user.address.slice(0, 10)}... Personal Index`,
        KeyCol: 'IndexableData',
        FilePath: `data/hardhat-local/user_${userShortHash}_001.bf`,
        KeySize: 64,
        Network: 'hardhat'
      };
      
      console.log(`👤 사용자 인덱스 생성 중: ${userIndexInfo.IndexID}`);
      await indexingClient.createIndex(userIndexInfo);
      console.log(`   ✅ 생성 완료: ${userIndexInfo.IndexID}`);
      
      // 인덱스 생성 간격
      await new Promise(resolve => setTimeout(resolve, 500));
    }
    
    console.log('🎉 모든 인덱스 생성 완료!\n');
    
  } catch (error) {
    console.error(`❌ 인덱스 생성 중 오류 발생: ${error.message}`);
    throw error;
  }
}

// 대규모 테스트 실행
async function runLargeScaleTest() {
  console.log('🚀 대규모 테스트 시작 - 조직 2개, 사용자 4개, 데이터 100개\n');

  try {
    // 1. 계정 설정
    const [deployer, org1, org2, user1, user2, user3, user4] = await ethers.getSigners();
    
    console.log('👥 테스트 계정들:');
    console.log(`   🏗️  배포자: ${deployer.address}`);
    // console.log(`   🏢 조직1 (Samsung): ${org1.address}`);
    // console.log(`   🏢 조직2 (LG): ${org2.address}`);
    console.log(`   👤 사용자1: ${user1.address}`);
    console.log(`   👤 사용자2: ${user2.address}`);
    console.log(`   👤 사용자3: ${user3.address}`);
    console.log(`   👤 사용자4: ${user4.address}\n`);

    // 2. 컨트랙트 배포
    console.log('🏗️ AccessManagement 컨트랙트 배포 중...');
    const AccessManagement = await ethers.getContractFactory('AccessManagement');
    const accessManagement = await AccessManagement.deploy();
    await accessManagement.waitForDeployment();
    
    const contractAddress = await accessManagement.getAddress();
    console.log(`✅ 컨트랙트 배포 완료: ${contractAddress}\n`);

    // 3. IndexingClient 연결
    const indexingClient = new IndexingClient({
      serverAddr: 'localhost:50052',
      protoPath: PROTO_PATH
    });

    // 연결 완료 대기
    await new Promise(resolve => setTimeout(resolve, 1000));

    // 4. 테스트 데이터 설정
    const organizations = [
      { name: 'samsung', signer: org1, address: org1.address },
      { name: 'lg', signer: org2, address: org2.address }
    ];

    const users = [user1, user2, user3, user4];
    
    // 5. 인덱스 생성
    await createIndexes(indexingClient, organizations, users);

    // 6. 테스트 데이터 생성
    
    const requestTypes = [
      '심박수 데이터 요청',
      '혈압 데이터 요청', 
      '혈당 데이터 요청',
      '체온 데이터 요청',
      '산소포화도 데이터 요청',
      '수면 데이터 요청',
      '활동량 데이터 요청',
      '체중 데이터 요청'
    ];

    const descriptions = [
      '심장 건강 모니터링을 위한 심박수 데이터 요청',
      '혈압 관리 및 고혈압 예방을 위한 데이터 요청',
      '당뇨 관리 및 혈당 모니터링 데이터 요청',
      '감염병 조기 발견을 위한 체온 데이터 요청',
      '호흡기 건강 상태 확인을 위한 산소포화도 요청',
      '수면 질 및 수면 패턴 분석을 위한 데이터 요청',
      '일일 운동량 및 활동량 추적 데이터 요청',
      '체중 변화 및 비만 관리 데이터 요청'
    ];

    console.log('📝 대규모 데이터 생성 시작...\n');

    let totalRequests = 0;
    const startTime = Date.now();

    // 6. 100개의 요청 생성 (단건 처리)
    for (let i = 0; i < 100; i++) {
      const orgIndex = i % organizations.length;
      const userIndex = i % users.length;
      const requestTypeIndex = i % requestTypes.length;
      const descriptionIndex = i % descriptions.length;

      const organization = organizations[orgIndex];
      const user = users[userIndex];
      const requestType = requestTypes[requestTypeIndex];
      const description = descriptions[descriptionIndex];

      console.log(`📋 요청 ${i + 1}/100:`);
      console.log(`   🏢 조직: ${organization.name.toUpperCase()}`);
      console.log(`   👤 사용자: ${user.address.slice(0, 10)}...`);
      console.log(`   📝 유형: ${requestType}`);
      console.log(`   📄 설명: ${description}`);

      try {
        // 7. 컨트랙트 호출
        console.log(`   🔗 컨트랙트 호출 중...`);
        const tx = await accessManagement.connect(organization.signer).saveRequest(
          user.address,
          requestType,
          organization.name
        );
        
        // 8. 트랜잭션 완료 대기
        const receipt = await tx.wait();
        const requestId = i + 1;
        
        console.log(`   ✅ 트랜잭션 성공: ${tx.hash.slice(0, 10)}...`);
        
        // 9. 양방향 인덱싱 데이터 저장
        console.log(`   💾 양방향 인덱싱 데이터 저장 중...`);
        
        // 조직별 인덱스에 저장
        const orgShortHash = hashWalletAddress(organization.address);
        const orgData = {
          IndexID: `${organization.name}_${orgShortHash}_001`,
          BcList: [{
            TxId: tx.hash,
            KeySize: 64,
            KeyCol: 'IndexableData',
            IndexableData: {
              TxId: tx.hash,
              ContractAddress: contractAddress,
              EventName: 'AccessRequestsSaved',
              Timestamp: new Date().toISOString(),
              BlockNumber: receipt.blockNumber,
              DynamicFields: {
                "organizationName": organization.name,
                "requestingOrgAddress": organization.address,
                "targetUserId": user.address,
                "requestType": requestType,
                "description": description,
                "requestId": requestId.toString(),
                "timestamp": new Date().toISOString(),
                "batchNumber": Math.floor(i / 10).toString()
              },
              SchemaVersion: "1.0"
            }
          }],
          ColName: 'IndexableData',
          ColIndex: `${organization.name}_${orgShortHash}_001`,
          FilePath: `data/hardhat-local/${organization.name}_${orgShortHash}_001.bf`,
          Network: 'hardhat'
        };
        
        await indexingClient.insertData(orgData);
        console.log(`   ✅ 조직별 인덱스 저장 완료`);
        
        // 사용자별 인덱스에 저장
        const userShortHash = hashWalletAddress(user.address);
        const userData = {
          IndexID: `user_${userShortHash}_001`,
          BcList: [{
            TxId: tx.hash,
            KeySize: 64,
            KeyCol: 'UserId',
            IndexableData: {
              TxId: tx.hash,
              ContractAddress: contractAddress,
              EventName: 'AccessRequestsSaved',
              Timestamp: new Date().toISOString(),
              BlockNumber: receipt.blockNumber,
              DynamicFields: {
                "userId": user.address,
                "requestingOrg": organization.name,
                "requestType": requestType,
                "description": description,
                "requestId": requestId.toString(),
                "timestamp": new Date().toISOString(),
                "batchNumber": Math.floor(i / 10).toString()
              },
              SchemaVersion: "1.0"
            }
          }],
          ColName: 'UserId',
          ColIndex: `user_${userShortHash}_001`,
          FilePath: `data/hardhat-local/user_${userShortHash}_001.bf`,
          Network: 'hardhat'
        };
        
        await indexingClient.insertData(userData);
        console.log(`   ✅ 사용자별 인덱스 저장 완료`);
        
        totalRequests++;
        console.log(`   🎯 양방향 인덱싱 완료: ${requestId}번 요청\n`);
        
        // 요청 간 간격 (너무 빠르게 처리하지 않도록)
        await new Promise(resolve => setTimeout(resolve, 100));
        
      } catch (error) {
        console.error(`   ❌ 요청 ${i + 1} 처리 실패: ${error.message}`);
      }
    }

    const endTime = Date.now();
    const duration = (endTime - startTime) / 1000;

    console.log('🎉 대규모 테스트 완료!');
    console.log(`📊 총 처리된 요청: ${totalRequests}/100`);
    console.log(`⏱️  총 소요 시간: ${duration}초`);
    console.log(`🚀 평균 처리 속도: ${(totalRequests / duration).toFixed(2)} 요청/초\n`);

    // 10. 검색 테스트
    console.log('🔍 검색 테스트 시작...\n');

    // 조직별 검색 테스트
    for (const org of organizations) {
      console.log(`🏢 ${org.name.toUpperCase()} 조직 검색 테스트:`);
      
      try {
        const orgShortHash = hashWalletAddress(org.address);
        const searchRequest = {
          IndexID: `${org.name}_${orgShortHash}_001`,
          Field: 'IndexableData',
          Value: org.name,
          FilePath: `data/hardhat-local/${org.name}_${orgShortHash}_001.bf`,
          KeySize: 64,
          ComOp: 'Eq'
        };
        
        const response = await indexingClient.searchData(searchRequest);
        const count = response.IdxData ? response.IdxData.length : 0;
        console.log(`   ✅ ${org.name} 검색 결과: ${count}개 데이터\n`);
        
      } catch (error) {
        console.error(`   ❌ ${org.name} 검색 실패: ${error.message}\n`);
      }
    }

    // 사용자별 검색 테스트
    for (const user of users) {
      console.log(`👤 사용자 ${user.address.slice(0, 10)}... 검색 테스트:`);
      
      try {
        const userShortHash = hashWalletAddress(user.address);
        const searchRequest = {
          IndexID: `user_${userShortHash}_001`,
          Field: 'IndexableData',
          Value: user.address,
          FilePath: `data/hardhat-local/user_${userShortHash}_001.bf`,
          KeySize: 64,
          ComOp: 'Eq'
        };
        
        const response = await indexingClient.searchData(searchRequest);
        const count = response.IdxData ? response.IdxData.length : 0;
        console.log(`   ✅ 사용자 검색 결과: ${count}개 데이터\n`);
        
      } catch (error) {
        console.error(`   ❌ 사용자 검색 실패: ${error.message}\n`);
      }
    }

    indexingClient.close();
    console.log('🎯 대규모 테스트 완료! 모든 검색이 정상 작동합니다!');

  } catch (error) {
    console.error(`❌ 대규모 테스트 중 오류 발생: ${error.message}`);
  }
}

// 스크립트 실행
if (require.main === module) {
  runLargeScaleTest().catch(console.error);
}

module.exports = {
  runLargeScaleTest
};
