const express = require('express');
const cors = require('cors');
const fs = require('fs');
const ethers = require('ethers');
// gRPC 게이트웨이 클라이언트 (idxmngr와 직접 통신)
const IndexingGateway = require('../lib/indexing-client');
const IndexingClient = IndexingGateway;  // 별칭
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
  // idxmngr-go protobuf 파일만 사용
  return path.join(__dirname, '../../bi-index/idxmngr-go/protos/index_manager.proto');
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
      keySize, // keySize 추가
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
    // keySize 처리: 요청에서 받은 값 또는 기본값 사용
    const effectiveKeySize = Number(keySize) > 0 ? Number(keySize) : INDEX_KEY_SIZE;
    
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
      KeySize: effectiveKeySize, // KeySize 추가
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

    // Create proper DynamicFields object - 모든 값을 문자열로 변환
    const dynamicFields = {
      "key": String(dynamicKey),
      "network": String(network),
      "timestamp": new Date().toISOString(),
      "purpose": String(data.purpose || ''),
      "organization": String(data.organization || ''),
      "requester": String(data.requester || ''),
      "blockNumber": String(data.blockNumber || 0),
      "txStatus": String(data.txStatus || 1)
    };

    // Ensure all data fields are properly included - 모든 값을 문자열로 변환
    Object.keys(data).forEach(key => {
      if (data[key] !== undefined && data[key] !== null) {
        dynamicFields[key] = String(data[key]);
      }
    });

    console.log(`DynamicFields created:`, dynamicFields);

    const indexingGateway = await initGateway();
    
    // EventName을 요청에서 받거나 기본값 사용
    const eventName = req.body.eventName || data.eventName || 'AccessRequestsSaved';
    
    const indexableDataObj = {
      TxId: txId,
      ContractAddress: contractAddress,
      EventName: eventName,
      Timestamp: new Date().toISOString(),
      BlockNumber: String(data.blockNumber || 0), // uint64를 문자열로 변환 (gRPC longs: String 옵션)
      DynamicFields: dynamicFields, // 이미 문자열로 변환됨
      SchemaVersion: "1.0"
    };
    
    console.log('🔍 IndexableData 객체:', JSON.stringify(indexableDataObj, null, 2));
    
    // indexingKey를 사용 (예: "purpose")
    const usedIndexingKey = indexingKey || matchedConfig.indexingkey || 'purpose';
    
    const result = await indexingGateway.insertData({
      IndexID: resolvedIndexId,
      BcList: [{
        TxId: txId,
        key_col: 'IndexableData', // protobuf 정의와 일치하도록 key_col로 변경
        IndexableData: {
          TxId: txId,
          ContractAddress: contractAddress,
          EventName: eventName,  // 동적 이벤트명 사용
          Timestamp: new Date().toISOString(),
          BlockNumber: String(data.blockNumber || 0), // uint64를 문자열로 변환
          DynamicFields: dynamicFields, // 이미 문자열로 변환됨
          SchemaVersion: "1.0"
        }
      }],
      ColName: 'IndexableData',
      ColIndex: usedIndexingKey, // indexingKey 사용 (예: "purpose")
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

// =========================
// 🔹 범용 인덱스 데이터 조회 API (Raw)
// =========================
app.get('/api/index/raw', async (req, res) => {
  try {
    const { indexId, network = 'hardhat-local', limit = 100 } = req.query;
    
    if (!indexId) {
      return res.status(400).json({
        success: false,
        error: 'indexId 파라미터가 필요합니다.',
        example: '/api/index/raw?indexId=002&network=hardhat-local'
      });
    }
    
    console.log(`\n📦 범용 인덱스 조회 - IndexID: ${indexId}, Network: ${network}`);
    
    // IndexingClient 생성
    const indexingClient = new IndexingClient({
      serverAddr: 'localhost:50052',
      protoPath: '/home/blockchain/fedblock/bi-index/idxmngr-go/protos/index_manager.proto'
    });
    
    await indexingClient.connect();
    
    // 인덱스 목록에서 확인
    const indexList = await indexingClient.getIndexList();
    const targetIndex = indexList.find(idx => 
      idx.idxid === indexId && idx.network === network
    );
    
    if (!targetIndex) {
      await indexingClient.close();
      return res.status(404).json({
        success: false,
        error: `IndexID ${indexId} (${network})를 찾을 수 없습니다.`
      });
    }
    
    console.log(`✅ 인덱스 발견: ${targetIndex.idxname}`);
    
    // 인덱스에서 데이터 조회 (간단하게 처리)
    // 실제로는 인덱스에서 txId 목록을 가져와야 하지만, 
    // 여기서는 블록체인에서 직접 조회
    
    await indexingClient.close();
    
    res.json({
      success: true,
      indexId: indexId,
      network: network,
      indexInfo: {
        idxname: targetIndex.idxname,
        indexingkey: targetIndex.indexingkey,
        filepath: targetIndex.filepath
      },
      message: '인덱스 정보 조회 성공. 실제 데이터는 특화 API 또는 컨트랙트로 조회하세요.',
      timestamp: new Date().toISOString()
    });
    
  } catch (error) {
    console.error('❌ 범용 인덱스 조회 실패:', error);
    res.status(500).json({
      success: false,
      error: error.message,
      timestamp: new Date().toISOString()
    });
  }
});

// =========================
// 🔸 과속 데이터 조회 API (GeoJSON 특화)
// =========================
app.get('/api/pvd/speeding', async (req, res) => {
  try {
    const { network = 'hardhat-local', method = 'direct', minSpeed = 60 } = req.query;
    const startTime = Date.now();
    const speedThreshold = Number(minSpeed);
    
    console.log(`\n🗺️  과속 데이터 조회 시작 - Network: ${network}, MinSpeed: ${speedThreshold}km/h (최신 상태만)`);
    
    // 블록체인에서 직접 조회
    const rpcUrl = network === 'kaia' ? 
      'https://public-en-kairos.node.kaia.io' : 
      'http://127.0.0.1:8545';
    
    const provider = new ethers.JsonRpcProvider(rpcUrl, undefined, {
      staticNetwork: network === 'kaia' ? ethers.Network.from(1001) : undefined
    });
    
    // PvdRecord 컨트랙트 ABI (최신 상태 조회만)
    const contractABI = [
      'function getKeyLists() view returns (string[])',
      'function readPvd(string memory key) view returns (tuple(string obuId, string collectionDt, string startvectorLatitude, string startvectorLongitude, string transmisstion, uint256 speed, string hazardLights, string leftTurnSignalOn, string rightTurnSignalOn, uint256 steering, uint256 rpm, string footbrake, string gear, uint256 accelator, string wipers, string tireWarnLeftF, string tireWarnLeftR, string tireWarnRightF, string tireWarnRightR, uint256 tirePsiLeftF, uint256 tirePsiLeftR, uint256 tirePsiRightF, uint256 tirePsiRightR, uint256 fuelPercent, uint256 fuelLiter, uint256 totaldist, string rsuId, string msgId, uint256 startvectorHeading, uint256 timestamp, uint256 blockNumber))'
    ];
    
    // 최신 배포 주소 자동 로드
    const deploymentPath = path.join(__dirname, '../../bi-index/contract/scripts/pvd-deployment.json');
    let contractAddress = '0x5f3f1dBD7B74C6B46e8c44f98792A1dAf8d69154'; // fallback
    try {
      if (fs.existsSync(deploymentPath)) {
        const deployment = JSON.parse(fs.readFileSync(deploymentPath, 'utf8'));
        contractAddress = deployment.contractAddress;
        console.log(`📍 최신 컨트랙트 주소 로드: ${contractAddress}`);
      }
    } catch (err) {
      console.warn('⚠️  배포 파일 읽기 실패, 기본 주소 사용');
    }
    
    const contract = new ethers.Contract(contractAddress, contractABI, provider);
    
    let speedingData = [];
    let uniqueKeyCount = 0;
    
    try {
      // 1. 모든 키 목록 가져오기
      const allKeys = await contract.getKeyLists();
      console.log(`📋 총 ${allKeys.length}개의 키 발견`);
      uniqueKeyCount = allKeys.length;
      
      // 최신 상태 모드: 각 키의 최신 값만
      console.log('📜 블록체인에서 최신 상태 데이터 조회 중...');
      
      const BATCH_SIZE = 50;
      
      for (let i = 0; i < allKeys.length; i += BATCH_SIZE) {
        const batchKeys = allKeys.slice(i, Math.min(i + BATCH_SIZE, allKeys.length));
        
        const batchPromises = batchKeys.map(async (key) => {
          try {
            const pvd = await contract.readPvd(key);
            return pvd || null;
          } catch (error) {
            console.warn(`⚠️  키 ${key} 조회 실패`);
            return null;
          }
        });
        
        const batchResults = await Promise.all(batchPromises);
        const validData = batchResults.filter(d => d !== null);
        speedingData.push(...validData.filter(pvd => Number(pvd.speed) >= speedThreshold));
        
        if (i + BATCH_SIZE < allKeys.length) {
          await new Promise(resolve => setTimeout(resolve, 50));
        }
      }
      
      console.log(`✅ 총 ${uniqueKeyCount}개 키의 최신 상태 중 ${speedThreshold}km/h 이상 데이터 ${speedingData.length}건 발견`);
      
    } catch (contractError) {
      console.error('⚠️  컨트랙트 조회 실패:', contractError.message);
      speedingData = [];
    }
    
    const queryTime = Date.now() - startTime;
    console.log(`✅ 블록체인 조회 완료 (${queryTime}ms)`);
    
    // GeoJSON 형식으로 변환
    const geoJSON = {
      type: 'FeatureCollection',
      features: speedingData.map(pvd => ({
        type: 'Feature',
        geometry: {
          type: 'Point',
          coordinates: [
            parseFloat(pvd.startvectorLongitude),
            parseFloat(pvd.startvectorLatitude)
          ]
        },
        properties: {
          obuId: pvd.obuId,
          speed: Number(pvd.speed),
          collectionDt: pvd.collectionDt,
          timestamp: Number(pvd.timestamp),
          blockNumber: Number(pvd.blockNumber),
          heading: Number(pvd.startvectorHeading)
        }
      }))
    };
    
    res.json({
      success: true,
      network: network,
      method: 'blockchain-latest',
      totalCount: speedingData.length,
      uniqueKeyCount: uniqueKeyCount,
      queryTime: `${queryTime}ms`,
      data: geoJSON,
      timestamp: new Date().toISOString()
    });
    
  } catch (error) {
    console.error('❌ 과속 데이터 조회 실패:', error);
    res.status(500).json({
      success: false,
      error: error.message,
      timestamp: new Date().toISOString()
    });
  }
});

// =========================
// 🔸 특정 차량 과속 데이터 조회 API (인덱싱 활용)
// =========================
app.get('/api/pvd/speeding/vehicle/:obuId', async (req, res) => {
  try {
    const { obuId } = req.params;
    const { network = 'hardhat-local' } = req.query;
    const startTime = Date.now();
    
    console.log(`\n🚗 특정 차량 과속 데이터 조회 - OBU: ${obuId}, Network: ${network}`);
    
    // 1. 블록체인에서 전체 데이터 조회
    const rpcUrl = network === 'kaia' ? 
      'https://public-en-kairos.node.kaia.io' : 
      'http://127.0.0.1:8545';
    
    const provider = new ethers.JsonRpcProvider(rpcUrl, undefined, {
      staticNetwork: network === 'kaia' ? ethers.Network.from(1001) : undefined
    });
    const contractABI = [
      'function getKeyLists() view returns (string[])',
      'function readPvd(string memory key) view returns (tuple(string obuId, string collectionDt, string startvectorLatitude, string startvectorLongitude, string transmisstion, uint256 speed, string hazardLights, string leftTurnSignalOn, string rightTurnSignalOn, uint256 steering, uint256 rpm, string footbrake, string gear, uint256 accelator, string wipers, string tireWarnLeftF, string tireWarnLeftR, string tireWarnRightF, string tireWarnRightR, uint256 tirePsiLeftF, uint256 tirePsiLeftR, uint256 tirePsiRightF, uint256 tirePsiRightR, uint256 fuelPercent, uint256 fuelLiter, uint256 totaldist, string rsuId, string msgId, uint256 startvectorHeading, uint256 timestamp, uint256 blockNumber))'
    ];
    
    // 최신 배포 주소 자동 로드
    const deploymentPath = path.join(__dirname, '../../bi-index/contract/scripts/pvd-deployment.json');
    let contractAddress = '0x5f3f1dBD7B74C6B46e8c44f98792A1dAf8d69154'; // fallback
    try {
      if (fs.existsSync(deploymentPath)) {
        const deployment = JSON.parse(fs.readFileSync(deploymentPath, 'utf8'));
        contractAddress = deployment.contractAddress;
      }
    } catch (err) {
      console.warn('⚠️  배포 파일 읽기 실패, 기본 주소 사용');
    }
    
    const contract = new ethers.Contract(contractAddress, contractABI, provider);
    
    // 1. 모든 키 목록 가져오기
    const allKeys = await contract.getKeyLists();
    
    // 2. 특정 차량의 키만 필터링
    const vehicleKeys = allKeys.filter(key => key.startsWith(obuId + '::'));
    console.log(`📋 ${obuId} 차량의 키 ${vehicleKeys.length}개 발견`);
    
    // 3. 해당 차량의 데이터 조회
    const vehicleDataPromises = vehicleKeys.map(async (key) => {
      try {
        const data = await contract.readPvd(key);
        return data;
      } catch (error) {
        return null;
      }
    });
    
    const vehicleData = (await Promise.all(vehicleDataPromises)).filter(d => d !== null);
    
    // 4. 과속 데이터만 필터링
    const vehicleSpeedingData = vehicleData.filter(pvd => Number(pvd.speed) >= 80);
    
    const queryTime = Date.now() - startTime;
    console.log(`✅ ${obuId} 차량의 과속 데이터 ${vehicleSpeedingData.length}건 발견 (${queryTime}ms)`);
    
    // GeoJSON 형식으로 변환
    const geoJSON = {
      type: 'FeatureCollection',
      features: vehicleSpeedingData.map(pvd => ({
        type: 'Feature',
        geometry: {
          type: 'Point',
          coordinates: [
            parseFloat(pvd.startvectorLongitude),
            parseFloat(pvd.startvectorLatitude)
          ]
        },
        properties: {
          obuId: pvd.obuId,
          speed: Number(pvd.speed),
          collectionDt: pvd.collectionDt,
          timestamp: Number(pvd.timestamp),
          blockNumber: Number(pvd.blockNumber),
          heading: Number(pvd.startvectorHeading)
        }
      }))
    };
    
    res.json({
      success: true,
      network: network,
      obuId: obuId,
      method: 'vehicle-filter',
      totalCount: vehicleSpeedingData.length,
      queryTime: `${queryTime}ms`,
      data: geoJSON,
      timestamp: new Date().toISOString()
    });
    
  } catch (error) {
    console.error('❌ 차량별 과속 데이터 조회 실패:', error);
    res.status(500).json({
      success: false,
      error: error.message,
      timestamp: new Date().toISOString()
    });
  }
});

// =========================
// 🔸 인덱스 기반 과속 데이터 조회 API (트랜잭션 ID 리스트로 개별 조회)
// =========================
app.post('/api/pvd/speeding/by-index', async (req, res) => {
  try {
    const { minSpeed = 60, network = 'kaia' } = req.body;
    const startTime = Date.now();
    
    console.log(`\n🚀 인덱스 기반 과속 데이터 조회 - ${minSpeed}km/h 이상, Network: ${network}`);
    
    // 1단계: 인덱스에서 트랜잭션 ID 조회 (카운트 확인용)
    const IndexingClient = require('../lib/indexing-client');
    const indexingClient = new IndexingClient({
      serverAddr: 'localhost:50052',
      protoPath: path.join(__dirname, '../../bi-index/idxmngr-go/protos/index_manager.proto')
    });
    
    await indexingClient.connect();
    
    const paddedSpeed = String(minSpeed).padStart(3, '0');
    const indexResult = await indexingClient.searchData({
      IndexName: 'speeding',
      Field: 'IndexableData',
      Begin: `spd::${paddedSpeed}::`,
      End: 'spd::999::',
      ComOp: 6  // Range
    });
    
    await indexingClient.close();
    
    // 인덱스 결과 구조 확인
    console.log('🔍 인덱스 결과 구조:', Object.keys(indexResult));
    console.log('🔍 IdxData 첫 번째:', indexResult.IdxData?.[0]);
    console.log('🔍 Key 필드:', indexResult.Key);
    if (Array.isArray(indexResult.Key)) {
      console.log('🔍 Key 배열 길이:', indexResult.Key.length);
      console.log('🔍 Key 첫 3개:', indexResult.Key.slice(0, 3));
    }
    console.log('🔍 idxInfo:', indexResult.idxInfo);
    
    const txIds = indexResult.IdxData || [];
    const indexQueryTime = Date.now() - startTime;
    console.log(`✅ 인덱스 조회 완료: ${txIds.length}건 (${indexQueryTime}ms)`);
    
    // 2단계: 인덱스의 txHash로 트랜잭션 조회 → 키 추출 → readPvd
    const rpcUrl = network === 'kaia' ? 
      'https://public-en-kairos.node.kaia.io' : 
      'http://127.0.0.1:8545';
    
    console.log(`🔗 블록체인 RPC 연결: ${rpcUrl}`);
    const provider = new ethers.JsonRpcProvider(rpcUrl, undefined, {
      staticNetwork: network === 'kaia' ? ethers.Network.from(1001) : undefined
    });
    
    const contractABI = [
      'function readPvd(string memory key) view returns (tuple(string obuId, string collectionDt, string startvectorLatitude, string startvectorLongitude, string transmisstion, uint256 speed, string hazardLights, string leftTurnSignalOn, string rightTurnSignalOn, uint256 steering, uint256 rpm, string footbrake, string gear, uint256 accelator, string wipers, string tireWarnLeftF, string tireWarnLeftR, string tireWarnRightF, string tireWarnRightR, uint256 tirePsiLeftF, uint256 tirePsiLeftR, uint256 tirePsiRightF, uint256 tirePsiRightR, uint256 fuelPercent, uint256 fuelLiter, uint256 totaldist, string rsuId, string msgId, uint256 startvectorHeading, uint256 timestamp, uint256 blockNumber))',
      'function createUpdatePvd(string memory obuId, tuple(string obuId, string collectionDt, string startvectorLatitude, string startvectorLongitude, string transmisstion, uint256 speed, string hazardLights, string leftTurnSignalOn, string rightTurnSignalOn, uint256 steering, uint256 rpm, string footbrake, string gear, uint256 accelator, string wipers, string tireWarnLeftF, string tireWarnLeftR, string tireWarnRightF, string tireWarnRightR, uint256 tirePsiLeftF, uint256 tirePsiLeftR, uint256 tirePsiRightF, uint256 tirePsiRightR, uint256 fuelPercent, uint256 fuelLiter, uint256 totaldist, string rsuId, string msgId, uint256 startvectorHeading, uint256 timestamp, uint256 blockNumber) pvd) returns (string)'
    ];
    
    const deploymentPath = path.join(__dirname, '../../bi-index/contract/scripts/pvd-deployment.json');
    let contractAddress = '0xe452Ae89B6c187F8Deee162153F946f07AF7aA82';
    try {
      if (fs.existsSync(deploymentPath)) {
        const deployment = JSON.parse(fs.readFileSync(deploymentPath, 'utf8'));
        contractAddress = deployment.contractAddress;
      }
    } catch (err) {
      console.warn('⚠️  배포 파일 읽기 실패, 기본 주소 사용');
    }
    
    const contract = new ethers.Contract(contractAddress, contractABI, provider);
    const iface = new ethers.Interface(contractABI);
    
    console.log(`📡 인덱스의 ${txIds.length}개 트랜잭션에서 키 추출 중...`);
    const blockchainStartTime = Date.now();
    
    // Step 1: 모든 txHash에서 키 추출
    const EXTRACT_BATCH_SIZE = 50;
    const extractedKeys = [];
    let extractFailCount = 0;
    
    for (let i = 0; i < txIds.length; i += EXTRACT_BATCH_SIZE) {
      const batch = txIds.slice(i, i + EXTRACT_BATCH_SIZE);
      
      const batchPromises = batch.map(async (txHash) => {
        try {
          const tx = await provider.getTransaction(txHash);
          if (!tx || !tx.data) return null;
          
          const decoded = iface.parseTransaction({ data: tx.data });
          if (!decoded) return null;
          
          return decoded.args[0];  // 키 반환
        } catch (error) {
          return null;
        }
      });
      
      const batchResults = await Promise.all(batchPromises);
      const validKeys = batchResults.filter(key => key !== null);
      extractedKeys.push(...validKeys);
      extractFailCount += (batchResults.length - validKeys.length);
    }
    
    // Step 2: 키 중복 제거
    const uniqueKeys = [...new Set(extractedKeys)];
    console.log(`   추출된 키: ${extractedKeys.length}개 (고유 키: ${uniqueKeys.length}개, 중복: ${extractedKeys.length - uniqueKeys.length}개)`);
    
    // Step 3: 고유 키로 블록체인 조회 (최신 상태만)
    console.log(`📋 ${uniqueKeys.length}개 고유 키로 블록체인 조회 중... (최신 상태)`);
    
    const QUERY_BATCH_SIZE = 100;
    const speedingData = [];
    let totalResults = 0;
    
    for (let i = 0; i < uniqueKeys.length; i += QUERY_BATCH_SIZE) {
      const batch = uniqueKeys.slice(i, i + QUERY_BATCH_SIZE);
      
      const batchPromises = batch.map(async (key) => {
        try {
          // 최신 상태 조회: 최신 값만
          const pvd = await contract.readPvd(key);
          return pvd ? [pvd] : [];
        } catch (error) {
          return [];
        }
      });
      
      const batchResults = await Promise.all(batchPromises);
      
      // 모든 결과를 평면화하고 속도 필터링
      batchResults.forEach(results => {
        if (Array.isArray(results)) {
          totalResults += results.length;
          const filtered = results.filter(pvd => Number(pvd.speed) >= minSpeed);
          speedingData.push(...filtered);
        }
      });
      
      if ((i + QUERY_BATCH_SIZE) % 200 === 0 || i + QUERY_BATCH_SIZE >= uniqueKeys.length) {
        const progress = ((i + QUERY_BATCH_SIZE) / uniqueKeys.length * 100).toFixed(1);
        console.log(`   진행: ${Math.min(i + QUERY_BATCH_SIZE, uniqueKeys.length)}/${uniqueKeys.length} (${progress}%) | ${minSpeed}km/h 이상: ${speedingData.length}건`);
      }
      
      if (i + QUERY_BATCH_SIZE < uniqueKeys.length) {
        await new Promise(resolve => setTimeout(resolve, 50));
      }
    }
    
    const blockchainQueryTime = Date.now() - blockchainStartTime;
    const totalQueryTime = Date.now() - startTime;
    console.log(`✅ 블록체인 조회 및 필터링 완료 (${blockchainQueryTime}ms)`);
    console.log(`   인덱스 트랜잭션: ${txIds.length}건`);
    console.log(`   고유 키: ${uniqueKeys.length}개`);
    console.log(`   최신 상태: ${totalResults}건`);
    console.log(`   ${minSpeed}km/h 이상: ${speedingData.length}건`);
    
    // GeoJSON 형식으로 변환
    const geoJSON = {
      type: 'FeatureCollection',
      features: speedingData.map(pvd => ({
        type: 'Feature',
        geometry: {
          type: 'Point',
          coordinates: [
            parseFloat(pvd.startvectorLongitude),
            parseFloat(pvd.startvectorLatitude)
          ]
        },
        properties: {
          obuId: pvd.obuId,
          speed: Number(pvd.speed),
          collectionDt: pvd.collectionDt,
          timestamp: Number(pvd.timestamp),
          blockNumber: Number(pvd.blockNumber),
          heading: Number(pvd.startvectorHeading),
          txHash: pvd.txHash || null
        }
      }))
    };
    
    res.json({
      success: true,
      network: network,
      method: 'index-latest',
      minSpeed: minSpeed,
      indexQueryTime: `${indexQueryTime}ms`,
      blockchainQueryTime: `${totalQueryTime - indexQueryTime}ms`,
      totalQueryTime: `${totalQueryTime}ms`,
      indexCount: txIds.length,
      uniqueKeys: uniqueKeys.length,
      totalResults: totalResults,
      resultCount: speedingData.length,
      data: geoJSON,
      timestamp: new Date().toISOString()
    });
    
  } catch (error) {
    console.error('❌ 인덱스 기반 과속 데이터 조회 실패:', error);
    res.status(500).json({
      success: false,
      error: error.message,
      timestamp: new Date().toISOString()
    });
  }
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

    // 임시로 빈 데이터 반환 (컨트랙트 함수가 구현되지 않아서)
    res.json({
      success: true,
      data: {
        success: true,
        method: 'contract-paging-query',
        network: network,
        totalCount: 0,
        requests: [],
        totalPages: 0,
        pageSize: parseInt(pageSize)
      },
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
    
    // IndexName만 필수
    if (!searchParams.IndexName) {
      return res.status(400).json({ error: 'IndexName이 필요합니다' });
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

// =========================
// 🔸 블록체인 통계 조회 API
// =========================
app.get('/api/blockchain/stats', async (req, res) => {
  try {
    const { network = 'kaia' } = req.query;
    
    console.log(`\n📊 블록체인 통계 조회 - Network: ${network}`);
    
    const rpcUrl = network === 'kaia' ? 
      'https://public-en-kairos.node.kaia.io' : 
      'http://127.0.0.1:8545';
    
    const provider = new ethers.JsonRpcProvider(rpcUrl, undefined, {
      staticNetwork: network === 'kaia' ? ethers.Network.from(1001) : undefined
    });
    
    const contractABI = [
      'function getTotalRecordCount() view returns (uint256)'
    ];
    
    // 최신 배포 주소 로드
    const deploymentPath = path.join(__dirname, '../../bi-index/contract/scripts/pvd-deployment.json');
    let contractAddress = '0xe452Ae89B6c187F8Deee162153F946f07AF7aA82';
    try {
      if (fs.existsSync(deploymentPath)) {
        const deployment = JSON.parse(fs.readFileSync(deploymentPath, 'utf8'));
        contractAddress = deployment.contractAddress;
      }
    } catch (err) {
      console.warn('⚠️  배포 파일 읽기 실패, 기본 주소 사용');
    }
    
    const contract = new ethers.Contract(contractAddress, contractABI, provider);
    
    // 전체 레코드 개수 조회 (빠른 조회 - 개수만)
    console.log('⏳ getTotalRecordCount() 호출 중...');
    const totalRecordsRaw = await contract.getTotalRecordCount();
    const totalRecords = Number(totalRecordsRaw);
    
    console.log(`✅ 통계 조회 완료: ${totalRecords}건`);
    
    res.json({
      success: true,
      network: network,
      contractAddress: contractAddress,
      totalRecords: totalRecords,
      timestamp: new Date().toISOString()
    });
    
  } catch (error) {
    console.error('❌ 통계 조회 실패:', error);
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
