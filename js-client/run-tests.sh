#!/bin/bash

echo "🚀 JavaScript Client Tests 시작..."
echo "=================================="

# 의존성 확인
if [ ! -d "node_modules" ]; then
    echo "📦 node_modules가 없습니다. npm install을 실행합니다..."
    npm install
fi

# gRPC 서버가 실행 중인지 확인
echo "🔍 gRPC 서버 연결 상태 확인 중..."
nc -z localhost 50052 2>/dev/null
if [ $? -eq 0 ]; then
    echo "✅ gRPC 서버가 실행 중입니다 (localhost:50052)"
else
    echo "❌ gRPC 서버가 실행되지 않았습니다."
    echo "   idxmngr-go 디렉토리에서 다음 명령어를 실행하세요:"
    echo "   go run server/main.go"
    exit 1
fi

echo ""
echo "🧪 Universal Organization Index Tests 실행 중..."
echo "================================================"

# 테스트 실행
npm run test:universal-org

echo ""
echo "🎯 테스트 완료!"
echo "================================================"
echo ""
echo "📋 사용 가능한 테스트 명령어:"
echo "  npm run test:universal-org  - 범용 조직 인덱스 테스트"
echo "  npm run test:all            - 모든 테스트 실행"
echo ""
echo "🔧 수동 테스트 실행:"
echo "  node test-universal-org.js"
