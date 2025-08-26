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
	"context"
	"flag"
	"fmt"
	"log"
	"os"
	"strconv"
	"time"

	"github.com/gocarina/gocsv"
	"google.golang.org/grpc"
	"google.golang.org/grpc/credentials/insecure"

	fsindex "fileindex-go/idxserver_api"
)

var (
	cmd           = flag.String("cmd", "help", "Inline test command")
	IdxServerAddr = flag.String("addr", "localhost:50053", "The server address in the format of host:port")
	multi_size    = flag.Int("multi_size", 1000, "multi data upload size")
)

type IndexData struct {
	Obu_id string `json:"OBU_ID"`
	TxID   string `json:"TxID"`
}

func CreateIndexRequest(client fsindex.HLFDataIndexClient, idx *fsindex.CreateRequest) {

	log.Printf("CreateIndex =  %s", idx.String())

	rst, err := client.CreateIndex(context.Background(), idx)
	if err != nil {
		log.Fatalf("%v.ListFeatures(_) = _, %v", client, err)
	}

	log.Println("created index info = ", rst.IndexID)
}

func queryDatasByField(client fsindex.HLFDataIndexClient, request *fsindex.SearchRequest) {

	log.Printf("[fileindex] queryDatasByField =  %s", request.String())

	Data, err := client.GetindexDataByField(context.Background(), request)
	if err != nil {
		log.Fatalf("%v.ListFeatures(_) = _, %v", client, err)
	}

	for _, txdata := range Data.GetIdxData() {
		log.Println("data found", txdata)
	}

	log.Println(" Count = ", len(Data.IdxData))
}

func putMultiDataS(client fsindex.HLFDataIndexClient, indata *fsindex.InsertData) {

	csvFile, err := os.OpenFile("pvd_hist_20k.csv", os.O_RDONLY, os.ModePerm)
	if err != nil {
		log.Println("failed to open csv data file")
		log.Fatalf("Failed to open CSV file: %v", err) // 작업 종료
	}
	defer csvFile.Close()

	pvdList := []*PVD_CSV{}
	if err := gocsv.UnmarshalFile(csvFile, &pvdList); err != nil { // Load clients from file
		fmt.Println("failed to gocsv.UnmarshalFile")
		log.Fatalf("Failed to parse CSV file: %v", err) // 작업 종료
	}

	t := time.Now()
	fmt.Printf("[%s]UploadPVDRecord, List Size = %d\n", t.Format(time.RFC3339), len(pvdList))

	//var multiDatas []*fsindex.InsertData //batch data
	var lists []*fsindex.BcDataInfo //row data

	for idx, rec := range pvdList {
		txdata := fsindex.BcDataInfo{
			TxId: strconv.Itoa(idx),
			Pvd: &fsindex.PvdHistData{
				ObuId:        rec.Obu_id,
				CollectionDt: rec.Collection_dt,
				Speed:        int32(rec.Speed),
			},
		}
		lists = append(lists, &txdata)
	}
	start := time.Now()

	stream, err := client.InsertIndex(context.Background())
	if err != nil {
		log.Fatalf("InsertIndex stream failed: %v", err)
	}
	defer func() {
		if _, err := stream.CloseAndRecv(); err != nil {
			log.Fatalf("Failed to close stream: %v", err)
		}
	}()

	for idx := 0; idx < len(lists); {
		next := idx + *multi_size
		if next > len(lists) {
			next = len(lists)
		}

		multi := fsindex.InsertData{
			ColIndex: indata.ColIndex,
			BcList:   lists[idx:next],
			ColName:  indata.ColName,
		}

		if err := stream.Send(&multi); err != nil {
			log.Fatalf("Failed to send batch: %v", err)
		}
		log.Printf("Batch %d sent successfully", idx)
		idx = next
	}
	log.Println("Data upload complete")
	log.Println("Execution Time = ", time.Since(start))

	// var multiDatas []*fsindex.InsertData //batch data
	// var lists []*fsindex.BcDataInfo      //row data

	// for idx, rec := range pvdList {
	// 	Value, _ := json.Marshal(rec)
	// 	data := fsindex.PvdHistData{}
	// 	json.Unmarshal(Value, &data)

	// 	txdata := fsindex.BcDataInfo{
	// 		TxId: strconv.Itoa(idx),
	// 		Pvd:  &data,
	// 	}
	// 	lists = append(lists, &txdata)
	// }

	// list_size := len(lists)
	// next := 0

	// stream, err := client.InsertIndex(context.Background())
	// if err != nil {
	// 	log.Fatalf("Failed to establish gRPC stream: %v", err)
	// }
	// defer func() {
	// 	if _, err := stream.CloseAndRecv(); err != nil {
	// 		log.Fatalf("Failed to close stream: %v", err)
	// 	}
	// }()

	// for idx := 0; idx < list_size; {
	// 	next = idx + *multi_size // default multi_size = 1000
	// 	if next > list_size {
	// 		next = list_size
	// 	}
	// 	multi := fsindex.InsertData{
	// 		ColIndex: indata.ColIndex,
	// 		BcList:   lists[idx:next],
	// 		ColName:  indata.ColName,
	// 	}
	// 	multiDatas = append(multiDatas, &multi)
	// 	log.Println("start ", idx, "end ", next)
	// 	idx = next
	// }

	// msize := len(multiDatas)
	// log.Println("Raw Data Parsing Time = ", time.Since(t), "multi_size: ", msize)

	//start := time.Now()

	// // stream, err := client.InsertIndex(context.Background())
	// // if err != nil {
	// // 	log.Fatalf("%v.ListFeatures(_) = _, %v", client, err)
	// // }

	// for idx, datas := range multiDatas {
	// 	if err := stream.Send(datas); err != nil {
	// 		log.Fatalf("(Index Server) Failed to send a datas: %v", err)
	// 	}
	// 	log.Println("Send Datas Index:  ", idx)
	// }
	// //don't remove this part (data receive)
	// // Msg, err := stream.CloseAndRecv()
	// // if err != nil {
	// // 	log.Fatalf("%v.CloseAndRecv() got error %v, want %v", stream, err, nil)
	// // }
}

func main() {
	flag.Parse()
	opts := []grpc.DialOption{grpc.WithTransportCredentials(insecure.NewCredentials())}
	conn, err := grpc.Dial(*IdxServerAddr, opts...)
	if err != nil {
		log.Fatalf("fail to dial: %v", err)
	}
	defer conn.Close()

	client := fsindex.NewHLFDataIndexClient(conn)

	log.SetFlags(log.Ldate | log.Ltime | log.Lmicroseconds)
	log.Println("cmd: ", *cmd)
	log.Println("=================================================")

	switch *cmd {
	//create to Speed index
	case "create-s":
		log.Println("CREATE INDEX")
		CreateIndexRequest(client, &fsindex.CreateRequest{IndexID: "001", IndexName: "File_SpeedIndex", KeyCol: "Speed", FilePath: "speed_file.bf", KeySize: 5})
	//create to Collection_dt index
	case "create-d":
		log.Println("CREATE INDEX")
		CreateIndexRequest(client, &fsindex.CreateRequest{IndexID: "002", IndexName: "File_DTIndex", KeyCol: "CollectionDt", FilePath: "dt_file.bf", KeySize: 17})
	//insert data to Speed index
	case "insert-s":
		putMultiDataS(client, &fsindex.InsertData{ColIndex: "001", ColName: "Speed"})
	//insert data to Collection_dt index
	case "insert-d":
		putMultiDataS(client, &fsindex.InsertData{ColIndex: "002", ColName: "CollectionDt"})
	//exact match query on Speed //질의처리 시 결과로 나오는 txID가 중복이 있을 수 있음. Pvd에 요청할 때 중복 제거하고 요청 확인
	case "exact-s":
		queryDatasByField(client, &fsindex.SearchRequest{FilePath: "speed_file_8.bf", KeySize: 8, Field: "Speed", Value: "100", ComOp: fsindex.ComparisonOps_Eq})
	//exact match query on Collection_dt
	case "exact-d":
		queryDatasByField(client, &fsindex.SearchRequest{FilePath: "dt_file.bf", KeySize: 17, Field: "CollectionDt", Value: "20190612160320000", ComOp: fsindex.ComparisonOps_Eq})
	case "exact-a":
		queryDatasByField(client, &fsindex.SearchRequest{FilePath: "address_file_16.bf", KeySize: 16, Field: "Address", Value: "명륜동", ComOp: fsindex.ComparisonOps_Eq})
	//range query on Speed
	case "range-s":
		queryDatasByField(client, &fsindex.SearchRequest{Field: "Speed", Begin: "0", End: "999", ComOp: fsindex.ComparisonOps_Range})
	//range query on Collection_dt
	case "range-d":
		queryDatasByField(client, &fsindex.SearchRequest{Field: "CollectionDt", Begin: "20211001053430718", End: "20211001055430718", ComOp: fsindex.ComparisonOps_Range})
	default:
		log.Println("wrong option")
	}
	log.Println("=================================================")
}

type PVD_CSV struct {
	Obu_id                string `csv:"OBU_ID" json:"obu_id"`
	Collection_dt         string `csv:"COLLECTION_DT" json:"collection_dt"`
	Startvector_latitude  string `csv:"STARTVECTOR_LATITUDE" json:"startvector_latitude"`
	Startvector_longitude string `csv:"STARTVECTOR_LONGITUDE" json:"startvector_longitude"`
	Transmisstion         string `csv:"TRANSMISSTION" json:"transmission"`
	Speed                 int    `csv:"SPEED" json:"speed"`
	Hazard_lights         string `csv:"HAZARD_LIGHTS" json:"hazard_lights"`
	Left_turn_signal_on   string `csv:"LEFT_TURN_SIGNAL_ON" json:"left_turn_signal_on"`
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
	K                     int    `csv:"K"`
	RANGE                 int    `csv:"RANGE"`
}
