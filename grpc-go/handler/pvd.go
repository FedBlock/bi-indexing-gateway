// handler/pvd.go
package handler

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log"
	"math"
	"math/rand"
	"path/filepath"
	"reflect"
	"runtime"
	"strconv"
	"strings"
	"sync"
	"sync/atomic"
	"time"

	"grpc-go/configuration"
	pvd "grpc-go/pvdapi/grpc-go/pvdapi"

	"github.com/hyperledger/fabric-protos-go-apiv2/common"
	pb "github.com/hyperledger/fabric-protos-go-apiv2/peer"
	"google.golang.org/grpc"
	"google.golang.org/grpc/credentials/insecure"
	"google.golang.org/protobuf/proto"

	idxmngr "grpc-go/protos"
)

type PVD_CSV struct {
	Obu_id                string `csv:"OBU_ID"`
	Collection_dt         string `csv:"COLLECTION_DT"`
	Startvector_latitude  string `csv:"STARTVECTOR_LATITUDE"`
	Startvector_longitude string `csv:"STARTVECTOR_LONGITUDE"`
	Transmisstion         string `csv:"TRANSMISSTION"`
	Speed                 int    `csv:"SPEED"`
	Hazard_lights         string `csv:"HAZARD_LIGHTS"`
	Left_turn_signal_on   string `csv:"LEFT_TURN_SIGNAL_ON"`
	Right_turn_signal_on  string `csv:"RIGHT_TURN_SIGNAL_ON"`
	Steering              int    `csv:"STEERING"`
	Rpm                   int    `csv:"RPM"`
	Footbrake             string `csv:"FOOTBRAKE"`
	Gear                  string `csv:"GEAR"`
	Accelator             int    `csv:"ACCELATOR"`
	Wipers                string `csv:"WIPERS"`
	Tire_warn_left_f      string `csv:"TIRE_WARN_LEFT_F"`
	Tire_warn_left_r      string `csv:"TIRE_WARN_LEFT_R"`
	Tire_warn_right_f     string `csv:"TIRE_WARN_RIGHT_F"`
	Tire_warn_right_r     string `csv:"TIRE_WARN_RIGHT_R"`
	Tire_psi_left_f       int    `csv:"TIRE_PSI_LEFT_F"`
	Tire_psi_left_r       int    `csv:"TIRE_PSI_LEFT_R"`
	Tire_psi_right_f      int    `csv:"TIRE_PSI_RIGHT_F"`
	Tire_psi_right_r      int    `csv:"TIRE_PSI_RIGHT_R"`
	Fuel_percent          int    `csv:"FUEL_PERCENT"`
	Fuel_liter            int    `csv:"FUEL_LITER"`
	Totaldist             int    `csv:"TOTALDIST"`
	Rsu_id                string `csv:"RSU_ID"`
	Msg_id                string `csv:"MSG_ID"`
	Startvector_heading   int    `csv:"STARTVECTOR_HEADING"`
	K                     int    `csv:"K"`
	RANGE                 int    `csv:"RANGE"`
}

type PvdServer struct {
	pvd.UnimplementedPvdServer
	idxmngrConn   *grpc.ClientConn
	idxmngrClient interface{} // idxmngr 클라이언트 인터페이스
}

func funcName() string {
	pc, _, _, _ := runtime.Caller(1)
	nameFull := runtime.FuncForPC(pc).Name() // main.foo
	nameEnd := filepath.Ext(nameFull)        // .foo
	name := strings.TrimPrefix(nameEnd, ".") // foo
	return name
}

// SplitSlice splits a slice into chunks of the specified size
func SplitSlice(data []string, chunkSize int) [][]string {
	var chunks [][]string
	totalSize := len(data)
	numChunks := int(math.Ceil(float64(totalSize) / float64(chunkSize)))

	for i := 0; i < numChunks; i++ {
		start := i * chunkSize
		end := (i + 1) * chunkSize
		if end > totalSize {
			end = totalSize
		}
		chunks = append(chunks, data[start:end])
	}

	return chunks
}

// NewPvdServer creates a new PvdServer instance with idxmngr connection
func NewPvdServer() *PvdServer {
	server := &PvdServer{}
	
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
		server.idxmngrConn = conn
		log.Printf("Successfully connected to idxmngr at %s", idxmngrAddr)
	}
	
	return server
}

func (h PvdServer) PutData(ctx context.Context, req *pvd.SinglePvd) (*pvd.PvdResponse, error) {

	log.SetPrefix("[" + funcName() + "] ")

	start := time.Now()
	
	// 디버깅: 요청 데이터 전체 출력
	log.Printf("DEBUG: 전체 요청 데이터: %+v", req)
	log.Printf("DEBUG: 요청 타입: %T", req)
	log.Printf("DEBUG: ChainInfo: %+v", req.GetChainInfo())
	log.Printf("DEBUG: Pvd: %+v", req.GetPvd())
	log.Printf("DEBUG: 요청 JSON: %s", req.String())
	
	log.Println("Request ID = ", req.GetPvd().GetObuId())

	data, err := json.Marshal(req.GetPvd())
	if err != nil {
		return &pvd.PvdResponse{
			ResponseCode:    500,
			ResponseMessage: err.Error(),
		}, err
	}

	log.Printf("PutData Create data: %s\n", string(data))

	result, err := configuration.MyContracts[0].SubmitTransaction("CreateUpdatePVD", string(data))
	if err != nil {
		return &pvd.PvdResponse{
			ResponseCode:    500,
			ResponseMessage: "failed to json Marshal PVD data",
			Duration:        int64(time.Since(start)),
		}, err
	} else {
		log.Printf("PutData Created TxId: %s\n", string(result))

		// 인덱싱은 외부에서 별도로 처리 (mclient.go 사용)
		// 순환 의존성 방지를 위해 pvd.go에서는 인덱싱하지 않음
		log.Printf("PVD 데이터 저장 완료. 인덱싱은 mclient.go에서 별도 처리 필요")

		return &pvd.PvdResponse{
			ResponseCode: 200,
			TxId:         string(result),
			Duration:     int64(time.Since(start)),
		}, nil
	}
}

// sendIndexingRequest sends indexing request to idxmngr
func (h PvdServer) sendIndexingRequest(pvdData *pvd.PvdHist, txID string) {
	log.Printf("Sending indexing request to idxmngr for TxID: %s", txID)
	
	if h.idxmngrConn == nil {
		log.Printf("idxmngr connection is not available")
		return
	}
	
	// idxmngr 클라이언트 생성
	idxmngrClient := idxmngr.NewIndexManagerClient(h.idxmngrConn)
	
	// PVD 데이터를 idxmngr 형식으로 변환
	log.Printf("Preparing PVD data for indexing:")
	log.Printf("  OBU_ID: %s", pvdData.GetObuId())
	log.Printf("  Speed: %d", pvdData.GetSpeed())
	log.Printf("  CollectionDt: %s", pvdData.GetCollectionDt())
	log.Printf("  TxID: %s", txID)
	
	// PvdHistDataM 구조체 생성
	pvdHistData := &idxmngr.PvdHistDataM{
		ObuId:                pvdData.GetObuId(),
		CollectionDt:         pvdData.GetCollectionDt(),
		StartvectorLatitude:  pvdData.GetStartvectorLatitude(),
		StartvectorLongitude: pvdData.GetStartvectorLongitude(),
		Transmisstion:        pvdData.GetTransmisstion(),
		Speed:                int32(pvdData.GetSpeed()),
		HazardLights:         pvdData.GetHazardLights(),
		LeftTurnSignalOn:     pvdData.GetLeftTurnSignalOn(),
		RightTurnSignalOn:    pvdData.GetRightTurnSignalOn(),
		Steering:             int32(pvdData.GetSteering()),
		Rpm:                  int32(pvdData.GetRpm()),
		Footbrake:            pvdData.GetFootbrake(),
		Gear:                 pvdData.GetGear(),
		Accelator:            int32(pvdData.GetAccelator()),
		Wipers:               pvdData.GetWipers(),
		TireWarnLeftF:        pvdData.GetTireWarnLeftF(),
		TireWarnLeftR:        pvdData.GetTireWarnLeftR(),
		TireWarnRightF:       pvdData.GetTireWarnRightF(),
		TireWarnRightR:       pvdData.GetTireWarnRightR(),
		TirePsiLeftF:         int32(pvdData.GetTirePsiLeftF()),
		TirePsiLeftR:         int32(pvdData.GetTirePsiLeftR()),
		TirePsiRightF:        int32(pvdData.GetTirePsiRightF()),
		TirePsiRightR:        int32(pvdData.GetTirePsiRightR()),
		FuelPercent:          int32(pvdData.GetFuelPercent()),
		FuelLiter:            int32(pvdData.GetFuelLiter()),
		Totaldist:            int32(pvdData.GetTotaldist()),
		RsuId:                pvdData.GetRsuId(),
		MsgId:                pvdData.GetMsgId(),
		StartvectorHeading:   int32(pvdData.GetStartvectorHeading()),
	}
	
	// BcDataList 생성
	bcDataList := &idxmngr.BcDataList{
		TxId:   txID,
		KeyCol: "Speed", // Speed 필드로 인덱싱
		Pvd:    pvdHistData,
	}
	
	// InsertDatatoIdx 구조체 생성
	insertData := &idxmngr.InsertDatatoIdx{
		IndexID:  "speed_001", // 통합 인덱스 ID (모든 Speed 데이터)
		BcList:   []*idxmngr.BcDataList{bcDataList},
		ColName:  "Speed",
		TxId:     txID,
		OBU_ID:   pvdData.GetObuId(),
		FilePath: "data/fabric/speed_001.bf", // 통합 파일 경로
		Network:  "fabric", // Fabric 네트워크 지정
	}
	
	// idxmngr에 인덱싱 요청 전송
	ctx, cancel := context.WithTimeout(context.Background(), time.Minute*5)
	defer cancel()
	
	stream, err := idxmngrClient.InsertIndexRequest(ctx)
	if err != nil {
		log.Printf("Failed to open stream to idxmngr: %v", err)
		return
	}
	
	defer func() {
		if err := stream.CloseSend(); err != nil {
			log.Printf("Failed to close stream: %v", err)
		}
		response, err := stream.CloseAndRecv()
		if err != nil {
			log.Printf("Error closing stream: %v", err)
		} else {
			log.Printf("Indexing request completed. Response: %v", response)
		}
	}()
	
	if err := stream.Send(insertData); err != nil {
		log.Printf("Failed to send indexing data: %v", err)
		return
	}
	
	log.Printf("Indexing request sent successfully for OBU_ID: %s, TxID: %s, Speed: %d", 
		pvdData.GetObuId(), txID, pvdData.GetSpeed())
}

func (h PvdServer) PutMultiData(stream pvd.Pvd_PutMultiDataServer) error {

	log.SetPrefix("[" + funcName() + "] ")

	start := time.Now()

	concurrency := 50
	var total uint64 = 0
	var wg sync.WaitGroup
	recv_idx := 0

	for {
		recvDatas, err := stream.Recv()
		if err != nil {
			return err
		}
		if err == io.EOF {
			return nil
		}

		wg.Add(concurrency)
		for i := 0; i < concurrency; i++ {
			node := i
			go func() {
				defer wg.Done()
				for idx, rec := range recvDatas.GetBcList() {
					if (idx % (concurrency)) == node {
						data, _ := json.Marshal(rec.GetPvd())
						//log.Println(string(data))
						txid, err2 := configuration.MyContracts[0].SubmitTransaction("CreateUpdatePVD", string(data))
						if err2 == nil {
							rec.TxId = string(txid)
						} else {
							log.Println("error :", err2.Error())
						}

						atomic.AddUint64(&total, 1)
						// debug code
						if (total % 10000) == 0 {
							log.Println("PVD :", rec.Pvd.String())
							log.Printf("idx[%d] txid: %s \n", total, rec.TxId)
						}
						time.Sleep(5 * time.Millisecond)
					}
				}
			}()
		}
		wg.Wait()

		recvDatas.Index = int32(len(recvDatas.GetBcList()))
		recvDatas.Response = &pvd.PvdResponse{
			ResponseCode: 200,
			Duration:     int64(time.Since(start)),
		}
		log.Printf("Recv Data[%d] Index:  %d \n", recv_idx, recvDatas.Index)
		if err := stream.Send(recvDatas); err != nil {
			return err
		}
		recv_idx++
	}
}

// GetData return single transaction world states data by SinglePvd.Pvd.Obu_id
func (h PvdServer) GetData(ctx context.Context, req *pvd.SinglePvd) (*pvd.TxData, error) {

	start := time.Now()
	log.SetPrefix("[" + funcName() + "] ")

	log.Println("Request ID = ", req.GetPvd().GetObuId())

	evaluateResult, err := configuration.MyContracts[0].EvaluateTransaction("ReadPVD", req.GetPvd().GetObuId())
	if err != nil {
		return &pvd.TxData{
			Response: &pvd.PvdResponse{
				ResponseCode:    500,
				ResponseMessage: err.Error(),
				Duration:        int64(time.Since(start)),
			},
		}, err
	} else {
		data := pvd.PvdHist{}
		json.Unmarshal(evaluateResult, &data)
		log.Printf("*** Result:%s\n", data.String())

		return &pvd.TxData{
			Pvd: &data,
			Response: &pvd.PvdResponse{
				ResponseCode: 200,
				Duration:     int64(time.Since(start)),
			},
		}, nil
	}
}

// GetDataByTxID is QSCC GetTransactionByID return transactions equal transaction id list
func (h PvdServer) GetDataByTxID(req *pvd.TxList, stream pvd.Pvd_GetDataByTxIDServer) error {

	log.SetPrefix("[" + funcName() + "] ")
	//log.Println("GetDataByTxID Start")
	start := time.Now()

	nodes := len(configuration.RuntimeConf.Profile)
	//log.Println("Read ConnectProfile size = ", nodes)

	channelName := configuration.RuntimeConf.Profile[0].ChannelName

	txLists := []string{}
	txLists = req.GetTxId()
	txSize := len(txLists)
	//log.Println("Request Tx Count = ", txSize)

	markCnt := int32(1)

	if txSize > 100 {
		markCnt = int32(txSize / 100)
	}

	concurrency := nodes

	var total int32 = 0
	var wg sync.WaitGroup
	var mutex sync.Mutex
	wg.Add(concurrency)

	for i := 0; i < concurrency; i++ {
		node := i
		go func() {
			defer wg.Done()
			mutex.Lock()
			defer mutex.Unlock()
			for idx, txid := range txLists {
				if idx%concurrency == node {
					if configuration.QsccContracts[node] != nil {
						evaluateResult, err := configuration.QsccContracts[node].EvaluateTransaction("GetTransactionByID", channelName, txid)
						if err == nil {
							txdata := parseTransactionFromResult(txid, evaluateResult)
							if txdata != nil {
								txdata.Response = &pvd.PvdResponse{
									ResponseCode: 200,
									Duration:     int64(time.Since(start)),
								}
								atomic.AddInt32(&total, 1)
								stream.Send(txdata)
								if total%markCnt == 0 {
									//log.Printf("node[%d][%d] Request TxID = %s", node, idx, txdata.GetTxId())
									fmt.Printf(".")
								}
							}
						} else {
							log.Print("Error: ", fmt.Errorf("failed to evaluate GetTransactionByID : %s", txid))
						}
					}
				}
			}
		}()
	}
	wg.Wait()
	/*
		fmt.Println(".")
		log.Println("Execution Time = ", time.Since(start))
		log.Println("Total TxID Found Count= ", total)
	*/
	return nil
}

func getTxListData(txList []string) *pvd.TxListData {

	nodes := len(configuration.RuntimeConf.Profile)
	txSize := len(txList)
	log.Println("TxID Request Count= ", txSize)
	channelName := configuration.RuntimeConf.Profile[0].ChannelName
	var wg sync.WaitGroup
	wg.Add(nodes)
	var mutex sync.Mutex

	var txDatas []*pvd.TxData

	for i := 0; i < nodes; i++ {
		node := i
		go func() {
			defer wg.Done()
			for idx, txid := range txList {
				if idx%nodes == node {
					if configuration.QsccContracts[node] != nil {
						evaluateResult, err := configuration.QsccContracts[node].EvaluateTransaction("GetTransactionByID", channelName, txid)
						if err == nil {
							txdata := parseTransactionFromResult(txid, evaluateResult)
							if txdata != nil {
								mutex.Lock()
								txDatas = append(txDatas, txdata)
								mutex.Unlock()
							}
						} else {
							log.Print("Error: ", fmt.Errorf("failed to evaluate GetTransactionByID : %s", txid))
						}
					}
				}
			}
		}()
	}
	wg.Wait()

	log.Println("TxID Result Count= ", len(txDatas))
	return &pvd.TxListData{
		ListDatas: txDatas,
		Response: &pvd.PvdResponse{
			ResponseCode: 200,
		},
	}
}

func (h PvdServer) GetDataByTxList(req *pvd.TxList, stream pvd.Pvd_GetDataByTxListServer) error {

	log.SetPrefix("[" + funcName() + "] ")

	txLists := []string{}
	txLists = req.GetTxId()
	txSize := len(txLists)
	log.Println("TxID Request Count= ", txSize)

	chunkSize := 10000
	chunks := SplitSlice(txLists, chunkSize)

	var total int32 = 0

	for _, chunk := range chunks {
		txListDatas := getTxListData(chunk)
		total += int32(len(txListDatas.ListDatas))
		stream.Send(txListDatas)
	}

	log.Println("TxID Found Total Count= ", total)
	return nil
}

func (h PvdServer) GetDataByTxListOld(ctx context.Context, req *pvd.TxList) (*pvd.TxListData, error) {

	log.SetPrefix("[" + funcName() + "] ")
	nodes := len(configuration.RuntimeConf.Profile)
	channelName := configuration.RuntimeConf.Profile[0].ChannelName

	txLists := []string{}
	txLists = req.GetTxId()
	txSize := len(txLists)
	log.Println("TxID Request Count= ", txSize)

	concurrency := nodes

	var total int32 = 0
	var wg sync.WaitGroup
	wg.Add(concurrency)
	var mutex sync.Mutex

	//txDatas := make([]*pvd.TxData, txSize, txSize+1)
	var txDatas []*pvd.TxData
	start := time.Now()

	for i := 0; i < concurrency; i++ {
		node := i
		go func() {
			defer wg.Done()
			for idx, txid := range txLists {
				if idx%concurrency == node {
					if configuration.QsccContracts[node] != nil {
						evaluateResult, err := configuration.QsccContracts[node].EvaluateTransaction("GetTransactionByID", channelName, txid)
						if err == nil {
							txdata := parseTransactionFromResult(txid, evaluateResult)
							if txdata != nil {
								atomic.AddInt32(&total, 1)
								mutex.Lock()
								txDatas = append(txDatas, txdata)
								mutex.Unlock()
							}
						} else {
							log.Print("Error: ", fmt.Errorf("failed to evaluate GetTransactionByID : %s", txid))
						}
					}
				}
			}
		}()
	}
	wg.Wait()

	log.Println("TxID Found Total Count= ", total)
	log.Println("TxID Found List Count= ", len(txDatas))
	/*
		if txSize > 0 {
			elapsed := time.Since(start)
			log.Println("GetTransactionByID Execution Time = ", elapsed.Seconds()/float64(txSize))
		}
	*/
	txListDatas := pvd.TxListData{
		ListDatas: txDatas,
		Response: &pvd.PvdResponse{
			ResponseCode: 200,
			Duration:     int64(time.Since(start)),
		},
	}
	return &txListDatas, nil
}

func (h PvdServer) GetDataByTxList1(ctx context.Context, req *pvd.TxList) (*pvd.TxListData, error) {

	log.SetPrefix("[" + funcName() + "] ")
	nodes := len(configuration.RuntimeConf.Profile)
	channelName := configuration.RuntimeConf.Profile[0].ChannelName

	txLists := req.GetTxId()
	txSize := len(txLists)
	log.Println("Request Tx Count = ", txSize)

	var node int

	rand.Seed(time.Now().UnixNano())
	node = rand.Intn(nodes)

	txDatas := make([]*pvd.TxData, txSize, txSize+1)
	start := time.Now()
	for _, txid := range txLists {
		if configuration.QsccContracts[node] != nil {
			evaluateResult, err := configuration.QsccContracts[node].EvaluateTransaction("GetTransactionByID", channelName, txid)
			if err == nil {
				txdata := parseTransactionFromResult(txid, evaluateResult)
				if txdata != nil {
					txDatas = append(txDatas, txdata)
				}
			} else {
				log.Print("Error: ", fmt.Errorf("failed to evaluate GetTransactionByID : %s", txid))
			}
		}
	}
	if txSize > 0 {
		elapsed := time.Since(start)
		log.Println("GetTransactionByID Execution Time = ", elapsed.Seconds()/float64(txSize))
	}
	txListDatas := pvd.TxListData{
		ListDatas: txDatas,
		Response: &pvd.PvdResponse{
			ResponseCode: 200,
			Duration:     int64(time.Since(start)),
		},
	}
	return &txListDatas, nil
}

func (h PvdServer) GetDataByKeyTxID(ctx context.Context, req *pvd.TxList) (*pvd.MultiData, error) {

	start := time.Now()
	log.SetPrefix("[" + funcName() + "] ")

	//nodes := len(configuration.RuntimeConf.Profile)
	//log.Println("Read ConnectProfile size = ", nodes)

	//contract := ClientConnect(configuration.RuntimeConf.Profile[0])

	limit := len(req.TxId)
	log.Printf("Find Key : %s, length : %d\n", req.Key, limit)

	evaluateResult, err := configuration.MyContracts[0].EvaluateTransaction("GetHistroyForKey", req.Key)
	if err != nil {
		log.Print("Error: ", fmt.Errorf("failed to evaluate GetHistroyForKey : %s", req.Key))
		return nil, err
	} else {

		var lists []*pvd.BcData
		if evaluateResult != nil {
			json.Unmarshal(evaluateResult, &lists)
		} else {
			log.Printf("evaluateResult is nil \n")
		}

		var bclists []*pvd.BcData

		for _, txid := range req.TxId {
			for _, rec := range lists {
				if rec.TxId == txid {
					//log.Printf("PVD Data : %+v\n", rec)
					bclists = append(bclists, rec)
					break
				}
			}
		}

		if len(bclists) > 0 {
			log.Printf(" Found Count : %d\n", len(bclists))
			multi := pvd.MultiData{
				Index:  int32(len(bclists)),
				BcList: bclists,
				Response: &pvd.PvdResponse{
					ResponseCode: 200,
					Duration:     int64(time.Since(start)),
				},
			}
			return &multi, nil
		}
	}
	return nil, nil
}

func (h PvdServer) GetDataByKeyTxID2(ctx context.Context, req *pvd.TxList) (*pvd.MultiData, error) {

	start := time.Now()
	log.SetPrefix("[" + funcName() + "] ")

	limit := len(req.TxId)
	log.Printf("Find Key : %s, length : %d\n", req.Key, limit)
	concurrency := len(configuration.RuntimeConf.Profile)
	var wg sync.WaitGroup
	wg.Add(concurrency)

	result := make(chan pvd.MultiData, 1)

	for i := 0; i < concurrency; i++ {
		node := i
		go func() {
			defer wg.Done()
			evaluateResult, err := configuration.MyContracts[node].EvaluateTransaction("GetHistroyForKey", req.Key)
			if err != nil {
				log.Print("Error: ", fmt.Errorf("failed to evaluate GetHistroyForKey : %s", req.Key))
			} else {

				var lists []*pvd.BcData
				if evaluateResult != nil {
					json.Unmarshal(evaluateResult, &lists)
				} else {
					log.Printf("evaluateResult is nil \n")
				}

				bcDataMap := make(map[string]*pvd.BcData, len(lists))

				for _, pvdData := range lists {
					bcDataMap[pvdData.TxId] = pvdData
				}

				var bclists []*pvd.BcData

				for _, txid := range req.TxId {
					if _, found := bcDataMap[txid]; found {
						//log.Printf("PVD Data : %+v\n", bcDataMap[txid])
						bclists = append(bclists, bcDataMap[txid])
					}
				}

				if len(bclists) > 0 {
					log.Printf(" Found Count : %d\n", len(bclists))
					multi := pvd.MultiData{
						Index:  int32(len(bclists)),
						BcList: bclists,
						Response: &pvd.PvdResponse{
							ResponseCode: 200,
							Duration:     int64(time.Since(start)),
						},
					}
					result <- multi
				}
			}
		}()
	}
	wg.Wait()

	return nil, nil
}

// getDataByField is find world states datas matching field value(support only equal case)
func (h PvdServer) GetDataByField(req *pvd.FieldInfo, stream pvd.Pvd_GetDataByFieldServer) error {

	log.SetPrefix("[" + funcName() + "] ")
	start := time.Now()

	contract := ClientConnect(configuration.RuntimeConf.Profile[0])

	evaluateResult, err := contract.EvaluateTransaction("GetPvdWorldStates") // evaluateResult = []*pvd.PvdHist
	if err != nil {
		log.Print("Error: ", fmt.Errorf("failed to evaluate GetPvdWorldStates "))
	}

	lists := []PVD_CSV{}
	json.Unmarshal(evaluateResult, &lists)

	isFirst := true
	isMatch := false
	fIndex := 0
	count := 0
	var vType reflect.Type
	iValue := 0

	log.Printf("GetDataByField : %+v \n", req)

	for i, rec := range lists {
		v := reflect.ValueOf(rec)
		type_of_fields := v.Type()
		isMatch = false
		if isFirst {
			for j := 0; j < v.NumField(); j++ {
				if type_of_fields.Field(j).Name == req.Field {
					isFirst = false
					fIndex = j
					//log.Println("GetDataByField Match Field Name: ", type_of_fields.Field(j).Name)
					//log.Println("GetDataByField Match Field Value: ", v.Field(j).Interface())
					vType = reflect.TypeOf(v.Field(j).Interface())
					if vType.Kind() == reflect.Int {
						iValue, _ = strconv.Atoi(req.GetValue())
						log.Printf("GetDataByField Find Field Value: %d\n", iValue)
						if v.Field(j).Interface() == iValue {
							log.Printf(" Result[%d]: %+v \n", i, rec)
							isMatch = true
						}
					} else if vType.Kind() == reflect.String {
						if v.Field(j).Interface() == req.Value {
							log.Printf(" Result[%d]: %+v\n", i, rec)
							isMatch = true
						}
					}
				}
			}
		} else {
			if vType.Kind() == reflect.Int {
				if v.Field(fIndex).Interface() == iValue {
					//log.Printf(" Result[%d]: %+v\n", i, rec)
					isMatch = true
				}
			} else if vType.Kind() == reflect.String {
				if v.Field(fIndex).Interface() == req.Value {
					//log.Printf(" Result[%d]: %+v\n", i, rec)
					isMatch = true
				}
			}

		}

		if isMatch == true {
			pvdHist := pvd.PvdHist{}
			temp, _ := json.Marshal(rec)
			json.Unmarshal(temp, &pvdHist)
			bcdata := pvd.BcData{Pvd: &pvdHist}
			bcdata.Response = &pvd.PvdResponse{
				ResponseCode: 200,
				Duration:     int64(time.Since(start)),
			}

			if err := stream.Send(&bcdata); err != nil {
				return err
			}
			count++
		}
	}
	if isFirst {
		log.Printf("Field Name: %s Not match !!\n", req.Field)
	} else {
		log.Printf("Matched Result: %d\n", count)
	}
	return nil
}

func (h PvdServer) GetWorldState(ctx context.Context, req *pvd.ChainInfo) (*pvd.MultiPvd, error) {
	log.SetPrefix("[" + funcName() + "] ")

	log.Println(" ChannelName : ", configuration.RuntimeConf.Profile[0].ChannelName)
	log.Println(" ChaincodeName  : ", configuration.RuntimeConf.Profile[0].ChaincodeName)
	
	// 받은 요청 데이터 로그 추가
	log.Println(" [DEBUG] 받은 요청 데이터:")
	log.Println("   - req.ChannelName:", req.ChannelName)
	log.Println("   - req.Chaincode:", req.Chaincode)
	log.Println("   - req.String():", req.String())

	start := time.Now()

	if req.ChannelName != configuration.RuntimeConf.Profile[0].ChannelName {
		log.Printf(" [ERROR] 채널명 불일치: 요청=%s, 설정=%s", req.ChannelName, configuration.RuntimeConf.Profile[0].ChannelName)
		err3 := errors.New("not match channelname")
		return nil, err3
	}
	
	// 체인코드 이름이 qscc이거나 config에 명시된 이름과 일치하는지 확인
	if req.Chaincode != "qscc" && req.Chaincode != "pvdRecord" && req.Chaincode != configuration.RuntimeConf.Profile[0].ChaincodeName {
		log.Printf(" [ERROR] 체인코드명 불일치: 요청=%s, 설정=%s", req.Chaincode, configuration.RuntimeConf.Profile[0].ChaincodeName)
		err3 := errors.New("not match chaincode name")
		return nil, err3
	}

	contract := ClientConnect(configuration.RuntimeConf.Profile[0])

	evaluateResult, err := contract.EvaluateTransaction("GetPvdWorldStates")
	if err != nil {
		log.Print("Error: ", fmt.Errorf("failed to evaluate GetPvdWorldStates "))
		return nil, err
	} else {

		var lists []*pvd.PvdHist
		json.Unmarshal(evaluateResult, &lists)

		log.Println(" Result Length = ", len(lists))

		return &pvd.MultiPvd{
			PvdList: lists,
			Response: &pvd.PvdResponse{
				ResponseCode: 200,
				Duration:     int64(time.Since(start)),
			},
		}, nil
	}
}

func (h PvdServer) GetRichQuery(ctx context.Context, req *pvd.QueryInfo) (*pvd.MultiPvd, error) {
	log.SetPrefix("[" + funcName() + "] ")

	start := time.Now()

	if req.ChannelName != configuration.RuntimeConf.Profile[0].ChannelName {
		err3 := errors.New("not match channelname")
		return nil, err3
	}
	
	// 체인코드 이름이 qscc이거나 config에 명시된 이름과 일치하는지 확인
	if req.Chaincode != "qscc" && req.Chaincode != "pvdRecord" && req.Chaincode != configuration.RuntimeConf.Profile[0].ChaincodeName {
		err3 := errors.New("not match chaincode name")
		return nil, err3
	}

	log.SetPrefix("[" + funcName() + "] ")
	contract := ClientConnect(configuration.RuntimeConf.Profile[0])

	log.Println(" ChannelName : ", configuration.RuntimeConf.Profile[0].ChannelName)
	log.Println(" ChaincodeName  : ", configuration.RuntimeConf.Profile[0].ChaincodeName)
	log.Println(" Filter : ", req.Filter)

	evaluateResult, err := contract.EvaluateTransaction("GetPvdRichQuery", req.Filter)
	if err != nil {
		log.Print("Error: ", fmt.Errorf("failed to evaluate GetPvdRichQuery "))
		return nil, err
	} else {

		var lists []*pvd.PvdHist
		json.Unmarshal(evaluateResult, &lists)

		log.Println(" Result Length = ", len(lists))

		return &pvd.MultiPvd{
			PvdList: lists,
			Response: &pvd.PvdResponse{
				ResponseCode: 200,
				Duration:     int64(time.Since(start)),
			},
		}, nil
	}
}

func (h PvdServer) GetRichQueryHistory(req *pvd.QueryInfo, stream pvd.Pvd_GetRichQueryHistoryServer) error {

	log.SetPrefix("[" + funcName() + "] ")
	nodes := len(configuration.RuntimeConf.Profile)
	//log.Println("Read ConnectProfile size = ", nodes)
	evaluateResult, err := configuration.MyContracts[0].EvaluateTransaction("GetKeyLists")
	if err != nil {
		log.Print("Error: ", fmt.Errorf("failed to evaluate GetKeyLists "))
		return err
	}

	var lists []*pvd.FieldInfo
	json.Unmarshal(evaluateResult, &lists)

	log.Println(" Key Lists Length = ", len(lists))

	//concurrency := nodes * 30
	concurrency := nodes
	var wg sync.WaitGroup
	wg.Add(concurrency)
	var mutex sync.Mutex

	for i := 0; i < concurrency; i++ {
		node := i
		go func() {
			defer wg.Done()
			for idx, field := range lists {
				if (idx % (concurrency)) == node {
					evaluateResult, err := configuration.MyContracts[node%nodes].EvaluateTransaction("GetPvdRichQueryHistory", field.Key, req.Filter)
					if err != nil {
						log.Print("Error: ", fmt.Errorf("failed to evaluate GetPvdRichQueryHistory : %s", field.Key))
					} else {
						var lists []*pvd.PvdHist
						json.Unmarshal(evaluateResult, &lists)

						if len(lists) > 0 {
							fmt.Printf("%d, ", len(lists))
							multi := pvd.MultiPvd{
								PvdList: lists,
								Response: &pvd.PvdResponse{
									ResponseCode: 200,
								},
							}
							mutex.Lock()
							stream.Send(&multi)
							mutex.Unlock()
						}
					}
				}
			}
		}()
	}
	wg.Wait()

	return nil
}

// GetChainInfo is QSCC GetChainInfo return chain info and current block height
func (h PvdServer) GetChainInfo(ctx context.Context, req *pvd.ChainInfo) (*pvd.ChainInfo, error) {

	log.SetPrefix("[" + funcName() + "] ")
	start := time.Now()

	evaluateResult, err := configuration.QsccContracts[0].EvaluateTransaction("GetChainInfo", req.ChannelName)
	if err != nil {
		log.Print("Error: ", fmt.Errorf("failed to evaluate GetChainInfo "))
		return nil, err
	} else {

		info := &common.BlockchainInfo{}
		proto.Unmarshal(evaluateResult, info)

		log.Println(" Height = ", info.Height)

		nodes := []string{}

		for _, profile := range configuration.RuntimeConf.Profile {
			nodes = append(nodes, profile.MspID)
		}
		log.Println(" Node Name = ", nodes)

		return &pvd.ChainInfo{
			ChannelName: req.ChannelName,
			Height:      int32(info.Height),
			Response: &pvd.PvdResponse{
				ResponseCode: 200,
				Duration:     int64(time.Since(start)),
			},
			Nodes: nodes,
		}, nil
	}
}

func (h PvdServer) GetBlock(ctx context.Context, req *pvd.ChainInfo) (*pvd.MultiData, error) {

	log.SetPrefix("[" + funcName() + "] ")
	start := time.Now()

	if req.ChannelName != configuration.RuntimeConf.Profile[0].ChannelName {
		err3 := errors.New("not match channelname")
		return nil, err3
	}
	
	// 체인코드 이름이 qscc이거나 config에 명시된 이름과 일치하는지 확인
	if req.Chaincode != "qscc" && req.Chaincode != "pvdRecord" && req.Chaincode != configuration.RuntimeConf.Profile[0].ChaincodeName {
		err3 := errors.New("not match chaincode name")
		return nil, err3
	}

	log.Println("Request Block Number = ", req.Height)

	evaluateResult, err := configuration.QsccContracts[0].EvaluateTransaction("GetBlockByNumber", req.ChannelName, strconv.Itoa(int(req.Height)))
	if err != nil {
		log.Print("Error: ", fmt.Errorf("failed to evaluate GetBlockByNumber : %d ", req.Height))
		return nil, err
	} else {

		block := &common.Block{}
		proto.Unmarshal(evaluateResult, block)
		//log.Println("*** common.Block:", block.String())

		log.Println(" Block Number : ", block.Header.GetNumber())
		//log.Println(" Data : ", string(block.GetData().Data[0]))
		log.Println(" Block Tx Count  : ", len(block.GetData().Data))

		var lists []*pvd.BcData

		for idx, data := range block.GetData().Data {
			bData := common.BlockData{}
			proto.Unmarshal(data, &bData)
			//log.Println(" Block Data : ", bData.String())
			log.Println(" Block Tx Index: ", idx)

			payload := &common.Payload{}
			proto.Unmarshal(bData.Data[0], payload)

			//log.Println(" payload : ", payload.String())
			channelHeader := &common.ChannelHeader{}
			proto.Unmarshal(payload.GetHeader().GetChannelHeader(), channelHeader)
			log.Println("*** TxId: ", channelHeader.GetTxId())

			transaction := &pb.Transaction{}
			if err := proto.Unmarshal(payload.GetData(), transaction); err != nil {
			}

			result, _ := parseResultFromTransactionAction1(transaction.Actions[0])
			log.Println("*** PVD: ", string(result))
			/*
			   for _, transactionAction := range transaction.GetActions() {
			       //log.Println("*** txAction: ", transactionAction.String())
			       result, _ := parseResultFromTransactionAction1(transactionAction)
			       log.Println("*** readByBlock Result: \n", string(result))
			   }
			*/
			var pvd_hist pvd.PvdHist
			json.Unmarshal(result, &pvd_hist)
			txdata := pvd.BcData{
				TxId: channelHeader.GetTxId(),
				Pvd:  &pvd_hist,
			}

			lists = append(lists, &txdata)
		}

		log.Println(" Result Length = ", len(lists))

		return &pvd.MultiData{
			BcList: lists,
			Response: &pvd.PvdResponse{
				ResponseCode: 200,
				Duration:     int64(time.Since(start)),
			},
		}, nil
	}
}

// GetAllBlock : ChianInfo.Height value is start block number
// return MuliData.Index is block number
func (h PvdServer) GetAllBlock(req *pvd.ChainInfo, stream pvd.Pvd_GetAllBlockServer) error {

	log.SetPrefix("[" + funcName() + "] ")
	start := time.Now()

	nodes := len(configuration.RuntimeConf.Profile)
	log.Println("Read ConnectProfile size = ", nodes)

	concurrency := nodes

	height := int32(0)
	index := req.GetHeight()
	log.Println(" Start Block Height : ", index)

	evaluateResult, err := configuration.QsccContracts[0].EvaluateTransaction("GetChainInfo", req.ChannelName)
	if err != nil {
		log.Print("Error: ", fmt.Errorf("failed to evaluate GetChainInfo "))
		return err
	} else {

		info := &common.BlockchainInfo{}
		proto.Unmarshal(evaluateResult, info)
		height = int32(info.Height)
		log.Println(" Block Height : ", height)
	}

	var wg sync.WaitGroup
	wg.Add(concurrency)

	for i := 0; i < concurrency; i++ {
		node := i
		go func() {
			defer wg.Done()

			for index < height {
				if (index % int32(concurrency)) == int32(node) {
					//log.Println(" Block Number : ", index, " concurrency : ", node)
					evaluateResult, err := configuration.QsccContracts[node].EvaluateTransaction("GetBlockByNumber", req.ChannelName, strconv.Itoa(int(index)))
					if err != nil {
						log.Print("Error: ", fmt.Errorf("failed to evaluate  GetBlockByNumber : %d, %w", index, err))
						atomic.AddInt32(&index, 1)
					} else {
						block := &common.Block{}
						proto.Unmarshal(evaluateResult, block)
						blockNumber := block.Header.GetNumber()
						//log.Println("*** common.Block:", block.String())
						//log.Println(" Block Number : ", block.Header.GetNumber())
						//log.Println(" Data : ", string(block.GetData().Data[0]))
						//log.Println(" Block Tx Count  : ", len(block.GetData().Data))

						var lists []*pvd.BcData

						for _, data := range block.GetData().Data {
							bData := common.BlockData{}
							proto.Unmarshal(data, &bData)
							//log.Println(" Block Data : ", bData.String())
							//log.Println(" Block Tx Index: ", idx)

							payload := &common.Payload{}
							proto.Unmarshal(bData.Data[0], payload)

							//log.Println(" payload : ", payload.String())
							channelHeader := &common.ChannelHeader{}
							proto.Unmarshal(payload.GetHeader().GetChannelHeader(), channelHeader)
							//log.Println("*** TxId: ", channelHeader.GetTxId())

							transaction := &pb.Transaction{}
							if err := proto.Unmarshal(payload.GetData(), transaction); err != nil {
							}

							/*
								result, _ := parseResultFromTransactionAction1(transaction.Actions[0])
								log.Println("*** PVD: ", string(result))
							*/
							var pvd_hist pvd.PvdHist
							for _, transactionAction := range transaction.GetActions() {
								//log.Println("*** txAction: ", transactionAction.String())
								result, _ := parseResultFromTransactionAction1(transactionAction)
								//log.Println("*** readByBlock Result: \n", string(result))
								json.Unmarshal(result, &pvd_hist)
							}
							txdata := pvd.BcData{
								TxId: channelHeader.GetTxId(),
								Pvd:  &pvd_hist,
							}

							lists = append(lists, &txdata)
						}

						multi := pvd.MultiData{
							//Index:  int32(index),
							Index:  int32(blockNumber),
							BcList: lists,
							Response: &pvd.PvdResponse{
								ResponseCode: 200,
								Duration:     int64(time.Since(start)),
							},
						}
						if err := stream.Send(&multi); err != nil {
							//return err
						}
						//log.Println(" Result Length = ", len(lists))
						atomic.AddInt32(&index, 1)
					}
				}
			}
		}()
	}
	wg.Wait()
	fmt.Println(".")
	log.Println("Execution Time = ", time.Since(start))
	return nil
}

// GetRangeBlock : ChianInfo.Start value is start block number
// return MuliData.Index is block number
func (h PvdServer) GetRangeBlock(req *pvd.ChainInfo, stream pvd.Pvd_GetRangeBlockServer) error {

	log.SetPrefix("[" + funcName() + "] ")
	start := time.Now()

	nodes := len(configuration.RuntimeConf.Profile)
	log.Println("Read ConnectProfile size = ", nodes)

	concurrency := nodes

	height := int32(0)
	startBlockNum := req.GetStart()
	log.Println(" Start Block Number : ", startBlockNum)
	endBlockNum := req.GetEnd()
	log.Println(" End Block Number : ", endBlockNum)

	evaluateResult, err := configuration.QsccContracts[0].EvaluateTransaction("GetChainInfo", req.ChannelName)
	if err != nil {
		log.Print("Error: ", fmt.Errorf("failed to evaluate GetChainInfo "))
		return err
	} else {

		info := &common.BlockchainInfo{}
		proto.Unmarshal(evaluateResult, info)
		height = int32(info.Height)
		log.Println(" Block Height : ", height)
	}

	var wg sync.WaitGroup
	wg.Add(concurrency)

	index := startBlockNum

	if endBlockNum > height {
		endBlockNum = height
	}

	for i := 0; i < concurrency; i++ {
		node := i
		go func() {
			defer wg.Done()

			for index <= endBlockNum {
				if (index % int32(concurrency)) == int32(node) {
					//log.Println(" Block Number : ", index, " concurrency : ", node)
					evaluateResult, err := configuration.QsccContracts[node].EvaluateTransaction("GetBlockByNumber", req.ChannelName, strconv.Itoa(int(index)))
					if err != nil {
						log.Print("Error: ", fmt.Errorf("failed to evaluate  GetBlockByNumber : %d, %w", index, err))
						atomic.AddInt32(&index, 1)
					} else {
						block := &common.Block{}
						proto.Unmarshal(evaluateResult, block)
						blockNumber := block.Header.GetNumber()
						//log.Println("*** common.Block:", block.String())
						//log.Println(" Block Number : ", block.Header.GetNumber())
						//log.Println(" Data : ", string(block.GetData().Data[0]))
						//log.Println(" Block Tx Count  : ", len(block.GetData().Data))

						var lists []*pvd.BcData

						for _, data := range block.GetData().Data {
							bData := common.BlockData{}
							proto.Unmarshal(data, &bData)
							//log.Println(" Block Data : ", bData.String())
							//log.Println(" Block Tx Index: ", idx)

							payload := &common.Payload{}
							proto.Unmarshal(bData.Data[0], payload)

							//log.Println(" payload : ", payload.String())
							channelHeader := &common.ChannelHeader{}
							proto.Unmarshal(payload.GetHeader().GetChannelHeader(), channelHeader)
							//log.Println("*** TxId: ", channelHeader.GetTxId())

							transaction := &pb.Transaction{}
							if err := proto.Unmarshal(payload.GetData(), transaction); err != nil {
							}

							/*
								result, _ := parseResultFromTransactionAction1(transaction.Actions[0])
								log.Println("*** PVD: ", string(result))
							*/
							var pvd_hist pvd.PvdHist
							for _, transactionAction := range transaction.GetActions() {
								//log.Println("*** txAction: ", transactionAction.String())
								result, _ := parseResultFromTransactionAction1(transactionAction)
								//log.Println("*** readByBlock Result: \n", string(result))
								json.Unmarshal(result, &pvd_hist)
							}
							txdata := pvd.BcData{
								TxId: channelHeader.GetTxId(),
								Pvd:  &pvd_hist,
							}

							lists = append(lists, &txdata)
						}

						multi := pvd.MultiData{
							//Index:  int32(index),
							Index:  int32(blockNumber),
							BcList: lists,
							Response: &pvd.PvdResponse{
								ResponseCode: 200,
								Duration:     int64(time.Since(start)),
							},
						}
						if err := stream.Send(&multi); err != nil {
							//return err
						}
						//log.Println(" Result Length = ", len(lists))
						atomic.AddInt32(&index, 1)
					}
				}
			}
		}()
	}
	wg.Wait()
	fmt.Println(".")
	log.Println("Execution Time = ", time.Since(start))
	return nil
}

func (h PvdServer) GetHistoryData(ctx context.Context, req *pvd.SinglePvd) (*pvd.MultiData, error) {

	log.SetPrefix("[" + funcName() + "] ")
	start := time.Now()

	if req.ChainInfo.ChannelName != configuration.RuntimeConf.Profile[0].ChannelName {
		err3 := errors.New("not match channelname")
		return nil, err3
	}
	
	// 체인코드 이름이 qscc이거나 config에 명시된 이름과 일치하는지 확인
	if req.ChainInfo.Chaincode != "qscc" && req.ChainInfo.Chaincode != "pvdRecord" && req.ChainInfo.Chaincode != configuration.RuntimeConf.Profile[0].ChaincodeName {
		err3 := errors.New("not match chaincode name")
		return nil, err3
	}

	log.Println("Request ID = ", req.GetPvd().GetObuId())

	evaluateResult, err := configuration.MyContracts[0].EvaluateTransaction("GetHistroyForKey", req.GetPvd().GetObuId())
	if err != nil {
		log.Print("Error: ", fmt.Errorf("failed to evaluate GetHistroyForKey : %s", req.GetPvd().GetObuId()))
		return nil, err
	} else {

		var lists []*pvd.BcData
		json.Unmarshal(evaluateResult, &lists)
		log.Println(" Result Length = ", len(lists))

		return &pvd.MultiData{
			Index:  int32(len(lists)),
			BcList: lists,
			Response: &pvd.PvdResponse{
				ResponseCode: 200,
				Duration:     int64(time.Since(start)),
			},
		}, nil
	}
}

// GetAllData return all transaction data by keylist history based
// nodes * 30 goroutines
func (h PvdServer) GetAllData(req *pvd.ChainInfo, stream pvd.Pvd_GetAllDataServer) error {

	log.SetPrefix("[" + funcName() + "] ")

	start := time.Now()

	nodes := len(configuration.RuntimeConf.Profile)
	log.Println("Read ConnectProfile size = ", nodes)
	log.Printf("Evaluate Transaction: getKeyLists \n")
	evaluateResult, err := configuration.MyContracts[0].EvaluateTransaction("GetKeyLists")
	if err != nil {
		log.Print("Error: ", fmt.Errorf("failed to evaluate GetKeyLists "))
		return err
	}

	var lists []*pvd.FieldInfo
	json.Unmarshal(evaluateResult, &lists)

	log.Println(" Key Lists Length = ", len(lists))

	concurrency := nodes * 30
	var wg sync.WaitGroup
	wg.Add(concurrency)

	for i := 0; i < concurrency; i++ {
		node := i
		go func() {
			defer wg.Done()
			for idx, field := range lists {
				if (idx % (concurrency)) == node {
					evaluateResult, err := configuration.MyContracts[node%nodes].EvaluateTransaction("GetHistroyForKey", field.Key)
					if err != nil {
						log.Print("Error: ", fmt.Errorf("failed to evaluate GetHistroyForKey : %s", field.Key))
					} else {
						var lists []*pvd.BcData
						json.Unmarshal(evaluateResult, &lists)
						fmt.Printf("%d, ", len(lists))
						multi := pvd.MultiData{
							BcList: lists,
							Response: &pvd.PvdResponse{
								ResponseCode: 200,
								Duration:     int64(time.Since(start)),
							},
						}
						stream.Send(&multi)
					}
				}
			}
		}()
	}
	wg.Wait()

	fmt.Println()
	log.Println("Execution Time = ", time.Since(start))
	return nil
}

func (h PvdServer) GetAllDataByField(req *pvd.FieldInfo, stream pvd.Pvd_GetAllDataByFieldServer) error {

	log.SetPrefix("[" + funcName() + "] ")

	nodes := len(configuration.RuntimeConf.Profile)
	log.Println("Read ConnectProfile size = ", nodes)
	start := time.Now()

	log.Printf("Evaluate Transaction: getKeyLists \n")
	evaluateResult, err := configuration.MyContracts[0].EvaluateTransaction("GetKeyLists")
	if err != nil {
		log.Println("Error EvaluateTransaction -> GetKeyLists")
		return err
	}

	var lists []*pvd.FieldInfo
	json.Unmarshal(evaluateResult, &lists)

	log.Println(" Key Lists Length = ", len(lists))

	concurrency := nodes * 30
	var wg sync.WaitGroup
	wg.Add(concurrency)

	var total uint64 = 0

	isFirst := true
	//isMatch := false
	fIndex := 0
	var vType reflect.Type
	iValue := 0
	var pvdHist *pvd.PvdHist
	for i := 0; i < concurrency; i++ {
		node := i
		go func() {
			defer wg.Done()

			for idx, field := range lists {
				if (idx % (concurrency)) == node {
					evaluateResult2, err := configuration.MyContracts[node%nodes].EvaluateTransaction("GetHistroyForKey", field.Key)
					if err != nil {
						log.Print("Error: ", fmt.Errorf("failed to evaluate GetHistroyForKey : %s", field.Key))
					} else {

						var lists []*pvd.BcData
						json.Unmarshal(evaluateResult2, &lists)

						var bclists []*pvd.BcData

						raw := PVD_CSV{}

						for _, rec := range lists {
							//log.Printf("PVD Data : %+v\n", rec)

							pvdHist = rec.GetPvd()
							txid := rec.GetTxId()
							temp, _ := json.Marshal(pvdHist)
							json.Unmarshal(temp, &raw)

							v := reflect.ValueOf(raw)
							type_of_fields := v.Type()
							if isFirst {
								for j := 0; j < v.NumField(); j++ {
									if type_of_fields.Field(j).Name == req.Field {
										isFirst = false
										fIndex = j
										//log.Println("GetDataByField Match Field Name: ", type_of_fields.Field(j).Name)
										//log.Println("GetDataByField Match Field Value: ", v.Field(j).Interface())
										vType = reflect.TypeOf(v.Field(j).Interface())
										if vType.Kind() == reflect.Int {
											iValue, _ = strconv.Atoi(req.GetValue())
											//log.Printf("GetDataByField Find Field Value: %d\n", iValue)
											if v.Field(j).Interface() == iValue {
												//log.Printf(" Result[%d]: %+v\n", i, raw)
												bcdata := pvd.BcData{TxId: txid, Pvd: pvdHist}
												bclists = append(bclists, &bcdata)
												atomic.AddUint64(&total, 1)
											}
										} else if vType.Kind() == reflect.String {
											if v.Field(j).Interface() == req.Value {
												//log.Printf(" Result[%d]: %+v\n", i, raw)
												bcdata := pvd.BcData{TxId: txid, Pvd: pvdHist}
												bclists = append(bclists, &bcdata)
												atomic.AddUint64(&total, 1)
											}
										}
									}
								}
							} else {
								if vType.Kind() == reflect.Int {
									if v.Field(fIndex).Interface() == iValue {
										//log.Printf(" Result[%d]: %+v\n", i, raw)
										bcdata := pvd.BcData{TxId: txid, Pvd: pvdHist}
										bclists = append(bclists, &bcdata)
										atomic.AddUint64(&total, 1)
									} else {
										//log.Printf(" %d ", v.Field(fIndex).Interface())
									}
								} else if vType.Kind() == reflect.String {
									if v.Field(fIndex).Interface() == req.Value {
										//log.Printf(" Result[%d]: %+v\n", i, raw)
										bcdata := pvd.BcData{TxId: txid, Pvd: pvdHist}
										bclists = append(bclists, &bcdata)
										atomic.AddUint64(&total, 1)
									}
								}

							}
						}

						if len(bclists) > 0 {
							//log.Printf(" Index[%d] Find Count : %d\n", idx, len(bclists))
							fmt.Printf(" [%d]:%d, ", idx, len(bclists))
							multi := pvd.MultiData{
								Index:  int32(len(bclists)),
								BcList: bclists,
								Response: &pvd.PvdResponse{
									ResponseCode: 200,
									Duration:     int64(time.Since(start)),
								},
							}
							if err := stream.Send(&multi); err != nil {
								//return err
							}
						}
						time.Sleep(time.Millisecond)
					}
				}
			}
		}()
	}
	wg.Wait()

	time.Sleep(5 * time.Millisecond)
	finalCount := atomic.LoadUint64(&total)

	fmt.Println()
	log.Println("Execution Time = ", time.Since(start))
	log.Println("*** Transaction committed successfully count = ", finalCount)
	return nil
}

func (h PvdServer) GetAllDataByTime(req *pvd.TimeInfo, stream pvd.Pvd_GetAllDataByTimeServer) error {

	log.SetPrefix("[" + funcName() + "] ")

	nodes := len(configuration.RuntimeConf.Profile)
	log.Println("Read ConnectProfile size = ", nodes)

	start := time.Now()

	log.Printf("Evaluate Transaction: getKeyLists \n")
	evaluateResult, err := configuration.MyContracts[0].EvaluateTransaction("GetKeyLists")
	if err != nil {
		log.Println("Error EvaluateTransaction -> GetKeyLists")
		return err
	}

	var keylists []*pvd.FieldInfo
	json.Unmarshal(evaluateResult, &keylists)

	log.Println(" Key Lists Length = ", len(keylists))

	concurrency := nodes * 30
	var wg sync.WaitGroup
	wg.Add(concurrency)

	var total uint64 = 0

	for i := 0; i < concurrency; i++ {
		node := i
		go func() {
			defer wg.Done()

			for idx, field := range keylists {
				if (idx % (concurrency)) == node {
					evaluateResult2, err := configuration.MyContracts[node%nodes].EvaluateTransaction("GetHistroyForKey", field.Key)
					if err != nil {
						log.Print("Error: ", fmt.Errorf("failed to evaluate GetHistroyForKey : %s", field.Key))
					} else {

						var lists []*pvd.BcData
						json.Unmarshal(evaluateResult2, &lists)

						var bclists []*pvd.BcData

						for _, rec := range lists {
							//log.Printf("PVD Data : %+v\n", rec)

							pvdHist := rec.GetPvd()
							txid := rec.GetTxId()

							if (pvdHist.CollectionDt >= req.Start) && (pvdHist.CollectionDt <= req.End) {
								//log.Printf(" Result: %+v\n", pvdHist)
								bcdata := pvd.BcData{TxId: txid, Pvd: pvdHist}
								bclists = append(bclists, &bcdata)
								atomic.AddUint64(&total, 1)
							}
						}

						if len(bclists) > 0 {
							//log.Printf(" Index[%d] Find Count : %d\n", idx, len(bclists))
							fmt.Printf("[%d]:%d, ", idx, len(bclists))
							multi := pvd.MultiData{
								Index:  int32(len(bclists)),
								BcList: bclists,
								Response: &pvd.PvdResponse{
									ResponseCode: 200,
									Duration:     int64(time.Since(start)),
								},
							}
							if err := stream.Send(&multi); err != nil {
								//return err
							}
						}
						time.Sleep(time.Millisecond)
					}
				}
			}
		}()
	}
	wg.Wait()

	time.Sleep(5 * time.Millisecond)
	finalCount := atomic.LoadUint64(&total)

	fmt.Println()
	log.Println("Execution Time = ", time.Since(start))
	log.Println("*** Transaction committed successfully count = ", finalCount)
	return nil
}
