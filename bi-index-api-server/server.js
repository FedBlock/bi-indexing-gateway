const express = require('express');
const cors = require('cors');
const path = require('path');
const INDEXING_CLIENT_PATH = path.resolve(__dirname, '../../bi-indexing-gateway/lib/indexing-client');
// bi-indexing-gateway를 bi-index 루트 밖(동일 상위 디렉터리)으로 이동해도 참조할 수 있도록 절대 경로로 변환한다
// (__dirname = bi-index/bi-index-api-server, ../../ = bi-index-migration)
const IndexingClient = require(INDEXING_CLIENT_PATH);

const app = express();
app.use(cors());
app.use(express.json());

// =========================
// 🔍 통합 블록체인 검색 API (3가지 방식 지원)
// - indexed=true: 인덱스 파일에서 txId 조회 후 상세 정보 가져오기
// - indexed=false: 컨트랙트 매핑에서 직접 조회 (requestId → requestDetail)
// - indexed=event: 블록체인에서 이벤트 로그 직접 검색 (이벤트 인덱스 사용)
// - 특정 purpose로 필터링 또는 전체 데이터 조회
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
      minBatchSize = '1',         // 🚀 NEW: 최소 배치 크기
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
    
    // 필수 파라미터 검증 - indexed=false는 network 없어도 됨 (기본값 사용)
    if (!network && indexed !== 'false') {
      return res.status(400).json({
        success: false,
        error: 'network 파라미터가 필요합니다',
        example: '/api/blockchain-search?network=hardhat-local&purpose=혈압&indexed=true&batchSize=15'
      });
    }
    
    // indexed=false가 아닐 때만 purpose 필수
    if (!purpose && indexed !== 'false') {
      return res.status(400).json({
        success: false,
        error: 'purpose 파라미터가 필요합니다',
        example: '/api/blockchain-search?network=hardhat-local&purpose=혈압&indexed=true&batchSize=15'
      });
    }
    
    const useIndexed = indexed === 'true';
    const useDirectContract = indexed === 'false';  // 🔄 변경: false = 직접 조회
    const useEventBased = indexed === 'event';      // 🔄 변경: event = 이벤트 로그
    
    // 기본 네트워크 설정
    const targetNetwork = network || 'hardhat-local';
    
    console.log(`\n🔍 ===== 검색 시작 =====`);
    if (purpose) console.log(`📝 Purpose: ${purpose}`);
    console.log(`🌐 Network: ${targetNetwork}`);
    console.log(`⚡ 방식: ${useIndexed ? '인덱스 기반 (빠름)' : useDirectContract ? '컨트랙트 직접 조회 (진짜 인덱스 없음)' : '이벤트 로그 검색 (이벤트 인덱스 사용)'}`);
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
          targetNetwork,
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
      
    } else if (useDirectContract) {
      // ======================
      // 🔄 컨트랙트 직접 조회 (진짜 인덱스 없음) - indexed=false
      // ======================
      console.log(`🔗 컨트랙트 직접 조회 시작... (진짜 인덱스 없음)`);
      const directSearchStart = Date.now();
      
      try {
        if (purpose) {
          // purpose 필터링 조회 - network 파라미터 전달
          result = await indexingClient.getFilteredRequestsByPurpose(purpose, parsedBatchSize, targetNetwork);
        } else {
          // 전체 조회 - network 파라미터 전달
          result = await indexingClient.getAllRequestsWithPaging(parsedBatchSize, targetNetwork);
        }
        
        const directSearchTime = Date.now() - directSearchStart;
        console.log(`✅ 컨트랙트 직접 조회 완료! 소요시간: ${directSearchTime}ms`);
        
        // 응답 형식 맞추기
        result.indexed = false;  // 진짜 인덱스 없음
        result.network = targetNetwork;
        result.processingTime = `${Date.now() - startTime}ms`;
        result.directSearchTime = `${directSearchTime}ms`;
        result.timestamp = new Date().toISOString();
        
        // 🚀 성능 정보 추가
        result.performanceConfig = {
          batchSize: parsedBatchSize,
          adaptiveBatch: parsedAdaptiveBatch,
          batchRange: parsedAdaptiveBatch ? `${parsedMinBatchSize}-${parsedMaxBatchSize}` : null
        };
        
      } catch (error) {
        console.error(`❌ 컨트랙트 직접 조회 실패:`, error.message);
        await indexingClient.close();
        return res.status(500).json({
          success: false,
          error: error.message,
          method: 'contract-direct',
          timestamp: new Date().toISOString()
        });
      }
      
    } else if (useEventBased) {
      // ======================
      // 🔄 이벤트 로그 검색 (이벤트 인덱스 사용) - indexed=event
      // ======================
      console.log(`🔗 이벤트 로그 검색 시작... (이벤트 인덱스 사용)`);
      const eventSearchStart = Date.now();
      
      try {
        result = await indexingClient.searchBlockchainDirect(
          purpose,
          targetNetwork,
          '0x5FbDB2315678afecb367f032d93F642f64180aa3'
        );
        
        const eventSearchTime = Date.now() - eventSearchStart;
        console.log(`✅ 이벤트 로그 검색 완료! 소요시간: ${eventSearchTime}ms`);
        
        // 응답 형식 맞추기
        result.indexed = 'event';  // 이벤트 인덱스 사용
        result.processingTime = `${Date.now() - startTime}ms`;
        result.eventSearchTime = `${eventSearchTime}ms`;
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
        console.error(`❌ 이벤트 로그 검색 실패:`, error.message);
        await indexingClient.close();
        return res.status(500).json({
          success: false,
          error: error.message,
          method: 'event-search',
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
// 🔗 방식 2: 컨트랙트 직접 조회 API
// - 컨트랙트 매핑에서 requestId → requestDetail 직접 조회
// - 페이징 지원으로 대량 데이터 안전 조회
// - getAllData=true: 전체 데이터 조회
// - startId & endId: 범위별 조회
// =========================
app.get('/api/blockchain-direct', async (req, res) => {
  const startTime = Date.now();
  
  try {
    let { 
      pageSize = '100',
      startId,
      endId,
      getAllData = 'false'
    } = req.query;
    
    const parsedPageSize = Math.max(1, Math.min(parseInt(pageSize) || 100, 500));
    const useGetAllData = getAllData === 'true';
    
    console.log(`\n🔗 ===== 블록체인 직접 조회 시작 =====`);
    console.log(`📊 페이지 크기: ${parsedPageSize}`);
    console.log(`📋 전체 조회: ${useGetAllData ? 'YES' : 'NO'}`);
    if (startId && endId) {
      console.log(`📄 지정 범위: ${startId} ~ ${endId}`);
    }
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
    
    try {
      const directQueryStart = Date.now();
      
      if (useGetAllData) {
        // 전체 데이터 조회 (페이징 방식)
        result = await indexingClient.getAllRequestsWithPaging(parsedPageSize);
      } else if (startId && endId) {
        // 지정 범위 조회
        result = await indexingClient.getRequestsInRange(parseInt(startId), parseInt(endId));
      } else {
        // 기본: 첫 페이지 조회
        result = await indexingClient.getRequestsInRange(1, parsedPageSize);
      }
      
      const directQueryTime = Date.now() - directQueryStart;
      console.log(`✅ 블록체인 직접 조회 완료! 소요시간: ${directQueryTime}ms`);
      
      // 응답 형식 맞추기
      result.success = true;
      result.method = 'blockchain-direct-query';
      result.processingTime = `${Date.now() - startTime}ms`;
      result.directQueryTime = `${directQueryTime}ms`;
      result.timestamp = new Date().toISOString();
      result.queryType = useGetAllData ? 'all-data' : (startId && endId ? 'range-query' : 'first-page');
      
    } catch (error) {
      console.error(`❌ 블록체인 직접 조회 실패:`, error.message);
      await indexingClient.close();
      return res.status(500).json({
        success: false,
        error: error.message,
        method: 'blockchain-direct-query',
        timestamp: new Date().toISOString()
      });
    }
    
    // 연결 정리
    await indexingClient.close();
    
    // 최종 결과 로그
    const totalTime = Date.now() - startTime;
    console.log(`\n📊 ===== 직접 조회 완료 =====`);
    console.log(`⏰ 전체 소요시간: ${totalTime}ms`);
    console.log(`📝 결과 개수: ${result.totalCount || result.requests?.length || 0}개`);
    console.log(`✅ 성공: ${result.success}`);
    console.log(`⏰ 완료 시간: ${new Date().toISOString()}`);
    console.log('=' .repeat(30));
    
    // 응답 반환
    res.json(result);
    
  } catch (error) {
    console.error('❌ 블록체인 직접 조회 실패:', error);
    res.status(500).json({
      success: false,
      error: error.message,
      timestamp: new Date().toISOString()
    });
  }
});

// =========================
// ⚙️ 방식 3: 성능 설정 및 메타데이터 API
// - 시스템 설정 정보 조회
// - 배치 크기, 성능 튜닝 정보 제공
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
      "/api/blockchain-search?network=hardhat-local&purpose=수면&indexed=true&batchSize=20",
      "/api/blockchain-search?purpose=수면&indexed=false&batchSize=100",
      "/api/blockchain-search?network=hardhat-local&purpose=수면&indexed=event&batchSize=50"
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
  console.log(`   🔍 방식 1: GET /api/blockchain-search (통합 검색 - 3가지 방식 지원)`);
  console.log(`   🔗 방식 2: GET /api/blockchain-direct (컨트랙트 직접 조회)`);
  console.log('');
  console.log('🔍 통합 검색 API 사용법:');
  console.log(`  📊 인덱스 기반 (빠름):`);
  console.log(`    GET /api/blockchain-search?network=hardhat-local&purpose=수면&indexed=true`);
  console.log(`  🔗 컨트랙트 직접 조회 (진짜 인덱스 없음):`);
  console.log(`    GET /api/blockchain-search?network=hardhat-local&purpose=수면&indexed=false&batchSize=100`);
  console.log(`    GET /api/blockchain-search?purpose=수면&indexed=false&batchSize=100  (network 기본값 사용)`);
  console.log(`    GET /api/blockchain-search?indexed=false&batchSize=100  (전체 조회)`);
  console.log(`  📋 이벤트 로그 검색 (이벤트 인덱스 사용):`);
  console.log(`    GET /api/blockchain-search?network=hardhat-local&purpose=수면&indexed=event&batchSize=50`);
  console.log('');
  console.log('🔗 방식 2 - 컨트랙트 직접 조회 사용법:');
  console.log(`  전체 데이터 조회:`);
  console.log(`    GET /api/blockchain-direct?getAllData=true&pageSize=100`);
  console.log(`  범위별 조회:`);
  console.log(`    GET /api/blockchain-direct?startId=1&endId=100`);
  console.log(`  첫 페이지 조회:`);
  console.log(`    GET /api/blockchain-direct?pageSize=50`);
});
