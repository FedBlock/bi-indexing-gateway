# BI-Index gRPC-Web Proxy

React 애플리케이션에서 BI-Index gRPC 서비스들과 통신하기 위한 프록시 서버입니다.

## 🏗️ 아키텍처

```
React App (localhost:3000)
    ↓ gRPC-Web 요청
gRPC-Web Proxy (localhost:8080)
    ↓ gRPC 요청
Backend Services:
  ├─ Index Manager (localhost:50052)
  └─ PVD/Access Management (localhost:19001)
```

## 🚀 실행 방법

### 1. Docker Compose 사용 (권장)

```bash
# 기본 grpcwebproxy 방식
./start.sh

# 또는 수동으로
docker-compose up -d

# Envoy 프록시 사용시
docker-compose --profile envoy up -d envoy-proxy
```

### 2. Node.js Express 프록시 사용

```bash
npm install
npm start
```

## 📡 서비스 엔드포인트

| 서비스 | 포트 | 설명 |
|--------|------|------|
| gRPC-Web Proxy | 8080 | React에서 접근하는 프록시 |
| Envoy Proxy | 8081 | 대안 프록시 (profile: envoy) |
| Express Proxy | 3001 | HTTP REST API 프록시 |
| Index Manager | 50052 | 인덱스 관리 gRPC 서비스 |
| PVD/Access | 19001 | PVD 및 접근 관리 gRPC 서비스 |

## 🔧 설정 파일

- `docker-compose.yml`: Docker 컨테이너 설정
- `envoy.yaml`: Envoy 프록시 설정
- `server.js`: Express HTTP 프록시 서버

## 💻 React에서 사용법

### 1. gRPC-Web 클라이언트 설치

```bash
npm install grpc-web
npm install google-protobuf
```

### 2. Proto 파일 컴파일

```bash
# protoc 설치 (Ubuntu)
sudo apt-get install protobuf-compiler

# JavaScript 코드 생성
protoc --js_out=import_style=commonjs:./src/proto \
       --grpc-web_out=import_style=commonjs,mode=grpcwebtext:./src/proto \
       ../grpc-go/protos/pvd_hist.proto

protoc --js_out=import_style=commonjs:./src/proto \
       --grpc-web_out=import_style=commonjs,mode=grpcwebtext:./src/proto \
       ../idxmngr-go/protos/index_manager.proto

protoc --js_out=import_style=commonjs:./src/proto \
       --grpc-web_out=import_style=commonjs,mode=grpcwebtext:./src/proto \
       ../grpc-go/accessapi/access_management.proto
```

### 3. React 컴포넌트 예시

```javascript
import { PvdClient } from './proto/pvd_hist_grpc_web_pb';
import { SinglePvd, ChainInfo, PvdHist_data } from './proto/pvd_hist_pb';

const client = new PvdClient('http://localhost:8080');

// PVD 데이터 저장
const putPvdData = async (obuId, speed) => {
  const chainInfo = new ChainInfo();
  chainInfo.setChannelname('pvdchannel');
  chainInfo.setChaincode('pvd');

  const pvdData = new PvdHist_data();
  pvdData.setObuId(obuId);
  pvdData.setSpeed(speed);
  
  const request = new SinglePvd();
  request.setChaininfo(chainInfo);
  request.setPvd(pvdData);

  try {
    const response = await client.putData(request, {});
    console.log('PVD 데이터 저장 성공:', response.toObject());
    return response;
  } catch (error) {
    console.error('PVD 데이터 저장 실패:', error);
    throw error;
  }
};
```

## 🔍 테스트

### gRPC-Web 연결 테스트

```bash
# 프록시 상태 확인
curl http://localhost:8080

# gRPC 서비스 상태 확인
grpcurl -plaintext localhost:50052 list
grpcurl -plaintext localhost:19001 list
```

### React 앱에서 테스트

```javascript
// 간단한 연결 테스트
const testConnection = async () => {
  try {
    const response = await fetch('http://localhost:8080', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/grpc-web+proto'
      }
    });
    console.log('프록시 연결 상태:', response.status);
  } catch (error) {
    console.error('프록시 연결 실패:', error);
  }
};
```

## 🐛 문제 해결

### CORS 오류
- Envoy 설정에서 CORS가 활성화되어 있습니다
- React 개발 서버에서 `"proxy": "http://localhost:8080"` 설정 추가

### 연결 실패
```bash
# 백엔드 서비스 상태 확인
netstat -tlnp | grep -E "(50052|19001)"

# Docker 컨테이너 로그 확인
docker-compose logs grpcwebproxy
```

### 프로토 컴파일 오류
```bash
# protoc 버전 확인
protoc --version

# grpc-web 플러그인 설치
sudo apt-get install protobuf-compiler-grpc-web
```

## 📚 참고 자료

- [gRPC-Web 공식 문서](https://github.com/grpc/grpc-web)
- [Envoy Proxy 설정](https://www.envoyproxy.io/docs/envoy/latest/configuration/http/http_filters/grpc_web_filter)
- [Protocol Buffers](https://developers.google.com/protocol-buffers)
