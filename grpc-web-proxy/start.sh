#!/bin/bash

echo "🚀 BI-Index gRPC-Web Proxy 시작 중..."

# 현재 실행 중인 프록시 컨테이너 중지
echo "📦 기존 컨테이너 정리 중..."
docker-compose down

# grpcwebproxy 방식으로 시작
echo "🔄 grpcwebproxy 컨테이너 시작 중..."
docker-compose up -d grpcwebproxy

echo "✅ gRPC-Web Proxy가 시작되었습니다!"
echo "📡 프록시 주소: http://localhost:8080"
echo "🎯 백엔드 서비스:"
echo "   - Index Manager: localhost:50052"
echo "   - PVD/Access: localhost:19001"

# 컨테이너 상태 확인
echo "🔍 컨테이너 상태 확인 중..."
docker-compose ps

echo ""
echo "💡 사용법:"
echo "   - React 앱에서 http://localhost:8080 주소로 gRPC-Web 요청"
echo "   - Envoy 프록시 사용시: docker-compose --profile envoy up -d"
echo "   - 중지: docker-compose down"
