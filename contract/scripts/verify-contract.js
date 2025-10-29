require('dotenv').config();
const hre = require('hardhat');
const fs = require('fs');

async function main() {
  const DEPLOYMENT_FILE = './scripts/pvd-deployment.json';
  
  if (!fs.existsSync(DEPLOYMENT_FILE)) {
    console.error('❌ 배포 정보를 찾을 수 없습니다.');
    process.exit(1);
  }
  
  const deploymentInfo = JSON.parse(fs.readFileSync(DEPLOYMENT_FILE, 'utf8'));
  const contractAddress = deploymentInfo.contractAddress;
  
  console.log(`📍 컨트랙트 주소: ${contractAddress}\n`);
  
  // 해당 주소에 코드가 있는지 확인
  const provider = hre.ethers.provider;
  const code = await provider.getCode(contractAddress);
  
  console.log(`코드 길이: ${code.length} bytes`);
  console.log(`코드 존재: ${code !== '0x' ? '✅ YES' : '❌ NO'}`);
  
  if (code === '0x') {
    console.log('\n❌ 컨트랙트가 배포되지 않았습니다!');
    console.log('deploy-pvd.js를 다시 실행하세요.');
  } else {
    console.log('\n✅ 컨트랙트가 정상적으로 배포되어 있습니다.');
    
    // 블록 번호 확인
    const blockNumber = await provider.getBlockNumber();
    console.log(`\n현재 블록 번호: ${blockNumber}`);
  }
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error('❌ 에러:', error.message);
    process.exit(1);
  });

