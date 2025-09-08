const express = require('express');
const cors = require('cors');
const path = require('path');

// 기존 CLI 클라이언트들 import
const IndexingClient = require('../indexing-client-package/lib/indexing-client');
const FabricIndexingClient = require('../contract/scripts/fabric-indexing-client');

const app = express();
app.use(cors());
app.use(express.json());

// 클라이언트들 초기화
const evmClient = new IndexingClient({
  serverAddr: 'localhost:50052',
  protoPath: path.join(__dirname, '../idxmngr-go/protos/index_manager.proto')
});

const fabricClient = new FabricIndexingClient({
  serverAddr: 'localhost:50052',
  protoPath: path.join(__dirname, '../grpc-go/protos/index_manager.proto')
});

// API 엔드포인트들
app.post('/api/create-index', async (req, res) => {
  try {
    const { network, indexType, walletAddress } = req.body;
    
    if (network === 'fabric') {
      await fabricClient.connect();
      const indexRequest = {
        IndexID: indexType,
        ColName: indexType === 'purpose' ? 'IndexableData' : 'IndexableData',
        ColIndex: indexType,
        KeyCol: indexType === 'purpose' ? 'IndexableData' : 'IndexableData',
        FilePath: `data/fabric/${indexType}.bf`,
        Network: 'fabric',
        KeySize: 64
      };
      
      const result = await fabricClient.createIndex(indexRequest);
      await fabricClient.close();
      
      res.json({
        success: true,
        network: 'fabric',
        indexType: indexType,
        indexId: indexType,
        message: `Fabric ${indexType} index created successfully`,
        result: result
      });
    } else {
      // EVM 네트워크
      const networkDir = network === 'hardhat' ? 'hardhat-local' : network;
      let indexID, filePath;
      
      if (walletAddress) {
        const addressHash = hashWalletAddress(walletAddress);
        indexID = `${indexType}_${addressHash}`;
        filePath = `data/${networkDir}/${indexType}_${addressHash}.bf`;
      } else {
        indexID = indexType;
        filePath = `data/${networkDir}/${indexType}.bf`;
      }
      
      const indexRequest = {
        IndexID: indexID,
        IndexName: `${network.toUpperCase()} ${indexType.toUpperCase()} Index`,
        KeyCol: 'IndexableData',
        FilePath: filePath,
        KeySize: 64
      };
      
      const result = await evmClient.createIndex(indexRequest);
      
      res.json({
        success: true,
        network: network,
        indexType: indexType,
        indexId: indexID,
        filePath: filePath,
        message: `${network} ${indexType} index created successfully`,
        result: result
      });
    }
  } catch (error) {
    res.status(500).json({ 
      success: false, 
      error: error.message 
    });
  }
});

app.post('/api/request-data', async (req, res) => {
  try {
    const { network } = req.body;
    
    if (network === 'fabric') {
      // Fabric 데이터 요청 로직 (CLI에서 가져옴)
      res.json({
        success: true,
        network: 'fabric',
        message: 'Fabric data request completed',
        data: [] // 실제 구현 필요
      });
    } else {
      // EVM 데이터 요청 로직 (CLI에서 가져옴)
      res.json({
        success: true,
        network: network,
        message: 'EVM data request completed',
        data: [] // 실제 구현 필요
      });
    }
  } catch (error) {
    res.status(500).json({ 
      success: false, 
      error: error.message 
    });
  }
});

// 유틸리티 함수
function hashWalletAddress(address) {
  let hash = 0;
  for (let i = 0; i < address.length; i++) {
    const char = address.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash;
  }
  return Math.abs(hash).toString(16).slice(0, 8);
}

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(`🚀 BI-Index API Server running on http://localhost:${PORT}`);
  console.log('Available endpoints:');
  console.log('  POST /api/create-index');
  console.log('  POST /api/request-data');
});
