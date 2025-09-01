#!/usr/bin/env node

const { ethers } = require("hardhat");
const fs = require('fs');
const path = require('path');
const yaml = require('js-yaml');

// 설정 파일 경로
const NETWORK_CONFIG_PATH = path.join(__dirname, '../network_config.yaml');

// 네트워크별 컨트랙트 배포
async function deployContract(network) {
  console.log(`🚀 ${network} 네트워크에 AccessManagement 컨트랙트 배포 시작\n`);

  try {
    let deployer, provider;
    
    if (network === 'monad') {
      // Monad 네트워크용 계정 설정
      const networkConfig = hre.config.networks[network];
      provider = new ethers.JsonRpcProvider(networkConfig.url);
      deployer = new ethers.Wallet(networkConfig.accounts[0], provider);
      
      console.log('👥 Monad 테스트 계정들:');
      console.log(`   🏗️  배포자: ${deployer.address}\n`);
    } else if (network === 'hardhat-local') {
      // hardhat-local 네트워크용 계정 설정
      provider = new ethers.JsonRpcProvider('http://127.0.0.1:8545');
      deployer = new ethers.Wallet('0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80', provider);
      
      console.log('👥 Hardhat-Local 노드 계정들:');
      console.log(`   🏗️  배포자: ${deployer.address}\n`);
    } else {
      // 기존 Hardhat 네트워크
      [deployer] = await ethers.getSigners();
      provider = ethers.provider;
      
      console.log('👥 Hardhat 테스트 계정들:');
      console.log(`   🏗️  배포자: ${deployer.address}\n`);
    }

    // AccessManagement 컨트랙트 배포
    console.log('🏗️ AccessManagement 컨트랙트 배포 중...');
    const AccessManagement = await ethers.getContractFactory('AccessManagement');
    const accessManagement = await AccessManagement.connect(deployer).deploy();
    await accessManagement.waitForDeployment();
    
    const contractAddress = await accessManagement.getAddress();
    console.log(`✅ 컨트랙트 배포 완료: ${contractAddress}\n`);

    // 네트워크 설정 파일 업데이트
    await updateNetworkConfig(network, contractAddress);
    
    console.log('🎉 컨트랙트 배포 및 설정 완료!');
    console.log(`📍 컨트랙트 주소: ${contractAddress}`);
    console.log(`🌐 네트워크: ${network}`);
    
    return contractAddress;
    
  } catch (error) {
    console.error(`❌ 컨트랙트 배포 실패: ${error.message}`);
    throw error;
  }
}

// 네트워크 설정 파일 업데이트
async function updateNetworkConfig(network, contractAddress) {
  try {
    console.log('📝 네트워크 설정 파일 업데이트 중...');
    
    let config = {};
    if (fs.existsSync(NETWORK_CONFIG_PATH)) {
      const configContent = fs.readFileSync(NETWORK_CONFIG_PATH, 'utf8');
      config = yaml.load(configContent) || {};
    }
    
    // 네트워크별 컨트랙트 주소 설정
    if (!config.networks) {
      config.networks = {};
    }
    
    config.networks[network] = {
      contract_address: contractAddress,
      deployed_at: new Date().toISOString(),
      network_type: network
    };
    
    // 설정 파일 저장
    const yamlContent = yaml.dump(config, { indent: 2 });
    fs.writeFileSync(NETWORK_CONFIG_PATH, yamlContent, 'utf8');
    
    console.log(`✅ ${network} 네트워크 설정 업데이트 완료`);
    
  } catch (error) {
    console.error(`❌ 네트워크 설정 업데이트 실패: ${error.message}`);
  }
}

// 메인 함수
async function main() {
  const args = process.argv.slice(2);
  
  // 명령행 인수 파싱
  let network = 'hardhat-local'; // 기본값
  
  for (const arg of args) {
    if (arg.startsWith('--network=')) {
      network = arg.split('=')[1];
    }
  }
  
  console.log(`🔧 Contract Deployer - 네트워크: ${network}`);
  console.log('=====================================\n');
  
  try {
    await deployContract(network);
  } catch (error) {
    console.error(`❌ 배포 실패: ${error.message}`);
    process.exit(1);
  }
}

// 스크립트가 직접 실행될 때만 main 함수 호출
if (require.main === module) {
  main().catch(console.error);
}

module.exports = {
  deployContract,
  updateNetworkConfig
};
