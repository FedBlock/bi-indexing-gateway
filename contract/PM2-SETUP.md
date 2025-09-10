# 🚀 PM2로 Hardhat 네트워크 관리하기

PM2를 사용하여 Hardhat 네트워크를 백그라운드에서 계속 실행하고 성능 테스트를 편리하게 수행할 수 있습니다.

## 📋 목차
- [빠른 시작](#빠른-시작)
- [PM2 명령어](#pm2-명령어)
- [NPM 스크립트](#npm-스크립트)
- [성능 테스트](#성능-테스트)
- [로그 관리](#로그-관리)
- [문제 해결](#문제-해결)

## 🚀 빠른 시작

### 1. Hardhat 네트워크 시작
```bash
# 방법 1: PM2 관리 스크립트 사용 (추천)
./pm2-manager.sh start

# 방법 2: NPM 스크립트 사용
npm run pm2:start

# 방법 3: 직접 PM2 명령어 사용
pm2 start ecosystem.config.js --only hardhat-network
```

### 2. 상태 확인
```bash
# 프로세스 상태 확인
./pm2-manager.sh status
# 또는
npm run pm2:status
```

### 3. 성능 테스트 실행
```bash
# 포그라운드에서 실행 (추천)
./pm2-manager.sh test

# 백그라운드에서 실행
./pm2-manager.sh test-pm2
```

### 4. 로그 확인
```bash
# 실시간 로그 보기
./pm2-manager.sh logs
# 또는
npm run pm2:logs
```

## 🛠️ PM2 명령어

### 관리 스크립트 사용 (추천)
```bash
./pm2-manager.sh start     # 네트워크 시작
./pm2-manager.sh stop      # 네트워크 중지
./pm2-manager.sh restart   # 네트워크 재시작
./pm2-manager.sh status    # 상태 확인
./pm2-manager.sh logs      # 로그 보기
./pm2-manager.sh delete    # 프로세스 삭제
./pm2-manager.sh test      # 성능 테스트 (포그라운드)
./pm2-manager.sh test-pm2  # 성능 테스트 (백그라운드)
```

### 직접 PM2 명령어 사용
```bash
# 시작
pm2 start ecosystem.config.js --only hardhat-network

# 중지
pm2 stop hardhat-network

# 재시작
pm2 restart hardhat-network

# 삭제
pm2 delete hardhat-network

# 상태 확인
pm2 status

# 로그 보기
pm2 logs hardhat-network
```

## 📦 NPM 스크립트

```bash
# PM2 관리
npm run pm2:start          # PM2 시작 (모든 앱)
npm run pm2:stop           # PM2 중지 (모든 앱)
npm run pm2:restart        # PM2 재시작 (모든 앱)
npm run pm2:delete         # PM2 삭제 (모든 앱)
npm run pm2:status         # 상태 확인
npm run pm2:logs           # 로그 보기

# Hardhat 네트워크만 관리
npm run hardhat:start      # Hardhat 네트워크만 시작
npm run hardhat:stop       # Hardhat 네트워크만 중지
npm run hardhat:restart    # Hardhat 네트워크만 재시작

# 성능 테스트
npm run performance-test       # 포그라운드에서 테스트
npm run performance-test:pm2   # 백그라운드에서 테스트
```

## 🧪 성능 테스트

### 2000건 데이터 성능 비교 테스트

```bash
# 1. Hardhat 네트워크 시작
./pm2-manager.sh start

# 2. 성능 테스트 실행
./pm2-manager.sh test
```

**테스트 내용:**
- 📊 **데이터 생성**: 2000건 (수면 700건, 심박수 650건, 혈당 650건)
- 🔍 **인덱스 검색**: B+ 트리 기반 빠른 검색
- ⛓️ **블록체인 직접 조회**: 전체 이벤트 로그 스캔
- 📈 **성능 비교**: 검색 시간, 속도 개선 배수 측정

**예상 결과:**
- 인덱스 검색: 1-10ms
- 블록체인 직접 조회: 100-1000ms+
- 속도 개선: 10-100배 빠름

## 📋 로그 관리

### 로그 파일 위치
```
contract/logs/
├── hardhat-combined.log      # Hardhat 통합 로그
├── hardhat-out.log           # Hardhat 표준 출력
├── hardhat-error.log         # Hardhat 에러 로그
├── performance-test-combined.log  # 성능 테스트 통합 로그
├── performance-test-out.log       # 성능 테스트 표준 출력
└── performance-test-error.log     # 성능 테스트 에러 로그
```

### 로그 확인 방법
```bash
# 실시간 로그 보기
pm2 logs hardhat-network

# 특정 로그 파일 보기
tail -f logs/hardhat-combined.log

# 에러 로그만 보기
tail -f logs/hardhat-error.log

# 성능 테스트 로그 보기
pm2 logs hardhat-performance-test
```

## 🔧 설정 파일

### ecosystem.config.js
PM2 설정 파일로 다음 앱들을 관리합니다:

1. **hardhat-network**: Hardhat 로컬 네트워크
2. **hardhat-performance-test**: 성능 비교 테스트

### 주요 설정
- **자동 재시작**: 활성화
- **메모리 제한**: 1GB
- **로그 관리**: 자동 로테이션
- **시간 스탬프**: 활성화

## ❓ 문제 해결

### 1. 포트 충돌 문제
```bash
# 8545 포트 사용 중인 프로세스 확인
lsof -i :8545

# 프로세스 종료
kill -9 [PID]
```

### 2. PM2 프로세스 정리
```bash
# 모든 PM2 프로세스 중지
pm2 kill

# 특정 프로세스만 삭제
pm2 delete hardhat-network
```

### 3. 로그 파일 정리
```bash
# 로그 파일 정리
pm2 flush

# 또는 직접 삭제
rm -rf logs/*.log
```

### 4. 네트워크 연결 확인
```bash
# Hardhat 네트워크 연결 테스트
curl -X POST -H "Content-Type: application/json" \
  --data '{"jsonrpc":"2.0","method":"eth_blockNumber","params":[],"id":1}' \
  http://localhost:8545
```

## 🎯 사용 예시

### 일반적인 개발 워크플로우
```bash
# 1. 개발 환경 시작
./pm2-manager.sh start

# 2. 상태 확인
./pm2-manager.sh status

# 3. 성능 테스트 실행
./pm2-manager.sh test

# 4. 로그 확인 (필요시)
./pm2-manager.sh logs

# 5. 개발 완료 후 정리
./pm2-manager.sh stop
```

### 장기간 실행
```bash
# 백그라운드에서 계속 실행
./pm2-manager.sh start

# 시스템 재부팅 후에도 자동 시작 (선택사항)
pm2 startup
pm2 save
```

## 📊 성능 모니터링

```bash
# PM2 모니터링 대시보드
pm2 monit

# 프로세스 상세 정보
pm2 show hardhat-network

# 리소스 사용량 확인
pm2 list
```

---

💡 **팁**: `./pm2-manager.sh` 명령어만 실행하면 모든 사용법을 확인할 수 있습니다!
