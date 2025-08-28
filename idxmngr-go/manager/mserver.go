// Package idxmngr-go
package manager

import (
	"context"
	"flag"
	"fmt"
	"io"
	"io/ioutil"
	"log"
	"path/filepath"
	"runtime"
	"strconv"
	"strings"
	"sync"
	"time"

	idxserverapi "fileindex-go/idxserver_api" //integrated index server api
	mngr "idxmngr-go/mngrapi/protos"

	"google.golang.org/grpc"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/connectivity" // connectivity 패키지 추가
	"google.golang.org/grpc/status"
	"gopkg.in/yaml.v3"
	//"google.golang.org/grpc/credentials/insecure"
	//"google.golang.org/protobuf/wrapper"
)

type Config struct {
	Items []IndexInfo `yaml:"items"`
}

type IdxController struct {
	IndexConn *grpc.ClientConn
	IdxClient idxserverapi.HLFDataIndexClient
}

type MServer struct {
	mngr.UnimplementedIndexManagerServer
	ConnectionPool *ConnectionPool
	NetworkFactory *NetworkHandlerFactory
}

var MngrIndexList = map[string]IndexInfo{} //declaration with initiation

var CompEqCnt int32 = 0
var CompBtwCnt int32 = 0
var TotalCnt int32 = 0

var (
	BtrIdxServerAddr  = flag.String("Btridxaddr", "localhost:50051", "The server address in the format of host:port")
	FileIdxServerAddr = flag.String("Fileidxaddr", "localhost:50053", "The server address in the format of host:port")
	//SpatialIdxServerAddr = flag.String("Fileidxaddr", "localhost:50061", "The server address in the format of host:port")
	multi_size = flag.Int("multi_size", 1000, "multi data upload size")
)

func funcName() string {
	pc, _, _, _ := runtime.Caller(1)
	nameFull := runtime.FuncForPC(pc).Name() // main.foo
	nameEnd := filepath.Ext(nameFull)        // .foo
	name := strings.TrimPrefix(nameEnd, ".") // foo
	return name
}

// 24.12.10 updated
// 모든 인덱스는 기본적으로 50053 포트 사용
func getPortByIndexID(indexID string) string {
	return "50053"  // 모든 인덱스가 50053 포트 사용
}



func ReadIndexConfig() {
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
		MngrIndexList[idx.IdxID] = idx
	}
}

func insertIndexConfig(idx IndexInfo) {
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

	idx.Address = "localhost:50053"

	list.Items = append(list.Items, idx)

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
}

func updateIndexConfig(idx IndexInfo) {
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

	// 구조체 슬라이스 수정
	for i, item := range list.Items {
		if item.IdxID == idx.IdxID {
			list.Items[i].IndexDataCnt = idx.IndexDataCnt
			list.Items[i].BlockNum = idx.BlockNum
		}
	}

	// 수정된 데이터 마샬링
	modifiedData, err := yaml.Marshal(&list)
	if err != nil {
		log.Fatalf("수정된 데이터를 마샬링할 수 없습니다: %v", err)
	}

	// 수정된 데이터 파일에 쓰기
	err = ioutil.WriteFile("./config.yaml", modifiedData, 0644)
	if err != nil {
		log.Fatalf("수정된 데이터를 파일에 쓸 수 없습니다: %v", err)
	}
}

// 24.12.10 updated
func getServerAddress(indexID string) (string, error) {
	log.SetPrefix("[" + funcName() + "] ")
	port := getPortByIndexID(indexID)
	return fmt.Sprintf("localhost:%s", port), nil
}

// 24.12.10 updated
type ConnectionPool struct {
	mu      sync.Mutex
	clients map[string]*grpc.ClientConn
}

func NewConnectionPool() *ConnectionPool {
	return &ConnectionPool{
		clients: make(map[string]*grpc.ClientConn),
	}
}

// 24.12.10 updated
// 기존 인덱스 연결을 관리하여 이미 연결된 서버가 있다면 재사용, 없으면 새로 연결
func (p *ConnectionPool) GetConnection(indexID string) (*grpc.ClientConn, idxserverapi.HLFDataIndexClient, error) {
	log.SetPrefix("[" + funcName() + "] ")
	p.mu.Lock()
	defer p.mu.Unlock()

	log.Println("Check index with ID", indexID)

	serverAddr, err := getServerAddress(indexID)
	if err != nil {
		return nil, nil, err
	}

	//serverAddr := "localhost:50053"

	/*
		if MngrIndexList[indexID].Address != "" {
			serverAddr = MngrIndexList[indexID].Address
		}
	*/

	log.Printf("Connecting to: %s", serverAddr)

	if conn, exists := p.clients[serverAddr]; exists {
		if conn.GetState() == connectivity.Ready {
			return conn, idxserverapi.NewHLFDataIndexClient(conn), nil
		} else {
			log.Println("Connection not ready. Reconnecting...")
			conn.Close()
			delete(p.clients, serverAddr)
		}
	}

	conn, err := grpc.Dial(serverAddr,
		grpc.WithDefaultCallOptions(grpc.MaxCallRecvMsgSize(100*1024*1024)), // 100MB
		grpc.WithDefaultCallOptions(grpc.MaxCallSendMsgSize(100*1024*1024)), // 100MB
		grpc.WithInsecure())
	if err != nil {
		return nil, nil, fmt.Errorf("failed to connect to server %s: %v", serverAddr, err)
	}
	p.clients[serverAddr] = conn
	log.Printf("Connected to: %s", serverAddr)
	return conn, idxserverapi.NewHLFDataIndexClient(conn), nil

	// if conn, exists := p.clients[serverAddr]; exists {
	// 	client := idxserverapi.NewHLFDataIndexClient(conn)
	// 	return conn, client, nil
	// }
	// conn, err := grpc.Dial(serverAddr, grpc.WithInsecure())
	// if err != nil {
	// 	return nil, nil, fmt.Errorf("failed to connect to server %s: %v", serverAddr, err)
	// }

	// client := idxserverapi.NewHLFDataIndexClient(conn)
	// p.clients[serverAddr] = conn
	// return conn, client, nil
}

func (p *ConnectionPool) CloseAllConnections() {
	p.mu.Lock()
	defer p.mu.Unlock()

	for _, conn := range p.clients {
		conn.Close()
	}
}

const (
	GEO_X_MIN = 125.06666667
	GEO_X_MAX = 131.87222222
	GEO_Y_MIN = 33.10000000
	GEO_Y_MAX = 38.45000000
)

// spatial index geohash
func makeKey(x, y float64) uint32 {
	x1, x2 := GEO_X_MIN, GEO_X_MAX
	y1, y2 := GEO_Y_MIN, GEO_Y_MAX
	var xMid, yMid float64
	var key uint32 = 0
	var temp uint32 = 1 << 31 // 2^31

	for i := 15; i >= 0; i-- {
		// x 좌표 처리
		xMid = (x1 + x2) / 2
		if x > xMid {
			key += temp
			x1 = xMid
		} else {
			x2 = xMid
		}
		temp = temp >> 1

		// y 좌표 처리
		yMid = (y1 + y2) / 2
		if y > yMid {
			key += temp
			y1 = yMid
		} else {
			y2 = yMid
		}
		temp = temp >> 1
	}
	return key
}

// 확인 4/30
// 1) 각 매니저 서버에 연동하는 환경설정은 revel의 conf 파일(app.conf)에 입력한 주소 활용
// 2) 도커 관리는 도커 매니저 서버에서 환경설정을 미리 해두면 알아서 하는 것 같음.
// 3) 컬럼을 DB화해서 쓰는거랑 인덱스 쓰는 게 큰 장점으로 보이지 않음, 2개의 서버를 검색하는 느낌이 없어야 DB에서 검색하는 것처럼 느껴지지 않을 것.

// 확인 5/16
// 동일 컬럼에 대한 다수의 index 생성 시, 지원하는 질의에 따라 자동으로 생성하도록 하는 경우 (지금은 하나씩)
// time-series index unit 확인 필요

//5월 16일, 20일 통합 /////
// SELECT DISTINCT, ORDER BY, Limit, GROUP BY COUNT (SQL-like interface)]
// 1) index list 유지, 인터페이스에서 질의 전 인덱스 유무 확인할 수 있는 API
// 2) (향후) 질의 엔진에서 유지하고 있는 인덱스 리스트와 인덱스 매니저가 유지하는 인덱스 리스트 비교하는 코드
// 3) collectionDT RANGE 질의 수행 여부 확인
//////////////////////////////////////////////////////////////////
// TO-DO-100: index server 연결 정보를 동적으로 받아오고, 리스트로 관리하는 코드(the last)

// 24.05. 추가: 모든 인덱스 리스트 반환
func (m *MServer) GetIndexList(ctx context.Context, in *mngr.IndexInfoRequest) (*mngr.IndexList, error) {
	log.SetPrefix("[" + funcName() + "] ")

	ReadIndexConfig()

	idxCnt := int32(len(MngrIndexList))

	//log.Println(MngrIndexList)

	Lists := []*mngr.IndexInfo{}
	for _, val := range MngrIndexList {
		//log.Println(val)
		indexVal := &mngr.IndexInfo{
			IndexID:      val.IdxID,
			IndexName:    val.IdxName,
			KeyCol:       val.KeyCol,
			FilePath:     val.FilePath,
			BlockNum:     val.BlockNum,
			KeySize:      val.KeySize,
			IndexDataCnt: val.IndexDataCnt,
		}
		Lists = append(Lists, indexVal)
		//log.Println(indexVal)
	}
	//return value
	idxlist := &mngr.IndexList{}
	idxlist = &mngr.IndexList{
		IndexCnt: idxCnt,
		IdxList:  Lists,
	}
	//log.Println(idxlist)
	return idxlist, nil
}

// 24.05 추가: 인덱스 LIST에 인덱스 있는지 확인
func (m *MServer) GetIndexInfo(ctx context.Context, in *mngr.IndexInfo) (*mngr.IdxMngrResponse, error) {
	log.SetPrefix("[" + funcName() + "] ")
	//log.Println("Checking column...", in.KeyCol)

	myResponse := &mngr.IdxMngrResponse{}
	//if exists
	if _, exists := MngrIndexList[in.IndexID]; exists {
		//log.Println("index exists for", value)

		myResponse = &mngr.IdxMngrResponse{
			ResponseCode:    500,
			ResponseMessage: "index already exists for column " + in.KeyCol,
			IndexID:         in.IndexID,
		}
	} else {
		myResponse = &mngr.IdxMngrResponse{
			ResponseCode:    100,
			ResponseMessage: "index DOES NOT exist. CREATE ONE",
		}
	}
	return myResponse, nil
}

func (m *MServer) CreateIndexRequest(c context.Context, idxinfo *mngr.IndexInfo) (*mngr.IdxMngrResponse, error) {
	//fmt.Println(" mserver module executed ")
	log.SetPrefix("[" + funcName() + "] ")

	//client, ctx := Client_Begin()

	log.Println("Check index with ", idxinfo)

	// 인덱스 생성 시에는 기본 포트(50053) 사용
	serverAddr := "localhost:50053"
	var client idxserverapi.HLFDataIndexClient
	
	// 기존 인덱스가 있다면 연결 풀에서 가져오기
	if _, existingClient, err := m.ConnectionPool.GetConnection(idxinfo.IndexID); err == nil {
		client = existingClient
	} else {
		// 새 인덱스 생성 시에는 직접 연결
		log.Printf("New index creation, connecting to: %s", serverAddr)
		conn, err := grpc.Dial(serverAddr,
			grpc.WithDefaultCallOptions(grpc.MaxCallRecvMsgSize(100*1024*1024)),
			grpc.WithDefaultCallOptions(grpc.MaxCallSendMsgSize(100*1024*1024)),
			grpc.WithInsecure())
		if err != nil {
			log.Printf("Failed to connect to server %s: %v", serverAddr, err)
			return nil, fmt.Errorf("failed to connect to server %s: %v", serverAddr, err)
		}
		defer conn.Close()
		client = idxserverapi.NewHLFDataIndexClient(conn)
	}

	ctx, cancel := context.WithTimeout(context.Background(), time.Second*5)
	defer cancel()

	indexinfo := idxserverapi.CreateRequest{
		IndexID:   idxinfo.IndexID,
		IndexName: idxinfo.IndexName,
		KeyCol:    idxinfo.KeyCol,
		FilePath:  idxinfo.FilePath,
		KeySize:   idxinfo.KeySize,
		BlockNum:  idxinfo.BlockNum,
		//IndexDataCnt: idxinfo.IndexDataCnt,
	}

	//if the requested column index is already in the indexList
	/*
		if _, exists := MngrIndexList[indexinfo.IndexID]; exists {
				log.Println("index already exists ", value)

						resultData := &mngr.IdxMngrResponse{
							ResponseCode:    500,
							ResponseMessage: "index already exists with ID:" + indexinfo.IndexID,
							IndexID:         indexinfo.IndexID,
						}
						return resultData, nil
			resultData := &mngr.IdxMngrResponse{
				ResponseCode: 200,
			}
			return resultData, status.New(codes.OK, "").Err()

		} else { //new column index create request
	*/

	log.Println("Create index with ", indexinfo)

	//filePath := fmt.Sprintf("%s_%s_%d.bf", indexinfo.IndexID, indexinfo.KeyCol, indexinfo.KeySize)

	//indexinfo.FilePath = filePath

	rst, err := client.CreateIndex(ctx, &indexinfo)
	indexRequest := IndexInfo{
		IdxID:    indexinfo.IndexID,
		IdxName:  indexinfo.IndexName,
		KeyCol:   indexinfo.KeyCol,
		FilePath: indexinfo.FilePath,
		KeySize:  indexinfo.KeySize,
		BlockNum: indexinfo.BlockNum,
		//IndexDataCnt: indexinfo.IndexDataCnt,
	}

	if err != nil {
		log.Fatalf("error, %v", err)
	} else {
		log.Println("create index result: ", rst.IndexCol)
		log.Println("created index info = ", rst.IndexID)
	}
	MngrIndexList[indexRequest.IdxID] = indexRequest

	insertIndexConfig(indexRequest)  // 새 인덱스 추가 (updateIndexConfig가 아님)

	resultData := &mngr.IdxMngrResponse{
		ResponseCode: 200,
	}

	for key, val := range MngrIndexList {
		fmt.Println(key, val)
	}
	return resultData, status.New(codes.OK, "").Err()
	//}
}

func (m *MServer) UpdateIndexRequest(c context.Context, idxinfo *mngr.IndexInfo) (*mngr.IdxMngrResponse, error) {
	//fmt.Println(" mserver module executed ")
	log.SetPrefix("[" + funcName() + "] ")

	log.Println("Check index with ", idxinfo)

	/*
		_, client, err := m.ConnectionPool.GetConnection(idxinfo.IndexID)
		if err != nil {
			log.Println("Invalid index ID")
			return nil, err
		}

		ctx, cancel := context.WithTimeout(context.Background(), time.Second*5)
		defer cancel()

	*/

	//if the requested column index is already in the indexList
	if value, exists := MngrIndexList[idxinfo.IndexID]; exists {
		log.Println("Update index with ", idxinfo)

		indexRequest := IndexInfo{
			IdxID:        idxinfo.IndexID,
			IdxName:      idxinfo.IndexName,
			KeyCol:       idxinfo.KeyCol,
			FilePath:     idxinfo.FilePath,
			KeySize:      idxinfo.KeySize,
			BlockNum:     idxinfo.BlockNum,
			IndexDataCnt: idxinfo.IndexDataCnt,
		}

		MngrIndexList[indexRequest.IdxID] = indexRequest

		updateIndexConfig(indexRequest)

		resultData := &mngr.IdxMngrResponse{
			ResponseCode: 200,
		}

		for key, val := range MngrIndexList {
			fmt.Println(key, val)
		}
		return resultData, status.New(codes.OK, "").Err()

	} else { //column index update request

		log.Println("index not exists ", value)

		resultData := &mngr.IdxMngrResponse{
			ResponseCode:    500,
			ResponseMessage: "index not exists with ID:" + idxinfo.IndexID,
			IndexID:         idxinfo.IndexID,
		}
		return resultData, nil

	}
}

func (m *MServer) InsertIndexRequest(stream mngr.IndexManager_InsertIndexRequestServer) error {
	log.SetPrefix("[" + funcName() + "] ")

	start := time.Now()
	log.Printf("🚀 InsertIndexRequest 시작 - 클라이언트 연결됨")
	
	var idx = 0
	isFirst := true
	var cli idxserverapi.HLFDataIndexClient
	count := 0

	for {
		//Receive data from mclient
		log.Printf("📥 데이터 수신 대기 중... (루프 %d)", idx+1)
		recvDatas, r_err := stream.Recv()
		if r_err == io.EOF {
			log.Printf("✅ 스트림 종료 - 모든 데이터 수신 완료")
			return stream.SendAndClose(&mngr.IdxMngrResponse{
				ResponseMessage: "All data received",
				Duration:        int64(time.Since(start)),
			})
		}
		if r_err != nil {
			log.Printf("❌ 데이터 수신 실패: %v", r_err)
			return fmt.Errorf("failed to receive data: %v", r_err)
		}
		
		log.Printf("📥 데이터 수신됨: IndexID=%s, Network=%s, ColName=%s", 
			recvDatas.GetIndexID(), 
			recvDatas.GetNetwork(), 
			recvDatas.GetColName())

		// =============================================================================
		// 네트워크별 핸들러 처리 (새로 추가)
		// =============================================================================
		if m.NetworkFactory != nil {
			// 네트워크 정보 추출
			network := "fabric" // 기본값
			if recvDatas.Network != "" {
				network = recvDatas.Network
			}
			log.Printf("Processing data for network: %s", network)
			
			// 해당 네트워크 핸들러 가져오기
			handler, err := m.NetworkFactory.GetHandler(network)
			if err != nil {
				log.Printf("Warning: Unsupported network %s, skipping network-specific processing", network)
			} else {
				// 네트워크별 인덱싱 처리
				for _, bcData := range recvDatas.GetBcList() {
					if bcData.Pvd != nil {
						log.Printf("Processing PVD data for %s: OBU_ID=%s, Speed=%d", network, bcData.Pvd.ObuId, bcData.Pvd.Speed)
						
						// 핸들러에서 인덱싱 처리
						if err := handler.ProcessIndexing(bcData.Pvd, bcData.TxId, recvDatas.GetColName()); err != nil {
							log.Printf("Warning: Indexing failed for %s network: %v", network, err)
							continue
						}
						log.Printf("Successfully processed indexing for %s network: %s", network, bcData.TxId)
					} else if bcData.IndexableData != nil {
						log.Printf("Processing IndexableData for %s: TxID=%s, ColName=%s", network, bcData.TxId, recvDatas.GetColName())
						
						// 핸들러에서 IndexableData 인덱싱 처리
						if err := handler.ProcessIndexingIndexableData(bcData.IndexableData, bcData.TxId, recvDatas.GetColName()); err != nil {
							log.Printf("Warning: IndexableData indexing failed for %s network: %v", network, err)
							continue
						}
						log.Printf("Successfully processed IndexableData indexing for %s network: %s", network, bcData.TxId)
					}
				}
			}
		}
		
		// =============================================================================
		// 기존 인덱싱 로직 (기존 코드)
		// =============================================================================
		idxID := recvDatas.GetIndexID()
		idxCol := recvDatas.GetColName()

		//txlist := recvDatas.GetBcList()
		if idxID == "" || idxCol == "" {
			log.Printf("Invalid data received: IndexID=%s, ColName=%s", idxID, idxCol)
			continue
		}
		idx++

		//fmt.Printf("%d, mserver recv size : %d \n", idx, len(txlist))
		//log.Printf("Received IndexID: %s, ColName: %s, FilePath: %s", idxID, idxCol, recvDatas.GetFilePath())

		if isFirst {
			conn, client, err := m.ConnectionPool.GetConnection(idxID)
			if err != nil {
				log.Printf("Invalid index ID: %s", idxID)
				return status.Errorf(codes.InvalidArgument, "Invalid index ID: %s", idxID)
			}
			defer conn.Close()
			cli = client
			isFirst = false
		}

		// Process spatial index
		if idxID == "spatialidx" {
			if err := m.handleSpatialIndex(cli, recvDatas); err != nil {
				return fmt.Errorf("spatial index handling failed: %v", err)
			}
		} else { // Process standard index
			txlist := recvDatas.GetBcList()
			if idxID == "" || idxCol == "" || len(txlist) == 0 {
				//log.Printf("Invalid data received: IndexID=%s, ColName=%s, TxListSize=%d", idxID, idxCol, len(txlist))
				continue
			}

			count = count + len(txlist)

			// 모든 데이터 로그 출력 (첫 번째만이 아닌)
			for i, data := range txlist {
				log.Printf("Data[%d]: TxId=%s, IndexableData=%v", i, data.TxId, data.IndexableData)
			}

			log.Println(idxID, idxCol, count, len(txlist))

			if err := m.handleStandardIndex(cli, recvDatas); err != nil {
				return fmt.Errorf("standard index handling failed: %v", err)
			}
		}
	}
}

func (m *MServer) handleSpatialIndex(client idxserverapi.HLFDataIndexClient, recvDatas *mngr.InsertDatatoIdx) error {
	log.SetPrefix("[" + funcName() + "] ")
	ctx, cancel := context.WithTimeout(context.Background(), time.Second*5)
	defer cancel()

	stream, err := client.InsertSIndex(ctx)
	if err != nil {
		log.Printf("Failed to open spatial index stream: %v", err)
		return status.Errorf(codes.Internal, "Failed to open spatial index stream: %v", err)
	}
	defer func() {
		if err := stream.CloseSend(); err != nil {
			log.Printf("Failed to close spatial index stream: %v", err)
		}
	}()

	txdata := idxserverapi.InsertSData{
		TxId:    recvDatas.TxId,
		X:       recvDatas.X,
		Y:       recvDatas.Y,
		OBU_ID:  recvDatas.OBU_ID,
		GeoHash: recvDatas.GeoHash,
	}

	TotalCnt++
	if TotalCnt%10000 == 0 {
		log.Printf("Inserting Data[%d]: X=%.2f, Y=%.2f, GeoHash=%d, Txid=%s", TotalCnt, txdata.X, txdata.Y, txdata.GeoHash, txdata.TxId)
	}

	if err := stream.Send(&txdata); err != nil {
		log.Printf("Failed to send spatial data: %v", err)
		return err
	}

	//log.Printf("Spatial data sent: TxId=%s", recvDatas.TxId)

	resp, err := stream.CloseAndRecv()
	if err != nil {
		return fmt.Errorf("failed to receive response from spatial index server: %v", err)
	}
	if TotalCnt%100000 == 0 {
		log.Printf("Spatial index response: %s", resp.GetResponseMessage())
	}
	return nil
}

func (m *MServer) handleSpatialIndexList(client idxserverapi.HLFDataIndexClient, recvDatas *mngr.InsertDatatoIdx) error {
	log.SetPrefix("[" + funcName() + "] ")
	ctx, cancel := context.WithTimeout(context.Background(), time.Second*5)
	defer cancel()

	stream, err := client.InsertSIndex(ctx)
	if err != nil {
		log.Printf("Failed to open spatial index stream: %v", err)
		return status.Errorf(codes.Internal, "Failed to open spatial index stream: %v", err)
	}
	defer func() {
		if err := stream.CloseSend(); err != nil {
			log.Printf("Failed to close spatial index stream: %v", err)
		}
	}()

	var bclist []*idxserverapi.InsertSData
	for _, datas := range recvDatas.GetBcList() {
		convertedPvd := convertPvdHistDataMToIdxserverApi(datas.Pvd)
		latitude, err := strconv.ParseFloat(convertedPvd.StartvectorLatitude, 64)
		if err != nil {
			log.Println("StartvectorLatitude:", convertedPvd.StartvectorLatitude)
			log.Println("변환 오류:", err)
			continue
		}

		longitude, err := strconv.ParseFloat(convertedPvd.StartvectorLongitude, 64)
		if err != nil {
			log.Println("StartvectorLongitude:", convertedPvd.StartvectorLongitude)
			log.Println("변환 오류:", err)
			continue
		}

		gHash := makeKey(longitude, latitude)
		txData := idxserverapi.InsertSData{
			TxId:    datas.TxId,
			X:       float32(longitude),
			Y:       float32(latitude),
			GeoHash: gHash,
		}

		bclist = append(bclist, &txData)
		TotalCnt++
		if TotalCnt%10000 == 0 {
			log.Printf("[%d] Inserting Data: X=%.2f, Y=%.2f, GeoHash=%d, Txid=%s", TotalCnt, txData.X, txData.Y, txData.GeoHash, txData.TxId)
		}
	}

	/*

		if err := stream.Send(&bclist); err != nil {
			log.Printf("Failed to send spatial data: %v", err)
			return err
		}
	*/
	//log.Printf("Spatial data sent: TxId=%s", recvDatas.TxId)

	resp, err := stream.CloseAndRecv()
	//_, err = stream.CloseAndRecv()
	if err != nil {
		return fmt.Errorf("failed to receive response from spatial index server: %v", err)
	}

	log.Printf("Spatial index response: %s", resp.GetResponseMessage())
	return nil
}

// Handle standard index data
func (m *MServer) handleStandardIndex(client idxserverapi.HLFDataIndexClient, recvDatas *mngr.InsertDatatoIdx) error {
	log.SetPrefix("[" + funcName() + "] ")

	ctx, cancel := context.WithTimeout(context.Background(), time.Second*30)
	defer cancel()

	stream, err := client.InsertIndex(ctx)
	if err != nil {
		log.Printf("Failed to open standard index stream: %v", err)
		return status.Errorf(codes.Internal, "Failed to open standard index stream: %v", err)
	}
	defer func() {
		if err := stream.CloseSend(); err != nil {
			log.Printf("Failed to close standard index stream: %v", err)
		}
	}()

	var bclist []*idxserverapi.BcDataInfo
	for _, datas := range recvDatas.GetBcList() {
		// PVD 데이터가 있으면 PVD 사용, IndexableData가 있으면 IndexableData 사용
		var bcData *idxserverapi.BcDataInfo
		if datas.Pvd != nil {
			convertedPvd := convertPvdHistDataMToIdxserverApi(datas.Pvd)
			bcData = &idxserverapi.BcDataInfo{
				TxId: datas.TxId,
				Pvd:  convertedPvd,
			}
		} else if datas.IndexableData != nil {
			bcData = &idxserverapi.BcDataInfo{
				TxId: datas.TxId,
				IndexableData: convertIndexableDataMToIdxserverApi(datas.IndexableData),
			}
		}
		if bcData != nil {
			bclist = append(bclist, bcData)
		}
	}
	insList := &idxserverapi.InsertData{
		ColIndex: recvDatas.IndexID,
		BcList:   bclist,
		ColName:  recvDatas.ColName,
		FilePath: MngrIndexList[recvDatas.IndexID].FilePath,
		KeySize:  MngrIndexList[recvDatas.IndexID].KeySize,
	}

	// KeySize 검증 추가
	if insList.KeySize <= 0 {
		log.Printf("Invalid KeySize: %d for IndexID: %s", insList.KeySize, recvDatas.IndexID)
		return fmt.Errorf("invalid KeySize: %d for IndexID: %s", insList.KeySize, recvDatas.IndexID)
	}

	//log.Println(recvDatas.IndexID, recvDatas.ColName, insList.FilePath, insList.KeySize)

	if err := stream.Send(insList); err != nil {
		log.Printf("Failed to send standard data: %v", err)
		return err
	}

	_, err = stream.CloseAndRecv()
	if err != nil {
		return fmt.Errorf("failed to receive response from standard index server: %v", err)
	}
	//log.Printf("Standard index response: %s", resp.GetResponseMessage())
	return nil
}

func convertPvdHistDataMToIdxserverApi(data *mngr.PvdHistDataM) *idxserverapi.PvdHistData {
	if data == nil {
		return nil
	}

	return &idxserverapi.PvdHistData{
		ObuId:                data.GetObuId(),
		CollectionDt:         data.CollectionDt,
		StartvectorLatitude:  data.StartvectorLatitude,
		StartvectorLongitude: data.StartvectorLongitude,
		Transmisstion:        data.Transmisstion,
		Speed:                data.Speed,
		HazardLights:         data.HazardLights,
		LeftTurnSignalOn:     data.LeftTurnSignalOn,
		RightTurnSignalOn:    data.RightTurnSignalOn,
		Steering:             data.Steering,
		Rpm:                  data.Rpm,
		Footbrake:            data.Footbrake,
		Gear:                 data.Gear,
		Accelator:            data.Accelator,
		Wipers:               data.Wipers,
		TireWarnLeftF:        data.TireWarnLeftF,
		TireWarnLeftR:        data.TireWarnLeftR,
		TireWarnRightF:       data.TireWarnRightF,
		TireWarnRightR:       data.TireWarnRightR,
		TirePsiLeftF:         data.TirePsiLeftF,
		TirePsiLeftR:         data.TirePsiLeftR,
		TirePsiRightF:        data.TirePsiRightF,
		TirePsiRightR:        data.TirePsiRightR,
		FuelPercent:          data.FuelPercent,
		FuelLiter:            data.FuelLiter,
		Totaldist:            data.Totaldist,
		RsuId:                data.RsuId,
		MsgId:                data.MsgId,
		StartvectorHeading:   data.StartvectorHeading,
		Address:              data.Address,
		OrganizationName:     data.OrganizationName,
	}
}

func convertIndexableDataMToIdxserverApi(data *mngr.IndexableDataM) *idxserverapi.IndexableData {
	if data == nil {
		return nil
	}

	return &idxserverapi.IndexableData{
		OrganizationName: data.OrganizationName,
		// OrganizationName만 변환 (정리된 구조)
	}
}

func (m *MServer) GetindexDataByFieldM(c context.Context, req *mngr.SearchRequestM) (*mngr.RstTxListM, error) {
	log.SetPrefix("[" + funcName() + "] ")
	log.Printf("queryDatasByField =  %s", req.String())

	_, client, err := m.ConnectionPool.GetConnection(req.IndexID)
	if err != nil {
		log.Println("Invalid index ID")
		return nil, fmt.Errorf("invalid index ID: %s", req.IndexID)
	}
	if client != nil {
		log.Println("connection success")
	}

	ctx, cancel := context.WithTimeout(context.Background(), time.Second*60)
	defer cancel()

	log.Println(req)

	request, err := m.buildSearchRequest(req)
	if err != nil {
		log.Printf("Error building request: %v", err)
		return nil, status.Errorf(codes.InvalidArgument, "Failed to build request: %v", err)
	}

	log.Println(request)

	Data, err := client.GetindexDataByField(ctx, request)
	if err != nil {
		log.Printf("Error retrieving data: %v", err)
		return nil, status.Errorf(codes.Internal, "Failed to retrieve data: %v", err)
	}

	rstData := &mngr.RstTxListM{
		IdxInfo: &mngr.IndexInfo{IndexID: req.GetIndexID()},
		Key:     Data.Key,
		IdxData: Data.IdxData,
	}
	for _, txid := range Data.GetIdxData() {
		log.Println(txid)
	}
	log.Printf("Count = %d", len(Data.GetIdxData()))

	return rstData, nil
}

func (m *MServer) buildSearchRequest(req *mngr.SearchRequestM) (*idxserverapi.SearchRequest, error) {
	log.SetPrefix("[" + funcName() + "] ")

	log.Printf("request: %v", req)

	comOp := idxserverapi.ComparisonOps(req.GetComOp())
	if comOp != idxserverapi.ComparisonOps_Eq && comOp != idxserverapi.ComparisonOps_Range &&
		comOp != idxserverapi.ComparisonOps_Knn {
		return nil, fmt.Errorf("invalid Comparison Operation: %d", req.GetComOp())
	}

	// config.yaml에서 읽은 설정 사용
	indexInfo, exists := MngrIndexList[req.IndexID]
	if !exists {
		return nil, fmt.Errorf("index ID %s not found in configuration", req.IndexID)
	}
	
	request := &idxserverapi.SearchRequest{
		IndexID:  req.IndexID,
		Field:    req.Field,
		ComOp:    comOp,
		FilePath: indexInfo.FilePath,  // config.yaml에서 읽은 FilePath
		X:        req.X,
		Y:        req.Y,
		K:        req.K,
		Range:    req.Range,
		Value:    req.Value,
		Begin:    req.Begin,           // 범위 검색 시작 값 추가
		End:      req.End,             // 범위 검색 끝 값 추가
		KeySize:  indexInfo.KeySize,   // config.yaml에서 읽은 KeySize
	}
	log.Printf("Built request: %v", request)

	return request, nil
}

/*
func (m *MServer) convertToIndexValues(data *idxserverapi.RstTxList) []*mngr.IndexValue {
	txlist := []*mngr.IndexValue{}
	for _, datas := range data.GetIdxData() {
		txlist = append(txlist, &mngr.IndexValue{
			TxId: datas.GetTxId(),
			//ObuId: datas.GetObuId(),
		})
	}
	return txlist
}
*/
