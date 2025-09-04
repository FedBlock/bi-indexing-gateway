package main

import (
	"log"
	"net"
	"time"

	"grpc-go/configuration"
	"grpc-go/handler"

	"google.golang.org/grpc"
	"google.golang.org/grpc/keepalive"

	accessapi "grpc-go/accessapi"
)

func main() {
	// gRPC 서버 포트
	port := ":19002" // pvd는 19001이므로 다른 포트 사용

	log.Println("AccessManagement gRPC 서버 시작 중...")
	log.Printf("포트: %s", port)

	// AccessManagement 설정 로드
	configuration.LoadConfig("handler/config-accessmanagement.yaml")
	log.Printf("설정 로드 완료: %d개 프로필", len(configuration.RuntimeConf.Profile))

	// TCP 리스너 생성
	lis, err := net.Listen("tcp", port)
	if err != nil {
		log.Fatalf("TCP 리스너 생성 실패: %v", err)
	}

	// gRPC 서버 생성
	grpcServer := grpc.NewServer(
		grpc.KeepaliveParams(keepalive.ServerParameters{
			MaxConnectionIdle: 15 * time.Minute,
			Time:              10 * time.Second,
			Timeout:           20 * time.Second,
		}),
		grpc.MaxRecvMsgSize(100*1024*1024), // 100MB
		grpc.MaxSendMsgSize(100*1024*1024), // 100MB
	)

	// AccessManagement 서비스 등록
	accessHandler := &handler.AccessManagementHandler{}
	accessapi.RegisterAccessManagementServiceServer(grpcServer, accessHandler)

	log.Printf("AccessManagement gRPC 서버가 %s에서 실행 중입니다", port)
	log.Println("서비스:")
	log.Println("  - SaveAccessRequest: 접근 요청 저장")
	log.Println("  - UpdateAccessRequestStatus: 요청 상태 변경")
	log.Println("  - GetAccessRequest: 요청 조회")
	log.Println("  - GetAccessRequestsByOwner: 소유자별 요청 목록")

	// 서버 시작
	if err := grpcServer.Serve(lis); err != nil {
		log.Fatalf("gRPC 서버 시작 실패: %v", err)
	}
}
