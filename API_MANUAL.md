# BI-Indexing Gateway API 사용 매뉴얼

REST API를 통한 블록체인 인덱싱 데이터 조회 및 관리

---

## 시스템 개요

- **프로젝트**: BI-Indexing Gateway
- **기능**: 블록체인 인덱싱 데이터 조회를 위한 REST API 게이트웨이
- **기본 포트**: 3001
- **API 문서**: `http://localhost:3001/api-docs` (Swagger UI)

---

## 서버 실행

```bash
cd bi-indexing-gateway
npm install
npm start
```

서버가 **포트 3001**에서 실행됩니다.

---

## API 엔드포인트

### 1. 인덱스 목록 조회

**엔드포인트**: `GET /api/index/list`

**쿼리 파라미터**:
- `forceRefresh` (선택): `true`로 설정하면 config.yaml을 직접 읽어서 동기화

**요청 예시**:
```bash
curl http://localhost:3001/api/index/list
curl http://localhost:3001/api/index/list?forceRefresh=true
```

**응답 형식**:
```json
{
  "success": true,
  "data": {
    "indexCount": 2,
    "indexes": [
      {
        "indexId": "002",
        "indexName": "speeding",
        "indexingKey": "speed",
        "network": "kaia",
        "filePath": "data/kaia/speeding.bf",
        "keyColumn": "IndexableData",
        "fromBlock": "0",
        "currentBlock": "201234567"
      }
    ]
  },
  "timestamp": "2025-01-XX..."
}
```

---

### 2. 인덱스 생성

**엔드포인트**: `POST /api/index/create`

**요청 본문**:
```json
{
  "schema": "speeding",              // 선택
  "indexId": "002",                  // 선택: 자동 생성됨
  "indexName": "speeding",           // 선택: schema 사용
  "filePath": "data/kaia/speeding.bf", // 선택: 자동 생성
  "network": "kaia",                 // 필수
  "indexingKey": "speed",            // 선택: indexName 사용
  "blockNum": 0,                     // 선택
  "fromBlock": 0,                    // 선택
  "keySize": 64,                     // 선택: 기본값 30
  "searchableValues": null           // 선택
}
```

**요청 예시**:
```bash
curl -X POST http://localhost:3001/api/index/create \
  -H "Content-Type: application/json" \
  -d '{
    "indexName": "speeding",
    "indexingKey": "speed",
    "network": "kaia",
    "keySize": 64
  }'
```

**응답 형식**:
```json
{
  "success": true,
  "data": { ... },
  "indexId": "002",
  "indexName": "speeding",
  "schema": "speeding",
  "filePath": "data/kaia/speeding.bf",
  "fromBlock": undefined,
  "indexingKey": "speed",
  "searchableValues": null
}
```

**에러 응답** (중복 인덱스):
```json
{
  "success": false,
  "error": "이미 같은 설정의 인덱스가 존재합니다.",
  "errorType": "DUPLICATE_INDEX",
  "details": {
    "network": "kaia",
    "schema": "speeding",
    "indexingKey": "speed",
    "existingIndexId": "002"
  }
}
```

---

### 3. 데이터 인덱싱

**엔드포인트**: `POST /api/index/insert`

**요청 본문**:
```json
{
  "indexId": "003",                  // 필수: config.yaml에 존재해야 함
  "txId": "0x...",                   // 필수: 트랜잭션 해시
  "data": {                          // 필수: 인덱싱할 데이터 (자유로운 구조)
    "purpose": "심박수",
    "organization": "BIMATRIX",
    "blockNumber": 201100268
  },
  "filePath": "data/kaia/purpose.bf", // 선택: config에서 가져옴
  "network": "kaia",                  // 필수
  "schema": "purpose",               // 선택: config에서 가져옴
  "keySize": 64,                     // 선택: config에서 가져옴
  "contractAddress": "0x...",       // 선택: config에서 자동 로드
  "indexingKey": "purpose",          // 선택: data에서 자동 추출
  "eventName": "AccessRequestsSaved" // 선택: 기본값 "AccessRequestsSaved"
}
```

**요청 예시**:
```bash
curl -X POST http://localhost:3001/api/index/insert \
  -H "Content-Type: application/json" \
  -d '{
    "indexId": "003",
    "txId": "0xcf897c459ee1f87357361c69de5df0770cf7e19943d3a5d9893c0cc8c1dc0700",
    "data": {
      "purpose": "심박수",
      "organization": "BIMATRIX",
      "blockNumber": 201100268
    },
    "network": "kaia",
    "schema": "purpose",
    "indexingKey": "purpose"
  }'
```

**응답 형식**:
```json
{
  "success": true,
  "data": { ... },
  "usedKey": "심박수",
  "filePath": "data/kaia/purpose.bf",
  "indexId": "003",
  "schema": "purpose",
  "keySize": 64
}
```

**에러 응답** (필수 필드 누락):
```json
{
  "success": false,
  "error": "Missing required fields: txId, data, network"
}
```

**에러 응답** (인덱스 없음):
```json
{
  "success": false,
  "error": "indexId 003 (network kaia) not found in config"
}
```

---

### 4. 인덱스 삭제

**엔드포인트**: `DELETE /api/index/delete/:indexId`

**요청 예시**:
```bash
curl -X DELETE http://localhost:3001/api/index/delete/002
```

**응답 형식**:
```json
{
  "success": true,
  "deletedIndexId": "002",
  "message": "Index deleted successfully"
}
```

---

### 5. 인덱스 검색

**엔드포인트**: `POST /api/index/search`

**요청 본문**:
```json
{
  "IndexName": "purpose",            // 필수
  "Field": "IndexableData",          // 선택
  "Value": "심박수",                 // 선택
  "Begin": "spd::060::",            // Range 연산 시
  "End": "spd::999::",              // Range 연산 시
  "ComOp": 6,                       // 비교 연산자 (0=Eq, 1=NotEq, 2=Less, 3=LessThanEq, 4=Greater, 5=GreaterThanEq, 6=Range)
  "KeySize": 64                     // 선택
}
```

**요청 예시**:
```bash
curl -X POST http://localhost:3001/api/index/search \
  -H "Content-Type: application/json" \
  -d '{
    "IndexName": "purpose",
    "Field": "IndexableData",
    "Value": "심박수",
    "ComOp": 0
  }'
```

**응답 형식**:
```json
{
  "success": true,
  "data": {
    "IdxData": [
      "0xcf897c459ee1f87357361c69de5df0770cf7e19943d3a5d9893c0cc8c1dc0700"
    ]
  },
  "timestamp": "2025-01-XX..."
}
```

**에러 응답**:
```json
{
  "error": "IndexName이 필요합니다"
}
```

---

### 6. 과속 차량 조회 (블록체인 직접)

**엔드포인트**: `GET /api/pvd/speeding`

**쿼리 파라미터**:
- `network` (기본값: `hardhat-local`): 네트워크 이름
- `method` (기본값: `direct`): 조회 방법
- `minSpeed` (기본값: `60`): 최소 속도 (km/h)

**요청 예시**:
```bash
curl "http://localhost:3001/api/pvd/speeding?network=kaia&minSpeed=80"
```

**응답 형식**:
```json
{
  "success": true,
  "network": "kaia",
  "method": "blockchain-latest",
  "totalCount": 1627,
  "uniqueKeyCount": 1727,
  "queryTime": "45230ms",
  "data": {
    "type": "FeatureCollection",
    "features": [
      {
        "type": "Feature",
        "geometry": {
          "type": "Point",
          "coordinates": [127.024612, 37.5326]
        },
        "properties": {
          "obuId": "OBU-46101338",
          "speed": 120,
          "collectionDt": "20211001054509269",
          "timestamp": 1633045509269,
          "blockNumber": 201100268,
          "heading": 45
        }
      }
    ]
  },
  "timestamp": "2025-01-XX..."
}
```

---

### 7. 과속 차량 조회 (인덱스 기반)

**엔드포인트**: `POST /api/pvd/speeding/by-index`

**요청 본문**:
```json
{
  "minSpeed": 60,                    // 기본값: 60
  "network": "kaia"                 // 기본값: "kaia"
}
```

**요청 예시**:
```bash
curl -X POST http://localhost:3001/api/pvd/speeding/by-index \
  -H "Content-Type: application/json" \
  -d '{
    "network": "kaia",
    "minSpeed": 80
  }'
```

**응답 형식**:
```json
{
  "success": true,
  "network": "kaia",
  "method": "index-latest",
  "minSpeed": 80,
  "indexQueryTime": "250ms",
  "blockchainQueryTime": "1000ms",
  "totalQueryTime": "1250ms",
  "indexCount": 1727,
  "uniqueKeys": 1627,
  "totalResults": 1627,
  "resultCount": 1627,
  "data": {
    "type": "FeatureCollection",
    "features": [
      {
        "type": "Feature",
        "geometry": {
          "type": "Point",
          "coordinates": [127.024612, 37.5326]
        },
        "properties": {
          "obuId": "OBU-46101338",
          "speed": 120,
          "collectionDt": "20211001054509269",
          "timestamp": 1633045509269,
          "blockNumber": 201100268,
          "heading": 45,
          "txHash": "0x..."
        }
      }
    ]
  },
  "timestamp": "2025-01-XX..."
}
```

---

### 8. 블록체인 통계 조회

**엔드포인트**: `GET /api/blockchain/stats`

**쿼리 파라미터**:
- `network` (기본값: `kaia`): 네트워크 이름

**요청 예시**:
```bash
curl "http://localhost:3001/api/blockchain/stats?network=kaia"
```

**응답 형식**:
```json
{
  "success": true,
  "network": "kaia",
  "contractAddress": "0xe452Ae89B6c187F8Deee162153F946f07AF7aA82",
  "totalRecords": 15234,
  "methodUsed": "getTotalRecordCount",
  "errorDetails": null,
  "timestamp": "2025-01-XX..."
}
```

---

### 9. 헬스 체크

**엔드포인트**: `GET /health`

**요청 예시**:
```bash
curl http://localhost:3001/health
```

**응답 형식**:
```json
{
  "status": "OK",
  "timestamp": "2025-01-XX..."
}
```

---

## 지원 네트워크

설정 파일(`config/contracts.config.js`)에서 확인 가능:

- `kaia`: Kaia 테스트넷
- `monad`: Monad 테스트넷
- `hardhat-local`: Hardhat 로컬 네트워크
- `hardhat`: Hardhat 네트워크

---

## 사용 예시

### JavaScript/Node.js

```javascript
const axios = require('axios');
const BASE_URL = 'http://localhost:3001';

// 인덱스 목록 조회
async function getIndexList() {
  const response = await axios.get(`${BASE_URL}/api/index/list`);
  console.log(response.data);
}

// 인덱스 생성
async function createIndex() {
  const response = await axios.post(`${BASE_URL}/api/index/create`, {
    indexName: 'purpose',
    indexingKey: 'purpose',
    network: 'kaia',
    keySize: 64
  });
  console.log(response.data);
}

// 데이터 인덱싱
async function insertData() {
  const response = await axios.post(`${BASE_URL}/api/index/insert`, {
    indexId: '003',
    txId: '0xcf897c459ee1f87357361c69de5df0770cf7e19943d3a5d9893c0cc8c1dc0700',
    data: {
      purpose: '심박수',
      organization: 'BIMATRIX',
      blockNumber: 201100268
    },
    network: 'kaia',
    schema: 'purpose',
    indexingKey: 'purpose'
  });
  console.log(response.data);
}

// 인덱스 검색
async function searchIndex() {
  const response = await axios.post(`${BASE_URL}/api/index/search`, {
    IndexName: 'purpose',
    Field: 'IndexableData',
    Value: '심박수',
    ComOp: 0
  });
  console.log(response.data);
}
```

---

## Swagger UI

서버 실행 후 브라우저에서 접속:

```
http://localhost:3001/api-docs
```

---

## 에러 처리

모든 API는 다음 형식의 에러 응답을 반환합니다:

```json
{
  "success": false,
  "error": "에러 메시지",
  "timestamp": "2025-01-XX..."
}
```

HTTP 상태 코드:
- `400`: 잘못된 요청
- `404`: 리소스를 찾을 수 없음
- `500`: 서버 내부 오류

