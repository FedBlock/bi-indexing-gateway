import React from 'react';
import useBiIndexing from '../hooks/useBiIndexing';

/**
 * BiIndexing 컴포넌트 - 즉시 사용 가능한 검색 인터페이스
 */
const BiIndexing = ({ 
  className = '', 
  style = {},
  config = {},
  onResults = () => {},
  onError = () => {} 
}) => {
  const [purpose, setPurpose] = React.useState('');
  const [network, setNetwork] = React.useState('hardhat-local');
  const [searchMethod, setSearchMethod] = React.useState('integrated');
  const [results, setResults] = React.useState(null);

  const { 
    loading, 
    error, 
    searchIntegrated, 
    searchDirect, 
    searchContract 
  } = useBiIndexing(config);

  const handleSearch = async () => {
    if (!purpose.trim()) {
      alert('검색할 목적을 입력해주세요.');
      return;
    }

    try {
      let response;
      const options = { network };
      
      switch (searchMethod) {
        case 'integrated':
          response = await searchIntegrated(purpose, options);
          break;
        case 'direct':
          response = await searchDirect(purpose, options);
          break;
        case 'contract':
          response = await searchContract(purpose, options);
          break;
        default:
          response = await searchIntegrated(purpose, options);
      }
      
      setResults(response.data);
      onResults(response.data);
    } catch (err) {
      console.error('검색 실패:', err);
      onError(err);
    }
  };

  const handleClear = () => {
    setResults(null);
    setPurpose('');
  };

  return (
    <div className={`bi-indexing-search ${className}`} style={style}>
      {/* 검색 폼 */}
      <div className="search-form" style={{ marginBottom: '20px', padding: '15px', border: '1px solid #ddd', borderRadius: '8px' }}>
        <div style={{ display: 'flex', gap: '10px', alignItems: 'center', flexWrap: 'wrap' }}>
          <input
            type="text"
            placeholder="검색할 목적을 입력하세요 (예: 수면, 심박수, 혈압)"
            value={purpose}
            onChange={(e) => setPurpose(e.target.value)}
            style={{ 
              flex: '1', 
              minWidth: '200px',
              padding: '8px 12px', 
              border: '1px solid #ccc', 
              borderRadius: '4px',
              fontSize: '14px'
            }}
            onKeyPress={(e) => e.key === 'Enter' && handleSearch()}
          />
          
          <select
            value={searchMethod}
            onChange={(e) => setSearchMethod(e.target.value)}
            style={{ padding: '8px', borderRadius: '4px', border: '1px solid #ccc' }}
          >
            <option value="integrated">🚀 통합 검색</option>
            <option value="direct">🔗 직접 검색</option>
            <option value="contract">📊 컨트랙트 검색</option>
          </select>
          
          <select
            value={network}
            onChange={(e) => setNetwork(e.target.value)}
            style={{ padding: '8px', borderRadius: '4px', border: '1px solid #ccc' }}
          >
            <option value="hardhat-local">Hardhat Local</option>
            <option value="monad">Monad Testnet</option>
          </select>
          
          <button
            onClick={handleSearch}
            disabled={loading || !purpose.trim()}
            style={{
              padding: '8px 16px',
              backgroundColor: loading ? '#6c757d' : '#007bff',
              color: 'white',
              border: 'none',
              borderRadius: '4px',
              cursor: loading ? 'not-allowed' : 'pointer',
              fontSize: '14px'
            }}
          >
            {loading ? '검색 중...' : '검색'}
          </button>
          
          {results && (
            <button
              onClick={handleClear}
              style={{
                padding: '8px 16px',
                backgroundColor: '#6c757d',
                color: 'white',
                border: 'none',
                borderRadius: '4px',
                cursor: 'pointer',
                fontSize: '14px'
              }}
            >
              지우기
            </button>
          )}
        </div>
      </div>

      {/* 에러 표시 */}
      {error && (
        <div style={{ 
          padding: '12px', 
          backgroundColor: '#f8d7da', 
          border: '1px solid #f5c6cb', 
          borderRadius: '4px', 
          color: '#721c24',
          marginBottom: '20px'
        }}>
          <strong>❌ 오류:</strong> {error}
        </div>
      )}

      {/* 검색 결과 */}
      {results && !loading && (
        <div style={{ padding: '15px', border: '1px solid #ddd', borderRadius: '8px' }}>
          <div style={{ 
            display: 'flex', 
            justifyContent: 'space-between', 
            alignItems: 'center', 
            marginBottom: '15px',
            paddingBottom: '10px',
            borderBottom: '1px solid #eee'
          }}>
            <h3 style={{ margin: 0 }}>📋 검색 결과</h3>
            <div style={{ fontSize: '12px', color: '#666' }}>
              {results.processingTime && `처리 시간: ${results.processingTime}`}
            </div>
          </div>

          {/* 결과 요약 */}
          <div style={{ 
            display: 'flex', 
            gap: '15px', 
            marginBottom: '15px', 
            fontSize: '14px',
            flexWrap: 'wrap'
          }}>
            <span><strong>방법:</strong> {results.method}</span>
            <span><strong>네트워크:</strong> {results.network}</span>
            {results.purpose && <span><strong>목적:</strong> {results.purpose}</span>}
            {results.totalCount !== undefined && <span><strong>총 개수:</strong> {results.totalCount}</span>}
          </div>

          {/* 트랜잭션 또는 요청 목록 */}
          {(results.transactions?.length > 0 || results.requests?.length > 0) ? (
            <div style={{ maxHeight: '400px', overflowY: 'auto' }}>
              {results.transactions?.map((tx, index) => (
                <div key={index} style={{ 
                  padding: '10px', 
                  margin: '5px 0', 
                  border: '1px solid #eee', 
                  borderRadius: '4px',
                  fontSize: '13px',
                  backgroundColor: '#f8f9fa'
                }}>
                  <div style={{ fontWeight: 'bold', marginBottom: '5px' }}>
                    TX: {tx.txId?.slice(0, 20)}...
                  </div>
                  <div>목적: {tx.purpose} | 조직: {tx.organizationName}</div>
                  <div>블록: {tx.blockNumber} | 상태: {tx.status}</div>
                </div>
              ))}
              
              {results.requests?.map((req, index) => (
                <div key={index} style={{ 
                  padding: '10px', 
                  margin: '5px 0', 
                  border: '1px solid #eee', 
                  borderRadius: '4px',
                  fontSize: '13px',
                  backgroundColor: '#f8f9fa'
                }}>
                  <div style={{ fontWeight: 'bold', marginBottom: '5px' }}>
                    Request ID: {req.requestId}
                  </div>
                  <div>목적: {req.purpose} | 조직: {req.organizationName}</div>
                  <div>상태: {req.status}</div>
                </div>
              ))}
            </div>
          ) : (
            <div style={{ 
              textAlign: 'center', 
              padding: '20px', 
              color: '#666',
              fontStyle: 'italic'
            }}>
              검색 결과가 없습니다.
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default BiIndexing;