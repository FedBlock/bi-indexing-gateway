const { ethers } = require("hardhat");

async function main() {
    console.log("PvdRecord 스마트 컨트랙트 배포를 시작합니다...");

    // 컨트랙트 팩토리 가져오기
    const PvdRecord = await ethers.getContractFactory("PvdRecord");

    // 컨트랙트 배포
    const pvdRecord = await PvdRecord.deploy();
    await pvdRecord.deployed();

    console.log("PvdRecord 컨트랙트가 다음 주소에 배포되었습니다:", pvdRecord.address);

    // 초기 데이터 설정
    console.log("초기 데이터를 설정합니다...");
    const initTx = await pvdRecord.initLedger();
    await initTx.wait();
    console.log("초기 데이터 설정 완료");

    // 배포된 컨트랙트 정보 출력
    console.log("\n=== 배포 정보 ===");
    console.log("컨트랙트 주소:", pvdRecord.address);
    console.log("배포자 주소:", await pvdRecord.owner());
    console.log("총 레코드 수:", await pvdRecord.getTotalRecordCount());

    // 초기 레코드들 확인
    console.log("\n=== 초기 레코드 확인 ===");
    const allKeys = await pvdRecord.getKeyLists();
    for (let i = 0; i < allKeys.length; i++) {
        const pvd = await pvdRecord.readPvd(allKeys[i]);
        console.log(`OBU ID: ${pvd.obuId}, 속도: ${pvd.speed}, 연료량: ${pvd.fuelPercent}%`);
    }

    // 배포 정보를 파일에 저장
    const fs = require('fs');
    const deploymentInfo = {
        contractAddress: pvdRecord.address,
        deployer: await pvdRecord.owner(),
        deploymentTime: new Date().toISOString(),
        network: await ethers.provider.getNetwork(),
        totalRecords: await pvdRecord.getTotalRecordCount()
    };

    fs.writeFileSync(
        './deployment-info.json', 
        JSON.stringify(deploymentInfo, null, 2)
    );
    
    console.log("\n배포 정보가 deployment-info.json 파일에 저장되었습니다.");
}

main()
    .then(() => process.exit(0))
    .catch((error) => {
        console.error("배포 중 오류 발생:", error);
        process.exit(1);
    });
