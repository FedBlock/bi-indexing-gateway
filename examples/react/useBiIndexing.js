// React Hook for BI-Indexing API
import { useState, useCallback } from 'react';

const API_BASE_URL = process.env.REACT_APP_API_URL || 'http://localhost:3001';

export const useBiIndexing = () => {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const apiCall = useCallback(async (endpoint, options = {}) => {
    setLoading(true);
    setError(null);
    
    try {
      const response = await fetch(`${API_BASE_URL}${endpoint}`, {
        headers: {
          'Content-Type': 'application/json',
          ...options.headers,
        },
        ...options,
      });

      const data = await response.json();
      
      if (!response.ok) {
        throw new Error(data.error || `HTTP error! status: ${response.status}`);
      }

      return data;
    } catch (err) {
      setError(err.message);
      throw err;
    } finally {
      setLoading(false);
    }
  }, []);

  // 통합 검색 (인덱스 + 블록체인)
  const searchIntegrated = useCallback(async (purpose, network = 'hardhat-local', contractAddress = null) => {
    return apiCall('/api/search/integrated', {
      method: 'POST',
      body: JSON.stringify({ purpose, network, contractAddress }),
    });
  }, [apiCall]);

  // 블록체인 직접 검색
  const searchDirect = useCallback(async (purpose, network = 'hardhat-local', contractAddress = null) => {
    return apiCall('/api/search/direct', {
      method: 'POST',
      body: JSON.stringify({ purpose, network, contractAddress }),
    });
  }, [apiCall]);

  // 컨트랙트 필터링 검색
  const searchContract = useCallback(async (purpose, pageSize = 100, network = 'hardhat-local') => {
    return apiCall('/api/search/contract', {
      method: 'POST',
      body: JSON.stringify({ purpose, pageSize, network }),
    });
  }, [apiCall]);

  // 전체 요청 조회
  const getAllRequests = useCallback(async (pageSize = 100, network = 'hardhat-local') => {
    return apiCall(`/api/requests/all?pageSize=${pageSize}&network=${network}`);
  }, [apiCall]);

  // 총 요청 개수 조회
  const getTotalCount = useCallback(async (network = 'hardhat-local') => {
    return apiCall(`/api/requests/count?network=${network}`);
  }, [apiCall]);

  // 범위별 요청 조회
  const getRequestsInRange = useCallback(async (startId, endId, network = 'hardhat-local') => {
    return apiCall('/api/requests/range', {
      method: 'POST',
      body: JSON.stringify({ startId, endId, network }),
    });
  }, [apiCall]);

  // 인덱스 검색
  const searchIndex = useCallback(async (searchParams) => {
    return apiCall('/api/index/search', {
      method: 'POST',
      body: JSON.stringify(searchParams),
    });
  }, [apiCall]);

  // 성능 통계 조회
  const getPerformanceStats = useCallback(async () => {
    return apiCall('/api/performance');
  }, [apiCall]);

  return {
    loading,
    error,
    searchIntegrated,
    searchDirect,
    searchContract,
    getAllRequests,
    getTotalCount,
    getRequestsInRange,
    searchIndex,
    getPerformanceStats,
  };
};

export default useBiIndexing;