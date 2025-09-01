package chaincode

import (
	"bytes"
	"encoding/json"
	"fmt"
	"reflect"
	"strconv"
	"strings"

	"github.com/diegoholiveira/jsonlogic/v3"
	"github.com/hyperledger/fabric-contract-api-go/contractapi"
)

// SmartContract provides functions for managing an Pvd
type SmartContract struct {
	contractapi.Contract
}

type PVD_HIST struct {
	Obu_id                string `json:"OBU_ID"`
	Collection_dt         string `json:"COLLECTION_DT"`
	Startvector_latitude  string `json:"STARTVECTOR_LATITUDE"`
	Startvector_longitude string `json:"STARTVECTOR_LONGITUDE"`
	Transmisstion         string `json:"TRANSMISSTION"`
	Speed                 int    `json:"SPEED"`
	Hazard_lights         string `json:"HAZARD_LIGHTS"`
	Left_turn_signal_on   string `json:"LEFT_TURN_SIGNAL_ON"`
	Right_turn_signal_on  string `json:"RIGHT_TURN_SIGNAL_ON"`
	Steering              int    `json:"STEERING"`
	Rpm                   int    `json:"RPM"`
	Footbrake             string `json:"FOOTBRAKE"`
	Gear                  string `json:"GEAR"`
	Accelator             int    `json:"ACCELATOR"`
	Wipers                string `json:"WIPERS"`
	Tire_warn_left_f      string `json:"TIRE_WARN_LEFT_F"`
	Tire_warn_left_r      string `json:"TIRE_WARN_LEFT_R"`
	Tire_warn_right_f     string `json:"TIRE_WARN_RIGHT_F"`
	Tire_warn_right_r     string `json:"TIRE_WARN_RIGHT_R"`
	Tire_psi_left_f       int    `json:"TIRE_PSI_LEFT_F"`
	Tire_psi_left_r       int    `json:"TIRE_PSI_LEFT_R"`
	Tire_psi_right_f      int    `json:"TIRE_PSI_RIGHT_F"`
	Tire_psi_right_r      int    `json:"TIRE_PSI_RIGHT_R"`
	Fuel_percent          int    `json:"FUEL_PERCENT"`
	Fuel_liter            int    `json:"FUEL_LITER"`
	Totaldist             int    `json:"TOTALDIST"`
	Rsu_id                string `json:"RSU_ID"`
	Msg_id                string `json:"MSG_ID"`
	Startvector_heading   int    `json:"STARTVECTOR_HEADING"`
}

type BC_DATA struct {
	TxId     string
	Pvd      PVD_HIST
	BookMark string
}

type BC_FIELD struct {
	Key   string
	TxId  string
	Value interface{}
}

// InitLedger adds a base set of pvds to the ledger
func (s *SmartContract) InitLedger(ctx contractapi.TransactionContextInterface) error {
	pvds := []PVD_HIST{
		{Obu_id: "OBU-461001c1", Collection_dt: "20211001001000198", Startvector_latitude: "33.496063", Startvector_longitude: "126.491677", Transmisstion: "-", Speed: 0, Hazard_lights: "OFF", Left_turn_signal_on: "OFF", Right_turn_signal_on: "OFF", Steering: 0, Rpm: 0, Footbrake: "-", Gear: "0", Accelator: 0, Wipers: "작동", Tire_warn_left_f: "-", Tire_warn_left_r: "-", Tire_warn_right_f: "-", Tire_warn_right_r: "-", Tire_psi_left_f: 0, Tire_psi_left_r: 0, Tire_psi_right_f: 0, Tire_psi_right_r: 0, Fuel_percent: 0, Fuel_liter: 0, Totaldist: 0, Rsu_id: "", Msg_id: "PVD-461001c4-20210930150956947", Startvector_heading: 2463},
		{Obu_id: "OBU-461001c2", Collection_dt: "20211001001000198", Startvector_latitude: "33.496063", Startvector_longitude: "126.491677", Transmisstion: "-", Speed: 0, Hazard_lights: "OFF", Left_turn_signal_on: "OFF", Right_turn_signal_on: "OFF", Steering: 0, Rpm: 0, Footbrake: "-", Gear: "0", Accelator: 0, Wipers: "작동", Tire_warn_left_f: "-", Tire_warn_left_r: "-", Tire_warn_right_f: "-", Tire_warn_right_r: "-", Tire_psi_left_f: 0, Tire_psi_left_r: 0, Tire_psi_right_f: 0, Tire_psi_right_r: 0, Fuel_percent: 0, Fuel_liter: 0, Totaldist: 0, Rsu_id: "", Msg_id: "PVD-461001c4-20210930150956947", Startvector_heading: 2463},
		{Obu_id: "OBU-461001c3", Collection_dt: "20211001001000198", Startvector_latitude: "33.496063", Startvector_longitude: "126.491677", Transmisstion: "-", Speed: 0, Hazard_lights: "OFF", Left_turn_signal_on: "OFF", Right_turn_signal_on: "OFF", Steering: 0, Rpm: 0, Footbrake: "-", Gear: "0", Accelator: 0, Wipers: "작동", Tire_warn_left_f: "-", Tire_warn_left_r: "-", Tire_warn_right_f: "-", Tire_warn_right_r: "-", Tire_psi_left_f: 0, Tire_psi_left_r: 0, Tire_psi_right_f: 0, Tire_psi_right_r: 0, Fuel_percent: 0, Fuel_liter: 0, Totaldist: 0, Rsu_id: "", Msg_id: "PVD-461001c4-20210930150956947", Startvector_heading: 2463},
		{Obu_id: "OBU-461001c4", Collection_dt: "20211001001000198", Startvector_latitude: "33.496063", Startvector_longitude: "126.491677", Transmisstion: "-", Speed: 0, Hazard_lights: "OFF", Left_turn_signal_on: "OFF", Right_turn_signal_on: "OFF", Steering: 0, Rpm: 0, Footbrake: "-", Gear: "0", Accelator: 0, Wipers: "작동", Tire_warn_left_f: "-", Tire_warn_left_r: "-", Tire_warn_right_f: "-", Tire_warn_right_r: "-", Tire_psi_left_f: 0, Tire_psi_left_r: 0, Tire_psi_right_f: 0, Tire_psi_right_r: 0, Fuel_percent: 0, Fuel_liter: 0, Totaldist: 0, Rsu_id: "", Msg_id: "PVD-461001c4-20210930150956947", Startvector_heading: 2463},
	}

	for _, pvd := range pvds {
		fmt.Printf("InitPVDRecord = %+v \n", pvd)
		pvdJSON, err := json.Marshal(pvd)
		if err != nil {
			return err
		}

		err = ctx.GetStub().PutState(pvd.Obu_id, pvdJSON)
		if err != nil {
			return fmt.Errorf("failed to put to world state. %v", err)
		}
	}

	return nil
}

// CreatePvd issues a new pvd to the world state with given details.
func (s *SmartContract) CreatePVD(ctx contractapi.TransactionContextInterface, sValue string) (string, error) {
	pvd := PVD_HIST{}
	err := json.Unmarshal([]byte(sValue), &pvd)
	if err != nil {
		return "", err
	}
	fmt.Printf("CreatePVD = %+v \n", pvd)
	exists, err := s.PvdExists(ctx, pvd.Obu_id)
	if err != nil {
		return "", err
	}
	if exists {
		return "", fmt.Errorf("the pvd %s already exists", pvd.Obu_id)
	}

	pvd_bytes, err := json.Marshal(pvd)
	if err != nil {
		return "", err
	}

	fmt.Printf("CreatePVD before TxID= %s \n", ctx.GetStub().GetTxID())
	err = ctx.GetStub().PutState(pvd.Obu_id, pvd_bytes)
	if err != nil {
		return "", err
	}
	txid := ctx.GetStub().GetTxID()

	return txid, nil
}

// CreatePvd issues a new pvd to the world state with given details.
func (s *SmartContract) CreateUpdatePVD(ctx contractapi.TransactionContextInterface, sValue string) (string, error) {
	pvd := PVD_HIST{}
	err := json.Unmarshal([]byte(sValue), &pvd)
	if err != nil {
		return "", err
	}

	pvd_bytes, err := json.Marshal(pvd)
	if err != nil {
		return "", err
	}

	fmt.Printf("CreateUpdatePVD ID= %s \n", pvd.Obu_id)
	err = ctx.GetStub().PutState(pvd.Obu_id, pvd_bytes)
	txid := ctx.GetStub().GetTxID()
	fmt.Printf("CreateUpdatePVD after TxID = %s \n", ctx.GetStub().GetTxID())
	return txid, err
}

// ReadPvd returns the pvd stored in the world state with given id.
func (s *SmartContract) ReadPVD(ctx contractapi.TransactionContextInterface, id string) (*PVD_HIST, error) {
	pvd_data, err := ctx.GetStub().GetState(id)
	if err != nil {
		return nil, fmt.Errorf("failed to read from world state: %v", err)
	}
	if pvd_data == nil {
		return nil, fmt.Errorf("the pvd %s does not exist", id)
	}

	var pvd PVD_HIST
	err = json.Unmarshal(pvd_data, &pvd)
	if err != nil {
		return nil, err
	}

	fmt.Printf("Read TxId = %s \n", ctx.GetStub().GetTxID())
	fmt.Printf("ReadPVD = %+v \n", pvd)

	return &pvd, nil
}

func ToChaincodeArgs(args ...string) [][]byte {
	bargs := make([][]byte, len(args))
	for i, arg := range args {
		bargs[i] = []byte(arg)
	}
	return bargs
}

// UpdatePvd updates an existing pvd in the world state with provided parameters.
func (s *SmartContract) UpdatePvd(ctx contractapi.TransactionContextInterface, pvd *PVD_HIST) error {
	exists, err := s.PvdExists(ctx, pvd.Obu_id)
	if err != nil {
		return err
	}
	if !exists {
		return fmt.Errorf("the pvd %s does not exist", pvd.Obu_id)
	}

	pvdData, err := json.Marshal(pvd)
	if err != nil {
		return err
	}

	return ctx.GetStub().PutState(pvd.Obu_id, pvdData)
}

// DeletePvd deletes an given pvd from the world state.
func (s *SmartContract) DeletePvd(ctx contractapi.TransactionContextInterface, id string) error {
	exists, err := s.PvdExists(ctx, id)
	if err != nil {
		return err
	}
	if !exists {
		return fmt.Errorf("the pvd %s does not exist", id)
	}

	return ctx.GetStub().DelState(id)
}

// PvdExists returns true when pvd with given ID exists in world state
func (s *SmartContract) PvdExists(ctx contractapi.TransactionContextInterface, id string) (bool, error) {
	pvdJSON, err := ctx.GetStub().GetState(id)
	if err != nil {
		return false, fmt.Errorf("failed to read from world state: %v", err)
	}

	return pvdJSON != nil, nil
}

// GetPvdWorldStates returns pvd world states found in world state
func (s *SmartContract) GetPvdWorldStates(ctx contractapi.TransactionContextInterface) ([]*PVD_HIST, error) {
	// range query with empty string for startKey and endKey does an
	// open-ended query of all pvds in the chaincode namespace.
	resultsIterator, err := ctx.GetStub().GetStateByRange("", "")
	if err != nil {
		return nil, err
	}
	defer resultsIterator.Close()

	var pvds []*PVD_HIST
	for resultsIterator.HasNext() {
		queryResponse, err := resultsIterator.Next()
		if err != nil {
			return nil, err
		}

		var pvd PVD_HIST
		err = json.Unmarshal(queryResponse.Value, &pvd)
		if err != nil {
			return nil, err
		}
		fmt.Println(pvd)
		pvds = append(pvds, &pvd)
	}

	return pvds, nil
}

// GetPvdRichQuery returns pvd world states rich query in world state
func (s *SmartContract) GetPvdRichQuery(ctx contractapi.TransactionContextInterface, filter string) ([]*PVD_HIST, error) {
	// range query with empty string for startKey and endKey does an
	// open-ended query of all pvds in the chaincode namespace.
	fmt.Println("filter=", filter)
	resultsIterator, err := ctx.GetStub().GetStateByRange("", "")
	if err != nil {
		return nil, err
	}
	defer resultsIterator.Close()

	type wsDatas struct {
		Wstates []PVD_HIST `json:"wstates"`
	}
	var pvdWs wsDatas

	for resultsIterator.HasNext() {
		queryResponse, err := resultsIterator.Next()
		if err != nil {
			return nil, err
		}

		pvd := PVD_HIST{}
		err = json.Unmarshal(queryResponse.Value, &pvd)
		if err != nil {
			return nil, err
		}
		fmt.Println(pvd)
		pvdWs.Wstates = append(pvdWs.Wstates, pvd)
	}

	pvdWsJson, _ := json.Marshal(pvdWs)

	pvdWsData := strings.NewReader(string(pvdWsJson))

	logic := strings.NewReader(filter)

	var result bytes.Buffer

	//fmt.Println(string(pvdWsJson))

	err2 := jsonlogic.Apply(logic, pvdWsData, &result)
	if err2 != nil {
		return nil, err2
	}

	fmt.Println("result: ", result.String())

	var resultPvds []*PVD_HIST
	decoder := json.NewDecoder(&result)
	decoder.Decode(&resultPvds)
	return resultPvds, nil
}

func (s *SmartContract) GetPvdRichQueryHistory(ctx contractapi.TransactionContextInterface, key string, filter string) ([]*PVD_HIST, error) {
	// range query with empty string for startKey and endKey does an
	// open-ended query of all pvds in the chaincode namespace.
	fmt.Println("filter=", filter)
	resultsIterator, err := ctx.GetStub().GetHistoryForKey(key)
	if err != nil {
		return nil, err
	}
	defer resultsIterator.Close()

	type hDatas struct {
		History []PVD_HIST `json:"history"`
	}
	var keyHist hDatas

	for resultsIterator.HasNext() {
		queryResponse, err := resultsIterator.Next()
		if err != nil {
			return nil, err
		}

		pvd := PVD_HIST{}
		err = json.Unmarshal(queryResponse.Value, &pvd)
		if err != nil {
			return nil, err
		}
		fmt.Println(pvd)
		keyHist.History = append(keyHist.History, pvd)
	}

	historyJson, _ := json.Marshal(keyHist)

	historyData := strings.NewReader(string(historyJson))

	logic := strings.NewReader(filter)

	var result bytes.Buffer

	//fmt.Println(string(pvdWsJson))

	err2 := jsonlogic.Apply(logic, historyData, &result)
	if err2 != nil {
		return nil, err2
	}

	fmt.Println("result: ", result.String())

	var resultPvds []*PVD_HIST
	decoder := json.NewDecoder(&result)
	decoder.Decode(&resultPvds)
	return resultPvds, nil
}

// GetAllPvdKeys returns pvd world states found in world state
func (s *SmartContract) GetKeyLists(ctx contractapi.TransactionContextInterface) ([]*BC_FIELD, error) {
	// range query with empty string for startKey and endKey does an
	// open-ended query of all pvds in the chaincode namespace.
	resultsIterator, err := ctx.GetStub().GetStateByRange("", "")
	if err != nil {
		return nil, err
	}
	defer resultsIterator.Close()

	var keyLists []*BC_FIELD
	for resultsIterator.HasNext() {
		queryResponse, err := resultsIterator.Next()
		if err != nil {
			return nil, err
		}

		bcField := BC_FIELD{Key: queryResponse.Key}
		keyLists = append(keyLists, &bcField)
	}

	return keyLists, nil
}

// GetAllPvdKeys returns all pvd keys found in world state
func (s *SmartContract) GetAllPvdDatas(ctx contractapi.TransactionContextInterface) ([]*BC_DATA, error) {
	// range query with empty string for startKey and endKey does an
	// open-ended query of all pvds in the chaincode namespace.
	resultsIterator, err := ctx.GetStub().GetStateByRange("", "")
	if err != nil {
		return nil, err
	}
	defer resultsIterator.Close()

	var bcDatas []*BC_DATA
	for resultsIterator.HasNext() {
		queryResponse, err := resultsIterator.Next()
		if err != nil {
			return nil, err
		}

		hIterator, err := ctx.GetStub().GetHistoryForKey(queryResponse.Key)
		if err != nil {
			return nil, err
		}
		defer hIterator.Close()

		for hIterator.HasNext() {
			hResponse, err := hIterator.Next()
			if err != nil {
				return nil, err
			}
			var pvd PVD_HIST
			err = json.Unmarshal(hResponse.Value, &pvd)
			if err != nil {
				return nil, err
			}
			bcData := BC_DATA{TxId: hResponse.TxId, Pvd: pvd}
			bcDatas = append(bcDatas, &bcData)
		}
	}

	return bcDatas, nil
}

func (s *SmartContract) queryAllPvdsWithPagination(ctx contractapi.TransactionContextInterface, args []string) ([]*BC_DATA, error) {

	//PageSize int32, Bookmark String
	var err error
	tempInt, err := strconv.Atoi(args[1])
	PageSize := int32(tempInt)
	Bookmark := args[2]

	startKey := ""
	endKey := ""

	var bcDatas []*BC_DATA
	resultsIterator, meta, err := ctx.GetStub().GetStateByRangeWithPagination(startKey, endKey, PageSize, Bookmark)
	if err != nil {
		return nil, err
	}
	defer resultsIterator.Close()

	bmark := meta.GetBookmark()

	for resultsIterator.HasNext() {
		queryResponse, err := resultsIterator.Next()
		if err != nil {
			return nil, err
		}
		hIterator, err := ctx.GetStub().GetHistoryForKey(queryResponse.Key)
		if err != nil {
			return nil, err
		}
		defer hIterator.Close()

		for hIterator.HasNext() {
			hResponse, err := hIterator.Next()
			if err != nil {
				return nil, err
			}
			var pvd PVD_HIST
			err = json.Unmarshal(hResponse.Value, &pvd)
			if err != nil {
				return nil, err
			}
			bcData := BC_DATA{TxId: hResponse.TxId, Pvd: pvd, BookMark: bmark}
			bcDatas = append(bcDatas, &bcData)
		}
	}

	//fmt.Printf("- queryAllPvdsWithPagination Bookmark :\n%s\n", Bookmark)

	return bcDatas, nil

}

// GetAllPvdFieldDatas returns matching field pvds in world state
func (s *SmartContract) GetAllPvdFieldDatas(ctx contractapi.TransactionContextInterface, field string) ([]*BC_FIELD, error) {
	// range query with empty string for startKey and endKey does an
	// open-ended query of all pvds in the chaincode namespace.
	resultsIterator, err := ctx.GetStub().GetStateByRange("", "")
	if err != nil {
		return nil, err
	}
	defer resultsIterator.Close()

	var bcFields []*BC_FIELD

	isFirst := true
	fIndex := 0

	for resultsIterator.HasNext() {
		queryResponse, err := resultsIterator.Next()
		if err != nil {
			return nil, err
		}

		hIterator, err := ctx.GetStub().GetHistoryForKey(queryResponse.Key)
		if err != nil {
			return nil, err
		}
		defer hIterator.Close()

		for hIterator.HasNext() {
			hResponse, err := hIterator.Next()
			if err != nil {
				return nil, err
			}
			var pvd PVD_HIST
			err = json.Unmarshal(hResponse.Value, &pvd)
			if err != nil {
				return nil, err
			}

			v := reflect.ValueOf(pvd)
			if isFirst {
				type_of_fields := v.Type()
				for j := 0; j < v.NumField(); j++ {
					if type_of_fields.Field(j).Name == field {
						isFirst = false
						fIndex = j
					}
				}
			}

			bcField := BC_FIELD{Key: queryResponse.Key, TxId: hResponse.TxId, Value: v.Field(fIndex).Interface()}
			bcFields = append(bcFields, &bcField)
		}
	}
	return bcFields, nil
}

// GetHistroyForKey returns all pvds found in world state
func (s *SmartContract) GetHistroyForKey(ctx contractapi.TransactionContextInterface, key string) ([]*BC_DATA, error) {
	// range query with empty string for startKey and endKey does an
	// open-ended query of all pvds in the chaincode namespace.
	resultsIterator, err := ctx.GetStub().GetHistoryForKey(key)
	if err != nil {
		return nil, err
	}
	defer resultsIterator.Close()

	var bcDatas []*BC_DATA
	for resultsIterator.HasNext() {
		queryResponse, err := resultsIterator.Next()
		if err != nil {
			return nil, err
		}

		var pvd PVD_HIST
		err = json.Unmarshal(queryResponse.Value, &pvd)
		if err != nil {
			return nil, err
		}
		fmt.Printf("GetHistroyForKey TxID= %s \n", queryResponse.TxId)
		fmt.Printf("GetHistroyForKey = %+v \n", pvd)
		bcData := BC_DATA{TxId: queryResponse.TxId, Pvd: pvd}
		bcDatas = append(bcDatas, &bcData)
	}

	fmt.Printf("GetHistroyForKey Result count = %d \n", len(bcDatas))
	return bcDatas, nil
}

func (s *SmartContract) GetDataByTxID(ctx contractapi.TransactionContextInterface, key string, txid string) (*PVD_HIST, error) {
	// range query with empty string for startKey and endKey does an
	// open-ended query of all pvds in the chaincode namespace.
	resultsIterator, err := ctx.GetStub().GetHistoryForKey(key)
	if err != nil {
		return nil, err
	}
	defer resultsIterator.Close()

	var pvd PVD_HIST
	for resultsIterator.HasNext() {
		queryResponse, err := resultsIterator.Next()
		if err != nil {
			return nil, err
		}

		if queryResponse.TxId == txid {
			err = json.Unmarshal(queryResponse.Value, &pvd)
			if err != nil {
				return nil, err
			}
			fmt.Printf("GetHistroyForKey TxID= %s \n", queryResponse.TxId)
			fmt.Printf("GetHistroyForKey = %+v \n", pvd)
			return &pvd, nil
		}
	}

	return nil, nil
}

func (s *SmartContract) GetDataByKeyTxID(ctx contractapi.TransactionContextInterface, key string, txids []string) ([]*BC_DATA, error) {
	// range query with empty string for startKey and endKey does an
	// open-ended query of all pvds in the chaincode namespace.
	resultsIterator, err := ctx.GetStub().GetHistoryForKey(key)
	if err != nil {
		return nil, err
	}
	defer resultsIterator.Close()

	var pvd PVD_HIST
	hMap := make(map[string]PVD_HIST, 0)

	for resultsIterator.HasNext() {
		queryResponse, err := resultsIterator.Next()
		if err != nil {
			return nil, err
		}
		err = json.Unmarshal(queryResponse.Value, &pvd)
		if err != nil {
			return nil, err
		}
		hMap[queryResponse.TxId] = pvd
	}

	var bcDatas []*BC_DATA

	for _, txid := range txids {
		if _, found := hMap[txid]; found {
			bcData := BC_DATA{TxId: txid, Pvd: hMap[txid]}
			bcDatas = append(bcDatas, &bcData)
		}
	}

	return bcDatas, nil
}

func (s *SmartContract) GetByTxID(ctx contractapi.TransactionContextInterface, txid string) (*PVD_HIST, error) {
	//InvokeChaincode(chaincodeName string, args [][]byte, channel string) pb.Response

	fmt.Printf("GetByTxID function for TxID= %s \n", txid)
	var args = [][]byte{}
	args = append(args, []byte("GetTransactionByID")) // fname
	args = append(args, []byte("pvdchannel"))         // chain id
	args = append(args, []byte(txid))                 // id

	result := ctx.GetStub().InvokeChaincode("qscc", args, "")
	fmt.Printf("GetTransactionByID = %+v \n", result)
	var pvd PVD_HIST
	err := json.Unmarshal(result.Payload, &pvd)
	if err != nil {
		return nil, err
	}
	fmt.Printf("GetTransactionByID = %+v \n", pvd)
	return &pvd, nil

}

func (s *SmartContract) GetByBlockID(ctx contractapi.TransactionContextInterface, id uint64) (*PVD_HIST, error) {
	//InvokeChaincode(chaincodeName string, args [][]byte, channel string) pb.Response

	fmt.Printf("GetByBlockID function for Block ID= %d \n", id)
	var args = [][]byte{}
	args = append(args, []byte("GetBlockByNumber"))         // fname
	args = append(args, []byte("pvdchannel"))               // chain id
	args = append(args, []byte(strconv.FormatUint(id, 10))) // id

	result := ctx.GetStub().InvokeChaincode("qscc", args, "")
	fmt.Printf("GetBlockByNumber = %+v \n", result)
	return nil, nil

}
