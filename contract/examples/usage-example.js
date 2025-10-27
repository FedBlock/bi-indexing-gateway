const { ethers } = require("hardhat");
const PvdRecordClient = require("./utils/PvdRecordClient");

async function main() {
    console.log("PvdRecord 클라이언트 사용 예제를 시작합니다...");

    // 네트워크 설정
    const [deployer, user1, user2] = await ethers.getSigners();
    console.log("배포자 주소:", deployer.address);
    console.log("사용자1 주소:", user1.address);
    console.log("사용자2 주소:", user2.address);

    // 컨트랙트 배포
    const PvdRecord = await ethers.getContractFactory("PvdRecord");
    const pvdRecord = await PvdRecord.deploy();
    await pvdRecord.deployed();
    console.log("컨트랙트 배포 완료:", pvdRecord.address);

    // 클라이언트 생성
    const client = new PvdRecordClient(pvdRecord.address, deployer);

    // 초기 데이터 설정
    console.log("\n=== 초기 데이터 설정 ===");
    const initTx = await pvdRecord.initLedger();
    await initTx.wait();
    console.log("초기 데이터 설정 완료");

    // 전체 레코드 수 확인
    const totalCount = await client.getTotalRecordCount();
    console.log("전체 레코드 수:", totalCount.toString());

    // 모든 키 조회
    console.log("\n=== 모든 키 조회 ===");
    const allKeys = await client.getAllKeys();
    console.log("모든 키:", allKeys);

    // 특정 레코드 조회
    console.log("\n=== 특정 레코드 조회 ===");
    const pvd = await client.readPvd("OBU-461001c1");
    console.log("OBU-461001c1 데이터:");
    console.log("- OBU ID:", pvd.obuId);
    console.log("- 속도:", pvd.speed.toString());
    console.log("- 연료량:", pvd.fuelPercent.toString() + "%");
    console.log("- 위도:", pvd.startvectorLatitude);
    console.log("- 경도:", pvd.startvectorLongitude);

    // 새로운 레코드 생성
    console.log("\n=== 새로운 레코드 생성 ===");
    const newPvdData = {
        obuId: "OBU-TEST001",
        collectionDt: "20231201000000000",
        startvectorLatitude: "37.5665",
        startvectorLongitude: "126.9780",
        transmisstion: "AUTO",
        speed: 60,
        hazardLights: "OFF",
        leftTurnSignalOn: "OFF",
        rightTurnSignalOn: "OFF",
        steering: 0,
        rpm: 2000,
        footbrake: "OFF",
        gear: "D",
        accelator: 30,
        wipers: "OFF",
        tireWarnLeftF: "OK",
        tireWarnLeftR: "OK",
        tireWarnRightF: "OK",
        tireWarnRightR: "OK",
        tirePsiLeftF: 35,
        tirePsiLeftR: 35,
        tirePsiRightF: 35,
        tirePsiRightR: 35,
        fuelPercent: 80,
        fuelLiter: 40,
        totaldist: 10000,
        rsuId: "RSU-001",
        msgId: "MSG-TEST-001",
        startvectorHeading: 90
    };

    const createTxHash = await client.createUpdatePvd(newPvdData);
    console.log("새 레코드 생성 트랜잭션 해시:", createTxHash);

    // 생성된 레코드 확인
    const exists = await client.pvdExists("OBU-TEST001");
    console.log("OBU-TEST001 존재 여부:", exists);

    // 레코드 업데이트
    console.log("\n=== 레코드 업데이트 ===");
    const updateData = {
        ...newPvdData,
        speed: 80,
        rpm: 2500,
        fuelPercent: 75,
        accelator: 50
    };

    const updateTxHash = await client.updatePvd("OBU-TEST001", updateData);
    console.log("레코드 업데이트 트랜잭션 해시:", updateTxHash);

    // 업데이트된 레코드 확인
    const updatedPvd = await client.readPvd("OBU-TEST001");
    console.log("업데이트된 데이터:");
    console.log("- 속도:", updatedPvd.speed.toString());
    console.log("- RPM:", updatedPvd.rpm.toString());
    console.log("- 연료량:", updatedPvd.fuelPercent.toString() + "%");

    // 히스토리 조회
    console.log("\n=== 히스토리 조회 ===");
    const history = await client.getHistory("OBU-TEST001");
    console.log("OBU-TEST001 히스토리 개수:", history.length);
    for (let i = 0; i < history.length; i++) {
        console.log(`히스토리 ${i + 1}: 속도 ${history[i].speed}, 연료량 ${history[i].fuelPercent}%`);
    }

    // 페이지네이션 테스트
    console.log("\n=== 페이지네이션 테스트 ===");
    const page1 = await client.getPvdsWithPagination(0, 2);
    console.log("첫 번째 페이지 (0-1):", page1.length, "개 레코드");
    
    const page2 = await client.getPvdsWithPagination(2, 2);
    console.log("두 번째 페이지 (2-3):", page2.length, "개 레코드");

    // 권한 관리 테스트
    console.log("\n=== 권한 관리 테스트 ===");
    const user1Client = new PvdRecordClient(pvdRecord.address, user1);
    
    try {
        // 권한이 없는 사용자가 레코드 생성 시도
        await user1Client.createUpdatePvd({
            obuId: "OBU-UNAUTHORIZED",
            speed: 100
        });
        console.log("권한 없는 사용자도 레코드 생성 가능 (문제!)");
    } catch (error) {
        console.log("권한 없는 사용자 레코드 생성 실패 (정상):", error.message);
    }

    // 사용자1에게 권한 부여
    await client.authorizeUser(user1.address);
    console.log("사용자1에게 권한 부여 완료");

    // 권한이 있는 사용자가 레코드 생성
    try {
        const user1TxHash = await user1Client.createUpdatePvd({
            obuId: "OBU-USER1",
            speed: 120,
            fuelPercent: 50
        });
        console.log("사용자1 레코드 생성 성공:", user1TxHash);
    } catch (error) {
        console.log("사용자1 레코드 생성 실패:", error.message);
    }

    // 최종 상태 확인
    console.log("\n=== 최종 상태 확인 ===");
    const finalCount = await client.getTotalRecordCount();
    console.log("최종 레코드 수:", finalCount.toString());
    
    const finalKeys = await client.getAllKeys();
    console.log("최종 키 목록:", finalKeys);

    console.log("\n=== 사용 예제 완료 ===");
}

main()
    .then(() => process.exit(0))
    .catch((error) => {
        console.error("예제 실행 중 오류 발생:", error);
        process.exit(1);
    });
