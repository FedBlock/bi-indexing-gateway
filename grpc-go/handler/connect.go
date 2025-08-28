package handler

import (
	"crypto/x509"
	"fmt"
	"grpc-go/configuration"
	"os"
	"path"
	"time"

	"github.com/hyperledger/fabric-gateway/pkg/client"
	"github.com/hyperledger/fabric-gateway/pkg/identity"
	"google.golang.org/grpc"
	"google.golang.org/grpc/credentials"
)

func ClientConnect(profile configuration.ConnectProfile) *client.Contract {

	profile.CertPath = profile.CryptoPath + profile.CertPath
	profile.KeyPath = profile.CryptoPath + profile.KeyPath
	profile.TlsCertPath = profile.CryptoPath + profile.TlsCertPath

	clientConnection := myGrpcConnection(profile)

	id := myIdentity(profile)
	sign := mySign(profile.KeyPath)

	// Create a Gateway connection for a specific client identity
	gateway, err := client.Connect(
		id,
		client.WithSign(sign),
		client.WithClientConnection(clientConnection),
		// Default timeouts for different gRPC calls
		client.WithEvaluateTimeout(5*time.Second),
		client.WithEndorseTimeout(15*time.Second),
		client.WithSubmitTimeout(5*time.Second),
		client.WithCommitStatusTimeout(1*time.Minute),
	)
	if err != nil {
		panic(err)
	}

	network := gateway.GetNetwork(profile.ChannelName)
	contract := network.GetContract(profile.ChaincodeName)

	return contract
}

// newGrpcConnection creates a gRPC connection to the Gateway server.
func myGrpcConnection(profile configuration.ConnectProfile) *grpc.ClientConn {
	//fmt.Println("myGrpcConnection:", profile.tlsCertPath)
	certificate, err := myLoadCertificate(profile.TlsCertPath)
	if err != nil {
		panic(err)
	}

	certPool := x509.NewCertPool()
	certPool.AddCert(certificate)
	//fmt.Println("myGrpcConnection:", profile.gatewayPeer)
	transportCredentials := credentials.NewClientTLSFromCert(certPool, profile.GatewayPeer)

	connection, err := grpc.Dial(profile.PeerEndpoint, grpc.WithTransportCredentials(transportCredentials))
	if err != nil {
		panic(fmt.Errorf("failed to create gRPC connection: %w", err))
	}

	return connection
}

// newIdentity creates a client identity for this Gateway connection using an X.509 certificate.
func myIdentity(profile configuration.ConnectProfile) *identity.X509Identity {
	//fmt.Println("myIdentity:", profile.certPath)
	certificate, err := myLoadCertificate(profile.CertPath)
	if err != nil {
		panic(err)
	}

	id, err := identity.NewX509Identity(profile.MspID, certificate)
	if err != nil {
		panic(err)
	}

	return id
}

func myLoadCertificate(filename string) (*x509.Certificate, error) {
	fmt.Println("myLoadCertificate:", filename)
	//certificatePEM, err := ioutil.ReadFile(filename)
	certificatePEM, err := os.ReadFile(filename)
	if err != nil {
		return nil, fmt.Errorf("failed to read certificate file: %w", err)
	}
	return identity.CertificateFromPEM(certificatePEM)
}

// newSign creates a function that generates a digital signature from a message digest using a private key.
func mySign(keyPath string) identity.Sign {
	//fmt.Println("mySign:", keyPath)
	//files, err := ioutil.ReadDir(keyPath)
	files, err := os.ReadDir(keyPath)
	if err != nil {
		panic(fmt.Errorf("failed to read private key directory: %w", err))
	}
	//privateKeyPEM, err := ioutil.ReadFile(path.Join(keyPath, files[0].Name()))
	privateKeyPEM, err := os.ReadFile(path.Join(keyPath, files[0].Name()))

	if err != nil {
		panic(fmt.Errorf("failed to read private key file: %w", err))
	}

	privateKey, err := identity.PrivateKeyFromPEM(privateKeyPEM)
	if err != nil {
		panic(err)
	}

	sign, err := identity.NewPrivateKeySign(privateKey)
	if err != nil {
		panic(err)
	}

	return sign
}
