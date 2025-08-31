#!/usr/bin/env node

/**
 * 통합 데이터 삽입 스크립트
 * 사용법: npx hardhat run insert-data.js --network [hardhat_network]
 * 예시: npx hardhat run insert-data.js --network hardhat
 *       npx hardhat run insert-data.js --network monadTest
 *       npx hardhat run insert-data.js --network sepolia
 */

const { ethers } = require('hardhat');
const path = require('path');
const IndexingClient = require('../../indexing-client-package/lib/indexing-client');

// 명령행 인자 파싱 (Hardhat이 --network 자동 처리)
function parseArgs() {
  // indexName을 코드 내에서 기본값으로 설정
  const indexName = 'samsung'; // 기본값으로 samsung 사용
  
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
  console.log(`📋 자동 설정: network=${network}, index=${indexName} (기본값)`);
  
  return { network, indexName, hardhatNetwork };
}

// 네트워크별 설정 정보 (동적 파일명 생성)
function getNetworkConfig(network, indexName) {
  const configs = {
    hardhat: {
      IndexID: `001_${indexName}`,
      KeyCol: 'IndexableData',
      FilePath: `data/hardhat/${indexName}.bf`,
      Network: 'hardhat',
      DataType: 'IndexableData'
    },
    monad: {
      IndexID: `002_${indexName}`,
      KeyCol: 'IndexableData',
      FilePath: `data/monad/${indexName}.bf`,
      Network: 'monad',
      DataType: 'IndexableData'
    },
    fabric: {
      IndexID: `003_${indexName}`,
      KeyCol: 'Speed',
      FilePath: `data/fabric/${indexName}.bf`,
      Network: 'fabric',
      DataType: 'PVD'
    }
  };
  
  return configs[network];
}

// 데이터 크기 계산 함수
function calculateKeySize(data, keyCol) {
  if (keyCol === 'IndexableData') {
    // IndexableData의 경우 OrganizationName 문자열 길이
    return data.OrganizationName ? data.OrganizationName.length : 32;
  } else if (keyCol === 'Speed') {
    // Speed의 경우 숫자 문자열 길이 (보통 1-3자리)
    return data.toString().length;
  }
  return 32; // 기본값
}

// 인덱스 존재 확인 함수 (자동 생성 제거)
async function ensureIndexExists(indexingClient, network, config, actualKeySize) {
  try {
    console.log(`\n🔍 인덱스 존재 여부 확인: ${config.IndexID}`);
    
    // 인덱스 정보 확인
    const existingInfo = await indexingClient.getIndexInfo({
      IndexID: config.IndexID,
      IndexName: `${network.toUpperCase()} Network - Speed Index`,
      KeyCol: config.KeyCol,
      FilePath: config.FilePath,
      KeySize: actualKeySize
    });
    
    if (existingInfo.ResponseCode === 200) {
      console.log(`✅ 인덱스가 이미 존재함: ${existingInfo.ResponseMessage}`);
      return true;
    } else if (existingInfo.ResponseCode === 500 && existingInfo.ResponseMessage.includes('already exists')) {
      // 응답 코드 500이지만 "already exists" 메시지가 포함된 경우
      console.log(`✅ 인덱스가 이미 존재함: ${existingInfo.ResponseMessage}`);
      return true;
    } else {
      // 진짜로 인덱스가 없는 경우
      console.log(`❌ 인덱스가 존재하지 않음: ${existingInfo.ResponseMessage}`);
      console.log(`   인덱스를 먼저 생성해주세요: node create-index.js --cmd ${network}`);
      return false;
    }
  } catch (error) {
    console.log(`❌ 인덱스 정보 조회 실패: ${error.message}`);
    console.log(`   인덱스를 먼저 생성해주세요: node create-index.js --cmd ${network}`);
    return false;
  }
}

// Hardhat/Monad 네트워크용 데이터 삽입 (EVM)
async function insertEVMData(network, config) {
  console.log(`\n🚀 ${network.toUpperCase()} 네트워크 - EVM 데이터 삽입 시작...`);
  
  try {
    // 1. 네트워크별 컨트랙트 주소 설정
    let contractAddress;
    let networkConfig;
    
    switch (network) {
      case 'hardhat':
        contractAddress = "0x5FbDB2315678afecb367f032d93F642f64180aa3"; // Hardhat 로컬
        networkConfig = { name: 'hardhat' };
        break;
      case 'monad':
        contractAddress = "0x4D393E83C47AFFA1eE8eaB8eFCcBD0d2e1835F97"; // Monad 테스트넷
        networkConfig = { name: 'monad' };
        break;
      case 'sepolia':
        contractAddress = "0x1234567890123456789012345678901234567890"; // Sepolia 테스트넷
        networkConfig = { name: 'sepolia' };
        break;
      default:
        throw new Error(`지원하지 않는 네트워크: ${network}`);
    }
    
    console.log(`🌐 네트워크 설정: ${networkConfig.name}`);
    console.log(`📝 컨트랙트 주소: ${contractAddress}`);
    
    // 2. 네트워크 연결 확인
    const provider = ethers.provider;
    const networkInfo = await provider.getNetwork();
    console.log(`🔗 연결된 네트워크: ChainID ${networkInfo.chainId}`);
    
    // 3. AccessManagement 컨트랙트 가져오기
    const AccessManagement = await ethers.getContractFactory('AccessManagement');
    const accessManagement = await AccessManagement.attach(contractAddress);
    
    console.log(`📝 AccessManagement 컨트랙트 연결됨: ${accessManagement.address}`);
    
    // 4. saveRequest 함수 호출
    console.log(`\n🚀 saveRequest 함수 호출 중...`);
    const organizationName = 'samsung';
    
    const tx = await accessManagement.saveRequest(
      "0x8626f6940E2eb28930eFb4CeF49B2d1F2C9C1199", // resourceOwner
      "Business Partnership", // purpose
      organizationName
    );
    console.log(`📝 트랜잭션 전송됨: ${tx.hash}`);
    
    // 트랜잭션 완료 대기
    const receipt = await tx.wait();
    console.log(`✅ 트랜잭션 완료! Block: ${receipt.blockNumber}, Gas: ${receipt.gasUsed.toString()}`);

    // 5. 트랜잭션 해시를 직접 사용
    const txId = receipt.hash;
    console.log(`\n📊 트랜잭션 해시: ${txId}`);

    // 4. idxmngr에 인덱싱 요청 전송
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
      
      // 인덱스 존재 여부 확인 및 자동 생성
      const indexExists = await ensureIndexExists(indexingClient, network, config, actualKeySize);
      if (!indexExists) {
        throw new Error('인덱스 생성 실패');
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

// Fabric 네트워크용 데이터 삽입 (PVD)
async function insertFabricData(network, config) {
  console.log(`\n🚀 ${network.toUpperCase()} 네트워크 - Fabric PVD 데이터 삽입 시작...`);
  
  try {
    // Fabric은 PVD 데이터를 사용하므로 시뮬레이션
    const obuId = `OBU_${Date.now()}`;
    const speed = Math.floor(Math.random() * 200); // 0-200 km/h 랜덤 속도
    const txId = `FABRIC_TX_${Date.now()}`;
    
    console.log(`📊 Fabric PVD 데이터:`);
    console.log(`   OBU_ID: ${obuId}`);
    console.log(`   Speed: ${speed} km/h`);
    console.log(`   TxID: ${txId}`);

    // idxmngr에 인덱싱 요청 전송
    console.log(`\n📊 idxmngr에 인덱싱 요청 전송 중...`);
    
    const indexingClient = new IndexingClient({
      serverAddr: 'localhost:50052',
      protoPath: path.join(process.cwd(), '../idxmngr-go/protos/index_manager.proto')
    });

    try {
      // 연결 완료 대기
      await new Promise(resolve => setTimeout(resolve, 1000));
      
      // 실제 데이터 크기 계산 (Speed 값)
      const actualKeySize = calculateKeySize(speed, config.KeyCol);
      console.log(`📏 실제 데이터 크기: ${actualKeySize} (Speed: ${speed})`);
      
      // 인덱스 존재 여부 확인 및 자동 생성
      const indexExists = await ensureIndexExists(indexingClient, network, config, actualKeySize);
      if (!indexExists) {
        throw new Error('인덱스 생성 실패');
      }
      
      // InsertDatatoIdx 구조체 생성 (Fabric PVD용)
      const insertRequest = {
        IndexID: config.IndexID,
        BcList: [{
          TxId: txId,
          Pvd: {
            ObuId: obuId,
            Speed: speed
          }
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
        obuId: obuId,
        speed: speed,
        network: config.Network,
        indexID: config.IndexID
      }
    };

  } catch (error) {
    console.error(`❌ ${network} 네트워크 데이터 삽입 실패: ${error.message}`);
    throw error;
  }
}

// 메인 실행 함수
async function main() {
  try {
    const { network, indexName, hardhatNetwork } = parseArgs();
    const config = getNetworkConfig(network, indexName);
    
    // 실제 연결된 네트워크 정보 확인
    const provider = ethers.provider;
    const networkInfo = await provider.getNetwork();
    console.log(`🔗 실제 연결된 네트워크: ChainID ${networkInfo.chainId}`);
    
    console.log(`\n🚀 ${network.toUpperCase()} 네트워크 - ${indexName} 인덱스 데이터 삽입 시작...`);
    console.log(`🌐 Hardhat 네트워크: ${hardhatNetwork}`);
    
    let result;
    
    if (network === 'fabric') {
      result = await insertFabricData(network, config);
    } else {
      result = await insertEVMData(network, config);
    }
    
    console.log(`\n🎉 ${network.toUpperCase()} 네트워크 - ${indexName} 인덱스 데이터 삽입 성공!`);
    console.log(`   Tx Hash: ${result.txHash}`);
    console.log(`   Network: ${result.indexData.network}`);
    console.log(`   IndexID: ${result.indexData.indexID}`);
    console.log(`   FilePath: ${config.FilePath}`);
    
    console.log(`\n📋 다음 단계: 데이터 검증 테스트`);
    console.log(`   예시: npx hardhat run verify-data.js --network ${hardhatNetwork}`);
    
  } catch (error) {
    console.error('\n💥 데이터 삽입 실패:', error);
    process.exit(1);
  }
}

if (require.main === module) {
  main();
}

module.exports = { insertEVMData, insertFabricData, getNetworkConfig };
