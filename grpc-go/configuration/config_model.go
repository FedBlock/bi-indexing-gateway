package configuration

import "github.com/hyperledger/fabric-gateway/pkg/client"

var RuntimeConf = RuntimeConfig{}
var MyContracts = []*client.Contract{}
var QsccContracts = []*client.Contract{}

type RuntimeConfig struct {
	Profile []ConnectProfile `yaml:"Profile"`
}

// Profile
type ConnectProfile struct {
	MspID         string `yaml:"mspID"`
	CryptoPath    string `yaml:"cryptoPath"`
	CertPath      string `yaml:"certPath"`
	KeyPath       string `yaml:"keyPath"`
	ChaincodeName string `yaml:"chaincodeName"`
	TlsCertPath   string `yaml:"tlsCertPath"`
	PeerEndpoint  string `yaml:"peerEndpoint"`
	GatewayPeer   string `yaml:"gatewayPeer"`
	ChannelName   string `yaml:"channelName"`
}
