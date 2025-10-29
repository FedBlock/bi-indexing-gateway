require('dotenv').config();
const hre = require('hardhat');
const fs = require('fs');

async function main() {
  const DEPLOYMENT_FILE = './scripts/pvd-deployment.json';
  
  if (!fs.existsSync(DEPLOYMENT_FILE)) {
    console.error('❌ 배포 정보 없음');
    process.exit(1);
  }
  
  const deploymentInfo = JSON.parse(fs.readFileSync(DEPLOYMENT_FILE, 'utf8'));
  const contractAddress = deploymentInfo.contractAddress;
  
  console.log(`📍 컨트랙트 주소: ${contractAddress}\n`);
  
  const PvdRecord = await hre.ethers.getContractFactory('PvdRecord');
  const pvdRecord = PvdRecord.attach(contractAddress);
  
  try {
    // 1. 총 레코드 개수
    const totalCount = await pvdRecord.getTotalRecordCount();
    console.log(`📊 총 레코드 개수: ${totalCount.toString()}`);
    
    // 2. 키 목록
    const keys = await pvdRecord.getKeyLists();
    console.log(`\n🔑 저장된 키 목록 (${keys.length}개):`);
    keys.slice(0, 10).forEach((key, i) => {
      console.log(`  ${i + 1}. ${key}`);
    });
    
    if (keys.length > 10) {
      console.log(`  ... 외 ${keys.length - 10}개`);
    }
    
    // 3. 첫 번째 데이터 조회
    if (keys.length > 0) {
      console.log(`\n📝 첫 번째 데이터 조회 (키: ${keys[0]}):`);
      const data = await pvdRecord.readPvd(keys[0]);
      console.log(`  OBU ID: ${data.obuId}`);
      console.log(`  속도: ${data.speed} km/h`);
      console.log(`  위치: (${data.startvectorLatitude}, ${data.startvectorLongitude})`);
      console.log(`  블록: ${data.blockNumber}`);
    }
    
    // 4. getPvdWorldStates 테스트
    console.log(`\n📡 getPvdWorldStates() 호출 테스트...`);
    const allData = await pvdRecord.getPvdWorldStates();
    console.log(`✅ 조회 성공! ${allData.length}건 반환됨`);
    
    if (allData.length > 0) {
      console.log(`\n🔍 첫 번째 데이터:`);
      console.log(`  OBU ID: ${allData[0].obuId}`);
      console.log(`  속도: ${allData[0].speed}`);
    }
    
  } catch (error) {
    console.error('\n❌ 에러:', error.message);
    console.error('\n상세:', error);
  }
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error('❌ 실행 실패:', error);
    process.exit(1);
  });

