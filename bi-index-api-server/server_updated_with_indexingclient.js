// server.js의 blockchain-search API 부분을 IndexingClient 사용하도록 수정

app.get('/api/blockchain-search', async (req, res) => {
  const startTime = Date.now();
  
  try {
    let { network, purpose, indexed = 'true', ...customFilters } = req.query;
    
    // URL 디코딩 처리
    if (purpose) purpose = decodeURIComponent(purpose);
    if (network) network = decodeURIComponent(network);
    
    // 필수 파라미터 검증
    if (!network) {
      return res.status(400).json({
        success: false,
        error: 'network 파라미터가 필요합니다',
        example: '/api/blockchain-search?network=hardhat-local&purpose=혈압&indexed=true'
      });
    }
    
    if (!purpose) {
      return res.status(400).json({
        success: false,
        error: 'purpose 파라미터가 필요합니다',
        example: '/api/blockchain-search?network=hardhat-local&purpose=혈압&indexed=true'
      });
    }
    
    const useIndexed = indexed === 'true';
    console.log(`🔍 검색 시작: ${purpose} (인덱스: ${useIndexed ? 'ON' : 'OFF'})`);
    
    // IndexingClient 생성
    const IndexingClient = require('../bi-indexing-gateway/lib/indexing-client');
    const indexingClient = new IndexingClient({
      serverAddr: 'localhost:50052',
      protoPath: require('path').join(__dirname, '../idxmngr-go/protos/index_manager.proto')
    });
    
    let result;
    
    if (useIndexed) {
      // ======================
      // 인덱스 기반 검색 (IndexingClient 사용)
      // ======================
      console.log(`📊 인덱스 기반 검색: ${purpose}`);
      
      try {
        result = await indexingClient.searchBlockchainAndIndex(
          purpose,
          network,
          '0x5FbDB2315678afecb367f032d93F642f64180aa3'
        );
        
        // 응답 형식 맞추기
        result.indexed = true;
        result.processingTime = `${Date.now() - startTime}ms`;
        result.timestamp = new Date().toISOString();
        
      } catch (error) {
        console.error(`❌ 인덱스 기반 검색 실패:`, error.message);
        return res.status(500).json({
          success: false,
          error: error.message,
          method: 'indexed-search',
          timestamp: new Date().toISOString()
        });
      }
      
    } else {
      // ======================
      // 블록체인 직접 검색 (IndexingClient 사용)
      // ======================
      console.log(`🔗 블록체인 직접 검색: ${purpose}`);
      
      try {
        result = await indexingClient.searchBlockchainDirect(
          purpose,
          network,
          '0x5FbDB2315678afecb367f032d93F642f64180aa3'
        );
        
        // 응답 형식 맞추기
        result.indexed = false;
        result.processingTime = `${Date.now() - startTime}ms`;
        result.timestamp = new Date().toISOString();
        
      } catch (error) {
        console.error(`❌ 블록체인 직접 검색 실패:`, error.message);
        return res.status(500).json({
          success: false,
          error: error.message,
          method: 'blockchain-direct',
          timestamp: new Date().toISOString()
        });
      }
    }
    
    // 연결 정리
    await indexingClient.close();
    
    // 응답 반환
    res.json(result);
    
  } catch (error) {
    console.error('❌ 블록체인 검색 실패:', error);
    res.status(500).json({
      success: false,
      error: error.message,
      timestamp: new Date().toISOString()
    });
  }
});

// 사용 예시:
// GET http://localhost:3001/api/blockchain-search?network=hardhat-local&purpose=혈압&indexed=true
// → indexingClient.searchBlockchainAndIndex() 호출

// GET http://localhost:3001/api/blockchain-search?network=hardhat-local&purpose=혈압&indexed=false  
// → indexingClient.searchBlockchainDirect() 호출
