package main

import (
	idxserver "fileindex-go/fstree" //호출할 때는 패키지 명으로
	"fmt"
	"log"
	"net"

	fsindex "fileindex-go/idxserver_api"

	"google.golang.org/grpc"
)

const (
	port = ":50053"
)

func main() {

	/*
		// 로그 파일 생성
		logfile, err := os.OpenFile("application.log", os.O_APPEND|os.O_CREATE|os.O_WRONLY, 0644)
		if err != nil {
			log.Fatalf("Failed to open log file: %v", err)
		}
		defer logfile.Close()

		// 로그를 파일에 기록
		log.SetOutput(logfile)
		log.SetFlags(log.Ldate | log.Ltime | log.Lshortfile)

	*/

	grpcServer := grpc.NewServer(grpc.MaxSendMsgSize(50*1024*1024), grpc.MaxRecvMsgSize(50*1024*1024))
	//pvdapi.RegisterPvdServiceServer(grpcServer, &handler.PvdHandler{})
	fsindex.RegisterHLFDataIndexServer(grpcServer, &idxserver.IndexServer{})

	lis, err := net.Listen("tcp", port)
	if err != nil {
		log.Fatalf("An error has occurred while retrieving on launch: %v", err)
	}
	//log.SetFlags(log.Ldate | log.Ltime | log.Llongfile)
	log.Println("Grpc Server will be stared. Listening: " + port)
	fmt.Println("Grpc Server will be stared. Listening: " + port)

	if err := grpcServer.Serve(lis); err != nil {
		log.Fatal("An error has occurred while retriving on launch ", err)
	}
}
