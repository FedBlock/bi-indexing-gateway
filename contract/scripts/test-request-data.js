/**
 * 블록체인에서 특정 requestId의 데이터를 직접 조회하는 테스트 스크립트
 * 사용법: node test-request-data.js <requestId>
 */

const { ethers } = require('ethers');

// AccessManagement ABI (getRequestById만 필요)
const ABI = [
  {
    "inputs": [
      {
        "internalType": "uint256",
        "name": "_requestId",
        "type": "uint256"
      }
    ],
    "name": "getRequestById",
    "outputs": [
      {
        "components": [
          {
            "internalType": "address",
            "name": "requester",
            "type": "address"
          },
          {
            "internalType": "address",
            "name": "resourceOwner",
            "type": "address"
          },
          {
            "internalType": "enum AccessManagement.RequestStatus",
            "name": "status",
            "type": "uint8"
          },
          {
            "internalType": "string",
            "name": "purpose",
            "type": "string"
          },
          {
            "internalType": "string",
            "name": "organizationName",
            "type": "string"
          }
        ],
        "internalType": "struct AccessManagement.RequestDetail",
        "name": "",
        "type": "tuple"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  }
];

const CONTRACT_ADDRESS = "0x35Aeb97df598CA4C7f537E7A3253a4222CF04300";
const RPC_URL = "https://public-en-kairos.node.kaia.io";

async function checkRequestData(requestId) {
  try {
    console.log(`\n🔍 ===== Request ${requestId} 조회 시작 =====\n`);
    
    // Provider 생성 (ethers v6 문법)
    const provider = new ethers.JsonRpcProvider(RPC_URL);
    console.log(`📡 RPC URL: ${RPC_URL}`);
    console.log(`📍 Contract: ${CONTRACT_ADDRESS}\n`);
    
    // Contract 인스턴스 생성
    const contract = new ethers.Contract(CONTRACT_ADDRESS, ABI, provider);
    
    // 데이터 조회
    console.log(`⏳ 블록체인에서 데이터 조회 중...\n`);
    const result = await contract.getRequestById(requestId);
    
    // Status 매핑
    const statusMap = ['PENDING', 'APPROVED', 'REJECTED'];
    const statusText = statusMap[Number(result.status)] || 'UNKNOWN';
    
    // 결과 출력
    console.log(`✅ ===== 조회 결과 =====\n`);
    console.log(`Request ID:        ${requestId}`);
    console.log(`Requester:         ${result.requester}`);
    console.log(`Resource Owner:    ${result.resourceOwner}`);
    console.log(`Purpose:           ${result.purpose}`);
    console.log(`Organization:      ${result.organizationName}`);
    console.log(`Status:            ${statusText} (${result.status})`);
    console.log(`\n========================\n`);
    
    // 상세 분석
    console.log(`📊 ===== 상세 분석 =====\n`);
    console.log(`Requester 유효성:        ${result.requester !== ethers.ZeroAddress ? '✅ 유효' : '❌ 빈 주소'}`);
    console.log(`Resource Owner 유효성:   ${result.resourceOwner !== ethers.ZeroAddress ? '✅ 유효' : '❌ 빈 주소'}`);
    console.log(`Purpose 길이:            ${result.purpose.length} 문자`);
    console.log(`Organization 길이:       ${result.organizationName.length} 문자`);
    console.log(`\n========================\n`);
    
    // JSON 형태로도 출력
    console.log(`📄 JSON 형태:\n`);
    console.log(JSON.stringify({
      requestId: requestId,
      requester: result.requester,
      resourceOwner: result.resourceOwner,
      purpose: result.purpose,
      organizationName: result.organizationName,
      status: statusText,
      statusCode: Number(result.status)
    }, null, 2));
    console.log(`\n`);
    
  } catch (error) {
    console.error(`\n❌ ===== 오류 발생 =====\n`);
    console.error(`에러 메시지: ${error.message}`);
    
    if (error.reason) {
      console.error(`에러 이유: ${error.reason}`);
    }
    
    if (error.code) {
      console.error(`에러 코드: ${error.code}`);
    }
    
    console.error(`\n========================\n`);
    process.exit(1);
  }
}

// 커맨드라인 인자에서 requestId 가져오기
const requestId = process.argv[2];

if (!requestId) {
  console.error(`\n❌ 사용법: node test-request-data.js <requestId>\n`);
  console.error(`예시: node test-request-data.js 1\n`);
  process.exit(1);
}

// 실행
checkRequestData(requestId);

