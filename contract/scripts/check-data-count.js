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
  
  console.log(`📍 컨트랙트 주소: ${contractAddress}`);
  
  const PvdRecord = await hre.ethers.getContractFactory('PvdRecord');
  const pvdRecord = PvdRecord.attach(contractAddress);
  
  // 레코드 개수 확인
  const count = await pvdRecord.getTotalRecordCount();
  console.log(`\n📊 총 레코드 개수: ${count.toString()}`);
  
  if (count > 0) {
    // 키 목록 조회
    const keys = await pvdRecord.getKeyLists();
    console.log(`\n🔑 저장된 키 목록 (처음 10개):`);
    keys.slice(0, 10).forEach((key, i) => {
      console.log(`  ${i + 1}. ${key}`);
    });
  } else {
    console.log(`\n⚠️  데이터가 없습니다. upload-speeding-data.js를 먼저 실행하세요.`);
  }
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error('❌ 에러:', error.message);
    process.exit(1);
  });

