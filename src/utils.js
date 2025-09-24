// 유틸리티 함수들

/**
 * API 응답 처리 헬퍼
 */
export const formatApiResponse = (response) => {
  if (!response.success) {
    throw new Error(response.error || 'API 요청 실패');
  }
  return response.data;
};

/**
 * 트랜잭션 ID 단축 표시
 */
export const shortenTxId = (txId, startLength = 10, endLength = 8) => {
  if (!txId || txId.length <= startLength + endLength) return txId;
  return `${txId.slice(0, startLength)}...${txId.slice(-endLength)}`;
};

/**
 * 주소 단축 표시
 */
export const shortenAddress = (address, startLength = 6, endLength = 4) => {
  if (!address || address.length <= startLength + endLength) return address;
  return `${address.slice(0, startLength)}...${address.slice(-endLength)}`;
};

/**
 * 처리 시간 포맷팅
 */
export const formatProcessingTime = (timeString) => {
  if (!timeString) return '';
  const match = timeString.match(/(\d+)ms/);
  if (match) {
    const ms = parseInt(match[1]);
    if (ms < 1000) return `${ms}ms`;
    return `${(ms / 1000).toFixed(2)}초`;
  }
  return timeString;
};

/**
 * 네트워크 이름 포맷팅
 */
export const formatNetworkName = (network) => {
  const networkNames = {
    'hardhat-local': 'Hardhat Local',
    'monad': 'Monad Testnet',
    'ethereum': 'Ethereum Mainnet',
    'polygon': 'Polygon',
  };
  return networkNames[network] || network;
};

/**
 * 검색 방법 설명
 */
export const getSearchMethodDescription = (method) => {
  const descriptions = {
    'integrated': '인덱스에서 트랜잭션 ID 조회 후 블록체인에서 상세 정보 조회',
    'direct': '모든 블록을 순차적으로 검색하여 데이터 조회',
    'contract': '스마트 컨트랙트에서 직접 데이터 조회 (페이징 지원)',
  };
  return descriptions[method] || method;
};

/**
 * 상태 색상 반환
 */
export const getStatusColor = (status) => {
  const colors = {
    'success': '#28a745',
    'pending': '#ffc107',
    'failed': '#dc3545',
    'error': '#dc3545',
  };
  return colors[status] || '#6c757d';
};