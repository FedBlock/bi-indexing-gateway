# 🏗️ BI-Index Platform Architecture (Simplified)

## 📊 **실제 구현된 아키텍처**

```
┌─────────────────────────────────────────────────────────────────────────────────────┐
│                            Frontend / Client Applications                           │
└─────────────────────────────────────────────────────────────────────────────────────┘
                                            │ HTTP REST API
                                            ▼
┌─────────────────────────────────────────────────────────────────────────────────────┐
│                              BI-Index API Server                                   │
│                            (bi-index-api-server)                                   │
│                                 Port: 3001                                         │
│                                                                                     │
│    GET /api/blockchain-search?network=hardhat-local&purpose=수면&indexed=true      │
└─────────────────────────────────────────────────────────────────────────────────────┘
                                            │
                        ┌───────────────────┼───────────────────┐
                        ▼                   ▼                   ▼
                 indexed=true        indexed=false        /api/health
                                                              
┌─────────────────────────────────┐ ┌─────────────────────────────────┐ 
│        Index Search             │ │      Direct Search              │
│        (Fast ~1.6s)             │ │      (Slow ~6.8s)               │
└─────────────────────────────────┘ └─────────────────────────────────┘
                │                                   │
                ▼                                   ▼
┌─────────────────────────────────┐ ┌─────────────────────────────────┐
│     BI-Indexing Gateway         │ │     BI-Indexing Gateway         │
│   (bi-indexing-gateway)         │ │   (bi-indexing-gateway)         │
│                                 │ │                                 │
│  • gRPC Client                  │ │  • Ethereum Client              │
│  • Index Operations             │ │  • Contract Interaction        │
│  • Data Processing              │ │  • Event Filtering              │
└─────────────────────────────────┘ └─────────────────────────────────┘
                │                                   │
                ▼                                   ▼
┌─────────────────────────────────┐ ┌─────────────────────────────────┐
│        Index Manager            │ │      Blockchain Networks        │
│        (idxmngr-go)             │ │                                 │
│        Port: 50052              │ │  • Hardhat Local (:8545)        │
│                                 │ │  • Hardhat                      │
│  • Create Index                 │ │  • Monad (testnet)              │
│  • Insert Data                  │ │                                 │
│  • Search Data                  │ │  Contract:                      │
│  • Get Index Info               │ │  0x5FbDB2315678afecb367f032d93F │
└─────────────────────────────────┘ └─────────────────────────────────┘
                │
                ▼
┌─────────────────────────────────────────────────────────────────────────────────────┐
│                              Index Files (.bf)                                     │
│                        fileindex-go/data/hardhat-local/                           │
│                                                                                     │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐              │
│  │ purpose.bf  │  │ gender.bf   │  │   age.bf    │  │ region.bf   │              │
│  │             │  │             │  │             │  │             │              │
│  │ • 수면       │  │ • 남자       │  │ • 20대      │  │ • 서울      │              │
│  │ • 혈압       │  │ • 여자       │  │ • 30대      │  │ • 부산      │              │
│  │ • 심박수     │  │             │  │ • 40대      │  │ • 대구      │              │
│  └─────────────┘  └─────────────┘  └─────────────┘  └─────────────┘              │
│                                                                                     │
│                          (Bloom Filter 기반 고속 검색)                              │
└─────────────────────────────────────────────────────────────────────────────────────┘
```

## 🔧 **핵심 컴포넌트**

### 1️⃣ **BI-Index API Server**
- **Technology**: Node.js + Express.js
- **Port**: 3001
- **Main API**: `/api/blockchain-search`
- **Features**: 통합 검색 API (인덱스 vs 직접)

### 2️⃣ **BI-Indexing Gateway**  
- **Location**: `bi-indexing-gateway/lib/indexing-client.js`
- **Role**: 인덱스와 블록체인을 연결하는 게이트웨이
- **Features**: gRPC 클라이언트 + Ethereum 클라이언트

### 3️⃣ **Index Manager**
- **Technology**: Go + gRPC
- **Port**: 50052  
- **Storage**: Bloom Filter (.bf files)
- **Operations**: Create, Insert, Search, Info

### 4️⃣ **Blockchain Networks**
- **Hardhat Local**: localhost:8545
- **Contract**: AccessManagement (0x5FbDB...)
- **Events**: AccessRequestsSaved

## 📊 **검색 방식 비교**

| 방식 | 속도 | 경로 | 사용 시점 |
|------|------|------|-----------|
| **Index Search** | 🚀 빠름 (1.6초) | API → Gateway → Index Manager → .bf files | 일반 검색 |
| **Direct Search** | 🐌 느림 (6.8초) | API → Gateway → Blockchain → Contract Events | 검증/디버깅 |

## 🎯 **API 사용법**

```bash
# 인덱스 검색 (기본값, 빠름)
GET /api/blockchain-search?network=hardhat-local&purpose=수면&indexed=true

# 블록체인 직접 (느림, 검증용)
GET /api/blockchain-search?network=hardhat-local&purpose=수면&indexed=false

# 복합 필터 (인덱스만 지원)
GET /api/blockchain-search?network=hardhat-local&purpose=혈압&gender=남자&indexed=true
```

## 📈 **데이터 플로우**

### **Index Search (indexed=true)**
```
Client → API Server → BI-Indexing Gateway → Index Manager → .bf files → Response
```

### **Direct Search (indexed=false)**  
```
Client → API Server → BI-Indexing Gateway → Blockchain → Contract → Response
```

---

🏷️ **Version**: v1.0 Simple  
📅 **Date**: 2025-09-10  
✅ **Status**: Production Ready
