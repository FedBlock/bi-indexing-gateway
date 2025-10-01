const express = require('express');
const cors = require('cors');
const fs = require('fs');
// gRPC 게이트웨이 클라이언트 (idxmngr와 직접 통신)
const IndexingGateway = require('../lib/indexing-client');
const {
  INDEX_SCHEMA,
  INDEX_KEY_SIZE,
  resolveNetworkKey,
  buildIndexId,
  buildIndexFilePath,
} = require('../lib/indexing-constants');
const path = require('path');

const app = express();
const port = process.env.PORT || 3001;

// Middleware
app.use(cors());
app.use(express.json());

// 요청 로깅 미들웨어
app.use((req, res, next) => {
  const timestamp = new Date().toISOString();
  console.log(`[${timestamp}] ${req.method} ${req.url}`);
  
  if (req.body && Object.keys(req.body).length > 0) {
    console.log(`[${timestamp}] Request Body:`, JSON.stringify(req.body, null, 2));
  }
  
  if (req.query && Object.keys(req.query).length > 0) {
    console.log(`[${timestamp}] Query Params:`, req.query);
  }
  
  next();
});

// 게이트웨이 인스턴스 (재사용)
let gateway = null;

const slugify = (value, fallback = 'index') => {
  if (!value) {
    return fallback;
  }

  const slug = String(value)
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');

  return slug || fallback;
};

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
  path.join(__dirname, '../../bi-index/idxmngr-go/config.yaml'),
  path.join(process.cwd(), '../bi-index/idxmngr-go/config.yaml'),
  path.join(process.cwd(), 'idxmngr-go/config.yaml'),
];

const resolveIdxmngrRoot = () => {
  for (const candidate of CONFIG_CANDIDATES) {
    if (fs.existsSync(candidate)) {
      return path.dirname(candidate);
    }
  }
  return null;
};

const computeNextIndexId = (metadataItems) => {
  let maxNumericId = 0;

  metadataItems.forEach((item) => {
    const rawId = String(item.idxid ?? item.indexid ?? '').trim();
    if (!rawId) {
      return;
    }

    const match = rawId.match(/(\d+)$/);
    if (!match) {
      return;
    }

    const num = parseInt(match[1], 10);
    if (!Number.isNaN(num)) {
      maxNumericId = Math.max(maxNumericId, num);
    }
  });

  const next = maxNumericId + 1;
  return String(next).padStart(3, '0');
};

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


function resolveIndexFilePath({ schema, indexId, network, filePath, metadata }) {
  if (filePath) {
    return filePath;
  }

  const networkKey = resolveNetworkKey(network);
  const effectiveMetadata = metadata || loadIndexConfigMetadata();
  const normalizedIndexId = indexId || buildIndexId(networkKey);

  const matched = effectiveMetadata.find((item) => {
    const itemId = String(item.idxid ?? item.indexid ?? '').trim();
    return itemId === normalizedIndexId;
  });

  if (matched && matched.filepath) {
    return matched.filepath;
  }

  const schemaSlug = slugify(schema || INDEX_SCHEMA, INDEX_SCHEMA);
  if (schemaSlug === INDEX_SCHEMA) {
    return buildIndexFilePath(networkKey);
  }

  return path.posix.join('data', networkKey, `${schemaSlug}.bf`);
}

// 인덱스 목록 조회 API
app.get('/api/index/list', async (req, res) => {
  try {
    const { requestMsg } = req.query;
    const indexingGateway = await initGateway();
    const response = await indexingGateway.getIndexList(requestMsg || 'index-list-request');

    const rawIndexes = response?.IdxList || [];
    const metadataItems = loadIndexConfigMetadata();
    const metadataMap = new Map(
      metadataItems.map((meta) => {
        const metaId = String(meta.idxid ?? meta.indexid ?? '');
        const metaPath = String(meta.filepath ?? '');
        const key = `${metaId}::${metaPath}`;
        return [key, meta];
      })
    );

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
        indexingKey: item?.IndexingKey || item?.indexingKey || null,
        keyColumn: keyCol,
        network: inferredNetwork,
        filePath,
        dataKey,
        fromBlock: item?.FromBlock ?? null,
        currentBlock: item?.CurrentBlock ?? null,
      };

      const metaKey = `${indexId}::${normalizedIndex.filePath || ''}`;
      const metaFallbackKey = `${indexId}::`;
      const meta = metadataMap.get(metaKey) || metadataMap.get(metaFallbackKey);
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
        if (meta.indexingkey) {
          normalizedIndex.indexingKey = meta.indexingkey;
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
      if (!normalizedIndex.indexingKey) {
        normalizedIndex.indexingKey = normalizedIndex.indexName || normalizedIndex.indexId;
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
      schema,
      indexId: requestedIndexId,
      indexName: providedIndexName,
      filePath,
      network,
      indexingKey,
      blockNum,
      fromBlock,
    } = req.body;

    const networkKey = resolveNetworkKey(network);
    const effectiveSchema = schema || INDEX_SCHEMA;

    const metadataItems = loadIndexConfigMetadata();
    const autoGeneratedIndexId = computeNextIndexId(metadataItems);
    const fallbackIndexId = buildIndexId(networkKey);
    const indexId = String(requestedIndexId || autoGeneratedIndexId || fallbackIndexId).trim();
    const indexName = providedIndexName || effectiveSchema;
    const schemaSlug = slugify(effectiveSchema, INDEX_SCHEMA);

    console.log(`Creating index - schema: ${effectiveSchema}, indexId: ${indexId}, key: ${indexingKey || 'dynamic'}`);

    const resolvedFilePath = resolveIndexFilePath({
      schema: schemaSlug,
      indexId,
      network: networkKey,
      filePath,
      metadata: metadataItems,
    });

    const idxmngrRoot = resolveIdxmngrRoot();
    if (idxmngrRoot) {
      const targetDir = path.join(idxmngrRoot, ...resolvedFilePath.split('/').slice(0, -1));
      fs.mkdirSync(targetDir, { recursive: true });
    }

    const indexingGateway = await initGateway();
    // gRPC 쪽 스키마와 동일한 필드 구조를 유지해야 idxmngr가 올바르게 처리한다
    const result = await indexingGateway.createIndex({
      IndexID: indexId,
      IndexName: indexName,
      IndexingKey: indexingKey || indexName,
      KeyCol: "IndexableData", // Use supported KeyCol value
      Schema: effectiveSchema,
      FilePath: resolvedFilePath,
      Network: networkKey,
      BlockNum: typeof blockNum === 'number' ? blockNum : 0,
      FromBlock: typeof fromBlock === 'number' ? fromBlock : undefined,
      Param: JSON.stringify({
        schema,
        indexingKey: indexingKey || null,
      }),
    });

    res.json({
      success: true,
      data: result,
      indexId,
      indexName,
      schema,
      filePath: resolvedFilePath,
      fromBlock: typeof fromBlock === 'number' ? fromBlock : undefined,
      indexingKey: indexingKey || indexName
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
      schema,
      keySize,
      contractAddress = '0x5FbDB2315678afecb367f032d93F642f64180aa3',
      indexingKey // Optional - can be extracted from data if not provided
    } = req.body;
    
    if (!indexId || !txId || !data || !network) {
      return res.status(400).json({ 
        success: false, 
        error: 'Missing required fields: indexId, txId, data, network' 
      });
    }

    const networkKey = resolveNetworkKey(network);
    const effectiveSchema = schema || INDEX_SCHEMA;
    const resolvedIndexId = indexId || buildIndexId(networkKey);
    const resolvedFilePath = resolveIndexFilePath({
      schema: effectiveSchema,
      indexId: resolvedIndexId,
      network: networkKey,
      filePath,
    });
    const resolvedKeySize = Number(keySize || INDEX_KEY_SIZE);

    // Extract key dynamically from data or use provided indexingKey
    const dynamicKey = indexingKey || data.purpose || data.type || data.category || Object.keys(data)[0] || 'default';
    
    console.log(`Inserting data: ${indexId}, dynamic key: ${dynamicKey}, data:`, data);

    const indexingGateway = await initGateway();
    const result = await indexingGateway.insertData({
      IndexID: resolvedIndexId,
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
      ColIndex: resolvedIndexId,
      FilePath: resolvedFilePath,
      Network: networkKey,
      KeySize: resolvedKeySize,
      Schema: effectiveSchema,
    });

    res.json({
      success: true,
      data: result,
      usedKey: dynamicKey,
      filePath: resolvedFilePath,
      indexId: resolvedIndexId,
      schema: effectiveSchema,
      keySize: resolvedKeySize,
    });
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
  const timestamp = new Date().toISOString();
  console.log(`\n🚀 BI-Indexing API Server running on http://localhost:${port}`);
  console.log(`⏰ Started at: ${timestamp}`);
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
  console.log(`\n📡 서버가 요청을 대기 중입니다...`);
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
