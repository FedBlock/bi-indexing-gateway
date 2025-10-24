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
app.use(cors({
  origin: [
    'http://localhost:3000',
    'http://localhost:3001',
    'http://localhost:5173',
    'https://grnd.bimatrix.co.kr'
  ],
  credentials: true
}));
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

// 인덱스 ID에서 네트워크 추론
const inferNetworkFromIndexId = (indexId = '') => {
  const lowered = indexId.toLowerCase();
  if (lowered.includes('monad')) {
    return 'monad';
  }
  if (lowered.includes('hardhat')) {
    return lowered.includes('local') ? 'hardhat-local' : 'hardhat';
  }
  if (lowered.includes('kaia')) {
    return 'kaia';
  }
  if (lowered.includes('fabric')) {
    return 'fabric';
  }
  return 'unknown';
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

  // 절대 경로로 변경: idxmngr-go 루트 디렉토리 기준
  const idxmngrRoot = resolveIdxmngrRoot();
  if (idxmngrRoot) {
    return path.join(idxmngrRoot, 'data', networkKey, `${schemaSlug}.bf`);
  }
  return path.posix.join('data', networkKey, `${schemaSlug}.bf`);
}

// 인덱스 목록 조회 API
app.get('/api/index/list', async (req, res) => {
  try {
    const { requestMsg, forceRefresh } = req.query;
    
    // forceRefresh가 true면 config.yaml을 직접 읽어서 동기화
    if (forceRefresh === 'true') {
      console.log('🔄 강제 새로고침: config.yaml 직접 읽기');
      const metadataItems = loadIndexConfigMetadata();
      const rawIndexes = metadataItems.map((meta, idx) => ({
        IndexID: meta.idxid || meta.indexid || `index_${idx}`,
        IndexName: meta.idxname || meta.idxid || meta.indexid,
        IndexingKey: meta.indexingkey || meta.idxname,
        KeyCol: meta.keycol || 'IndexableData',
        FilePath: meta.filepath || '',
        Network: meta.filepath ? meta.filepath.split('/')[1] : 'unknown',
        FromBlock: meta.fromblock || 0,
        CurrentBlock: meta.blocknum || 0
      }));
      
      // searchableValues 메타데이터 읽기
      const idxmngrRoot = resolveIdxmngrRoot();
      let searchableMetadata = {};
      if (idxmngrRoot) {
        const metadataPath = path.join(idxmngrRoot, 'index-metadata.json');
        if (fs.existsSync(metadataPath)) {
          try {
            const content = fs.readFileSync(metadataPath, 'utf8');
            searchableMetadata = JSON.parse(content);
          } catch (err) {
            console.warn('Failed to read searchable metadata:', err.message);
          }
        }
      }

      const metadataMap = new Map(
        metadataItems.map((meta) => {
          const metaId = String(meta.idxid ?? meta.indexid ?? '');
          const metaPath = String(meta.filepath ?? '');
          const key = `${metaId}::${metaPath}`;
          return [key, meta];
        })
      );

      const indexes = mergedIndexes.map((item, idx) => {
        const indexId = item?.IndexID || item?.indexId || `index_${idx}`;
        const keyCol = item?.KeyCol || item?.keyCol || 'IndexableData';
        const indexName = item?.IndexName || item?.indexName || indexId;

        const inferredNetwork = item?.Network || item?.network || inferNetworkFromIndexId(indexId);
        const filePath = item?.FilePath || item?.filePath || buildIndexFilePath(inferredNetwork, indexName);
        
        // 파일 경로에서 네트워크 추론 (더 정확한 방법)
        let finalNetwork = inferredNetwork;
        if (filePath && filePath.includes('/')) {
          const pathSegments = filePath.split('/');
          if (pathSegments.length >= 2) {
            const networkFromPath = pathSegments[pathSegments.length - 2]; // data/kaia/purpose.bf -> kaia
            if (['kaia', 'monad', 'hardhat-local', 'fabric'].includes(networkFromPath)) {
              finalNetwork = networkFromPath;
            }
          }
        }
        
        // 임시 해결책: kaia 파일이면 강제로 kaia 설정
        if (filePath && filePath.includes('/kaia/')) {
          finalNetwork = 'kaia';
        }
        
        // 추가 해결책: config.yaml의 filepath에서도 kaia 확인
        if (filePath && filePath.includes('data/kaia/')) {
          finalNetwork = 'kaia';
        }
        
        // 디버깅 로그
        console.log('🔍 백엔드 네트워크 추론:', {
          indexId,
          filePath,
          inferredNetwork,
          finalNetwork,
          pathSegments: filePath ? filePath.split('/') : null
        });

        const normalizedIndex = {
          indexId,
          indexName,
          indexingKey: item?.IndexingKey || item?.indexingKey || null,
          keyColumn: keyCol,
          network: finalNetwork, // 파일 경로에서 추론한 네트워크 사용
          filePath,
          dataKey: filePath ? path.posix.basename(filePath).replace(/\.bf$/i, '') : null,
          fromBlock: item?.FromBlock ?? null,
          currentBlock: item?.CurrentBlock ?? null,
          searchableValues: null,
        };
        
        // 디버깅: 정규화된 인덱스 데이터 로그
        console.log('🔍 정규화된 인덱스:', {
          indexId: normalizedIndex.indexId,
          network: normalizedIndex.network,
          filePath: normalizedIndex.filePath
        });

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

        // searchableValues 메타데이터 추가
        if (searchableMetadata[indexId]) {
          normalizedIndex.searchableValues = searchableMetadata[indexId].searchableValues;
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

      // 인덱스를 indexId로 정렬 (001, 002, 003... 순서)
      const sortedIndexes = indexes.sort((a, b) => {
        const aId = a.indexId || '';
        const bId = b.indexId || '';
        return aId.localeCompare(bId, undefined, { numeric: true });
      });

      return res.json({
        success: true,
        data: {
          indexCount: sortedIndexes.length,
          indexes: sortedIndexes,
        },
        timestamp: new Date().toISOString(),
        source: 'config.yaml-direct'
      });
    }

    const indexingGateway = await initGateway();
    const response = await indexingGateway.getIndexList(requestMsg || 'index-list-request');

    const rawIndexes = response?.IdxList || [];
    const metadataItems = loadIndexConfigMetadata();
    
    // config.yaml에서 직접 읽은 데이터를 우선 사용 (gRPC 응답보다 정확함)
    const configBasedIndexes = metadataItems.map((meta, idx) => {
      const indexId = meta.idxid || meta.indexid || `index_${idx}`;
      
      // 파일 경로에서 네트워크 추출 (data/kaia/purpose.bf 형태)
      let networkFromPath = null;
      if (meta.filepath) {
        const pathSegments = meta.filepath.split('/');
        const dataIndex = pathSegments.findIndex(segment => segment === 'data');
        if (dataIndex !== -1 && pathSegments[dataIndex + 1]) {
          networkFromPath = pathSegments[dataIndex + 1];
        }
      }
      
      console.log('🔍 config.yaml에서 네트워크 추출:', {
        indexId,
        filepath: meta.filepath,
        networkFromPath
      });
      
      return {
        IndexID: indexId,
        IndexName: meta.idxname || meta.idxid || meta.indexid,
        IndexingKey: meta.indexingkey || meta.idxname,
        KeyCol: meta.keycol || 'IndexableData',
        FilePath: meta.filepath || '',
        Network: networkFromPath, // 파일 경로에서 추출한 네트워크 사용
        FromBlock: meta.fromblock || 0,
        CurrentBlock: meta.blocknum || 0
      };
    });
    
    // gRPC 응답과 config.yaml 데이터를 병합 (config.yaml 우선)
    const mergedIndexes = configBasedIndexes.map(configItem => {
      const grpcItem = rawIndexes.find(grpc => 
        grpc.IndexID === configItem.IndexID || 
        grpc.indexId === configItem.IndexID
      );
      
      return {
        ...configItem,
        ...(grpcItem || {}), // gRPC 데이터로 보완
        Network: configItem.Network, // config.yaml의 네트워크 정보 우선 사용
        FilePath: configItem.FilePath // config.yaml의 파일 경로 우선 사용
      };
    });
    const metadataMap = new Map(
      metadataItems.map((meta) => {
        const metaId = String(meta.idxid ?? meta.indexid ?? '');
        const metaPath = String(meta.filepath ?? '');
        const key = `${metaId}::${metaPath}`;
        return [key, meta];
      })
    );

    // searchableValues는 config.yaml에서 관리하므로 별도 읽기 불필요

    const indexes = mergedIndexes.map((item, idx) => {
      const indexId = item?.IndexID || item?.indexId || `index_${idx}`;
      const keyCol = item?.KeyCol || item?.keyCol || 'IndexableData';
      const indexName = item?.IndexName || item?.indexName || indexId;
      const filePath = item?.FilePath || item?.filePath || null;

      // mergedIndexes에서 네트워크 정보 가져오기 (index-metadata.json에서 읽은 값)
      const networkFromMerged = item?.Network || item?.network;

      const dataKey = filePath
        ? path.posix.basename(filePath).replace(/\.bf$/i, '')
        : null;

      console.log('🔍 mergedIndexes에서 네트워크 정보:', {
        indexId,
        networkFromMerged,
        itemNetwork: item?.Network,
        itemnetwork: item?.network
      });

      const normalizedIndex = {
        indexId,
        indexName,
        indexingKey: item?.IndexingKey || item?.indexingKey || null,
        keyColumn: keyCol,
        network: networkFromMerged, // mergedIndexes의 네트워크 사용
        filePath,
        dataKey,
        fromBlock: item?.FromBlock ?? null,
        currentBlock: item?.CurrentBlock ?? null,
        searchableValues: null, // 나중에 메타데이터에서 추가
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

      // searchableValues는 config.yaml에서 관리하므로 별도 처리 불필요

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

    // 인덱스를 indexId로 정렬 (001, 002, 003... 순서)
    const sortedIndexes = indexes.sort((a, b) => {
      const aId = a.indexId || '';
      const bId = b.indexId || '';
      return aId.localeCompare(bId, undefined, { numeric: true });
    });

    res.json({
      success: true,
      data: {
        indexCount: response?.IndexCnt ?? sortedIndexes.length,
        indexes: sortedIndexes,
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
      searchableValues, // 검색 가능한 값 추가
    } = req.body;

    const networkKey = resolveNetworkKey(network);
    const effectiveSchema = schema || INDEX_SCHEMA;

    const metadataItems = loadIndexConfigMetadata();
    
    // 중복 체크: 같은 네트워크 + 같은 스키마
    const duplicate = metadataItems.find(item => {
      // network 필드가 있으면 사용, 없으면 filepath에서 추출
      let itemNetwork = item.network;
      if (!itemNetwork && item.filepath) {
        const pathSegments = item.filepath.split('/');
        const dataIndex = pathSegments.findIndex(segment => segment === 'data');
        if (dataIndex !== -1 && pathSegments[dataIndex + 1]) {
          itemNetwork = pathSegments[dataIndex + 1];
        }
      }
      
      const itemSchema = item.idxname || item.indexid;
      
      console.log('🔍 중복 체크:', {
        itemNetwork,
        networkKey,
        itemSchema,
        effectiveSchema,
        isDuplicate: itemNetwork === networkKey && itemSchema === effectiveSchema
      });
      
      return itemNetwork === networkKey && itemSchema === effectiveSchema;
    });
    
    if (duplicate) {
      return res.status(400).json({
        success: false,
        error: `이미 같은 설정의 인덱스가 존재합니다.`,
        errorType: 'DUPLICATE_INDEX',
        details: {
          network: networkKey,
          schema: effectiveSchema,
          indexingKey: indexingKey,
          existingIndexId: duplicate.idxid || duplicate.indexid
        }
      });
    }
    
    const autoGeneratedIndexId = computeNextIndexId(metadataItems);
    const fallbackIndexId = buildIndexId(networkKey);
    const indexId = String(requestedIndexId || autoGeneratedIndexId || fallbackIndexId).trim();
    const indexName = providedIndexName || effectiveSchema;
    const schemaSlug = slugify(effectiveSchema, INDEX_SCHEMA);

    console.log(`Creating index - schema: ${effectiveSchema}, indexId: ${indexId}, key: ${indexingKey || 'dynamic'}, searchableValues: ${searchableValues}`);

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

    // searchableValues는 config.yaml에 포함되어 있으므로 별도 저장 불필요
    console.log(`✅ Index created with network: ${networkKey}, searchableValues: ${searchableValues}`);

    res.json({
      success: true,
      data: result,
      indexId,
      indexName,
      schema,
      filePath: resolvedFilePath,
      fromBlock: typeof fromBlock === 'number' ? fromBlock : undefined,
      indexingKey: indexingKey || indexName,
      searchableValues: searchableValues || null
    });
  } catch (error) {
    console.error('Index creation error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// 인덱스 기본 설정 조회 API
app.get('/api/index/config', async (req, res) => {
  try {
    const requestedNetwork = req.query.network;
    const networkKey = resolveNetworkKey(requestedNetwork);
    const metadataItems = loadIndexConfigMetadata();
    const matched = metadataItems.find((item) => {
      const filePath = item.filepath || '';
      return filePath.includes(`/${networkKey}/`);
    });

    if (!matched) {
      res.status(404).json({ success: false, error: `No index config found for network ${networkKey}` });
      return;
    }

    const schema = matched.idxname || INDEX_SCHEMA;
    const indexId = matched.idxid || buildIndexId(networkKey);
    const keySize = Number(matched.keysize) > 0 ? Number(matched.keysize) : INDEX_KEY_SIZE;
    const filePath = matched.filepath || buildIndexFilePath(networkKey);

    res.json({
      success: true,
      data: {
        indexId,
        schema,
        network: networkKey,
        filePath,
        keySize,
      },
    });
  } catch (error) {
    console.error('Index config lookup failed:', error);
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
    
    if (!txId || !data || !network) {
      return res.status(400).json({ 
        success: false, 
        error: 'Missing required fields: txId, data, network' 
      });
    }

    const networkKey = resolveNetworkKey(network);
    const metadataItems = loadIndexConfigMetadata();
    if (!indexId) {
      return res.status(400).json({
        success: false,
        error: 'indexId is required and must exist in config.yaml',
      });
    }
    const resolvedIndexId = String(indexId).trim();
    const matchedConfig = metadataItems.find((item) => {
      const itemId = String(item.idxid ?? '').trim();
      const file = item.filepath || '';
      return itemId === resolvedIndexId && file.includes(`/${networkKey}/`);
    });

    if (!matchedConfig) {
      return res.status(404).json({
        success: false,
        error: `indexId ${resolvedIndexId} (network ${networkKey}) not found in config` ,
      });
    }

    const effectiveSchema = schema || matchedConfig.idxname || INDEX_SCHEMA;
    const resolvedFilePath = filePath || matchedConfig.filepath;
    const resolvedKeySize = Number(keySize) > 0 ? Number(keySize) : Number(matchedConfig.keysize) || INDEX_KEY_SIZE;

    // Extract key dynamically from data or use provided indexingKey
    const dynamicKey = indexingKey || data.purpose || data.type || data.category || Object.keys(data)[0] || 'default';
    
    console.log(`Inserting data: ${resolvedIndexId}, dynamic key: ${dynamicKey}, data:`, data);

    // Create proper DynamicFields object
    const dynamicFields = {
      "key": dynamicKey,
      "network": network,
      "timestamp": new Date().toISOString(),
      "purpose": data.purpose || '',
      "organization": data.organization || '',
      "requester": data.requester || '',
      "blockNumber": data.blockNumber || 0,
      "txStatus": data.txStatus || 1
    };

    // Ensure all data fields are properly included
    Object.keys(data).forEach(key => {
      if (data[key] !== undefined && data[key] !== null) {
        dynamicFields[key] = data[key];
      }
    });

    console.log(`DynamicFields created:`, dynamicFields);

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
          BlockNumber: data.blockNumber || 0,
          DynamicFields: dynamicFields,
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

// 인덱스 삭제 API
app.delete('/api/index/delete/:indexId', async (req, res) => {
  try {
    let { indexId } = req.params;
    
    if (!indexId) {
      return res.status(400).json({ 
        success: false, 
        error: 'indexId is required' 
      });
    }

    // "hardhat-local-002" 형식이면 "002"만 추출
    if (indexId.includes('-')) {
      const parts = indexId.split('-');
      indexId = parts[parts.length - 1]; // 마지막 부분 (002)
    }

    console.log(`Deleting index: ${indexId}`);

    // config.yaml에서 해당 인덱스 제거
    const metadataItems = loadIndexConfigMetadata();
    const filteredItems = metadataItems.filter(item => {
      const itemId = String(item.idxid ?? item.indexid ?? '').trim();
      return itemId !== indexId;
    });

    // config.yaml 업데이트
    const idxmngrRoot = resolveIdxmngrRoot();
    if (idxmngrRoot) {
      const configPath = path.join(idxmngrRoot, 'config.yaml');
      const yamlContent = 'items:\n' + filteredItems.map(item => {
        // filepath에서 네트워크 추출
        let networkFromPath = 'unknown';
        if (item.filepath) {
          const pathSegments = item.filepath.split('/');
          const dataIndex = pathSegments.findIndex(segment => segment === 'data');
          if (dataIndex !== -1 && pathSegments[dataIndex + 1]) {
            networkFromPath = pathSegments[dataIndex + 1];
          }
        }
        
        return `    - idxid: ${item.idxid || item.indexid}
      idxname: ${item.idxname}
      indexingkey: ${item.indexingkey}
      keycol: ${item.keycol}
      filepath: ${item.filepath}
      network: ${item.network || networkFromPath}
      blocknum: ${item.blocknum || 0}
      fromblock: ${item.fromblock || 0}
      keysize: ${item.keysize || 30}
      address: ${item.address || 'localhost:50052'}
      callcnt: ${item.callcnt || 0}
      keycnt: ${item.keycnt || 0}
      indexdatacnt: ${item.indexdatacnt || 0}`;
      }).join('\n');

      fs.writeFileSync(configPath, yamlContent, 'utf8');
      console.log(`✅ Index ${indexId} deleted from config.yaml`);
    }

    res.json({
      success: true,
      deletedIndexId: indexId,
      message: 'Index deleted successfully'
    });

  } catch (error) {
    console.error('Index deletion error:', error);
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
