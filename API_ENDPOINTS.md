# 🚀 BI-Index API 엔드포인트 가이드

## 📊 **성능 테스트용 API (1000건 데이터)**

### 1️⃣ **인덱스 기반 검색** (빠른 속도)
```
GET /api/indexed-transactions
```

**기본 검색**:
```bash
# 수면 데이터 검색 (150건 예상)
GET /api/indexed-transactions?network=hardhat-local&purpose=수면

# 혈압 데이터 검색 (423건 예상)
GET /api/indexed-transactions?network=hardhat-local&purpose=혈압

# 심박수 데이터 검색 (427건 예상)
GET /api/indexed-transactions?network=hardhat-local&purpose=심박수
```

**다중 목적 검색** (OR 연산):
```bash
# 수면 OR 혈압 (573건 예상)
GET /api/indexed-transactions?network=hardhat-local&purpose=수면,혈압

# 모든 목적 (1000건)
GET /api/indexed-transactions?network=hardhat-local&purpose=수면,혈압,심박수
```

**복합 필터링** (AND 연산):
```bash
# 혈압 AND 남자
GET /api/indexed-transactions?network=hardhat-local&purpose=혈압&gender=남자

# 수면 AND 여자
GET /api/indexed-transactions?network=hardhat-local&purpose=수면&gender=여자
```

### 2️⃣ **블록체인 직접 검색** (느린 속도, 비교용)
```
GET /api/blockchain-search
```

**기본 검색**:
```bash
# 수면 데이터 직접 검색
GET /api/blockchain-search?network=hardhat-local&purpose=수면

# 혈압 데이터 직접 검색
GET /api/blockchain-search?network=hardhat-local&purpose=혈압

# 심박수 데이터 직접 검색
GET /api/blockchain-search?network=hardhat-local&purpose=심박수
```

## 🧪 **성능 비교 테스트 시나리오**

### 📈 **테스트 케이스**:
1. **소규모** (150건): `purpose=수면`
2. **중규모** (423건): `purpose=혈압`
3. **대규모** (573건): `purpose=수면,혈압`
4. **전체** (1000건): `purpose=수면,혈압,심박수`

### 📊 **측정 지표**:
- ⏱️ **응답 시간** (`processingTime`)
- 📊 **정확성** (`totalCount` 일치 여부)
- 🔄 **일관성** (동일한 결과 반환 여부)

## 🎯 **예상 성능 결과**:
- **인덱스 검색**: ~50-200ms (빠름)
- **블록체인 직접**: ~500-2000ms (느림)
- **성능 차이**: 5-10배 예상

## 🔧 **기타 API**:
- `GET /api/health` - 서버 상태 확인
- `POST /api/register-custom-index` - 사용자 정의 인덱스 등록

---
📅 **생성일**: 2025-09-10  
🏷️ **버전**: v1.0 (1000건 테스트용)
