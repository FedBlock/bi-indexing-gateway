/*
SPDX-License-Identifier: Apache-2.0
*/

package main

import (
	"log"

	chaincode "pvd/pvd"

	"github.com/hyperledger/fabric-contract-api-go/contractapi"
)

func main() {
	pvdcode, err := contractapi.NewChaincode(&chaincode.SmartContract{})
	if err != nil {
		log.Panicf("Error creating pvd-record chaincode: %v", err)
	}

	if err := pvdcode.Start(); err != nil {
		log.Panicf("Error starting pvd-record chaincode: %v", err)
	}
}
