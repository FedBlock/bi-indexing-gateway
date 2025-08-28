package manager

import (
	"fmt"
	"log"
	"time"

	mngr "idxmngr-go/mngrapi/protos"
)

// =============================================================================
// 네트워크별 핸들러 인터페이스 및 구현체
// =============================================================================

// NetworkHandler - 모든 네트워크가 구현해야 하는 인터페이스
type NetworkHandler interface {
	PutData(data *mngr.PvdHistDataM) (string, error)
	GetData(query string) ([]byte, error)
	GetNetworkInfo() string
	ValidateData(data *mngr.PvdHistDataM) error
	GetFileIndexPath(indexType string) string
	ProcessIndexing(data *mngr.PvdHistDataM, txID string, colName string) error
	ProcessIndexingIndexableData(indexableData *mngr.IndexableDataM, txID string, colName string) error
}

// =============================================================================
// Fabric 네트워크 핸들러
// =============================================================================

// FabricHandler - Hyperledger Fabric 네트워크 처리
type FabricHandler struct {
	networkName string
	config      NetworkConfig
}

// NewFabricHandler - Fabric 핸들러 생성자
func NewFabricHandler(config NetworkConfig) *FabricHandler {
	return &FabricHandler{
		networkName: "fabric",
		config:      config,
	}
}

// PutData - Fabric 네트워크에 데이터 저장
func (h *FabricHandler) PutData(data *mngr.PvdHistDataM) (string, error) {
	log.Printf("[Fabric] 데이터 저장 중: OBU_ID=%s, Speed=%d", data.ObuId, data.Speed)
	
	// Fabric 전용 데이터 검증
	if err := h.ValidateData(data); err != nil {
		return "", fmt.Errorf("fabric data validation failed: %v", err)
	}
	
	// Fabric 전용 처리 로직 (현재는 시뮬레이션)
	txID := fmt.Sprintf("fabric_%s_%d", data.ObuId, time.Now().Unix())
	log.Printf("[Fabric] 데이터 저장 완료: TxID=%s", txID)
	
	return txID, nil
}

// GetData - Fabric 네트워크에서 데이터 조회
func (h *FabricHandler) GetData(query string) ([]byte, error) {
	log.Printf("[Fabric] 데이터 조회: %s", query)
	// Fabric 전용 조회 로직 구현
	return []byte("fabric_data"), nil
}

// GetNetworkInfo - 네트워크 정보 반환
func (h *FabricHandler) GetNetworkInfo() string {
	return h.networkName
}

// ValidateData - Fabric 데이터 유효성 검사
func (h *FabricHandler) ValidateData(data *mngr.PvdHistDataM) error {
	if data.ObuId == "" {
		return fmt.Errorf("OBU_ID is required for Fabric network")
	}
	if data.Speed < 0 || data.Speed > 200 {
		return fmt.Errorf("Speed must be between 0 and 200 for Fabric network")
	}
	return nil
}

// GetFileIndexPath - Fabric File Index 경로 반환
func (h *FabricHandler) GetFileIndexPath(indexType string) string {
	// Fabric은 체인코드 사용하므로 간단한 경로
	return fmt.Sprintf("%s_%s.bf", h.networkName, indexType)
}

// ProcessIndexing - Fabric 데이터 인덱싱 처리
func (h *FabricHandler) ProcessIndexing(data *mngr.PvdHistDataM, txID string, colName string) error {
	log.Printf("[Fabric] 인덱싱 처리 중: OBU_ID=%s, TxID=%s, ColName=%s", data.ObuId, txID, colName)
	
	// Fabric 전용 인덱싱 로직
	// 1. 데이터 검증
	if err := h.ValidateData(data); err != nil {
		return fmt.Errorf("fabric indexing validation failed: %v", err)
	}
	
	// 2. File Index에 데이터 저장 (시뮬레이션)
	filePath := h.GetFileIndexPath("speed")
	log.Printf("[Fabric] File Index에 저장: %s", filePath)
	
	// 3. 인덱싱 완료 로그
	log.Printf("[Fabric] 인덱싱 완료: %s -> %s", txID, filePath)
	
	return nil
}

// ProcessIndexingIndexableData - Fabric IndexableData 인덱싱 처리 (Fabric는 주로 PVD 사용)
func (h *FabricHandler) ProcessIndexingIndexableData(indexableData *mngr.IndexableDataM, txID string, colName string) error {
	log.Printf("[Fabric] IndexableData 인덱싱 처리 중: TxID=%s, ColName=%s", txID, colName)
	// Fabric는 주로 PVD 데이터를 사용하므로 IndexableData는 지원하지 않음
	return fmt.Errorf("Fabric network does not support IndexableData indexing")
}

// =============================================================================
// EVM 공개 네트워크 핸들러
// =============================================================================

// EVMPublicNetworkHandler - EVM 공개 네트워크들 통합 처리
type EVMPublicNetworkHandler struct {
	networkName string
	config      NetworkConfig
}

// NewEVMPublicNetworkHandler - EVM 공개 네트워크 핸들러 생성자
func NewEVMPublicNetworkHandler(config NetworkConfig) *EVMPublicNetworkHandler {
	return &EVMPublicNetworkHandler{
		networkName: config.NetworkName,
		config:      config,
	}
}

// PutData - EVM 네트워크에 데이터 저장
func (h *EVMPublicNetworkHandler) PutData(data *mngr.PvdHistDataM) (string, error) {
	log.Printf("[%s] 데이터 저장 중: OBU_ID=%s, Speed=%d", data.ObuId, data.Speed)
	
	// EVM 전용 데이터 검증
	if err := h.ValidateData(data); err != nil {
		return "", fmt.Errorf("%s data validation failed: %v", h.networkName, err)
	}
	
	// EVM 전용 처리 로직 (현재는 시뮬레이션)
	txID := fmt.Sprintf("%s_%s_%d", h.networkName, data.ObuId, time.Now().Unix())
	log.Printf("[%s] 데이터 저장 완료: TxID=%s", h.networkName, txID)
	
	return txID, nil
}

// GetData - EVM 네트워크에서 데이터 조회
func (h *EVMPublicNetworkHandler) GetData(query string) ([]byte, error) {
	log.Printf("[%s] 데이터 조회: %s", query)
	// EVM 전용 조회 로직 구현
	return []byte(fmt.Sprintf("%s_data", h.networkName)), nil
}

// GetNetworkInfo - 네트워크 정보 반환
func (h *EVMPublicNetworkHandler) GetNetworkInfo() string {
	return h.networkName
}

// ValidateData - EVM 데이터 유효성 검사
func (h *EVMPublicNetworkHandler) ValidateData(data *mngr.PvdHistDataM) error {
	if data.ObuId == "" {
		return fmt.Errorf("OBU_ID is required for %s network", h.networkName)
	}
	// EVM은 더 유연한 검증 규칙
	if data.Speed < 0 {
		return fmt.Errorf("Speed cannot be negative for %s network", h.networkName)
	}
	return nil
}

// GetFileIndexPath - EVM File Index 경로 반환
func (h *EVMPublicNetworkHandler) GetFileIndexPath(indexType string) string {
	if h.config.ContractAddress != "" {
		// 컨트랙트 주소 앞 8자리 추출 (0x 제외)
		contractShort := h.config.ContractAddress[2:10] // 0x 이후 8자리
		return fmt.Sprintf("%s_%s_%s.bf", h.networkName, contractShort, indexType)
	}
	// 컨트랙트 주소가 없는 경우 (Fabric과 동일)
	return fmt.Sprintf("%s_%s.bf", h.networkName, indexType)
}

// ProcessIndexing - EVM 데이터 인덱싱 처리
func (h *EVMPublicNetworkHandler) ProcessIndexing(data *mngr.PvdHistDataM, txID string, colName string) error {
	log.Printf("[%s] 인덱싱 처리 중: TxID=%s, ColName=%s", h.networkName, txID, colName)
	
	// EVM 전용 인덱싱 로직 (IndexableData 처리)
	// 1. 컨트랙트 주소 확인
	if h.config.ContractAddress == "" {
		return fmt.Errorf("contract address not configured for %s network", h.networkName)
	}
	
	// 2. File Index에 데이터 저장 (시뮬레이션)
	filePath := h.GetFileIndexPath("speed")
	log.Printf("[%s] File Index에 저장: %s (Contract: %s, ColName: %s)", filePath, h.config.ContractAddress, h.networkName, colName)
	
	// 3. 인덱싱 완료 로그
	log.Printf("[%s] 인덱싱 완료: %s -> %s", txID, filePath, h.networkName)
	
	return nil
}

// ProcessIndexingIndexableData - EVM IndexableData 인덱싱 처리 (EVM 네트워크 전용)
func (h *EVMPublicNetworkHandler) ProcessIndexingIndexableData(indexableData *mngr.IndexableDataM, txID string, colName string) error {
	log.Printf("[%s] IndexableData 인덱싱 처리 중: TxID=%s, ColName=%s", h.networkName, txID, colName)
	
	// EVM 전용 IndexableData 인덱싱 로직
	// 1. 컨트랙트 주소 확인
	if h.config.ContractAddress == "" {
		return fmt.Errorf("contract address not configured for %s network", h.networkName)
	}
	
	// 2. File Index에 데이터 저장 (시뮬레이션)
	filePath := h.GetFileIndexPath("speed")
	log.Printf("[%s] IndexableData File Index에 저장: %s (Contract: %s, ColName: %s)", filePath, h.config.ContractAddress, h.networkName, colName)
	
	// 3. 인덱싱 완료 로그
	log.Printf("[%s] IndexableData 인덱싱 완료: %s -> %s", txID, filePath, h.networkName)
	
	return nil
}

// =============================================================================
// 네트워크 핸들러 팩토리
// =============================================================================

// NetworkHandlerFactory - 네트워크별 핸들러 생성 및 관리
type NetworkHandlerFactory struct {
	handlers map[string]NetworkHandler
}

// NewNetworkHandlerFactory - 네트워크 핸들러 팩토리 생성자
func NewNetworkHandlerFactory() *NetworkHandlerFactory {
	factory := &NetworkHandlerFactory{
		handlers: make(map[string]NetworkHandler),
	}
	
	// Config에서 네트워크별 핸들러 생성
	for network, config := range NetworkConfigs {
		var handler NetworkHandler
		
		switch network {
		case "fabric":
			handler = NewFabricHandler(config)
		case "hardhat", "sepolia", "monad":
			handler = NewEVMPublicNetworkHandler(config)
		default:
			log.Printf("Unsupported network: %s", network)
			continue
		}
		
		factory.RegisterHandler(network, handler)
	}
	
	return factory
}

// RegisterHandler - 네트워크 핸들러 등록
func (f *NetworkHandlerFactory) RegisterHandler(network string, handler NetworkHandler) {
	f.handlers[network] = handler
	log.Printf("네트워크 핸들러 등록: %s", network)
}

// GetHandler - 특정 네트워크의 핸들러 가져오기
func (f *NetworkHandlerFactory) GetHandler(network string) (NetworkHandler, error) {
	handler, exists := f.handlers[network]
	if !exists {
		return nil, fmt.Errorf("unsupported network: %s", network)
	}
	return handler, nil
}

// GetSupportedNetworks - 지원되는 네트워크 목록 반환
func (f *NetworkHandlerFactory) GetSupportedNetworks() []string {
	networks := make([]string, 0, len(f.handlers))
	for network := range f.handlers {
		networks = append(networks, network)
	}
	return networks
}
