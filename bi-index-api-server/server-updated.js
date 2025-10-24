const express = require('express');
const cors = require('cors');
const path = require('path');
const INDEXING_CLIENT_PATH = path.resolve(__dirname, '../../bi-indexing-gateway/lib/indexing-client');
const IndexingClient = require(INDEXING_CLIENT_PATH);

const app = express();
app.use(cors());
app.use(express.json());

// =========================
// Blockchain Search API (Enhanced)
// =========================
app.get('/api/blockchain-search', async (req, res) => {
  const startTime = Date.now();
  
  try {
    let { 
      network, 
      purpose, 
      indexed = 'true',
      batchSize = '1',           // 🚀 NEW: 배치 크기
      adaptiveBatch = 'false',    // 🚀 NEW: 
      maxBatchSize = '100',        // 🚀 NEW: 최대 배치 크기
      minBatchSize = '',         // 🚀 NEW: 최소 배치 크기
      ...customFilters 
    } = req.query;
    
    // URL 디코딩 처리
    if (purpose) purpose = decodeURIComponent(purpose);
    if (network) network = decodeURIComponent(network);
    
    // 🚀 성능 파라미터 파싱
    const parsedBatchSize = Math.max(1, Math.min(parseInt(batchSize) || 10, 100));
    const parsedAdaptiveBatch = adaptiveBatch === 'true';
    const parsedMaxBatchSize = Math.max(parsedBatchSize, parseInt(maxBatchSize) || 50);
    const parsedMinBatchSize = Math.max(1, Math.min(parseInt(minBatchSize) || 5, parsedBatchSize));
    
    // 필수 파라미터 검증
    if (!network) {
      return res.status(400).json({
        success: false,
        error: 'network 파라미터가 필요합니다',
        example: '/api/blockchain-search?network=hardhat-local&purpose=혈압&indexed=true&batchSize=15'
      });
    }
    
    if (!purpose) {
      return res.status(400).json({
        success: false,
        error: 'purpose 파라미터가 필요합니다',
        example: '/api/blockchain-search?network=hardhat-local&purpose=혈압&indexed=true&batchSize=15'
      });
    }
    
    const useIndexed = indexed === 'true';
    console.log(`\n🔍 ===== 검색 시작 =====`);
    console.log(`📝 Purpose: ${purpose}`);
    console.log(`🌐 Network: ${network}`);
    console.log(`⚡ 방식: ${useIndexed ? '인덱스 기반 (빠름)' : '블록체인 직접 (느림)'}`);
    console.log(`📊 배치 크기: ${parsedBatchSize}`);
    console.log(`🔄 적응형 배치: ${parsedAdaptiveBatch ? 'ON' : 'OFF'}`);
    if (parsedAdaptiveBatch) {
      console.log(`📈 배치 범위: ${parsedMinBatchSize} ~ ${parsedMaxBatchSize}`);
    }
    console.log(`⏰ 시작 시간: ${new Date().toISOString()}`);
    
    // 🚀 향상된 IndexingClient 생성 (성능 옵션 포함)
    const clientCreateStart = Date.now();
    const indexingClient = new IndexingClient({
      serverAddr: 'localhost:50052',
      protoPath: path.join(__dirname, '../idxmngr-go/protos/index_manager.proto'),
      batchSize: parsedBatchSize,
      adaptiveBatch: parsedAdaptiveBatch,
      maxBatchSize: parsedMaxBatchSize,
      minBatchSize: parsedMinBatchSize
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
        
        // 🚀 성능 정보 추가
        result.performanceConfig = {
          batchSize: parsedBatchSize,
          adaptiveBatch: parsedAdaptiveBatch,
          batchRange: parsedAdaptiveBatch ? `${parsedMinBatchSize}-${parsedMaxBatchSize}` : null
        };
        
        // 성능 통계 추가
        const perfStats = indexingClient.getPerformanceStats();
        if (perfStats.avgThroughput) {
          result.performanceStats = perfStats;
        }
        
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
        
        // 🚀 성능 정보 추가
        result.performanceConfig = {
          batchSize: parsedBatchSize,
          adaptiveBatch: parsedAdaptiveBatch,
          batchRange: parsedAdaptiveBatch ? `${parsedMinBatchSize}-${parsedMaxBatchSize}` : null
        };
        
        // 성능 통계 추가
        const perfStats = indexingClient.getPerformanceStats();
        if (perfStats.avgThroughput) {
          result.performanceStats = perfStats;
        }
        
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
    console.log(`📊 사용된 배치 크기: ${parsedBatchSize}`);
    if (result.performanceStats && result.performanceStats.avgThroughput) {
      console.log(`🚀 평균 처리 속도: ${result.performanceStats.avgThroughput} items/sec`);
    }
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
// 성능 설정 조회 API (NEW)
// =========================
app.get('/api/performance-config', (req, res) => {
  res.json({
    success: true,
    defaultConfig: {
      batchSize: 10,
      adaptiveBatch: false,
      maxBatchSize: 50,
      minBatchSize: 5
    },
    limits: {
      maxBatchSize: 100,
      minBatchSize: 1
    },
    description: {
      batchSize: "동시 처리할 트랜잭션 수 (1-100)",
      adaptiveBatch: "성능에 따른 자동 배치 크기 조정 (true/false)",
      maxBatchSize: "적응형 배치 최대 크기",
      minBatchSize: "적응형 배치 최소 크기"
    },
    examples: [
      "/api/blockchain-search?network=hardhat-local&purpose=수면&batchSize=20",
      "/api/blockchain-search?network=hardhat-local&purpose=수면&batchSize=15&adaptiveBatch=true",
      "/api/blockchain-search?network=hardhat-local&purpose=수면&adaptiveBatch=true&minBatchSize=5&maxBatchSize=30"
    ]
  });
});

// =========================
// 서버 시작
// =========================

const PORT = process.env.PORT || 3001;
app.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 BI-Index API Server running on port ${PORT}`);
  console.log(`📡 서버 주소: http://192.168.10.30:${PORT}`);
  console.log(`📡 API 엔드포인트:`);
  console.log(`   - GET /api/blockchain-search (메인 검색 API)`);
  console.log(`   - GET /api/performance-config (성능 설정 정보)`);
  console.log('');
  console.log('🚀 향상된 성능 제어 API 사용법:');
  console.log(`  기본 검색:`);
  console.log(`    GET /api/blockchain-search?network=hardhat-local&purpose=수면&indexed=true`);
  console.log(`  배치 크기 조정:`);
  console.log(`    GET /api/blockchain-search?network=hardhat-local&purpose=수면&batchSize=20`);
  console.log(`  적응형 배치:`);
  console.log(`    GET /api/blockchain-search?network=hardhat-local&purpose=수면&adaptiveBatch=true`);
  console.log(`  고급 성능 튜닝:`);
  console.log(`    GET /api/blockchain-search?network=hardhat-local&purpose=수면&batchSize=15&adaptiveBatch=true&minBatchSize=5&maxBatchSize=30`);
});
