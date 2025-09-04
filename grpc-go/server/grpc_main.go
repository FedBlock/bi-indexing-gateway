package main

import (
	"fmt"
	"log"
	"net"
	"os"

	"grpc-go/configuration"
	"grpc-go/handler"
	"grpc-go/pvdapi/grpc-go/pvdapi"
	accessapi "grpc-go/accessapi"

	"github.com/fsnotify/fsnotify"
	"github.com/spf13/viper"
	"google.golang.org/grpc"
)

func init() {
	profile := initProfile()
	setRuntimeConfig(profile)
}

func setRuntimeConfig(profile string) {
	viper.AddConfigPath("./handler")
	viper.SetConfigName(profile)
	viper.SetConfigType("yaml")
	err := viper.ReadInConfig()
	if err != nil {
		panic(err)
	}
	err = viper.Unmarshal(&configuration.RuntimeConf)
	if err != nil {
		panic(err)
	}

	nodes := len(configuration.RuntimeConf.Profile)
	log.Println("Read ConnectProfile size = ", nodes)

	for _, profile := range configuration.RuntimeConf.Profile {
		//log.Printf("%s : %s", k, profile)
		configuration.MyContracts = append(configuration.MyContracts, handler.ClientConnect(profile))
	}

	for _, profile := range configuration.RuntimeConf.Profile {
		//log.Printf("%s : %s", k, profile)
		profileCopy := profile
		profileCopy.ChaincodeName = "qscc"
		configuration.QsccContracts = append(configuration.QsccContracts, handler.ClientConnect(profileCopy))
	}

	viper.OnConfigChange(func(e fsnotify.Event) {
		fmt.Println("Config file changed:", e.Name)
		var err error
		err = viper.ReadInConfig()
		if err != nil {
			fmt.Println(err)
			return
		}
		err = viper.Unmarshal(&configuration.RuntimeConf)
		if err != nil {
			fmt.Println(err)
			return
		}

	})
	viper.WatchConfig()
}

func initProfile() string {
	var profile string
	profile = os.Getenv("GO_PROFILE")
	if len(profile) <= 0 {
		profile = "config"
	}
	fmt.Println("GOLANG_PROFILE: " + profile)
	return profile
}

func main() {

	lis, err := net.Listen("tcp", ":19001")
	if err != nil {
		log.Fatal("An error has occurred while retrieving on launch: ", err)
	}

	// TLS 없이 gRPC 서버 생성 (명시적 설정)
	grpcServer := grpc.NewServer(
		grpc.MaxSendMsgSize(50*1024*1024), 
		grpc.MaxRecvMsgSize(50*1024*1024),
		grpc.Creds(nil), // TLS 자격 증명 명시적 비활성화
	)
	
	// PVD 서비스 등록
	pvdapi.RegisterPvdServer(grpcServer, handler.NewPvdServer())
	
	// AccessManagement 서비스 등록
	accessHandler := handler.NewAccessManagementHandler()
	accessapi.RegisterAccessManagementServiceServer(grpcServer, accessHandler)

	log.Println("Grpc Server will be start. Listen : 19001 (TLS disabled)")
	log.Println("등록된 서비스:")
	log.Println("  - PVD Service")
	log.Println("  - AccessManagement Service")
	if err := grpcServer.Serve(lis); err != nil {
		log.Fatal("An error has occurred while retriving on launch: ", err)
	}
}
