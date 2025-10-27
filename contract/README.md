# PvdRecord 스마트 컨트랙트

Hyperledger Fabric Go chaincode를 EVM용 Solidity 스마트 컨트랙트로 변환한 PVD (Probe Vehicle Data) 기록 관리 시스템입니다.

## 개요

이 스마트 컨트랙트는 차량의 다양한 센서 데이터를 블록체인에 저장하고 관리하는 기능을 제공합니다. 원본 Go chaincode의 모든 주요 기능을 Solidity로 구현했습니다.

## 주요 기능

### 데이터 구조
- **PvdHist**: 차량 센서 데이터를 저장하는 구조체
  - OBU ID, 수집 시간, 위치 정보 (위도/경도)
  - 차량 상태 (속도, RPM, 기어, 브레이크 등)
  - 타이어 정보 (압력, 경고 상태)
  - 연료 정보 (퍼센트, 리터)
  - 기타 센서 데이터

### CRUD 기능
- `createUpdatePvd()`: 새로운 PVD 레코드 생성 또는 기존 레코드 업데이트
- `readPvd()`: 특정 OBU ID의 PVD 레코드 조회
- `updatePvd()`: 기존 PVD 레코드 업데이트
- `deletePvd()`: PVD 레코드 삭제
- `pvdExists()`: PVD 레코드 존재 여부 확인

### 쿼리 기능
- `getPvdWorldStates()`: 모든 PVD 레코드 조회
- `getKeyLists()`: 모든 키 목록 조회
- `getPvdsWithPagination()`: 페이지네이션을 통한 레코드 조회
- `getTotalRecordCount()`: 전체 레코드 개수 조회

### 히스토리 기능
- `getHistoryForKey()`: 특정 키의 히스토리 조회
- `getHistoryCount()`: 히스토리 개수 조회
- `getHistoryByIndex()`: 특정 인덱스의 히스토리 조회

### 권한 관리
- `authorizeUser()`: 사용자 권한 부여
- `revokeUser()`: 사용자 권한 해제
- 소유자만 권한 관리 가능

## 파일 구조

```
contracts/
├── PvdRecord.sol          # 메인 스마트 컨트랙트
test/
├── PvdRecordTest.sol      # 테스트 컨트랙트
scripts/
├── deploy.js              # 배포 스크립트
utils/
├── PvdRecordClient.js     # JavaScript 클라이언트 유틸리티
examples/
├── usage-example.js       # 사용 예제
```

## 설치 및 배포

### 1. 의존성 설치
```bash
cd /home/blockchain/fedblock/bi-index/contract
npm install
```

### 2. 컴파일
```bash
npx hardhat compile
```

### 3. 테스트 실행
```bash
npx hardhat test
```

### 4. 배포
```bash
npx hardhat run scripts/deploy.js --network <network-name>
```

## 사용법

### JavaScript 클라이언트 사용

```javascript
const { ethers } = require("hardhat");
const PvdRecordClient = require("./utils/PvdRecordClient");

async function example() {
    // 클라이언트 생성
    const client = new PvdRecordClient(contractAddress, signer);
    
    // 새로운 PVD 레코드 생성
    const pvdData = {
        obuId: "OBU-001",
        speed: 60,
        fuelPercent: 80,
        startvectorLatitude: "37.5665",
        startvectorLongitude: "126.9780"
        // ... 기타 필드들
    };
    
    const txHash = await client.createUpdatePvd(pvdData);
    console.log("트랜잭션 해시:", txHash);
    
    // 레코드 조회
    const pvd = await client.readPvd("OBU-001");
    console.log("속도:", pvd.speed.toString());
    
    // 히스토리 조회
    const history = await client.getHistory("OBU-001");
    console.log("히스토리 개수:", history.length);
}
```

### 직접 컨트랙트 호출

```javascript
const PvdRecord = await ethers.getContractFactory("PvdRecord");
const contract = PvdRecord.attach(contractAddress);

// 레코드 생성
const tx = await contract.createUpdatePvd(obuId, pvdStruct);
await tx.wait();

// 레코드 조회
const pvd = await contract.readPvd(obuId);
```

## 이벤트

컨트랙트는 다음 이벤트를 발생시킵니다:

- `PvdCreated(string indexed obuId, string txId)`: 새 PVD 레코드 생성 시
- `PvdUpdated(string indexed obuId, string txId)`: PVD 레코드 업데이트 시
- `PvdDeleted(string indexed obuId)`: PVD 레코드 삭제 시
- `PvdRead(string indexed obuId)`: PVD 레코드 조회 시

## 가스 최적화

- `string` 타입 대신 `bytes32` 사용 고려 (고정 길이 데이터의 경우)
- 배열 크기 제한 설정
- 불필요한 스토리지 읽기 최소화

## 보안 고려사항

- 접근 제어: 소유자와 권한이 있는 사용자만 데이터 수정 가능
- 입력 검증: 모든 입력값에 대한 유효성 검사
- 이벤트 로깅: 모든 중요한 작업에 대한 이벤트 발생

## 네트워크 지원

- Ethereum 메인넷
- Polygon
- BSC (Binance Smart Chain)
- 기타 EVM 호환 네트워크

## 라이선스

MIT License

## 기여

버그 리포트나 기능 제안은 이슈로 등록해 주세요.

## 연락처

프로젝트 관련 문의사항이 있으시면 연락해 주세요.
