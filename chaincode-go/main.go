package main

import (
	"log"

	"github.com/hyperledger/fabric-contract-api-go/contractapi"
)

func main() {
	cc, err := contractapi.NewChaincode(&AccessManagementChaincode{})
	if err != nil {
		log.Panicf("Error creating access-management chaincode: %v", err)
	}

	if err := cc.Start(); err != nil {
		log.Panicf("Error starting access-management chaincode: %v", err)
	}
}
