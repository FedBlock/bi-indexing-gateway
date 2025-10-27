// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import "hardhat/console.sol";
import "../contracts/PvdRecord.sol";

contract PvdRecordTest {
    PvdRecord public pvdRecord;
    
    function setUp() public {
        pvdRecord = new PvdRecord();
    }
    
    function testInitLedger() public {
        pvdRecord.initLedger();
        
        // 초기 데이터 확인
        assert(pvdRecord.getTotalRecordCount() == 4);
        
        // 첫 번째 레코드 확인
        PvdRecord.PvdHist memory pvd = pvdRecord.readPvd("OBU-461001c1");
        assert(keccak256(bytes(pvd.obuId)) == keccak256(bytes("OBU-461001c1")));
        assert(pvd.speed == 0);
        assert(pvd.fuelPercent == 0);
    }
    
    function testCreateUpdatePvd() public {
        PvdRecord.PvdHist memory newPvd = PvdRecord.PvdHist({
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
            startvectorHeading: 90,
            timestamp: 0,
            blockNumber: 0
        });
        
        string memory txId = pvdRecord.createUpdatePvd("OBU-TEST001", newPvd);
        assert(bytes(txId).length > 0);
        
        // 생성 확인
        assert(pvdRecord.pvdExists("OBU-TEST001"));
        
        PvdRecord.PvdHist memory retrievedPvd = pvdRecord.readPvd("OBU-TEST001");
        assert(retrievedPvd.speed == 60);
        assert(retrievedPvd.fuelPercent == 80);
    }
    
    function testUpdatePvd() public {
        // 먼저 레코드 생성
        testCreateUpdatePvd();
        
        PvdRecord.PvdHist memory updatedPvd = PvdRecord.PvdHist({
            obuId: "OBU-TEST001",
            collectionDt: "20231201000000000",
            startvectorLatitude: "37.5665",
            startvectorLongitude: "126.9780",
            transmisstion: "AUTO",
            speed: 80, // 속도 변경
            hazardLights: "OFF",
            leftTurnSignalOn: "OFF",
            rightTurnSignalOn: "OFF",
            steering: 0,
            rpm: 2500, // RPM 변경
            footbrake: "OFF",
            gear: "D",
            accelator: 50, // 가속도 변경
            wipers: "OFF",
            tireWarnLeftF: "OK",
            tireWarnLeftR: "OK",
            tireWarnRightF: "OK",
            tireWarnRightR: "OK",
            tirePsiLeftF: 35,
            tirePsiLeftR: 35,
            tirePsiRightF: 35,
            tirePsiRightR: 35,
            fuelPercent: 75, // 연료량 변경
            fuelLiter: 37,
            totaldist: 10050,
            rsuId: "RSU-001",
            msgId: "MSG-TEST-001",
            startvectorHeading: 90,
            timestamp: 0,
            blockNumber: 0
        });
        
        pvdRecord.updatePvd("OBU-TEST001", updatedPvd);
        
        // 업데이트 확인
        PvdRecord.PvdHist memory retrievedPvd = pvdRecord.readPvd("OBU-TEST001");
        assert(retrievedPvd.speed == 80);
        assert(retrievedPvd.rpm == 2500);
        assert(retrievedPvd.fuelPercent == 75);
    }
    
    function testDeletePvd() public {
        // 먼저 레코드 생성
        testCreateUpdatePvd();
        
        // 삭제 전 존재 확인
        assert(pvdRecord.pvdExists("OBU-TEST001"));
        
        // 삭제
        pvdRecord.deletePvd("OBU-TEST001");
        
        // 삭제 후 존재하지 않음 확인
        assert(!pvdRecord.pvdExists("OBU-TEST001"));
    }
    
    function testGetHistory() public {
        // 먼저 레코드 생성
        testCreateUpdatePvd();
        
        // 히스토리 확인
        PvdRecord.PvdHist[] memory history = pvdRecord.getHistoryForKey("OBU-TEST001");
        assert(history.length == 1);
        
        // 업데이트
        testUpdatePvd();
        
        // 히스토리 다시 확인
        history = pvdRecord.getHistoryForKey("OBU-TEST001");
        assert(history.length == 2);
    }
    
    function testGetAllRecords() public {
        pvdRecord.initLedger();
        
        PvdRecord.PvdHist[] memory allRecords = pvdRecord.getPvdWorldStates();
        assert(allRecords.length == 4);
        
        string[] memory allKeys = pvdRecord.getKeyLists();
        assert(allKeys.length == 4);
    }
    
    function testPagination() public {
        pvdRecord.initLedger();
        
        PvdRecord.PvdHist[] memory page1 = pvdRecord.getPvdsWithPagination(0, 2);
        assert(page1.length == 2);
        
        PvdRecord.PvdHist[] memory page2 = pvdRecord.getPvdsWithPagination(2, 2);
        assert(page2.length == 2);
    }
}
