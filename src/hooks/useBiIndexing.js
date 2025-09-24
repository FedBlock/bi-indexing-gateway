import { useState, useCallback } from 'react';

/**
 * BI-Indexing API를 위한 React Hook
 * 블록체인 인덱싱 기능을 React 앱에서 쉽게 사용할 수 있도록 제공
 */

const DEFAULT_CONFIG = {
  baseURL: process.env.REACT_APP_BI_INDEXING_API_URL || 'http://localhost:3001',
  defaultNetwork: 'hardhat-local',
  timeout: 30000, // 30초
};

export const useBiIndexing = (config = {}) => {
  const finalConfig = { ...DEFAULT_CONFIG, ...config };
  
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const apiCall = useCallback(async (endpoint, options = {}) => {
    setLoading(true);
    setError(null);
    
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), finalConfig.timeout);

      const response = await fetch(`${finalConfig.baseURL}${endpoint}`, {
        headers: {
          'Content-Type': 'application/json',
          ...options.headers,
        },
        signal: controller.signal,
        ...options,
      });

      clearTimeout(timeoutId);
      const data = await response.json();
      
      if (!response.ok) {
        throw new Error(data.error || `HTTP ${response.status}: ${response.statusText}`);
      }

      return data;
    } catch (err) {
      if (err.name === 'AbortError') {
        const timeoutError = new Error(`요청 시간 초과 (${finalConfig.timeout/1000}초)`);
        setError(timeoutError.message);
        throw timeoutError;
      }
      setError(err.message);
      throw err;
    } finally {
      setLoading(false);
    }
  }, [finalConfig.baseURL, finalConfig.timeout]);

  // 통합 검색 (인덱스 + 블록체인)
  const searchIntegrated = useCallback(async (purpose, options = {}) => {
    const { network = finalConfig.defaultNetwork, contractAddress = null } = options;
    return apiCall('/api/search/integrated', {
      method: 'POST',
      body: JSON.stringify({ purpose, network, contractAddress }),
    });
  }, [apiCall, finalConfig.defaultNetwork]);

  // 블록체인 직접 검색
  const searchDirect = useCallback(async (purpose, options = {}) => {
    const { network = finalConfig.defaultNetwork, contractAddress = null } = options;
    return apiCall('/api/search/direct', {
      method: 'POST',
      body: JSON.stringify({ purpose, network, contractAddress }),
    });
  }, [apiCall, finalConfig.defaultNetwork]);

  // 컨트랙트 필터링 검색
  const searchContract = useCallback(async (purpose, options = {}) => {
    const { pageSize = 100, network = finalConfig.defaultNetwork } = options;
    return apiCall('/api/search/contract', {
      method: 'POST',
      body: JSON.stringify({ purpose, pageSize, network }),
    });
  }, [apiCall, finalConfig.defaultNetwork]);

  // 전체 요청 조회
  const getAllRequests = useCallback(async (options = {}) => {
    const { pageSize = 100, network = finalConfig.defaultNetwork } = options;
    return apiCall(`/api/requests/all?pageSize=${pageSize}&network=${network}`);
  }, [apiCall, finalConfig.defaultNetwork]);

  // 총 요청 개수 조회
  const getTotalCount = useCallback(async (options = {}) => {
    const { network = finalConfig.defaultNetwork } = options;
    return apiCall(`/api/requests/count?network=${network}`);
  }, [apiCall, finalConfig.defaultNetwork]);

  // 범위별 요청 조회
  const getRequestsInRange = useCallback(async (startId, endId, options = {}) => {
    const { network = finalConfig.defaultNetwork } = options;
    return apiCall('/api/requests/range', {
      method: 'POST',
      body: JSON.stringify({ startId, endId, network }),
    });
  }, [apiCall, finalConfig.defaultNetwork]);

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
    // 상태
    loading,
    error,
    
    // 검색 메서드
    searchIntegrated,
    searchDirect,
    searchContract,
    
    // 요청 관리
    getAllRequests,
    getTotalCount,
    getRequestsInRange,
    
    // 유틸리티
    searchIndex,
    getPerformanceStats,
  };
};

export default useBiIndexing;