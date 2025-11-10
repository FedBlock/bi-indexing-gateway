/**
 * 인덱스 id 숫자만 포함 -> inferNetworkFromIndexId 현재 동작 x
 * 
 */


const express = require('express');
const cors = require('cors');
const fs = require('fs');
const ethers = require('ethers');
const swaggerUi = require('swagger-ui-express');
const YAML = require('yamljs');
// gRPC 게이트웨이 클라이언트 (idxmngr와 직접 통신)
const IndexingGateway = require('../lib/grpc-client');
const IndexingClient = IndexingGateway;  // 별칭
const {
  INDEX_SCHEMA,
  INDEX_KEY_SIZE,
  resolveNetworkKey,
  buildIndexId,
  buildIndexFilePath,
} = require('../lib/indexing-constants');
const path = require('path');

// 컨트랙트 설정 파일 import
const {
  getContractAddress,
  getRpcUrl,
  getChainId,
  getAbiPath,
  normalizeNetwork
} = require('../config/contracts.config');

const app = express();
const port = process.env.PORT || 3001;

// Middleware
// CORS 설정 - 모든 origin 허용 (개발/프로덕션 모두)
app.use(cors({
  origin: true,  // 모든 origin 허용
  credentials: true
}));
app.use(express.json());

// Swagger API 문서
const swaggerDocument = YAML.load(path.join(__dirname, '../swagger/openapi.yaml'));
app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(swaggerDocument, {
  customCss: '.swagger-ui .topbar { display: none }',
  customSiteTitle: "BI-Indexing Gateway API Docs"
}));

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
//인덱스 스키마 이름을 파일명으로 안전하게 변환하는 유틸리티 함수
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

// 블록체인 조회 재시도 헬퍼 함수
const retryBlockchainCall = async (fn, maxRetries = 3, delay = 1000, operationName = '블록체인 조회') => {
  let lastError;
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const result = await fn();
      if (attempt > 1) {
        console.log(`✅ ${operationName} 성공 (${attempt}번째 시도)`);
      }
      return result;
    } catch (error) {
      lastError = error;
      const isRetryable = error.code === 'CALL_EXCEPTION' || 
                         error.message?.includes('revert') || 
                         error.message?.includes('timeout') ||
                         error.message?.includes('network') ||
                         error.message?.includes('ECONNRESET') ||
                         error.message?.includes('ETIMEDOUT');
      
      if (attempt < maxRetries && isRetryable) {
        const waitTime = delay * attempt;
        console.warn(`⚠️  ${operationName} 실패 (${attempt}/${maxRetries}): ${error.message}. ${waitTime}ms 후 재시도...`);
        await new Promise(resolve => setTimeout(resolve, waitTime));
      } else {
        if (attempt === maxRetries) {
          console.error(`❌ ${operationName} 최종 실패 (${maxRetries}회 시도): ${error.message}`);
        }
        break;
      }
    }
  }
  throw lastError;
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
      contractAddress, // 클라이언트가 지정하지 않으면 아래에서 config에서 가져옴
      indexingKey // Optional - can be extracted from data if not provided
    } = req.body;
    
    if (!txId || !data || !network) {
      return res.status(400).json({ 
        success: false, 
        error: 'Missing required fields: txId, data, network' 
      });
    }

    const networkKey = resolveNetworkKey(network);
    
    // 컨트랙트 주소가 지정되지 않았으면 config에서 가져오기
    const finalContractAddress = contractAddress || getContractAddress('pvd', network, true);
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
    
    console.log(`📝 인덱싱 요청: IndexID=${resolvedIndexId}, TxId=${txId}, Key=${dynamicKey}`);
    console.log(`Inserting data: ${resolvedIndexId}, dynamic key: ${dynamicKey}, data:`, data);

    // Create proper DynamicFields object - data에서 동적으로 추출 (범용적)
    const dynamicFields = {
      "key": String(dynamicKey),
      "network": String(network),
      "timestamp": new Date().toISOString()
    };

    // 모든 data 필드를 문자열로 변환하여 추가 (범용 API)
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
// 🔸 과속 데이터 조회 API (GeoJSON 특화)
// =========================
app.get('/api/pvd/speeding', async (req, res) => {
  try {
    const { network = 'hardhat-local', method = 'direct', minSpeed = 60 } = req.query;
    const startTime = Date.now();
    const speedThreshold = Number(minSpeed);
    
    console.log(`\n과속 데이터 조회 시작 - Network: ${network}, MinSpeed: ${speedThreshold}km/h (최신 상태만)`);
    
    // Config에서 RPC URL 및 컨트랙트 주소 가져오기
    const rpcUrl = getRpcUrl(network);
    const contractAddress = getContractAddress('pvd', network, true); // deployment 파일 우선 사용
    const chainId = getChainId(network);
    
    console.log(`✅ Config 로드 완료 - RPC: ${rpcUrl}, Contract: ${contractAddress}`);
    
    // RPC 타임아웃 설정 증가 (대량 데이터 조회를 위해)
    const fetchRequest = new ethers.FetchRequest(rpcUrl);
    fetchRequest.timeout = 600000; // 10분 타임아웃
    fetchRequest.retryFunc = () => false; // 재시도 비활성화
    
    const provider = new ethers.JsonRpcProvider(fetchRequest, undefined, {
      staticNetwork: chainId ? ethers.Network.from(chainId) : undefined,
      batchMaxCount: 1, // 배치 요청 비활성화
      polling: false
    });
    
    // Config에서 ABI 로드
    const abiPath = getAbiPath('pvd');
    const contractArtifact = JSON.parse(fs.readFileSync(abiPath, 'utf8'));
    const contractABI = contractArtifact.abi;
    
    const contract = new ethers.Contract(contractAddress, contractABI, provider);
    
    let speedingData = [];
    let uniqueKeyCount = 0;
    let contractError = null;
    
    try {
      // 1. 전체 레코드 개수 확인 (키 목록 대신)
      let totalRecords = 0;
      try {
        console.log('전체 레코드 개수 확인 중...');
        const totalRecordsRaw = await Promise.race([
          contract.getTotalRecordCount(),
          new Promise((_, reject) => setTimeout(() => reject(new Error('getTotalRecordCount timeout')), 30000)) // 30초
        ]);
        totalRecords = Number(totalRecordsRaw);
        uniqueKeyCount = totalRecords;
        console.log(`✅ 총 ${totalRecords}개의 레코드 확인`);
      } catch (countError) {
        console.warn(`⚠️  getTotalRecordCount() 실패: ${countError.message}`);
      }
      
      // 2. 모든 키 목록 가져오기 (재시도 로직 포함)
      let allKeys = [];
      try {
        console.log('키 목록 조회 중...');
        allKeys = await retryBlockchainCall(
          () => contract.getKeyLists(),
          3,
          1000,
          'getKeyLists()'
        );
        
        console.log(`✅ 키 목록 조회 성공: ${allKeys.length}개의 키 발견`);
        uniqueKeyCount = allKeys.length;
        
      } catch (keysError) {
        console.error(`❌ getKeyLists() 최종 실패 (3회 시도):`, keysError.message);
        console.log('⚠️  데이터가 많아 직접 조회 실패, 빈 결과 반환');
        
        // 타임아웃 실패 시 빈 배열로 계속 (에러 반환 안함)
        allKeys = [];
        uniqueKeyCount = 0;
      }
      
      if (allKeys.length === 0) {
        console.warn('⚠️  키 목록이 비어있습니다.');
        const queryTime = Date.now() - startTime;
        return res.json({
          success: true,
          network: network,
          method: 'blockchain-latest',
          totalCount: 0,
          uniqueKeyCount: 0,
          queryTime: `${queryTime}ms`,
          data: { type: 'FeatureCollection', features: [] },
          timestamp: new Date().toISOString(),
          warning: '키 목록이 비어있습니다'
        });
      }
      
      // 3. 최신 상태 모드: 각 키의 최신 값만 조회
      console.log(`블록체인에서 데이터 조회 중... (${allKeys.length}개 키)`);
      
      const BATCH_SIZE = 20; // 50 → 20으로 감소 (RPC 부하 감소)
      const BATCH_DELAY = 800; // 배치 간 800ms 딜레이 추가
      let processedCount = 0;
      
      for (let i = 0; i < allKeys.length; i += BATCH_SIZE) {
        const batchKeys = allKeys.slice(i, Math.min(i + BATCH_SIZE, allKeys.length));
        
        const batchPromises = batchKeys.map(async (key) => {
          try {
            const pvd = await retryBlockchainCall(
              () => contract.readPvd(key),
              3,
              1000, // 500ms → 1000ms (재시도 간격 증가)
              `readPvd(${key.slice(0, 10)}...)`
            );
            return pvd || null;
          } catch (error) {
            // 개별 키 조회 실패는 조용히 무시 (3회 시도 후)
            console.warn(`⚠️  키 ${key.slice(0, 10)}... 조회 최종 실패: ${error.message}`);
            return null;
          }
        });
        
        const batchResults = await Promise.all(batchPromises);
        const validData = batchResults.filter(d => d !== null);
        speedingData.push(...validData.filter(pvd => Number(pvd.speed) >= speedThreshold));
        
        processedCount += batchKeys.length;
        
        // 진행률 로그 (200개마다 출력)
        if (processedCount % 200 === 0 || processedCount === allKeys.length) {
          console.log(`   진행: ${processedCount}/${allKeys.length} (${((processedCount/allKeys.length)*100).toFixed(1)}%) | ${speedThreshold}km/h 이상: ${speedingData.length}건`);
        }
        
        // 배치 간 딜레이 (RPC 서버 부하 방지)
        if (i + BATCH_SIZE < allKeys.length) {
          await new Promise(resolve => setTimeout(resolve, BATCH_DELAY));
        }
      }
      
      console.log(`✅ 총 ${uniqueKeyCount}개 키의 최신 상태 중 ${speedThreshold}km/h 이상 데이터 ${speedingData.length}건 발견`);
      
    } catch (error) {
      console.error('❌ 컨트랙트 조회 실패:', error.message);
      contractError = error;
      
      const queryTime = Date.now() - startTime;
      return res.status(500).json({
        success: false,
        error: error.message,
        network: network,
        contractAddress: contractAddress,
        totalCount: 0,
        uniqueKeyCount: uniqueKeyCount,
        queryTime: `${queryTime}ms`,
        data: { type: 'FeatureCollection', features: [] },
        timestamp: new Date().toISOString(),
        suggestion: '인덱스 조회 방식을 사용하거나 데이터를 페이지네이션으로 조회해주세요.'
      });
    }
    
    const queryTime = Date.now() - startTime;
    
    if (contractError) {
      console.error(`❌ 블록체인 조회 중 에러 발생 (${queryTime}ms): ${contractError.message}`);
    } else {
      console.log(`✅ 블록체인 조회 완료 (${queryTime}ms)`);
    }
    
    // 속도 기준 오름차순 정렬 (낮은 속도 → 높은 속도)
    speedingData.sort((a, b) => {
      const speedA = Number(a.speed) || 0;
      const speedB = Number(b.speed) || 0;
      return speedA - speedB;
    });
    
    // GeoJSON 형식으로 변환 (안전한 변환)
    const geoJSON = {
      type: 'FeatureCollection',
      features: speedingData
        .filter(pvd => pvd && pvd.startvectorLongitude && pvd.startvectorLatitude)
        .map(pvd => {
          try {
            return {
              type: 'Feature',
              geometry: {
                type: 'Point',
                coordinates: [
                  parseFloat(pvd.startvectorLongitude) || 0,
                  parseFloat(pvd.startvectorLatitude) || 0
                ]
              },
              properties: {
                obuId: pvd.obuId || '',
                speed: Number(pvd.speed) || 0,
                collectionDt: pvd.collectionDt || '',
                timestamp: Number(pvd.timestamp) || 0,
                blockNumber: Number(pvd.blockNumber) || 0,
                heading: Number(pvd.startvectorHeading) || 0
              }
            };
          } catch (geoError) {
            console.warn(`⚠️  GeoJSON 변환 실패:`, geoError.message);
            return null;
          }
        })
        .filter(feature => feature !== null)
    };
    
    res.json({
      success: true,
      network: network,
      method: 'blockchain-latest',
      totalCount: speedingData.length,
      uniqueKeyCount: uniqueKeyCount,
      queryTime: `${queryTime}ms`,
      data: geoJSON,
      timestamp: new Date().toISOString(),
      ...(contractError ? { warning: `일부 에러 발생: ${contractError.message}` } : {})
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
// 🔸 인덱스 기반 과속 데이터 조회 API (트랜잭션 ID 리스트로 개별 조회)
// =========================
app.post('/api/pvd/speeding/by-index', async (req, res) => {
  try {
    const { minSpeed = 60, network = 'kaia' } = req.body;
    const startTime = Date.now();
    
    console.log(`\n🚀 인덱스 기반 과속 데이터 조회 - ${minSpeed}km/h 이상, Network: ${network}`);
    
    // 1단계: 인덱스에서 트랜잭션 ID 조회 (카운트 확인용)
    const IndexingClient = require('../lib/grpc-client');
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
    

    
    const txIds = indexResult.IdxData || [];
    const indexQueryTime = Date.now() - startTime;
    console.log(`✅ 인덱스 조회 완료: ${txIds.length}건 (${indexQueryTime}ms)`);
    
    // 2단계: 인덱스의 txHash로 트랜잭션 조회 → 키 추출 → readPvd
    // Config에서 RPC URL 및 컨트랙트 주소 가져오기
    const rpcUrl = getRpcUrl(network);
    const contractAddress = getContractAddress('pvd', network, true); // deployment 파일 우선 사용
    const chainId = getChainId(network);
    
    console.log(`✅ Config 로드 완료 - RPC: ${rpcUrl}, Contract: ${contractAddress}`);
    const provider = new ethers.JsonRpcProvider(rpcUrl, undefined, {
      staticNetwork: chainId ? ethers.Network.from(chainId) : undefined
    });
    
    // Config에서 ABI 로드
    const abiPath = getAbiPath('pvd');
    const contractArtifact = JSON.parse(fs.readFileSync(abiPath, 'utf8'));
    const contractABI = contractArtifact.abi;
    
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
          // 트랜잭션 조회 (재시도 로직 포함)
          const tx = await retryBlockchainCall(
            () => provider.getTransaction(txHash),
            3,
            500,
            `getTransaction(${txHash.slice(0, 10)}...)`
          );
          if (!tx || !tx.data) return null;
          
          const decoded = iface.parseTransaction({ data: tx.data });
          if (!decoded) return null;
          
          return decoded.args[0];  // 키 반환
        } catch (error) {
          // 트랜잭션 조회 실패는 조용히 무시 (3회 시도 후)
          console.warn(`⚠️  트랜잭션 ${txHash.slice(0, 10)}... 조회 최종 실패: ${error.message}`);
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
    // console.log(`   추출된 키: ${extractedKeys.length}개 (고유 키: ${uniqueKeys.length}개, 중복: ${extractedKeys.length - uniqueKeys.length}개)`);
    
    // Step 3: 고유 키로 블록체인 조회 (최신 상태만)
    console.log(`📋 ${uniqueKeys.length}개 고유 키로 블록체인 조회 중... (최신 상태)`);
    
    const QUERY_BATCH_SIZE = 20; // 100 → 20으로 감소 (RPC 부하 감소)
    const QUERY_BATCH_DELAY = 800; // 배치 간 800ms 딜레이
    const speedingData = [];
    let totalResults = 0;
    
    for (let i = 0; i < uniqueKeys.length; i += QUERY_BATCH_SIZE) {
      const batch = uniqueKeys.slice(i, i + QUERY_BATCH_SIZE);
      
      const batchPromises = batch.map(async (key) => {
        try {
          // 최신 상태 조회: 최신 값만 (재시도 로직 포함)
          const pvd = await retryBlockchainCall(
            () => contract.readPvd(key),
            3,
            1000, // 500ms → 1000ms (재시도 간격 증가)
            `readPvd(${key.slice(0, 10)}...)`
          );
          return pvd ? [pvd] : [];
        } catch (error) {
          // 개별 키 조회 실패는 조용히 무시 (3회 시도 후)
          console.warn(`⚠️  키 ${key.slice(0, 10)}... 조회 최종 실패: ${error.message}`);
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
      
      // 배치 간 딜레이 (RPC 서버 부하 방지)
      if (i + QUERY_BATCH_SIZE < uniqueKeys.length) {
        await new Promise(resolve => setTimeout(resolve, QUERY_BATCH_DELAY));
      }
    }
    
    const blockchainQueryTime = Date.now() - blockchainStartTime;
    const totalQueryTime = Date.now() - startTime;
    console.log(`✅ 블록체인 조회 완료: ${totalResults}건 → ${minSpeed}km/h 이상 필터링 → ${speedingData.length}건 (${blockchainQueryTime}ms)`);
    
    // 속도 기준 오름차순 정렬 (낮은 속도 → 높은 속도)
    speedingData.sort((a, b) => {
      const speedA = Number(a.speed) || 0;
      const speedB = Number(b.speed) || 0;
      return speedA - speedB;
    });
    
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

// =========================
// 🔸 블록체인 통계 조회 API
// =========================
app.get('/api/blockchain/stats', async (req, res) => {
  try {
    const { network = 'kaia' } = req.query;
    
    console.log(`\n📊 블록체인 통계 조회 - Network: ${network}`);
    
    // Config에서 RPC URL 및 컨트랙트 주소 가져오기
    const rpcUrl = getRpcUrl(network);
    const contractAddress = getContractAddress('pvd', network, true); // deployment 파일 우선 사용
    const chainId = getChainId(network);
    
    console.log(`✅ Config 로드 완료 - RPC: ${rpcUrl}, Contract: ${contractAddress}`);
    
    const provider = new ethers.JsonRpcProvider(rpcUrl, undefined, {
      staticNetwork: chainId ? ethers.Network.from(chainId) : undefined
    });
    
    // Config에서 ABI 로드
    const abiPath = getAbiPath('pvd');
    const contractArtifact = JSON.parse(fs.readFileSync(abiPath, 'utf8'));
    const contractABI = contractArtifact.abi;
    
    const contract = new ethers.Contract(contractAddress, contractABI, provider);
    
    let totalRecords = 0;
    let errorDetails = null;
    let methodUsed = null;
    
    // 방법 1: getTotalRecordCount() 시도 (가장 빠름)
    try {
      console.log('⏳ getTotalRecordCount() 호출 중...');
      // 타임아웃 설정 (10초)
      const timeoutPromise = new Promise((_, reject) => 
        setTimeout(() => reject(new Error('Timeout after 10 seconds')), 10000)
      );
      
      const totalRecordsRaw = await Promise.race([
        contract.getTotalRecordCount(),
        timeoutPromise
      ]);
      
      totalRecords = Number(totalRecordsRaw);
      methodUsed = 'getTotalRecordCount';
      console.log(`✅ getTotalRecordCount() 성공: ${totalRecords}건`);
    } catch (error1) {
      console.warn(`⚠️  getTotalRecordCount() 실패: ${error1.message}`);
      errorDetails = `getTotalRecordCount: ${error1.message}`;
      
      // 방법 2: getKeyLists() 시도 (배열 길이로 계산)
      try {
        console.log('⏳ getKeyLists() 호출 중... (대체 방법)');
        // 타임아웃 설정 (30초 - 배열이 클 수 있으므로 더 긴 시간)
        const timeoutPromise2 = new Promise((_, reject) => 
          setTimeout(() => reject(new Error('Timeout after 30 seconds')), 30000)
        );
        
        const keys = await Promise.race([
          contract.getKeyLists(),
          timeoutPromise2
        ]);
        
        totalRecords = keys.length;
        methodUsed = 'getKeyLists';
        console.log(`✅ getKeyLists() 성공: ${totalRecords}건`);
      } catch (error2) {
        console.error(`❌ getKeyLists()도 실패: ${error2.message}`);
        errorDetails = `${errorDetails}, getKeyLists: ${error2.message}`;
        
        // 방법 3: 컨트랙트 코드 확인으로 최소한의 검증
        try {
          const code = await provider.getCode(contractAddress);
          if (code === '0x' || code === '0x0') {
            throw new Error(`컨트랙트가 해당 주소에 배포되지 않았습니다: ${contractAddress}`);
          }
          console.warn(`⚠️  컨트랙트는 배포되어 있지만 함수 호출에 실패했습니다`);
          // 컨트랙트는 존재하지만 함수 호출 실패 - 0 반환
          totalRecords = 0;
          methodUsed = 'contract_exists_but_call_failed';
        } catch (error3) {
          console.error(`❌ 컨트랙트 검증도 실패: ${error3.message}`);
          // 모든 방법 실패 - 에러 반환
          throw new Error(`모든 조회 방법 실패. ${errorDetails}`);
        }
      }
    }
    
    console.log(`✅ 통계 조회 완료: ${totalRecords}건 (방법: ${methodUsed || 'unknown'})`);
    
    res.json({
      success: true,
      network: network,
      contractAddress: contractAddress,
      totalRecords: totalRecords,
      methodUsed: methodUsed,
      errorDetails: errorDetails || null,
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
  console.log(`\nBI-Indexing API Server running on http://localhost:${port}`);
  // console.log(`Started at: ${timestamp}`);
  // console.log(`Health check: http://localhost:${port}/health`);
  // console.log(` API Endpoints:`);
  // console.log(`   POST /api/search/integrated - 통합 검색`);
  // console.log(`   POST /api/search/direct - 블록체인 직접 검색`);
  // console.log(`   POST /api/search/contract - 컨트랙트 필터링 검색`);
  // console.log(`   GET  /api/requests/all - 전체 요청 조회`);
  // console.log(`   GET  /api/requests/count - 총 요청 개수`);
  // console.log(`   POST /api/requests/range - 범위별 요청 조회`);
  // console.log(`   POST /api/index/search - 인덱스 검색`);
  // console.log(`   GET  /api/performance - 성능 통계`);
  console.log(`\n서버가 요청을 대기 중입니다...`);
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
