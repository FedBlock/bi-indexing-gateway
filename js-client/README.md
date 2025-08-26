# Idxmngr gRPC JavaScript Client

이 프로젝트는 `idxmngr-go`의 gRPC API를 JavaScript에서 호출할 수 있도록 하는 클라이언트입니다.

## 설치

```bash
npm install
```

## 사용법

### 1. 기본 클라이언트 생성

```javascript
const IdxmngrClient = require('./idxmngr-client');

const client = new IdxmngrClient('localhost:50052');
```

### 2. 인덱스 생성

```javascript
await client.createIndex(
  'org_samsung',           // 인덱스 ID
  'Organization_Samsung',  // 인덱스 이름
  'IndexableData_OrganizationName', // 키 컬럼
  'samsung.bf',            // 파일 경로
  32                       // 키 크기
);
```

### 3. 인덱스 정보 조회

```javascript
const indexInfo = await client.getIndexInfo('org_samsung');
console.log(indexInfo.ResponseMessage);
```

### 4. 인덱스 리스트 조회

```javascript
const indexList = await client.getIndexList();
console.log(`Found ${indexList.IndexCnt} indexes`);
```

### 5. 스마트 컨트랙트 트랜잭션 인덱싱

```javascript
await client.insertData(
  'org_samsung',           // 인덱스 ID
  '0x1234...',            // 트랜잭션 해시
  '삼성전자'               // 조직명
);
```

### 6. 데이터 검색

```javascript
const results = await client.searchData(
  'org_samsung',                           // 인덱스 ID
  'IndexableData_OrganizationName',        // 검색 필드
  '삼성전자',                              // 검색 값
  'Eq'                                     // 비교 연산자
);
```

## 테스트 실행

```bash
# 전체 테스트 실행
node test.js

# 특정 기능만 테스트
node -e "
const client = require('./idxmngr-client');
const c = new client();
setTimeout(async () => {
  await c.getIndexList();
  c.close();
}, 1000);
"
```

## API 메서드

| 메서드 | 설명 | 파라미터 |
|--------|------|----------|
| `createIndex()` | 인덱스 생성 | `indexID`, `indexName`, `keyCol`, `filePath`, `keySize` |
| `getIndexInfo()` | 인덱스 정보 조회 | `indexID` |
| `getIndexList()` | 인덱스 리스트 조회 | 없음 |
| `insertData()` | 데이터 삽입 | `indexID`, `txId`, `organizationName` |
| `searchData()` | 데이터 검색 | `indexID`, `field`, `value`, `comparisonOp` |
| `close()` | 연결 종료 | 없음 |

## 주의사항

1. **gRPC 서버 실행**: `idxmngr-go` 서버가 `localhost:50052`에서 실행 중이어야 합니다.
2. **Protobuf 파일**: `../idxmngr-go/protos/index_manager.proto` 경로에 protobuf 파일이 있어야 합니다.
3. **연결 대기**: 클라이언트 생성 후 약 1초 정도 대기해야 연결이 완료됩니다.

## 에러 처리

모든 메서드는 Promise를 반환하며, 에러 발생 시 reject됩니다:

```javascript
try {
  await client.createIndex('test', 'Test', 'Name', 'test.bf', 32);
} catch (error) {
  console.error('Index creation failed:', error.message);
}
```
