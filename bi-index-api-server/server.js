const express = require('express');
const cors = require('cors');
const path = require('path');
const grpc = require('@grpc/grpc-js');
const protoLoader = require('@grpc/proto-loader');

// CLI.js에서 가져온 클라이언트들 (정확한 경로)
const IndexingClient = require('../indexing-client-package/lib/indexing-client');
const FabricIndexingClient = require('../contract/scripts/fabric-indexing-client');
// 공통 경로 설정 (CLI.js와 동일)
const PROTO_PATH = path.join(__dirname, '../idxmngr-go/protos/index_manager.proto');

// 지갑 주소 해시 함수 (CLI.js에서 가져옴)
function hashWalletAddress(address) {
  let hash = 0;
  for (let i = 0; i < address.length; i++) {
    const char = address.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash;
  }
  return Math.abs(hash).toString(16).slice(0, 8);
}

const app = express();
app.use(cors());
app.use(express.json());

// 헬스체크 엔드포인트
app.get('/api/health', async (req, res) => {
  try {
    res.json({
      success: true,
      message: 'API 서버 정상 작동',
      timestamp: new Date().toISOString(),
      services: {
        evm: { connected: true, networks: ['hardhat', 'monad'] },
        indexing: { connected: true, port: 50052 }
      }
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// =========================
// EVM 관련 엔드포인트들
// =========================

// EVM Access 요청 (트랜잭션 + 인덱싱)
app.post('/api/evm/access-request', async (req, res) => {
  try {
    const { network, purpose, walletAddress } = req.body;
    
    console.log(`🔐 EVM Access 요청: ${network}/${purpose}`);
    
    // TODO: CLI.js의 requestData 함수 이식
    // 1. EVM 트랜잭션 발생
    // 2. 트랜잭션 성공 후 인덱싱
    // 3. addToPurposeIndexEVM + addToWalletIndex 호출
    
    // 현재는 Mock 응답
    const result = {
      success: true,
      network: network,
      purpose: purpose,
      walletAddress: walletAddress,
      txHash: `0x${Math.random().toString(16).slice(2, 66)}`,
      message: `${network} 네트워크에서 Access 요청 완료`,
      indexing: {
        walletIndex: 'completed',
        purposeIndex: 'completed'
      },
      timestamp: new Date().toISOString()
    };
    
    console.log('✅ EVM Access 요청 성공:', result);
    res.json(result);
    
  } catch (error) {
    console.error('❌ EVM Access 요청 실패:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// =========================
// Fabric 관련 엔드포인트들  
// =========================

// PVD 데이터 저장 (gRPC + 인덱싱)
app.post('/api/fabric/pvd-data', async (req, res) => {
  try {
    const { obuId, pvdData } = req.body;
    
    console.log(`📤 Fabric PVD 데이터 저장: ${obuId}`);
    
    // TODO: CLI.js의 putPvdData 함수 이식
    // 1. Fabric gRPC 호출
    // 2. 성공 후 인덱싱
    
    // 현재는 Mock 응답
    const result = {
      success: true,
      network: 'fabric',
      obuId: obuId,
      txId: `fabric_${obuId}_${Date.now()}`,
      speed: pvdData?.speed || 60,
      latitude: pvdData?.latitude || 37.5665,
      longitude: pvdData?.longitude || 126.9780,
      message: 'Fabric PVD 데이터 저장 완료',
      indexing: {
        speedIndex: 'completed',
        locationIndex: 'completed'
      },
      timestamp: new Date().toISOString()
    };
    
    console.log('✅ Fabric PVD 저장 성공:', result);
    res.json(result);
    
  } catch (error) {
    console.error('❌ Fabric PVD 저장 실패:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// =========================
// 인덱싱 관련 엔드포인트들
// =========================

// 인덱스 생성 (CLI.js의 createIndexUnified 이식)
app.post('/api/index/create', async (req, res) => {
  try {
    const { network, indexType, walletAddress } = req.body;
    
    console.log(`🔧 ${network} 네트워크에 ${indexType} 인덱스 생성 중...`);
    
    if (network === 'fabric') {
      // Fabric 네트워크 처리
      console.log(`📊 Fabric 네트워크 - ${indexType} 인덱스 생성...`);
      
      const indexingClient = new FabricIndexingClient({
        serverAddr: 'localhost:50052',
        protoPath: path.join(__dirname, '../grpc-go/protos/index_manager.proto')
      });
      
      try {
        await indexingClient.connect();
        
        const indexRequest = {
          IndexID: indexType,
          ColName: indexType === 'purpose' ? 'IndexableData' : 'IndexableData',
          ColIndex: indexType,
          KeyCol: indexType === 'purpose' ? 'IndexableData' : 'IndexableData',
          FilePath: `data/fabric/${indexType}.bf`,
          Network: 'fabric',
          KeySize: 64
        };
        
        console.log(`📤 Fabric ${indexType} 인덱스 생성 요청 전송 중...`);
        
        const result = await indexingClient.createIndex(indexRequest);
        console.log(`📥 Fabric ${indexType} 인덱스 생성 응답:`, JSON.stringify(result, null, 2));
        
        await indexingClient.close();
        console.log(`🔌 Fabric 인덱싱 클라이언트 연결 종료`);
        
        res.json({
          success: true,
          network: 'fabric',
          indexType: indexType,
          indexId: indexType,
          message: `Fabric ${indexType} 인덱스 생성 완료`,
          result: result,
          timestamp: new Date().toISOString()
        });
        
      } catch (error) {
        console.error(`❌ Fabric ${indexType} 인덱스 생성 실패: ${error.message}`);
        throw error;
      }
      
    } else {
      // EVM 계열 네트워크 처리
      console.log(`📊 ${network} 네트워크 - ${indexType} 인덱스 생성...`);
      
      const indexingClient = new IndexingClient({
        serverAddr: 'localhost:50052',
        protoPath: PROTO_PATH
      });
      
      try {
        await indexingClient.connect();
        console.log('✅ 인덱싱 서버 연결 성공');
        
        // 네트워크별 디렉토리 매핑
        const networkDir = network === 'hardhat' ? 'hardhat-local' : network;
        
        // EVM 네트워크용: 지갑 주소가 있으면 사용, 없으면 타입만 사용
        let indexID, filePath;
        
        if (walletAddress) {
          // 지갑 주소가 있는 경우
          const addressHash = hashWalletAddress(walletAddress);
          console.log(`📱 ${indexType} 타입 → 지갑 주소: ${walletAddress} → 해시: ${addressHash}`);
          indexID = `${indexType}_${addressHash}`;
          filePath = `data/${networkDir}/${indexType}_${addressHash}.bf`;
        } else {
          // 지갑 주소가 없는 경우
          console.log(`📊 ${indexType} 타입 → 순수 타입 인덱스`);
          indexID = indexType;
          filePath = `data/${networkDir}/${indexType}.bf`;
        }
        
        const createRequest = {
          IndexID: indexID,
          IndexName: `${network.toUpperCase()} ${indexType.toUpperCase()} Index`,
          KeyCol: 'IndexableData',
          FilePath: filePath,
          KeySize: 64
        };
        
        console.log(`🔧 인덱스 생성 요청:`, createRequest);
        
        const response = await indexingClient.createIndex(createRequest);
        console.log(`✅ ${indexType} 인덱스 생성 완료!`);
        console.log(`📍 인덱스 파일: ${filePath}`);
        
        indexingClient.close();
        
        res.json({
          success: true,
          network: network,
          indexType: indexType,
          indexId: indexID,
          filePath: filePath,
          message: `${network} ${indexType} 인덱스 생성 완료`,
          result: response,
          timestamp: new Date().toISOString()
        });
        
      } catch (error) {
        console.error(`❌ ${network} ${indexType} 인덱스 생성 실패: ${error.message}`);
        throw error;
      }
    }
    
  } catch (error) {
    console.error('❌ 인덱스 생성 실패:', error);
    res.status(500).json({
      success: false,
      error: error.message,
      timestamp: new Date().toISOString()
    });
  }
});

// 인덱스 전체 검색 (CLI.js의 searchIndexAll 이식)
app.post('/api/index/search-all', async (req, res) => {
  try {
    const { network, indexType, walletAddress } = req.body;
    
    console.log(`🔍 ${network} 네트워크의 ${indexType} 인덱스 전체 조회 시작...`);
    
    if (network === 'fabric') {
      // Fabric 네트워크 처리 (향후 구현)
      res.json({
        success: false,
        message: 'Fabric 검색은 아직 구현되지 않았습니다',
        timestamp: new Date().toISOString()
      });
      return;
      
    } else {
      // EVM 계열 네트워크 처리
      console.log(`📊 ${network} 네트워크 인덱스에서 전체 데이터 조회...`);
      
      const indexingClient = new IndexingClient({
        serverAddr: 'localhost:50052',
        protoPath: PROTO_PATH
      });
      
      try {
        await indexingClient.connect();
        console.log('✅ 인덱싱 서버 연결 성공');
        
        // EVM 네트워크에서 지갑 주소 처리
        const networkDir = (network === 'hardhat' || network === 'localhost') ? 'hardhat-local' : network;
        
        let indexID, filePath;
        
        if (walletAddress) {
          // 지갑 주소가 제공된 경우
          if (!/^0x[a-fA-F0-9]{40}$/.test(walletAddress)) {
            throw new Error('올바르지 않은 지갑 주소 형식입니다. 올바른 형식: 0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC');
          }
          
          console.log(`📱 지갑 주소 기반 검색: ${walletAddress}`);
          const addressHash = hashWalletAddress(walletAddress);
          indexID = `${indexType}_${addressHash}`;
          filePath = `data/${networkDir}/${indexType}_${addressHash}.bf`;
        } else {
          // 지갑 주소가 없는 경우 - 순수 인덱스 타입만 사용
          console.log(`📊 순수 인덱스 타입 검색: ${indexType}`);
          indexID = indexType;
          filePath = `data/${networkDir}/${indexType}.bf`;
        }
        
        // 전체 데이터 조회를 위한 Range 검색 (한글 포함)
        const searchRequest = {
          IndexID: indexID,
          Field: 'IndexableData',
          Begin: '',        // 시작값 (빈 문자열 = 최소값)
          End: '\uFFFF',    // 끝값 (유니코드 최대값 - 한글 포함)
          FilePath: filePath,
          KeySize: 64,
          ComOp: 'Range'    // Range 검색으로 모든 데이터 조회
        };
        
        console.log(`🔧 검색 요청:`, searchRequest);
        
        const result = await indexingClient.searchData(searchRequest);
        
        indexingClient.close();
        
        res.json({
          success: true,
          network: network,
          indexType: indexType,
          walletAddress: walletAddress || null,
          indexID: indexID,
          filePath: filePath,
          searchRequest: searchRequest,
          results: result,
          message: `${network} ${indexType} 인덱스 전체 조회 완료`,
          timestamp: new Date().toISOString()
        });
        
      } catch (error) {
        console.error(`❌ ${network} ${indexType} 인덱스 검색 실패: ${error.message}`);
        throw error;
      }
    }
    
  } catch (error) {
    console.error('❌ 인덱스 검색 실패:', error);
    res.status(500).json({
      success: false,
      error: error.message,
      timestamp: new Date().toISOString()
    });
  }
});

// Purpose 인덱스에 데이터 추가 (CLI.js의 addToPurposeIndexEVM 이식)
app.post('/api/index/add-purpose', async (req, res) => {
  try {
    const { purpose, txHash, network, organizationName } = req.body;
    
    console.log(`📝 Purpose 인덱스에 저장 중: ${purpose} → ${txHash}`);
    
    // EVM 네트워크만 지원
    if (network === 'fabric') {
      throw new Error('Fabric 네트워크는 지원하지 않습니다. EVM 네트워크를 사용하세요.');
    }
    
    const indexingClient = new IndexingClient({
      serverAddr: 'localhost:50052',
      protoPath: PROTO_PATH
    });
    
    try {
      await indexingClient.connect();
      console.log('✅ 인덱싱 서버 연결 성공');
      
      const networkDir = (network === 'hardhat' || network === 'localhost') ? 'hardhat-local' : network;
      const indexID = 'purpose';
      const filePath = `data/${networkDir}/purpose.bf`;
      
      // IndexableData 안에 purpose를 포함하여 동적 인덱싱
      const insertRequest = {
        IndexID: indexID,
        BcList: [{
          TxId: txHash,
          KeyCol: 'IndexableData',
          IndexableData: {
            TxId: txHash,
            ContractAddress: network === 'monad' ? '0x23EC7332865ecD204539f5C3535175C22D2C6388' : '0x5FbDB2315678afecb367f032d93F642f64180aa3',
            EventName: 'AccessRequestsSaved',
            Timestamp: new Date().toISOString(),
            BlockNumber: 0,
            DynamicFields: {
              "key": purpose,  // purpose를 직접 키로 사용
              "purpose": purpose,
              "organizationName": organizationName || 'Unknown',
              "network": network,
              "timestamp": new Date().toISOString()
            },
            SchemaVersion: "1.0"
          }
        }],
        ColName: 'IndexableData',
        ColIndex: indexID,
        FilePath: filePath,
        Network: network
      };
      
      console.log(`📝 Purpose 인덱스 저장: ${purpose} → ${txHash}`);
      await indexingClient.insertData(insertRequest);
      
      // 안전한 인덱싱을 위한 대기
      await new Promise(resolve => setTimeout(resolve, 500));
      
      indexingClient.close();
      
      res.json({
        success: true,
        purpose: purpose,
        txHash: txHash,
        network: network,
        organizationName: organizationName,
        indexID: indexID,
        filePath: filePath,
        message: `Purpose 인덱스에 데이터 저장 완료: ${purpose}`,
        timestamp: new Date().toISOString()
      });
      
    } catch (error) {
      console.error(`❌ Purpose 인덱스 추가 실패: ${error.message}`);
      throw error;
    }
    
  } catch (error) {
    console.error('❌ Purpose 데이터 삽입 실패:', error);
    res.status(500).json({
      success: false,
      error: error.message,
      timestamp: new Date().toISOString()
    });
  }
});

// Purpose 검색 엔드포인트
app.post('/api/index/search-purpose', async (req, res) => {
  try {
    const { network, purpose } = req.body;
    
    if (!network || !purpose) {
      return res.status(400).json({
        success: false,
        error: 'network와 purpose 파라미터가 필요합니다',
        timestamp: new Date().toISOString()
      });
    }
    
    console.log(`🔍 Purpose 검색 요청: ${network}/${purpose}`);
    
    // EVM 네트워크만 지원
    if (network === 'fabric') {
      return res.status(400).json({
        success: false,
        error: 'Fabric 네트워크는 지원하지 않습니다. EVM 네트워크를 사용하세요.',
        timestamp: new Date().toISOString()
      });
    }
    
    const indexingClient = new IndexingClient({
      serverAddr: 'localhost:50052',
      protoPath: require('path').join(__dirname, '../idxmngr-go/protos/index_manager.proto')
    });
    
    await indexingClient.connect();
    console.log('✅ 인덱싱 서버 연결 성공');
    
    const networkDir = (network === 'hardhat' || network === 'localhost') ? 'hardhat-local' : network;
    const indexID = 'purpose';
    const filePath = `data/${networkDir}/purpose.bf`;
    
    // Purpose 값으로 검색 (key 필드에 purpose가 저장되어 있음)
    const searchRequest = {
      IndexID: indexID,
      Field: 'IndexableData',
      Value: purpose,
      FilePath: filePath,
      KeySize: 64,
      ComOp: 'Eq'
    };
    
    console.log(`🔧 검색 요청:`, searchRequest);
    
    const result = await indexingClient.searchData(searchRequest);
    
    indexingClient.close();
    
    // 결과 정리 및 응답
    const cleanResult = {
      success: true,
      purpose: purpose,
      indexId: indexID,
      data: result.IdxData || [],
      count: result.IdxData?.length || 0,
      network: network,
      searchRequest: searchRequest,
      results: result,
      message: `${network} ${purpose} Purpose 검색 완료`,
      timestamp: new Date().toISOString()
    };
    
    console.log(`📊 검색 결과: ${cleanResult.count}개 데이터 발견`);
    
    res.json(cleanResult);
    
  } catch (error) {
    console.error('❌ Purpose 검색 실패:', error);
    res.status(500).json({
      success: false,
      error: error.message,
      timestamp: new Date().toISOString()
    });
  }
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(`🚀 BI-Index API Server running on http://localhost:${PORT}`);
  console.log('Available endpoints:');
  console.log('  GET  /api/health');
  console.log('  POST /api/evm/access-request');
  console.log('  POST /api/fabric/pvd-data');
  console.log('  POST /api/index/create');
  console.log('  POST /api/index/search-all');
  console.log('  POST /api/index/add-purpose');
  console.log('  POST /api/index/search-purpose');
});