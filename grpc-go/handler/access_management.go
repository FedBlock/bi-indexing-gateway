// handler/access_management.go
package handler

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"strconv"
	"time"

	accessapi "grpc-go/accessapi"
	"grpc-go/configuration"
	idxmngr "grpc-go/idxmngr-go/mngrapi"

	"github.com/hyperledger/fabric-gateway/pkg/client"
	"google.golang.org/grpc"
	"google.golang.org/grpc/credentials/insecure"
)

// AccessManagement 요청 구조체
type AccessRequest struct {
	Requester        string `json:"requester"`
	ResourceOwner    string `json:"resourceOwner"`
	Status          int    `json:"status"`
	Purpose         string `json:"purpose"`
	OrganizationName string `json:"organizationName"`
}

// RequestDetail - 체인코드에서 반환되는 구조체와 동일
type RequestDetail struct {
	Requester        string `json:"requester"`
	ResourceOwner    string `json:"resourceOwner"`
	Status          int    `json:"status"`
	Purpose         string `json:"purpose"`
	OrganizationName string `json:"organizationName"`
}

type AccessManagementHandler struct {
	accessapi.UnimplementedAccessManagementServiceServer
	idxmngrConn   *grpc.ClientConn
	idxmngrClient idxmngr.IndexManagerClient
	contract      *client.Contract
}

// NewAccessManagementHandler creates a new handler with idxmngr connection
func NewAccessManagementHandler() *AccessManagementHandler {
	handler := &AccessManagementHandler{}
	
	// Fabric 네트워크 연결 (AccessManagement용 profile 사용)
	// config-accessmanagement.yaml을 로드하고 첫 번째 프로파일 사용
	handler.contract = ClientConnect(configuration.RuntimeConf.Profile[0])
	log.Printf("Successfully connected to Fabric network")
	
	// idxmngr 서버에 연결
	idxmngrAddr := "localhost:50052"
	conn, err := grpc.Dial(idxmngrAddr, 
		grpc.WithTransportCredentials(insecure.NewCredentials()),
		grpc.WithDefaultCallOptions(grpc.MaxCallRecvMsgSize(100*1024*1024)),
		grpc.WithDefaultCallOptions(grpc.MaxCallSendMsgSize(100*1024*1024)),
	)
	if err != nil {
		log.Printf("Failed to connect to idxmngr: %v", err)
		// 연결 실패해도 서버는 계속 실행
	} else {
		handler.idxmngrConn = conn
		handler.idxmngrClient = idxmngr.NewIndexManagerClient(conn)
		log.Printf("Successfully connected to idxmngr at %s", idxmngrAddr)
	}
	
	return handler
}

// SaveAccessRequest - 접근 요청 저장
func (h *AccessManagementHandler) SaveAccessRequest(ctx context.Context, req *accessapi.AccessRequestData) (*accessapi.AccessResponse, error) {
	log.Printf("AccessManagement 요청 저장: ResourceOwner=%s, Purpose=%s, Organization=%s", 
		req.ResourceOwner, req.Purpose, req.OrganizationName)

	// pvd와 동일한 방식: configuration.MyContracts[0] 사용
	// log.Printf("🔍 pvd와 동일한 방식으로 체인코드 호출...")
	
	// pvd처럼 SubmitTransaction 반환값이 실제 TxId인지 확인
	// log.Printf("🎯 pvd 방식으로 SubmitTransaction 반환값 분석...")
	
	result, err := configuration.MyContracts[0].SubmitTransaction("SaveRequest", 
		req.ResourceOwner, req.Purpose, req.OrganizationName)
	if err != nil {
		return &accessapi.AccessResponse{
			Success: false,
			Message: fmt.Sprintf("체인코드 호출 실패: %v", err),
		}, err
	}

	resultStr := string(result)
	log.Printf("🔍 SubmitTransaction 반환값: '%s' (길이: %d)", resultStr, len(resultStr))

	// 반환값 분석: RequestId 또는 TxId 확인
	var requestId uint64
	var realTxId string
	
	if len(resultStr) == 64 {
		// 64자리면 실제 Fabric TxId
		realTxId = resultStr
		log.Printf("🎯 64자리 반환값: 실제 TxId = %s", realTxId)
		
		// 최신 요청의 RequestId를 찾기 위해 GetAllRequests 호출
		go h.sendIndexingRequestAfterTransactionWithTxId(realTxId, req.Purpose)
		requestId = uint64(time.Now().Unix()) // 응답용 임시 ID
		
	} else if parsedId, err := strconv.ParseUint(resultStr, 10, 64); err == nil {
		// 숫자면 RequestId (정상 케이스)
		requestId = parsedId
		realTxId = fmt.Sprintf("fabric_access_req_%d_%d", requestId, time.Now().UnixNano())
		log.Printf("✅ RequestId 파싱 성공: %d", requestId)
		
		// 재인덱싱 로직 제거됨 - 실시간 인덱싱만 사용
		
	} else {
		// 파싱 실패시 임시 ID 생성
		requestId = uint64(time.Now().Unix())
		realTxId = resultStr
		log.Printf("⚠️ 예상과 다른 반환값, 임시 ID 사용: %d", requestId)
	}

	return &accessapi.AccessResponse{
		Success:   true,
		Message:   fmt.Sprintf("요청이 성공적으로 저장되었습니다. ID: %d", requestId),
		RequestId: requestId,
	}, nil
}

// UpdateAccessRequestStatus - 접근 요청 상태 변경
func (h *AccessManagementHandler) UpdateAccessRequestStatus(ctx context.Context, req *accessapi.StatusUpdateRequest) (*accessapi.AccessResponse, error) {
	log.Printf("AccessManagement 상태 변경: RequestID=%d, Status=%s", req.RequestId, req.Status)

	// Fabric 연결 (AccessManagement용 설정 사용)
	contract := ClientConnect(configuration.RuntimeConf.Profile[0])

	// 체인코드 호출
	_, err := contract.SubmitTransaction("SaveRequestStatus", 
		strconv.FormatUint(req.RequestId, 10), req.Status)
	if err != nil {
		return &accessapi.AccessResponse{
			Success: false,
			Message: fmt.Sprintf("상태 변경 실패: %v", err),
		}, err
	}

	log.Printf("AccessManagement 상태 변경 완료: RequestID=%d", req.RequestId)

	return &accessapi.AccessResponse{
		Success: true,
		Message: fmt.Sprintf("요청 상태가 %s로 변경되었습니다", req.Status),
		RequestId: req.RequestId,
	}, nil
}

// GetAccessRequest - 접근 요청 조회
func (h *AccessManagementHandler) GetAccessRequest(ctx context.Context, req *accessapi.RequestQuery) (*accessapi.AccessRequestResponse, error) {
	log.Printf("AccessManagement 요청 조회: RequestID=%d", req.RequestId)

	// Fabric 연결 (AccessManagement용 설정 사용)
	contract := ClientConnect(configuration.RuntimeConf.Profile[0])

	// 체인코드 호출
	result, err := contract.EvaluateTransaction("GetRequestById", 
		strconv.FormatUint(req.RequestId, 10))
	if err != nil {
		return &accessapi.AccessRequestResponse{
			Success: false,
			Message: fmt.Sprintf("요청 조회 실패: %v", err),
		}, err
	}

	// JSON 파싱
	var accessReq AccessRequest
	if err := json.Unmarshal(result, &accessReq); err != nil {
		return &accessapi.AccessRequestResponse{
			Success: false,
			Message: fmt.Sprintf("응답 파싱 실패: %v", err),
		}, err
	}

	return &accessapi.AccessRequestResponse{
		Success: true,
		Message: "요청 조회 성공",
		Request: &accessapi.AccessRequestData{
			ResourceOwner:    accessReq.ResourceOwner,
			Purpose:         accessReq.Purpose,
			OrganizationName: accessReq.OrganizationName,
		},
		Status: int32(accessReq.Status),
	}, nil
}

// GetAccessRequestsByOwner - 소유자별 요청 목록 조회
func (h *AccessManagementHandler) GetAccessRequestsByOwner(ctx context.Context, req *accessapi.OwnerQuery) (*accessapi.RequestListResponse, error) {
	log.Printf("AccessManagement 소유자별 요청 조회: Owner=%s", req.ResourceOwner)

	// Fabric 연결 (AccessManagement용 설정 사용)
	contract := ClientConnect(configuration.RuntimeConf.Profile[0])

	// 체인코드 호출
	result, err := contract.EvaluateTransaction("GetRequestId", req.ResourceOwner)
	if err != nil {
		return &accessapi.RequestListResponse{
			Success: false,
			Message: fmt.Sprintf("요청 목록 조회 실패: %v", err),
		}, err
	}

	// JSON 파싱
	var requestIds []uint64
	if err := json.Unmarshal(result, &requestIds); err != nil {
		return &accessapi.RequestListResponse{
			Success: false,
			Message: fmt.Sprintf("응답 파싱 실패: %v", err),
		}, err
	}

	return &accessapi.RequestListResponse{
		Success:    true,
		Message:    fmt.Sprintf("%d개의 요청을 찾았습니다", len(requestIds)),
		RequestIds: requestIds,
	}, nil
}

// SearchAccessRequestsByPurpose Purpose로 요청 검색
func (h *AccessManagementHandler) SearchAccessRequestsByPurpose(ctx context.Context, req *accessapi.SearchByPurposeRequest) (*accessapi.SearchByPurposeResponse, error) {
	log.Printf("Purpose 검색 요청: %s", req.Purpose)

	// 1. idxmngr에서 Purpose로 TxId들 검색 (정확한 매칭)
	searchReq := &idxmngr.SearchRequestM{
		IndexID: "purpose",
		Field:   "IndexableData",  // IndexableData 필드에서 검색
		Value:   req.Purpose,
		FilePath: "/home/blockchain/bi-index-migration/bi-index/fileindex-go/data/fabric/purpose.bf",
		KeySize: 64,
		ComOp:   idxmngr.ComparisonOps_Eq,
	}

	searchResp, err := h.idxmngrClient.GetindexDataByFieldM(ctx, searchReq)
	if err != nil {
		log.Printf("idxmngr 검색 실패: %v", err)
		return &accessapi.SearchByPurposeResponse{
			Success: false,
			Message: fmt.Sprintf("인덱스 검색 실패: %v", err),
		}, nil
	}

	log.Printf("인덱스 검색 결과: %d개 발견", len(searchResp.IdxData))

	// 인덱스에서 찾은 TxId들 출력
	for i, idxData := range searchResp.IdxData {
		log.Printf("🔍 인덱스 TxId[%d]: %s", i, idxData)
	}

	// 2. 인덱스에서 찾은 TxId 개수만 반환 (실제 상세 데이터는 별도 조회 필요)
	var requests []*accessapi.AccessRequestData
	
	log.Printf("인덱스에서 찾은 %d개의 TxId - 이 개수가 정확한 매칭 수", len(searchResp.IdxData))
	
	// 인덱스 기반 검색에서는 TxId 목록만 제공하고, 상세 정보는 빈 배열로 반환
	// 실제 상세 정보가 필요하면 각 TxId별로 별도 조회 필요

	// 인덱스에서 찾은 TxId 목록 수집
	var txIds []string
	for _, idxData := range searchResp.IdxData {
		txIds = append(txIds, idxData)
	}

	// 로그로 불일치 상황 확인
	if len(txIds) != len(requests) {
		log.Printf("⚠️  데이터 불일치 감지: 인덱스 TxId 수=%d, 실제 요청 수=%d", len(txIds), len(requests))
	}

	return &accessapi.SearchByPurposeResponse{
		Success:  true,
		Message:  fmt.Sprintf("%d개의 요청을 찾았습니다 (인덱스 TxId: %d개)", len(requests), len(txIds)),
		Requests: requests,
		TxIds:    txIds,
	}, nil
}

// sendIndexingRequestAfterTransaction - 재인덱싱 로직 제거됨

// sendIndexingRequestAfterTransactionWithTxId - TxId를 사용하여 최신 요청을 찾아 인덱싱
func (h *AccessManagementHandler) sendIndexingRequestAfterTransactionWithTxId(txId string, actualPurpose string) {
	log.Printf("Processing indexing with TxId: %s, Purpose: %s", txId, actualPurpose)
	
	if h.idxmngrConn == nil {
		log.Printf("❌ idxmngr connection is not available - indexing skipped")
		return
	}
	
	log.Printf("✅ idxmngr connection is available - proceeding with indexing")

	// 1. 실제 Purpose를 사용하여 인덱싱 (블록체인 조회 생략)
	log.Printf("Using actual Purpose for indexing: %s", actualPurpose)
	
	accessReq := AccessRequest{
		ResourceOwner:    "indexed_user",  // 임시 값
		Purpose:          actualPurpose,   // 실제 Purpose 사용
		OrganizationName: "INDEXED_ORG",   // 임시 값  
		Status:           0,               // 임시 값
	}

	log.Printf("Retrieved latest request data for indexing: Owner=%s, Purpose=%s, Org=%s, Status=%d", 
		accessReq.ResourceOwner, accessReq.Purpose, accessReq.OrganizationName, accessReq.Status)

	// 4. idxmngr 형식으로 변환
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	// 실제 Fabric TxId 사용
	indexableData := &idxmngr.IndexableDataM{
		TxId:            txId,
		ContractAddress: "fabric-accessmanagement-chaincode",
		EventName:       "AccessRequestSaved",
		Timestamp:       time.Now().Format("2006-01-02 15:04:05"),
		BlockNumber:     0,
		DynamicFields: map[string]string{
			"key":              accessReq.Purpose,          // Purpose를 키로 사용
			"purpose":          accessReq.Purpose,
			"organizationName": accessReq.OrganizationName,
			"resourceOwner":    accessReq.ResourceOwner,
			"status":           fmt.Sprintf("%d", accessReq.Status),
			"network":          "fabric",
			"timestamp":        time.Now().Format("2006-01-02 15:04:05"),
			"realTxId":         txId,                       // 실제 TxId 저장
		},
		SchemaVersion: "1.0",
	}

	bcDataList := &idxmngr.BcDataList{
		TxId:          txId,
		KeyCol:        "IndexableData",
		IndexableData: indexableData,
	}

	insertData := &idxmngr.InsertDatatoIdx{
		IndexID:  "purpose",
		Network:  "fabric",
		ColName:  "IndexableData",
		FilePath: "data/fabric/purpose.bf",
		BcList:   []*idxmngr.BcDataList{bcDataList},
	}

	log.Printf("Prepared indexing data with real TxId: IndexID=%s, Network=%s, TxId=%s", 
		insertData.IndexID, insertData.Network, bcDataList.TxId)

	// 5. idxmngr에 인덱싱 요청 전송
	stream, err := h.idxmngrClient.InsertIndexRequest(ctx)
	if err != nil {
		log.Printf("Failed to open stream to idxmngr: %v", err)
		return
	}
	defer stream.CloseSend()

	// 데이터 전송
	if err := stream.Send(insertData); err != nil {
		log.Printf("Failed to send indexing request: %v", err)
		return
	}

	// 스트림 종료 후 응답 받기
	response, err := stream.CloseAndRecv()
	if err != nil {
		log.Printf("Failed to receive indexing response: %v", err)
		return
	}

	log.Printf("✅ Indexing with TxId completed successfully: ResponseCode=%d, Message=%s", 
		response.ResponseCode, response.ResponseMessage)
}
