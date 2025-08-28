package handler

import (
	"encoding/json"
	"fmt"
	pvd "grpc-go/pvdapi/grpc-go/pvdapi"

	"github.com/hyperledger/fabric-protos-go-apiv2/common"
	rwset2 "github.com/hyperledger/fabric-protos-go-apiv2/ledger/rwset"
	kvrwset2 "github.com/hyperledger/fabric-protos-go-apiv2/ledger/rwset/kvrwset"
	pb "github.com/hyperledger/fabric-protos-go-apiv2/peer"
	"google.golang.org/protobuf/proto"
)

// Version Conflict Error
type TxRwSet struct {
	NsRwSets []*NsRwSet
}

// NsRwSet encapsulates 'kvrwset2.KVRWSet' proto message for a specific name space (chaincode)
type NsRwSet struct {
	NameSpace        string
	KvRwSet          *kvrwset2.KVRWSet
	CollHashedRwSets []*CollHashedRwSet
}

// CollHashedRwSet encapsulates 'kvrwset2.HashedRWSet' proto message for a specific collection
type CollHashedRwSet struct {
	CollectionName string
	HashedRwSet    *kvrwset2.HashedRWSet
	PvtRwSetHash   []byte
}

func (txRwSet *TxRwSet) FromProtoBytes1(protoBytes []byte) error {
	protoMsg := &rwset2.TxReadWriteSet{}
	var err error
	var txRwSetTemp *TxRwSet
	if err = proto.Unmarshal(protoBytes, protoMsg); err != nil {
		return err
	}
	if txRwSetTemp, err = TxRwSetFromProtoMsg1(protoMsg); err != nil {
		return err
	}
	txRwSet.NsRwSets = txRwSetTemp.NsRwSets
	return nil
}

func TxRwSetFromProtoMsg1(protoMsg *rwset2.TxReadWriteSet) (*TxRwSet, error) {
	txRwSet := &TxRwSet{}
	var nsRwSet *NsRwSet
	var err error
	for _, nsRwSetProtoMsg := range protoMsg.NsRwset {
		if nsRwSet, err = nsRwSetFromProtoMsg1(nsRwSetProtoMsg); err != nil {
			return nil, err
		}
		//fmt.Println("---> nsRwSet := ", nsRwSet.KvRwSet.Writes)
		txRwSet.NsRwSets = append(txRwSet.NsRwSets, nsRwSet)
	}
	return txRwSet, nil
}

func nsRwSetFromProtoMsg1(protoMsg *rwset2.NsReadWriteSet) (*NsRwSet, error) {
	nsRwSet := &NsRwSet{NameSpace: protoMsg.Namespace, KvRwSet: &kvrwset2.KVRWSet{}}
	if err := proto.Unmarshal(protoMsg.Rwset, nsRwSet.KvRwSet); err != nil {
		return nil, err
	}
	var err error
	var collHashedRwSet *CollHashedRwSet
	for _, collHashedRwSetProtoMsg := range protoMsg.CollectionHashedRwset {
		if collHashedRwSet, err = collHashedRwSetFromProtoMsg1(collHashedRwSetProtoMsg); err != nil {
			return nil, err
		}
		nsRwSet.CollHashedRwSets = append(nsRwSet.CollHashedRwSets, collHashedRwSet)
	}
	return nsRwSet, nil
}

func collHashedRwSetFromProtoMsg1(protoMsg *rwset2.CollectionHashedReadWriteSet) (*CollHashedRwSet, error) {
	colHashedRwSet := &CollHashedRwSet{
		CollectionName: protoMsg.CollectionName,
		PvtRwSetHash:   protoMsg.PvtRwsetHash,
		HashedRwSet:    &kvrwset2.HashedRWSet{},
	}
	if err := proto.Unmarshal(protoMsg.HashedRwset, colHashedRwSet.HashedRwSet); err != nil {
		return nil, err
	}
	return colHashedRwSet, nil
}

func parseResultFromTransactionAction1(transactionAction *pb.TransactionAction) ([]byte, error) {
	actionPayload := &pb.ChaincodeActionPayload{}
	if err := proto.Unmarshal(transactionAction.GetPayload(), actionPayload); err != nil {
		return nil, fmt.Errorf("failed to deserialize chaincode action payload: %w", err)
	}

	//fmt.Println("*** txAction1: actionPayload", actionPayload)

	responsePayload := &pb.ProposalResponsePayload{}
	if err := proto.Unmarshal(actionPayload.GetAction().GetProposalResponsePayload(), responsePayload); err != nil {
		return nil, fmt.Errorf("failed to deserialize proposal response payload: %w", err)
	}

	//fmt.Println("*** txAction1: responsePayload \n", responsePayload)

	chaincodeAction := &pb.ChaincodeAction{}
	if err := proto.Unmarshal(responsePayload.GetExtension(), chaincodeAction); err != nil {
		return nil, fmt.Errorf("failed to deserialize chaincode action: %w", err)
	}

	//fmt.Println("*** txAction: chaincodeAction Results size : ", len(chaincodeAction.Results))
	//fmt.Println("*** txAction1: chaincodeAction Results \n", string(chaincodeAction.Results))

	if len(chaincodeAction.Results) == 0 {
		return nil, nil
	}

	txRwSet2 := rwset2.NsReadWriteSet{}
	json.Unmarshal(chaincodeAction.Results, &txRwSet2)

	txRwSet := TxRwSet{}
	txRwSet.FromProtoBytes1(chaincodeAction.Results)

	//fmt.Println("txRWSet.txRwSet : \n", txRwSet)

	protoMsg := &rwset2.TxReadWriteSet{}
	var txRwSetTemp *TxRwSet
	proto.Unmarshal(chaincodeAction.GetResults(), protoMsg)
	txRwSetTemp, _ = TxRwSetFromProtoMsg1(protoMsg)

	txRwSet.NsRwSets = txRwSetTemp.NsRwSets

	kvw := &kvrwset2.KVWrite{}
	for _, nsRwSet := range txRwSet.NsRwSets {
		if len(nsRwSet.KvRwSet.Writes) > 0 {
			//fmt.Println("Parsed ---> nsRwSet := ", nsRwSet.KvRwSet.Writes)
			kvw = nsRwSet.KvRwSet.Writes[0]
			//fmt.Println("Parsed ---> nsRwSet := ", string(kvw.Value))
			return kvw.Value, nil

		}
	}
	return chaincodeAction.GetResponse().GetPayload(), nil
}
func parseTransactionFromResult(txid string, evaluateResult []byte) *pvd.TxData {
	var pt pb.ProcessedTransaction
	proto.Unmarshal(evaluateResult, &pt)

	payload := &common.Payload{}
	proto.Unmarshal(pt.GetTransactionEnvelope().Payload, payload)

	//log.Println("*** txPayload: ", payload)

	channelHeader := &common.ChannelHeader{}
	proto.Unmarshal(payload.GetHeader().GetChannelHeader(), channelHeader)

	//log.Println("*** txHeader: ", channelHeader)

	transaction := &pb.Transaction{}
	if err := proto.Unmarshal(payload.GetData(), transaction); err != nil {
	}

	for _, transactionAction := range transaction.GetActions() {
		//log.Println("*** txAction: ", transactionAction.String())
		result, _ := parseResultFromTransactionAction1(transactionAction)

		data := pvd.PvdHist{}
		json.Unmarshal(result, &data)

		txdata := pvd.TxData{ResponseCode: 200, TxId: txid, Pvd: &data}
		return &txdata
	}

	return nil
}
