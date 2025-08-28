#!/bin/bash

# 색상 정의
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# 기본값 설정
DEFAULT_NETWORK="fabric"
DEFAULT_CONTRACT_ADDRESS="0xa513E6E4b8f2a923D98304ec87F64353C4D5C853"
DEFAULT_INDEX_NAME="Speed Index"
DEFAULT_OBU_ID="OBU_001"
DEFAULT_SPEED="80"
DEFAULT_ORG_NAME="삼성전자"

# 함수: 메인 메뉴
show_main_menu() {
    clear
    echo -e "${BLUE}================================${NC}"
    echo -e "${BLUE}    안녕하세요 bi-index입니다    ${NC}"
    echo -e "${BLUE}================================${NC}"
    echo ""
    echo -e "${YELLOW}1. 네트워크 선택${NC}"
    echo -e "${YELLOW}2. 인덱스 생성${NC}"
    echo -e "${YELLOW}3. 데이터 등록${NC}"
    echo -e "${YELLOW}4. 데이터 조회${NC}"
    echo -e "${YELLOW}5. 종료${NC}"
    echo ""
}

# 함수: 네트워크 선택
select_network() {
    clear
    echo -e "${BLUE}=== 네트워크 선택 ===${NC}"
    echo ""
    echo "사용 가능한 네트워크:"
    echo "1. fabric (Hyperledger Fabric)"
    echo "2. hardhat (로컬 개발)"
    echo "3. monad (Monad 테스트넷)"
    echo ""
    
    read -p "네트워크를 선택해주세요 (기본값: $DEFAULT_NETWORK): " network_choice
    
    case $network_choice in
        1) NETWORK="fabric" ;;
        2) NETWORK="hardhat" ;;
        3) NETWORK="monad" ;;
        "") NETWORK=$DEFAULT_NETWORK ;;
        *) 
            echo -e "${RED}잘못된 선택입니다. 기본값을 사용합니다.${NC}"
            NETWORK=$DEFAULT_NETWORK
            ;;
    esac
    
    echo -e "${GREEN}선택된 네트워크: $NETWORK${NC}"
    read -p "계속하려면 Enter를 누르세요..."
}

# 함수: 인덱스 생성
create_index() {
    clear
    echo -e "${BLUE}=== 인덱스 생성 ===${NC}"
    echo ""
    
    if [ -z "$NETWORK" ]; then
        echo -e "${RED}먼저 네트워크를 선택해주세요.${NC}"
        read -p "계속하려면 Enter를 누르세요..."
        return
    fi
    
    echo "현재 선택된 네트워크: $NETWORK"
    echo ""
    
    # 컨트랙트 주소 입력
    read -p "컨트랙트 주소 (기본값: $DEFAULT_CONTRACT_ADDRESS): " contract_address
    contract_address=${contract_address:-$DEFAULT_CONTRACT_ADDRESS}
    
    # 인덱스 이름 입력
    read -p "인덱스 이름 (기본값: $DEFAULT_INDEX_NAME): " index_name
    index_name=${index_name:-$DEFAULT_INDEX_NAME}
    
    # 인덱스 ID 생성
    if [ "$NETWORK" = "fabric" ]; then
        index_id="fabric_speed"
        key_col="Speed"
        key_size="5"
        file_path="fabric_speed.bf"
    else
        # EVM 네트워크: contract_address의 앞 8자리 사용
        contract_short=$(echo $contract_address | cut -c3-10)
        index_id="${NETWORK}_${contract_short}_speed"
        key_col="IndexableData"
        key_size="7"
        file_path="${NETWORK}_${contract_short}_speed.bf"
    fi
    
    echo ""
    echo -e "${YELLOW}생성할 인덱스 정보:${NC}"
    echo "  네트워크: $NETWORK"
    echo "  인덱스 ID: $index_id"
    echo "  인덱스 이름: $index_name"
    echo "  키 컬럼: $key_col"
    echo "  키 크기: $key_size"
    echo "  파일 경로: $file_path"
    echo ""
    
    read -p "인덱스를 생성하시겠습니까? (y/n): " confirm
    if [ "$confirm" = "y" ] || [ "$confirm" = "Y" ]; then
        echo ""
        echo -e "${GREEN}인덱스 생성 중...${NC}"
        
        # Node.js 스크립트 실행
        cd contract
        if [ "$NETWORK" = "fabric" ]; then
            # Fabric 인덱스는 mclient로 생성
            ../idxmngr-go/client/mclient -cmd fcreates
        else
            node scripts/create-evm-index.js "$NETWORK" "$index_id" "$index_name" "$key_col" "$file_path" "$key_size"
        fi
        
        if [ $? -eq 0 ]; then
            echo -e "${GREEN}✅ 인덱스 생성 완료!${NC}"
        else
            echo -e "${RED}❌ 인덱스 생성 실패!${NC}"
        fi
        
        cd ..
        read -p "계속하려면 Enter를 누르세요..."
    fi
}

# 함수: 데이터 등록
register_data() {
    clear
    echo -e "${BLUE}=== 데이터 등록 ===${NC}"
    echo ""
    
    if [ -z "$NETWORK" ]; then
        echo -e "${RED}먼저 네트워크를 선택해주세요.${NC}"
        read -p "계속하려면 Enter를 누르세요..."
        return
    fi
    
    echo "현재 선택된 네트워크: $NETWORK"
    echo ""
    
    if [ "$NETWORK" = "fabric" ]; then
        # Fabric 데이터 입력
        read -p "OBU ID (기본값: $DEFAULT_OBU_ID): " obu_id
        obu_id=${obu_id:-$DEFAULT_OBU_ID}
        
        read -p "Speed (기본값: $DEFAULT_SPEED): " speed
        speed=${speed:-$DEFAULT_SPEED}
        
        echo ""
        echo -e "${YELLOW}입력된 데이터:${NC}"
        echo "  OBU ID: $obu_id"
        echo "  Speed: $speed km/h"
        echo "  Network: $NETWORK"
        echo ""
        
        read -p "데이터를 등록하시겠습니까? (y/n): " confirm
        if [ "$confirm" = "y" ] || [ "$confirm" = "Y" ]; then
            echo ""
            echo -e "${GREEN}데이터 등록 중...${NC}"
            
            # grpc-go 직접 실행! (Node.js 스크립트 불필요)
            cd grpc-go
            echo "�� grpc-go 클라이언트 실행 중..."
            echo "   명령: go run client/client.go -cmd data -obu_id $obu_id -speed $speed"
            
            go run client/client.go -cmd data -obu_id "$obu_id" -speed "$speed"
            
            if [ $? -eq 0 ]; then
                echo -e "${GREEN}✅ Fabric 데이터 등록 완료!${NC}"
            else
                echo -e "${RED}❌ Fabric 데이터 등록 실패!${NC}"
            fi
            
            cd ..
        fi
        
    else
        # EVM 네트워크 데이터 입력
        read -p "Organization Name (기본값: $DEFAULT_ORG_NAME): " org_name
        org_name=${org_name:-$DEFAULT_ORG_NAME}
        
        read -p "Purpose (기본값: Business Partnership): " purpose
        purpose=${purpose:-"Business Partnership"}
        
        echo ""
        echo -e "${YELLOW}입력된 데이터:${NC}"
        echo "  Organization: $org_name"
        echo "  Purpose: $purpose"
        echo "  Network: $NETWORK"
        echo ""
        
        read -p "데이터를 등록하시겠습니까? (y/n): " confirm
        if [ "$confirm" = "y" ] || [ "$confirm" = "Y" ]; then
            echo ""
            echo -e "${GREEN}데이터 등록 중...${NC}"
            
            cd contract
            if [ "$NETWORK" = "hardhat" ]; then
                node scripts/samsung-with-indexing.js "$org_name" "$purpose"
            elif [ "$NETWORK" = "monad" ]; then
                node scripts/monad-with-indexing.js "$org_name" "$purpose"
            fi
            cd ..
            
            if [ $? -eq 0 ]; then
                echo -e "${GREEN}✅ 데이터 등록 완료!${NC}"
            else
                echo -e "${RED}❌ 데이터 등록 실패!${NC}"
            fi
        fi
    fi
    
    read -p "계속하려면 Enter를 누르세요..."
}

# 함수: 데이터 조회
search_data() {
    clear
    echo -e "${BLUE}=== 데이터 조회 ===${NC}"
    echo ""
    
    if [ -z "$NETWORK" ]; then
        echo -e "${RED}먼저 네트워크를 선택해주세요.${NC}"
        read -p "계속하려면 Enter를 누르세요..."
        return
    fi
    
    echo "현재 선택된 네트워크: $NETWORK"
    echo ""
    
    if [ "$NETWORK" = "fabric" ]; then
        echo "Fabric 데이터 조회:"
        echo "1. Speed로 검색"
        echo "2. OBU ID로 검색"
        echo ""
        read -p "검색 방법을 선택하세요 (1-2): " search_method
        
        case $search_method in
            1)
                read -p "검색할 Speed 값 (기본값: 80): " search_speed
                search_speed=${search_speed:-80}
                echo ""
                echo -e "${GREEN}Speed $search_speed로 검색 중...${NC}"
                cd idxmngr-go/client
                ./mclient -cmd fabric_exact0
                cd ../..
                ;;
            2)
                read -p "검색할 OBU ID (기본값: OBU_001): " search_obu
                search_obu=${search_obu:-OBU_001}
                echo ""
                echo -e "${GREEN}OBU ID $search_obu로 검색 중...${NC}"
                cd idxmngr-go/client
                ./mclient -cmd fabric_exact0
                cd ../..
                ;;
            *)
                echo -e "${RED}잘못된 선택입니다.${NC}"
                ;;
        esac
        
    else
        echo "EVM 네트워크 데이터 조회:"
        read -p "검색할 Organization Name (기본값: 삼성전자): " search_org
        search_org=${search_org:-삼성전자}
        echo ""
        echo -e "${GREEN}Organization $search_org로 검색 중...${NC}"
        
        cd contract
        if [ "$NETWORK" = "hardhat" ]; then
            node scripts/verify-indexed-data.js "IndexableData" "$search_org"
        elif [ "$NETWORK" = "monad" ]; then
            node scripts/verify-monad-indexed-data.js "IndexableData" "$search_org"
        fi
        cd ..
    fi
    
    read -p "계속하려면 Enter를 누르세요..."
}

# 메인 루프
while true; do
    show_main_menu
    read -p "선택하세요 (1-5): " choice
    
    case $choice in
        1) select_network ;;
        2) create_index ;;
        3) register_data ;;
        4) search_data ;;
        5) 
            echo -e "${GREEN}bi-index를 종료합니다. 안녕히 가세요!${NC}"
            exit 0
            ;;
        *) 
            echo -e "${RED}잘못된 선택입니다. 1-5 중에서 선택해주세요.${NC}"
            read -p "계속하려면 Enter를 누르세요..."
            ;;
    esac
done