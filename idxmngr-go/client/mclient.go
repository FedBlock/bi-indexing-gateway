/*
 *
 * Copyright 2015 gRPC authors.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 *
 */

// Package main implements a simple gRPC client that demonstrates how to use gRPC-Go libraries
// to perform unary, client streaming, server streaming and full duplex RPCs.
//
// It interacts with the route guide service whose definition can be found in routeguide/route_guide.proto.
package main

import (
	//pvd "grpc-go/pvdapi/grpc-go/pvdapi"
	mserver "idxmngr-go/manager"
	idxmngr "idxmngr-go/mngrapi/protos"

	"context"
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"io"
	"log"
	"os"
	"path/filepath"
	"runtime"
	"strconv"
	"strings"
	"time"

	"github.com/gocarina/gocsv"

	"google.golang.org/grpc"
	//"google.golang.org/grpc/credentials/insecure"
	"google.golang.org/grpc/keepalive"
	"google.golang.org/grpc/status"
)

var (
	cmd            = flag.String("cmd", "help", "Inline test command")
	IdxMserverAddr = flag.String("mngraddr", "localhost:50052", "The server address in the format of host:port")
	m_size         = flag.Int("m_size", 1000, "multi data upload size")
)

const (
	GEO_X_MIN = 125.06666667
	GEO_X_MAX = 131.87222222
	GEO_Y_MIN = 33.10000000
	GEO_Y_MAX = 38.45000000
)

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
func funcName() string {
	pc, _, _, _ := runtime.Caller(1)
	nameFull := runtime.FuncForPC(pc).Name() // main.foo
	nameEnd := filepath.Ext(nameFull)        // .foo
	name := strings.TrimPrefix(nameEnd, ".") // foo
	return name
}

type MngrController struct {
	MngrConn   *grpc.ClientConn
	MngrClient idxmngr.IndexManagerClient
}

// Index creation
func CreateIndexRequestM(client idxmngr.IndexManagerClient, idxinfo mserver.IndexInfo) (*idxmngr.IdxMngrResponse, error) {
	log.SetPrefix("[" + funcName() + "] ")

	//TO-DO-1: queryEngine에서 indexID, indexName, KeyCol 입력받도록 변경 (done)
	_, err := client.CreateIndexRequest(context.Background(),
		&idxmngr.IndexInfo{
			IndexID:   idxinfo.IdxID,
			IndexName: idxinfo.IdxName,
			KeyCol:    idxinfo.KeyCol,
			FilePath:  idxinfo.FilePath,
			KeySize:   idxinfo.KeySize,
		})

	if err != nil {
		rstData := &idxmngr.IdxMngrResponse{
			ResponseCode:    500,
			ResponseMessage: err.Error(),
		}
		fmt.Println(rstData)
		return rstData, nil
	} else {
		rstData := &idxmngr.IdxMngrResponse{
			ResponseCode:    200,
			ResponseMessage: "Index Generated Successfully",
		}
		fmt.Println(rstData)
		return rstData, nil
	}
	//TO-DO-2: 인덱스가 성공적으로 생성되면, 인덱스 리스트에 삽입 (done)
	//TO-DO-3: 인덱스 리스트 조회, 출력하는 함수 추가 (done)
	//TO-DO-4: 인덱스 ID 활용하여 검색, 결과 반환하는 내용 추가 - 에러처리까지
	//return nil, nil
}

// Data insertion to the index
func PutMultiDataM(client idxmngr.IndexManagerClient, idxID string, idxCol string) *idxmngr.IdxMngrResponse {
	log.SetPrefix("[" + funcName() + "] ")

	//start := time.Now()
	resultData := &idxmngr.IdxMngrResponse{
		ResponseCode:    200,
		ResponseMessage: "Data Inserted to Index Successfully" + idxID,
	}

	csvFile, err := os.OpenFile("pvd_hist_20k.csv", os.O_RDONLY, os.ModePerm)
	if err != nil {
		log.Println("failed to open csv data file")
	}
	defer csvFile.Close()

	pvdList := []*PVD_CSV{}
	if err := gocsv.UnmarshalFile(csvFile, &pvdList); err != nil { // Load clients from file
		fmt.Println("failed to gocsv.UnmarshalFile")
	}
	start := time.Now()

	ctx, cancel := context.WithTimeout(context.Background(), time.Minute*5)
	defer cancel()

	stream, err := client.InsertIndexRequest(ctx)
	if err != nil {
		log.Fatalf("Failed to open stream: %v", err)
		resultData = &idxmngr.IdxMngrResponse{
			ResponseCode:    500,
			ResponseMessage: err.Error(),
			Duration:        int64(time.Since(start)),
		}
		return resultData
	}
	// defer func() {
	// 	if _, err := stream.CloseAndRecv(); err != nil {
	// 		log.Fatalf("Error closing stream: %v", err)
	// 	}

	// }()
	defer func() {
		if err := stream.CloseSend(); err != nil {
			log.Printf("Failed to close stream: %v", err)
		}
		response, err := stream.CloseAndRecv()
		if err != nil {
			if errors.Is(err, io.EOF) {
				// Stream 종료의 정상적인 신호로 처리
				log.Printf("Stream closed by server: EOF received.")
				return
			}
			st, ok := status.FromError(err)
			if ok {
				log.Printf("gRPC Error: %v, Code: %v", st.Message(), st.Code())
			} else {
				log.Printf("Error closing stream: %v", err)
			}
		} else {
			log.Printf("Stream Closed Successfully. Response: %v", response)
		}
	}()

	if idxID == "spatialidx" {
		for idx, rec := range pvdList {
			conv_x, errX := strconv.ParseFloat(rec.Startvector_longitude, 64)
			conv_y, errY := strconv.ParseFloat(rec.Startvector_latitude, 64)
			if errX != nil || errY != nil {
				log.Printf("Skipping record %d due to invalid coordinates: %v, %v", idx, errX, errY)
				continue
			}

			txdata := idxmngr.InsertDatatoIdx{
				IndexID: idxID,
				ColName: idxCol,
				TxId:    strconv.Itoa(idx),
				X:       float32(conv_x),
				Y:       float32(conv_y),
				OBU_ID:  rec.Obu_id,
				GeoHash: makeKey(conv_x, conv_y),
			}

			if err := stream.Send(&txdata); err != nil {
				log.Fatalf("Failed to send data to index %s: %v", idxID, err)
			}

			if idx%1000 == 0 {
				log.Printf("Sent record %d to the server", idx)
				log.Printf("Inserting Data: X=%.2f, Y=%.2f, GeoHash=%d", txdata.X, txdata.Y, txdata.GeoHash)

			}
		}
		log.Println("All data has been sent successfully.")

		response, err := stream.CloseAndRecv()
		if err != nil {
			log.Fatalf("%v.CloseAndRecv() got error %v, want %v", stream, err, nil)
		}
		log.Printf("Response: %v", response)
		log.Println("Execution Time = ", time.Since(start))

		if resultData.ResponseCode == 200 {
			resultData.Duration = int64(time.Since(start))
			resultData.IndexID = idxID
		}
		return resultData

	} else {
		t := time.Now()
		fmt.Printf("[%s]UploadPVDRecord, List Size = %d\n", t.Format(time.RFC3339), len(pvdList))

		var multiDatas []*idxmngr.InsertDatatoIdx
		var lists []*idxmngr.BcDataList

		for idx, rec := range pvdList {
			Value, _ := json.Marshal(rec)
			data := idxmngr.PvdHistDataM{}
			json.Unmarshal(Value, &data)

			txdata := idxmngr.BcDataList{
				TxId: strconv.Itoa(idx),
				Pvd:  &data,
			}
			lists = append(lists, &txdata)
		}

		list_size := len(lists)
		next := 0

		for idx := 0; idx < list_size; {
			next = idx + *m_size // default multi_size = 1000
			if next > list_size {
				next = list_size
			}
			multi := idxmngr.InsertDatatoIdx{
				IndexID: idxID,
				BcList:  lists[idx:next],
				ColName: idxCol,
			}
			multiDatas = append(multiDatas, &multi)
			log.Println("start ", idx, "end ", next)
			idx = next
		}

		msize := len(multiDatas)

		log.Println("Raw Data Parsing Time = ", time.Since(t), "multidata_size: ", msize**m_size)

		for idx, datas := range multiDatas {
			if err := stream.Send(datas); err != nil {
				log.Fatalf("(IdxMngr) Failed to send datas: %v", err)

				resultData = &idxmngr.IdxMngrResponse{
					ResponseCode:    500,
					ResponseMessage: err.Error(),
					Duration:        int64(time.Since(start)),
				}
				if err == io.EOF {
					log.Println("Stream closed unexpectedly.")
				}
				return nil
			}
			//log.Println(datas)
			log.Println("Send Datas Index:  ", idx, len(multiDatas))
		}

		response, err := stream.CloseAndRecv()
		if err != nil {
			log.Fatalf("%v.CloseAndRecv() got error %v, want %v", stream, err, nil)
		}
		log.Printf("Response: %v", response)
		log.Println("Execution Time = ", time.Since(start))

		if resultData.ResponseCode == 200 {
			resultData.Duration = int64(time.Since(start))
			resultData.IndexID = idxID
		}

		return resultData
	}
}

// Index retrieval (bypass a query to GetindexDataByFieldM - Mserver method)
func IndexDatasByFieldM(client idxmngr.IndexManagerClient, request *idxmngr.SearchRequestM) []*idxmngr.IndexValue {
	log.SetPrefix("[" + funcName() + "] ")

	start := time.Now()

	log.Println(request.String())
	data, err := client.GetindexDataByFieldM(context.Background(), request)
	if err != nil {
		log.Println(err)
		return nil
	}

	//time.Sleep(2000 * time.Millisecond)
	txList := []*idxmngr.IndexValue{}
	txList = append(txList, data.GetIdxData()...)

	//keyList := data.GetKey()
	log.Println("Rst Tx Cnt :", len(txList))
	for idx, txdata := range data.GetIdxData() {
		if len(txList) > 30 && idx%10 == 0 {
			log.Println(idx, ", ", txdata)
		}
	}
	log.Println("Rst Tx Cnt :", len(txList))
	log.Println("Execution Time = ", time.Since(start))

	return txList
}

// 24.05. 추가
func GetIndexListM(client idxmngr.IndexManagerClient, request *idxmngr.IndexInfoRequest) *idxmngr.IndexList {
	log.SetPrefix("[" + funcName() + "] ")

	log.Println("REQUEST: ", request.RequestMsg)

	Lists, _ := client.GetIndexList(context.Background(), request)

	idxlist := []*idxmngr.IndexInfo{}
	for indexes, _ := range Lists.IdxList {
		idxVal := &idxmngr.IndexInfo{
			IndexID:   Lists.IdxList[indexes].IndexID,
			KeyCol:    Lists.IdxList[indexes].KeyCol,
			IndexName: Lists.IdxList[indexes].IndexName,
		}
		//log.Println("idx = ", idxVal)
		idxlist = append(idxlist, idxVal)
	}

	rstData := &idxmngr.IndexList{
		IndexCnt: Lists.GetIndexCnt(),
		IdxList:  idxlist,
	}
	// log.Println("Index Count = ", Lists.GetIndexCnt())
	// log.Println("INDEX CREATED = ", Lists.GetIdxList())
	// log.Println("first index: ", Lists.IdxList[0])

	log.Println("Return Val = ", rstData)
	return rstData
}

func GetIndexInfoM(client idxmngr.IndexManagerClient, request *idxmngr.IndexInfo) *idxmngr.IdxMngrResponse {
	log.SetPrefix("[" + funcName() + "] ")

	log.Println("Check Index with column: ", request.KeyCol)

	CheckRST, _ := client.GetIndexInfo(context.Background(), request)

	// resultData := &idxmngr.IdxMngrResponse{
	// 	ResponseCode: CheckRST.ResponseCode,
	// 	ResponseMessage: CheckRST.ResponseMessage,
	// }

	log.Println("Check Result = ", CheckRST)

	return CheckRST
}

func main() {

	qe := MngrController{}

	flag.Parse()
	//var opts []grpc.DialOption
	var err error

	//opts = append(opts, grpc.WithTransportCredentials(insecure.NewCredentials()))
	qe.MngrConn, err = grpc.Dial(*IdxMserverAddr,
		grpc.WithDefaultCallOptions(grpc.MaxCallRecvMsgSize(100*1024*1024)), // 100MB
		grpc.WithDefaultCallOptions(grpc.MaxCallSendMsgSize(100*1024*1024)), // 100MB
		grpc.WithInsecure(),
		grpc.WithKeepaliveParams(keepalive.ClientParameters{
			Time:                10 * time.Second, // Keepalive 간격
			Timeout:             20 * time.Second, // Keepalive 타임아웃
			PermitWithoutStream: true,
		}),
		grpc.WithBlock(),
	)
	if err != nil {
		log.Fatalf("fail to dial: %v", err)
	}
	defer qe.MngrConn.Close()
	qe.MngrClient = idxmngr.NewIndexManagerClient(qe.MngrConn)

	log.SetFlags(log.Ldate | log.Ltime | log.Lmicroseconds)
	log.Println("cmd: ", *cmd)
	log.Println("======================")

	switch *cmd {
	//CREATE index
	case "creates": //btree-speed
		indexRequest := mserver.IndexInfo{
			IdxID:   "btridx_sp",
			IdxName: "Mem_Speed",
			KeyCol:  "Speed",
		}
		CreateIndexRequestM(qe.MngrClient, indexRequest)
	case "created": //btree-DT
		indexRequest := mserver.IndexInfo{
			IdxID:   "btridx_dt",
			IdxName: "Mem_DT",
			KeyCol:  "CollectionDt",
		}
		CreateIndexRequestM(qe.MngrClient, indexRequest)
	case "createsp": //spatial index
		indexRequest := mserver.IndexInfo{
			IdxID:   "spatialidx",
			IdxName: "Mem_Spatial",
			KeyCol:  "StartvectorLongitude",
		}
		CreateIndexRequestM(qe.MngrClient, indexRequest)
	case "fcreates": //fileindex-speed
		indexRequest := mserver.IndexInfo{
			IdxID:    "fileidx_sp",
			IdxName:  "File_Speed",
			KeyCol:   "Speed",
			FilePath: "speed_file.bf",
			KeySize:  "5",
		}
		CreateIndexRequestM(qe.MngrClient, indexRequest)
	case "fcreated": //fileindex-DT
		indexRequest := mserver.IndexInfo{
			IdxID:    "fileidx_dt",
			IdxName:  "File_DT",
			KeyCol:   "CollectionDt",
			FilePath: "dt_file.bf",
			KeySize:  "17",
		}
		CreateIndexRequestM(qe.MngrClient, indexRequest)

	//INDEX INFO
	case "indexlist":
		GetIndexListM(qe.MngrClient, &idxmngr.IndexInfoRequest{RequestMsg: "INDEX LIST PLEASE"})
	case "indexCheck":
		GetIndexInfoM(qe.MngrClient, &idxmngr.IndexInfo{IndexID: "fileidx_sp"})

	//INSERT
	case "finserts": //fileindex-speed
		PutMultiDataM(qe.MngrClient, "fileidx_sp", "Speed")
	case "finsertd": //fileindex-DT
		PutMultiDataM(qe.MngrClient, "fileidx_dt", "CollectionDt")
	case "inserts": //btree-speed
		PutMultiDataM(qe.MngrClient, "btridx_sp", "Speed")
	case "insertd": //btree-DT
		PutMultiDataM(qe.MngrClient, "btridx_dt", "CollectionDt")
	case "insertsp": //spatial index
		PutMultiDataM(qe.MngrClient, "spatialidx", "StartvectorLongitude")

	//Query
	case "exacts": //btree-speed
		IndexDatasByFieldM(qe.MngrClient, &idxmngr.SearchRequestM{IndexID: "btridx_sp", Field: "Speed", Value: "100", ComOp: idxmngr.ComparisonOps_Eq}) //42
	case "exactd": //btree-DT
		IndexDatasByFieldM(qe.MngrClient, &idxmngr.SearchRequestM{IndexID: "btridx_dt", Field: "CollectionDt", Value: "20211001053430718", ComOp: idxmngr.ComparisonOps_Eq})
	case "ranges": //btree-speed
		IndexDatasByFieldM(qe.MngrClient, &idxmngr.SearchRequestM{IndexID: "btridx_sp", Field: "Speed", Begin: "0", End: "999", ComOp: idxmngr.ComparisonOps_Range}) //858
	case "ranged": //btree-DT
		IndexDatasByFieldM(qe.MngrClient, &idxmngr.SearchRequestM{IndexID: "btridx_dt", Field: "CollectionDt", Begin: "20211001053430718", End: "20211001055430718", ComOp: idxmngr.ComparisonOps_Range})

	case "fexacts": //fileindex-speed
		IndexDatasByFieldM(qe.MngrClient, &idxmngr.SearchRequestM{IndexID: "fileidx_sp", Field: "Speed", Value: "100", ComOp: idxmngr.ComparisonOps_Eq}) //42
	case "fexactd": //fileindex-20211001053430718
		IndexDatasByFieldM(qe.MngrClient, &idxmngr.SearchRequestM{IndexID: "fileidx_dt", Field: "CollectionDt", Value: "20211001053430718", ComOp: idxmngr.ComparisonOps_Eq})
	case "franges": //fileindex-speed
		IndexDatasByFieldM(qe.MngrClient, &idxmngr.SearchRequestM{IndexID: "fileidx_sp", Field: "Speed", Begin: "0", End: "999", ComOp: idxmngr.ComparisonOps_Range}) //858
	case "franged": //fileindex-DT
		IndexDatasByFieldM(qe.MngrClient, &idxmngr.SearchRequestM{IndexID: "fileidx_dt", Field: "CollectionDt", Begin: "20211001053430718", End: "20211001055430718", ComOp: idxmngr.ComparisonOps_Range})

	case "spkNN":
		IndexDatasByFieldM(qe.MngrClient, &idxmngr.SearchRequestM{IndexID: "spatialidx", Field: "StartvectorLongitude", X: 123, Y: 33, K: 8, ComOp: idxmngr.ComparisonOps_Knn})
	case "spRange":
		IndexDatasByFieldM(qe.MngrClient, &idxmngr.SearchRequestM{IndexID: "spatialidx", Field: "StartvectorLongitude", X: 126.2, Y: 33.2, Range: 0.08, ComOp: idxmngr.ComparisonOps_Range})

	//HELP
	case "help":
		log.Println("cmd example : -cmd=create, insert, exact, range")
	default:
		log.Println("cmd example : -cmd=create, insert, exact, range")
		//TO-DO-6: case "index list 조회" (done)
		//TO-DO-7: case "index 호출 횟수"
		//TO-DO-8: case "query 수행이력 - 질의 결과 데이터 통계"
		//TO-DO-9: case "query 수행이력 - 질의 별 수행 횟수"
		//TO-DO-10: case "query 수행이력 - 질의 수행시간 통계"
		//TO-DO-11: case "profile 조회 - key 중복 비율 (실제 질의 결과물 / 중복 제외한 결과물 비율)"
		//TO-DO-12: case "profile 조회 - 질의 수행시간? 인덱스 상관없이 하는건가.."
		//TO-DO-13: case "profile 조회 - work intensity - 7-10의 주기 별 데이터 조회"
	}
	log.Println("======================")
}

type PVD_CSV struct {
	Obu_id                string `csv:"OBU_ID" json:"obu_id"`
	Collection_dt         string `csv:"COLLECTION_DT" json:"collection_dt"`
	Startvector_latitude  string `csv:"STARTVECTOR_LATITUDE" json:"startvector_latitude"`
	Startvector_longitude string `csv:"STARTVECTOR_LONGITUDE" json:"startvector_longitude"`
	Transmisstion         string `csv:"TRANSMISSTION" json:"transmission"`
	Speed                 int    `csv:"SPEED" json:"speed"`
	Hazard_lights         string `csv:"HAZARD_LIGHTS" json:"hazard_lights"`
	Left_turn_signal_on   string `csv:"LEFT_TURN/home/etri/fabric-samples/pvd-record/grpc-go_SIGNAL_ON" json:"left_turn_signal_on"`
	Right_turn_signal_on  string `csv:"RIGHT_TURN_SIGNAL_ON" json:"right_turn_signal_on"`
	Steering              int    `csv:"STEERING" json:"steering"`
	Rpm                   int    `csv:"RPM" json:"rpm"`
	Footbrake             string `csv:"FOOTBRAKE" json:"footbrake"`
	Gear                  string `csv:"GEAR" json:"gear"`
	Accelator             int    `csv:"ACCELATOR" json:"accelator"`
	Wipers                string `csv:"WIPERS" json:"wipers"`
	Tire_warn_left_f      string `csv:"TIRE_WARN_LEFT_F" json:"tire_warn_left_f"`
	Tire_warn_left_r      string `csv:"TIRE_WARN_LEFT_R" json:"tire_warn_left_r"`
	Tire_warn_right_f     string `csv:"TIRE_WARN_RIGHT_F" json:"tire_warn_right_f"`
	Tire_warn_right_r     string `csv:"TIRE_WARN_RIGHT_R" json:"tire_warn_right_r"`
	Tire_psi_left_f       int    `csv:"TIRE_PSI_LEFT_F" json:"tire_psi_left_f"`
	Tire_psi_left_r       int    `csv:"TIRE_PSI_LEFT_R" json:"tire_psi_left_r"`
	Tire_psi_right_f      int    `csv:"TIRE_PSI_RIGHT_F" json:"tire_psi_right_f"`
	Tire_psi_right_r      int    `csv:"TIRE_PSI_RIGHT_R" json:"tire_psi_right_r"`
	Fuel_percent          int    `csv:"FUEL_PERCENT" json:"fuel_percent"`
	Fuel_liter            int    `csv:"FUEL_LITER" json:"fuel_liter"`
	Totaldist             int    `csv:"TOTALDIST" json:"totaldist"`
	Rsu_id                string `csv:"RSU_ID" json:"rsu_id"`
	Msg_id                string `csv:"MSG_ID" json:"msg_id"`
	Startvector_heading   int    `csv:"STARTVECTOR_HEADING" json:"startvector_heading"`
}
