const hre = require("hardhat");

async function main() {
  console.log("🏢 Samsung Access Request 테스트 시작...");

  // Samsung 계정 (Account #0)
  const [samsungAccount] = await hre.ethers.getSigners();
  console.log(`📱 Samsung 계정: ${samsungAccount.address}`);

  // 배포된 컨트랙트 주소 가져오기
  const deploymentInfo = require('../deployment.json');
  const contractAddress = deploymentInfo.contractAddress;
  console.log(`📍 컨트랙트 주소: ${contractAddress}`);

  // AccessManagement 컨트랙트 인스턴스 생성
  const AccessManagement = await hre.ethers.getContractFactory("AccessManagement");
  const accessManagement = AccessManagement.attach(contractAddress);

  // Samsung 조직 정보
  const organizationName = "samsung";
  const requester = samsungAccount.address;
  const resourceOwner = "0x70997970C51812dc3A010C7d01b50e0d17dc79C8"; // LG 계정
  const purpose = "Business Partnership";

  console.log(`\n📋 Access Request 정보:`);
  console.log(`   Organization: ${organizationName}`);
  console.log(`   Requester: ${requester}`);
  console.log(`   Resource Owner: ${resourceOwner}`);
  console.log(`   Purpose: ${purpose}`);

  try {
    // saveRequest 함수 호출
    console.log(`\n🚀 saveRequest 함수 호출 중...`);
   const tx = await accessManagement.saveRequest(
    resourceOwner,        
    purpose,              
    organizationName      
);

    console.log(`📝 트랜잭션 전송됨: ${tx.hash}`);
    
    // 트랜잭션 완료 대기
    const receipt = await tx.wait();
    console.log(`✅ 트랜잭션 완료!`);
    console.log(`   Block Number: ${receipt.blockNumber}`);
    console.log(`   Gas Used: ${receipt.gasUsed.toString()}`);
    console.log(`   Tx Hash: ${receipt.hash}`);

    // 이벤트 로그 확인
    if (receipt.logs.length > 0) {
      console.log(`\n📊 이벤트 로그:`);
      receipt.logs.forEach((log, index) => {
        console.log(`   [${index}] ${log}`);
      });
    }

    return receipt.hash;

  } catch (error) {
    console.error(`❌ saveRequest 호출 실패: ${error.message}`);
    throw error;
  }
}

main()
  .then((txHash) => {
    console.log(`\n🎉 Samsung Access Request 성공!`);
    console.log(`   Tx Hash: ${txHash}`);
    process.exit(0);
  })
  .catch((error) => {
    console.error("❌ 테스트 실패:", error);
    process.exit(1);
});