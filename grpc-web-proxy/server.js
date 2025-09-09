const express = require('express');
const cors = require('cors');
const grpc = require('@grpc/grpc-js');
const protoLoader = require('@grpc/proto-loader');
const path = require('path');

const app = express();
app.use(cors());
app.use(express.json());

// Proto 파일 로드
const indexProtoPath = path.join(__dirname, '../idxmngr-go/protos/index_manager.proto');
const pvdProtoPath = path.join(__dirname, '../grpc-go/protos/pvd_hist.proto');

const indexPackageDefinition = protoLoader.loadSync(indexProtoPath, {
  keepCase: true,
  longs: String,
  enums: String,
  defaults: true,
  oneofs: true,
});

const pvdPackageDefinition = protoLoader.loadSync(pvdProtoPath, {
  keepCase: true,
  longs: String,
  enums: String,
  defaults: true,
  oneofs: true,
});

const indexProto = grpc.loadPackageDefinition(indexPackageDefinition);
const pvdProto = grpc.loadPackageDefinition(pvdPackageDefinition);

// gRPC 클라이언트 생성
const indexClient = new indexProto.idxmngrapi.Index_manager('localhost:50052', grpc.credentials.createInsecure());
const pvdClient = new pvdProto.pvdapi.Pvd('localhost:19001', grpc.credentials.createInsecure());

// HTTP → gRPC 프록시 엔드포인트
app.post('/api/create-index', (req, res) => {
  const { network, indexType, walletAddress } = req.body;
  
  // gRPC 요청 생성
  const request = {
    IndexID: indexType,
    IndexName: `${network.toUpperCase()} ${indexType.toUpperCase()} Index`,
    KeyCol: 'IndexableData',
    FilePath: `data/${network}/${indexType}.bf`,
    KeySize: 64
  };
  
  // gRPC 호출
  indexClient.CreateIndexRequest(request, (error, response) => {
    if (error) {
      console.error('gRPC Error:', error);
      res.status(500).json({ success: false, error: error.message });
    } else {
      res.json({ 
        success: true, 
        network, 
        indexType, 
        response: response 
      });
    }
  });
});

app.post('/api/put-pvd-data', (req, res) => {
  const { obuId, pvdData } = req.body;
  
  // PVD gRPC 요청
  const request = {
    ChainInfo: {
      ChannelName: 'pvdchannel',
      Chaincode: 'pvd'
    },
    Pvd: {
      Obu_id: obuId,
      Speed: pvdData.speed || 65,
      Collection_dt: pvdData.collectionDt || new Date().toISOString(),
      // ... 기타 PVD 필드들
    }
  };
  
  pvdClient.putData(request, (error, response) => {
    if (error) {
      res.status(500).json({ success: false, error: error.message });
    } else {
      res.json({ success: true, obuId, response: response });
    }
  });
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(`🚀 gRPC-Web Proxy Server running on port ${PORT}`);
  console.log(`📡 Proxying to:`);
  console.log(`   - Index Server: localhost:50052`);
  console.log(`   - PVD Server: localhost:19001`);
});
