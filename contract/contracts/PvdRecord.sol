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
