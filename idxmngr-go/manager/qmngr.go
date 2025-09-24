// Package idxmngr-go
package manager

type IndexInfo struct {
	IdxID        string `yaml:"idxid"`
	IdxName      string `yaml:"idxname"`
	KeyCol       string `yaml:"keycol"`
	FilePath     string `yaml:"filepath"`
	BlockNum     int32  `yaml:"blocknum"`
	FromBlock    int64  `yaml:"fromblock"`
	KeySize      int32  `yaml:"keysize"`
	Address      string `yaml:"address"`
	CallCnt      int32  `yaml:"callcnt"`
	KeyCnt       int32  `yaml:"keycnt"`
	IndexDataCnt int32  `yaml:"indexdatacnt"`
	// QCnt			[]*QueryCallHist
}

type QueryInfo struct {
	QueryType string
	RstSize   int32
	RunTime   int64
	//RstDataMin		string
	//RstDataMax		string
	//RstDataMean		string
}

type query int

const (
	Ops_Eq query = iota + 1
	Ops_NotEq
	Ops_Less
	Ops_LessThanEq
	Ops_Greater
	Ops_GreaterThanEq
	Ops_BetweenR
)

//func1. IndexInfo (Index List, 인덱스별 정보) 출력
//Index ID 넣으면 해당 인덱스만, 아니면 전체 출력, KeyDuplicationRate

//func2. QueryInfo (Query History) 출력
//func QueryRstStatus : 질의 별 데이터 크기, 수행횟수,
//

//func3. QueryRstStats (Query Result Data Statistics) 출력
//QueryInfo의 평균 값
//RstSize, ProcessingTime
//
