# BI-Indexing Gateway API 가이드

## 🚀 빠른 시작

### 1. API 서버 실행

```bash
npm install
npm run server
```

서버가 `http://localhost:3001`에서 실행됩니다.

### 2. React에서 사용

#### Hook 설치 및 사용
```javascript
import useBiIndexing from './useBiIndexing';

function MyComponent() {
  const { searchIntegrated, loading, error } = useBiIndexing();
  
  const handleSearch = async () => {
    try {
      const result = await searchIntegrated('수면', 'hardhat-local');
      console.log(result.data);
    } catch (err) {
      console.error(err);
    }
  };

  return (
    <div>
      <button onClick={handleSearch} disabled={loading}>
        {loading ? '검색 중...' : '검색'}
      </button>
      {error && <p>오류: {error}</p>}
    </div>
  );
}
```

## 📚 API Endpoints

### 1. 통합 검색 (인덱스 + 블록체인)
**가장 빠른 검색 방법**

```javascript
POST /api/search/integrated
{
  "purpose": "수면",
  "network": "hardhat-local",
  "contractAddress": "0x5FbDB...", // 선택사항
  "abiPath": "./custom-abi.json"    // 선택사항
}
```

**cURL 예제:**
```bash
curl -X POST http://localhost:3001/api/search/integrated \
  -H "Content-Type: application/json" \
  -d '{"purpose":"수면","network":"hardhat-local"}'
```

### 2. 블록체인 직접 검색
**인덱스 없이 블록체인에서 직접 검색**

```javascript
POST /api/search/direct
{
  "purpose": "심박수",
  "network": "hardhat-local"
}
```

### 3. 컨트랙트 필터링 검색
**컨트랙트에서 페이징으로 검색**

```javascript
POST /api/search/contract
{
  "purpose": "혈압",
  "pageSize": 100,
  "network": "hardhat-local"
}
```

### 4. 전체 요청 조회

```javascript
GET /api/requests/all?pageSize=100&network=hardhat-local
```

### 5. 총 요청 개수

```javascript
GET /api/requests/count?network=hardhat-local
```

### 6. 범위별 요청 조회

```javascript
POST /api/requests/range
{
  "startId": 1,
  "endId": 100,
  "network": "hardhat-local"
}
```

### 7. 성능 통계

```javascript
GET /api/performance
```

## 🎯 React Hook API

### useBiIndexing()

```javascript
const {
  loading,              // boolean: 로딩 상태
  error,               // string: 에러 메시지
  searchIntegrated,    // 통합 검색
  searchDirect,        // 직접 검색
  searchContract,      // 컨트랙트 검색
  getAllRequests,      // 전체 요청 조회
  getTotalCount,       // 총 개수
  getRequestsInRange,  // 범위별 조회
  searchIndex,         // 인덱스 검색
  getPerformanceStats  // 성능 통계
} = useBiIndexing();
```

### 검색 메소드들

```javascript
// 통합 검색 (가장 권장)
const result = await searchIntegrated('수면', 'hardhat-local');

// 직접 검색 (느리지만 정확)
const result = await searchDirect('심박수', 'hardhat-local');

// 컨트랙트 검색 (빠름, 페이징)
const result = await searchContract('혈압', 100, 'hardhat-local');
```

## 📊 응답 형식

### 성공 응답
```json
{
  "success": true,
  "data": {
    "method": "integrated-search",
    "network": "hardhat-local",
    "purpose": "수면",
    "totalCount": 15,
    "transactions": [
      {
        "txId": "0x123...",
        "blockNumber": 100,
        "timestamp": 1640995200,
        "date": "2022-01-01T00:00:00.000Z",
        "status": "success",
        "requestId": "1",
        "requester": "0xabc...",
        "resourceOwner": "0xdef...",
        "purpose": "수면",
        "organizationName": "BIMATRIX"
      }
    ],
    "processingTime": 1250
  },
  "timestamp": "2025-09-24T04:59:00.000Z"
}
```

### 에러 응답
```json
{
  "success": false,
  "error": "purpose는 필수입니다",
  "timestamp": "2025-09-24T04:59:00.000Z"
}
```

## 🏗️ 성능 비교

| 검색 방법 | 속도 | 정확도 | 사용 시나리오 |
|----------|------|--------|--------------|
| **통합 검색** | ⚡⚡⚡ | ⭐⭐⭐ | 일반적인 검색 (권장) |
| **직접 검색** | ⚡ | ⭐⭐⭐ | 인덱스가 없는 경우 |
| **컨트랙트 검색** | ⚡⚡ | ⭐⭐⭐ | 대량 데이터 페이징 |

## 🔧 환경 변수

```bash
# .env 파일
PORT=3001
GRPC_SERVER=localhost:50052
PROTO_PATH=../../grpc-go/protos/index_manager.proto
```

## 🐛 문제 해결

### 일반적인 오류들

1. **"purpose는 필수입니다"**
   - 검색할 purpose 값을 반드시 전달해야 함

2. **"gRPC 서버에 연결되지 않음"**
   - idxmngr gRPC 서버가 실행 중인지 확인
   - 포트 50052가 열려있는지 확인

3. **"지원하지 않는 네트워크"**
   - 지원 네트워크: hardhat-local, hardhat, monad

4. **CORS 오류**
   - API 서버에서 CORS가 활성화되어 있음
   - 필요시 `cors` 설정 수정

### 디버깅
```bash
# 로그 레벨 설정
LOG_LEVEL=debug npm run server
```

## 🚀 배포

### PM2로 배포
```bash
npm install -g pm2
pm2 start api/server.js --name "bi-indexing-api"
```

### Docker로 배포
```dockerfile
FROM node:18
WORKDIR /app
COPY . .
RUN npm install
EXPOSE 3001
CMD ["npm", "run", "server"]
```

## 📈 모니터링

성능 통계 확인:
```bash
curl http://localhost:3001/api/performance
```

헬스체크:
```bash
curl http://localhost:3001/health
```