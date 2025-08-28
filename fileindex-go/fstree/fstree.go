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

	fsindex "fileindex-go/idxserver_api"

	"github.com/timtadh/fs2/bptree"
	"github.com/timtadh/fs2/fmap"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
)

type IndexServer struct {
	fsindex.UnimplementedHLFDataIndexServer
}

// file index tree
var DtTree *bptree.BpTree
var SpeedTree *bptree.BpTree
var AddrTree *bptree.BpTree
var OrgTree *bptree.BpTree  // 추가
var IndexableDataTrees map[string]*bptree.BpTree  // 인덱스별로 독립적인 트리
var idxTree *bptree.BpTree

func init() {
	IndexableDataTrees = make(map[string]*bptree.BpTree)
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

	case "IndexableData":  // 범용 데이터용 인덱스
		// 동적으로 인덱스별 트리 생성
		var tree *bptree.BpTree
		err = openOrCreateIndex(idxinfo.FilePath, keySize, &tree)
		if err == nil {
			IndexableDataTrees[idxinfo.IndexID] = tree
			log.Printf("IndexableData 트리 생성 완료: %s -> %s", idxinfo.IndexID, idxinfo.FilePath)
		}

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
			case "IndexableData":  // 범용 데이터용 인덱싱
				// 동적으로 해당 인덱스의 트리 사용
				indexID := recvDatas.GetColIndex()
				tree, exists := IndexableDataTrees[indexID]
				if !exists {
					log.Printf("IndexableData 트리를 찾을 수 없음: %s", indexID)
					continue
				}
				targetTree = &tree
				// IndexableData에서 OrganizationName 추출
				if rec.IndexableData != nil {
					key = stringToFixedBytes(rec.IndexableData.OrganizationName, keySize)
				} else {
					log.Printf("IndexableData is nil at index: %d", idx)
					continue
				}
			default:
				log.Printf("Unsupported index column: %s", idxCol)
				continue
			}

			newValue := []byte(rec.TxId)

			if len(key) == 0 || len(newValue) == 0 {
				log.Printf("Invalid data at index: %d", idx)
				continue
			}
			if err := (*targetTree).Add(key, newValue); err != nil {
				log.Printf("Failed to add to tree: %v", err)
				return status.Errorf(codes.Internal, "Failed to add data: %v", err)
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

	case "IndexableData":  // IndexableData용 검색
		// 동적으로 해당 인덱스의 트리 사용
		indexID := req.IndexID
		tree, exists := IndexableDataTrees[indexID]
		if !exists {
			log.Printf("IndexableData 트리를 찾을 수 없음: %s", indexID)
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

			log.Println("=== IndexableData Range Search Debug ===")
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
						log.Println("End of pointer chain")
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
						log.Println("End of pointer chain")
						break
					}
					txlist = append(txlist, string(value1))
					returned_pointers = nextPointer
				}
			}
		}

		log.Printf("IndexableData search completed in %v", time.Since(start))
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
