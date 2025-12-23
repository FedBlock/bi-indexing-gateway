package main

import (
	"encoding/json"
	"fmt"
	"strconv"

	"github.com/hyperledger/fabric-contract-api-go/contractapi"
)

/*
 ─────────────────────────────────────────
  Contract Definition
 ─────────────────────────────────────────
*/

type AccessManagementChaincode struct {
	contractapi.Contract
}

/*
 ─────────────────────────────────────────
  Enum & Constants
 ─────────────────────────────────────────
*/

type RequestStatus int

const (
	PENDING RequestStatus = iota
	APPROVED
	REJECTED
)

const (
	RequestCounterKey = "ACCESS_REQUEST_COUNTER"
	RequestKeyPrefix  = "ACCESS_REQUEST"
	OwnerIndexPrefix  = "OWNER_REQUEST"
)

/*
 ─────────────────────────────────────────
  Data Structures
 ─────────────────────────────────────────
*/

type RequestDetail struct {
	RequestID        uint64        `json:"requestId"`
	Requester        string        `json:"requester"`
	ResourceOwner    string        `json:"resourceOwner"`
	Status           RequestStatus `json:"status"`
	Purpose          string        `json:"purpose"`
	OrganizationName string        `json:"organizationName"`
}

/*
 ─────────────────────────────────────────
  Internal Utilities
 ─────────────────────────────────────────
*/

// Solidity msg.sender 대체
func getClientID(ctx contractapi.TransactionContextInterface) (string, error) {
	id, err := ctx.GetClientIdentity().GetID()
	if err != nil {
		return "", err
	}
	return id, nil
}

// requestId 증가 (Solidity uint256 counter 대응)
func (cc *AccessManagementChaincode) nextRequestID(
	ctx contractapi.TransactionContextInterface,
) (uint64, error) {

	data, err := ctx.GetStub().GetState(RequestCounterKey)
	if err != nil {
		return 0, err
	}

	var current uint64
	if data != nil {
		current, _ = strconv.ParseUint(string(data), 10, 64)
	}

	next := current + 1
	err = ctx.GetStub().PutState(
		RequestCounterKey,
		[]byte(strconv.FormatUint(next, 10)),
	)
	if err != nil {
		return 0, err
	}

	return next, nil
}

func requestStateKey(id uint64) string {
	return fmt.Sprintf("%s_%d", RequestKeyPrefix, id)
}

/*
 ─────────────────────────────────────────
  saveRequest (Solidity saveRequest)
 ─────────────────────────────────────────
*/

func (cc *AccessManagementChaincode) SaveRequest(
	ctx contractapi.TransactionContextInterface,
	resourceOwner string,
	purpose string,
	organizationName string,
) (uint64, error) {

	if resourceOwner == "" {
		return 0, fmt.Errorf("InvalidResourceOwner")
	}
	if purpose == "" {
		return 0, fmt.Errorf("InvalidPurpose")
	}
	if organizationName == "" {
		return 0, fmt.Errorf("InvalidOrganizationName")
	}

	requester, err := getClientID(ctx)
	if err != nil {
		return 0, err
	}

	requestID, err := cc.nextRequestID(ctx)
	if err != nil {
		return 0, err
	}

	request := RequestDetail{
		RequestID:        requestID,
		Requester:        requester,
		ResourceOwner:    resourceOwner,
		Status:           PENDING,
		Purpose:          purpose,
		OrganizationName: organizationName,
	}

	bytes, _ := json.Marshal(request)

	err = ctx.GetStub().PutState(requestStateKey(requestID), bytes)
	if err != nil {
		return 0, err
	}

	// owner → requestId 인덱스 (mapping(address => uint256[]))
	indexKey, _ := ctx.GetStub().CreateCompositeKey(
		OwnerIndexPrefix,
		[]string{resourceOwner, strconv.FormatUint(requestID, 10)},
	)
	ctx.GetStub().PutState(indexKey, []byte{0x00})

	// Solidity event 대응
	ctx.GetStub().SetEvent("AccessRequestsSaved", bytes)

	return requestID, nil
}

/*
 ─────────────────────────────────────────
  saveRequestStatus (Solidity saveRequestStatus)
 ─────────────────────────────────────────
*/

func (cc *AccessManagementChaincode) SaveRequestStatus(
	ctx contractapi.TransactionContextInterface,
	requestID uint64,
	status int,
) error {

	if status != int(APPROVED) && status != int(REJECTED) {
		return fmt.Errorf("InvalidStatusChange")
	}

	data, err := ctx.GetStub().GetState(requestStateKey(requestID))
	if err != nil || data == nil {
		return fmt.Errorf("RequestNotFound")
	}

	var request RequestDetail
	if err := json.Unmarshal(data, &request); err != nil {
		return err
	}

	caller, _ := getClientID(ctx)
	if caller != request.ResourceOwner {
		return fmt.Errorf("OnlyOwnerCanChangeStatus")
	}

	if request.Status != PENDING {
		return fmt.Errorf("RequestAlreadyProcessed")
	}

	request.Status = RequestStatus(status)

	bytes, _ := json.Marshal(request)
	err = ctx.GetStub().PutState(requestStateKey(requestID), bytes)
	if err != nil {
		return err
	}

	ctx.GetStub().SetEvent("RequestStatusChanged", bytes)
	return nil
}

/*
 ─────────────────────────────────────────
  getRequestById
 ─────────────────────────────────────────
*/

func (cc *AccessManagementChaincode) GetRequestById(
	ctx contractapi.TransactionContextInterface,
	requestID uint64,
) (*RequestDetail, error) {

	data, err := ctx.GetStub().GetState(requestStateKey(requestID))
	if err != nil || data == nil {
		return nil, fmt.Errorf("RequestNotFound")
	}

	var request RequestDetail
	if err := json.Unmarshal(data, &request); err != nil {
		return nil, err
	}

	return &request, nil
}

/*
 ─────────────────────────────────────────
  getRequestId (owner 기준)
 ─────────────────────────────────────────
*/

func (cc *AccessManagementChaincode) GetRequestId(
	ctx contractapi.TransactionContextInterface,
	owner string,
) ([]uint64, error) {

	iter, err := ctx.GetStub().GetStateByPartialCompositeKey(
		OwnerIndexPrefix,
		[]string{owner},
	)
	if err != nil {
		return nil, err
	}
	defer iter.Close()

	var ids []uint64
	for iter.HasNext() {
		kv, _ := iter.Next()
		_, parts, _ := ctx.GetStub().SplitCompositeKey(kv.Key)
		id, _ := strconv.ParseUint(parts[1], 10, 64)
		ids = append(ids, id)
	}

	return ids, nil
}

/*
 ─────────────────────────────────────────
  getTotalRequestCount
 ─────────────────────────────────────────
*/

func (cc *AccessManagementChaincode) GetTotalRequestCount(
	ctx contractapi.TransactionContextInterface,
) (uint64, error) {

	data, err := ctx.GetStub().GetState(RequestCounterKey)
	if err != nil || data == nil {
		return 0, nil
	}

	return strconv.ParseUint(string(data), 10, 64)
}

/*
 ─────────────────────────────────────────
  getRequestsInRange
 ─────────────────────────────────────────
*/

func (cc *AccessManagementChaincode) GetRequestsInRange(
	ctx contractapi.TransactionContextInterface,
	start uint64,
	end uint64,
) ([]*RequestDetail, error) {

	if start == 0 || start > end {
		return nil, fmt.Errorf("InvalidRange")
	}

	var results []*RequestDetail

	for i := start; i <= end; i++ {
		data, err := ctx.GetStub().GetState(requestStateKey(i))
		if err == nil && data != nil {
			var req RequestDetail
			json.Unmarshal(data, &req)
			results = append(results, &req)
		}
	}

	return results, nil
}

