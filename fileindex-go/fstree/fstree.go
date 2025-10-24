// Package bcbptree bcbptree/bcbptree.go
// package fstreeidx
package idxserver

import (
	"context"
	"fmt"
	"io"
	"log"
	"os"
	"path/filepath"
	"runtime"
	"strconv"
	"strings"
	"time"

	"gopkg.in/yaml.v2"

	fsindex "fileindex-go/idxserver_api"

	"github.com/timtadh/fs2/bptree"
	"github.com/timtadh/fs2/fmap"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
)

// Config 구조체 정의
type Config struct {
	Items []struct {
		IdxID       string `yaml:"idxid"`
		IdxName     string `yaml:"idxname"`
		IndexingKey string `yaml:"indexingkey"`
		KeyCol      string `yaml:"keycol"`
		FilePath    string `yaml:"filepath"`
		Network     string `yaml:"network"`
		BlockNum    int32  `yaml:"blocknum"`
		FromBlock   int64  `yaml:"fromblock"`
		KeySize     int32  `yaml:"keysize"`
		Address     string `yaml:"address"`
		CallCnt     int32  `yaml:"callcnt"`
		KeyCnt      int32  `yaml:"keycnt"`
		IndexDataCnt int32 `yaml:"indexdatacnt"`
	} `yaml:"items"`
}

// config.yaml에서 indexingkey 값을 읽어오는 함수
func getIndexingKeyFromConfig(indexID string) string {
	// config.yaml 파일 경로
	configPath := "/home/blockchain/fedblock/bi-index/idxmngr-go/config.yaml"
	
	// 파일 읽기
	data, err := os.ReadFile(configPath)
	if err != nil {
		log.Printf("❌ config.yaml 읽기 실패: %v, 기본값 'purpose' 사용", err)
		return "purpose"
	}
	
	// YAML 파싱
	var config Config
	err = yaml.Unmarshal(data, &config)
	if err != nil {
		log.Printf("❌ config.yaml 파싱 실패: %v, 기본값 'purpose' 사용", err)
		return "purpose"
	}
	
	// 해당 IndexID의 indexingkey 찾기
	for _, item := range config.Items {
		if item.IdxID == indexID {
			log.Printf("✅ config.yaml에서 indexingkey 찾음: %s -> %s", indexID, item.IndexingKey)
			return item.IndexingKey
		}
	}
	
	log.Printf("⚠️ IndexID %s에 해당하는 indexingkey를 찾을 수 없음, 기본값 'purpose' 사용", indexID)
	return "purpose"
}

// config.yaml에서 IndexableData 트리의 키를 찾는 함수 (네트워크 + 인덱스명으로 매핑)
func getIndexableDataTreeKey(indexID string) string {
	// config.yaml 파일 경로
	configPath := "/home/blockchain/fedblock/bi-index/idxmngr-go/config.yaml"
	
	// 파일 읽기
	data, err := os.ReadFile(configPath)
	if err != nil {
		log.Printf("❌ config.yaml 읽기 실패: %v, 기본값 'purpose' 사용", err)
		return "purpose"
	}
	
	// YAML 파싱
	var config Config
	err = yaml.Unmarshal(data, &config)
	if err != nil {
		log.Printf("❌ config.yaml 파싱 실패: %v, 기본값 'purpose' 사용", err)
		return "purpose"
	}
	
	// 해당 IndexID의 인덱스명 찾기
	log.Printf("🔍 config.yaml에서 IndexID %s 찾는 중...", indexID)
	log.Printf("🔍 config.yaml Items 개수: %d", len(config.Items))
	for i, item := range config.Items {
		log.Printf("🔍 Items[%d]: IdxID='%s', IdxName='%s'", i, item.IdxID, item.IdxName)
		if item.IdxID == indexID {
			// 인덱스명만 사용 (네트워크는 별도 관리)
			treeKey := item.IdxName
			log.Printf("✅ IndexableData 트리 키 생성: %s -> %s (인덱스명: %s)", indexID, treeKey, item.IdxName)
			return treeKey
		}
	}
	
	log.Printf("⚠️ IndexID %s에 해당하는 정보를 찾을 수 없음, 기본값 'purpose' 사용", indexID)
	return "purpose"
}

type IndexServer struct {
	fsindex.UnimplementedHLFDataIndexServer
}

// file index tree
var DtTree *bptree.BpTree
var SpeedTree *bptree.BpTree
var AddrTree *bptree.BpTree
var OrgTree *bptree.BpTree  // 추가
var UserTree *bptree.BpTree  // 사용자 ID용 트리 추가
var IndexableDataTrees map[string]*bptree.BpTree  // 인덱스별로 독립적인 트리
var idxTree *bptree.BpTree

func init() {
	IndexableDataTrees = make(map[string]*bptree.BpTree)
	
	// 서버 시작 시 기존 인덱스 자동 로드
	go LoadExistingIndexes()
}

// LoadExistingIndexes 서버 시작 시 기존 인덱스 파일들을 자동으로 로드
func LoadExistingIndexes() {
	log.SetPrefix("[LoadExistingIndexes] ")
	
	// 잠시 대기 (서버가 완전히 시작될 때까지)
	time.Sleep(2 * time.Second)
	
	log.Println("기존 인덱스 파일들을 자동으로 로드 시작...")
	
	// config.yaml 파일 읽기
	configPath := "../idxmngr-go/config.yaml"
	if _, err := os.Stat(configPath); os.IsNotExist(err) {
		log.Printf("config.yaml 파일을 찾을 수 없습니다: %s", configPath)
		return
	}
	
	// YAML 파일 읽기 (간단한 파싱)
	data, err := os.ReadFile(configPath)
	if err != nil {
		log.Printf("config.yaml 파일을 읽을 수 없습니다: %v", err)
		return
	}
	
	lines := strings.Split(string(data), "\n")
	var currentIndexID, currentIndexName, currentKeyCol, currentFilePath string
	var currentKeySize int
	
	for _, line := range lines {
		line = strings.TrimSpace(line)
		
		if strings.HasPrefix(line, "- idxid:") {
			currentIndexID = strings.TrimSpace(strings.TrimPrefix(line, "- idxid:"))
		} else if strings.HasPrefix(line, "idxname:") {
			currentIndexName = strings.TrimSpace(strings.TrimPrefix(line, "idxname:"))
		} else if strings.HasPrefix(line, "keycol:") {
			currentKeyCol = strings.TrimSpace(strings.TrimPrefix(line, "keycol:"))
		} else if strings.HasPrefix(line, "filepath:") {
			currentFilePath = strings.TrimSpace(strings.TrimPrefix(line, "filepath:"))
		} else if strings.HasPrefix(line, "keysize:") {
			keySizeStr := strings.TrimSpace(strings.TrimPrefix(line, "keysize:"))
			if keySize, err := strconv.Atoi(keySizeStr); err == nil {
				currentKeySize = keySize
			}
		}
		
		// 하나의 인덱스 정보가 완성되면 로드
		if currentIndexID != "" && currentKeyCol != "" && currentFilePath != "" && currentKeySize > 0 {
			if currentKeyCol == "IndexableData" {
				// IndexableData 트리 로드 - IndexName 필수
				if currentIndexName == "" {
					log.Printf("❌ IndexableData 트리 로드 실패: IndexName이 비어있음 (IndexID: %s)", currentIndexID)
				} else {
					var tree *bptree.BpTree
					if err := openOrCreateIndex(currentFilePath, currentKeySize, &tree); err == nil {
						// IndexableData 트리는 인덱스명으로만 키를 저장
						treeKey := currentIndexName
						log.Printf("🔍 트리 저장 - IndexID: '%s', IndexName: '%s', treeKey: '%s'", currentIndexID, currentIndexName, treeKey)
						IndexableDataTrees[treeKey] = tree
						log.Printf("✅ IndexableData 트리 자동 로드 완료: %s -> %s (인덱스명으로 저장)", treeKey, currentFilePath)
					} else {
						log.Printf("❌ IndexableData 트리 자동 로드 실패: %s -> %v", currentIndexName, err)
					}
				}
			}
			
			// 다음 인덱스를 위해 초기화
			currentIndexID = ""
			currentIndexName = ""
			currentKeyCol = ""
			currentFilePath = ""
			currentKeySize = 0
		}
	}
	
	log.Printf("기존 인덱스 자동 로드 완료: %d개 IndexableData 트리 로드됨", len(IndexableDataTrees))
}

func funcName() string {
	pc, _, _, _ := runtime.Caller(1)
	nameFull := runtime.FuncForPC(pc).Name() // main.foo
	nameEnd := filepath.Ext(nameFull)        // .foo
	name := strings.TrimPrefix(nameEnd, ".") // foo
	return name
}

func stringToFixedBytes(s string, size int) []byte {
	b := []byte(s)
	result := make([]byte, size)

	copy(result, b) // copy up to size bytes
	return result
}

func openOrCreateIndex(filePath string, keySize int, tree **bptree.BpTree) error {

	//log.SetPrefix("[" + funcName() + "] ")
	//log.Println("start")
	//log.Println(filePath)

	if _, err := os.Stat(filePath); os.IsNotExist(err) {
		bf, err := fmap.CreateBlockFile(filePath)
		if err != nil {
			log.Println("failed to create block file")
			return fmt.Errorf("failed to create block file: %v", err)
		}
		*tree, err = bptree.New(bf, keySize, -1)
		if err != nil {
			log.Println("failed to create tree")
			return fmt.Errorf("failed to create tree: %v", err)
		}
	} else {
		bf, err := fmap.OpenBlockFile(filePath)
		if err != nil {
			log.Println("failed to open block file")
			return fmt.Errorf("failed to open block file: %v", err)
		}
		*tree, err = bptree.Open(bf)
		if err != nil {
			log.Println("failed to open tree")
			return fmt.Errorf("failed to open tree: %v", err)
		}
	}
	//log.Println("OpenOrCreate OK")
	return nil
}

func (h IndexServer) CreateIndex(ctx context.Context, idxinfo *fsindex.CreateRequest) (*fsindex.IdxResponse, error) {

	log.SetPrefix("[" + funcName() + "] ")
	log.Println("start")
	log.Printf("[CreateIndex] IndexID=%s, KeyCol=%s", idxinfo.IndexID, idxinfo.KeyCol)

	//keySize, _ := strconv.Atoi(idxinfo.KeySize)
	keySize := int(idxinfo.KeySize)
	if keySize <= 0 {
		log.Printf("Invalid key size: %d", keySize)
		return nil, status.Errorf(codes.InvalidArgument, "Invalid key size : %d ", keySize)
	}

	log.Printf("keySize: %d", keySize)
	var err error

	switch idxinfo.KeyCol {
	case "Address":
		err = openOrCreateIndex(idxinfo.FilePath, keySize, &AddrTree)

	case "CollectionDt":
		err = openOrCreateIndex(idxinfo.FilePath, keySize, &DtTree)

	case "Speed":
		err = openOrCreateIndex(idxinfo.FilePath, keySize, &SpeedTree)

	case "OrganizationName":
		err = openOrCreateIndex(idxinfo.FilePath, keySize, &OrgTree)

	case "UserId":  // 사용자 ID용 인덱스
		// 동적으로 인덱스별 트리 생성 (IndexableData와 동일한 방식)
		var tree *bptree.BpTree
		err = openOrCreateIndex(idxinfo.FilePath, keySize, &tree)
		if err == nil {
			IndexableDataTrees[idxinfo.IndexID] = tree
			log.Printf("UserId 트리 생성 완료: %s -> %s", idxinfo.IndexID, idxinfo.FilePath)
		}

	case "IndexableData":  // 범용 데이터용 인덱스
		// 동적으로 인덱스별 트리 생성
		var tree *bptree.BpTree
		err = openOrCreateIndex(idxinfo.FilePath, keySize, &tree)
		if err == nil {
			IndexableDataTrees[idxinfo.IndexID] = tree
			log.Printf("IndexableData 트리 생성 완료: %s -> %s", idxinfo.IndexID, idxinfo.FilePath)
		}

	case "PublicIndex":  // Public 블록체인용 인덱스 (EVM 계열)
		// 양방향 인덱싱은 별도 인덱스 생성 없이 기존 인덱스들을 활용
		// 실제 인덱스 생성은 create-user-specific-indexes.js에서 처리
		log.Printf("양방향 인덱싱 인덱스 생성: %s", idxinfo.IndexID)
		log.Printf("참고: 조직별과 사용자별 인덱스는 별도로 생성해야 합니다")

	default:
		log.Printf("Unsupported key column: %s", idxinfo.KeyCol)
		return nil, status.Errorf(codes.InvalidArgument, "Unsupported key column: %s", idxinfo.KeyCol)
	}
	if err != nil {
		return nil, status.Errorf(codes.Internal, "Failed to create index: %v", err)
	}
	log.Printf("Index created successfully: %s", idxinfo.IndexID)
	return &fsindex.IdxResponse{
		ResponseCode: 200,
		IndexID:      idxinfo.IndexID,
		IndexCol:     idxinfo.KeyCol,
	}, nil
}

func (h IndexServer) InsertIndex(stream fsindex.HLFDataIndex_InsertIndexServer) error {
	log.SetPrefix("[" + funcName() + "] ")
	//start := time.Now()

	//log.Println("start")

	isFirst := true
	keySize := 0

	recv_idx := 0
	for {
		recvDatas, err := stream.Recv()
		if err == io.EOF {
			//log.Printf("[InsertIndex] All data received. Total: %d, Time: %s", recv_idx, time.Since(start))
			return stream.SendAndClose(&fsindex.IdxResponse{ResponseMessage: "All data received"})
		}
		if err != nil {
			log.Printf("Stream error: %v", err)
			return status.Errorf(codes.Internal, "Stream error: %v", err)
		}

		if isFirst {
			//log.Println(recvDatas.BcList[0])
			keySize = int(recvDatas.GetKeySize())
			//log.Println("KeySize: ", keySize)
			if keySize <= 0 {
				log.Printf("Invalid key size: %d", keySize)
				return status.Errorf(codes.InvalidArgument, "Invalid key size: %d", keySize)
			}
			isFirst = false
		}

		idxCol := recvDatas.GetColName()
		txlist := recvDatas.GetBcList()

		//log.Printf("idxCol = %s", idxCol)

		if len(txlist) == 0 {
			log.Printf("Received empty batch at index: %d", recv_idx)
			continue
		}
		// 왜 메시지가 마지막에 한 번 더 뜰까?
		//log.Printf("File index recv [%d] data, size : %d", recv_idx, len(txlist))

		for idx, rec := range txlist {
			var key []byte
			var targetTree **bptree.BpTree
			
			switch idxCol {
			case "Address":
				if AddrTree == nil {
					err := openOrCreateIndex(recvDatas.GetFilePath(), keySize, &AddrTree)
					if err != nil {
						log.Println("openOrCreateIndex Error for Address")
						return err
					}
				}
				targetTree = &AddrTree
				words := strings.Fields(rec.Pvd.Address)
				if len(words) >= 3 {
					key = stringToFixedBytes(words[2], keySize)
				} else {
					key = stringToFixedBytes(words[0], keySize)
				}
				//log.Println("Address Key: ", key)
			case "CollectionDt":
				if DtTree == nil {
					err := openOrCreateIndex(recvDatas.GetFilePath(), keySize, &DtTree)
					if err != nil {
						log.Println("openOrCreateIndex Error for CollectionDt")
						return err
					}
				}
				targetTree = &DtTree
				key = stringToFixedBytes(rec.Pvd.CollectionDt, keySize)
			case "Speed":
				if SpeedTree == nil {
					err := openOrCreateIndex(recvDatas.GetFilePath(), keySize, &SpeedTree)
					if err != nil {
						log.Println("openOrCreateIndex Error for Speed")
						return err
					}
				}
				targetTree = &SpeedTree
				key = stringToFixedBytes(strconv.Itoa(int(rec.Pvd.Speed)), keySize)
				//log.Println("Speed Key: ", key)
			case "OrganizationName":
				if OrgTree == nil {
					err := openOrCreateIndex(recvDatas.GetFilePath(), keySize, &OrgTree)
					if err != nil {
						log.Println("openOrCreateIndex Error for OrganizationName")
						return err
					}
				}
				targetTree = &OrgTree
				key = stringToFixedBytes(rec.Pvd.OrganizationName, keySize)
			case "UserId":  // 사용자 ID용 인덱싱
				// 동적으로 해당 인덱스의 트리 사용 (IndexableData와 동일한 방식)
				indexID := recvDatas.GetColIndex()
				log.Printf("UserId 인덱싱 - IndexID: %s, IndexableDataTrees 크기: %d", indexID, len(IndexableDataTrees))
				// IndexableDataTrees의 키들을 로그로 출력
				keys := make([]string, 0, len(IndexableDataTrees))
				for k := range IndexableDataTrees {
					keys = append(keys, k)
				}
				log.Printf("IndexableDataTrees 키들: %v", keys)
				
				tree, exists := IndexableDataTrees[indexID]
				if !exists {
					log.Printf("UserId 트리를 찾을 수 없음: %s", indexID)
					continue
				}
				if tree == nil {
					log.Printf("UserId 트리가 nil임: %s", indexID)
					continue
				}
				log.Printf("UserId 트리 찾음: %s", indexID)
				targetTree = &tree
				// IndexableData에서 DynamicFields의 userId 추출
				if rec.IndexableData != nil && rec.IndexableData.DynamicFields != nil {
					if userId, exists := rec.IndexableData.DynamicFields["userId"]; exists {
						key = stringToFixedBytes(userId, keySize)
					} else {
						log.Printf("userId not found in DynamicFields at index: %d", idx)
						continue
					}
				} else {
					log.Printf("IndexableData or DynamicFields is nil at index: %d", idx)
					continue
				}
			case "IndexableData":  // 범용 데이터용 인덱싱
		// IndexID를 indexName으로 직접 사용
		indexName := recvDatas.GetColIndex()
		log.Printf("IndexableData 인덱싱 - IndexName: '%s', IndexableDataTrees 크기: %d", indexName, len(IndexableDataTrees))
		
		// IndexableDataTrees의 키들을 로그로 출력
		keys := make([]string, 0, len(IndexableDataTrees))
		for k := range IndexableDataTrees {
			keys = append(keys, k)
		}
		log.Printf("IndexableDataTrees 키들: %v", keys)
		
		// 각 키의 길이와 내용을 자세히 출력
		for i, key := range keys {
			log.Printf("  키[%d]: '%s' (길이: %d)", i, key, len(key))
		}
		
		tree, exists := IndexableDataTrees[indexName]
		if !exists {
			log.Printf("IndexableData 트리를 찾을 수 없음: %s", indexName)
			continue
		}
		if tree == nil {
			log.Printf("IndexableData 트리가 nil임: %s", indexName)
			continue
		}
		log.Printf("IndexableData 트리 찾음: %s", indexName)
		targetTree = &tree
		// IndexableData에서 DynamicFields의 indexName 필드 값을 사용 (예: "purpose" 필드의 값 "심박수")
		if rec.IndexableData != nil && rec.IndexableData.DynamicFields != nil {
			// indexName을 키로 사용하여 DynamicFields에서 값 추출
			if keyValue, exists := rec.IndexableData.DynamicFields[indexName]; exists {
				key = stringToFixedBytes(keyValue, keySize)
				log.Printf("✅ Using %s field value as key: '%s' for TxId: %s", indexName, keyValue, rec.TxId)
			} else {
				log.Printf("❌ %s field not found in DynamicFields at index: %d, available fields: %v", 
					indexName, idx, rec.IndexableData.DynamicFields)
				continue
			}
		} else {
			log.Printf("IndexableData or DynamicFields is nil at index: %d", idx)
			continue
		}

	case "PublicIndex":  // Public 블록체인 인덱싱 (EVM 계열)
		// 조직 인덱스와 사용자 인덱스에 동시 저장
		if rec.IndexableData != nil && rec.IndexableData.DynamicFields != nil {
			// 1. timestamp 인덱스에 저장 - 동적으로 찾기
			if timestamp, exists := rec.IndexableData.DynamicFields["timestamp"]; exists {
				// timestamp를 키로 사용하여 인덱스에 저장
				for indexID, tree := range IndexableDataTrees {
					if strings.HasPrefix(indexID, "wallet_") && tree != nil {
						timestampKey := stringToFixedBytes(timestamp, keySize)
						if err := tree.Add(timestampKey, []byte(rec.TxId)); err != nil {
							log.Printf("인덱스 저장 실패: %s -> %v", indexID, err)
						} else {
							log.Printf("✅ 인덱스 저장 성공: %s -> %s (key: %s)", indexID, rec.TxId, timestamp)
						}
						break
					}
				}
			}
			
			// 2. 사용자 인덱스에 저장 - 동적으로 찾기
			if userId, exists := rec.IndexableData.DynamicFields["userId"]; exists {
				// 기존에 생성된 사용자 인덱스 찾기
				for indexID, tree := range IndexableDataTrees {
					if strings.Contains(indexID, "user_") && tree != nil {
						// 해당 사용자의 인덱스인지 확인 (간단한 방식)
						if strings.Contains(indexID, userId[:8]) {
							userKey := stringToFixedBytes(userId, keySize)
							if err := tree.Add(userKey, []byte(rec.TxId)); err != nil {
								log.Printf("사용자 인덱스 저장 실패: %s -> %v", indexID, err)
							} else {
								log.Printf("✅ 사용자 인덱스 저장 성공: %s -> %s", userId, rec.TxId)
							}
							break
						}
					}
				}
			}
			
			// 양방향 인덱싱 완료 후 continue
			continue
		} else {
			log.Printf("IndexableData or DynamicFields is nil at index: %d", idx)
			continue
		}
			default:
				log.Printf("Unsupported index column: %s", idxCol)
				continue
			}

			newValue := []byte(rec.TxId)
			
			log.Printf("=== Data Validation at index %d ===", idx)
			log.Printf("TxId: '%s' (length: %d)", rec.TxId, len(rec.TxId))
			log.Printf("Key: %s (length: %d)", string(key), len(key))
			log.Printf("NewValue: '%s' (length: %d)", string(newValue), len(newValue))

			if len(key) == 0 || len(newValue) == 0 {
				log.Printf("❌ Invalid data at index: %d - Key empty: %v, Value empty: %v", 
					idx, len(key) == 0, len(newValue) == 0)
				continue
			}
			
			// targetTree가 nil인지 확인
			if targetTree == nil || *targetTree == nil {
				log.Printf("targetTree is nil at index: %d, idxCol: %s", idx, idxCol)
				continue
			}
			
			if err := (*targetTree).Add(key, newValue); err != nil {
				log.Printf("Failed to add to tree: %v", err)
				return status.Errorf(codes.Internal, "Failed to add data: %v", err)
			} else {
				log.Printf("Successfully added to tree - Key: %s, Value: %s", string(key), string(newValue))
			}
		}

		recv_idx++
	}
}

// getDataByField
func (h IndexServer) GetindexDataByField(ctx context.Context, req *fsindex.SearchRequest) (*fsindex.RstTxList, error) {

	log.SetPrefix("[" + funcName() + "] ")
	log.Println("SearchRequest : ", req)
	keySize := int(req.KeySize)
	//log.Println("keySize : ", keySize)

	switch req.Field {
	case "Address":
		if AddrTree == nil {
			err := openOrCreateIndex(req.FilePath, 0, &AddrTree)
			if err != nil {
				log.Println("failed to open index server")
				return nil, fmt.Errorf("failed to open tree: %v", err)
			}
			log.SetPrefix("[" + funcName() + "] ")
		}

		start := time.Now()
		txlist := []string{}

		if req.ComOp == fsindex.ComparisonOps_Range {
			begin := stringToFixedBytes(req.Begin, keySize)
			end := stringToFixedBytes(req.End, keySize)

			returned_pointers, _ := AddrTree.Range(begin, end)

			if returned_pointers != nil {
				for returned_pointers != nil {
					_, value1, err1, nextPointer := returned_pointers()
					if err1 != nil {
						log.Fatal("Error while fetching data:", err1)
					}
					if nextPointer == nil { // 다음 포인터가 없으면 종료
						log.Println("End of pointer chain")
						break
					}
					txlist = append(txlist, string(value1))
					returned_pointers = nextPointer
				}
			}
		} else if req.ComOp == fsindex.ComparisonOps_Eq {
			key := stringToFixedBytes(req.Value, keySize)
			returned_pointers, _ := AddrTree.Find(key)

			if returned_pointers != nil {
				for returned_pointers != nil {
					_, value1, err1, nextPointer := returned_pointers()
					if err1 != nil {
						log.Fatal("Error while fetching data:", err1)
					}
					if nextPointer == nil { // 다음 포인터가 없으면 종료
						log.Println("End of pointer chain")
						break
					}
					txlist = append(txlist, string(value1))
					returned_pointers = nextPointer
				}
			}
		}

		log.Printf("Address search completed in %v", time.Since(start))
		return &fsindex.RstTxList{
			IndexID: req.IndexID,
			Key:     req.Key,
			IdxData: txlist,
		}, nil

	case "CollectionDt":

		if DtTree == nil {
			err := openOrCreateIndex(req.FilePath, 0, &DtTree)
			if err != nil {
				return nil, fmt.Errorf("failed to open tree: %v", err)
			}
			log.SetPrefix("[" + funcName() + "] ")
		}

		start := time.Now()
		txlist := []string{}

		if req.ComOp == fsindex.ComparisonOps_Range {
			begin := stringToFixedBytes(req.Begin, keySize)
			end := stringToFixedBytes(req.End, keySize)

			returned_pointers, _ := DtTree.Range(begin, end)

			if returned_pointers != nil {
				for returned_pointers != nil {
					_, value1, err1, nextPointer := returned_pointers()
					if err1 != nil {
						log.Fatal("Error while fetching data:", err1)
					}
					if nextPointer == nil { // 다음 포인터가 없으면 종료
						log.Println("End of pointer chain")
						break
					}

					txlist = append(txlist, string(value1))
					returned_pointers = nextPointer
				}
				txlist_size := len(txlist)
				log.Println("TxCount =", txlist_size)
				log.Println("Execution Time = ", time.Since(start))

				idxData := fsindex.RstTxList{
					IdxData: txlist,
					IndexID: req.IndexID,
					Key:     req.Key,
				}
				return &idxData, nil
			} else {
				log.Println("Not Found !!!")
				return nil, nil
			}

		} else if req.ComOp == fsindex.ComparisonOps_Eq {
			//key := []byte(req.Value)
			key := stringToFixedBytes(req.Value, keySize)
			log.Println("Original query key: ", key)

			returned_pointers, _ := DtTree.Find(key)
			if returned_pointers != nil {
				for returned_pointers != nil {
					_, value1, err1, nextPointer := returned_pointers()
					if err1 != nil {
						log.Fatal("Error while fetching data:", err1)
					}
					if nextPointer == nil { // 다음 포인터가 없으면 종료
						log.Println("End of pointer chain")
						break
					}
					txlist = append(txlist, string(value1))
					returned_pointers = nextPointer
				}
				txlist_size := len(txlist)
				log.Println("TxCount =", txlist_size)
				log.Println("Execution Time = ", time.Since(start))

				idxData := fsindex.RstTxList{
					IdxData: txlist,
					IndexID: req.IndexID,
					Key:     req.Key,
				}
				return &idxData, nil
			} else {
				log.Println("Not Found !!!")
				return nil, nil
			}
		} else {
			log.Println("Not Found !!!")
			return nil, nil
		}

	case "Speed":

		if SpeedTree == nil {
			err := openOrCreateIndex(req.FilePath, 0, &SpeedTree)
			if err != nil {
				return nil, fmt.Errorf("failed to open tree: %v", err)
			}
			log.SetPrefix("[" + funcName() + "] ")
		}
		start := time.Now()
		txlist := []string{}

		if req.ComOp == fsindex.ComparisonOps_Range {

			begin := stringToFixedBytes(req.Begin, keySize)
			end := stringToFixedBytes(req.End, keySize)

			log.Println("=== Speed Range Search Debug ===")
			log.Printf("Original range: Begin='%s', End='%s'", req.Begin, req.End)
			log.Printf("Converted bytes: Begin=%v, End=%v", begin, end)
			log.Printf("KeySize: %d", keySize)
			log.Printf("Begin length: %d, End length: %d", len(begin), len(end))

			returned_pointers, err := SpeedTree.Range(begin, end)
			if err != nil {
				log.Printf("SpeedTree.Range error: %v", err)
			}
			log.Printf("SpeedTree.Range returned: %v", returned_pointers)

			if returned_pointers != nil {
				for returned_pointers != nil {
					_, value1, err1, nextPointer := returned_pointers()
					if err1 != nil {
						log.Fatal("Error while fetching data:", err1)
					}
					if nextPointer == nil { // 다음 포인터가 없으면 종료
						log.Println("End of pointer chain")
						break
					}
					txlist = append(txlist, string(value1))
					returned_pointers = nextPointer
				}
				txlist_size := len(txlist)
				log.Println("TxCount =", txlist_size)
				log.Println("Execution Time = ", time.Since(start))

				idxData := fsindex.RstTxList{
					IdxData: txlist,
					IndexID: req.IndexID,
					Key:     req.Key,
				}
				return &idxData, nil
			} else {
				log.Println("Not Found !!!")
				return nil, nil
			}

		} else if req.ComOp == fsindex.ComparisonOps_Eq {
			log.Printf("Original query value: %s", req.Value)
			log.Printf("KeySize: %d", keySize)
			log.Printf("req.Value length: %d", len(req.Value))
			key := stringToFixedBytes(req.Value, keySize)
			log.Println("Original query key: ", key)
			log.Printf("Generated key length: %d", len(key))

			returned_pointers, _ := SpeedTree.Find(key)

			if returned_pointers != nil {
				for returned_pointers != nil {
					_, value1, err1, nextPointer := returned_pointers()
					if err1 != nil {
						log.Fatal("Error while fetching data:", err1)
					}
					if nextPointer == nil { // 다음 포인터가 없으면 종료
						log.Println("End of pointer chain")
						break
					}
					txlist = append(txlist, string(value1))
					returned_pointers = nextPointer
				}
				txlist_size := len(txlist)
				log.Println("TxCount =", txlist_size)
				log.Println("Execution Time = ", time.Since(start))

				idxData := fsindex.RstTxList{
					IdxData: txlist,
					IndexID: req.IndexID,
					Key:     req.Key,
				}
				return &idxData, nil
			} else {
				log.Println("Not Found !!!")
				return nil, nil
			}
		} else {
			log.Println("Not Found !!!")
			return nil, nil
		}
	case "OrganizationName":  // OrganizationName 검색
		if OrgTree == nil {
			err := openOrCreateIndex(req.FilePath, 0, &OrgTree)
			if err != nil {
				log.Println("failed to open index server")
				return nil, fmt.Errorf("failed to open tree: %v", err)
			}
			log.SetPrefix("[" + funcName() + "] ")
		}

		start := time.Now()
		txlist := []string{}

		if req.ComOp == fsindex.ComparisonOps_Range {
			begin := stringToFixedBytes(req.Begin, keySize)
			end := stringToFixedBytes(req.End, keySize)

			log.Println("=== OrganizationName Range Search Debug ===")
			log.Printf("Original range: Begin='%s', End='%s'", req.Begin, req.End)
			log.Printf("Converted bytes: Begin=%v, End=%v", begin, end)
			log.Printf("KeySize: %d", keySize)

			returned_pointers, err := OrgTree.Range(begin, end)
			if err != nil {
				log.Printf("OrgTree.Range error: %v", err)
			}
			log.Printf("OrgTree.Range returned: %v", returned_pointers)

			if returned_pointers != nil {
				for returned_pointers != nil {
					_, value1, err1, nextPointer := returned_pointers()
					if err1 != nil {
						log.Fatal("Error while fetching data:", err1)
					}
					if nextPointer == nil {
						log.Println("End of pointer chain")
						break
					}
					txlist = append(txlist, string(value1))
					returned_pointers = nextPointer
				}
			}
		} else if req.ComOp == fsindex.ComparisonOps_Eq {
			key := stringToFixedBytes(req.Value, keySize)
			returned_pointers, _ := OrgTree.Find(key)

			if returned_pointers != nil {
				for returned_pointers != nil {
					_, value1, err1, nextPointer := returned_pointers()
					if err1 != nil {
						log.Fatal("Error while fetching data:", err1)
					}
					if nextPointer == nil {
						log.Println("End of pointer chain")
						break
					}
					txlist = append(txlist, string(value1))
					returned_pointers = nextPointer
				}
			}
		}

		log.Printf("OrganizationName search completed in %v", time.Since(start))
		return &fsindex.RstTxList{
			IndexID: req.IndexID,
			Key:     req.Key,
			IdxData: txlist,
		}, nil

	case "UserId":  // UserId 검색
		// 동적으로 해당 인덱스의 트리 사용 (IndexableData와 동일한 방식)
		indexID := req.IndexID
		tree, exists := IndexableDataTrees[indexID]
		if !exists {
			log.Printf("UserId 트리를 찾을 수 없음: %s", indexID)
			return &fsindex.RstTxList{
				IndexID: req.IndexID,
				Key:     req.Key,
				IdxData: []string{},
			}, nil
		}

		start := time.Now()
		txlist := []string{}

		if req.ComOp == fsindex.ComparisonOps_Range {
			begin := stringToFixedBytes(req.Begin, keySize)
			end := stringToFixedBytes(req.End, keySize)

			log.Println("=== UserId Range Search Debug ===")
			log.Printf("IndexID: %s", req.IndexID)
			log.Printf("Original range: Begin='%s', End='%s'", req.Begin, req.End)
			log.Printf("Converted bytes: Begin=%v, End=%v", begin, end)
			log.Printf("KeySize: %d", keySize)

			returned_pointers, err := tree.Range(begin, end)
			if err != nil {
				log.Printf("tree.Range error: %v", err)
			}
			log.Printf("tree.Range returned: %v", returned_pointers)

			if returned_pointers != nil {
				for returned_pointers != nil {
					_, value1, err1, nextPointer := returned_pointers()
					if err1 != nil {
						log.Fatal("Error while fetching data:", err1)
					}
					if nextPointer == nil {
						break
					}
					txlist = append(txlist, string(value1))
					returned_pointers = nextPointer
				}
			}
		} else if req.ComOp == fsindex.ComparisonOps_Eq {
			key := stringToFixedBytes(req.Value, keySize)
			returned_pointers, _ := tree.Find(key)

			if returned_pointers != nil {
				for returned_pointers != nil {
					_, value1, err1, nextPointer := returned_pointers()
					if err1 != nil {
						log.Fatal("Error while fetching data:", err1)
					}
					if nextPointer == nil {
						break
					}
					txlist = append(txlist, string(value1))
					returned_pointers = nextPointer
				}
			}
		}

		log.Printf("UserId search completed in %v", time.Since(start))
		return &fsindex.RstTxList{
			IndexID: req.IndexID,
			Key:     req.Key,
			IdxData: txlist,
		}, nil

	case "IndexableData":  // IndexableData용 검색
		// IndexName을 직접 사용 (없으면 IndexID 사용)
		indexName := req.IndexName
		if indexName == "" {
			indexName = req.IndexID // 하위 호환성을 위해 IndexID도 지원
		}
		log.Printf("=== IndexableData Tree Status ===")
		log.Printf("IndexName: %s", indexName)
		log.Printf("Available trees: %d", len(IndexableDataTrees))
		for k := range IndexableDataTrees {
			log.Printf("  - %s", k)
		}
		
		tree, exists := IndexableDataTrees[indexName]
		if !exists {
			log.Printf("IndexableData 트리를 찾을 수 없음: %s", indexName)
			return &fsindex.RstTxList{
				IndexID: req.IndexID,
				Key:     req.Key,
				IdxData: []string{},
			}, nil
		}
		
		if tree == nil {
			log.Printf("IndexableData 트리가 nil임: %s", indexName)
			return &fsindex.RstTxList{
				IndexID: req.IndexID,
				Key:     req.Key,
				IdxData: []string{},
			}, nil
		}
		log.Printf("IndexableData 트리 찾음: %s", indexName)

		start := time.Now()
		txlist := []string{}

		if req.ComOp == fsindex.ComparisonOps_Range {
			// 조직명 기반 범위 설정 - 원래 방식으로 복원
			beginStr := req.Begin
			endStr := req.End
			log.Printf("Using original range: Begin='%s', End='%s'", beginStr, endStr)
			
			begin := stringToFixedBytes(beginStr, keySize)
			end := stringToFixedBytes(endStr, keySize)

			log.Println("=== IndexableData Range Search Debug ===")
			log.Printf("IndexID: %s", req.IndexID)
			log.Printf("Original range: Begin='%s', End='%s'", req.Begin, req.End)
			log.Printf("Adjusted range: Begin='%s', End='%s'", beginStr, endStr)
			log.Printf("Converted bytes: Begin=%v, End=%v", begin, end)
			log.Printf("KeySize: %d", keySize)

			returned_pointers, err := tree.Range(begin, end)
			if err != nil {
				log.Printf("tree.Range error: %v", err)
			}
			log.Printf("tree.Range returned: %v", returned_pointers)

			if returned_pointers != nil {
				log.Printf("Found pointer chain, starting iteration...")
				chainCount := 0
				for returned_pointers != nil {
					chainCount++
					key1, value1, err1, nextPointer := returned_pointers()
					if err1 != nil {
						log.Printf("Error while fetching data at chain %d: %v", chainCount, err1)
						break
					}
					
					log.Printf("Chain %d - Key: %s, Value: %s, HasNext: %v", 
						chainCount, string(key1), string(value1), nextPointer != nil)
					
					// 값이 비어있지 않은 경우만 추가
					if len(value1) > 0 {
						txlist = append(txlist, string(value1))
						log.Printf("✅ Added tx %d: %s", len(txlist), string(value1))
					} else {
						log.Printf("⚠️ Empty value at chain %d", chainCount)
					}
					
					if nextPointer == nil {
						log.Printf("End of pointer chain at position %d", chainCount)
						break
					}
					returned_pointers = nextPointer
				}
				log.Printf("Total chains processed: %d, Total txs added: %d", chainCount, len(txlist))
			} else {
				log.Printf("No pointer returned from tree.Range")
			}
		} else if req.ComOp == fsindex.ComparisonOps_Eq {
			key := stringToFixedBytes(req.Value, keySize)
			returned_pointers, _ := tree.Find(key)

			if returned_pointers != nil {
				for returned_pointers != nil {
					_, value1, err1, nextPointer := returned_pointers()
					if err1 != nil {
						log.Fatal("Error while fetching data:", err1)
					}
					
					// 값이 비어있지 않은 경우만 추가
					if len(value1) > 0 {
						txlist = append(txlist, string(value1))
						log.Printf("Added tx: %s", string(value1))
					} else {
						// log.Printf("⚠️ Skipped empty value")
					}
					
					if nextPointer == nil {
						log.Println("End of pointer chain")
						break
					}
					returned_pointers = nextPointer
				}
			}
		}

		log.Printf("IndexableData search completed in %v", time.Since(start))
		log.Printf("Found %d transactions for IndexID: %s", len(txlist), req.IndexID)
		return &fsindex.RstTxList{
			IndexID: req.IndexID,
			Key:     req.Key,
			IdxData: txlist,
		}, nil
	default:
		log.Println("not indexed column !!!")
		return nil, nil
	} //end of switch
} //EOF
