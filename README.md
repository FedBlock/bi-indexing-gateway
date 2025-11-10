# BI-Indexing Gateway API

블록체인 인덱싱 데이터 조회를 위한 REST API 게이트웨이 서버

## 📋 목차

- [개요](#개요)
- [주요 기능](#주요-기능)
- [시스템 아키텍처](#시스템-아키텍처)
- [기술 스택](#기술-스택)
- [설치 및 실행](#설치-및-실행)
- [API 문서 (Swagger)](#api-문서-swagger)
- [API 엔드포인트](#api-엔드포인트)
- [설정](#설정)
- [실제 사용 사례](#실제-사용-사례)
- [라이센스](#라이센스)

---

## 개요

**BI-Indexing Gateway API**는 블록체인 데이터 인덱싱 시스템의 게이트웨이 역할을 수행하는 REST API 서버입니다. 
gRPC 기반 인덱스 매니저 서버(`idxmngr-go`)와 통신하여 인덱싱된 블록체인 데이터를 조회하고, 
인덱스 기반 고속 조회와 블록체인 실시간 조회를 모두 지원하여 성능과 정확성 사이의 균형을 제공합니다.

### 개발 배경

블록체인 데이터는 투명하고 불변적이지만, 대량의 트랜잭션 데이터를 실시간으로 조회하는 것은 매우 느리고 비효율적입니다.
예를 들어, 1,000건 이상의 트랜잭션을 블록체인에서 직접 조회할 경우 수십 초에서 수 분이 소요됩니다.

본 시스템은 **B+ Tree 기반 파일 인덱싱**을 통해 조회 속도를 대폭 개선하여,
연합학습, IoT 데이터 관리, 스마트 모빌리티 등 실시간성이 요구되는 블록체인 애플리케이션에서 활용할 수 있도록 개발되었습니다.

### 핵심 가치

- **고성능 데이터 조회**: B+ Tree 인덱싱으로 블록체인 직접 조회 대비 최대 100배 빠른 검색
- **하이브리드 접근**: 인덱스 기반 조회(빠름)와 블록체인 직접 조회(최신) 선택 가능
- **멀티체인 지원**: Kaia, Monad, Hardhat 등 다양한 EVM 호환 체인 지원
- **RESTful API**: 표준 HTTP/JSON 기반으로 모든 클라이언트에서 쉽게 통합

### 활용 분야

- **연합학습(Federated Learning)**: 데이터 접근 요청 기록 추적 및 권한 관리
- **스마트 모빌리티**: 차량 주행 데이터(PVD) 실시간 조회 및 과속 차량 탐지
- **IoT 데이터 관리**: 대량의 센서 데이터 트랜잭션 효율적 조회
- **블록체인 분석**: 트랜잭션 패턴 분석 및 통계 생성

---

## 주요 기능

### 1. 인덱스 관리
- 인덱스 생성 및 삭제
- 인덱스 목록 조회
- 데이터 인덱싱 (트랜잭션 기반)

### 2. 데이터 검색
- **인덱스 기반 검색**: B+ Tree를 활용한 초고속 검색
- **블록체인 직접 조회**: 최신 상태 확인
- 조건별 필터링 (속도, 범위 등)

### 3. 블록체인 통합
- 스마트 컨트랙트 읽기
- 트랜잭션 조회 및 디코딩
- 멀티체인 네트워크 지원


---

## 시스템 아키텍처

```
┌─────────────────────────────────────────────────────────────┐
│                       Client Application                     │
│                  (Web, Mobile, Desktop)                      │
└───────────────────────────┬─────────────────────────────────┘
                            │ HTTP/REST
                            ▼
┌─────────────────────────────────────────────────────────────┐
│              BI-Indexing Gateway API (Express)               │
│  ┌──────────────────────┐      ┌──────────────────────┐    │
│  │   REST API Handler   │      │  gRPC Client         │    │
│  └──────────────────────┘      └──────────────────────┘    │
└──────────────┬────────────────────────────┬─────────────────┘
               │                            │ gRPC
    Blockchain │                            ▼
         (RPC) │              ┌───────────────────────────┐
               │              │   idxmngr-go Server       │
               │              │   (Index Manager)         │
               │              └───────────┬───────────────┘
               │                          │
               ▼                          ▼
┌──────────────────────┐      ┌─────────────────────────┐
│  Blockchain Network  │      │  B+ Tree File Indexes   │
│  (Kaia/Monad/etc)    │      │  (.bf files)            │
└──────────────────────┘      └─────────────────────────┘
```

---

## 기술 스택

### Backend
- **Node.js** (v16+): JavaScript 런타임
- **Express.js**: REST API 프레임워크
- **@grpc/grpc-js**: gRPC 클라이언트 (idxmngr 통신)
- **ethers.js**: 이더리움/EVM 블록체인 인터페이스

### 블록체인
- **Kaia Testnet**: 메인 테스트 네트워크
- **Monad Testnet**: 추가 테스트 네트워크
- **Hardhat Local**: 로컬 개발 환경

---

## 설치 및 실행

### 사전 요구사항

1. **Node.js** v16 이상
2. **idxmngr-go** 서버 실행 중 (포트 50052)
3. **블록체인 네트워크** 접근 권한

### 설치

```bash
# 저장소 클론
git clone https://github.com/FedBlock/bi-indexing-gateway.git
cd bi-indexing-gateway

# 의존성 설치
npm install
```

### 설정

#### 1. 컨트랙트 설정 (`config/contracts.config.js`)

```javascript
const CONTRACT_ADDRESSES = {
  pvd: {
    kaia: '0xe452Ae89B6c187F8Deee162153F946f07AF7aA82',
    monad: '0x...',
    hardhat: '0x...'
  },
  accessManagement: {
    kaia: '0x7423fF426f31AC01dEB370C92D7aD5106e90991e',
    // ...
  }
};

const RPC_URLS = {
  kaia: 'https://public-en-kairos.node.kaia.io',
  monad: 'https://testnet-rpc.monad.xyz',
  hardhat: 'http://localhost:8545'
};
```

#### 2. 인덱싱 설정 (`config/indexing-config.js`)

```javascript
module.exports = {
  serverAddr: 'localhost:50052',  // idxmngr-go 서버 주소
  protoPath: path.join(__dirname, '../../bi-index/idxmngr-go/protos/index_manager.proto'),
  grpcOptions: {
    keepCase: true,
    longs: String,
    enums: String,
    defaults: true,
    oneofs: true
  }
};
```

### 실행

```bash
# 프로덕션 모드
npm start

# 개발 모드 (nodemon)
npm run dev
```

서버가 **포트 3001**에서 실행됩니다.

---

## API 문서 (Swagger)

서버 실행 후 브라우저에서 **인터랙티브 API 문서**에 접속할 수 있습니다.

### 📍 Swagger UI 접속

```
http://localhost:3001/api-docs
```

### 주요 기능

- **📖 전체 API 엔드포인트 문서**: 모든 API의 요청/응답 스펙 확인
- **🧪 Try it out**: 브라우저에서 직접 API 테스트
- **📋 Example Values**: 요청/응답 예시 자동 생성
- **🔍 Schema 확인**: 데이터 모델 구조 확인
- **📥 다운로드**: OpenAPI 스펙 파일 다운로드 가능

### 사용 방법

1. 서버 실행: `npm start`
2. 브라우저에서 `http://localhost:3001/api-docs` 접속
3. 원하는 API 엔드포인트 선택
4. **Try it out** 버튼 클릭
5. 파라미터 입력 후 **Execute** 실행
6. 응답 확인

### 스크린샷 예시

Swagger UI에서 다음과 같은 API들을 테스트할 수 있습니다:

- **Index Management**: 인덱스 생성, 삭제, 조회
- **Data Indexing**: 트랜잭션 데이터 인덱싱
- **Search**: 인덱스 기반 검색
- **PVD**: 과속 차량 조회 (직접/인덱스)
- **Blockchain**: 블록체인 통계

---

## 설정

### 환경 변수

프로젝트 루트에 `.env` 파일을 생성할 수 있습니다:

```env
# 서버 설정
PORT=3001
NODE_ENV=production

# gRPC 설정
GRPC_SERVER=localhost:50052

# 블록체인 RPC
KAIA_RPC_URL=https://public-en-kairos.node.kaia.io
MONAD_RPC_URL=https://testnet-rpc.monad.xyz
HARDHAT_RPC_URL=http://localhost:8545
```


기본적으로 모든 오리진을 허용합니다. `api/server.js`에서 수정 가능:

```javascript
app.use(cors({
  origin: ['http://localhost:3000', 'https://yourdomain.com'],
  methods: ['GET', 'POST', 'DELETE'],
  credentials: true
}));
```

---

## 성능 최적화

### Rate Limiting 설정

대량의 블록체인 조회 시 RPC 서버 부하를 방지하기 위해 배치 처리 및 딜레이를 적용합니다:

```javascript
// 배치 크기 및 딜레이
const BATCH_SIZE = 20;        // 동시 요청 수
const BATCH_DELAY = 800;      // 배치 간 딜레이 (ms)
const RETRY_DELAY = 1000;     // 재시도 간격 (ms)
```

---

## 프로젝트 구조

```
bi-indexing-gateway/
├── api/
│   └── server.js                  # Express API 서버
├── lib/
│   ├── grpc-client.js             # gRPC 클라이언트 (idxmngr 통신)
│   ├── indexing-constants.js     # 상수 정의
│   └── indexing-config.js        # 인덱싱 설정
├── config/
│   ├── contracts.config.js       # 컨트랙트 주소, RPC URL, ABI
│   └── indexing-config.js        # gRPC 설정
├── API_GUIDE.md                  # API 상세 가이드
├── README.md
├── package.json
└── package-lock.json
```

---

## 의존성

### 런타임
- `@grpc/grpc-js` ^1.9.0 - gRPC 클라이언트
- `@grpc/proto-loader` ^0.7.0 - Protobuf 로더
- `express` ^4.21.2 - 웹 프레임워크
- `cors` ^2.8.5 - CORS 미들웨어
- `ethers` ^6.15.0 - 블록체인 인터페이스

### 외부 서비스
- **idxmngr-go**: B+ Tree 기반 파일 인덱스 매니저 (gRPC 서버)
- **fileindex-go**: B+ Tree 파일 인덱싱 엔진
- **Blockchain RPC**: Kaia, Monad 등 EVM 호환 체인

---

## 버전 히스토리

### v1.0.0 (2025-11-10)
- 초기 릴리즈
- REST API 게이트웨이 기능
- gRPC 기반 인덱스 매니저 통신
- 멀티체인 지원 (Kaia, Monad, Hardhat)
- 인덱스 관리 및 검색 기능
- 블록체인 직접 조회 기능

