package accessmanagement

import (
	"encoding/json"
	"fmt"
	"strconv"

	"github.com/hyperledger/fabric-contract-api-go/contractapi"
)

// 스마트컨트랙트 메인 구조체
type SmartContract struct {
	contractapi.Contract
}

// 요청 상태
type RequestStatus int 
const (
	PENDING RequestStatus = iota //0: 대기중
	APPROVED //1: 승인
	REJECTED //2: 거절
)

// 요청 상세 정보(solidity의 struct와 동일)
type RequestDetail struct {
	Requester string `json:"requester"`
	ResourceOwner string `json:"resourceOwner"`
	Status RequestStatus `json:"status"`
	Purpose string `json:"purpose"`
	OrganizationName string `json:"organizationName"`
}

// 체인코드 초기화
func (s *SmartContract) InitLedger(ctx contractapi.TransactionContextInterface) error {
	// 요청 번호 카운터를 0으로 초기화
	err := ctx.GetStub().PutState("requestCounter",[]byte("0"))
	if err != nil {
		return fmt.Errorf("초기화 실패: %v", err)
	}
	fmt.Println("AccessManagement 초기화 완료")
	return nil
}

// 접근 요청 생성 - pvd처럼 실제 TxId 반환
func (s *SmartContract) SaveRequest(ctx contractapi.TransactionContextInterface,
	resourceOwner,purpose, organizationName string)(string, error){
		//1. 입력값 검증
		if resourceOwner ==""|| purpose == "" || organizationName ==""{
			return "", fmt.Errorf("모든 필드를 입력해주세요")
		}

		//2. 새로운 요청 id 생성
		counterBytes, _ := ctx.GetStub().GetState("requestCounter")
		var requestId uint64 = 1
		if counterBytes != nil{
			counter, _ := strconv.ParseUint(string(counterBytes), 10, 64)
			requestId = counter + 1
		}

		//3. 요청 정보 생성 - 클라이언트 ID 상세 분석
		clientIdentity := ctx.GetClientIdentity()
		
		// 전체 클라이언트 ID
		requesterID, err := clientIdentity.GetID()
		if err != nil {
			return "", fmt.Errorf("클라이언트 ID 가져오기 실패: %v", err)
		}
		
		// MSPID (조직 정보)
		mspID, err := clientIdentity.GetMSPID()
		if err != nil {
			fmt.Printf("MSPID 가져오기 실패: %v\n", err)
		} else {
			fmt.Printf("🏢 클라이언트 조직 MSPID: %s\n", mspID)
		}
		
		// 속성 정보 (있는 경우)
		attrs, found, _ := clientIdentity.GetAttributeValue("role")
		if !found {
			attrs = "없음"
		}
		fmt.Printf("👤 클라이언트 ID: %s\n", requesterID)
		fmt.Printf("🎭 클라이언트 역할: %s\n", attrs)
		fmt.Printf("📝 요청된 resourceOwner: %s\n", resourceOwner)
		
		// 올바른 구분: requester(요청자) ≠ resourceOwner(리소스 소유자)
		fmt.Printf("✅ 요청자(requester): %s\n", requesterID)
		fmt.Printf("✅ 리소스 소유자(resourceOwner): %s\n", resourceOwner)
		
		request := RequestDetail{
			Requester: requesterID,        // 실제 클라이언트 ID (요청자)
			ResourceOwner: resourceOwner,  // 입력받은 리소스 소유자
			Status: PENDING,
			Purpose: purpose,
			OrganizationName: organizationName,
		}

		//4. JSON으로 변환해서 블록체인에 저장
		requestJSON, _ := json.Marshal(request)
		requestKey := fmt.Sprintf("request_%d", requestId)
		ctx.GetStub().PutState(requestKey, requestJSON)

		//5. 카운터 업데이트
		ctx.GetStub().PutState("requestCounter", []byte(strconv.FormatUint(requestId, 10)))

		//6. 소유자별 요청 ID 목록에 추가
		ownerKey := fmt.Sprintf("owner_requests_%s", resourceOwner)
		ownerRequestsBytes, _ := ctx.GetStub().GetState(ownerKey)

		var requestIdArray struct {
			RequestIds []uint64 `json:"requestIds"`
		}
		if ownerRequestsBytes != nil {
			json.Unmarshal(ownerRequestsBytes, &requestIdArray)
		}

		requestIdArray.RequestIds = append(requestIdArray.RequestIds, requestId)
		ownerRequestsJSON, _ := json.Marshal(requestIdArray)
		ctx.GetStub().PutState(ownerKey, ownerRequestsJSON)

		// RequestId와 TxId 모두 로그 출력
		txId := ctx.GetStub().GetTxID()
		fmt.Printf("요청 생성 완료: RequestID=%d, 소유자=%s, TxId=%s\n", requestId, resourceOwner, txId)
		
		// RequestId를 반환 (CLI에서 정확한 증가 확인을 위해)
		return strconv.FormatUint(requestId, 10), nil
}

// 요청 상태 변경 (승인/거부)
func (s *SmartContract) SaveRequestStatus(ctx contractapi.TransactionContextInterface, requestId uint64, status string) error {
	//1. 요청 정보 가져오기
	requestKey := fmt.Sprintf("request_%d", requestId)
	requestBytes, err := ctx.GetStub().GetState(requestKey)
	if err != nil || requestBytes == nil {
		return fmt.Errorf("요청을 찾을 수 없습니다: %d", requestId)
	}
	
	//2. JSON을 구조체로 변환
	var request RequestDetail
	json.Unmarshal(requestBytes, &request)
	
	//3. 권한 체크(데이터 소유자만 상태 변경 가능)
	callerID, err := ctx.GetClientIdentity().GetID()
	if err != nil {
		return fmt.Errorf("클라이언트 ID 가져오기 실패: %v", err)
	}
	if callerID != request.ResourceOwner {
		return fmt.Errorf("데이터 소유자만 상태를 변경할 수 있습니다")
	}
	
	//4. 이미 처리된 요청인지 체크
	if request.Status != PENDING {
		return fmt.Errorf("이미 처리된 요청입니다.")
	}

	//5. 새로운 상태 설정
	switch status{
	case "APPROVED":
		request.Status = APPROVED
	case "REJECTED":
		request.Status = REJECTED
	default:
		return fmt.Errorf("잘못된 상태입니다. APPROVED 또는 REJECTED만 가능합니다.")
	}
	
	//6. 업데이트된 정보를 다시 저장
	updatedJSON, _ := json.Marshal(request)
	ctx.GetStub().PutState(requestKey, updatedJSON)

	fmt.Printf("요청 상태가 업데이트되었습니다: ID=%d, 상태=%s\n", requestId, status)
	return nil
}

// 특정 요청 정보 조회
func (s *SmartContract) GetRequestById(ctx contractapi.TransactionContextInterface, requestIdStr string)(*RequestDetail, error){
	// 문자열을 uint64로 변환
	requestId, err := strconv.ParseUint(requestIdStr, 10, 64)
	if err != nil {
		return nil, fmt.Errorf("잘못된 요청 ID 형식: %s", requestIdStr)
	}
	
	
	requestKey := fmt.Sprintf("request_%d", requestId)
	requestBytes, err := ctx.GetStub().GetState(requestKey)
	if err != nil || requestBytes == nil{
		return nil, fmt.Errorf("요청을 찾을 수 없습니다: %d", requestId)
	}

	var request RequestDetail
	json.Unmarshal(requestBytes, &request)
	return &request, nil
}

// GetRequestId - 특정 소유자에게 요청된 모든 requestId 목록 반환
func (s *SmartContract) GetRequestId(ctx contractapi.TransactionContextInterface, owner string) ([]uint64, error) {
    if owner == "" {
        return nil, fmt.Errorf("소유자 주소를 입력해주세요")
    }

    // 소유자별 요청 ID 목록을 저장하는 키
    ownerKey := fmt.Sprintf("owner_requests_%s", owner)
    ownerRequestsBytes, err := ctx.GetStub().GetState(ownerKey)
    if err != nil {
        return nil, fmt.Errorf("소유자 요청 목록 가져오기 실패: %v", err)
    }

    if ownerRequestsBytes == nil {
        return []uint64{}, nil  // 빈 배열 반환
    }

    // JSON을 구조체로 변환
    var requestIdArray struct {
        RequestIds []uint64 `json:"requestIds"`
    }
    err = json.Unmarshal(ownerRequestsBytes, &requestIdArray)
    if err != nil {
        return nil, fmt.Errorf("요청 ID 목록 파싱 실패: %v", err)
    }

    return requestIdArray.RequestIds, nil
}

// 모든 요청 조회 (디버깅용)
func (s *SmartContract) GetAllRequests(ctx contractapi.TransactionContextInterface) ([]*RequestDetail, error) {
	// 모든 request_ 키를 가져오기
	resultsIterator, err := ctx.GetStub().GetStateByRange("request_", "request_~")
	if err != nil {
		return nil, fmt.Errorf("요청 목록 가져오기 실패: %v", err)
	}
	defer resultsIterator.Close()

	var requests []*RequestDetail
	for resultsIterator.HasNext() {
		queryResponse, err := resultsIterator.Next()
		if err != nil {
			return nil, fmt.Errorf("다음 결과 가져오기 실패: %v", err)
		}

		var request RequestDetail
		err = json.Unmarshal(queryResponse.Value, &request)
		if err != nil {
			return nil, fmt.Errorf("요청 정보 파싱 실패: %v", err)
		}

		requests = append(requests, &request)
	}

	return requests, nil
}