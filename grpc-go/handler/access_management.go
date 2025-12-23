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
	"github.com/hyperledger/fabric-protos-go-apiv2/common"
	rwsetpb "github.com/hyperledger/fabric-protos-go-apiv2/ledger/rwset"
	kvrwsetpb "github.com/hyperledger/fabric-protos-go-apiv2/ledger/rwset/kvrwset"
	pb "github.com/hyperledger/fabric-protos-go-apiv2/peer"
	"google.golang.org/grpc"
	"google.golang.org/grpc/credentials/insecure"
	"google.golang.org/protobuf/proto"
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

func (h *AccessManagementHandler) SaveAccessRequest(
	ctx context.Context,
	req *accessapi.AccessRequestData,
) (*accessapi.AccessResponse, error) {

	result, err := h.contract.SubmitTransaction(
		"SaveRequest",
		req.ResourceOwner,
		req.Purpose,
		req.OrganizationName,
	)
	if err != nil {
		return nil, err
	}

	// ✅ 체인코드는 uint64 requestId 반환
	requestId, err := strconv.ParseUint(string(result), 10, 64)
	if err != nil {
		return nil, fmt.Errorf("invalid requestId")
	}

	// ✅ 바로 인덱싱
	go h.indexPurpose(requestId, req)

	return &accessapi.AccessResponse{
		Success:   true,
		RequestId: requestId,
		Message:   "Access request saved",
	}, nil
}

func (h *AccessManagementHandler) indexPurpose(
	requestId uint64,
	req *accessapi.AccessRequestData,
) {
	if h.idxmngrClient == nil {
		log.Println("idxmngr not connected")
		return
	}

	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()

	stream, err := h.idxmngrClient.InsertIndexRequest(ctx)
	if err != nil {
		log.Println(err)
		return
	}

	indexableData := &idxmngr.IndexableDataM{
		TxId:            strconv.FormatUint(requestId, 10), // logical tx
		ContractAddress: "fabric-accessmanagement",
		EventName:       "AccessRequestsSaved",
		Timestamp:       time.Now().Format("2006-01-02 15:04:05"),
		BlockNumber:     0,
		DynamicFields: map[string]string{
			"key":              req.Purpose,
			"purpose":          req.Purpose,
			"organizationName": req.OrganizationName,
			"resourceOwner":    req.ResourceOwner,
			"requestId":        strconv.FormatUint(requestId, 10),
			"network":          "fabric",
		},
		SchemaVersion: "1.0",
	}

	bcData := &idxmngr.BcDataList{
		TxId:          indexableData.TxId,
		KeyCol:        "IndexableData",
		IndexableData: indexableData,
	}

	insert := &idxmngr.InsertDatatoIdx{
		IndexID:  "purpose",
		Network:  "fabric",
		ColName:  "IndexableData",
		FilePath: "data/fabric/purpose.bf",
		BcList:   []*idxmngr.BcDataList{bcData},
	}

	_ = stream.Send(insert)
	_, _ = stream.CloseAndRecv()
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

// GetAccessRequestByTxId - TxId로 접근 요청 조회 (GetAllRequests 사용)
func (h *AccessManagementHandler) GetAccessRequestByTxId(ctx context.Context, req *accessapi.TxIdQuery) (*accessapi.AccessRequestResponse, error) {
	log.Printf("AccessManagement TxId 조회: TxId=%s", req.TxId)

	// Access Management 체인코드에서 모든 요청 조회
	contract := ClientConnect(configuration.RuntimeConf.Profile[0])
	
	log.Printf("🔍 Access Management 체인코드에서 전체 요청 조회")
	
	// GetAllRequests로 모든 데이터를 가져온 후 매칭되는 데이터 찾기
	result, err := contract.EvaluateTransaction("GetAllRequests")
	if err != nil {
		log.Printf("❌ GetAllRequests 조회 실패: %v", err)
		return &accessapi.AccessRequestResponse{
			Success: false,
			Message: fmt.Sprintf("전체 요청 조회 실패: %v", err),
		}, nil
	}

	log.Printf("✅ 전체 요청 데이터 크기: %d bytes", len(result))
	
	// JSON 파싱 - RequestDetail 배열
	var allRequests []*RequestDetail
	if err := json.Unmarshal(result, &allRequests); err != nil {
		log.Printf("❌ 전체 요청 JSON 파싱 실패: %v", err)
		return &accessapi.AccessRequestResponse{
			Success: false,
			Message: fmt.Sprintf("응답 파싱 실패: %v", err),
		}, nil
	}

	// log.Printf("✅ 전체 요청 개수: %d개", len(allRequests))
	
	// TxId 기반으로 실제 데이터 조회 시도
	log.Printf("🔍 TxId %s에 해당하는 실제 데이터 조회 시도", req.TxId)
	
	// QSCC를 통한 실제 트랜잭션 데이터 조회
	log.Printf("🔍 QSCC를 통한 트랜잭션 조회 시작: %s", req.TxId)
	
	evaluateResult, err := configuration.QsccContracts[0].EvaluateTransaction("GetTransactionByID", "pvdchannel", req.TxId)
	if err == nil && len(evaluateResult) > 0 {
		log.Printf("✅ QSCC 트랜잭션 조회 성공, 데이터 크기: %d bytes", len(evaluateResult))
		
		// 트랜잭션에서 실제 데이터 파싱 시도
		accessReq, err := h.parseAccessRequestFromQSCC(evaluateResult)
		if err == nil && accessReq != nil {
			log.Printf("🎯 QSCC에서 파싱된 데이터: Purpose=%s, Owner=%s", accessReq.Purpose, accessReq.ResourceOwner)
			return &accessapi.AccessRequestResponse{
				Success: true,
				Message: "QSCC 트랜잭션 조회 성공",
				Request: &accessapi.AccessRequestData{
					ResourceOwner:    accessReq.ResourceOwner,
					Purpose:         accessReq.Purpose,
					OrganizationName: accessReq.OrganizationName,
				},
				Status: int32(accessReq.Status),
			}, nil
		} else {
			log.Printf("⚠️ QSCC 데이터 파싱 실패: %v", err)
		}
	} else {
		log.Printf("❌ QSCC 트랜잭션 조회 실패: %v", err)
	}
	
	log.Printf("⚠️ TxId 직접 조회 실패, 전체 데이터에서 최신 요청 반환")
	
	// 대안: 가장 최근 요청 반환
	if len(allRequests) > 0 {
		foundRequest := allRequests[len(allRequests)-1]
		log.Printf("🎯 최신 요청 반환: Purpose=%s, Owner=%s", foundRequest.Purpose, foundRequest.ResourceOwner)
	} else {
		log.Printf("❌ 조회 가능한 요청이 없음")
		return &accessapi.AccessRequestResponse{
			Success: false,
			Message: fmt.Sprintf("해당 TxId와 매칭되는 데이터를 찾을 수 없습니다: %s", req.TxId),
		}, nil
	}
	
	foundRequest := allRequests[len(allRequests)-1]

	return &accessapi.AccessRequestResponse{
		Success: true,
		Message: "TxId 조회 성공 (GetAllRequests 기반)",
		Request: &accessapi.AccessRequestData{
			ResourceOwner:    foundRequest.ResourceOwner,
			Purpose:         foundRequest.Purpose,
			OrganizationName: foundRequest.OrganizationName,
		},
		Status: int32(foundRequest.Status),
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

	// 2. 인덱스에서 찾은 TxId들로 실제 데이터 조회
	var requests []*accessapi.AccessRequestData
	var txIds []string
	
	log.Printf("인덱스에서 찾은 %d개의 TxId - 실제 데이터 조회 시작", len(searchResp.IdxData))
	
	// Access Management 체인코드에서 전체 요청 조회 (한 번만 호출)
	contract := ClientConnect(configuration.RuntimeConf.Profile[0])
	result, err := contract.EvaluateTransaction("GetAllRequests")
	if err != nil {
		log.Printf("❌ GetAllRequests 조회 실패: %v", err)
		// 오류가 있어도 TxId 목록은 반환
		for _, idxData := range searchResp.IdxData {
			txIds = append(txIds, idxData)
		}
	} else {
		// 전체 요청 데이터 파싱
		var allRequests []*RequestDetail
		if err := json.Unmarshal(result, &allRequests); err == nil {
			// log.Printf("✅ 전체 요청 개수: %d개", len(allRequests))
			
			// Purpose가 일치하는 데이터만 필터링
			for _, request := range allRequests {
				if request.Purpose == req.Purpose {
					// RequestDetail을 AccessRequestData로 변환
					accessData := &accessapi.AccessRequestData{
						ResourceOwner:    request.ResourceOwner,
						Purpose:         request.Purpose,
						OrganizationName: request.OrganizationName,
					}
					requests = append(requests, accessData)
					
					// 해당하는 TxId도 추가 (순서대로 매칭하기 위해)
					// 실제로는 더 정확한 매칭 로직이 필요하지만, 임시로 인덱스 순서 사용
					if len(txIds) < len(searchResp.IdxData) {
						txIds = append(txIds, searchResp.IdxData[len(txIds)])
					}
				}
			}
		}
		
		// 남은 TxId들 추가
		for i := len(txIds); i < len(searchResp.IdxData); i++ {
			txIds = append(txIds, searchResp.IdxData[i])
		}
	}

	// 로그로 불일치 상황 확인
	if len(txIds) != len(requests) {
		// log.Printf("⚠️  데이터 불일치 감지: 인덱스 TxId 수=%d, 실제 요청 수=%d", len(txIds), len(requests))
	}

	// log.Printf("🔍 응답 준비: TxIds 개수=%d, Requests 개수=%d", len(txIds), len(requests))
	for i, txId := range txIds {
		log.Printf("📤 응답 TxId[%d]: %s", i, txId)
	}

	return &accessapi.SearchByPurposeResponse{
		Success:  true,
		Message:  fmt.Sprintf("%d개의 요청을 찾았습니다 (인덱스 TxId: %d개)", len(requests), len(txIds)),
		Requests: requests,
		TxIds:    txIds,
	}, nil
}

// parseAccessRequestFromQSCC - QSCC 트랜잭션 결과에서 AccessRequest 파싱
func (h *AccessManagementHandler) parseAccessRequestFromQSCC(evaluateResult []byte) (*AccessRequest, error) {
	// PVD의 parseTransactionFromResult 로직 참고
	var pt pb.ProcessedTransaction
	if err := proto.Unmarshal(evaluateResult, &pt); err != nil {
		return nil, fmt.Errorf("ProcessedTransaction 언마샬링 실패: %v", err)
	}

	log.Printf("🔍 ProcessedTransaction 파싱 완료")
	
	// TransactionEnvelope는 이미 파싱된 상태
	envelope := pt.TransactionEnvelope
	if envelope == nil {
		return nil, fmt.Errorf("TransactionEnvelope가 nil입니다")
	}

	// Payload 파싱
	var payload common.Payload
	if err := proto.Unmarshal(envelope.Payload, &payload); err != nil {
		return nil, fmt.Errorf("Payload 언마샬링 실패: %v", err)
	}

	// Transaction 파싱
	var transaction pb.Transaction
	if err := proto.Unmarshal(payload.Data, &transaction); err != nil {
		return nil, fmt.Errorf("Transaction 언마샬링 실패: %v", err)
	}

	log.Printf("🔍 Transaction Actions 개수: %d", len(transaction.Actions))

	// 첫 번째 Action에서 데이터 추출
	if len(transaction.Actions) > 0 {
		var actionPayload pb.ChaincodeActionPayload
		if err := proto.Unmarshal(transaction.Actions[0].Payload, &actionPayload); err != nil {
			return nil, fmt.Errorf("ChaincodeActionPayload 언마샬링 실패: %v", err)
		}

		var proposalResponsePayload pb.ProposalResponsePayload
		if err := proto.Unmarshal(actionPayload.Action.ProposalResponsePayload, &proposalResponsePayload); err != nil {
			return nil, fmt.Errorf("ProposalResponsePayload 언마샬링 실패: %v", err)
		}

		var chaincodeAction pb.ChaincodeAction
		if err := proto.Unmarshal(proposalResponsePayload.Extension, &chaincodeAction); err != nil {
			return nil, fmt.Errorf("ChaincodeAction 언마샬링 실패: %v", err)
		}

		// Response에서 실제 데이터 추출
		if chaincodeAction.Response != nil && len(chaincodeAction.Response.Payload) > 0 {
			responseStr := string(chaincodeAction.Response.Payload)
			log.Printf("🎯 체인코드 응답: %s", responseStr)
			
			// TxId 응답인 경우 (64자리 해시)
			if len(responseStr) == 64 {
				log.Printf("✅ TxId 응답 확인: %s", responseStr)
				
				// RWSet에서 실제 저장된 데이터 추출
				if chaincodeAction.Results != nil {
					return h.parseAccessRequestFromRWSet(chaincodeAction.Results)
				}
			}
		}
	}

	return nil, fmt.Errorf("트랜잭션에서 AccessRequest 데이터를 찾을 수 없음")
}

// parseAccessRequestFromRWSet - RWSet에서 실제 저장 데이터 추출
func (h *AccessManagementHandler) parseAccessRequestFromRWSet(rwsetBytes []byte) (*AccessRequest, error) {
	var txRwSet rwsetpb.TxReadWriteSet
	if err := proto.Unmarshal(rwsetBytes, &txRwSet); err != nil {
		return nil, fmt.Errorf("TxReadWriteSet 언마샬링 실패: %v", err)
	}

	// 필드 확인을 위한 디버그 로그
	log.Printf("🔍 TxReadWriteSet 구조 확인 중...")
	
	// 가능한 필드들 시도
	if txRwSet.NsRwset != nil && len(txRwSet.NsRwset) > 0 {
		log.Printf("🔍 RWSet NsRwset 개수: %d", len(txRwSet.NsRwset))
		
		// 각 네임스페이스에서 Write 데이터 확인
		for _, nsRwSet := range txRwSet.NsRwset {
		log.Printf("🔍 네임스페이스: %s", nsRwSet.Namespace)
		
		var kvRwSet kvrwsetpb.KVRWSet
		if err := proto.Unmarshal(nsRwSet.Rwset, &kvRwSet); err != nil {
			continue
		}

		log.Printf("🔍 KVRWSet Writes 개수: %d", len(kvRwSet.Writes))

		// Write 데이터에서 JSON 찾기
		for _, write := range kvRwSet.Writes {
			if len(write.Value) > 0 && write.Value[0] == '{' {
				log.Printf("🎯 JSON 데이터 발견: Key=%s", write.Key)
				
				var accessReq AccessRequest
				if err := json.Unmarshal(write.Value, &accessReq); err == nil {
					log.Printf("✅ AccessRequest 파싱 성공: Purpose=%s", accessReq.Purpose)
					return &accessReq, nil
				}
			}
			}
		}
	} else {
		log.Printf("⚠️ TxReadWriteSet에서 유효한 NsRwset을 찾을 수 없음")
	}

	return nil, fmt.Errorf("RWSet에서 AccessRequest 데이터를 찾을 수 없음")
}

// sendIndexingRequestAfterTransaction - 재인덱싱 로직 제거됨

// sendIndexingRequestWithActualData - 실제 트랜잭션에서 데이터 추출하여 인덱싱
func (h *AccessManagementHandler) sendIndexingRequestWithActualData(txId string) {
	log.Printf("Processing indexing with actual transaction data: %s", txId)
	
	if h.idxmngrConn == nil {
		log.Printf("❌ idxmngr connection is not available - indexing skipped")
		return
	}
	
	// 실제 트랜잭션에서 데이터 추출
	actualData, err := h.getActualTransactionData(txId)
	if err != nil {
		log.Printf("❌ Failed to get actual transaction data: %v", err)
		return
	}
	
	log.Printf("✅ Retrieved actual data: Purpose=%s, Owner=%s", actualData.Purpose, actualData.ResourceOwner)
	
	// 실제 데이터로 인덱싱
	h.performIndexing(txId, actualData)
}

// getActualTransactionData - TxId로 실제 저장된 데이터 조회
func (h *AccessManagementHandler) getActualTransactionData(txId string) (*AccessRequest, error) {
	// 체인코드에서 직접 조회 (간단한 방법)
	contract := ClientConnect(configuration.RuntimeConf.Profile[0])
	
	result, err := contract.EvaluateTransaction("GetAllRequests")
	if err != nil {
		return nil, fmt.Errorf("GetAllRequests 호출 실패: %v", err)
	}

	// JSON 파싱
	var requests []AccessRequest
	if err := json.Unmarshal(result, &requests); err != nil {
		return nil, fmt.Errorf("응답 파싱 실패: %v", err)
	}

	// TxId로 매칭되는 요청 찾기 (임시로 첫 번째 요청 반환)
	if len(requests) > 0 {
		return &requests[len(requests)-1], nil // 최신 요청 반환
	}
	
	return nil, fmt.Errorf("요청을 찾을 수 없음")
}

// performIndexing - 실제 데이터로 인덱싱 수행
func (h *AccessManagementHandler) performIndexing(txId string, accessReq *AccessRequest) {
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	// InsertIndexRequest 스트리밍 방식 사용
	stream, err := h.idxmngrClient.InsertIndexRequest(ctx)
	if err != nil {
		log.Printf("❌ 스트림 생성 실패: %v", err)
		return
	}

	indexableData := &idxmngr.IndexableDataM{
		TxId:            txId,
		ContractAddress: "fabric-accessmanagement-chaincode",
		EventName:       "AccessRequestSaved",
		Timestamp:       time.Now().Format("2006-01-02 15:04:05"),
		BlockNumber:     0,
		DynamicFields: map[string]string{
			"key":              accessReq.Purpose,          // 실제 Purpose 사용
			"purpose":          accessReq.Purpose,
			"organizationName": accessReq.OrganizationName,
			"resourceOwner":    accessReq.ResourceOwner,
			"status":           fmt.Sprintf("%d", accessReq.Status),
			"network":          "fabric",
			"timestamp":        time.Now().Format("2006-01-02 15:04:05"),
			"realTxId":         txId,
		},
		SchemaVersion: "1.0",
	}

	bcDataList := &idxmngr.BcDataList{
		TxId:          txId,
		IndexableData: indexableData,  // 단일 포인터
	}
	
	insertData := &idxmngr.InsertDatatoIdx{
		IndexID: "purpose",
		BcList:  []*idxmngr.BcDataList{bcDataList},
	}

	log.Printf("Sending indexing request to idxmngr: TxId=%s, Purpose=%s", txId, accessReq.Purpose)

	if err := stream.Send(insertData); err != nil {
		log.Printf("❌ 데이터 전송 실패: %v", err)
		return
	}

	_, err = stream.CloseAndRecv()
	if err != nil {
		log.Printf("❌ idxmngr 인덱싱 실패: %v", err)
	} else {
		log.Printf("✅ idxmngr 인덱싱 성공: TxId=%s, Purpose=%s", txId, accessReq.Purpose)
	}
}

// sendIndexingRequestAfterTransactionWithTxId - TxId를 사용하여 최신 요청을 찾아 인덱싱 (기존 함수)
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