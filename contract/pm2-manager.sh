#!/bin/bash

# PM2 Hardhat 네트워크 관리 스크립트
# 사용법: ./pm2-manager.sh [start|stop|restart|status|logs|delete|test]

SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" &> /dev/null && pwd )"
cd "$SCRIPT_DIR"

case "$1" in
    start)
        echo "🚀 Hardhat 네트워크 시작 중..."
        pm2 start ecosystem.config.js --only hardhat-network
        echo "✅ Hardhat 네트워크가 백그라운드에서 실행 중입니다."
        echo "📊 상태 확인: npm run pm2:status"
        echo "📋 로그 확인: npm run pm2:logs"
        ;;
    stop)
        echo "⏹️ Hardhat 네트워크 중지 중..."
        pm2 stop hardhat-network
        echo "✅ Hardhat 네트워크가 중지되었습니다."
        ;;
    restart)
        echo "🔄 Hardhat 네트워크 재시작 중..."
        pm2 restart hardhat-network
        echo "✅ Hardhat 네트워크가 재시작되었습니다."
        ;;
    status)
        echo "📊 PM2 프로세스 상태:"
        pm2 status
        ;;
    logs)
        echo "📋 Hardhat 네트워크 로그 (Ctrl+C로 종료):"
        pm2 logs hardhat-network
        ;;
    delete)
        echo "🗑️ Hardhat 네트워크 프로세스 삭제 중..."
        pm2 delete hardhat-network
        echo "✅ Hardhat 네트워크 프로세스가 삭제되었습니다."
        ;;
    test)
        echo "🧪 성능 테스트 실행 중..."
        echo "📝 Hardhat 네트워크가 실행 중인지 확인하세요."
        node scripts/cli.js -cmd=performance-test -network=hardhat
        ;;
    test-pm2)
        echo "🧪 성능 테스트를 PM2로 백그라운드 실행..."
        pm2 start ecosystem.config.js --only hardhat-performance-test
        echo "📋 테스트 로그 확인: pm2 logs hardhat-performance-test"
        ;;
    *)
        echo "🔧 PM2 Hardhat 네트워크 관리 스크립트"
        echo "========================================"
        echo ""
        echo "사용법: $0 [command]"
        echo ""
        echo "명령어:"
        echo "  start     - Hardhat 네트워크 시작 (백그라운드)"
        echo "  stop      - Hardhat 네트워크 중지"
        echo "  restart   - Hardhat 네트워크 재시작"
        echo "  status    - PM2 프로세스 상태 확인"
        echo "  logs      - Hardhat 네트워크 로그 실시간 보기"
        echo "  delete    - Hardhat 네트워크 프로세스 삭제"
        echo "  test      - 성능 테스트 실행 (포그라운드)"
        echo "  test-pm2  - 성능 테스트 실행 (백그라운드)"
        echo ""
        echo "📝 NPM 스크립트:"
        echo "  npm run pm2:start    - PM2 시작"
        echo "  npm run pm2:status   - 상태 확인"
        echo "  npm run pm2:logs     - 로그 보기"
        echo "  npm run pm2:stop     - PM2 중지"
        echo ""
        echo "🚀 빠른 시작:"
        echo "  $0 start              # Hardhat 네트워크 시작"
        echo "  $0 test               # 성능 테스트 실행"
        echo "  $0 logs               # 로그 확인"
        ;;
esac
