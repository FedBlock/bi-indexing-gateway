/*
 * Copyright 2015 gRPC authors.
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *     http://www.apache.org/licenses/LICENSE-2.0
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

// Package main implements a gRPC client for index management operations
package main

import (
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
	"runtime"
	"strconv"
	"strings"
	"time"

	"github.com/gocarina/gocsv"

	"google.golang.org/grpc"
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
	nameFull := runtime.FuncForPC(pc).Name()
	// main.foo -> foo 형태로 변환
	if idx := strings.LastIndex(nameFull, "."); idx != -1 {
		return nameFull[idx+1:]
	}
	return nameFull
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
				TxId:    "dummy_tx_" + strconv.Itoa(idx),  // 더미 TxId 생성
				X:       float32(conv_x),
				Y:       float32(conv_y),
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
				TxId: "dummy_tx_" + strconv.Itoa(idx),  // 더미 TxId 생성
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
	
	// string 타입의 IdxData를 IndexValue 구조체로 변환
	for _, txId := range data.GetIdxData() {
		indexValue := &idxmngr.IndexValue{
			TxId: txId,
		}
		txList = append(txList, indexValue)
	}

	//keyList := data.GetKey()
	log.Println("Rst Tx Cnt :", len(txList))
	for idx, txdata := range txList {
		log.Printf("[%d] TxId: %s", idx, txdata.TxId)
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

// IndexableData 더미 데이터 생성 (정리됨)
func generateIndexableDataDummy() []*idxmngr.IndexableDataM {
	var dummyDataList []*idxmngr.IndexableDataM

	// 삼성전자 관련 더미 데이터
	for i := 0; i < 7; i++ {
		dummyData := &idxmngr.IndexableDataM{
			OrganizationName: "삼성전자",
		}
		dummyDataList = append(dummyDataList, dummyData)
	}

	return dummyDataList
}

// Organization-specific dummy data generation (정리됨)
func generateOrganizationDummyData(orgName string) []*idxmngr.IndexableDataM {
	var dummyDataList []*idxmngr.IndexableDataM

	// 조직별 더미 데이터 생성 (각 조직당 5개씩)
	for i := 0; i < 5; i++ {
		dummyData := &idxmngr.IndexableDataM{
			OrganizationName: orgName,
		}
		dummyDataList = append(dummyDataList, dummyData)
	}

	return dummyDataList
}



// IndexableData 삽입 함수
func PutIndexableDataM(client idxmngr.IndexManagerClient, idxID string, idxCol string) {
	start := time.Now()
	log.Printf("IndexableData 삽입 시작...")

	// 더미 데이터 생성
	dummyDataList := generateIndexableDataDummy()

	log.Printf("생성된 더미 데이터: %d개", len(dummyDataList))

	// BcDataList로 변환
	var bcDataList []*idxmngr.BcDataList
	for idx, data := range dummyDataList {
		bcData := &idxmngr.BcDataList{
			TxId:          fmt.Sprintf("tx_%d", idx),  // 별도 TxId 생성
			IndexableData: data,
		}
		bcDataList = append(bcDataList, bcData)
	}

	insertData := &idxmngr.InsertDatatoIdx{
		IndexID: idxID,
		BcList:  bcDataList,
		ColName: idxCol,
		FilePath: "/home/blockchain/bi-index-migration/bi-index/fileindex-go/universal_org_file.bf",
		// KeySize: 32, // This was removed due to proto definition
	}

	ctx, cancel := context.WithTimeout(context.Background(), time.Minute*5)
	defer cancel()

	stream, err := client.InsertIndexRequest(ctx)
	if err != nil {
		log.Fatalf("Failed to open stream: %v", err)
	}

	defer func() {
		if err := stream.CloseSend(); err != nil {
			log.Printf("Failed to close stream: %v", err)
		}
		response, err := stream.CloseAndRecv()
		if err != nil {
			if errors.Is(err, io.EOF) {
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

	if err := stream.Send(insertData); err != nil {
		log.Fatalf("Failed to send data: %v", err)
	}

	log.Printf("IndexableData 삽입 완료. 총 %d개 데이터, 소요시간: %v", len(dummyDataList), time.Since(start))
}



// Organization-specific data insertion
func PutOrganizationDataM(client idxmngr.IndexManagerClient, idxID string, idxCol string, orgName string) {
	start := time.Now()
	log.Printf("%s 데이터 삽입 시작...", orgName)

	// 조직별 더미 데이터 생성
	dummyDataList := generateOrganizationDummyData(orgName)

	log.Printf("생성된 %s 더미 데이터: %d개", orgName, len(dummyDataList))

	// BcDataList로 변환
	var bcDataList []*idxmngr.BcDataList
	for idx, data := range dummyDataList {
		bcData := &idxmngr.BcDataList{
			TxId:          fmt.Sprintf("tx_%d", idx),  // 별도 TxId 생성
			IndexableData: data,
		}
		bcDataList = append(bcDataList, bcData)
	}

	// 파일 경로 설정 (조직별)
	filePath := fmt.Sprintf("fileindex-go/%s.bf", strings.ToLower(strings.Replace(orgName, "전자", "", -1)))

	insertData := &idxmngr.InsertDatatoIdx{
		IndexID: idxID,
		BcList:  bcDataList,
		ColName: idxCol,
		FilePath: filePath,
	}

	ctx, cancel := context.WithTimeout(context.Background(), time.Minute*5)
	defer cancel()

	stream, err := client.InsertIndexRequest(ctx)
	if err != nil {
		log.Fatalf("Failed to open stream: %v", err)
	}

	defer func() {
		if err := stream.CloseSend(); err != nil {
			log.Printf("Failed to close stream: %v", err)
		}
		response, err := stream.CloseAndRecv()
		if err != nil {
			if errors.Is(err, io.EOF) {
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

	if err := stream.Send(insertData); err != nil {
		log.Fatalf("Failed to send data: %v", err)
	}

	log.Printf("%s 데이터 삽입 완료. 총 %d개 데이터, 소요시간: %v", orgName, len(dummyDataList), time.Since(start))
}

// Organization-specific data search
func SearchOrganizationDataM(client idxmngr.IndexManagerClient, idxID string, field string, value string) {
	log.Printf("%s 데이터 검색 시작...", value)

	searchRequest := &idxmngr.SearchRequestM{
		IndexID: idxID,
		Field:   field,
		Value:   value,
		ComOp:   idxmngr.ComparisonOps_Eq,
	}

	// 기존의 IndexDatasByFieldM 함수 사용
	result := IndexDatasByFieldM(client, searchRequest)
	
	log.Printf("검색 결과: %+v", result)
	log.Printf("%s 데이터 검색 완료", value)
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
	// ===== INDEX CREATION =====
	// B-tree indexes
	case "creates": // btree-speed
		CreateIndexRequestM(qe.MngrClient, mserver.IndexInfo{
			IdxID:   "btridx_sp",
			IdxName: "Mem_Speed",
			KeyCol:  "Speed",
		})
	case "created": // btree-DT
		CreateIndexRequestM(qe.MngrClient, mserver.IndexInfo{
			IdxID:   "btridx_dt",
			IdxName: "Mem_DT",
			KeyCol:  "CollectionDt",
		})
	case "createsp": // spatial index
		CreateIndexRequestM(qe.MngrClient, mserver.IndexInfo{
			IdxID:   "spatialidx",
			IdxName: "Mem_Spatial",
			KeyCol:  "StartvectorLongitude",
		})

	// File indexes
	case "fcreates": // fileindex-speed
		CreateIndexRequestM(qe.MngrClient, mserver.IndexInfo{
			IdxID:    "fileidx_sp",
			IdxName:  "File_Speed",
			KeyCol:   "Speed",
			FilePath: "speed_file.bf",
			KeySize:  5,
		})
	case "fcreated": // fileindex-DT
		CreateIndexRequestM(qe.MngrClient, mserver.IndexInfo{
			IdxID:    "fileidx_dt",
			IdxName:  "File_DT",
			KeyCol:   "CollectionDt",
			FilePath: "dt_file.bf",
			KeySize:  17,
		})
	case "fcreateorg": // fileindex-organization
		CreateIndexRequestM(qe.MngrClient, mserver.IndexInfo{
			IdxID:    "fileidx_org",
			IdxName:  "File_Organization",
			KeyCol:   "OrganizationName",
			FilePath: "organization_file.bf",
			KeySize:  32,
		})
	case "fcreateuniversalorg": // fileindex-universal-organization
		CreateIndexRequestM(qe.MngrClient, mserver.IndexInfo{
			IdxID:    "fileidx_universal_org",
			IdxName:  "File_Universal_Organization",
			KeyCol:   "IndexableData",
			FilePath: "universal_org_file.bf",
			KeySize:  32,
		})


	// TODO 사용자별 Wallet 인덱스 생성
	

	// ===== INDEX INFORMATION =====
	case "indexlist":
		GetIndexListM(qe.MngrClient, &idxmngr.IndexInfoRequest{RequestMsg: "INDEX LIST PLEASE"})
	case "indexCheck":
		GetIndexInfoM(qe.MngrClient, &idxmngr.IndexInfo{IndexID: "fileidx_sp"})

	//INSERT
	case "finserts": //fileindex-speed
		PutMultiDataM(qe.MngrClient, "fileidx_sp", "Speed")
	case "finsertd": //fileindex-DT
		PutMultiDataM(qe.MngrClient, "fileidx_dt", "CollectionDt")
	case "finsertorg": //fileindex-organization
		PutPublicBC(qe.MngrClient, "fileidx_org", "OrganizationName")
	case "finsertuniversalorg": //fileindex-universal-organization
		PutPublicBC(qe.MngrClient, "fileidx_universal_org", "IndexableData")
	
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
		IndexDatasByFieldM(qe.MngrClient, &idxmngr.SearchRequestM{IndexID: "fileidx_sp", Field: "Speed", Value: "85", ComOp: idxmngr.ComparisonOps_Eq, KeySize: 5}) //42
	case "fexactd": //fileindex-20211001053430718
		IndexDatasByFieldM(qe.MngrClient, &idxmngr.SearchRequestM{IndexID: "fileidx_dt", Field: "CollectionDt", Value: "20241001001000385", ComOp: idxmngr.ComparisonOps_Eq})
	case "franges": //fileindex-speed
		IndexDatasByFieldM(qe.MngrClient, &idxmngr.SearchRequestM{IndexID: "fileidx_sp", Field: "Speed", Begin: "80", End: "90", ComOp: idxmngr.ComparisonOps_Range}) //858
	case "franged": //fileindex-DT
		IndexDatasByFieldM(qe.MngrClient, &idxmngr.SearchRequestM{IndexID: "fileidx_dt", Field: "CollectionDt", Begin: "20211001053430718", End: "20211001055430718", ComOp: idxmngr.ComparisonOps_Range})

	case "fexactorg": //fileindex-organization (범용 인덱스 사용)
		IndexDatasByFieldM(qe.MngrClient, &idxmngr.SearchRequestM{IndexID: "fileidx_universal_org", Field: "IndexableData", Value: "삼성전자", ComOp: idxmngr.ComparisonOps_Eq})
	case "frangorg": //fileindex-organization (범용 인덱스 사용)
		IndexDatasByFieldM(qe.MngrClient, &idxmngr.SearchRequestM{IndexID: "fileidx_universal_org", Field: "IndexableData", Begin: "A", End: "Z", ComOp: idxmngr.ComparisonOps_Range})

	case "fexactuniversalorg": //fileindex-universal-organization
		IndexDatasByFieldM(qe.MngrClient, &idxmngr.SearchRequestM{IndexID: "fileidx_universal_org", Field: "IndexableData", Value: "Org_1", ComOp: idxmngr.ComparisonOps_Eq})
	case "franguniversalorg": //fileindex-universal-organization
		IndexDatasByFieldM(qe.MngrClient, &idxmngr.SearchRequestM{IndexID: "fileidx_universal_org", Field: "IndexableData", Begin: "Org_", End: "Org_z", ComOp: idxmngr.ComparisonOps_Range})

	case "fexactwallet": //fileindex-wallet-address
		IndexDatasByFieldM(qe.MngrClient, &idxmngr.SearchRequestM{IndexID: "fileidx_wallet", Field: "IndexableData", Value: "wallet_hash_0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef", ComOp: idxmngr.ComparisonOps_Eq})
	case "frangwallet": //fileindex-wallet-address
		IndexDatasByFieldM(qe.MngrClient, &idxmngr.SearchRequestM{IndexID: "fileidx_wallet", Field: "IndexableData", Begin: "wallet_hash_0x", End: "wallet_hash_0xzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzz", ComOp: idxmngr.ComparisonOps_Range})

	// 사용자별 Wallet 검색
	case "fexactwallet_alice": // Alice의 지갑 검색
		IndexDatasByFieldM(qe.MngrClient, &idxmngr.SearchRequestM{IndexID: "wallet_user_alice", Field: "IndexableData", Value: "alice_wallet_hash_001", ComOp: idxmngr.ComparisonOps_Eq})
	case "fexactwallet_bob": // Bob의 지갑 검색
		IndexDatasByFieldM(qe.MngrClient, &idxmngr.SearchRequestM{IndexID: "wallet_user_bob", Field: "IndexableData", Value: "bob_wallet_hash_001", ComOp: idxmngr.ComparisonOps_Eq})
	case "fexactwallet_charlie": // Charlie의 지갑 검색
		IndexDatasByFieldM(qe.MngrClient, &idxmngr.SearchRequestM{IndexID: "wallet_user_charlie", Field: "IndexableData", Value: "charlie_wallet_hash_001", ComOp: idxmngr.ComparisonOps_Eq})

	// Organization-specific data search
	case "search_samsung": // Samsung Electronics data search
		SearchOrganizationDataM(qe.MngrClient, "org_samsung", "IndexableData", "삼성전자")
	case "search_lg": // LG Electronics data search
		SearchOrganizationDataM(qe.MngrClient, "org_lg", "IndexableData", "LG전자")

	// Smart Contract Integration
	case "contract_index": // Index real contract transaction
		IndexContractTransaction(qe.MngrClient, "0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef", "삼성전자")
	case "contract_batch_index": // Index multiple contract transactions
		IndexContractTransactions(qe.MngrClient, []string{
			"0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef",
			"0xabcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890",
			"0x567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234",
		}, "삼성전자")
	case "contract_search": // Search indexed contract transactions
		SearchContractTransactions(qe.MngrClient, "org_samsung", "IndexableData", "삼성전자")
	case "js_test": // JavaScript 테스트용 데이터 삽입
		PutJavaScriptTestData(qe.MngrClient, "org_samsung", "test_js_tx_1", "삼성전자")

	case "spkNN":
		IndexDatasByFieldM(qe.MngrClient, &idxmngr.SearchRequestM{IndexID: "spatialidx", Field: "StartvectorLongitude", X: 123, Y: 33, K: 8, ComOp: idxmngr.ComparisonOps_Knn})
	case "spRange":
		IndexDatasByFieldM(qe.MngrClient, &idxmngr.SearchRequestM{IndexID: "spatialidx", Field: "StartvectorLongitude", X: 126.2, Y: 33.2, Range: 0.08, ComOp: idxmngr.ComparisonOps_Range})

	//HELP
	case "help":
		log.Println("cmd example : -cmd=create, insert, exact, range")
		log.Println("Organization Indexing:")
		log.Println("  fcreateorg, finsertorg, fexactorg, frangorg")
		log.Println("Universal Organization Indexing:")
		log.Println("  fcreateuniversalorg, finsertuniversalorg, fexactuniversalorg, franguniversalorg")
		log.Println("Organization-Specific Indexing:")
		log.Println("Organization-Specific Data Insertion:")
		log.Println("  insertdata_samsung, insertdata_lg")
		log.Println("Organization-Specific Data Search:")
		log.Println("  search_samsung, search_lg")
		log.Println("Smart Contract Integration:")
		log.Println("  contract_index, contract_batch_index, contract_search")
		log.Println("  contract_real_tx, contract_webhook")
	default:
		log.Println("cmd example : -cmd=create, insert, exact, range")
		log.Println("Organization Indexing:")
		log.Println("  fcreateorg, finsertorg, fexactorg, frangorg")
		log.Println("Universal Organization Indexing:")
		log.Println("  fcreateuniversalorg, finsertuniversalorg, fexactuniversalorg, franguniversalorg")
		log.Println("Organization-Specific Indexing:")
		log.Println("Organization-Specific Data Insertion:")
		log.Println("  insertdata_samsung, insertdata_lg")
		log.Println("Organization-Specific Data Search:")
		log.Println("  search_samsung, search_lg")
		log.Println("Smart Contract Integration:")
		log.Println("  contract_index, contract_batch_index, contract_search")
		log.Println("  contract_real_tx, contract_webhook")
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

// ===== SMART CONTRACT INTEGRATION FUNCTIONS =====

// IndexContractTransaction indexes a single contract transaction
func IndexContractTransaction(client idxmngr.IndexManagerClient, txHash string, orgName string) {
	log.SetPrefix("[IndexContractTransaction] ")
	
	log.Printf("Indexing contract transaction: %s for organization: %s", txHash, orgName)
	
	// Create stream for InsertIndexRequest
	ctx, cancel := context.WithTimeout(context.Background(), time.Minute*5)
	defer cancel()
	
	stream, err := client.InsertIndexRequest(ctx)
	if err != nil {
		log.Printf("Failed to open stream: %v", err)
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
			log.Printf("Successfully indexed contract transaction. Response: %v", response)
		}
	}()
	
	// Create BcDataList with IndexableData
	bcData := &idxmngr.BcDataList{
		TxId:          txHash,
		IndexableData: &idxmngr.IndexableDataM{
			OrganizationName: orgName,
		},
	}
	
	// Create InsertDatatoIdx with BcList
	insertData := idxmngr.InsertDatatoIdx{
		IndexID: "org_samsung",
		BcList:  []*idxmngr.BcDataList{bcData},
	}
	
	// Send data through stream
	if err := stream.Send(&insertData); err != nil {
		log.Printf("Failed to send data: %v", err)
		return
	}
	
	log.Printf("Contract transaction data sent successfully")
}

// IndexContractTransactions indexes multiple contract transactions
func IndexContractTransactions(client idxmngr.IndexManagerClient, txHashes []string, orgName string) {
	log.SetPrefix("[IndexContractTransactions] ")
	
	log.Printf("Indexing %d contract transactions for organization: %s", len(txHashes), orgName)
	
	// Create stream for InsertIndexRequest
	ctx, cancel := context.WithTimeout(context.Background(), time.Minute*5)
	defer cancel()
	
	stream, err := client.InsertIndexRequest(ctx)
	if err != nil {
		log.Printf("Failed to open stream: %v", err)
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
			log.Printf("Successfully indexed %d contract transactions. Response: %v", len(txHashes), response)
		}
	}()
	
	// Send each transaction through stream
	for i, txHash := range txHashes {
		// Create BcDataList with IndexableData
		bcData := &idxmngr.BcDataList{
			TxId:          txHash,
			IndexableData: &idxmngr.IndexableDataM{
				OrganizationName: orgName,
			},
		}
		
		insertData := idxmngr.InsertDatatoIdx{
			IndexID: "org_samsung",
			BcList:  []*idxmngr.BcDataList{bcData},
		}
		
		if err := stream.Send(&insertData); err != nil {
			log.Printf("Failed to send transaction %d: %v", i+1, err)
			continue
		}
		
		if i%100 == 0 {
			log.Printf("Sent transaction %d/%d", i+1, len(txHashes))
		}
	}
	
	log.Printf("All contract transaction data sent successfully")
}

// SearchContractTransactions searches for indexed contract transactions
func SearchContractTransactions(client idxmngr.IndexManagerClient, indexID string, field string, value string) {
	log.SetPrefix("[SearchContractTransactions] ")
	
	log.Printf("Searching for contract transactions in index: %s, field: %s, value: %s", indexID, field, value)
	
	// Create search request
	searchRequest := &idxmngr.SearchRequestM{
		IndexID: indexID,
		Field:   field,
		Value:   value,
		ComOp:   idxmngr.ComparisonOps_Eq,
	}
	
	// Search for transactions
	results := IndexDatasByFieldM(client, searchRequest)
	
	if results == nil {
		log.Println("No contract transactions found")
		return
	}
	
	log.Printf("Found %d contract transactions:", len(results))
	for i, result := range results {
		log.Printf("  [%d] TxId: %s", i+1, result.TxId)
	}
}

// JavaScript 테스트용 데이터 삽입 함수
func PutJavaScriptTestData(client idxmngr.IndexManagerClient, idxID string, txId string, orgName string) {
	start := time.Now()
	log.Printf("JavaScript 테스트 데이터 삽입 시작...")

	// JavaScript와 동일한 데이터 구조 생성
	bcData := &idxmngr.BcDataList{
		TxId: txId,
		IndexableData: &idxmngr.IndexableDataM{
			OrganizationName: orgName,
		},
	}

	insertData := &idxmngr.InsertDatatoIdx{
		IndexID: idxID,
		BcList:  []*idxmngr.BcDataList{bcData},
		ColName: "IndexableData",
		FilePath: "fileindex-go/samsung.bf",
	}

	log.Printf("삽입할 데이터 구조: %+v", insertData)

	ctx, cancel := context.WithTimeout(context.Background(), time.Minute*5)
	defer cancel()

	stream, err := client.InsertIndexRequest(ctx)
	if err != nil {
		log.Fatalf("Failed to open stream: %v", err)
	}

	defer func() {
		if err := stream.CloseSend(); err != nil {
			log.Printf("Failed to close stream: %v", err)
		}
		response, err := stream.CloseAndRecv()
		if err != nil {
			if errors.Is(err, io.EOF) {
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

	if err := stream.Send(insertData); err != nil {
		log.Fatalf("Failed to send data: %v", err)
	}

	log.Printf("JavaScript 테스트 데이터 삽입 완료. 소요시간: %v", time.Since(start))
}

// 범용 데이터 삽입 함수 (Public Block Chain 데이터)
func PutPublicBC(client idxmngr.IndexManagerClient, idxID string, idxCol string) *idxmngr.IdxMngrResponse {
	start := time.Now()
	log.Printf("Public BC 데이터 삽입 시작...")

	// 더미 데이터 생성 (JavaScript의 BcList 구조와 유사)
	dummyDataList := generatePublicBCDummyData()

	log.Printf("생성된 Public BC 더미 데이터: %d개", len(dummyDataList))

	// BcDataList로 변환 (JavaScript 구조와 동일)
	var bcDataList []*idxmngr.BcDataList
	for idx, data := range dummyDataList {
		bcData := &idxmngr.BcDataList{
			TxId:          fmt.Sprintf("tx_%d", idx),
			KeyCol:        idxCol,
			IndexableData: data,  // IndexableDataM 구조체
		}
		bcDataList = append(bcDataList, bcData)
	}

	insertData := &idxmngr.InsertDatatoIdx{
		IndexID: idxID,
		BcList:  bcDataList,
		ColName: idxCol,
		FilePath: fmt.Sprintf("fileindex-go/%s.bf", strings.ToLower(idxID)),
	}

	ctx, cancel := context.WithTimeout(context.Background(), time.Minute*5)
	defer cancel()

	stream, err := client.InsertIndexRequest(ctx)
	if err != nil {
		log.Fatalf("Failed to open stream: %v", err)
	}

	defer func() {
		if err := stream.CloseSend(); err != nil {
			log.Printf("Failed to close stream: %v", err)
		}
		response, err := stream.CloseAndRecv()
		if err != nil {
			if errors.Is(err, io.EOF) {
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

	if err := stream.Send(insertData); err != nil {
		log.Fatalf("Failed to send data: %v", err)
	}

	log.Printf("Public BC 데이터 삽입 완료. 총 %d개 데이터, 소요시간: %v", len(dummyDataList), time.Since(start))
	
	return &idxmngr.IdxMngrResponse{
		ResponseCode:    200,
		ResponseMessage: "Public BC Data Inserted Successfully",
		Duration:        int64(time.Since(start)),
		IndexID:         idxID,
	}
}

// Public BC 더미 데이터 생성 함수
func generatePublicBCDummyData() []*idxmngr.IndexableDataM {
	var dataList []*idxmngr.IndexableDataM
	
	// JavaScript와 유사한 더미 데이터 생성
	for i := 0; i < 5; i++ {
		data := &idxmngr.IndexableDataM{
			OrganizationName: fmt.Sprintf("Org_%d", i+1),
		}
		dataList = append(dataList, data)
	}
	
	return dataList
}
