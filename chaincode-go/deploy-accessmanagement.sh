#!/bin/bash

# AccessManagement 체인코드 배포 스크립트
# 기존 pvd-network의 pvdchannel에 배포

set -e

# 색상 정의
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

# 설정
CHANNEL_NAME="pvdchannel"
CHAINCODE_NAME="accessmanagement"
CHAINCODE_VERSION="1.1"
CHAINCODE_SEQUENCE="9"
CHAINCODE_PATH="."

# 조직 설정 (기존 pvd 네트워크와 동일)
export FABRIC_CFG_PATH=/home/blockchain/fabric-samples/config/

# Org1 환경 설정
setGlobalsForOrg1() {
    export CORE_PEER_LOCALMSPID="Org1MSP"
    export CORE_PEER_TLS_ENABLED=true
    export CORE_PEER_TLS_ROOTCERT_FILE=/home/blockchain/fabric-samples/pvd-network/organizations/peerOrganizations/org1.example.com/peers/peer0.org1.example.com/tls/ca.crt
    export CORE_PEER_MSPCONFIGPATH=/home/blockchain/fabric-samples/pvd-network/organizations/peerOrganizations/org1.example.com/users/Admin@org1.example.com/msp
    export CORE_PEER_ADDRESS=localhost:7051
}

# Org2 환경 설정
setGlobalsForOrg2() {
    export CORE_PEER_LOCALMSPID="Org2MSP"
    export CORE_PEER_TLS_ENABLED=true
    export CORE_PEER_TLS_ROOTCERT_FILE=/home/blockchain/fabric-samples/pvd-network/organizations/peerOrganizations/org2.example.com/peers/peer0.org2.example.com/tls/ca.crt
    export CORE_PEER_MSPCONFIGPATH=/home/blockchain/fabric-samples/pvd-network/organizations/peerOrganizations/org2.example.com/users/Admin@org2.example.com/msp
    export CORE_PEER_ADDRESS=localhost:9051
}

echo -e "${BLUE}================================${NC}"
echo -e "${BLUE} AccessManagement 체인코드 배포 ${NC}"
echo -e "${BLUE}================================${NC}"
echo ""

# 1. 체인코드 패키징
echo -e "${YELLOW}1. 체인코드 패키징 중...${NC}"
peer lifecycle chaincode package ${CHAINCODE_NAME}.tar.gz \
    --path ${CHAINCODE_PATH} \
    --lang golang \
    --label ${CHAINCODE_NAME}_${CHAINCODE_VERSION}

if [ $? -eq 0 ]; then
    echo -e "${GREEN}✅ 체인코드 패키징 완료${NC}"
else
    echo -e "${RED}❌ 체인코드 패키징 실패${NC}"
    exit 1
fi

# 2. Org1에 체인코드 설치
echo -e "${YELLOW}2. Org1에 체인코드 설치 중...${NC}"
setGlobalsForOrg1
peer lifecycle chaincode install ${CHAINCODE_NAME}.tar.gz

if [ $? -eq 0 ]; then
    echo -e "${GREEN}✅ Org1 체인코드 설치 완료${NC}"
else
    echo -e "${RED}❌ Org1 체인코드 설치 실패${NC}"
    exit 1
fi

# 3. Org2에 체인코드 설치
echo -e "${YELLOW}3. Org2에 체인코드 설치 중...${NC}"
setGlobalsForOrg2
peer lifecycle chaincode install ${CHAINCODE_NAME}.tar.gz

if [ $? -eq 0 ]; then
    echo -e "${GREEN}✅ Org2 체인코드 설치 완료${NC}"
else
    echo -e "${RED}❌ Org2 체인코드 설치 실패${NC}"
    exit 1
fi

# 4. 체인코드 패키지 ID 조회
echo -e "${YELLOW}4. 체인코드 패키지 ID 조회 중...${NC}"
setGlobalsForOrg1
PACKAGE_ID=$(peer lifecycle chaincode queryinstalled | grep ${CHAINCODE_NAME}_${CHAINCODE_VERSION} | cut -d' ' -f3 | cut -d',' -f1)
echo "Package ID: $PACKAGE_ID"

if [ -z "$PACKAGE_ID" ]; then
    echo -e "${RED}❌ 패키지 ID를 찾을 수 없습니다${NC}"
    exit 1
fi

# 5. Org1에서 체인코드 승인
echo -e "${YELLOW}5. Org1에서 체인코드 승인 중...${NC}"
setGlobalsForOrg1
peer lifecycle chaincode approveformyorg \
    -o localhost:7050 \
    --ordererTLSHostnameOverride orderer.example.com \
    --tls \
    --cafile /home/blockchain/fabric-samples/pvd-network/organizations/ordererOrganizations/example.com/orderers/orderer.example.com/msp/tlscacerts/tlsca.example.com-cert.pem \
    --channelID $CHANNEL_NAME \
    --name $CHAINCODE_NAME \
    --version $CHAINCODE_VERSION \
    --package-id $PACKAGE_ID \
    --sequence $CHAINCODE_SEQUENCE \
    --signature-policy "OR('Org1MSP.peer','Org2MSP.peer')"
if [ $? -eq 0 ]; then
    echo -e "${GREEN}✅ Org1 체인코드 승인 완료${NC}"
else
    echo -e "${RED}❌ Org1 체인코드 승인 실패${NC}"
    exit 1
fi

# 6. Org2에서 체인코드 승인
echo -e "${YELLOW}6. Org2에서 체인코드 승인 중...${NC}"
setGlobalsForOrg2
peer lifecycle chaincode approveformyorg \
    -o localhost:7050 \
    --ordererTLSHostnameOverride orderer.example.com \
    --tls \
    --cafile /home/blockchain/fabric-samples/pvd-network/organizations/ordererOrganizations/example.com/orderers/orderer.example.com/msp/tlscacerts/tlsca.example.com-cert.pem \
    --channelID $CHANNEL_NAME \
    --name $CHAINCODE_NAME \
    --version $CHAINCODE_VERSION \
    --package-id $PACKAGE_ID \
    --sequence $CHAINCODE_SEQUENCE \
    --signature-policy "OR('Org1MSP.peer','Org2MSP.peer')"

if [ $? -eq 0 ]; then
    echo -e "${GREEN}✅ Org2 체인코드 승인 완료${NC}"
else
    echo -e "${RED}❌ Org2 체인코드 승인 실패${NC}"
    exit 1
fi

# 7. 체인코드 커밋 준비 상태 확인
echo -e "${YELLOW}7. 체인코드 커밋 준비 상태 확인 중...${NC}"
setGlobalsForOrg1
peer lifecycle chaincode checkcommitreadiness \
    --channelID $CHANNEL_NAME \
    --name $CHAINCODE_NAME \
    --version $CHAINCODE_VERSION \
    --sequence $CHAINCODE_SEQUENCE \
    --signature-policy "OR('Org1MSP.peer','Org2MSP.peer')" \
    --output json

# 8. 체인코드 커밋
echo -e "${YELLOW}8. 체인코드 커밋 중...${NC}"
setGlobalsForOrg1
peer lifecycle chaincode commit \
    -o localhost:7050 \
    --ordererTLSHostnameOverride orderer.example.com \
    --tls \
    --cafile /home/blockchain/fabric-samples/pvd-network/organizations/ordererOrganizations/example.com/orderers/orderer.example.com/msp/tlscacerts/tlsca.example.com-cert.pem \
    --channelID $CHANNEL_NAME \
    --name $CHAINCODE_NAME \
    --peerAddresses localhost:7051 \
    --tlsRootCertFiles /home/blockchain/fabric-samples/pvd-network/organizations/peerOrganizations/org1.example.com/peers/peer0.org1.example.com/tls/ca.crt \
    --peerAddresses localhost:9051 \
    --tlsRootCertFiles /home/blockchain/fabric-samples/pvd-network/organizations/peerOrganizations/org2.example.com/peers/peer0.org2.example.com/tls/ca.crt \
    --version $CHAINCODE_VERSION \
    --sequence $CHAINCODE_SEQUENCE \
    --signature-policy "OR('Org1MSP.peer','Org2MSP.peer')"

if [ $? -eq 0 ]; then
    echo -e "${GREEN}✅ 체인코드 커밋 완료${NC}"
else
    echo -e "${RED}❌ 체인코드 커밋 실패${NC}"
    exit 1
fi

# 9. 체인코드 초기화 호출
echo -e "${YELLOW}9. 체인코드 초기화 중...${NC}"
setGlobalsForOrg1
peer chaincode invoke \
    -o localhost:7050 \
    --ordererTLSHostnameOverride orderer.example.com \
    --tls \
    --cafile /home/blockchain/fabric-samples/pvd-network/organizations/ordererOrganizations/example.com/orderers/orderer.example.com/msp/tlscacerts/tlsca.example.com-cert.pem \
    -C $CHANNEL_NAME \
    -n $CHAINCODE_NAME \
    --peerAddresses localhost:7051 \
    --tlsRootCertFiles /home/blockchain/fabric-samples/pvd-network/organizations/peerOrganizations/org1.example.com/peers/peer0.org1.example.com/tls/ca.crt \
    --peerAddresses localhost:9051 \
    --tlsRootCertFiles /home/blockchain/fabric-samples/pvd-network/organizations/peerOrganizations/org2.example.com/peers/peer0.org2.example.com/tls/ca.crt \
    -c '{"function":"InitLedger","Args":[]}'

if [ $? -eq 0 ]; then
    echo -e "${GREEN}✅ 체인코드 초기화 완료${NC}"
else
    echo -e "${RED}❌ 체인코드 초기화 실패${NC}"
    exit 1
fi

echo ""
echo -e "${GREEN}🎉 AccessManagement 체인코드 배포 완료!${NC}"
echo -e "${BLUE}채널: $CHANNEL_NAME${NC}"
echo -e "${BLUE}체인코드: $CHAINCODE_NAME${NC}"
echo -e "${BLUE}버전: $CHAINCODE_VERSION${NC}"
echo ""

# 10. 테스트 호출
echo -e "${YELLOW}10. 테스트 호출 중...${NC}"
peer chaincode query \
    -C $CHANNEL_NAME \
    -n $CHAINCODE_NAME \
    -c '{"Args":["GetAllRequests"]}'

echo -e "${GREEN}✅ 배포 및 테스트 완료!${NC}"