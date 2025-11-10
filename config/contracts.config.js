const path = require('path');

/**
 * 블록체인 컨트랙트 설정
 * 
 * 컨트랙트 주소, 네트워크 설정, deployment 파일 경로 등을 중앙 관리합니다.
 */

// 네트워크별 RPC URL 설정
const NETWORK_RPC_URLS = {
  kaia: 'https://public-en-kairos.node.kaia.io',
  'kaia-testnet': 'https://public-en-kairos.node.kaia.io',
  monad: 'https://testnet.monad.xyz',
  'hardhat-local': 'http://127.0.0.1:8545',
  hardhat: 'http://127.0.0.1:8545'
};

// 네트워크별 Chain ID
const NETWORK_CHAIN_IDS = {
  kaia: 1001,
  'kaia-testnet': 1001,
  monad: 10143, // Monad Testnet
  'hardhat-local': 31337,
  hardhat: 31337
};

// 컨트랙트 주소 설정
const CONTRACT_ADDRESSES = {
  // PVD (차량 데이터) 컨트랙트
  pvd: {
    kaia: '0xe452Ae89B6c187F8Deee162153F946f07AF7aA82',
    monad: '0xe452Ae89B6c187F8Deee162153F946f07AF7aA82',
    'hardhat-local': '0x5f3f1dBD7B74C6B46e8c44f98792A1dAf8d69154',
    hardhat: '0x5f3f1dBD7B74C6B46e8c44f98792A1dAf8d69154'
  },
  
  // AccessManagement 컨트랙트 (향후 사용 가능)
  accessManagement: {
    kaia: '0x23EC7332865ecD204539f5C3535175C22D2C6388',
    monad: '0x23EC7332865ecD204539f5C3535175C22D2C6388',
    'hardhat-local': '0x23EC7332865ecD204539f5C3535175C22D2C6388',
    hardhat: '0x23EC7332865ecD204539f5C3535175C22D2C6388'
  }
};

// Deployment 파일 경로 설정
const DEPLOYMENT_PATHS = {
  pvd: path.join(__dirname, '../../bi-index/contract/scripts/pvd-deployment.json'),
  accessManagement: path.join(__dirname, '../../bi-index/contract/scripts/access-deployment.json')
};

// ABI 파일 경로 설정
const ABI_PATHS = {
  pvd: path.join(__dirname, '../../bi-index/contract/artifacts/contracts/PvdRecord.sol/PvdRecord.json'),
  accessManagement: path.join(__dirname, '../../bi-index/contract/artifacts/contracts/AccessManagement.sol/AccessManagement.json')
};

/**
 * 네트워크 이름 정규화
 * @param {string} network - 네트워크 이름
 * @returns {string} 정규화된 네트워크 이름
 */
function normalizeNetwork(network) {
  const networkMap = {
    'kaia': 'kaia',
    'kaia-testnet': 'kaia',
    'kairos': 'kaia',
    'monad': 'monad',
    'monad-testnet': 'monad',
    'hardhat': 'hardhat-local',
    'hardhat-local': 'hardhat-local',
    'localhost': 'hardhat-local'
  };
  
  return networkMap[network?.toLowerCase()] || 'hardhat-local';
}

/**
 * 네트워크에 맞는 컨트랙트 주소 가져오기
 * @param {string} contractType - 컨트랙트 타입 ('pvd', 'accessManagement')
 * @param {string} network - 네트워크 이름
 * @param {boolean} useDeployment - deployment 파일에서 주소를 읽을지 여부
 * @returns {string} 컨트랙트 주소
 */
function getContractAddress(contractType, network, useDeployment = true) {
  const normalizedNetwork = normalizeNetwork(network);
  
  // deployment 파일에서 주소 읽기 시도
  if (useDeployment && DEPLOYMENT_PATHS[contractType]) {
    try {
      const fs = require('fs');
      if (fs.existsSync(DEPLOYMENT_PATHS[contractType])) {
        const deployment = JSON.parse(fs.readFileSync(DEPLOYMENT_PATHS[contractType], 'utf8'));
        if (deployment.contractAddress) {
          console.log(`✅ ${contractType} 컨트랙트 주소를 deployment 파일에서 로드: ${deployment.contractAddress}`);
          return deployment.contractAddress;
        }
      }
    } catch (error) {
      console.warn(`⚠️  ${contractType} deployment 파일 읽기 실패, 기본 주소 사용`);
    }
  }
  
  // 기본 주소 사용
  const address = CONTRACT_ADDRESSES[contractType]?.[normalizedNetwork];
  if (!address) {
    throw new Error(`${contractType} 컨트랙트 주소가 ${normalizedNetwork} 네트워크에 설정되지 않았습니다.`);
  }
  
  return address;
}

/**
 * 네트워크에 맞는 RPC URL 가져오기
 * @param {string} network - 네트워크 이름
 * @returns {string} RPC URL
 */
function getRpcUrl(network) {
  const normalizedNetwork = normalizeNetwork(network);
  const rpcUrl = NETWORK_RPC_URLS[normalizedNetwork];
  
  if (!rpcUrl) {
    throw new Error(`RPC URL이 ${normalizedNetwork} 네트워크에 설정되지 않았습니다.`);
  }
  
  return rpcUrl;
}

/**
 * 네트워크에 맞는 Chain ID 가져오기
 * @param {string} network - 네트워크 이름
 * @returns {number} Chain ID
 */
function getChainId(network) {
  const normalizedNetwork = normalizeNetwork(network);
  return NETWORK_CHAIN_IDS[normalizedNetwork];
}

/**
 * ABI 파일 경로 가져오기
 * @param {string} contractType - 컨트랙트 타입
 * @returns {string} ABI 파일 경로
 */
function getAbiPath(contractType) {
  const abiPath = ABI_PATHS[contractType];
  if (!abiPath) {
    throw new Error(`${contractType} 컨트랙트의 ABI 경로가 설정되지 않았습니다.`);
  }
  return abiPath;
}

module.exports = {
  NETWORK_RPC_URLS,
  NETWORK_CHAIN_IDS,
  CONTRACT_ADDRESSES,
  DEPLOYMENT_PATHS,
  ABI_PATHS,
  normalizeNetwork,
  getContractAddress,
  getRpcUrl,
  getChainId,
  getAbiPath
};

