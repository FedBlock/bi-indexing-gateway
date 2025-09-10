const express = require('express');
const cors = require('cors');
const path = require('path');
const IndexingClient = require('../bi-indexing-gateway/lib/indexing-client');

const app = express();
app.use(cors());
app.use(express.json());

// =========================
// Blockchain Search API
// =========================로그글ㅡㄹ 추가가
app.get('/api/blockchain-search', async (req, res) => {
  const startTime = Date.now();
  
  try {
    let { network, purpose, indexed = 'true', ...customFilters } = req.query;
    
    // URL 디코딩 처리
    if (purpose) purpose = decodeURIComponent(purpose);
    if (network) network = decodeURIComponent(network);
    
    // 필수 파라미터 검증왜 닿닿제먼저 해결결
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
    console.log(`\n🔍 ===== 검색 시작 =====`);
    console.log(`📝 Purpose: ${purpose}`);
    console.log(`🌐 Network: ${network}`);
    console.log(`⚡ 방식: ${useIndexed ? '인덱스 기반 (빠름)' : '블록체인 직접 (느림)'}`);
    console.log(`⏰ 시작 시간: ${new Date().toISOString()}`);
    
    // IndexingClient 생성
    const clientCreateStart = Date.now();
    const indexingClient = new IndexingClient({
      serverAddr: 'localhost:50052',
      protoPath: path.join(__dirname, '../idxmngr-go/protos/index_manager.proto')
    });
    
    // gRPC 연결
    const connectStart = Date.now();
    await indexingClient.connect();
    const connectTime = Date.now() - connectStart;
    console.log(`🔌 gRPC 연결 시간: ${connectTime}ms`);
    
    let result;
    
    if (useIndexed) {
      // ======================
      // 인덱스 기반 검색 (IndexingClient 사용)
      // ======================
      console.log(`📊 인덱스 기반 검색 시작...`);
      const indexSearchStart = Date.now();
      
      try {
        result = await indexingClient.searchBlockchainAndIndex(
          purpose,
          network,
          '0x5FbDB2315678afecb367f032d93F642f64180aa3'
        );
        
        const indexSearchTime = Date.now() - indexSearchStart;
        console.log(`✅ 인덱스 검색 완료! 소요시간: ${indexSearchTime}ms`);
        
        // 응답 형식 맞추기
        result.indexed = true;
        result.processingTime = `${Date.now() - startTime}ms`;
        result.indexSearchTime = `${indexSearchTime}ms`;
        result.timestamp = new Date().toISOString();
        
      } catch (error) {
        console.error(`❌ 인덱스 기반 검색 실패:`, error.message);
        await indexingClient.close();
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
      console.log(`🔗 블록체인 직접 검색 시작...`);
      const directSearchStart = Date.now();
      
      try {
        result = await indexingClient.searchBlockchainDirect(
          purpose,
          network,
          '0x5FbDB2315678afecb367f032d93F642f64180aa3'
        );
        
        const directSearchTime = Date.now() - directSearchStart;
        console.log(`✅ 블록체인 직접 검색 완료! 소요시간: ${directSearchTime}ms`);
        
        // 응답 형식 맞추기
        result.indexed = false;
        result.processingTime = `${Date.now() - startTime}ms`;
        result.directSearchTime = `${directSearchTime}ms`;
        result.timestamp = new Date().toISOString();
        
      } catch (error) {
        console.error(`❌ 블록체인 직접 검색 실패:`, error.message);
        await indexingClient.close();
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
    
    // 최종 결과 로그
    const totalTime = Date.now() - startTime;
    console.log(`\n📊 ===== 검색 완료 =====`);
    console.log(`⏰ 전체 소요시간: ${totalTime}ms`);
    console.log(`📝 결과 개수: ${result.totalCount || 0}개`);
    console.log(`✅ 성공: ${result.success}`);
    console.log(`⏰ 완료 시간: ${new Date().toISOString()}`);
    console.log('=' .repeat(30));
    
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

// =========================
// 서버 시작
// =========================

const PORT = process.env.PORT || 3001;
app.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 BI-Index API Server running on port ${PORT}`);
  console.log(`📡 서버 주소: http://192.168.10.30:${PORT}`);
  console.log(`📡 API 엔드포인트:`);
  console.log(`   - GET /api/blockchain-search?network=hardhat-local&purpose=혈압&indexed=true`);
  console.log(`   - GET /api/blockchain-search?network=hardhat-local&purpose=혈압&indexed=false`);
  console.log('');
  console.log('📋 통합 검색 API 사용법:');
  console.log(`  GET http://192.168.10.30:${PORT}/api/blockchain-search?network=hardhat-local&purpose=수면&indexed=true   (인덱스 검색 - 빠름)`);
  console.log(`  GET http://192.168.10.30:${PORT}/api/blockchain-search?network=hardhat-local&purpose=수면&indexed=false  (블록체인 직접 - 느림)`);
});