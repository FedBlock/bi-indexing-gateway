const express = require('express');
const cors = require('cors');
const IndexingClient = require('../lib/indexing-client');
const path = require('path');

const app = express();
const port = process.env.PORT || 3001;

// Middleware
app.use(cors());
app.use(express.json());

// IndexingClient 인스턴스 (재사용)
let client = null;

// 클라이언트 초기화
async function initClient() {
  if (!client) {
    client = new IndexingClient({
      serverAddr: 'localhost:50052',
      protoPath: path.join(__dirname, '../../grpc-go/protos/index_manager.proto'),
      batchSize: 10
    });
  }
  
  if (!client.isConnected) {
    await client.connect();
  }
  
  return client;
}


function resolveIndexFilePath(indexId, network, filePath) {
  const networkDir = (network === 'hardhat' || network === 'localhost') ? 'hardhat-local' : network;
  return filePath || path.posix.join('data', networkDir, `${indexId}.bf`);
}

// 인덱스 생성 API
// Create new index
app.post('/api/index/create', async (req, res) => {
  try {
    const { indexId, filePath, network, indexingKey, schema, blockNum } = req.body;

    if (!indexId || !network) {
      return res.status(400).json({ 
        success: false, 
        error: 'Missing required fields: indexId, network' 
      });
    }

    console.log(`Creating index: ${indexId}, key: ${indexingKey || 'dynamic'}, schema:`, schema);

    const indexingClient = await initClient();
    const resolvedFilePath = resolveIndexFilePath(indexId, network, filePath);
    // gRPC 쪽 스키마와 동일한 필드 구조를 유지해야 idxmngr가 올바르게 처리한다
    const result = await indexingClient.createIndex({
      IndexID: indexId,
      KeyCol: "IndexableData", // Use supported KeyCol value
      FilePath: resolvedFilePath,
      Network: network,
      BlockNum: typeof blockNum === 'number' ? blockNum : 0
    });

    res.json({ 
      success: true, 
      data: result, 
      indexId: indexId,
      filePath: resolvedFilePath,
      supportedKeys: indexingKey ? [indexingKey] : ['dynamic - any key from data object']
    });
  } catch (error) {
    console.error('Index creation error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// 인덱스 데이터 삽입 API
// Insert data into index  
app.post('/api/index/insert', async (req, res) => {
  try {
    const { 
      indexId, 
      txId, 
      data, 
      filePath, 
      network,
      contractAddress = '0x5FbDB2315678afecb367f032d93F642f64180aa3',
      indexingKey // Optional - can be extracted from data if not provided
    } = req.body;
    
    if (!indexId || !txId || !data || !network) {
      return res.status(400).json({ 
        success: false, 
        error: 'Missing required fields: indexId, txId, data, network' 
      });
    }

    // Extract key dynamically from data or use provided indexingKey
    const dynamicKey = indexingKey || data.purpose || data.type || data.category || Object.keys(data)[0] || 'default';
    
    console.log(`Inserting data: ${indexId}, dynamic key: ${dynamicKey}, data:`, data);

    const indexingClient = await initClient();
    const resolvedFilePath = resolveIndexFilePath(indexId, network, filePath);
    const result = await indexingClient.insertData({
      IndexID: indexId,
      BcList: [{
        TxId: txId,
        KeyCol: 'IndexableData',
        IndexableData: {
          TxId: txId,
          ContractAddress: contractAddress,
          EventName: 'AccessRequestsSaved',
          Timestamp: new Date().toISOString(),
          BlockNumber: 0,
          DynamicFields: {
            "key": dynamicKey, // Use dynamic key
            "network": network,
            "timestamp": new Date().toISOString(),
            ...data // Spread all user data fields dynamically
          },
          SchemaVersion: "1.0"
        }
      }],
      ColName: 'IndexableData',
      ColIndex: indexId,
      FilePath: resolvedFilePath,
      Network: network
    });

    res.json({ success: true, data: result, usedKey: dynamicKey, filePath: resolvedFilePath });
  } catch (error) {
    console.error('Data insertion error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});
// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'OK', timestamp: new Date().toISOString() });
});

// 통합 검색 API (인덱스 + 블록체인)
app.post('/api/search/integrated', async (req, res) => {
  try {
    const { purpose, network, contractAddress, abiPath } = req.body;

    if (!purpose || !network) {
      return res.status(400).json({ error: 'purpose와 network는 필수입니다' });
    }

    const client = await initClient();
    
    const result = await client.searchBlockchainAndIndex(
      purpose,
      network,
      contractAddress,
      abiPath
    );
    
    res.json({
      success: true,
      data: result,
      timestamp: new Date().toISOString()
    });
    
  } catch (error) {
    console.error('통합 검색 실패:', error);
    res.status(500).json({
      success: false,
      error: error.message,
      timestamp: new Date().toISOString()
    });
  }
});

// 블록체인 직접 검색 API
app.post('/api/search/direct', async (req, res) => {
  try {
    const { purpose, network, contractAddress, abiPath } = req.body;

    if (!purpose || !network) {
      return res.status(400).json({ error: 'purpose와 network는 필수입니다' });
    }

    const client = await initClient();
    
    const result = await client.searchBlockchainDirect(
      purpose,
      network,
      contractAddress,
      abiPath
    );
    
    res.json({
      success: true,
      data: result,
      timestamp: new Date().toISOString()
    });
    
  } catch (error) {
    console.error('직접 검색 실패:', error);
    res.status(500).json({
      success: false,
      error: error.message,
      timestamp: new Date().toISOString()
    });
  }
});

// 컨트랙트 필터링 검색 API
app.post('/api/search/contract', async (req, res) => {
  try {
    const { purpose, pageSize = 100, network } = req.body;
    
    if (!purpose || !network) {
      return res.status(400).json({ error: 'purpose와 network는 필수입니다' });
    }

    const client = await initClient();
    
    const result = await client.getFilteredRequestsByPurpose(
      purpose,
      pageSize,
      network
    );
    
    res.json({
      success: true,
      data: result,
      timestamp: new Date().toISOString()
    });
    
  } catch (error) {
    console.error('컨트랙트 검색 실패:', error);
    res.status(500).json({
      success: false,
      error: error.message,
      timestamp: new Date().toISOString()
    });
  }
});

// 전체 요청 데이터 조회 API
app.get('/api/requests/all', async (req, res) => {
  try {
    const { pageSize = 100, network } = req.query;

    if (!network) {
      return res.status(400).json({ error: 'network는 필수입니다' });
    }

    const client = await initClient();
    
    const result = await client.getAllRequestsWithPaging(
      parseInt(pageSize),
      network
    );
    
    res.json({
      success: true,
      data: result,
      timestamp: new Date().toISOString()
    });
    
  } catch (error) {
    console.error('전체 요청 조회 실패:', error);
    res.status(500).json({
      success: false,
      error: error.message,
      timestamp: new Date().toISOString()
    });
  }
});

// 총 요청 개수 조회 API
app.get('/api/requests/count', async (req, res) => {
  try {
    const { network } = req.query;

    if (!network) {
      return res.status(400).json({ error: 'network는 필수입니다' });
    }

    const client = await initClient();
    
    const totalCount = await client.getTotalRequestCount(network);
    
    res.json({
      success: true,
      data: {
        totalCount,
        network
      },
      timestamp: new Date().toISOString()
    });
    
  } catch (error) {
    console.error('요청 개수 조회 실패:', error);
    res.status(500).json({
      success: false,
      error: error.message,
      timestamp: new Date().toISOString()
    });
  }
});

// 범위별 요청 조회 API
app.post('/api/requests/range', async (req, res) => {
  try {
    const { startId, endId, network } = req.body;
    
    if (!startId || !endId || !network) {
      return res.status(400).json({ error: 'startId, endId, network는 필수입니다' });
    }

    const client = await initClient();
    
    const result = await client.getRequestsInRange(
      parseInt(startId),
      parseInt(endId),
      network
    );
    
    res.json({
      success: true,
      data: result,
      timestamp: new Date().toISOString()
    });
    
  } catch (error) {
    console.error('범위별 요청 조회 실패:', error);
    res.status(500).json({
      success: false,
      error: error.message,
      timestamp: new Date().toISOString()
    });
  }
});

// 인덱스 데이터 검색 API
app.post('/api/index/search', async (req, res) => {
  try {
    const searchParams = req.body;
    
    if (!searchParams.IndexID) {
      return res.status(400).json({ error: 'IndexID는 필수입니다' });
    }

    const client = await initClient();
    
    const result = await client.searchData(searchParams);
    
    res.json({
      success: true,
      data: result,
      timestamp: new Date().toISOString()
    });
    
  } catch (error) {
    console.error('인덱스 검색 실패:', error);
    res.status(500).json({
      success: false,
      error: error.message,
      timestamp: new Date().toISOString()
    });
  }
});

// 성능 통계 조회 API
app.get('/api/performance', async (req, res) => {
  try {
    const client = await initClient();
    
    const stats = client.getPerformanceStats();
    
    res.json({
      success: true,
      data: stats,
      timestamp: new Date().toISOString()
    });
    
  } catch (error) {
    console.error('성능 통계 조회 실패:', error);
    res.status(500).json({
      success: false,
      error: error.message,
      timestamp: new Date().toISOString()
    });
  }
});

// 서버 시작
app.listen(port, () => {
  console.log(`🚀 BI-Indexing API Server running on http://localhost:${port}`);
  console.log(`📊 Health check: http://localhost:${port}/health`);
  console.log(`📚 API Endpoints:`);
  console.log(`   POST /api/search/integrated - 통합 검색`);
  console.log(`   POST /api/search/direct - 블록체인 직접 검색`);
  console.log(`   POST /api/search/contract - 컨트랙트 필터링 검색`);
  console.log(`   GET  /api/requests/all - 전체 요청 조회`);
  console.log(`   GET  /api/requests/count - 총 요청 개수`);
  console.log(`   POST /api/requests/range - 범위별 요청 조회`);
  console.log(`   POST /api/index/search - 인덱스 검색`);
  console.log(`   GET  /api/performance - 성능 통계`);
});

// Graceful shutdown
process.on('SIGTERM', async () => {
  console.log('SIGTERM 신호 수신, 서버 종료 중...');
  if (client && client.isConnected) {
    await client.close();
  }
  process.exit(0);
});

module.exports = app;
