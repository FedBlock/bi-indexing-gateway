const express = require('express');
const cors = require('cors');
const fs = require('fs');
// gRPC 게이트웨이 클라이언트 (idxmngr와 직접 통신)
const IndexingGateway = require('../lib/indexing-client');
const path = require('path');

const app = express();
const port = process.env.PORT || 3001;

// Middleware
app.use(cors());
app.use(express.json());

// 게이트웨이 인스턴스 (재사용)
let gateway = null;

const resolveProtoPath = () => {
  const candidates = [
    path.join(__dirname, '../../grpc-go/protos/index_manager.proto'),
    path.join(__dirname, '../../bi-index/grpc-go/protos/index_manager.proto'),
    path.join(process.cwd(), 'grpc-go/protos/index_manager.proto'),
  ];

  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }

  throw new Error(`index_manager.proto 파일을 찾을 수 없습니다. 확인한 경로: ${candidates.join(', ')}`);
};

const CONFIG_CANDIDATES = [
  path.join(__dirname, '../../idxmngr-go/config.yaml'),
  path.join(process.cwd(), 'idxmngr-go/config.yaml'),
  path.join(__dirname, '../idxmngr-go/config.yaml'),
];

const parseConfigItems = (content) => {
  const items = [];
  let current = null;

  const commitCurrent = () => {
    if (current) {
      items.push(current);
      current = null;
    }
  };

  const upsertKeyValue = (segment) => {
    const [rawKey, ...rest] = segment.split(':');
    if (!rawKey || rest.length === 0) {
      return;
    }
    const key = rawKey.trim();
    let value = rest.join(':').trim();
    if (!value) {
      current[key] = '';
      return;
    }
    const commentIdx = value.indexOf('#');
    if (commentIdx !== -1) {
      value = value.slice(0, commentIdx).trim();
    }
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    current[key] = value;
  };

  content.split(/\r?\n/).forEach((line) => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) {
      return;
    }

    if (trimmed.startsWith('- ')) {
      commitCurrent();
      current = {};
      const remainder = trimmed.slice(2).trim();
      if (remainder) {
        upsertKeyValue(remainder);
      }
      return;
    }

    if (current && trimmed.includes(':')) {
      upsertKeyValue(trimmed);
    }
  });

  commitCurrent();
  return items;
};

const loadIndexConfigMetadata = () => {
  for (const candidate of CONFIG_CANDIDATES) {
    try {
      if (fs.existsSync(candidate)) {
        const raw = fs.readFileSync(candidate, 'utf8');
        if (!raw.trim()) {
          continue;
        }
        const items = parseConfigItems(raw).map((item) => {
          // 키를 소문자로 정규화
          const normalized = {};
          Object.entries(item).forEach(([key, value]) => {
            normalized[key.toLowerCase()] = value;
          });

          // fromblock, blocknum 등 숫자 필드는 문자열로 두되 필요 시 정수 파싱
          if (normalized.fromblock !== undefined) {
            normalized.fromblock = normalized.fromblock.toString();
          }
          if (normalized.blocknum !== undefined) {
            normalized.blocknum = normalized.blocknum.toString();
          }

          return normalized;
        });
        return items;
      }
    } catch (err) {
      console.error('config.yaml 읽기 실패:', err);
    }
  }
  return [];
};

// gRPC 게이트웨이 초기화
async function initGateway() {
  if (!gateway) {
    gateway = new IndexingGateway({
      serverAddr: 'localhost:50052',
      protoPath: resolveProtoPath(),
      batchSize: 10
    });
  }
  
  if (!gateway.isConnected) {
    await gateway.connect();
  }
  
  return gateway;
}


function resolveIndexFilePath(schema, network, filePath) {
  const networkDir = (network === 'hardhat' || network === 'localhost') ? 'hardhat-local' : network;
  return filePath || path.posix.join('data', networkDir, `${schema}.bf`);
}

// 인덱스 목록 조회 API
app.get('/api/index/list', async (req, res) => {
  try {
    const { requestMsg } = req.query;
    const indexingGateway = await initGateway();
    const response = await indexingGateway.getIndexList(requestMsg || 'index-list-request');

    const rawIndexes = response?.IdxList || [];
    const metadataItems = loadIndexConfigMetadata();
    const metadataMap = new Map(metadataItems.map((meta) => [String(meta.idxid ?? meta.indexid ?? ''), meta]));

    const indexes = rawIndexes.map((item, idx) => {
      const indexId = item?.IndexID || item?.indexId || `index_${idx}`;
      const keyCol = item?.KeyCol || item?.keyCol || 'IndexableData';
      const indexName = item?.IndexName || item?.indexName || indexId;
      const filePath = item?.FilePath || item?.filePath || null;

      // 네트워크 추론: indexId 안에 하이픈으로 network-id가 들어가는 패턴을 우선 사용
      const lowered = indexId.toLowerCase();
      let inferredNetwork = null;
      if (lowered.includes('monad')) {
        inferredNetwork = 'monad';
      } else if (lowered.includes('hardhat')) {
        inferredNetwork = 'hardhat';
      } else if (lowered.includes('fabric')) {
        inferredNetwork = 'fabric';
      }

      const dataKey = filePath
        ? path.posix.basename(filePath).replace(/\.bf$/i, '')
        : null;

      const normalizedIndex = {
        indexId,
        indexName,
        keyColumn: keyCol,
        network: inferredNetwork,
        filePath,
        dataKey,
        fromBlock: item?.FromBlock ?? null,
        currentBlock: item?.CurrentBlock ?? null,
      };

      const meta = metadataMap.get(String(indexId));
      if (meta) {
        if (meta.filepath && !normalizedIndex.filePath) {
          normalizedIndex.filePath = meta.filepath;
        }
        if (meta.datakey) {
          normalizedIndex.dataKey = meta.datakey;
        }
        if (meta.idxname) {
          normalizedIndex.indexName = meta.idxname;
          normalizedIndex.category = meta.idxname;
        }
        if (meta.fromblock) {
          normalizedIndex.fromBlock = meta.fromblock;
        }
        if (meta.blocknum) {
          normalizedIndex.blockNum = meta.blocknum;
        }
        if (!normalizedIndex.network && meta.filepath) {
          const segments = meta.filepath.split('/');
          if (segments.length >= 2) {
            normalizedIndex.network = segments[1];
          }
        }
      }

      if (!normalizedIndex.category) {
        normalizedIndex.category = normalizedIndex.indexName;
      }
      if (normalizedIndex.fromBlock !== undefined && normalizedIndex.fromBlock !== null) {
        normalizedIndex.fromBlock = String(normalizedIndex.fromBlock);
      }
      if (normalizedIndex.currentBlock !== undefined && normalizedIndex.currentBlock !== null) {
        normalizedIndex.currentBlock = String(normalizedIndex.currentBlock);
      }

      return normalizedIndex;
    });

    res.json({
      success: true,
      data: {
        indexCount: response?.IndexCnt ?? indexes.length,
        indexes,
      },
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error('인덱스 목록 조회 실패:', error);
    res.status(500).json({
      success: false,
      error: error.message || '인덱스 목록 조회 실패',
      timestamp: new Date().toISOString(),
    });
  }
});

// 인덱스 생성 API
// Create new index
app.post('/api/index/create', async (req, res) => {
  try {
    const {
      schema: schemaFromRequest,
      indexId: legacyIndexId,
      filePath,
      network,
      indexingKey,
      blockNum,
      fromBlock,
    } = req.body;

    const schema = schemaFromRequest || legacyIndexId;

    if (!schema || !network) {
      return res.status(400).json({ 
        success: false, 
        error: 'Missing required fields: schema, network' 
      });
    }

    console.log(`Creating index - schema: ${schema}, key: ${indexingKey || 'dynamic'}`);

    const indexingGateway = await initGateway();
    const resolvedFilePath = resolveIndexFilePath(schema, network, filePath);
    // gRPC 쪽 스키마와 동일한 필드 구조를 유지해야 idxmngr가 올바르게 처리한다
    const result = await indexingGateway.createIndex({
      IndexID: schema,
      KeyCol: "IndexableData", // Use supported KeyCol value
      FilePath: resolvedFilePath,
      Network: network,
      BlockNum: typeof blockNum === 'number' ? blockNum : 0,
      FromBlock: typeof fromBlock === 'number' ? fromBlock : undefined
    });

    res.json({ 
      success: true, 
      data: result, 
      indexId: schema,
      schema,
      filePath: resolvedFilePath,
      fromBlock: typeof fromBlock === 'number' ? fromBlock : undefined,
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

    const indexingGateway = await initGateway();
    const resolvedFilePath = resolveIndexFilePath(indexId, network, filePath);
    const result = await indexingGateway.insertData({
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

    const gatewayClient = await initGateway();
    
    const result = await gatewayClient.searchBlockchainAndIndex(
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

    const gatewayClient = await initGateway();
    
    const result = await gatewayClient.searchBlockchainDirect(
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

    const gatewayClient = await initGateway();
    
    const result = await gatewayClient.getFilteredRequestsByPurpose(
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

    const gatewayClient = await initGateway();
    
    const result = await gatewayClient.getAllRequestsWithPaging(
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

    const gatewayClient = await initGateway();
    
    const totalCount = await gatewayClient.getTotalRequestCount(network);
    
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

    const gatewayClient = await initGateway();
    
    const result = await gatewayClient.getRequestsInRange(
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

    const gatewayClient = await initGateway();
    
    const result = await gatewayClient.searchData(searchParams);
    
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
    const gatewayClient = await initGateway();
    
    const stats = gatewayClient.getPerformanceStats();
    
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
  if (gateway && gateway.isConnected) {
    await gateway.close();
  }
  process.exit(0);
});

module.exports = app;
