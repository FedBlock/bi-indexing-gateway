import React, { useState } from 'react';
import useBiIndexing from './useBiIndexing';

const BiIndexingExample = () => {
  const [purpose, setPurpose] = useState('수면');
  const [network, setNetwork] = useState('hardhat-local');
  const [results, setResults] = useState(null);
  
  const { 
    loading, 
    error, 
    searchIntegrated, 
    searchDirect, 
    searchContract,
    getTotalCount 
  } = useBiIndexing();

  const handleIntegratedSearch = async () => {
    try {
      const response = await searchIntegrated(purpose, network);
      setResults(response.data);
    } catch (err) {
      console.error('통합 검색 실패:', err);
    }
  };

  const handleDirectSearch = async () => {
    try {
      const response = await searchDirect(purpose, network);
      setResults(response.data);
    } catch (err) {
      console.error('직접 검색 실패:', err);
    }
  };

  const handleContractSearch = async () => {
    try {
      const response = await searchContract(purpose, 100, network);
      setResults(response.data);
    } catch (err) {
      console.error('컨트랙트 검색 실패:', err);
    }
  };

  const handleGetTotalCount = async () => {
    try {
      const response = await getTotalCount(network);
      setResults(response.data);
    } catch (err) {
      console.error('총 개수 조회 실패:', err);
    }
  };

  return (
    <div style={{ padding: '20px', fontFamily: 'Arial, sans-serif' }}>
      <h1>🔍 BI-Indexing Search Interface</h1>
      
      {/* 검색 설정 */}
      <div style={{ marginBottom: '20px', padding: '15px', border: '1px solid #ddd', borderRadius: '5px' }}>
        <h3>검색 설정</h3>
        <div style={{ marginBottom: '10px' }}>
          <label>목적 (Purpose): </label>
          <select 
            value={purpose} 
            onChange={(e) => setPurpose(e.target.value)}
            style={{ marginLeft: '10px', padding: '5px' }}
          >
            <option value="수면">수면</option>
            <option value="심박수">심박수</option>
            <option value="혈압">혈압</option>
          </select>
        </div>
        
        <div style={{ marginBottom: '10px' }}>
          <label>네트워크: </label>
          <select 
            value={network} 
            onChange={(e) => setNetwork(e.target.value)}
            style={{ marginLeft: '10px', padding: '5px' }}
          >
            <option value="hardhat-local">Hardhat Local</option>
            <option value="monad">Monad Testnet</option>
          </select>
        </div>
      </div>

      {/* 검색 버튼들 */}
      <div style={{ marginBottom: '20px' }}>
        <button 
          onClick={handleIntegratedSearch} 
          disabled={loading}
          style={{ marginRight: '10px', padding: '10px 15px', backgroundColor: '#007bff', color: 'white', border: 'none', borderRadius: '5px', cursor: 'pointer' }}
        >
          🚀 통합 검색 (인덱스 + 블록체인)
        </button>
        
        <button 
          onClick={handleDirectSearch} 
          disabled={loading}
          style={{ marginRight: '10px', padding: '10px 15px', backgroundColor: '#28a745', color: 'white', border: 'none', borderRadius: '5px', cursor: 'pointer' }}
        >
          🔗 블록체인 직접 검색
        </button>
        
        <button 
          onClick={handleContractSearch} 
          disabled={loading}
          style={{ marginRight: '10px', padding: '10px 15px', backgroundColor: '#ffc107', color: 'black', border: 'none', borderRadius: '5px', cursor: 'pointer' }}
        >
          📊 컨트랙트 필터링 검색
        </button>
        
        <button 
          onClick={handleGetTotalCount} 
          disabled={loading}
          style={{ padding: '10px 15px', backgroundColor: '#6c757d', color: 'white', border: 'none', borderRadius: '5px', cursor: 'pointer' }}
        >
          📈 총 요청 개수
        </button>
      </div>

      {/* 로딩 상태 */}
      {loading && (
        <div style={{ padding: '20px', textAlign: 'center', backgroundColor: '#f8f9fa', border: '1px solid #dee2e6', borderRadius: '5px' }}>
          <p>🔄 검색 중...</p>
        </div>
      )}

      {/* 에러 상태 */}
      {error && (
        <div style={{ padding: '15px', backgroundColor: '#f8d7da', border: '1px solid #f5c6cb', borderRadius: '5px', color: '#721c24' }}>
          <h4>❌ 오류 발생</h4>
          <p>{error}</p>
        </div>
      )}

      {/* 검색 결과 */}
      {results && !loading && (
        <div style={{ marginTop: '20px', padding: '15px', border: '1px solid #ddd', borderRadius: '5px' }}>
          <h3>📋 검색 결과</h3>
          
          {/* 결과 요약 */}
          <div style={{ marginBottom: '15px', padding: '10px', backgroundColor: '#e7f3ff', borderRadius: '5px' }}>
            <p><strong>검색 방법:</strong> {results.method}</p>
            <p><strong>네트워크:</strong> {results.network}</p>
            {results.purpose && <p><strong>목적:</strong> {results.purpose}</p>}
            {results.totalCount !== undefined && <p><strong>총 개수:</strong> {results.totalCount}</p>}
            {results.processingTime && <p><strong>처리 시간:</strong> {results.processingTime}</p>}
          </div>

          {/* 트랜잭션 목록 */}
          {results.transactions && results.transactions.length > 0 && (
            <div>
              <h4>💎 트랜잭션 목록 ({results.transactions.length}개)</h4>
              <div style={{ maxHeight: '400px', overflowY: 'auto' }}>
                {results.transactions.slice(0, 10).map((tx, index) => (
                  <div key={index} style={{ padding: '10px', margin: '5px 0', border: '1px solid #eee', borderRadius: '3px', fontSize: '14px' }}>
                    <p><strong>TX ID:</strong> <code style={{ backgroundColor: '#f8f9fa', padding: '2px 4px' }}>{tx.txId}</code></p>
                    <p><strong>목적:</strong> {tx.purpose} | <strong>조직:</strong> {tx.organizationName}</p>
                    <p><strong>요청자:</strong> <code>{tx.resourceOwner?.slice(0, 10)}...{tx.resourceOwner?.slice(-8)}</code></p>
                    <p><strong>블록 번호:</strong> {tx.blockNumber} | <strong>상태:</strong> <span style={{ color: tx.status === 'success' ? 'green' : 'red' }}>{tx.status}</span></p>
                    <p><strong>일시:</strong> {new Date(tx.date).toLocaleString()}</p>
                  </div>
                ))}
                {results.transactions.length > 10 && (
                  <p style={{ textAlign: 'center', color: '#666', fontStyle: 'italic' }}>
                    ... 그리고 {results.transactions.length - 10}개 더
                  </p>
                )}
              </div>
            </div>
          )}

          {/* 요청 목록 (컨트랙트 검색 결과) */}
          {results.requests && results.requests.length > 0 && (
            <div>
              <h4>📋 요청 목록 ({results.requests.length}개)</h4>
              <div style={{ maxHeight: '400px', overflowY: 'auto' }}>
                {results.requests.slice(0, 10).map((req, index) => (
                  <div key={index} style={{ padding: '10px', margin: '5px 0', border: '1px solid #eee', borderRadius: '3px', fontSize: '14px' }}>
                    <p><strong>Request ID:</strong> {req.requestId}</p>
                    <p><strong>목적:</strong> {req.purpose} | <strong>조직:</strong> {req.organizationName}</p>
                    <p><strong>요청자:</strong> <code>{req.requester?.slice(0, 10)}...{req.requester?.slice(-8)}</code></p>
                    <p><strong>데이터 소유자:</strong> <code>{req.resourceOwner?.slice(0, 10)}...{req.resourceOwner?.slice(-8)}</code></p>
                    <p><strong>상태:</strong> {req.status}</p>
                  </div>
                ))}
                {results.requests.length > 10 && (
                  <p style={{ textAlign: 'center', color: '#666', fontStyle: 'italic' }}>
                    ... 그리고 {results.requests.length - 10}개 더
                  </p>
                )}
              </div>
            </div>
          )}

          {/* Raw JSON 데이터 */}
          <details style={{ marginTop: '15px' }}>
            <summary style={{ cursor: 'pointer', fontWeight: 'bold' }}>🔍 Raw JSON 데이터 보기</summary>
            <pre style={{ backgroundColor: '#f8f9fa', padding: '10px', borderRadius: '5px', overflow: 'auto', fontSize: '12px' }}>
              {JSON.stringify(results, null, 2)}
            </pre>
          </details>
        </div>
      )}
    </div>
  );
};

export default BiIndexingExample;