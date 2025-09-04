package main

import (
	"context"
	"flag"
	"log"
	"time"

	accessapi "grpc-go/accessapi"

	"google.golang.org/grpc"
	"google.golang.org/grpc/credentials/insecure"
)

var (
	cmd          = flag.String("cmd", "help", "명령어")
	serverAddr   = flag.String("addr", "localhost:19001", "서버 주소")
	owner        = flag.String("owner", "testuser1", "데이터 소유자")
	purpose      = flag.String("purpose", "AI 연구", "사용 목적")
	organization = flag.String("org", "테스트 대학교", "조직명")
	requestId    = flag.Uint64("id", 1, "요청 ID")
	status       = flag.String("status", "APPROVED", "상태 (APPROVED/REJECTED)")
)

func main() {
	flag.Parse()

	// gRPC 연결
	conn, err := grpc.Dial(*serverAddr, grpc.WithTransportCredentials(insecure.NewCredentials()))
	if err != nil {
		log.Fatalf("서버 연결 실패: %v", err)
	}
	defer conn.Close()

	client := accessapi.NewAccessManagementServiceClient(conn)
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	switch *cmd {
	case "save":
		testSaveRequest(client, ctx)
	case "status":
		testUpdateStatus(client, ctx)
	case "get":
		testGetRequest(client, ctx)
	case "list":
		testGetRequestsByOwner(client, ctx)
	case "search":
		testSearchRequestsByPurpose(client, ctx)
	case "all":
		testAllFunctions(client, ctx)
	default:
		printHelp()
	}
}

func testSaveRequest(client accessapi.AccessManagementServiceClient, ctx context.Context) {
	log.Printf("접근 요청 저장 테스트: Owner=%s, Purpose=%s, Org=%s", *owner, *purpose, *organization)

	req := &accessapi.AccessRequestData{
		ResourceOwner:    *owner,
		Purpose:         *purpose,
		OrganizationName: *organization,
	}

	resp, err := client.SaveAccessRequest(ctx, req)
	if err != nil {
		log.Fatalf("요청 저장 실패: %v", err)
	}

	log.Printf("응답: Success=%t, Message=%s, RequestID=%d", resp.Success, resp.Message, resp.RequestId)
}

func testUpdateStatus(client accessapi.AccessManagementServiceClient, ctx context.Context) {
	log.Printf("상태 변경 테스트: RequestID=%d, Status=%s", *requestId, *status)

	req := &accessapi.StatusUpdateRequest{
		RequestId: *requestId,
		Status:   *status,
	}

	resp, err := client.UpdateAccessRequestStatus(ctx, req)
	if err != nil {
		log.Fatalf("상태 변경 실패: %v", err)
	}

	log.Printf("응답: Success=%t, Message=%s", resp.Success, resp.Message)
}

func testGetRequest(client accessapi.AccessManagementServiceClient, ctx context.Context) {
	log.Printf("요청 조회 테스트: RequestID=%d", *requestId)

	req := &accessapi.RequestQuery{
		RequestId: *requestId,
	}

	resp, err := client.GetAccessRequest(ctx, req)
	if err != nil {
		log.Fatalf("요청 조회 실패: %v", err)
	}

	log.Printf("응답: Success=%t, Message=%s", resp.Success, resp.Message)
	if resp.Request != nil {
		log.Printf("요청 정보: Owner=%s, Purpose=%s, Org=%s, Status=%d", 
			resp.Request.ResourceOwner, resp.Request.Purpose, resp.Request.OrganizationName, resp.Status)
	}
}

func testGetRequestsByOwner(client accessapi.AccessManagementServiceClient, ctx context.Context) {
	log.Printf("소유자별 요청 목록 조회 테스트: Owner=%s", *owner)

	req := &accessapi.OwnerQuery{
		ResourceOwner: *owner,
	}

	resp, err := client.GetAccessRequestsByOwner(ctx, req)
	if err != nil {
		log.Fatalf("요청 목록 조회 실패: %v", err)
	}

	log.Printf("응답: Success=%t, Message=%s", resp.Success, resp.Message)
	log.Printf("요청 ID 목록: %v", resp.RequestIds)
}

func testAllFunctions(client accessapi.AccessManagementServiceClient, ctx context.Context) {
	log.Println("=== 모든 함수 테스트 시작 ===")

	// 1. 요청 저장
	log.Println("1. 요청 저장 테스트")
	testSaveRequest(client, ctx)
	
	time.Sleep(2 * time.Second)

	// 2. 요청 조회
	log.Println("2. 요청 조회 테스트")
	testGetRequest(client, ctx)
	
	time.Sleep(2 * time.Second)

	// 3. 소유자별 목록 조회
	log.Println("3. 소유자별 요청 목록 조회 테스트")
	testGetRequestsByOwner(client, ctx)
	
	time.Sleep(2 * time.Second)

	// 4. 상태 변경
	log.Println("4. 상태 변경 테스트")
	testUpdateStatus(client, ctx)

	log.Println("=== 모든 함수 테스트 완료 ===")
}

func testSearchRequestsByPurpose(client accessapi.AccessManagementServiceClient, ctx context.Context) {
	log.Printf("Purpose 검색 테스트: Purpose=%s", *purpose)
	
	resp, err := client.SearchAccessRequestsByPurpose(ctx, &accessapi.SearchByPurposeRequest{
		Purpose: *purpose,
	})
	
	if err != nil {
		log.Fatalf("Purpose 검색 실패: %v", err)
	}
	
	log.Printf("검색 응답: Success=%t, Message=%s", resp.Success, resp.Message)

	// 인덱스에서 찾은 TxId 목록 출력
	if len(resp.TxIds) > 0 {
		log.Printf("🔍 인덱스에서 찾은 TxId 목록 (%d개):", len(resp.TxIds))
		for i, txId := range resp.TxIds {
			log.Printf("  TxId[%d]: %s", i+1, txId)
		}
	}
	
	if resp.Success && len(resp.Requests) > 0 {
		log.Printf("📊 블록체인에서 조회된 요청 수: %d", len(resp.Requests))
		for i, req := range resp.Requests {
			log.Printf("요청 %d: Owner=%s, Purpose=%s, Org=%s",
				i+1, req.ResourceOwner, req.Purpose, req.OrganizationName)
		}
	}
}

func printHelp() {
	log.Println("AccessManagement gRPC 클라이언트")
	log.Println("사용법:")
	log.Println("  go run access_client.go -cmd=save -owner=testuser1 -purpose='AI 연구' -org='테스트 대학교'")
	log.Println("  go run access_client.go -cmd=status -id=1 -status=APPROVED")
	log.Println("  go run access_client.go -cmd=get -id=1")
	log.Println("  go run access_client.go -cmd=list -owner=testuser1")
	log.Println("  go run access_client.go -cmd=search -purpose='데이터분석연구'")
	log.Println("  go run access_client.go -cmd=all")
	log.Println("")
	log.Println("명령어:")
	log.Println("  save   - 접근 요청 저장")
	log.Println("  status - 요청 상태 변경")
	log.Println("  get    - 요청 조회")
	log.Println("  list   - 소유자별 요청 목록")
	log.Println("  search - Purpose로 요청 검색")
	log.Println("  all    - 모든 함수 테스트")
}
