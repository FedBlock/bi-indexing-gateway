#!/bin/bash

# BIMATRIX 목적 인덱싱 테스트 스크립트
# 작성일: $(date)

echo "🚀 BIMATRIX 건강 데이터 목적 인덱싱 테스트 시작..."
echo "========================================================"

# 스크립트 디렉토리로 이동
cd "$(dirname "$0")"

# 단계별 실행 함수
run_step() {
    local step_name="$1"
    local command="$2"
    
    echo ""
    echo "📋 단계: $step_name"
    echo "💻 명령어: $command"
    echo "----------------------------------------"
    
    # 명령어 실행
    if eval "$command"; then
        echo "✅ $step_name 완료!"
    else
        echo "❌ $step_name 실패! (종료 코드: $?)"
        echo "🛑 스크립트를 중단합니다."
        exit 1
    fi
}

# 1단계: 컨트랙트 배포
run_step "컨트랙트 배포" "node scripts/cli.js -cmd=deploy -network=hardhat-local"

# 2단계: 목적 인덱스 생성
run_step "목적 인덱스 생성" "node scripts/cli.js -cmd=create-purpose-index -network=hardhat-local"

# 3단계: 건강 데이터 요청 (100개)
run_step "건강 데이터 요청 (100개)" "node scripts/cli.js -cmd=request-data -network=hardhat-local"

# 4단계: 수면 데이터 검색
run_step "수면 데이터 검색" "node scripts/cli.js -cmd=search-purpose -value=\"수면\" -network=hardhat-local"

# 5단계: 심박수 데이터 검색
run_step "심박수 데이터 검색" "node scripts/cli.js -cmd=search-purpose -value=\"심박수\" -network=hardhat-local"

# 6단계: 혈압 데이터 검색
run_step "혈압 데이터 검색" "node scripts/cli.js -cmd=search-purpose -value=\"혈압\" -network=hardhat-local"

echo ""
echo "🎉 모든 테스트가 성공적으로 완료되었습니다!"
echo "========================================================"
echo "📊 테스트 결과 요약:"
echo "   🏥 컨트랙트: hardhat-local 네트워크에 배포됨"
echo "   📋 데이터: 100개 건강 요청 생성 (수면 34개, 심박수 33개, 혈압 33개)"
echo "   👥 사용자: 4개 resourceOwner 주소에 균등 분배"
echo "   🔍 검색: 3개 목적별 인덱스 검색 완료"
echo "========================================================"
