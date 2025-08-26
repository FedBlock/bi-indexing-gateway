package manager

import (
	"context"
	"encoding/json"
	"flag"
	"fmt"
	"io"
	"log"
	"os"
	"reflect"
	"strconv"
	"sync"
	"time"

	"github.com/gocarina/gocsv"
	"google.golang.org/grpc"
	"google.golang.org/grpc/credentials/insecure"

	pvd "grpc-go/pvdapi/grpc-go/pvdapi"
)

var (
	serverAddr = flag.String("addr", "localhost:19001", "The server address in the format of host:port")
	//multi_size = flag.Int("multi_size", 1000, "multi data upload size")
)

type GrpcController struct {
	Conn      *grpc.ClientConn
	Client    pvd.PvdClient
	ChainInfo pvd.ChainInfo
}

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
}

func (c *GrpcController) Begin() {
	flag.Parse()
	var opts []grpc.DialOption
	opts = append(opts, grpc.WithTransportCredentials(insecure.NewCredentials()))

	var err error
	c.Conn, err = grpc.Dial(*serverAddr, opts...)
	if err != nil {
		log.Println(err)
	}
	//defer c.Conn.Close()

	c.Client = pvd.NewPvdClient(c.Conn)
	c.ChainInfo = pvd.ChainInfo{ChannelName: "pvdchannel", Chaincode: "pvd"}

}

func CreateData(client pvd.PvdClient, request *pvd.SinglePvd) *pvd.PvdResponse {
	log.Printf("CreateData ID : %s", request.GetPvd().GetObuId())
	data, err := client.PutData(context.Background(), request)
	if err != nil {
		log.Println(err)
	}

	return data
}

func GetWorldState(client pvd.PvdClient, request *pvd.ChainInfo) *pvd.MultiData {
	log.Printf("getWorldState =  %s", request.GetChaincode())
	start := time.Now()

	data, err := client.GetWorldState(context.Background(), request)
	if err != nil {
		log.Println(err)
		return &pvd.MultiData{
			Response: &pvd.PvdResponse{
				ResponseCode:    500,
				ResponseMessage: err.Error(),
				Duration:        int64(time.Since(start)),
			},
		}
	}

	var bcList []*pvd.BcData
	for _, multipvd := range data.GetPvdList() {
		bcData := &pvd.BcData{
			Pvd:      multipvd,
			Response: data.Response,
		}
		bcList = append(bcList, bcData)
	}

	return &pvd.MultiData{
		BcList: bcList,
		Response: &pvd.PvdResponse{
			ResponseCode: 200,
			Duration:     int64(time.Since(start)),
		},
	}
}

func QueryData(client pvd.PvdClient, request *pvd.SinglePvd) *pvd.MultiData {
	log.Printf("Getting Data for key %s", request.GetPvd().GetObuId())
	start := time.Now()

	data, err := client.GetData(context.Background(), request)
	if err != nil {
		log.Println(err)
		return &pvd.MultiData{
			Response: &pvd.PvdResponse{
				ResponseCode:    500,
				ResponseMessage: err.Error(),
				Duration:        int64(time.Since(start)),
			},
		}
	}

	bcData := &pvd.BcData{
		TxId:     data.TxId,
		Pvd:      data.Pvd,
		Response: data.Response,
	}

	var bcList []*pvd.BcData
	bcList = append(bcList, bcData)

	return &pvd.MultiData{
		BcList: bcList,
		Response: &pvd.PvdResponse{
			ResponseCode: 200,
			Duration:     int64(time.Since(start)),
		},
	}
}

func QueryHistoryData(client pvd.PvdClient, request *pvd.SinglePvd) *pvd.MultiData {
	log.Printf("Looking for features within %s", request.GetPvd().GetObuId())
	start := time.Now()

	data, err := client.GetHistoryData(context.Background(), request)
	if err != nil {
		log.Println(err)
		return &pvd.MultiData{
			Response: &pvd.PvdResponse{
				ResponseCode:    500,
				ResponseMessage: err.Error(),
				Duration:        int64(time.Since(start)),
			},
		}
	}

	return data
}

func QueryDatasByField(client pvd.PvdClient, request *pvd.FieldInfo) *pvd.MultiData {
	log.Printf("queryDatasByField =  %s", request.String())
	start := time.Now()

	stream, err := client.GetDataByField(context.Background(), request)
	if err != nil {
		log.Println(err)
		return &pvd.MultiData{
			Response: &pvd.PvdResponse{
				ResponseCode:    500,
				ResponseMessage: err.Error(),
				Duration:        int64(time.Since(start)),
			},
		}
	}

	var bcList []*pvd.BcData
	for {
		data, err := stream.Recv()
		if err == io.EOF {
			break
		}
		if err != nil {
			log.Println(err)
			bcList = make([]*pvd.BcData, 0)
			continue
		}

		bcList = append(bcList, data)
	}

	return &pvd.MultiData{
		BcList: bcList,
		Response: &pvd.PvdResponse{
			ResponseCode: 200,
			Duration:     int64(time.Since(start)),
		},
	}
}

func QueryAllDatasByTime(client pvd.PvdClient, request *pvd.TimeInfo) []*pvd.MultiData {
	log.Printf("queryAllDatasByTime =  %s", request.String())

	stream, err := client.GetAllDataByTime(context.Background(), request)
	if err != nil {
		log.Println(err)
	}

	var resultList []*pvd.MultiData
	total := 0
	for {
		data, err := stream.Recv()
		if err != nil {
			log.Println(err)
			if err == io.EOF {
				break
			}

			resultList = make([]*pvd.MultiData, 0)
			continue
		}

		result := data.GetBcList()
		total += len(result)

		resultList = append(resultList, data)
	}

	log.Println("Total Tx Count =  ", total)

	return resultList
}

func QueryAllBlock(client pvd.PvdClient, request *pvd.ChainInfo) []*pvd.MultiData {
	log.Println("Looking for All Blocks")
	stream, err := client.GetAllBlock(context.Background(), request)
	if err != nil {
		log.Println(err)
		return nil
	}

	var resultList []*pvd.MultiData
	total := 0
	for {
		data, err := stream.Recv()
		if err != nil {
			log.Println(err)
			if err == io.EOF {
				break
			}

			resultList = make([]*pvd.MultiData, 0)
			continue
		}

		result := data.GetBcList()
		total += len(result)

		resultList = append(resultList, data)
	}

	log.Println("Total Tx Count =  ", total)

	return resultList
}

func GetFieldToData(multiData *pvd.MultiData, request *pvd.FieldInfo) []*pvd.BcData {
	var bcList []*pvd.BcData
	for _, bcData := range multiData.GetBcList() {
		hist := bcData.GetPvd()
		jsbody, err := json.Marshal(hist)
		if err != nil {
			log.Println(err)
		}

		var unm map[string]interface{}
		json.Unmarshal(jsbody, &unm)

		// init block data = 6 except
		if unm["Obu_id"] != nil && unm[request.Field] == nil {
			if request.Field == "Speed" || request.Field == "Steering" || request.Field == "Rpm" || request.Field == "Accelator" || request.Field == "Tire_psi_left_f" || request.Field == "Tire_psi_left_r" || request.Field == "Tire_psi_right_f" || request.Field == "Tire_psi_right_r" || request.Field == "Fuel_percent" || request.Field == "Fuel_liter" || request.Field == "Totaldist" || request.Field == "Startvector_heading" {
				unm[request.Field] = 0
			}
		}

		if unm[request.Field] != nil {
			if reflect.TypeOf(unm[request.Field]).Kind() == reflect.String { // string
				if fmt.Sprint(unm[request.Field]) == request.Value {
					bcList = append(bcList, bcData)
				}
			} else {
				left, err := strconv.ParseFloat(fmt.Sprint(unm[request.Field]), 64) // float64
				if err != nil {
					log.Println(err)
				}
				right, err := strconv.ParseFloat(request.Value, 64)
				if err != nil {
					log.Println(err)
				}

				if request.ComOp == pvd.ComparisonOperators_Equal {
					if left == right {
						bcList = append(bcList, bcData)
					}
				} else if request.ComOp == pvd.ComparisonOperators_NotEqual {
					if left != right {
						bcList = append(bcList, bcData)
					}
				} else if request.ComOp == pvd.ComparisonOperators_LessThan {
					if left < right {
						bcList = append(bcList, bcData)
					}
				} else if request.ComOp == pvd.ComparisonOperators_LessThanEqual {
					if left <= right {
						bcList = append(bcList, bcData)
					}
				} else if request.ComOp == pvd.ComparisonOperators_GreaterThan {
					if left > right {
						bcList = append(bcList, bcData)
					}
				} else if request.ComOp == pvd.ComparisonOperators_GreaterThanEqual {
					if left >= right {
						bcList = append(bcList, bcData)
					}
				}
			}
		}
	}

	return bcList
}

func GetFieldToBlock(multiList []*pvd.MultiData, request *pvd.FieldInfo) []*pvd.BcData {
	log.Printf("GetFieldToBlock =  %s", request.String())

	var bcList []*pvd.BcData
	for _, multi := range multiList {
		bcList = append(bcList, GetFieldToData(multi, request)...)
	}

	return bcList
}

func GetCsvList(client pvd.PvdClient, request *pvd.ChainInfo, filePath string) []*pvd.MultiData {
	log.Printf("putMultiData =  %s, multi_size size= %d", request.GetChaincode(), *multi_size)

	var resultList []*pvd.MultiData
	csvFile, err := os.OpenFile(filePath, os.O_RDONLY, os.ModePerm)
	if err != nil {
		log.Println("failed to open csv data file")
		errData := &pvd.MultiData{
			Response: &pvd.PvdResponse{
				ResponseCode:    500,
				ResponseMessage: "failed to open csv data file",
			},
		}
		resultList = append(resultList, errData)
		return resultList
	}
	defer csvFile.Close()

	pvdList := []*PVD_CSV{}

	if err := gocsv.UnmarshalFile(csvFile, &pvdList); err != nil { // Load clients from file
		log.Println("failed to gocsv.UnmarshalFile")
		errData := &pvd.MultiData{
			Response: &pvd.PvdResponse{
				ResponseCode:    500,
				ResponseMessage: "failed to gocsv.UnmarshalFile",
			},
		}
		resultList = append(resultList, errData)
		return resultList
	}

	var lists []*pvd.BcData

	for _, rec := range pvdList {
		Value, _ := json.Marshal(rec)
		data := pvd.PvdHist{}
		json.Unmarshal(Value, &data)
		txdata := pvd.BcData{
			Pvd: &data,
		}
		lists = append(lists, &txdata)
	}

	list_size := len(lists)
	next := 0

	for idx := 0; idx < list_size; {
		next = idx + *multi_size // default multi_size = 1000
		if next > list_size {
			next = list_size
		}
		multi := pvd.MultiData{
			BcList: lists[idx:next],
		}
		resultList = append(resultList, &multi)
		log.Println("start ", idx, "end ", next)
		idx = next
	}

	return resultList
}

func PutMultiData(client pvd.PvdClient, multiDatas []*pvd.MultiData) []*pvd.MultiData {
	var resultList []*pvd.MultiData

	stream, err := client.PutMultiData(context.Background())
	if err != nil {
		log.Println(err)
		errData := &pvd.MultiData{
			Response: &pvd.PvdResponse{
				ResponseCode:    500,
				ResponseMessage: err.Error(),
			},
		}
		resultList = append(resultList, errData)
		return resultList
	}

	recv_idx := 0
	waitc := make(chan struct{})
	var mutex = &sync.Mutex{}

	go func() {
		for {
			recvDatas, err := stream.Recv()
			if err != nil {
				log.Println(err)
				close(waitc)
				return
			}
			resultList = append(resultList, recvDatas)
			recv_idx++

			mutex.Unlock()
		}
	}()

	for idx, datas := range multiDatas {
		mutex.Lock()
		if err := stream.Send(datas); err != nil {
			log.Println("Failed to send a datas: ", err)
		}
		log.Println("Send Datas Index:  ", idx)
	}
	stream.CloseSend()
	<-waitc

	return resultList
}

func QueryDatasByTxid(client pvd.PvdClient, request *pvd.TxList) *pvd.MultiData {
	log.Printf("queryDatasByTxid  Start")
	start := time.Now()

	resultData := &pvd.MultiData{
		Response: &pvd.PvdResponse{
			ResponseCode: 200,
		},
	}

	stream, err := client.GetDataByTxID(context.Background(), request)
	if err != nil {
		log.Println(err)
		resultData.Response = &pvd.PvdResponse{
			ResponseCode:    500,
			ResponseMessage: err.Error(),
			Duration:        int64(time.Since(start)),
		}
		return resultData
	}

	var bcList []*pvd.BcData
	for {
		txdata, err := stream.Recv()
		if err == io.EOF {
			break
		}
		if err != nil {
			log.Println(err)
			resultData.Response = &pvd.PvdResponse{
				ResponseCode:    500,
				ResponseMessage: err.Error(),
				Duration:        int64(time.Since(start)),
			}
			break
		}

		if txdata.ResponseCode == 200 {
			bcData := &pvd.BcData{
				TxId:     txdata.TxId,
				Pvd:      txdata.Pvd,
				Response: txdata.Response,
			}
			bcList = append(bcList, bcData)
		} else {
			resultData.Response = &pvd.PvdResponse{
				ResponseCode:    500,
				ResponseMessage: err.Error(),
				Duration:        int64(time.Since(start)),
			}
			break
		}
	}

	if resultData.Response.ResponseCode == 200 {
		resultData.BcList = bcList
		resultData.Response.Duration = int64(time.Since(start))
	}

	return resultData
}
