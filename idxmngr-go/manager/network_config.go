package manager

import (
	"fmt"
	"io/ioutil"
	"log"
	
	"gopkg.in/yaml.v3"
)

// =============================================================================
// 네트워크별 설정을 관리하는 구조체 및 함수들 (단순화된 버전)
// =============================================================================

// NetworkConfig - 개별 네트워크의 설정 정보를 담는 구조체
type NetworkConfig struct {
	NetworkName     string `yaml:"network_name"`     // 네트워크 이름 (예: "hardhat", "sepolia", "monad")
	ContractAddress string `yaml:"contract_address"` // 해당 네트워크에 배포된 컨트랙트 주소
	FileIndexPath   string `yaml:"file_index_path"`  // File Index 파일 경로 (사용자 필수 입력)
}

// NetworkConfigs - 전체 네트워크 설정을 담는 전역 맵
var NetworkConfigs = make(map[string]NetworkConfig)

// LoadNetworkConfigs - 네트워크 설정 파일을 로드하는 함수
func LoadNetworkConfigs(configPath string) error {
	data, err := ioutil.ReadFile(configPath)
	if err != nil {
		return fmt.Errorf("failed to read network config file: %v", err)
	}

	var config struct {
		Networks map[string]NetworkConfig `yaml:"networks"`
	}

	if err := yaml.Unmarshal(data, &config); err != nil {
		return fmt.Errorf("failed to parse network config file: %v", err)
	}

	// 사용자 설정 파일에서 네트워크 설정 로드
	if config.Networks != nil {
		for network, userConfig := range config.Networks {
			// 설정 유효성 검사
			if err := ValidateNetworkConfig(userConfig); err != nil {
				log.Printf("Warning: Invalid config for network %s: %v", network, err)
				continue
			}
			
			NetworkConfigs[network] = userConfig
			log.Printf("Loaded config for network: %s", network)
		}
	}

	log.Printf("Total networks loaded: %d", len(NetworkConfigs))
	for network, config := range NetworkConfigs {
		log.Printf("  %s: %s -> %s", network, config.ContractAddress, config.FileIndexPath)
	}

	return nil
}

// GetNetworkConfig - 특정 네트워크의 설정을 가져오는 함수
func GetNetworkConfig(network string) (NetworkConfig, error) {
	config, exists := NetworkConfigs[network]
	if !exists {
		return NetworkConfig{}, fmt.Errorf("network config not found: %s", network)
	}
	return config, nil
}

// GetSupportedNetworks - 현재 지원되는 모든 네트워크 목록을 반환하는 함수
func GetSupportedNetworks() []string {
	networks := make([]string, 0, len(NetworkConfigs))
	for network := range NetworkConfigs {
		networks = append(networks, network)
	}
	return networks
}

// ValidateNetworkConfig - 네트워크 설정의 유효성을 검사하는 함수
func ValidateNetworkConfig(config NetworkConfig) error {
	// 1. 네트워크 이름 필수 검사
	if config.NetworkName == "" {
		return fmt.Errorf("network name is required")
	}
	
	// 2. 컨트랙트 주소 필수 검사 (Fabric 제외)
	if config.NetworkName != "fabric" && config.ContractAddress == "" {
		return fmt.Errorf("contract address is required for %s network", config.NetworkName)
	}
	
	// 3. File Index 경로 필수 검사 (사용자가 직접 입력해야 함)
	if config.FileIndexPath == "" {
		return fmt.Errorf("file_index_path is required for %s network - please specify the file path", config.NetworkName)
	}
	
	return nil
}
