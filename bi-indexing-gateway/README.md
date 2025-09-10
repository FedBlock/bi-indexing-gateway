# BI-Index Blockchain Indexing Client

**이더리움 블록체인과 인덱싱 서버를 통합한 완전한 클라이언트 라이브러리**

## 🚀 주요 기능

### 1. **gRPC 인덱싱 서버 통신**
- idxmngr 서버와의 gRPC 통신
- 인덱스 생성, 데이터 삽입, 검색 기능
- 자동 연결 관리 및 오류 처리

### 2. **이더리움 블록체인 통신**
- 다중 네트워크 지원 (Hardhat, Monad 등)
- 트랜잭션 상세 조회 및 ABI 디코딩
- 컨트랙트 이벤트 조회
- 실시간 블록체인 데이터 분석

### 3. **통합 검색 기능**
- 인덱스 + 블록체인 데이터 통합 검색
- 고성능 배치 처리
- 자동 데이터 매핑 및 정렬

## 📦 설치

```bash
npm install @bi-index/blockchain-indexing-client
```

## 🔧 기본 사용법

### 1. 기본 설정

```javascript
const IndexingClient = require('@bi-index/blockchain-indexing-client');

const client = new IndexingClient({
  serverAddr: 'localhost:50052',
  protoPath: './protos/index_manager.proto'
});
```

### 2. 이더리움 네트워크 연결

```javascript
// 지원 네트워크: hardhat-local, hardhat, monad
await client.connectEthereumNetwork('hardhat-local');
```

### 3. 통합 검색 (인덱스 + 블록체인)

```javascript
const result = await client.searchBlockchainAndIndex(
  '수면',  // 검색할 목적
  'hardhat-local',  // 네트워크
  '0x5FbDB2315678afecb367f032d93F642f64180aa3'  // 컨트랙트 주소
);

console.log(`검색 결과: ${result.totalCount}개`);
result.transactions.forEach(tx => {
  console.log(`- ${tx.txId}: ${tx.purpose} (${tx.status})`);
});
```

### 4. 개별 기능 사용

#### 인덱스 검색
```javascript
const indexResult = await client.searchData({
  IndexID: 'purpose',
  Value: '수면'
});
```

#### 트랜잭션 상세 조회
```javascript
const txDetails = await client.getTransactionDetails('0x123...');
console.log(`블록: ${txDetails.tx.blockNumber}`);
console.log(`가스: ${txDetails.receipt.gasUsed}`);
```

#### 컨트랙트 이벤트 조회
```javascript
const events = await client.queryContractEvents(
  '0x5FbDB2315678afecb367f032d93F642f64180aa3',
  './artifacts/AccessManagement.json',
  'AccessRequestsSaved'
);
```

## 🎯 고급 사용법

### ABI 디코딩

```javascript
const decoded = client.decodeTransactionABI(tx, receipt, './custom-abi.json');
console.log('함수:', decoded.function);
console.log('이벤트:', decoded.events);
```

### 네트워크 설정 커스터마이징

```javascript
const client = new IndexingClient();
client.networkConfigs['custom-network'] = 'https://my-rpc-url.com';
await client.connectEthereumNetwork('custom-network');
```

## 📋 API 레퍼런스

### 생성자 옵션

| 옵션 | 타입 | 기본값 | 설명 |
|------|------|--------|------|
| `serverAddr` | string | `localhost:50052` | gRPC 서버 주소 |
| `protoPath` | string | - | Protobuf 파일 경로 |
| `grpcOptions` | object | - | gRPC 연결 옵션 |

### 주요 메서드

#### 인덱싱 관련
- `createIndex(indexInfo)` - 인덱스 생성
- `insertData(indexData)` - 데이터 삽입
- `searchData(searchRequest)` - 데이터 검색
- `getIndexInfo(request)` - 인덱스 정보 조회

#### 블록체인 관련
- `connectEthereumNetwork(network)` - 네트워크 연결
- `getTransactionDetails(txId)` - 트랜잭션 조회
- `queryContractEvents(address, abi, event)` - 이벤트 조회
- `decodeTransactionABI(tx, receipt)` - ABI 디코딩

#### 통합 기능
- `searchBlockchainAndIndex(purpose, network)` - 통합 검색

## 🌐 지원 네트워크

| 네트워크 | RPC URL | 설명 |
|----------|---------|------|
| `hardhat-local` | `http://localhost:8545` | 로컬 Hardhat 네트워크 |
| `hardhat` | `http://localhost:8545` | Hardhat 네트워크 |
| `monad` | `https://testnet1.monad.xyz` | Monad 테스트넷 |

## 📚 예제

### 완전한 통합 예제

```bash
node examples/blockchain-integration.js
```

### 기본 사용법 예제

```bash
node examples/basic-usage.js
```

## 🔍 문제 해결

### 일반적인 오류

1. **"지원하지 않는 네트워크"**
   - `networkConfigs`에 네트워크 추가 필요

2. **"이더리움 네트워크에 먼저 연결해주세요"**
   - `connectEthereumNetwork()` 먼저 호출

3. **"Client is not connected to server"**
   - gRPC 서버 주소 및 상태 확인

### 디버깅

```javascript
// 상세 로그 활성화
process.env.LOG_LEVEL = 'debug';
```

## 🤝 기여

1. Fork the repository
2. Create your feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

## 📄 라이선스

MIT License - 자세한 내용은 [LICENSE](LICENSE) 파일을 참조하세요.

## 🏗️ 아키텍처

```
┌─────────────────────┐    ┌─────────────────────┐
│   IndexingClient    │    │   Ethereum Network  │
│                     │    │                     │
│  ┌───────────────┐  │    │  ┌───────────────┐  │
│  │ gRPC Client   │◄─┼────┼──┤ idxmngr Server│  │
│  └───────────────┘  │    │  └───────────────┘  │
│                     │    │                     │
│  ┌───────────────┐  │    │  ┌───────────────┐  │
│  │Ethereum Client│◄─┼────┼──┤ RPC Provider  │  │
│  └───────────────┘  │    │  └───────────────┘  │
│                     │    │                     │
│  ┌───────────────┐  │    │  ┌───────────────┐  │
│  │ ABI Decoder   │◄─┼────┼──┤ Smart Contract│  │
│  └───────────────┘  │    │  └───────────────┘  │
└─────────────────────┘    └─────────────────────┘
```

---

**Made with ❤️ by BI Index Team**
