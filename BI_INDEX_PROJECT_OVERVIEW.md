# BI-Index 프로젝트 개요

## 📋 목차
- [프로젝트 소개](#프로젝트-소개)
- [전체 아키텍처](#전체-아키텍처)
- [주요 컴포넌트](#주요-컴포넌트)
- [프로젝트 구조](#프로젝트-구조)
- [데이터 흐름](#데이터-흐름)
- [기술 스택](#기술-스택)

---

## 프로젝트 소개

**BI-Index**는 블록체인 데이터를 효율적으로 인덱싱하고 검색하기 위한 고성능 인덱싱 플랫폼입니다. 블록체인에서 직접 데이터를 조회하는 것보다 **2배 빠른 검색 속도**를 제공합니다.

---

## 전체 아키텍처

```
┌─────────────────────────────────────────────────────────────┐
│                    Client Applications                      │
│                    (Web, Mobile, etc.)                      │
└───────────────────────────┬─────────────────────────────────┘
                            │ HTTP REST API
                            ▼
┌─────────────────────────────────────────────────────────────┐
│         bi-indexing-gateway/                                 │
│         역할: REST API 게이트웨이                            │
│         포트: 3001                                           │
└──────────────┬──────────────────────────┬────────────────────┘
               │                          │
               │ gRPC                     │ Blockchain RPC
               ▼                          ▼
┌──────────────────────────┐  ┌──────────────────────────┐
│   idxmngr-go/             │  │   Blockchain Networks     │
│   역할: 인덱스 관리 서버   │  │   (Kaia/Monad/Hardhat)   │
│   포트: 50052            │  └──────────────────────────┘
└──────────┬───────────────┘
           │ gRPC
           ▼
┌─────────────────────────────────────────────────────────────┐
│         fileindex-go/                                       │
│         역할: B+ Tree 인덱스 엔진                            │
│         포트: 50053                                         │
└──────────┬──────────────────────────────────────────────────┘
           │
           ▼
┌─────────────────────────────────────────────────────────────┐
│         fileindex-go/data/                                  │
│         역할: 인덱스 파일 저장소                             │
│         (네트워크별 .bf 파일 저장)                           │
└─────────────────────────────────────────────────────────────┘
```

---

## 주요 컴포넌트

### 1. BI-Indexing Gateway (`bi-indexing-gateway/`)

**역할**: REST API 게이트웨이 서버

**기술 스택**:
- Node.js + Express.js
- gRPC 클라이언트 (`@grpc/grpc-js`)
- Ethers.js (블록체인 통신)

**주요 기능**:
- REST API 엔드포인트 제공 (포트 3001)
- 인덱스 관리 API (생성, 삭제, 조회)
- 데이터 인덱싱 API
- 인덱스 기반 검색 API
- 블록체인 직접 조회 API
- Swagger UI 제공 (`/api-docs`)

**주요 파일**:
- `api/server.js`: Express 서버 메인 파일
- `lib/grpc-client.js`: gRPC 클라이언트 (idxmngr 통신)
- `config/contracts.config.js`: 컨트랙트 주소 및 RPC URL 설정

---

### 2. Index Manager (`bi-index/idxmngr-go/`)

**역할**: 인덱스 관리 중앙 서버 (gRPC 서버)

**기술 스택**:
- Go
- gRPC (포트 50052)

**주요 기능**:
- 인덱스 생성/삭제 관리
- 데이터 인덱싱 요청 처리
- 인덱스 검색 요청 처리
- 인덱스 정보 조회
- `fileindex-go` 서버와 통신하여 실제 인덱스 작업 수행

**주요 파일**:
- `server/idxmngr.go`: gRPC 서버 메인 파일
- `manager/mserver.go`: 인덱스 관리 로직
- `config/config.yaml`: 인덱스 설정 파일
- `protos/index_manager.proto`: gRPC 프로토콜 정의

**gRPC 서비스**:
- `CreateIndex`: 인덱스 생성
- `InsertData`: 데이터 인덱싱
- `SearchData`: 인덱스 검색
- `GetIndexInfo`: 인덱스 정보 조회

---

### 3. File Index Server (`bi-index/fileindex-go/`)

**역할**: B+ Tree 기반 파일 인덱싱 엔진

**기술 스택**:
- Go
- gRPC (포트 50053)
- B+ Tree 라이브러리 (`github.com/timtadh/fs2/bptree`)

**주요 기능**:
- B+ Tree 기반 인덱스 파일 생성 및 관리
- 인덱스 데이터 삽입
- 고속 검색 연산 (등호, 범위, 비교 연산)
- 인덱스 파일 저장 (.bf 파일)

**주요 파일**:
- `server/fileidx.go`: gRPC 서버 메인 파일
- `fstree/fstree.go`: B+ Tree 인덱스 로직
- `protos/index_server.proto`: gRPC 프로토콜 정의

**인덱스 파일 형식**:
- `.bf` 파일: B+ Tree 기반 인덱스 파일
- 네트워크별로 디렉토리 분리 (`data/kaia/`, `data/monad/` 등)

---

### 4. gRPC Services (`bi-index/grpc-go/`)

**역할**: PVD 및 AccessManagement gRPC 서버

**기술 스택**:
- Go
- gRPC (포트 19001, 19002)

**주요 기능**:
- **PVD Service** (포트 19001): 차량 주행 데이터(PVD) 처리
- **AccessManagement Service** (포트 19002): 접근 권한 관리

**주요 파일**:
- `server/grpc_main.go`: PVD gRPC 서버
- `server/access_server.go`: AccessManagement gRPC 서버
- `handler/pvd.go`: PVD 핸들러
- `handler/access_management.go`: AccessManagement 핸들러

---

### 5. Chaincode (`bi-index/chaincode-go/`)

**역할**: 블록체인 체인코드 (스마트 컨트랙트)

**기술 스택**:
- Go
- Hyperledger Fabric 또는 EVM 체인코드

**주요 기능**:
- AccessManagement 스마트 컨트랙트
- 블록체인에 데이터 저장
- 이벤트 발생

---

### 6. Contract Scripts (`bi-index/contract/`)

**역할**: 스마트 컨트랙트 배포 및 테스트 스크립트

**기술 스택**:
- Node.js
- Hardhat / Web3.js

**주요 기능**:
- 스마트 컨트랙트 배포
- 인덱스 생성 스크립트
- 데이터 등록 및 검증 스크립트

---

## 프로젝트 구조

```
bi-index/
│
├── bi-indexing-gateway/          # 역할: REST API 게이트웨이
│   └── 역할: 클라이언트 요청을 받아 idxmngr-go와 통신하고 블록체인 조회 수행
│
├── idxmngr-go/                    # 역할: 인덱스 관리 중앙 서버
│   └── 역할: 인덱스 생성/삭제/검색 요청을 받아 fileindex-go에 전달
│
├── fileindex-go/                   # 역할: B+ Tree 인덱스 엔진
│   └── 역할: 실제 인덱스 파일(.bf)을 생성하고 검색 수행
│
├── grpc-go/                        # 역할: PVD 및 AccessManagement gRPC 서버
│   └── 역할: 차량 주행 데이터(PVD) 및 접근 권한 관리 서비스 제공
│
├── chaincode-go/                   # 역할: 블록체인 체인코드
│   └── 역할: 스마트 컨트랙트 코드 (블록체인에 배포)
│
├── contract/                       # 역할: 컨트랙트 배포 및 테스트 스크립트
│   └── 역할: 스마트 컨트랙트 배포 및 인덱싱 연동 스크립트
│
└── bi-index.sh                    # 통합 실행 스크립트
```

---

## 데이터 흐름

### 인덱스 기반 검색 (빠름, ~1.6초)

```
1. 클라이언트 → REST API 요청
   GET /api/index/search
   { "IndexName": "purpose", "Value": "심박수" }

2. BI-Indexing Gateway → gRPC 호출
   idxmngr-go의 SearchData 서비스 호출

3. Index Manager → File Index Server 호출
   fileindex-go의 GetindexDataByField 서비스 호출

4. File Index Server → B+ Tree 검색
   .bf 파일에서 고속 검색 수행
   → 트랜잭션 ID 목록 반환

5. Index Manager → 트랜잭션 ID 반환

6. BI-Indexing Gateway → 블록체인에서 상세 정보 조회
   트랜잭션 ID로 블록체인에서 실제 데이터 조회

7. 클라이언트 ← JSON 응답
   검색 결과 반환
```

### 블록체인 직접 검색 (느림, ~6.8초)

```
1. 클라이언트 → REST API 요청
   GET /api/blockchain/search?purpose=심박수&indexed=false

2. BI-Indexing Gateway → 블록체인 직접 조회
   Ethers.js로 스마트 컨트랙트 이벤트 필터링

3. 블록체인 → 이벤트 조회
   모든 블록을 스캔하여 조건에 맞는 이벤트 검색

4. 클라이언트 ← JSON 응답
   검색 결과 반환
```

### 데이터 인덱싱 흐름

```
1. 블록체인 트랜잭션 발생
   스마트 컨트랙트에서 이벤트 발생

2. BI-Indexing Gateway → 인덱싱 요청
   POST /api/index/insert
   { "indexId": "003", "txId": "0x...", "data": {...} }

3. Index Manager → File Index Server 호출
   InsertIndex 서비스로 데이터 삽입

4. File Index Server → B+ Tree 업데이트
   .bf 파일에 인덱스 데이터 추가

5. 완료
```

---

## 기술 스택

### Backend
- **Node.js** (v16+): JavaScript 런타임
- **Express.js**: REST API 프레임워크
- **Go**: 고성능 서버 구현

### 통신 프로토콜
- **gRPC**: 서버 간 통신 (idxmngr-go ↔ fileindex-go)
- **REST API**: 클라이언트와의 통신
- **HTTP/JSON**: 표준 웹 프로토콜

### 블록체인
- **Ethers.js**: 이더리움/EVM 블록체인 인터페이스
- **Kaia Testnet**: 메인 테스트 네트워크
- **Monad Testnet**: 추가 테스트 네트워크
- **Hardhat Local**: 로컬 개발 환경

### 인덱싱
- **B+ Tree**: 파일 기반 인덱스 구조
- **Protobuf**: gRPC 메시지 직렬화

---

## 주요 포트

| 서비스 | 포트 | 프로토콜 | 설명 |
|--------|------|----------|------|
| BI-Indexing Gateway | 3001 | HTTP/REST | REST API 서버 |
| Index Manager | 50052 | gRPC | 인덱스 관리 서버 |
| File Index Server | 50053 | gRPC | 파일 인덱스 서버 |
| PVD Service | 19001 | gRPC | PVD 데이터 서비스 |
| AccessManagement | 19002 | gRPC | 접근 권한 관리 서비스 |

---

## 성능 비교

| 검색 방식 | 데이터량 | 처리 시간 | 비고 |
|-----------|----------|-----------|------|
| **인덱스 검색** | 150건 | ~1.6초 | B+ Tree 기반 고속 검색 |
| **블록체인 직접** | 150건 | ~6.8초 | 모든 블록 스캔 |
| **성능 차이** | - | **4.3배** | 인덱스 검색이 훨씬 빠름 |

---

## 설정 파일

### 1. 인덱스 설정 (`idxmngr-go/config.yaml`)
인덱스 목록 및 설정을 관리하는 YAML 파일

```yaml
items:
  - idxid: "001"
    idxname: "purpose"
    indexingkey: "purpose"
    keycol: "IndexableData"
    filepath: "data/kaia/purpose.bf"
    network: "kaia"
    keysize: 64
```

### 2. 컨트랙트 설정 (`bi-indexing-gateway/config/contracts.config.js`)
블록체인 네트워크 및 컨트랙트 주소 설정

```javascript
const CONTRACT_ADDRESSES = {
  accessManagement: {
    kaia: '0x7423fF426f31AC01dEB370C92D7aD5106e90991e',
    monad: '0x...',
  }
};
```

---

## 실행 방법

### 1. 서비스 시작 순서

```bash
# 1. File Index Server 시작
cd bi-index/fileindex-go
go run server/fileidx.go

# 2. Index Manager 시작
cd bi-index/idxmngr-go
go run server/idxmngr.go

# 3. BI-Indexing Gateway 시작
cd bi-indexing-gateway
npm install
npm start
```

### 2. 통합 스크립트 사용

```bash
cd bi-index
./bi-index.sh
```

---

## API 사용 예시

### 인덱스 생성
```bash
curl -X POST http://localhost:3001/api/index/create \
  -H "Content-Type: application/json" \
  -d '{
    "indexName": "purpose",
    "indexingKey": "purpose",
    "network": "kaia",
    "keySize": 64
  }'
```

### 데이터 인덱싱
```bash
curl -X POST http://localhost:3001/api/index/insert \
  -H "Content-Type: application/json" \
  -d '{
    "indexId": "003",
    "txId": "0x...",
    "data": {
      "purpose": "심박수",
      "organization": "BIMATRIX"
    },
    "network": "kaia"
  }'
```

### 인덱스 검색
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

---
