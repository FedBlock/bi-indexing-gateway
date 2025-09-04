// handler/access_management.go
package handler

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"strconv"
	"strings"
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
	log.Printf("Successfully connected to Fabric netwo
	
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

	// Fabric 연결 (AccessManagement용 설정 사용)
	contract := ClientConnect(configuration.RuntimeConf.Profile[0])

	// 체인코드 호출
	result, err := contract.SubmitTransaction("SaveRequest", 
		req.ResourceOwner, req.Purpose, req.OrganizationName)
	if err != nil {
		return &accessapi.AccessResponse{
			Success: false,
			Message: fmt.Sprintf("체인코드 호출 실패: %v", err),
		}, err
	}

	// 요청 ID 추출
	requestId, err := strconv.ParseUint(string(result), 10, 64)
	if err != nil {
		return &accessapi.AccessResponse{
			Success: false,
			Message: fmt.Sprintf("요청 ID 파싱 실패: %v", err),
		}, err
	}

	log.Printf("AccessManagement 요청 저장 완료: RequestID=%d", requestId)

	// 트랜잭션 성공 후 인덱싱을 위해 idxmngr로 데이터 전송
	// 실제 트랜잭션 데이터를 가져와서 인덱싱
	go h.sendIndexingRequestAfterTransaction(requestId)

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

	// 1. idxmngr에서 Purpose로 TxId들 검색
	searchReq := &idxmngr.SearchRequestM{
		IndexID: "purpose",
		Field:   "IndexableData", 
		Value:   req.Purpose,
		FilePath: "data/fabric/purpose.bf",
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

	// 2. 검색된 TxId들로부터 RequestId 추출하고 블록체인에서 상세 정보 조회
	var requests []*accessapi.AccessRequestData
	
	for _, txId := range searchResp.IdxData {
		// TxId에서 RequestId 추출 (예: "access_13_1756974027" -> "13")
		parts := strings.Split(txId, "_")
		if len(parts) < 2 {
			log.Printf("잘못된 TxId 형식: %s", txId)
			continue
		}
		
		requestIdStr := parts[1]
		requestId, err := strconv.ParseUint(requestIdStr, 10, 64)
		if err != nil {
			log.Printf("RequestId 파싱 실패: %s", requestIdStr)
			continue
		}

		// 3. 블록체인에서 상세 정보 조회
		result, err := h.contract.EvaluateTransaction("GetRequestById", fmt.Sprintf("%d", requestId))
		if err != nil {
			log.Printf("블록체인 조회 실패 (RequestId: %d): %v", requestId, err)
			continue
		}

		var requestDetail RequestDetail
		err = json.Unmarshal(result, &requestDetail)
		if err != nil {
			log.Printf("JSON 파싱 실패: %v", err)
			continue
		}

		// AccessRequestData로 변환
		accessReq := &accessapi.AccessRequestData{
			ResourceOwner:    requestDetail.ResourceOwner,
			Purpose:          requestDetail.Purpose,
			OrganizationName: requestDetail.OrganizationName,
		}
		
		requests = append(requests, accessReq)
		log.Printf("검색 결과 추가: RequestId=%d, Purpose=%s", requestId, requestDetail.Purpose)
	}

	return &accessapi.SearchByPurposeResponse{
		Success:  true,
		Message:  fmt.Sprintf("%d개의 요청을 찾았습니다", len(requests)),
		Requests: requests,
	}, nil
}

// sendIndexingRequestAfterTransaction - 트랜잭션 성공 후 블록체인에서 데이터를 가져와서 인덱싱
func (h *AccessManagementHandler) sendIndexingRequestAfterTransaction(requestId uint64) {
	log.Printf("Processing indexing for RequestID: %d", requestId)
	
	if h.idxmngrConn == nil {
		log.Printf("idxmngr connection is not available")
		return
	}

	// 1. 블록체인에서 실제 저장된 데이터 조회
	contract := ClientConnect(configuration.RuntimeConf.Profile[0])
	result, err := contract.EvaluateTransaction("GetRequestById", strconv.FormatUint(requestId, 10))
	if err != nil {
		log.Printf("Failed to get transaction data for indexing: %v", err)
		return
	}

	// 2. JSON 파싱
	var accessReq AccessRequest
	if err := json.Unmarshal(result, &accessReq); err != nil {
		log.Printf("Failed to parse transaction data: %v", err)
		return
	}

	log.Printf("Retrieved transaction data for indexing: Owner=%s, Purpose=%s, Org=%s, Status=%d", 
		accessReq.ResourceOwner, accessReq.Purpose, accessReq.OrganizationName, accessReq.Status)

	// 3. idxmngr 형식으로 변환
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	// 트랜잭션 ID 생성 (실제로는 패브릭에서 받아와야 하지만 여기서는 생성)
	txID := fmt.Sprintf("access_%d_%d", requestId, time.Now().Unix())

	// IndexableData 사용으로 변경 (cli.js의 EVM 방식 참고)
	indexableData := &idxmngr.IndexableDataM{
		TxId:            txID,
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
			"requestId":        fmt.Sprintf("%d", requestId),
			"network":          "fabric",
			"timestamp":        time.Now().Format("2006-01-02 15:04:05"),
		},
		SchemaVersion: "1.0",
	}

	bcDataList := &idxmngr.BcDataList{
		TxId:          txID,
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

	log.Printf("Prepared indexing data: IndexID=%s, Network=%s, TxId=%s", 
		insertData.IndexID, insertData.Network, bcDataList.TxId)

	// 4. idxmngr에 인덱싱 요청 전송
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

	log.Printf("✅ Indexing completed successfully: ResponseCode=%d, Message=%s", 
		response.ResponseCode, response.ResponseMessage)
}
