#!/usr/bin/env node

const { ethers } = require('hardhat');
const path = require('path');
const crypto = require('crypto');
const fs = require('fs');
const yaml = require('js-yaml');
const IndexingClient = require('../../indexing-client-package/lib/indexing-client');
const hre = require('hardhat');
const { runLargeScaleTest } = require('./large-scale-test');

// 공통 경로 설정
const PROTO_PATH = path.join(process.cwd(), '../../idxmngr-go/protos/index_manager.proto');
const CONFIG_PATH = path.join(process.cwd(), '../../idxmngr-go/config.yaml');
const NETWORK_CONFIG_PATH = path.join(process.cwd(), '../../idxmngr-go/config/network_config.yaml');

// 명령어 플래그 파싱
const args = process.argv.slice(2);
const cmd = args.find(arg => arg.startsWith('-cmd='))?.split('=')[1] || 'help';
const network = args.find(arg => arg.startsWith('-network='))?.split('=')[1] || 'hardhat';
const type = args.find(arg => arg.startsWith('-type='))?.split('=')[1] || '';
const value = args.find(arg => arg.startsWith('-value='))?.split('=')[1] || '';
const contractAddress = args.find(arg => arg.startsWith('-contract='))?.split('=')[1] || '';
const yamlFlag = args.find(arg => arg.startsWith('-yaml='))?.split('=')[1] || '';

// 지갑 주소 해시 함수
function hashWalletAddress(address) {
  const hash = crypto.createHash('sha256').update(address).digest('hex');
  return hash.slice(0, 8);
}

// 네트워크별 컨트랙트 배포
async function deployContract(network) {
  try {
    console.log(`🚀 ${network} 네트워크에 컨트랙트 배포 시작...`);
    
    let provider, signer;
    
    if (network === 'hardhat') {
      // Hardhat 네트워크 사용
      [signer] = await ethers.getSigners();
      provider = ethers.provider;
      console.log(`📝 배포자 주소: ${signer.address}`);
      console.log(`🔗 네트워크: Hardhat Local (Chain ID: 1337)`);
    } else {
      // 외부 네트워크 사용 (Monad 등)
      const networkConfig = hre.config.networks[network];
      if (!networkConfig) {
        throw new Error(`hardhat.config.js에 ${network} 네트워크 설정이 없습니다.`);
      }
      
      provider = new ethers.JsonRpcProvider(networkConfig.url);
      signer = new ethers.Wallet(networkConfig.accounts[0], provider);
      
      console.log(`📝 배포자 주소: ${signer.address}`);
      console.log(`🔗 네트워크: ${network} (Chain ID: ${networkConfig.chainId})`);
    }
    
    // 컨트랙트 팩토리 생성
    const AccessManagement = await ethers.getContractFactory('AccessManagement', signer);
    
    // 컨트랙트 배포
    const contract = await AccessManagement.deploy();
    await contract.waitForDeployment();
    
    const contractAddress = await contract.getAddress();
    console.log(`✅ AccessManagement 컨트랙트 배포 완료!`);
    console.log(`📍 컨트랙트 주소: ${contractAddress}`);
    
    // 네트워크 설정 자동 업데이트
    console.log(`🔧 ${network} 네트워크 설정 자동 업데이트 중...`);
    await updateNetworkConfig(network, contractAddress);
    
    return contractAddress;
    
  } catch (error) {
    console.error(`❌ 컨트랙트 배포 실패: ${error.message}`);
    throw error;
  }
}





// 네트워크별 데이터 조회
async function searchData(network, dataType, searchValue) {
  try {
    console.log(`🔍 ${network} 네트워크에서 ${dataType} 데이터 조회 시작...`);
    
    const indexingClient = new IndexingClient({
      serverAddr: 'localhost:50052',
      protoPath: PROTO_PATH
    });
    
    // 연결 완료 대기
    await new Promise(resolve => setTimeout(resolve, 1000));
    
    let indexID, field, filePath;
    
    switch (dataType) {
      case 'organization':
        // 조직 검색은 주소로 검색 (samsung_해시된주소_001)
        const orgShortHash = hashWalletAddress(searchValue);
        indexID = `samsung_${orgShortHash}_001`;
        field = 'IndexableData';  // 🔥 DynamicFields → IndexableData (지원되는 필드)
        searchValue = 'samsung';   // 🔥 지갑 주소가 아닌 'samsung'으로 검색
        filePath = `data/${network}/samsung_${orgShortHash}_001.bf`;
        break;
        
      case 'user':
        // 사용자 검색도 IndexableData에서 지갑 주소로 검색
        const shortHash = hashWalletAddress(searchValue);
        indexID = `user_${shortHash}_001`;
        field = 'IndexableData';  // 🔥 DynamicFields → IndexableData
        // 🔥 지갑 주소 그대로 검색
        searchValue = searchValue;  // 원본 지갑 주소 사용
        filePath = `data/${network}/user_${shortHash}_001.bf`;
        break;
        
      case 'speed':
        indexID = `${network}_speed_001`;
        field = 'Speed';
        filePath = `data/${network}/speed.bf`;
        break;
        
      default:
        throw new Error(`지원하지 않는 데이터 타입: ${dataType}`);
    }
    
    const searchRequest = {
      IndexID: indexID,
      Field: field,
      Value: searchValue,
      FilePath: filePath,
      KeySize: 64,
      ComOp: 'Eq'
    };
    
    console.log(`🔍 검색 요청:`, searchRequest);
    
    const response = await indexingClient.searchData(searchRequest);
    console.log(`✅ 데이터 조회 완료!`);
    console.log(`📊 검색 결과:`, response);
    
    indexingClient.close();
    return response;
    
  } catch (error) {
    console.error(`❌ 데이터 조회 실패: ${error.message}`);
    throw error;
  }
}

// config.yaml 확인
async function checkConfigYaml() {
  console.log('🔍 config.yaml 직접 확인 시작\n');

  try {
    // config.yaml 파일 경로
    const configPath = CONFIG_PATH;
    
    // 파일 존재 확인
    if (!fs.existsSync(configPath)) {
      console.error(`❌ config.yaml 파일을 찾을 수 없음: ${configPath}`);
      return;
    }

    // 파일 읽기
    const configContent = fs.readFileSync(configPath, 'utf8');
    console.log('📁 config.yaml 내용:');
    console.log(configContent);
    console.log('');

    // YAML 파싱
    const config = yaml.load(configContent);
    
    if (config && config.items && Array.isArray(config.items)) {
      console.log(`✅ 인덱스 개수: ${config.items.length}개\n`);
      
      config.items.forEach((item, index) => {
        console.log(`📋 인덱스 ${index + 1}:`);
        console.log(`   🆔 IndexID: ${item.idxid || 'N/A'}`);
        console.log(`   📝 IndexName: ${item.idxname || 'N/A'}`);
        console.log(`   🔑 KeyCol: ${item.keycol || 'N/A'}`);
        console.log(`   📁 FilePath: ${item.filepath || 'N/A'}`);
        console.log(`   📏 KeySize: ${item.keysize || 'N/A'}`);
        console.log(`   📊 BlockNum: ${item.blocknum || 'N/A'}`);
        console.log(`   📈 CallCnt: ${item.callcnt || 'N/A'}`);
        console.log(`   🔑 KeyCnt: ${item.keycnt || 'N/A'}`);
        console.log(`   📊 IndexDataCnt: ${item.indexdatacnt || 'N/A'}`);
        console.log('');
      });
    } else {
      console.log('❌ config.yaml에 items 배열이 없음');
    }

    console.log('🎉 config.yaml 확인 완료!');

  } catch (error) {
    console.error(`❌ config.yaml 확인 중 오류 발생: ${error.message}`);
  }
}

// network_config.yaml 확인
async function checkNetworkConfig() {
  console.log('🔍 network_config.yaml 확인 시작\n');

  try {
    // network_config.yaml 파일 경로
    const configPath = NETWORK_CONFIG_PATH;
    
    // 파일 존재 확인
    if (!fs.existsSync(configPath)) {
      console.error(`❌ network_config.yaml 파일을 찾을 수 없음: ${configPath}`);
      return;
    }

    // 파일 읽기
    const configContent = fs.readFileSync(configPath, 'utf8');
    console.log('📁 network_config.yaml 내용:');
    console.log(configContent);
    console.log('');

    // YAML 파싱
    const config = yaml.load(configContent);
    
    if (config && config.networks) {
      console.log(`✅ 네트워크 개수: ${Object.keys(config.networks).length}개\n`);
      
      Object.entries(config.networks).forEach(([networkName, networkConfig]) => {
        console.log(`🌐 네트워크: ${networkName}`);
        console.log(`   📝 이름: ${networkConfig.network_name || 'N/A'}`);
        console.log(`   📍 컨트랙트 주소: ${networkConfig.contract_address || 'N/A'}`);
        console.log(`   📁 파일 경로: ${networkConfig.file_index_path || '자동 생성됨'}`);
        console.log('');
      });
    } else {
      console.log('❌ network_config.yaml에 networks 설정이 없음');
    }

    console.log('🎉 network_config.yaml 확인 완료!');

  } catch (error) {
    console.error(`❌ network_config.yaml 확인 중 오류 발생: ${error.message}`);
  }
}

// 네트워크 설정 업데이트
async function updateNetworkConfig(network, contractAddress) {
  console.log(`🔧 ${network} 네트워크 설정 업데이트 시작...`);
  
  try {
    if (!contractAddress) {
      throw new Error('컨트랙트 주소를 입력해주세요. (-contract=<주소>)');
    }

    // network_config.yaml 파일 경로
    const configPath = NETWORK_CONFIG_PATH;
    
    // 파일 존재 확인
    if (!fs.existsSync(configPath)) {
      console.error(`❌ network_config.yaml 파일을 찾을 수 없음: ${configPath}`);
      return;
    }

    // 기존 설정 읽기
    const configContent = fs.readFileSync(configPath, 'utf8');
    const config = yaml.load(configContent);
    
    if (!config.networks) {
      config.networks = {};
    }
    
    // 네트워크 설정 업데이트
    if (!config.networks[network]) {
      config.networks[network] = {
        network_name: network,
        contract_address: contractAddress
      };
    } else {
      config.networks[network].contract_address = contractAddress;
    }
    
    // 파일에 저장
    const updatedContent = yaml.dump(config, { indent: 2 });
    fs.writeFileSync(configPath, updatedContent, 'utf8');
    
    console.log(`✅ ${network} 네트워크 설정 업데이트 완료!`);
    console.log(`   📍 컨트랙트 주소: ${contractAddress}`);
    console.log(`   📁 설정 파일: ${configPath}`);
    
  } catch (error) {
    console.error(`❌ 네트워크 설정 업데이트 실패: ${error.message}`);
  }
}

// Samsung 조직 인덱스 생성
async function createSamsungIndex(network) {
  console.log(`🚀 ${network} 네트워크에 Samsung 조직 인덱스 생성 시작\n`);

  const indexingClient = new IndexingClient({
    serverAddr: 'localhost:50052',
    protoPath: PROTO_PATH
  });

  try {
    // 연결 완료 대기
    await new Promise(resolve => setTimeout(resolve, 1000));
    
    // 네트워크별 기본 요청자 주소 설정
    let defaultOrgAddress;
    if (network === 'monad') {
      defaultOrgAddress = "0x2630ffE517DFC9b0112317a2EC0AB4cE2a59CEb8";  // Monad 요청자
    } else {
      defaultOrgAddress = "0x70997970C51812dc3A010C7d01b50e0d17dc79C8";  // Hardhat 요청자
    }
    
    const orgShortHash = hashWalletAddress(defaultOrgAddress);
    
    const indexInfo = {
      IndexID: `samsung_${orgShortHash}_001`,
      IndexName: `Samsung Organization Index (${defaultOrgAddress.slice(0, 10)}...)`,
      KeyCol: 'IndexableData',
      FilePath: `data/${network}/samsung_${orgShortHash}_001.bf`,
      KeySize: 64,
      Network: network
    };
    
    console.log(`📋 생성할 Samsung 인덱스 정보:`);
    console.log(`   🆔 IndexID: ${indexInfo.IndexID}`);
    console.log(`   📝 IndexName: ${indexInfo.IndexName}`);
    console.log(`   🔑 KeyCol: ${indexInfo.KeyCol}`);
    console.log(`   📁 FilePath: ${indexInfo.FilePath}`);
    console.log(`   📏 KeySize: ${indexInfo.KeySize}`);
    console.log(`   🌐 Network: ${indexInfo.Network}\n`);
    
    try {
      await indexingClient.createIndex(indexInfo);
      console.log(`✅ Samsung 인덱스 생성 성공: ${indexInfo.IndexID}`);
      
    } catch (error) {
      console.error(`❌ Samsung 인덱스 생성 실패: ${error.message}`);
    }
    
  } catch (error) {
    console.error(`❌ Samsung 인덱스 생성 중 오류 발생: ${error.message}`);
  } finally {
    indexingClient.close();
  }
}

// 사용자별 인덱스 생성
async function createUserIndexes(network) {
  console.log(`🚀 ${network} 네트워크에 사용자별 인덱스 생성 시작\n`);

  const indexingClient = new IndexingClient({
    serverAddr: 'localhost:50052',
    protoPath: PROTO_PATH
  });

  try {
    // 연결 완료 대기
    await new Promise(resolve => setTimeout(resolve, 1000));
    
    // 네트워크별 테스트 계정들
    let testAddresses;
    
    if (network === 'monad') {
      // Monad 네트워크용 사용자 계정들
      testAddresses = [
        "0xa5cc9D9F1f68546060852f7c685B99f0cD532229"  // Monad 사용자 계정
      ];
    } else {
      // Hardhat 네트워크용 테스트 계정들 (기존)
      testAddresses = [
        "0x70997970C51812dc3A010C7d01b50e0d17dc79C8",  // Hardhat Account #0
        "0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC",  // Hardhat Account #1
        "0x90F79bf6EB2c4f870365E785982E1f101E93b906",  // Hardhat Account #2
        "0x15d34AAf54267DB7D7c367839AAf71A00a2C6A65",  // Hardhat Account #3
        "0x9965507D1a55bcC2695C58ba16FB37d819B0A4dc"   // Hardhat Account #4 (사용자4)
      ];
    }

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
        FilePath: `data/${network}/user_${shortHash}_001.bf`,
        KeySize: 64,
        Network: network
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

// 양방향 인덱싱 테스트
async function testBidirectionalIndexing(network) {
  console.log(`🚀 ${network} 네트워크에서 양방향 인덱싱 테스트 시작\n`);

  try {
    // 1. 네트워크별 계정 설정
    let deployer, org1;
    
    if (network === 'monad') {
      // Monad 네트워크용 계정 설정
      const networkConfig = hre.config.networks[network];
      const provider = new ethers.JsonRpcProvider(networkConfig.url);
      deployer = new ethers.Wallet(networkConfig.accounts[0], provider);
      
      // 요청자(조직) 계정을 명시적으로 설정
      org1 = new ethers.Wallet("0x2630ffE517DFC9b0112317a2EC0AB4cE2a59CEb8", provider); // Monad 요청자 계정
      
      console.log('👥 Monad 테스트 계정들:');
      console.log(`   🏗️  배포자: ${deployer.address}`);
      console.log(`   🏢 요청자(조직): ${org1.address}`);
      console.log(`   👤 사용자: 0xa5cc9D9F1f68546060852f7c685B99f0cD532229\n`);
    } else {
      // Hardhat 네트워크용 계정 설정 (기존)
      [deployer, user1, user2, user3, user4, user5] = await ethers.getSigners();
      org1 = user1; // 첫 번째 사용자를 조직으로 사용
      
      console.log('👥 Hardhat 테스트 계정들:');
      console.log(`   🏗️  배포자: ${deployer.address}`);
      console.log(`   🏢 조직1: ${org1.address}`);
      console.log(`   👤 사용자1: ${user2.address}`);
      console.log(`   👤 사용자2: ${user3.address}`);
      console.log(`   👤 사용자3: ${user4.address}`);
      console.log(`   👤 사용자4: ${user5.address}\n`);
    }

    // 2. 기존 배포된 AccessManagement 컨트랙트 사용
    console.log('🔍 기존 배포된 AccessManagement 컨트랙트 사용...');
    
    let accessManagement, contractAddress;
    
    if (network === 'monad') {
      // Monad 네트워크: network_config.yaml에서 컨트랙트 주소 가져오기
      const networkConfigPath = NETWORK_CONFIG_PATH;
      if (fs.existsSync(networkConfigPath)) {
        const configContent = fs.readFileSync(networkConfigPath, 'utf8');
        const config = yaml.load(configContent);
        contractAddress = config.networks?.monad?.contract_address;
        
        if (!contractAddress) {
          throw new Error('Monad 네트워크의 컨트랙트 주소를 찾을 수 없습니다. network_config.yaml을 확인해주세요.');
        }
      } else {
        throw new Error('network_config.yaml 파일을 찾을 수 없습니다.');
      }
      
      // 기존 컨트랙트 인스턴스 생성
      const AccessManagement = await ethers.getContractFactory('AccessManagement');
      accessManagement = AccessManagement.attach(contractAddress);
      
    } else {
      // Hardhat 네트워크: 새로 배포
      console.log('🏗️ AccessManagement 컨트랙트 배포 중...');
      const AccessManagement = await ethers.getContractFactory('AccessManagement');
      accessManagement = await AccessManagement.deploy();
      await accessManagement.waitForDeployment();
      
      contractAddress = await accessManagement.getAddress();
      console.log(`✅ 컨트랙트 배포 완료: ${contractAddress}\n`);
    }
    
    console.log(`📍 사용할 컨트랙트 주소: ${contractAddress}\n`);

    // 3. IndexingClient 연결
    const indexingClient = new IndexingClient({
      serverAddr: 'localhost:50052',
      protoPath: PROTO_PATH
    });

    // 연결 완료 대기
    await new Promise(resolve => setTimeout(resolve, 1000));
    
    // 4. 실제 트랜잭션으로 데이터 요청 생성
    console.log('📝 실제 트랜잭션으로 데이터 요청 생성 중...\n');
    
    // 네트워크별 테스트 데이터 설정
    let testRequests, users;
    
    if (network === 'monad') {
      // Monad 네트워크용 테스트 데이터
      testRequests = [
        {
          organizationName: "samsung",
          purpose: "데이터 공유 요청",
          description: "삼성이 Monad 사용자에게 데이터 공유 요청"
        },
        {
          organizationName: "samsung", 
          purpose: "데이터 접근 요청",
          description: "삼성이 Monad 사용자에게 데이터 접근 요청"
        }
      ];
      
      // Monad 계정들 사용
      users = [
        { address: "0xa5cc9D9F1f68546060852f7c685B99f0cD532229" }  // Monad 사용자
      ];
    } else {
      // Hardhat 네트워크용 테스트 데이터 (기존)
      testRequests = [
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
      
      users = [user1, user2, user3, user4];
    }
    
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
        console.log(`   🔍 트랜잭션 해시 확인: ${tx.hash}`);
        
        // 7. 양방향 인덱싱 데이터 저장
        console.log(`   💾 양방향 인덱싱 데이터 저장 중...`);
        
        // 조직별 인덱스에 저장 (요청자 주소 해시로 구분)
        const orgShortHash = hashWalletAddress(org1.address);
        const orgData = {
          IndexID: `samsung_${orgShortHash}_001`,
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
                "organizationName": request.organizationName,
                "requestingOrgAddress": org1.address,  // 요청자 주소 추가
                "targetUserId": user.address,
                "requestType": request.purpose,
                "description": request.description,
                "requestId": requestId.toString(),
                "timestamp": new Date().toISOString()
              },
              SchemaVersion: "1.0"
            }
          }],
          ColName: 'IndexableData',
          ColIndex: `samsung_${orgShortHash}_001`,
          FilePath: `data/${network}/samsung_${orgShortHash}_001.bf`,
          Network: network
        };
        
        await indexingClient.insertData(orgData);
        console.log(`   ✅ 조직별 인덱스 저장 완료`);
        
        // 사용자별 인덱스에 저장
        const shortHash = hashWalletAddress(user.address);
        const userData = {
          IndexID: `user_${shortHash}_001`,
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
          FilePath: `data/${network}/user_${shortHash}_001.bf`,
          Network: network
        };
        
        await indexingClient.insertData(userData);
        console.log(`   ✅ 사용자별 인덱스 저장 완료`);
        
        console.log(`   🎯 양방향 인덱싱 완료: ${requestId}번 요청`);
        console.log('');
        
      } catch (error) {
        console.error(`   ❌ 요청 ${i + 1} 처리 실패: ${error.message}`);
      }
    }
    
    console.log('🎉 양방향 인덱싱 테스트 완료!');
    
  } catch (error) {
    console.error(`❌ 양방향 인덱싱 테스트 중 오류 발생: ${error.message}`);
  }
}



// 도움말 표시
function showHelp() {
  console.log(`
🔧 BI-Index CLI - Hardhat + Monad 네트워크 지원

사용법:
  node cli.js -cmd=<명령어> [-network=<네트워크>] [-type=<타입>] [-value=<값>]

명령어 (-cmd=):
  deploy                    - 네트워크별 AccessManagement 컨트랙트 배포
  create-samsung           - Samsung 조직 인덱스 생성 (요청자 주소 기반)
  create-user-indexes      - 사용자별 인덱스들 생성
  search                   - 데이터 검색 (조직/사용자 주소로 검색)
  request-data             - 데이터 요청 및 양방향 인덱싱 (핵심!)
  large-scale-test         - 대규모 건강 데이터 테스트 (100개 요청)
  check-config             - config.yaml 확인
  check-network-config     - network_config.yaml 확인
  update-network           - 네트워크 설정 업데이트
  help                     - 도움말 표시

옵션:
  -network=<네트워크>      - hardhat, monad (기본값: hardhat)
  -type=<타입>             - 인덱스 타입 (일부 명령어에서 사용)
  -value=<값>              - 검색값 (검색 명령어에서 사용)
  -contract=<주소>         - 컨트랙트 주소 (배포 또는 설정 업데이트용)

예시:
  node cli.js -cmd=deploy -network=hardhat
  node cli.js -cmd=create-samsung -network=monad
  node cli.js -cmd=create-user-indexes -network=hardhat
  node cli.js -cmd=search -type=organization -value=0x2630ffE517DFC9b0112317a2EC0AB4cE2a59CEb8 -network=monad
  node cli.js -cmd=search -type=user -value=0xa5cc9D9F1f68546060852f7c685B99f0cD532229 -network=monad
  node cli.js -cmd=request-data -network=hardhat
  node cli.js -cmd=large-scale-test
  node cli.js -cmd=check-config
  node cli.js -cmd=check-network-config
  node cli.js -cmd=update-network -network=hardhat -contract=0x1234...
  node cli.js -cmd=help
    `);
}

// 메인 CLI 함수
async function main() {
  console.log(`🔧 BI-Index CLI - 명령어: ${cmd}, 네트워크: ${network}`);
  console.log('=====================================');
  
  try {
    switch (cmd) {
      // ===== 컨트랙트 배포 =====
      case 'deploy':
        await deployContract(network);
        break;
        
      // ===== 인덱스 생성 =====
      case 'create-samsung':
        await createSamsungIndex(network);
        break;
      case 'create-user-indexes':
        await createUserIndexes(network);
        break;
        
      // ===== 데이터 조회 =====
      case 'search':
        if (!type || !value) {
          console.error('❌ search 명령어는 -type과 -value가 필요합니다');
          console.log('예시: node cli.js -cmd=search -type=organization -value=0x2630ffE517DFC9b0112317a2EC0AB4cE2a59CEb8');
          return;
        }
        await searchData(network, type, value);
        break;
        
             // ===== 데이터 요청 및 양방향 인덱싱 =====
       case 'request-data':
         await testBidirectionalIndexing(network);
         break;
       case 'large-scale-test':
         await runLargeScaleTest();
         break;
        
      // ===== config.yaml 확인 =====
      case 'check-config':
        await checkConfigYaml();
        break;
        
      // ===== network_config.yaml 확인 =====
      case 'check-network-config':
        await checkNetworkConfig();
        break;
        
      // ===== 네트워크 설정 업데이트 =====
      case 'update-network':
        if (!contractAddress) {
          console.error('❌ 컨트랙트 주소를 입력해주세요. (-contract=<주소>)');
          break;
        }
        await updateNetworkConfig(network, contractAddress);
        break;
        
      // ===== 도움말 =====
      case 'help':
      default:
        showHelp();
        break;
    }
    
  } catch (error) {
    console.error(`❌ 명령어 실행 실패: ${error.message}`);
  }
}

// 스크립트가 직접 실행될 때만 main 함수 호출
if (require.main === module) {
  main().catch(console.error);
}

module.exports = {
  deployContract,
  createSamsungIndex,
  createUserIndexes,
  searchData,
  testBidirectionalIndexing
};
