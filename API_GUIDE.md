# 🚀 BI-Index API 완전 가이드

## 📊 **서버 정보**
- **URL**: `http://localhost:3001`
- **포트**: 3001
- **네트워크**: `hardhat-local` (메인)

---

## 🔥 **사용 가능한 API 엔드포인트**

### 1️⃣ **서버 상태 확인**
```http
GET /api/health
```
**응답 예시**:
```json
{
  "success": true,
  "message": "BI-Index API Server is running",
  "timestamp": "2025-09-10T03:27:13.786Z"
}
```

---

### 2️⃣ **인덱스 기반 검색** ⚡ (빠름 - 권장)
```http
GET /api/indexed-transactions
```

#### **기본 검색**:
```bash
# 수면 데이터 (150건)
GET /api/indexed-transactions?network=hardhat-local&purpose=수면

# 혈압 데이터 (423건)  
GET /api/indexed-transactions?network=hardhat-local&purpose=혈압

# 심박수 데이터 (427건)
GET /api/indexed-transactions?network=hardhat-local&purpose=심박수
```

#### **다중 목적 검색** (OR 연산):
```bash
# 수면 OR 혈압 (573건)
GET /api/indexed-transactions?network=hardhat-local&purpose=수면,혈압

# 모든 목적 (1000건)
GET /api/indexed-transactions?network=hardhat-local&purpose=수면,혈압,심박수
```

#### **복합 필터링** (AND 연산):
```bash
# 혈압 AND 남자
GET /api/indexed-transactions?network=hardhat-local&purpose=혈압&gender=남자

# 수면 AND 여자  
GET /api/indexed-transactions?network=hardhat-local&purpose=수면&gender=여자

# 혈압 AND 남자 (복합)
GET /api/indexed-transactions?network=hardhat-local&purpose=혈압&gender=남자
```

**응답 구조**:
```json
{
  "success": true,
  "network": "hardhat-local",
  "purpose": "수면",
  "operator": "SINGLE",
  "filters": {},
  "totalCount": 150,
  "errorCount": 0,
  "transactions": [
    {
      "txId": "0x...",
      "blockNumber": 151,
      "timestamp": 1757471321,
      "date": "2025-09-10T02:28:41.000Z",
      "status": "success",
      "requestId": "150",
      "requester": "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266",
      "resourceOwner": "0x71bE63f3384f5fb98995898A86B02Fb2426c5788",
      "purpose": "수면",
      "organizationName": "LG"
    }
  ],
  "processingTime": "1576ms",
  "timestamp": "2025-09-10T03:27:52.028Z"
}
```

---

### 3️⃣ **블록체인 직접 검색** 🐌 (느림 - 비교용)
```http
GET /api/blockchain-search
```

#### **기본 검색**:
```bash
# 수면 데이터 직접 검색
GET /api/blockchain-search?network=hardhat-local&purpose=수면

# 혈압 데이터 직접 검색  
GET /api/blockchain-search?network=hardhat-local&purpose=혈압

# 심박수 데이터 직접 검색
GET /api/blockchain-search?network=hardhat-local&purpose=심박수
```

**응답 구조**:
```json
{
  "success": true,
  "method": "blockchain-direct",
  "network": "hardhat-local",
  "purpose": "수면",
  "blockRange": "0-151 (전체)",
  "totalCount": 150,
  "transactions": [...],
  "processingTime": "6820ms",
  "timestamp": "2025-09-10T03:30:15.123Z"
}
```

---

### 4️⃣ **사용자 정의 인덱스 등록**
```http
POST /api/register-custom-index
```

**요청 본문**:
```json
{
  "network": "hardhat-local",
  "indexType": "age",
  "indexValue": "20대",
  "txIds": ["0x123...", "0x456..."]
}
```

---

## 📈 **성능 비교 결과** (1000건 기준)

| 검색 방법 | 데이터 건수 | 처리 시간 | 성능 |
|-----------|-------------|-----------|------|
| **인덱스 기반** | 150건 (수면) | **1,576ms** | ⚡ 빠름 |
| **블록체인 직접** | 150건 (수면) | **6,820ms** | 🐌 느림 |
| **성능 차이** | - | **4.3배 차이** | 🏆 인덱스 승 |

---

## 🎯 **추천 사용 시나리오**

### ✅ **인덱스 기반 검색 사용 시**:
- 일반적인 데이터 조회
- 빠른 응답이 필요한 경우
- 복합 필터링 (purpose + gender)
- 프로덕션 환경

### ✅ **블록체인 직접 검색 사용 시**:
- 인덱스 데이터 검증
- 디버깅 및 테스트
- 최신 블록 데이터 확인
- 개발 환경

---

## 🔧 **URL 인코딩 참고**

한글 파라미터는 자동으로 인코딩됩니다:
- `수면` → `%EC%88%98%EB%A9%B4`
- `혈압` → `%ED%98%88%EC%95%95`
- `심박수` → `%EC%8B%AC%EB%B0%95%EC%88%98`
- `남자` → `%EB%82%A8%EC%9E%90`
- `여자` → `%EC%97%AC%EC%9E%90`

---

## 🚨 **주의사항**

1. **네트워크**: 현재 `hardhat-local`만 지원
2. **데이터**: 1000건 테스트 데이터 기준
3. **인코딩**: 한글 파라미터는 URL 인코딩 필요
4. **성능**: 인덱스 기반 검색 권장 (4배 빠름)

---

📅 **최종 업데이트**: 2025-09-10  
🏷️ **버전**: v2.0 (성능 테스트 완료)
