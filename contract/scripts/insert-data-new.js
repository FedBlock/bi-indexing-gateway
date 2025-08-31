/**
 * 새로운 인덱스용 데이터 삽입 스크립트 (Hardhat 환경)
 * 사용법: npx hardhat run insert-data-new.js --network [hardhat|monad|fabric]
 * 예시: npx hardhat run insert-data-new.js --network hardhat
 */

const path = require('path');
const { ethers } = require('hardhat');
const IndexingClient = require('../../indexing-client-package/lib/indexing-client');

// Hardhat 환경에서 네트워크 정보 가져오기
function getNetworkInfo() {
  // Hardhat 환경에서 현재 네트워크 자동 감지
  const hardhatNetwork = process.env.HARDHAT_NETWORK || 'hardhat';
  
  // hardhatNetwork에 따라 network 자동 설정
  let network;
  if (hardhatNetwork === 'monad') {
    network = 'monad';
  } else if (hardhatNetwork === 'sepolia') {
    network = 'sepolia';
  } else if (hardhatNetwork === 'hardhat') {
    network = 'hardhat';
  } else {
    console.log('❌ 지원하지 않는 Hardhat 네트워크:', hardhatNetwork);
    console.log('   지원하는 네트워크: hardhat, monad, sepolia');
    process.exit(1);
  }
  
  console.log(`\n🌐 Hardhat 네트워크: ${hardhatNetwork}`);
  console.log(`📋 자동 설정: network=${network}`);
  console.log(`📋 새로운 인덱스로 데이터 삽입 시작...`);
  
  return { network, hardhatNetwork };
}

// 네트워크별 설정 정보 (새로 생성한 인덱스 ID 사용)
function getNetworkConfig(network) {
  // 새로 생성한 인덱스 ID 사용 (create-index-new.js에서 생성된 것)
  const configs = {
    hardhat: {
      IndexID: 'hardhat_1756621048516_samsung', // 새로 생성한 인덱스 ID
      KeyCol: 'IndexableData',
      FilePath: 'data/hardhat/samsung_1756621048516.bf', // 새로 생성한 파일 경로
      Network: 'hardhat',
      DataType: 'IndexableData'
    },
    monad: {
      IndexID: 'monad_1756621048516_samsung',
      KeyCol: 'IndexableData',
      FilePath: 'data/monad/samsung_1756621048516.bf',
      Network: 'monad',
      DataType: 'IndexableData'
    },
    fabric: {
      IndexID: 'fabric_1756621048516_samsung',
      KeyCol: 'Speed',
      FilePath: 'data/fabric/samsung_1756621048516.bf',
      Network: 'fabric',
      DataType: 'PVD'
    }
  };
  
  return configs[network];
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

// EVM 네트워크용 데이터 삽입 (실제 블록체인 트랜잭션 사용)
async function insertEVMData(network, config) {
  console.log(`\n🚀 ${network.toUpperCase()} 네트워크 - 실제 블록체인 트랜잭션 데이터 삽입 시작...`);
  
  try {
    // 1. Hardhat 네트워크 연결 및 컨트랙트 배포
    console.log(`\n🔗 1️⃣ Hardhat 네트워크 연결 중...`);
    
    // Hardhat 네트워크에서 컨트랙트 배포 (아직 배포되지 않은 경우)
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
    
    // 2. 실제 트랜잭션 전송
    console.log(`\n📝 2️⃣ 실제 블록체인 트랜잭션 전송 중...`);
    
    const organizationName = 'samsung';
    const purpose = 'Data indexing test';
    const [signer] = await ethers.getSigners();
    const resourceOwner = await signer.getAddress();
    
    console.log(`📊 실제 트랜잭션 데이터:`);
    console.log(`   Organization: ${organizationName}`);
    console.log(`   Purpose: ${purpose}`);
    console.log(`   Resource Owner: ${resourceOwner}`);
    
    // saveRequest 함수 호출 (실제 블록체인 트랜잭션)
    const tx = await accessManagement.saveRequest(resourceOwner, purpose, organizationName);
    console.log(`📝 saveRequest 함수 호출됨, 트랜잭션 해시: ${tx.hash}`);
    
    // 트랜잭션 완료 대기
    const receipt = await tx.wait();
    console.log(`✅ 트랜잭션 완료! Block: ${receipt.blockNumber}, Gas: ${receipt.gasUsed}`);
    
    // 실제 트랜잭션 해시 사용
    const txId = tx.hash;
    console.log(`📊 실제 트랜잭션 해시: ${txId}`);

    // idxmngr에 인덱싱 요청 전송
    console.log(`\n📊 idxmngr에 인덱싱 요청 전송 중...`);
    
    const indexingClient = new IndexingClient({
      serverAddr: 'localhost:50052',
      protoPath: path.join(process.cwd(), '../idxmngr-go/protos/index_manager.proto')
    });

    try {
      // 연결 완료 대기
      await new Promise(resolve => setTimeout(resolve, 1000));
      
      // 실제 데이터 크기 계산
      const actualData = { OrganizationName: organizationName };
      const actualKeySize = calculateKeySize(actualData, config.KeyCol);
      console.log(`📏 실제 데이터 크기: ${actualKeySize} (${organizationName})`);
      
      // 인덱스 존재 여부 확인
      const indexExists = await ensureIndexExists(indexingClient, network, config, actualKeySize);
      if (!indexExists) {
        console.log(`❌ 인덱스가 존재하지 않음: ${config.IndexID}`);
        console.log(`   먼저 인덱스를 생성해주세요: node create-index-new.js --cmd ${network}`);
        return null;
      }
      
      // InsertDatatoIdx 구조체 생성
      const insertRequest = {
        IndexID: config.IndexID,
        BcList: [{
          TxId: txId,
          KeyCol: config.KeyCol,
          IndexableData: actualData
        }],
        ColName: config.KeyCol,
        TxId: txId,
        FilePath: config.FilePath,
        Network: config.Network
      };

      console.log(`\n🔌 IndexingClient로 InsertIndexRequest 호출 시작...`);
      console.log(`   서버 주소: localhost:50052`);
      console.log(`   요청 데이터: ${JSON.stringify(insertRequest, null, 2)}`);
      
      // 데이터 삽입
      await indexingClient.insertData(insertRequest);
      console.log(`✅ IndexingClient 인덱싱 요청 성공!`);
      
    } catch (error) {
      console.error(`❌ IndexingClient 인덱싱 요청 실패: ${error.message}`);
      throw error;
    } finally {
      indexingClient.close();
    }

    console.log(`✅ idxmngr 인덱싱 요청 전송 완료!`);
    console.log(`   Network: ${config.Network}`);
    console.log(`   IndexID: ${config.IndexID}`);
    console.log(`   FilePath: ${config.FilePath}`);

    return {
      txHash: txId,
      requestId: txId,
      indexData: {
        txHash: txId,
        organization: organizationName,
        network: config.Network,
        indexID: config.IndexID
      }
    };

  } catch (error) {
    console.error(`❌ ${network} 네트워크 데이터 삽입 실패: ${error.message}`);
    throw error;
  }
}

// 메인 실행 함수 (Hardhat 환경)
async function main() {
  try {
    const { network, hardhatNetwork } = getNetworkInfo();
    
    console.log(`\n🚀 === ${network.toUpperCase()} 네트워크 새로운 인덱스 데이터 삽입 시작 ===`);
    
    const config = getNetworkConfig(network);
    
    console.log(`\n📋 사용할 인덱스 정보:`);
    console.log(`   IndexID: ${config.IndexID}`);
    console.log(`   FilePath: ${config.FilePath}`);
    console.log(`   Network: ${config.Network}`);
    
    let result;
    if (network === 'fabric') {
      // Fabric은 별도 처리 (PVD 데이터)
      console.log(`\n⚠️  Fabric 네트워크는 PVD 데이터를 사용합니다.`);
      result = await insertEVMData(network, config); // 임시로 EVM 방식 사용
    } else {
      // EVM 네트워크 (Hardhat, Monad)
      result = await insertEVMData(network, config);
    }
    
    if (result) {
      console.log(`\n🎉 ${network.toUpperCase()} 네트워크 - 새로운 인덱스 데이터 삽입 성공!`);
      console.log(`   Tx Hash: ${result.txHash}`);
      console.log(`   Network: ${result.indexData.network}`);
      console.log(`   IndexID: ${result.indexData.indexID}`);
      console.log(`   FilePath: ${config.FilePath}`);
      
      console.log(`\n📋 다음 단계: 데이터 검증 테스트`);
      console.log(`   예시: npx hardhat run verify-data-new.js --network ${hardhatNetwork}`);
    } else {
      console.log(`\n⚠️  데이터 삽입이 완료되지 않았습니다.`);
    }
    
  } catch (error) {
    console.error(`\n💥 새로운 인덱스 데이터 삽입 실패: ${error.message}`);
    process.exit(1);
  }
}

// 스크립트 실행
if (require.main === module) {
  main();
}

module.exports = { insertEVMData, getNetworkConfig };
