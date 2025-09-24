# 🏗️ BI-Index Platform Architecture

## 📊 **현재 구현된 아키텍처 다이어그램**

```
┌─────────────────────────────────────────────────────────────────────────────────────┐
│                        High Performance BI-Index Platform Interface                 │
└─────────────────────────────────────────────────────────────────────────────────────┘
                                            │
                                            ▼
┌─────────────────────────────────────────────────────────────────────────────────────┐
│                              BI-Index Analysis Manager                              │
├─────────────────────┬─────────────────────┬─────────────────────┬─────────────────────┤
│     Query Handler   │   Performance       │   Data Processor    │  Response Manager   │
│                     │   Monitor           │                     │                     │
│  ┌─────────────┐   │  ┌─────────────┐   │  ┌─────────────┐   │  ┌─────────────┐   │
│  │   Parser    │   │  │   Timer     │   │  │  Batch      │   │  │  Formatter  │   │
│  │             │   │  │             │   │  │  Processor  │   │  │             │   │
│  └─────────────┘   │  └─────────────┘   │  └─────────────┘   │  └─────────────┘   │
│  ┌─────────────┐   │  ┌─────────────┐   │  ┌─────────────┐   │  ┌─────────────┐   │
│  │  Validator  │   │  │  Profiler   │   │  │  ABI        │   │  │  JSON       │   │
│  │             │   │  │             │   │  │  Decoder    │   │  │  Builder    │   │
│  └─────────────┘   │  └─────────────┘   │  └─────────────┘   │  └─────────────┘   │
└─────────────────────┴─────────────────────┴─────────────────────┴─────────────────────┘
                                            │
                    ┌───────────────────────┼───────────────────────┐
                    ▼                       ▼                       ▼
┌─────────────────────────────────┐ ┌─────────────────────────────────┐ ┌─────────────────┐
│     BI-Indexing Gateway API     │ │    Blockchain Direct API        │ │   Health API    │
│     (bi-indexing-gateway)       │ │    (Direct Query)               │ │                 │
└─────────────────────────────────┘ └─────────────────────────────────┘ └─────────────────┘
                    │                                   │
                    ▼                                   ▼
┌─────────────────────────────────┐ ┌─────────────────────────────────┐
│     Index Manager (gRPC)        │ │     Blockchain Networks         │
│     (idxmngr-go)                │ │     (EVM Adapters)              │
│                                 │ │                                 │
│  ┌─────────────────────────┐   │ │  ┌─────────────────────────┐   │
│  │    Index Operations     │   │ │  │     Hardhat Local       │   │
│  │  • Create Index         │   │ │  │   (localhost:8545)      │   │
│  │  • Insert Data          │   │ │  └─────────────────────────┘   │
│  │  • Search Data          │   │ │  ┌─────────────────────────┐   │
│  │  • Get Info             │   │ │  │       Hardhat           │   │
│  └─────────────────────────┘   │ │  │                         │   │
│                                 │ │  └─────────────────────────┘   │
│  ┌─────────────────────────┐   │ │  ┌─────────────────────────┐   │
│  │    gRPC Services        │   │ │  │        Monad            │   │
│  │  • Proto Definition     │   │ │  │  (testnet1.monad.xyz)   │   │
│  │  • Server Connection    │   │ │  └─────────────────────────┘   │
│  │  • Error Handling       │   │ │                                 │
│  └─────────────────────────┘   │ └─────────────────────────────────┘
└─────────────────────────────────┘
                    │
                    ▼
┌─────────────────────────────────────────────────────────────────────────────────────┐
│                              Index Storage Layer                                    │
├─────────────────────┬─────────────────────┬─────────────────────┬─────────────────────┤
│   Purpose Indexes   │   Custom Indexes    │   Event Indexes     │   Content Indexes   │
│                     │                     │                     │                     │
│  ┌─────────────┐   │  ┌─────────────┐   │  ┌─────────────┐   │  ┌─────────────┐   │
│  │ purpose.bf  │   │  │ gender.bf   │   │  │ event.bf    │   │  │ content.bf  │   │
│  │             │   │  │             │   │  │             │   │  │             │   │
│  │ • 수면       │   │  │ • 남자       │   │  │ • Access    │   │  │ • Tx Hash   │   │
│  │ • 혈압       │   │  │ • 여자       │   │  │   Requests  │   │  │ • Block     │   │
│  │ • 심박수     │   │  │             │   │  │   Saved     │   │  │   Numbers   │   │
│  └─────────────┘   │  └─────────────┘   │  └─────────────┘   │  └─────────────┘   │
│                     │                     │                     │                     │
│  ┌─────────────┐   │  ┌─────────────┐   │  ┌─────────────┐   │  ┌─────────────┐   │
│  │  Bloom      │   │  │   Age       │   │  │  Contract   │   │  │  Time       │   │
│  │  Filter     │   │  │  Region     │   │  │  Events     │   │  │  Series     │   │
│  │  (.bf)      │   │  │  Custom     │   │  │             │   │  │  Data       │   │
│  └─────────────┘   │  └─────────────┘   │  └─────────────┘   │  └─────────────┘   │
└─────────────────────┴─────────────────────┴─────────────────────┴─────────────────────┘
```

## 🔧 **컴포넌트 상세 설명**

### 1️⃣ **Platform Interface Layer**
- **bi-index-api-server** (Express.js)
- **Port**: 3001
- **Endpoints**: `/api/blockchain-search`

### 2️⃣ **BI-Index Analysis Manager**
```javascript
// 현재 구현된 주요 기능들
- Query Handler: 파라미터 파싱, 검증
- Performance Monitor: processingTime, indexSearchTime, directSearchTime
- Data Processor: 배치 처리, ABI 디코딩
- Response Manager: JSON 포맷팅, 에러 처리
```

### 3️⃣ **BI-Indexing Gateway** 
- **Location**: `bi-indexing-gateway/lib/indexing-client.js`
- **Protocol**: gRPC
- **Features**: 
  - Index + Blockchain 통합 검색
  - 자동 연결 관리
  - 배치 처리 최적화

### 4️⃣ **Index Manager (idxmngr-go)**
- **Protocol**: gRPC (port 50052)
- **Operations**: 
  - `createIndex()` - 인덱스 생성
  - `insertData()` - 데이터 삽입  
  - `searchData()` - 데이터 검색
  - `getIndexInfo()` - 인덱스 정보

### 5️⃣ **Blockchain Networks**
```yaml
Networks:
  - hardhat-local: "http://localhost:8545"
  - hardhat: "http://localhost:8545" 
  - monad: "https://testnet1.monad.xyz"

Contract:
  - Address: "0x5FbDB2315678afecb367f032d93F642f64180aa3"
  - ABI: AccessManagement.sol
```

### 6️⃣ **Index Storage Layer**
```
fileindex-go/data/hardhat-local/
├── purpose.bf      (수면, 혈압, 심박수)
├── gender.bf       (남자, 여자)  
├── age.bf          (사용자 정의)
├── region.bf       (사용자 정의)
└── custom.bf       (확장 가능)
```

## 🚀 **Data Flow**

### **인덱스 기반 검색 (indexed=true)**
```
1. API Request → BI-Index Analysis Manager
2. Query Handler → Parameter Parsing & Validation  
3. BI-Indexing Gateway → gRPC Call to idxmngr-go
4. Index Manager → Search in .bf files
5. Return TxIDs → Blockchain Detail Query
6. ABI Decoder → Event Parsing
7. Response Manager → JSON Response
```

### **블록체인 직접 검색 (indexed=false)**
```
1. API Request → BI-Index Analysis Manager
2. Query Handler → Parameter Parsing & Validation
3. BI-Indexing Gateway → Direct Blockchain Query
4. EVM Adapter → Contract Event Filtering  
5. ABI Decoder → Event Parsing
6. Response Manager → JSON Response
```

## 📊 **성능 메트릭스**

| 검색 방식 | 데이터량 | 처리시간 | 사용 컴포넌트 |
|----------|----------|----------|---------------|
| **인덱스** | 150건 | ~1.6초 | Gateway + Index Manager |
| **직접** | 150건 | ~6.8초 | Gateway + Blockchain |
| **성능차이** | - | **4.3배** | 인덱스 승리 🏆 |

## 🔧 **현재 구현 상태**

### ✅ **완료된 컴포넌트**
- ✅ Platform Interface (bi-index-api-server)
- ✅ BI-Indexing Gateway (통합 검색)
- ✅ Index Manager (idxmngr-go gRPC)
- ✅ EVM Adapters (Hardhat, Monad)
- ✅ Index Storage (.bf files)
- ✅ Performance Monitoring
- ✅ ABI Decoding
- ✅ Custom Index Support

### 🚧 **확장 가능 영역**
- 🔄 Time-Series Indexes
- 🔄 Spatio-Temporal Indexes  
- 🔄 Legacy DBMS Integration
- 🔄 Advanced Analytics
- 🔄 Real-time Monitoring Dashboard

---

📅 **생성일**: 2025-09-10  
🏷️ **버전**: v2.0 (통합 아키텍처)  
🔧 **상태**: Production Ready ✅
