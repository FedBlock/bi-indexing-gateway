const { ethers } = require("hardhat");
const path = require('path');
const IndexingClient = require('../../indexing-client-package/lib/indexing-client');

/**
 * 100개 데이터 대량 삽입 스크립트 (Hardhat 환경)
 * 사용법: npx hardhat run insert-bulk-data.js --network [hardhat|monad|fabric]
 * 예시: npx hardhat run insert-bulk-data.js --network hardhat
 */

// hardhat 네트워크 설정 정보
function getNetworkConfig(network) {
  // hardhat만 지원
  if (network !== 'hardhat') {
    throw new Error('현재 hardhat 네트워크만 지원됩니다.');
  }
  
  return {
    IndexID: 'samsung_001',  // 조직별 인덱스 ID
    KeyCol: 'IndexableData',
    FilePath: 'data/hardhat/samsung_001.bf',  // 타임스탬프 제거
    Network: 'hardhat',
    DataType: 'IndexableData'
  };
}

// hardhat 네트워크 정보 가져오기
function getNetworkInfo() {
  // hardhat만 지원
  const network = 'hardhat';
  const hardhatNetwork = 'hardhat';
  
  console.log(`\n🌐 Hardhat 네트워크: ${hardhatNetwork}`);
  console.log(`📋 자동 설정: network=${network}`);
  console.log(`📋 100개 데이터 대량 삽입 시작...`);
  
  return { network, hardhatNetwork };
}



// 데이터 크기 계산 함수
function calculateKeySize(data, keyCol) {
  if (keyCol === 'IndexableData') {
    return data.OrganizationName ? data.OrganizationName.length : 32;
  } else if (keyCol === 'Speed') {
    return data.toString().length;
  }
  return 32;
}

// 인덱스 존재 확인 함수
async function ensureIndexExists(indexingClient, network, config, actualKeySize) {
  try {
    console.log(`\n🔍 인덱스 존재 여부 확인: ${config.IndexID}`);
    
    const existingInfo = await indexingClient.getIndexInfo({
      IndexID: config.IndexID,
      IndexName: `${network.toUpperCase()} Network - Samsung Index`,
      KeyCol: config.KeyCol,
      FilePath: config.FilePath,
      KeySize: actualKeySize
    });
    
    if (existingInfo.ResponseCode === 200) {
      console.log(`✅ 인덱스가 이미 존재함: ${existingInfo.ResponseMessage}`);
      return true;
    } else if (existingInfo.ResponseCode === 500 && existingInfo.ResponseMessage.includes('already exists')) {
      console.log(`✅ 인덱스가 이미 존재함: ${existingInfo.ResponseMessage}`);
      return true;
    } else {
      console.log(`⚠️  인덱스가 존재하지 않음, 새로 생성...`);
      return false;
    }
  } catch (error) {
    console.log(`⚠️  인덱스 확인 실패: ${error.message}`);
    return false;
  }
}

// 100개 데이터 대량 삽입
async function insertBulkData(network, config) {
  console.log(`\n🚀 ${network.toUpperCase()} 네트워크 - 100개 데이터 대량 삽입 시작...`);
  
  try {
    // 1. Hardhat 네트워크 연결 및 컨트랙트 배포
    console.log(`\n🔗 1️⃣ Hardhat 네트워크 연결 중...`);
    
    const AccessManagement = await ethers.getContractFactory("AccessManagement");
    let accessManagement;
    
    try {
      // 이미 배포된 컨트랙트 주소 확인
      const deploymentInfo = require('../../deployment.json');
      accessManagement = AccessManagement.attach(deploymentInfo.contractAddress);
      console.log(`✅ 기존 컨트랙트 연결: ${deploymentInfo.contractAddress}`);
    } catch (error) {
      console.log(`📝 새로 컨트랙트 배포 중...`);
      accessManagement = await AccessManagement.deploy();
      await accessManagement.waitForDeployment();
      
      const address = await accessManagement.getAddress();
      console.log(`✅ 새 컨트랙트 배포 완료: ${address}`);
      
      // 배포 정보 저장
      const fs = require('fs');
      const deploymentInfo = {
        contractAddress: address,
        network: 'hardhat',
        deployedAt: new Date().toISOString()
      };
      fs.writeFileSync('deployment.json', JSON.stringify(deploymentInfo, null, 2));
    }
    
    // 2. 100개 트랜잭션 생성 및 전송
    console.log(`\n📝 2️⃣ 100개 트랜잭션 생성 및 전송 중...`);
    
    const [signer] = await ethers.getSigners();
    const resourceOwner = await signer.getAddress();
    const basePurpose = 'Bulk indexing test';
    const baseOrganization = 'samsung';
    
    console.log(`📊 기본 설정:`);
    console.log(`   Resource Owner: ${resourceOwner}`);
    console.log(`   Base Purpose: ${basePurpose}`);
    console.log(`   Base Organization: ${baseOrganization}`);
    
    const transactions = [];
    
    console.log(`🚀 100개 트랜잭션 시작...`);
    
    for (let i = 1; i <= 30; i++) {
      const purpose = `${basePurpose} #${i}`;
      const organizationName = `${baseOrganization}_${i.toString().padStart(3, '0')}`;
      
      console.log(`📝 ${i}/100 트랜잭션 생성 중: ${organizationName}`);
      
      try {
        // saveRequest 함수 호출 (실제 블록체인 트랜잭션)
        const tx = await accessManagement.saveRequest(resourceOwner, purpose, organizationName);
        console.log(`   🔗 트랜잭션 전송됨: ${tx.hash}`);
        
        // 트랜잭션 완료 대기
        const receipt = await tx.wait();
        console.log(`   ✅ 트랜잭션 완료! Block: ${receipt.blockNumber}, Gas: ${receipt.gasUsed}`);
        
        const txInfo = {
          index: i,
          hash: tx.hash,
          block: receipt.blockNumber,
          gas: receipt.gasUsed,
          organization: organizationName,
          purpose: purpose,
          receipt: receipt,
          resourceOwner: resourceOwner
        };
        
        transactions.push(txInfo);
        
        if (i % 10 === 0) {
          console.log(`   🎯 ${i}/100 완료 (${Math.round(i/100*100)}%)`);
        }
        
      } catch (error) {
        console.error(`❌ ${i}번째 트랜잭션 실패: ${error.message}`);
        break;
      }
    }
    
    console.log(`\n📊 트랜잭션 생성 완료: ${transactions.length}개`);
    
    // 3. idxmngr에 대량 인덱싱 요청 전송
    console.log(`\n📊 3️⃣ idxmngr에 대량 인덱싱 요청 전송 중...`);
    
    const indexingClient = new IndexingClient({
      serverAddr: 'localhost:50052',
      protoPath: path.join(process.cwd(), '../idxmngr-go/protos/index_manager.proto')
    });

    try {
      // 연결 완료 대기
      await new Promise(resolve => setTimeout(resolve, 1000));
      
      // 인덱스 존재 여부 확인
      const indexExists = await ensureIndexExists(indexingClient, network, config, 32);
      if (!indexExists) {
        console.log(`❌ 인덱스가 존재하지 않음: ${config.IndexID}`);
        console.log(`   먼저 인덱스를 생성해주세요: node create-index-new.js --cmd ${network}`);
        return null;
      }
      
      // 단건 처리: 각 트랜잭션을 개별적으로 처리
      const failedTransactions = []; // 실패한 트랜잭션 추적
      const successfulTransactions = []; // 성공한 트랜잭션 추적
      
      for (let i = 0; i < transactions.length; i++) {
        const tx = transactions[i];
        const txNumber = i + 1;
        
        console.log(`\n🔍 트랜잭션 ${txNumber}/${transactions.length} 처리 중...`);
        console.log(`   📋 ${tx.organization} (${tx.hash})`);
        
        try {
          // 1. 중복 체크: 이미 인덱싱된 트랜잭션인지 확인
          console.log(`   🔍 중복 체크 중...`);
          const searchRequest = {
            IndexID: config.IndexID,
            Field: config.KeyCol,
            Value: tx.organization,
            ComOp: 'Eq'
          };
          
          const existingData = await indexingClient.searchData(searchRequest);
          const isDuplicate = existingData.IdxData && 
            existingData.IdxData.some(data => data === tx.hash);
          
          if (isDuplicate) {
            console.log(`     ⚠️  중복 트랜잭션 건너뜀: ${tx.organization} (${tx.hash})`);
            continue;
          }
          
          console.log(`     ✅ 새 트랜잭션 확인됨`);
          
          // 디버깅: 데이터 구조 확인
          console.log(`   📋 데이터 확인:`, {
            organization: tx.organization,
            purpose: tx.purpose,
            resourceOwner: tx.resourceOwner
          });
          
          // 2. 단건 데이터 삽입
          const insertRequest = {
            IndexID: config.IndexID,
            BcList: [{
              TxId: tx.hash,
              KeyCol: config.KeyCol,
              IndexableData: {
                TxId: tx.hash,
                ContractAddress: await accessManagement.getAddress(),
                EventName: "saveRequest",
                Timestamp: new Date().toISOString(),
                BlockNumber: tx.receipt.blockNumber,
                DynamicFields: {
                  "organizationName": tx.organization,
                  "purpose": tx.purpose,
                  "resourceOwner": tx.resourceOwner
                },
                SchemaVersion: "1.0"
              }
            }],
            ColName: config.KeyCol,
            ColIndex: config.IndexID,  // 핵심: ColIndex 필드 추가!
            TxId: tx.hash,
            FilePath: config.FilePath,
            Network: config.Network
          };

          console.log(`   📤 IndexingClient로 단건 데이터 전송 중...`);
          
          // 디버깅: 전송할 데이터 구조 확인
          console.log(`   📤 전송할 IndexableData:`, JSON.stringify(insertRequest.BcList[0].IndexableData, null, 2));
          
          // 데이터 삽입
          await indexingClient.insertData(insertRequest);
          console.log(`   ✅ 트랜잭션 ${txNumber} 인덱싱 성공!`);
          
          successfulTransactions.push({
            index: i,
            number: txNumber,
            organization: tx.organization,
            hash: tx.hash
          });
          
          // 성공 후 즉시 다음 트랜잭션으로 진행
          console.log(`   🚀 다음 트랜잭션으로 진행...`);
          
        } catch (error) {
          console.log(`   ❌ 트랜잭션 ${txNumber} 인덱싱 실패: ${error.message}`);
          
          failedTransactions.push({
            index: i,
            number: txNumber,
            organization: tx.organization,
            hash: tx.hash,
            error: error.message
          });
          
          // 실패한 경우에도 계속 진행
          console.log(`   ⚠️  다음 트랜잭션으로 계속 진행...`);
        }
        
        // 트랜잭션 간 간격 (블록체인 처리 시간 고려)
        if (i < transactions.length - 1) {
          console.log(`   ⏳ 다음 트랜잭션 대기 중... (1초)`);
          await new Promise(resolve => setTimeout(resolve, 1000));
        }
      }
      
      // 결과 요약
      console.log(`\n📊 === 처리 결과 요약 ===`);
      console.log(`✅ 성공: ${successfulTransactions.length}개`);
      console.log(`❌ 실패: ${failedTransactions.length}개`);
      console.log(`📋 총 처리: ${transactions.length}개`);
      
      // 서버에서 자동으로 config.yaml의 blocknum을 업데이트합니다
      console.log(`\n📝 서버에서 자동으로 config.yaml의 blocknum을 업데이트합니다.`);
      
      if (failedTransactions.length > 0) {
        console.log(`\n❌ 실패한 트랜잭션 목록:`);
        failedTransactions.forEach(failed => {
          console.log(`   ${failed.number}. ${failed.organization} (${failed.hash})`);
          console.log(`      위치: ${failed.index}, 오류: ${failed.error}`);
        });
        
        console.log(`\n💡 실패한 트랜잭션 재처리 방법:`);
        console.log(`   - 실패한 위치: ${failedTransactions.map(f => f.index).join(', ')}`);
        console.log(`   - 재실행 시 해당 위치부터 처리 가능`);
      }
      
      console.log(`✅ 모든 트랜잭션 인덱싱 완료!`);
      
    } catch (error) {
      console.error(`❌ IndexingClient 인덱싱 요청 실패: ${error.message}`);
      throw error;
    } finally {
      indexingClient.close();
    }

    console.log(`✅ idxmngr 대량 인덱싱 요청 전송 완료!`);
    console.log(`   Network: ${config.Network}`);
    console.log(`   IndexID: ${config.IndexID}`);
    console.log(`   FilePath: ${config.FilePath}`);
    console.log(`   총 트랜잭션: ${transactions.length}개`);

    return {
      totalTransactions: transactions.length,
      transactions: transactions,
      indexData: {
        network: config.Network,
        indexID: config.IndexID,
        filePath: config.FilePath
      }
    };

  } catch (error) {
    console.error(`❌ ${network} 네트워크 대량 데이터 삽입 실패: ${error.message}`);
    throw error;
  }
}

// 메인 실행 함수
async function main() {
  try {
    const { network, hardhatNetwork } = getNetworkInfo();
    
    console.log(`\n🚀 === ${network.toUpperCase()} 네트워크 100개 데이터 대량 삽입 시작 ===`);
    
    const config = getNetworkConfig(network);
    
    console.log(`\n📋 사용할 인덱스 정보:`);
    console.log(`   IndexID: ${config.IndexID}`);
    console.log(`   FilePath: ${config.FilePath}`);
    console.log(`   Network: ${config.Network}`);
    
    let result;
    if (network === 'fabric') {
      console.log(`\n⚠️  Fabric 네트워크는 PVD 데이터를 사용합니다.`);
      result = await insertBulkData(network, config);
    } else {
      result = await insertBulkData(network, config);
    }
    
    if (result) {
      console.log(`\n🎉 ${network.toUpperCase()} 네트워크 - 100개 데이터 대량 삽입 성공!`);
      console.log(`   총 트랜잭션: ${result.totalTransactions}개`);
      console.log(`   Network: ${result.indexData.network}`);
      console.log(`   IndexID: ${result.indexData.indexID}`);
      console.log(`   FilePath: ${result.indexData.filePath}`);
      
      console.log(`\n📋 다음 단계: 대량 데이터 검증 테스트`);
      console.log(`   예시: npx hardhat run verify-bulk-data.js --network ${hardhatNetwork}`);
    } else {
      console.log(`\n⚠️  대량 데이터 삽입이 완료되지 않았습니다.`);
    }
    
  } catch (error) {
    console.error(`\n💥 100개 데이터 대량 삽입 실패: ${error.message}`);
    process.exit(1);
  }
}

// 스크립트 실행
if (require.main === module) {
  main();
}

module.exports = { insertBulkData, getNetworkConfig };