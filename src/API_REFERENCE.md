# 🛠️ BI-Indexing React SDK API Reference

## useBiIndexing Hook

블록체인 인덱싱 기능을 React 앱에서 사용할 수 있도록 제공하는 Hook입니다.

### 반환 값
```javascript
const {
  loading,              // boolean: API 요청 중 여부
  error,                // string: 에러 메시지
  searchIntegrated,     // function: 통합 검색 (인덱스 + 블록체인)
  searchDirect,         // function: 직접 검색 (블록체인만)
  searchContract,       // function: 컨트랙트 검색
  getAllRequests,       // function: 전체 요청 조회
  getTotalCount,        // function: 총 요청 개수 조회
  getRequestsInRange,   // function: 범위별 요청 조회
  searchIndex,          // function: 인덱스 검색
  getPerformanceStats   // function: 성능 통계 조회
} = useBiIndexing(config);
```

### API 메서드

#### 1. searchIntegrated
- **설명**: 인덱스에서 트랜잭션 ID 조회 후 블록체인에서 상세 정보 조회 (권장)
- **사용법**:
```javascript
await searchIntegrated(purpose, { network, contractAddress })
```
- **파라미터**:
  - `purpose` (string): 검색 목적
  - `network` (string, optional): 네트워크 이름 (기본값: 'hardhat-local')
  - `contractAddress` (string, optional): 컨트랙트 주소

#### 2. searchDirect
- **설명**: 인덱스 없이 블록체인에서 직접 데이터 검색
- **사용법**:
```javascript
await searchDirect(purpose, { network, contractAddress })
```
- **파라미터**: 위와 동일

#### 3. searchContract
- **설명**: 스마트 컨트랙트에서 직접 데이터 조회 (페이징 지원)
- **사용법**:
```javascript
await searchContract(purpose, { pageSize, network })
```
- **파라미터**:
  - `purpose` (string): 검색 목적
  - `pageSize` (number, optional): 페이지 크기 (기본값: 100)
  - `network` (string, optional): 네트워크 이름

#### 4. getAllRequests
- **설명**: 전체 요청 목록 조회
- **사용법**:
```javascript
await getAllRequests({ pageSize, network })
```

#### 5. getTotalCount
- **설명**: 전체 요청 개수 조회
- **사용법**:
```javascript
await getTotalCount({ network })
```

#### 6. getRequestsInRange
- **설명**: 특정 범위의 요청 목록 조회
- **사용법**:
```javascript
await getRequestsInRange(startId, endId, { network })
```
- **파라미터**:
  - `startId` (number): 시작 ID
  - `endId` (number): 끝 ID

#### 7. searchIndex
- **설명**: 인덱스에서 직접 검색
- **사용법**:
```javascript
await searchIndex(searchParams)
```
- **파라미터**:
  - `searchParams` (object): 검색 파라미터

#### 8. getPerformanceStats
- **설명**: 인덱싱 및 검색 성능 통계 조회
- **사용법**:
```javascript
await getPerformanceStats()
```

---

## BiIndexing 컴포넌트

즉시 사용 가능한 검색 UI 컴포넌트입니다.

### Props
- `className` (string): CSS 클래스
- `style` (object): 인라인 스타일
- `config` (object): API 설정 (baseURL, defaultNetwork 등)
- `onResults` (function): 검색 결과 콜백
- `onError` (function): 에러 콜백

---

## 유틸리티 함수

- `shortenTxId(txId)` : 트랜잭션 ID 단축 표시
- `shortenAddress(address)` : 주소 단축 표시
- `formatProcessingTime(timeString)` : 처리 시간 포맷팅
- `formatNetworkName(network)` : 네트워크 이름 포맷팅
- `getSearchMethodDescription(method)` : 검색 방법 설명
- `getStatusColor(status)` : 상태별 색상 반환

---

## 타입 정의 (TypeScript)
- `SearchResult`, `Transaction`, `Request`, `BiIndexingConfig`, `SearchOptions` 등

---

## 환경 변수
- `REACT_APP_BI_INDEXING_API_URL`: API 서버 주소

---

## 참고
- 모든 API는 Promise를 반환하며, 에러 발생 시 throw됩니다.
- 사용 예시는 README.md의 "빠른 시작" 섹션을 참고하세요.
