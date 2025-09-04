/*
SPDX-License-Identifier: Apache-2.0
*/

package main

import (
	"log"

	chaincode "chaincode-gotkrwp/accessmanagement"

	"github.com/hyperledger/fabric-contract-api-go/contractapi"
)

func main() {
	accessManagementChaincode, err := contractapi.NewChaincode(&chaincode.SmartContract{})
	if err != nil {
		log.Panicf("Error creating access-management chaincode: %v", err)
	}

	if err := accessManagementChaincode.Start(); err != nil {
		log.Panicf("Error starting access-management chaincode: %v", err)
	}
}
