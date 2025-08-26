package main

import (
	"fmt"
	"io/ioutil"
	"log"
	"net"
	"time"

	mg "idxmngr-go/manager"
	api "idxmngr-go/mngrapi/protos"

	"google.golang.org/grpc"
	"google.golang.org/grpc/keepalive"
	"gopkg.in/yaml.v3"
)

const (
	port = ":50052"
)

func init() {
	//readIndexList()
}

type Config struct {
	Items []mg.IndexInfo `yaml:"items"`
}

func readIndexList() {
	data, err := ioutil.ReadFile("./config.yaml")
	if err != nil {
		log.Fatalf("YAML 파일을 읽을 수 없습니다: %v", err)
	}

	// YAML 데이터 언마샬링
	var list Config
	err = yaml.Unmarshal(data, &list)
	if err != nil {
		log.Fatalf("YAML 데이터를 언마샬링할 수 없습니다: %v", err)
	}

	for _, idx := range list.Items {
		fmt.Println("IndexInfo: ", idx)
		mg.MngrIndexList[idx.IdxID] = idx
	}

	/*

		newItem := mg.IndexInfo{
			IdxID:        "Test",
			IdxName:      "Texxxst",
			KeyCol:       "Speed",
			FilePath:     "Test",
			KeySize:      "6",
			CallCnt:      0,
			KeyCnt:       0,
			IndexDataCnt: 20000,
		}
		list.Items = append(list.Items, newItem)

		// 수정된 데이터 마샬링
		newData, err := yaml.Marshal(&list)
		if err != nil {
			log.Fatalf("수정된 데이터를 마샬링할 수 없습니다: %v", err)
		}

		// 수정된 데이터 파일에 쓰기
		err = ioutil.WriteFile("./config.yaml", newData, 0644)
		if err != nil {
			log.Fatalf("수정된 데이터를 파일에 쓸 수 없습니다: %v", err)
		}
	*/
	fmt.Println("IndexList: ", mg.MngrIndexList)

}

func main() {

	// lis, err := net.Listen("tcp", port)
	// if err != nil {
	// 	log.Fatal("An error has occurred while retrieving on launch: ", err)
	// }

	// mngrServer := grpc.NewServer(grpc.MaxSendMsgSize(50*1024*1024), grpc.MaxRecvMsgSize(50*1024*1024))
	// //pvdapi.RegisterPvdServiceServer(grpcServer, &handler.PvdHandler{})
	// api.RegisterIndexManagerServer(mngrServer,  &mg.MServer{})

	// //log.SetFlags(log.Ldate | log.Ltime | log.Llongfile)
	// log.Println("Grpc Server will be started. Listening" + port)
	// if err := mngrServer.Serve(lis); err != nil {
	// 	log.Fatal("An error has occurred while retriving on launch", err)
	// }

	pool := mg.NewConnectionPool()
	defer pool.CloseAllConnections()

	//grpc server setting
	lis, err := net.Listen("tcp", port)
	if err != nil {
		// 	log.Fatal("An error has occurred while retrieving on launch: ", err)
	}

	mngrServer := grpc.NewServer(
		grpc.KeepaliveParams(keepalive.ServerParameters{
			MaxConnectionIdle: 15 * time.Minute, // 비활성화 후 연결 종료
			Time:              10 * time.Second,
			Timeout:           20 * time.Second,
		}),
		grpc.MaxRecvMsgSize(100*1024*1024), // 100MB
		grpc.MaxSendMsgSize(100*1024*1024), // 100MB
	)
	api.RegisterIndexManagerServer(mngrServer, &mg.MServer{ConnectionPool: pool})

	log.Println("Grpc Server will be started. Listening" + port)
	if err := mngrServer.Serve(lis); err != nil {
		log.Fatal("An error has occurred while retriving on launch", err)
	}
}
