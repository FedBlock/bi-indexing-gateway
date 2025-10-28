// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

/**
 * @title PvdRecord
 * @dev PVD (Probe Vehicle Data) 기록을 관리하는 스마트 컨트랙트
 * @notice Hyperledger Fabric Go chaincode를 EVM용 Solidity로 변환
 */
contract PvdRecord {
    
    // PVD 히스토리 데이터 구조체
    struct PvdHist {
        string obuId;                    // OBU_ID
        string collectionDt;             // COLLECTION_DT
        string startvectorLatitude;     // STARTVECTOR_LATITUDE
        string startvectorLongitude;    // STARTVECTOR_LONGITUDE
        string transmisstion;           // TRANSMISSTION
        uint256 speed;                  // SPEED
        string hazardLights;            // HAZARD_LIGHTS
        string leftTurnSignalOn;       // LEFT_TURN_SIGNAL_ON
        string rightTurnSignalOn;      // RIGHT_TURN_SIGNAL_ON
        uint256 steering;              // STEERING
        uint256 rpm;                   // RPM
        string footbrake;              // FOOTBRAKE
        string gear;                   // GEAR
        uint256 accelator;             // ACCELATOR
        string wipers;                 // WIPERS
        string tireWarnLeftF;          // TIRE_WARN_LEFT_F
        string tireWarnLeftR;          // TIRE_WARN_LEFT_R
        string tireWarnRightF;         // TIRE_WARN_RIGHT_F
        string tireWarnRightR;         // TIRE_WARN_RIGHT_R
        uint256 tirePsiLeftF;          // TIRE_PSI_LEFT_F
        uint256 tirePsiLeftR;          // TIRE_PSI_LEFT_R
        uint256 tirePsiRightF;         // TIRE_PSI_RIGHT_F
        uint256 tirePsiRightR;         // TIRE_PSI_RIGHT_R
        uint256 fuelPercent;           // FUEL_PERCENT
        uint256 fuelLiter;             // FUEL_LITER
        uint256 totaldist;             // TOTALDIST
        string rsuId;                  // RSU_ID
        string msgId;                  // MSG_ID
        uint256 startvectorHeading;    // STARTVECTOR_HEADING
        uint256 timestamp;             // 블록 타임스탬프
        uint256 blockNumber;           // 블록 번호
    }

    // 블록체인 데이터 구조체
    struct BcData {
        string txId;
        PvdHist pvd;
        string bookMark;
    }

    // 블록체인 필드 구조체
    struct BcField {
        string key;
        string txId;
        string value;
    }

    // 상태 변수들
    mapping(string => PvdHist) private pvdRecords;
    mapping(string => PvdHist[]) private pvdHistory;
    string[] private allKeys;
    
    // 이벤트 정의
    event PvdCreated(string indexed obuId, string txId);
    event PvdUpdated(string indexed obuId, string txId);
    event PvdDeleted(string indexed obuId);
    event PvdRead(string indexed obuId);
        
    // 접근 제어
    address public owner;
    mapping(address => bool) public authorizedUsers;

    modifier onlyOwner() {
        require(msg.sender == owner, "Only owner can call this function");
        _;
    }

    modifier onlyAuthorized() {
        require(msg.sender == owner || authorizedUsers[msg.sender], "Not authorized");
        _;
    }

    constructor() {
        owner = msg.sender;
        authorizedUsers[msg.sender] = true;
    }

    /**
     * @dev 권한 부여
     * @param user 권한을 부여할 사용자 주소
     */
    function authorizeUser(address user) external onlyOwner {
        authorizedUsers[user] = true;
    }

    /**
     * @dev 권한 해제
     * @param user 권한을 해제할 사용자 주소
     */
    function revokeUser(address user) external onlyOwner {
        authorizedUsers[user] = false;
    }

    /**
     * @dev 초기 데이터 설정 (InitLedger와 동일)
     */
    function initLedger() external onlyOwner {
        // 초기 PVD 데이터들 생성
        string[4] memory obuIds = [
            "OBU-461001c1",
            "OBU-461001c2", 
            "OBU-461001c3",
            "OBU-461001c4"
        ];

        for (uint i = 0; i < obuIds.length; i++) {
            PvdHist memory pvd = PvdHist({
                obuId: obuIds[i],
                collectionDt: "20211001001000198",
                startvectorLatitude: "33.496063",
                startvectorLongitude: "126.491677",
                transmisstion: "-",
                speed: 0,
                hazardLights: "OFF",
                leftTurnSignalOn: "OFF",
                rightTurnSignalOn: "OFF",
                steering: 0,
                rpm: 0,
                footbrake: "-",
                gear: "0",
                accelator: 0,
                wipers: "작동",
                tireWarnLeftF: "-",
                tireWarnLeftR: "-",
                tireWarnRightF: "-",
                tireWarnRightR: "-",
                tirePsiLeftF: 0,
                tirePsiLeftR: 0,
                tirePsiRightF: 0,
                tirePsiRightR: 0,
                fuelPercent: 0,
                fuelLiter: 0,
                totaldist: 0,
                rsuId: "",
                msgId: "PVD-461001c4-20210930150956947",
                startvectorHeading: 2463,
                timestamp: block.timestamp,
                blockNumber: block.number
            });

            pvdRecords[obuIds[i]] = pvd;
            pvdHistory[obuIds[i]].push(pvd);
            allKeys.push(obuIds[i]);
            
            emit PvdCreated(obuIds[i], _getTxId());
        }
    }

    /**
     * @dev 새로운 PVD 레코드 생성 (CreatePVD와 동일)
     * @param pvdData JSON 문자열로 인코딩된 PVD 데이터
     * @return txId 트랜잭션 ID
     */
    function createPvd(string memory pvdData) external onlyAuthorized returns (string memory) {
        // 실제 구현에서는 JSON 파싱이 필요하지만, 여기서는 간단한 예시로 처리
        // 실제로는 off-chain에서 JSON을 파싱하여 구조체로 변환 후 호출해야 함
        
        // 중복 체크는 별도 함수로 구현
        return _getTxId();
    }

    /**
     * @dev PVD 레코드 생성 또는 업데이트 (CreateUpdatePVD와 동일)
     * @param obuId OBU ID
     * @param pvd PVD 데이터 구조체
     * @return txId 트랜잭션 ID
     */
    function createUpdatePvd(string memory obuId, PvdHist memory pvd) external onlyAuthorized returns (string memory) {
        pvd.timestamp = block.timestamp;
        pvd.blockNumber = block.number;
        
        bool exists = _pvdExists(obuId);
        
        if (exists) {
            pvdRecords[obuId] = pvd;
            emit PvdUpdated(obuId, _getTxId());
        } else {
            pvdRecords[obuId] = pvd;
            allKeys.push(obuId);
            emit PvdCreated(obuId, _getTxId());
        }
        
        pvdHistory[obuId].push(pvd);
        return _getTxId();
    }

    /**
     * @dev PVD 레코드 조회 (ReadPVD와 동일)
     * @param obuId OBU ID
     * @return pvd PVD 데이터 구조체
     */
    function readPvd(string memory obuId) external view returns (PvdHist memory) {
        require(_pvdExists(obuId), "PVD does not exist");
        
        emit PvdRead(obuId);
        return pvdRecords[obuId];
    }

    /**
     * @dev PVD 레코드 업데이트 (UpdatePvd와 동일)
     * @param obuId OBU ID
     * @param pvd 업데이트할 PVD 데이터
     */
    function updatePvd(string memory obuId, PvdHist memory pvd) external onlyAuthorized {
        require(_pvdExists(obuId), "PVD does not exist");
        
        pvd.timestamp = block.timestamp;
        pvd.blockNumber = block.number;
        
        pvdRecords[obuId] = pvd;
        pvdHistory[obuId].push(pvd);
        
        emit PvdUpdated(obuId, _getTxId());
    }

    /**
     * @dev PVD 레코드 삭제 (DeletePvd와 동일)
     * @param obuId OBU ID
     */
    function deletePvd(string memory obuId) external onlyAuthorized {
        require(_pvdExists(obuId), "PVD does not exist");
        
        delete pvdRecords[obuId];
        delete pvdHistory[obuId];
        
        // allKeys에서 제거
        for (uint i = 0; i < allKeys.length; i++) {
            if (keccak256(bytes(allKeys[i])) == keccak256(bytes(obuId))) {
                allKeys[i] = allKeys[allKeys.length - 1];
                allKeys.pop();
                break;
            }
        }
        
        emit PvdDeleted(obuId);
    }

    /**
     * @dev PVD 존재 여부 확인 (PvdExists와 동일)
     * @param obuId OBU ID
     * @return exists 존재 여부
     */
    function pvdExists(string memory obuId) external view returns (bool) {
        return _pvdExists(obuId);
    }

    /**
     * @dev 모든 PVD 레코드 조회 (GetPvdWorldStates와 동일)
     * @return pvds PVD 데이터 배열
     */
    function getPvdWorldStates() external view returns (PvdHist[] memory) {
        PvdHist[] memory pvds = new PvdHist[](allKeys.length);
        
        for (uint i = 0; i < allKeys.length; i++) {
            pvds[i] = pvdRecords[allKeys[i]];
        }
        
        return pvds;
    }

    /**
     * @dev 모든 키 목록 조회 (GetKeyLists와 동일)
     * @return keys 키 배열
     */
    function getKeyLists() external view returns (string[] memory) {
        return allKeys;
    }

    /**
     * @dev 특정 키의 히스토리 조회 (GetHistroyForKey와 동일)
     * @param obuId OBU ID
     * @return history 히스토리 배열
     */
    function getHistoryForKey(string memory obuId) external view returns (PvdHist[] memory) {
        return pvdHistory[obuId];
    }

    /**
     * @dev 특정 키의 히스토리 개수 조회
     * @param obuId OBU ID
     * @return count 히스토리 개수
     */
    function getHistoryCount(string memory obuId) external view returns (uint256) {
        return pvdHistory[obuId].length;
    }

    /**
     * @dev 특정 인덱스의 히스토리 조회
     * @param obuId OBU ID
     * @param index 인덱스
     * @return pvd PVD 데이터
     */
    function getHistoryByIndex(string memory obuId, uint256 index) external view returns (PvdHist memory) {
        require(index < pvdHistory[obuId].length, "Index out of bounds");
        return pvdHistory[obuId][index];
    }

    /**
     * @dev 전체 레코드 개수 조회
     * @return count 전체 레코드 개수
     */
    function getTotalRecordCount() external view returns (uint256) {
        return allKeys.length;
    }

    /**
     * @dev 페이지네이션을 위한 레코드 조회
     * @param offset 시작 인덱스
     * @param limit 조회할 개수
     * @return pvds PVD 데이터 배열
     */
    function getPvdsWithPagination(uint256 offset, uint256 limit) external view returns (PvdHist[] memory) {
        require(offset < allKeys.length, "Offset out of bounds");
        
        uint256 endIndex = offset + limit;
        if (endIndex > allKeys.length) {
            endIndex = allKeys.length;
        }
        
        uint256 resultLength = endIndex - offset;
        PvdHist[] memory pvds = new PvdHist[](resultLength);
        
        for (uint256 i = 0; i < resultLength; i++) {
            pvds[i] = pvdRecords[allKeys[offset + i]];
        }
        
        return pvds;
    }

    /**
     * @dev 특정 필드로 검색 (간단한 구현)
     * @param field 검색할 필드명
     * @param value 검색할 값
     * @return pvds 매칭되는 PVD 데이터 배열
     */
    function searchByField(string memory field, string memory value) external view returns (PvdHist[] memory) {
        // 실제 구현에서는 더 복잡한 검색 로직이 필요
        // 여기서는 간단한 예시로 처리
        PvdHist[] memory results = new PvdHist[](0);
        return results;
    }

    // 내부 함수들

    /**
     * @dev PVD 존재 여부 확인 (내부 함수)
     * @param obuId OBU ID
     * @return exists 존재 여부
     */
    function _pvdExists(string memory obuId) internal view returns (bool) {
        return bytes(pvdRecords[obuId].obuId).length > 0;
    }

    /**
     * @dev 트랜잭션 ID 생성 (내부 함수)
     * @return txId 트랜잭션 ID
     */
    function _getTxId() internal view returns (string memory) {
        return string(abi.encodePacked("0x", _toHexString(uint160(msg.sender)), "_", _toString(block.timestamp)));
    }

    /**
     * @dev uint를 hex 문자열로 변환
     * @param value 변환할 값
     * @return hex 문자열
     */
    function _toHexString(uint256 value) internal pure returns (string memory) {
        if (value == 0) {
            return "0";
        }
        
        uint256 temp = value;
        uint256 digits;
        while (temp != 0) {
            digits++;
            temp /= 16;
        }
        
        bytes memory buffer = new bytes(digits);
        for (uint256 i = digits; i > 0; i--) {
            buffer[i - 1] = bytes1(uint8(48 + uint8(value % 16)));
            if (value % 16 >= 10) {
                buffer[i - 1] = bytes1(uint8(87 + uint8(value % 16)));
            }
            value /= 16;
        }
        
        return string(buffer);
    }

    /**
     * @dev uint를 문자열로 변환
     * @param value 변환할 값
     * @return 문자열
     */
    function _toString(uint256 value) internal pure returns (string memory) {
        if (value == 0) {
            return "0";
        }
        
        uint256 temp = value;
        uint256 digits;
        while (temp != 0) {
            digits++;
            temp /= 10;
        }
        
        bytes memory buffer = new bytes(digits);
        while (value != 0) {
            digits -= 1;
            buffer[digits] = bytes1(uint8(48 + uint256(value % 10)));
            value /= 10;
        }
        
        return string(buffer);
    }
}
