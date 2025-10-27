# 건강 데이터 요청 예시

## 1. 블록체인 트랜잭션 요청 (contract.saveRequest)

**호출 예시**:
```javascript
contract.saveRequest(
  resourceOwner,  // 리소스 소유자 주소
  purpose,        // 목적 (심박수/혈당/혈압)
  organizationName // 조직명
)
```

**실제 값**:
```javascript
// 요청 1 - 심박수
contract.saveRequest(
  "0x96c205b16bf94412b83cf21d32ea5cbd71da3d94",  // 리소스 소유자
  "심박수",                                        // 목적
  "BIHEALTH"                                      // 조직명
)

// 요청 2 - 혈당
contract.saveRequest(
  "0x21f8814f066283411015ceffa752e4d991fb3990",  // 리소스 소유자 (랜덤)
  "혈당",
  "BIHEALTH"
)

// 요청 3 - 혈압
contract.saveRequest(
  "0x96c205b16bf94412b83cf21d32ea5cbd71da3d94",  // 리소스 소유자 (랜덤)
  "혈압",
  "BIHEALTH"
)
```

## 2. 인덱싱 API 요청

**API 엔드포인트**: `POST https://grnd.bimatrix.co.kr/bc/idx/api/index/insert`

**Request Payload 예시**:
```json
{
  "indexId": "001",
  "txId": "0x2eb647cce9e09b013c7c5a5a23d4e5f5c336b4489e005aa214600997ec2b324f",
  "data": {
    "purpose": "심박수",
    "organization": "BIHEALTH",
    "requester": "0xa5cc9D9F1f68546060852f7c685B99f0cD532229",
    "blockNumber": 12345,
    "txStatus": 1,
    "resourceOwner": "0x96c205b16bf94412b83cf21d32ea5cbd71da3d94",
    "client_id": "script"
  },
  "network": "kaia",
  "contractAddress": "0xcBf9a9d52b75218D06af17f03D8a236550db879F",
  "schema": "purpose",
  "indexingKey": "purpose"
}
```

## 3. 실제 생성되는 트랜잭션 예시

### 요청 정보
- **요청자(Requester)**: `0xa5cc9D9F1f68546060852f7c685B99f0cD532229`
- **리소스 소유자(ResourceOwner)**: 
  - `0x96c205b16bf94412b83cf21d32ea5cbd71da3d94` (50%)
  - `0x21f8814f066283411015ceffa752e4d991fb3990` (50%)
- **조직명(OrganizationName)**: `BIHEALTH`
- **목적(Purpose)**: `심박수`, `혈당`, `혈압`

### 목적별 개수
- 심박수: 350건
- 혈당: 330건
- 혈압: 320건
- **총: 1000건**

### 분포
각 요청마다 리소스 소유자가 랜덤 선택되므로:
- 리소스 소유자1에게: 약 500건
- 리소스 소유자2에게: 약 500건


