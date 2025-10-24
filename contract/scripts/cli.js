#!/usr/bin/env node

const { ethers } = require('hardhat');
const path = require('path');
const crypto = require('crypto');
const fs = require('fs');
const yaml = require('js-yaml');
const grpc = require('@grpc/grpc-js');
const protoLoader = require('@grpc/proto-loader');
const INDEXING_CLIENT_PATH = path.resolve(__dirname, '../../../bi-indexing-gateway/lib/indexing-client');
const IndexingClient = require(INDEXING_CLIENT_PATH);
const FabricIndexingClient = require('./fabric-indexing-client');
const hre = require('hardhat');
const { runLargeScaleTest } = require('./large-scale-test');

// 공통 경로 설정
const PROTO_PATH = path.join(__dirname, '../../idxmngr-go/protos/index_manager.proto');
const CONFIG_PATH = path.join(process.cwd(), '../../idxmngr-go/config.yaml');
const NETWORK_CONFIG_PATH = path.join(__dirname, '../network_config.yaml');

// Fabric 네트워크 설정
const FABRIC_CONFIG = {
  channelName: 'pvdchannel',
  chaincode: 'pvd',
  peerEndpoint: 'localhost:7051',
  orgName: 'Org1'
};

// 명령어 플래그 파싱
const args = process.argv.slice(2);
const cmd = args.find(arg => arg.startsWith('-cmd='))?.split('=')[1] || 'help';
const network = args.find(arg => arg.startsWith('-network='))?.split('=')[1] || 'fabric';
const type = args.find(arg => arg.startsWith('-type='))?.split('=')[1] || '';
const value = args.find(arg => arg.startsWith('-value='))?.split('=')[1] || '';
const wallet = args.find(arg => arg.startsWith('-wallet='))?.split('=')[1] || '';
const contractAddress = args.find(arg => arg.startsWith('-contract='))?.split('=')[1] || '';
const yamlFlag = args.find(arg => arg.startsWith('-yaml='))?.split('=')[1] || '';

// 지갑 주소 해시 함수
function hashWalletAddress(address) {
  const hash = crypto.createHash('sha256').update(address).digest('hex');
  return hash.slice(0, 8);
}

// 네트워크별 컨트랙트 배포
async function deployContract(network) {
  try {
    console.log(`🚀 ${network} 네트워크에 컨트랙트 배포 시작...`);
    
    let provider, signer;
    
    if (network === 'hardhat') {
      // Hardhat 네트워크 사용
      [signer] = await ethers.getSigners();
      provider = ethers.provider;
      console.log(`📝 배포자 주소: ${signer.address}`);
      console.log(`🔗 네트워크: Hardhat Local (Chain ID: 1337)`);
    } else {
      // 외부 네트워크 사용 (Monad 등)
      const networkConfig = hre.config.networks[network];
      if (!networkConfig) {
        throw new Error(`hardhat.config.js에 ${network} 네트워크 설정이 없습니다.`);
      }
      
      provider = new ethers.JsonRpcProvider(networkConfig.url);
      signer = new ethers.Wallet(networkConfig.accounts[0], provider);
      
      console.log(`📝 배포자 주소: ${signer.address}`);
      console.log(`🔗 네트워크: ${network} (Chain ID: ${networkConfig.chainId})`);
    }
    
    // 컨트랙트 팩토리 생성
    const AccessManagement = await ethers.getContractFactory('AccessManagement', signer);
    
    // 컨트랙트 배포
    const contract = await AccessManagement.deploy();
    await contract.waitForDeployment();
    
    const contractAddress = await contract.getAddress();
    console.log(`✅ AccessManagement 컨트랙트 배포 완료!`);
    console.log(`📍 컨트랙트 주소: ${contractAddress}`);
    
    // 네트워크 설정 자동 업데이트
    console.log(`🔧 ${network} 네트워크 설정 자동 업데이트 완료`);
    console.log(`📝 컨트랙트 주소가 설정되었습니다: ${contractAddress}`);
    
    return contractAddress;
    
  } catch (error) {
    console.error(`❌ 컨트랙트 배포 실패: ${error.message}`);
    throw error;
  }
}





// PVD 멀티 데이터 저장 (CSV 파일 읽기, Fabric 네트워크)
async function putPvdMultiData(network, csvFile, batchSize = 1000) {
  console.log(`🚀 ${network} 네트워크에 CSV 데이터 저장 시작`);
  console.log(`📁 CSV 파일: ${csvFile}`);
  // console.log(`📦 배치 크기: ${batchSize}개씩\n`);

  if (network !== 'fabric') {
    throw new Error('CSV 멀티 데이터는 Fabric 네트워크에서만 지원됩니다');
  }

  const fs = require('fs');
  const path = require('path');
  
  // CSV 파일 경로 설정
  const csvPath = path.resolve(csvFile);
  
  if (!fs.existsSync(csvPath)) {
    throw new Error(`CSV 파일을 찾을 수 없습니다: ${csvPath}`);
  }

  try {
    console.log('📄 CSV 파일 읽는 중...');
    const csvContent = fs.readFileSync(csvPath, 'utf8');
    const lines = csvContent.trim().split('\n');
    
    if (lines.length < 2) {
      throw new Error('CSV 파일에 데이터가 없습니다');
    }
    
    const headers = lines[0].split(',');
    // console.log(`📋 CSV 헤더: ${headers.join(', ')}`);
    console.log(`📊 총 데이터 라인: ${lines.length - 1}개\n`);
    
    // 배치로 나누어서 저장
    let successCount = 0;
    let errorCount = 0;
    const totalLines = lines.length - 1;
    const totalBatches = Math.ceil(totalLines / batchSize);
    
    // console.log(`🔄 ${totalBatches}개 배치로 나누어서 저장 시작...\n`);
    
    for (let batchIndex = 0; batchIndex < totalBatches; batchIndex++) {
      const start = batchIndex * batchSize + 1; // +1 to skip header
      const end = Math.min(start + batchSize, lines.length);
      const batchLines = lines.slice(start, end);
      
      // console.log(`📦 배치 ${batchIndex + 1}/${totalBatches}: ${batchLines.length}개 데이터 저장 중...`);
      
      // 개별 방식으로 처리
      if (type === 'single') {
        // 개별 방식: 하나씩 개별 저장
        for (let i = 0; i < batchLines.length; i++) {
          const values = batchLines[i].split(',');
          
          if (values.length < 5) {
            console.log(`⚠️ 라인 스킵 (데이터 부족): ${values.join(',')}`);
            errorCount++;
            continue;
          }
          
          // CSV 데이터를 PVD 객체로 파싱
          const pvdData = {
            obuId: values[0] || `CSV-OBU-${Date.now()}-${i}`,
            collectionDt: values[1] || new Date().toISOString(),
            startvectorLatitude: parseFloat(values[2]) || 37.5665,
            startvectorLongitude: parseFloat(values[3]) || 126.9780,
            transmisstion: values[4] || 'D',
            speed: parseInt(values[5]) || 60,
            hazardLights: values[6] === 'ON',
            leftTurnSignalOn: values[7] === 'ON',
            rightTurnSignalOn: values[8] === 'ON',
            steering: parseInt(values[9]) || 0,
            rpm: parseInt(values[10]) || 2000,
            footbrake: values[11] === 'ON',
            gear: values[12] || 'D',
            accelator: parseInt(values[13]) || 30,
            wipers: values[14] === 'ON',
            tireWarnLeftF: values[15] === 'WARN',
            tireWarnLeftR: values[16] === 'WARN',
            tireWarnRightF: values[17] === 'WARN', 
            tireWarnRightR: values[18] === 'WARN',
            tirePsiLeftF: parseInt(values[19]) || 32,
            tirePsiLeftR: parseInt(values[20]) || 32,
            tirePsiRightF: parseInt(values[21]) || 32,
            tirePsiRightR: parseInt(values[22]) || 32,
            fuelPercent: parseInt(values[23]) || 75,
            fuelLiter: parseInt(values[24]) || 45,
            totaldist: parseInt(values[25]) || 15000,
            rsuId: values[26] || 'RSU-CSV-001',
            msgId: values[27] || `MSG-CSV-${i}`,
            startvectorHeading: parseInt(values[28]) || 90
          };
          
          try {
            // PVD 데이터 저장
            const result = await putPvdData(network, pvdData.obuId, pvdData);
            
            if (result.success) {
              successCount++;
              
              // 트랜잭션 ID를 PVD 데이터에 추가 (인덱싱용)
              pvdData.txId = result.txId;
              
              // PVD 클라이언트를 통해 인덱싱 처리
              const pvdClient = new PvdClient('localhost:19001');
              await pvdClient.connect();
              
              try {
                // 순차적으로 인덱싱 처리 (동시 연결 문제 방지)
                // console.log(`🔄 OBU ${pvdData.obuId} Speed 인덱싱 시작...`);
                const speedResult = await pvdClient.putSpeedIndex(pvdData);
                
                                // 짧은 지연 후 DT 인덱싱 (연결 충돌 방지)
                await new Promise(resolve => setTimeout(resolve, 500));
                
                // console.log(`🔄 OBU ${pvdData.obuId} DT 인덱싱 시작...`);
                const dtResult = await pvdClient.putDtIndex(pvdData);
                
                console.log(`📊 OBU ${pvdData.obuId} 인덱싱 처리 완료:`);
                console.log(`   - Speed: ${speedResult.success ? '✅' : '❌'}`);
                console.log(`   - DT: ${dtResult.success ? '✅' : '❌'}`);
                
              } catch (error) {
                console.warn(`⚠️ OBU ${pvdData.obuId} 인덱싱 처리 중 오류: ${error.message}`);
              } finally {
                pvdClient.close();
              }
              
              // 진행 상황 표시 (10개마다)
              if (successCount % 10 === 0) {
                process.stdout.write('.');
              }
            } else {
              errorCount++;
              console.log(`\n❌ 데이터 저장 실패 (OBU: ${pvdData.obuId}): ${result.message || '알 수 없는 오류'}`);
            }
            
          } catch (error) {
            errorCount++;
            console.log(`\n❌ 데이터 저장 실패 (OBU: ${pvdData.obuId}): ${error.message}`);
          }
          
          // 서버 부하 방지를 위한 짧은 지연
          await new Promise(resolve => setTimeout(resolve, 100));
        }
      }
      
      // console.log(`\n✅ 배치 ${batchIndex + 1} 완료\n`);
    }
    
    // console.log('\n🎉 CSV 멀티 데이터 저장 완료!');
    console.log(`📊 총 ${totalLines}개 중 ${successCount}개 성공, ${errorCount}개 실패`);
    
    return {
      success: true,
      total: totalLines,
      successCount,
      errorCount,
      file: csvFile,
      batchSize
    };
    
  } catch (error) {
    console.error(`❌ CSV 멀티 데이터 저장 실패: ${error.message}`);
    throw error;
  }
}



// PVD CSV 파일의 첫 번째 행만 단건으로 저장 (Fabric 네트워크)
async function putPvdSingleCsvData(network, csvFile) {
  console.log(`🚀 ${network} 네트워크에 CSV 첫 번째 행 단건 저장 시작`);
  console.log(`📁 CSV 파일: ${csvFile}\n`);

  if (network !== 'fabric') {
    throw new Error('CSV 단건 저장은 Fabric 네트워크에서만 지원됩니다');
  }

  const fs = require('fs');
  const path = require('path');
  
  // CSV 파일 경로 설정 (절대 경로로 변환)
  const csvPath = path.resolve(csvFile);
  
  if (!fs.existsSync(csvPath)) {
    throw new Error(`CSV 파일을 찾을 수 없습니다: ${csvPath}`);
  }

  try {
    console.log('📄 CSV 파일 읽는 중...');
    const csvContent = fs.readFileSync(csvPath, 'utf8');
    const lines = csvContent.trim().split('\n');
    
    if (lines.length < 2) {
      throw new Error('CSV 파일에 데이터가 없습니다');
    }
    
    console.log(`📊 CSV 파일 분석 완료:`);
    console.log(`   - 총 라인 수: ${lines.length}`);
    console.log(`   - 헤더: ${lines[0]}`);
    console.log(`   - 첫 번째 데이터 행만 처리`);
    
    // 첫 번째 데이터 행만 처리 (헤더 제외)
    const dataLine = lines[1].trim();
    console.log(`📝 처리할 데이터: ${dataLine.substring(0, 50)}...`);
    
    const values = dataLine.split(',');
    
    if (values.length < 5) {
      throw new Error('데이터 형식 오류: 최소 5개 컬럼 필요');
    }
    
    // CSV 데이터를 PVD 객체로 파싱
    const pvdData = {
      obuId: values[0] || `CSV-OBU-${Date.now()}`,
      collectionDt: values[1] || new Date().toISOString(),
      startvectorLatitude: parseFloat(values[2]) || 37.5665,
      startvectorLongitude: parseFloat(values[3]) || 126.9780,
      transmisstion: values[4] || 'D',
      speed: parseInt(values[5]) || 60,
      hazardLights: values[6] === 'ON',
      leftTurnSignalOn: values[7] === 'ON',
      rightTurnSignalOn: values[8] === 'ON',
      steering: parseInt(values[9]) || 0,
      rpm: parseInt(values[10]) || 2000,
      footbrake: values[11] === 'ON',
      gear: values[12] || 'D',
      accelator: parseInt(values[13]) || 30,
      wipers: values[14] === 'ON',
      tireWarnLeftF: values[15] === 'WARN',
      tireWarnLeftR: values[16] === 'WARN',
      tireWarnRightF: values[17] === 'WARN', 
      tireWarnRightR: values[18] === 'WARN',
      tirePsiLeftF: parseInt(values[19]) || 32,
      tirePsiLeftR: parseInt(values[20]) || 32,
      tirePsiRightF: parseInt(values[21]) || 32,
      tirePsiRightR: parseInt(values[22]) || 32,
      fuelPercent: parseInt(values[23]) || 75,
      fuelLiter: parseInt(values[24]) || 45,
      totaldist: parseInt(values[25]) || 15000,
      rsuId: values[26] || 'RSU-CSV-001',
      msgId: values[27] || `MSG-CSV-001`,
      startvectorHeading: parseInt(values[28]) || 90
    };
    
    console.log(`📤 CSV 첫 번째 행 데이터 전송 중:`);
    console.log(`   - OBU_ID: ${pvdData.obuId}`);
    console.log(`   - Speed: ${pvdData.speed}`);
    console.log(`   - CollectionDt: ${pvdData.collectionDt}`);
    
    // PVD 클라이언트 연결
    const pvdClient = new PvdClient('localhost:19001');
    await pvdClient.connect();
    console.log('✅ PVD 서버 연결 성공');
    
    try {
      // 단건 데이터 저장
      console.log(`🔄 PVD 데이터 저장 요청 중...`);
      console.log(`📊 전송할 PVD 데이터:`, JSON.stringify(pvdData, null, 2));
      
      const result = await pvdClient.putData(pvdData);
      console.log(`📥 PVD 데이터 저장 결과:`, JSON.stringify(result, null, 2));
      
              if (result.success) {
          console.log(`✅ CSV 첫 번째 행 데이터 저장 성공!`);
          console.log(`🔑 트랜잭션 해시: ${result.txId}`);
          
          // 트랜잭션 ID를 PVD 데이터에 추가 (인덱싱용)
          pvdData.txId = result.txId;
          
          // 인덱싱은 별도로 처리 (실패해도 데이터는 저장됨)
          console.log(`🔄 인덱싱 처리 시작 (백그라운드)...`);
          
          // 비동기로 인덱싱 처리 (실패해도 메인 프로세스는 계속)
          Promise.allSettled([
            pvdClient.putSpeedIndex(pvdData),
            pvdClient.putDtIndex(pvdData)
          ]).then((results) => {
            // console.log(`📊 인덱싱 처리 완료:`);
            // console.log(`   - Speed: ${results[0].status === 'fulfilled' ? '✅' : '❌'}`);
            // console.log(`   - DT: ${results[1].status === 'fulfilled' ? '✅' : '❌'}`);
          }).catch((error) => {
            console.warn(`⚠️ 인덱싱 처리 중 오류: ${error.message}`);
          });
          
        } else {
          console.log(`❌ CSV 데이터 저장 실패: ${result.message || '알 수 없는 오류'}`);
        }
      
    } catch (error) {
      console.error(`❌ CSV 데이터 저장 중 오류 발생:`, error.message);
      throw error;
    } finally {
      pvdClient.close();
    }
    
    console.log('\n🎉 CSV 첫 번째 행 단건 저장 완료!');
    
    return {
      success: true,
      message: 'CSV 첫 번째 행 단건 저장 완료',
      file: csvFile,
      data: pvdData
    };
    
  } catch (error) {
    console.error(`❌ CSV 단건 데이터 저장 실패: ${error.message}`);
    throw error;
  }
}

// 재인덱싱 함수 제거됨 - 실시간 인덱싱만 사용

// PVD 데이터 저장 함수
async function putPvdData(network, obuId, pvdData = null) {
  try {
    // console.log(`📝 ${network} 네트워크에 PVD 데이터 저장 중...`);
    
    if (network === 'fabric') {
      // console.log('🔗 Fabric 네트워크 - PVD 서버 연결 중...');
      
      // PVD 클라이언트 사용
      const pvdClient = new PvdClient('localhost:19001');
      await pvdClient.connect();
      // console.log('✅ PVD 서버 연결 성공');
      
      // CSV 데이터가 있으면 사용, 없으면 기본값 생성
      let csvPvdData;
      if (pvdData) {
        // CSV에서 파싱된 데이터 사용
        csvPvdData = {
          obuId: pvdData.obuId,
          speed: pvdData.speed || 65,
          collectionDt: pvdData.collectionDt || new Date().toISOString(),
          startvectorLatitude: pvdData.startvectorLatitude || 37.5665,
          startvectorLongitude: pvdData.startvectorLongitude || 126.9780,
          transmisstion: pvdData.transmisstion || 'auto',
          hazardLights: pvdData.hazardLights || false,
          leftTurnSignalOn: pvdData.leftTurnSignalOn || false,
          rightTurnSignalOn: pvdData.rightTurnSignalOn || false,
          steering: pvdData.steering || 0,
          rpm: pvdData.rpm || 2500,
          footbrake: pvdData.footbrake || false,
          gear: pvdData.gear || 'D',
          accelator: pvdData.accelator || 30,
          wipers: pvdData.wipers || false,
          tireWarnLeftF: pvdData.tireWarnLeftF || false,
          tireWarnLeftR: pvdData.tireWarnLeftR || false,
          tireWarnRightF: pvdData.tireWarnRightF || false,
          tireWarnRightR: pvdData.tireWarnRightR || false,
          tirePsiLeftF: pvdData.tirePsiLeftF || 32,
          tirePsiLeftR: pvdData.tirePsiLeftR || 32,
          tirePsiRightF: pvdData.tirePsiRightF || 32,
          tirePsiRightR: pvdData.tirePsiRightR || 32,
          fuelPercent: pvdData.fuelPercent || 75,
          fuelLiter: pvdData.fuelLiter || 35,
          totaldist: pvdData.totaldist || 52000,
          rsuId: pvdData.rsuId || 'rsu_csv_001',
          msgId: pvdData.msgId || 'msg_csv_001',
          startvectorHeading: pvdData.startvectorHeading || 90
        };
      } else {
        // 기존 방식: 기본값 사용
        csvPvdData = {
          obuId: obuId || `OBU-${Date.now()}`,
          speed: 65,
          collectionDt: new Date().toISOString(),
          startvectorLatitude: 37.5665,
          startvectorLongitude: 126.9780,
          transmisstion: 'auto',
          hazardLights: false,
          leftTurnSignalOn: false,
          rightTurnSignalOn: false,
          steering: 0,
          rpm: 2500,
          footbrake: false,
          gear: 'D',
          accelator: 30,
          wipers: false,
          tireWarnLeftF: false,
          tireWarnLeftR: false,
          tireWarnRightF: false,
          tireWarnRightR: false,
          tirePsiLeftF: 32,
          tirePsiLeftR: 32,
          tirePsiRightF: 32,
          tirePsiRightR: 32,
          fuelPercent: 75,
          fuelLiter: 35,
          totaldist: 52000,
          rsuId: 'rsu_csv_001',
          msgId: 'msg_csv_001',
          startvectorHeading: 90
        };
      }
      
      console.log(`📤 PVD 데이터 저장: OBU_ID=${csvPvdData.obuId}, Speed=${csvPvdData.speed}`);
      const result = await pvdClient.putData(csvPvdData);
      
      pvdClient.close();
      // console.log('✅ PVD 데이터 저장 완료:', result);
      
      // idxmngr 서버에도 데이터 전송 (인덱싱용)
      try {
        console.log('🔗 idxmngr 서버에 데이터 전송 중...');
        
        // putPvdMultiData와 동일한 방식으로 처리
        const indexingClient = new FabricIndexingClient({
          serverAddr: 'localhost:50052',
          protoPath: path.join(__dirname, '../../grpc-go/protos/index_manager.proto')
        });
        
        await indexingClient.connect();
        console.log('✅ idxmngr 서버 연결 성공');
        
        // pvd_data 인덱싱 제거됨 - speed와 dt 인덱스만 사용
        const indexRequest = {
          IndexID: 'pvd_data', // 제거됨
          BcList: [{ // 제거됨
            TxId: `pvd_${csvPvdData.obuId}_${Date.now()}`,
            KeyCol: 'IndexableData',
            IndexableData: {
              TxId: `pvd_${csvPvdData.obuId}_${Date.now()}`,
              ContractAddress: 'fabric-pvd-chaincode',
              EventName: 'PvdDataSaved',
              Timestamp: csvPvdData.collectionDt,
              BlockNumber: 0,
              DynamicFields: {
                "key": csvPvdData.obuId,  // obuId를 직접 키로 사용
                "obuId": csvPvdData.obuId,
                "speed": csvPvdData.speed,
                "collectionDt": csvPvdData.collectionDt,
                "latitude": csvPvdData.startvectorLatitude,
                "longitude": csvPvdData.startvectorLongitude,
                "network": "fabric",
                "timestamp": new Date().toISOString()
              },
              SchemaVersion: "1.0"
            }
          }],
          ColName: 'IndexableData',
          ColIndex: 'pvd_data',
          KeySize: 64,
          FilePath: 'data/fabric/pvd_data.bf',
          Network: 'fabric'
        };
        
        // console.log('🔧 인덱싱 요청 데이터 검증:', {
        //   IndexID: indexRequest.IndexID,
        //   ColName: indexRequest.ColName,
        //   KeySize: indexRequest.KeySize,
        //   FilePath: indexRequest.FilePath,
        //   Network: indexRequest.Network
        // });
        
        console.log('📤 idxmngr 서버에 인덱싱 요청 전송 중...');
        
        // putPvdMultiData와 동일한 방식으로 insertData 호출
        // const indexResult = await indexingClient.insertData(indexRequest); // pvd_data 인덱싱 제거
        // console.log('ℹ️ pvd_data 인덱싱은 건너뜁니다.');
        
        await indexingClient.close();
        
      } catch (indexError) {
        console.warn(`⚠️ idxmngr 서버 인덱싱 실패 (PVD 저장은 성공): ${indexError.message}`);
      }
      
      return result;
      
    } else {
      throw new Error(`${network} 네트워크는 PVD 데이터 저장을 지원하지 않습니다`);
    }
    
  } catch (error) {
    console.error(`❌ PVD 데이터 저장 실패: ${error.message}`);
    throw error;
  }
}

// 네트워크별 통합 인덱스 생성 (EVM/Fabric 통합)
async function createIndexUnified(network, indexType, walletAddress = null) {
  try {
    console.log(`🔧 ${network} 네트워크에 ${indexType} 인덱스 생성 중...`);
    
    if (network === 'fabric') {
      // Fabric 네트워크: 모든 인덱스 타입 허용
      console.log(`📊 Fabric 네트워크 - ${indexType} 인덱스 생성...`);
      
      console.log(`✅ 인덱스 타입: ${indexType}`);
      
      // FabricIndexingClient를 사용한 Fabric 인덱스 생성
      const indexingClient = new FabricIndexingClient({
        serverAddr: 'localhost:50052',
        protoPath: path.join(__dirname, '../../grpc-go/protos/index_manager.proto')
      });
      
      try {
        await indexingClient.connect();
        // console.log('✅ Fabric 인덱싱 서버 연결 성공');
        
        // Fabric 인덱스 생성 요청 (데이터 없이 인덱스만)
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
        
        return {
          success: true,
          network: 'fabric',
          indexType: indexType,
          indexId: indexType,
          message: `Fabric ${indexType} 인덱스 생성 완료`
        };
        
      } catch (error) {
        console.error(`❌ Fabric ${indexType} 인덱스 생성 실패: ${error.message}`);
        throw error;
      }
      
    } else {
      // EVM 계열 네트워크: 동적 타입 처리 (지갑 주소 해시 기반)
      console.log(`📊 ${network} 네트워크 - ${indexType} 인덱스 생성...`);
      
      // IndexingClient를 사용한 동적 인덱스 생성
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
          // 지갑 주소가 있는 경우 (create-user-index)
          const addressHash = hashWalletAddress(walletAddress);
          console.log(`📱 ${indexType} 타입 → 지갑 주소: ${walletAddress} → 해시: ${addressHash}`);
          indexID = `${indexType}_${addressHash}`;
          filePath = `data/${networkDir}/${indexType}_${addressHash}.bf`;
        } else {
          // 지갑 주소가 없는 경우 (create-index)
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
        
        return {
          success: true,
          network: network,
          indexType: indexType,
          indexId: indexID,
          filePath: filePath,
          message: `${network} ${indexType} 인덱스 생성 완료`
        };
        
      } catch (error) {
        indexingClient.close();
        throw error;
      }
    }
    
  } catch (error) {
    console.error(`❌ ${network} ${indexType} 인덱스 생성 실패: ${error.message}`);
    throw error;
  }
}



// 지갑 주소별 데이터 검색 (EVM 전용)
async function searchByWalletAddress(network, walletAddress) {
  try {
    console.log(`🔍 ${network} 네트워크에서 지갑 주소별 데이터 검색 시작...`);
    console.log(`📱 지갑 주소: ${walletAddress}`);
    
    if (network === 'fabric') {
      throw new Error('Fabric 네트워크는 지갑 주소 검색을 지원하지 않습니다. search-index를 사용하세요.');
    }
    
    // EVM 네트워크에서 지갑 주소 기반 검색
    const indexingClient = new IndexingClient({
      serverAddr: 'localhost:50052',
      protoPath: PROTO_PATH
    });
    
    await indexingClient.connect();
    console.log('✅ 인덱싱 서버 연결 성공');
    
    // 지갑 주소 해시 생성
    const addressHash = hashWalletAddress(walletAddress);
    const networkDir = (network === 'hardhat' || network === 'localhost') ? 'hardhat-local' : network;
    
    // 모든 지갑 주소를 wallet_{hash} 형식으로 통일
    const indexID = `wallet_${addressHash}`;
    const filePath = `data/${networkDir}/wallet_${addressHash}.bf`;
    
    console.log(`🆔 인덱스 생성: ${walletAddress} → wallet_${addressHash}`);
    
    // 전체 데이터 조회를 위한 Range 검색
    const searchRequest = {
      IndexID: indexID,
      Field: 'IndexableData',
      Begin: '',        // 시작값 (빈 문자열 = 최소값)
      End: 'zzz',       // 끝값 (최대값)
      FilePath: filePath,
      KeySize: 64,
      ComOp: 'Range'    // Range 검색으로 모든 데이터 조회
    };
    
    console.log(`🔧 검색 요청:`, searchRequest);
    
    const result = await indexingClient.searchData(searchRequest);
    
    // 결과 정리 및 출력
    const cleanResult = {
      success: true,
      walletAddress: walletAddress,
      indexId: indexID,
      data: result.IdxData || [],
      count: result.IdxData?.length || 0,
      network: network,
      timestamp: new Date().toISOString()
    };
    
    console.log(`\n📊 검색 결과:`);
    console.log(`   📱 지갑 주소: ${walletAddress}`);
    console.log(`   🆔 인덱스 ID: ${indexID}`);
    console.log(`   📊 데이터 개수: ${cleanResult.count}`);
    
    if (cleanResult.data.length > 0) {
      console.log(`   📋 트랜잭션 목록:`);
      cleanResult.data.forEach((txHash, index) => {
        console.log(`      ${index + 1}. ${txHash}`);
      });
    } else {
      console.log(`   ℹ️  해당 지갑 주소와 관련된 데이터가 없습니다.`);
    }
    
    indexingClient.close();
    return cleanResult;
    
  } catch (error) {
    console.error(`❌ ${network} 지갑 주소 검색 실패: ${error.message}`);
    throw error;
  }
}

// 네트워크별 인덱스 전체 조회 (EVM/Fabric 통합)
async function searchIndexAll(network, indexType) {
  try {
    console.log(`🔍 ${network} 네트워크의 ${indexType} 인덱스 전체 조회 시작...`);
    
    if (network === 'fabric') {
      // Fabric 네트워크: 인덱스에서 직접 전체 조회
      console.log('📊 Fabric 인덱스에서 전체 데이터 조회...');
      
      const indexResult = await searchFabricIndexAll(indexType);
      console.log('🔍 Fabric 인덱스 전체 조회 결과:', JSON.stringify(indexResult, null, 2));
      return indexResult;
      
    } else {
      // EVM 계열 네트워크: 기존 EVM 인덱스 조회 로직
      console.log(`📊 ${network} 네트워크 인덱스에서 전체 데이터 조회...`);
      
      const indexingClient = new IndexingClient({
        serverAddr: 'localhost:50052',
        protoPath: PROTO_PATH
      });
      
      await indexingClient.connect();
      console.log('✅ 인덱싱 서버 연결 성공');
      
      // EVM 인덱스 전체 조회 로직
      // EVM 네트워크에서 지갑 주소 처리 (선택사항, 없으면 기본값 사용)
      let walletAddress = wallet || '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266'; // 기본 지갑 주소
      
      // 지갑 주소가 제공된 경우 형식 검증
      if (wallet && !/^0x[a-fA-F0-9]{40}$/.test(wallet)) {
        throw new Error('올바르지 않은 지갑 주소 형식입니다. 올바른 형식: 0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC');
      }
      
      console.log(`📱 사용할 지갑 주소: ${walletAddress}${!wallet ? ' (기본값)' : ''}`);
      
      const addressHash = hashWalletAddress(walletAddress);
      const networkDir = (network === 'hardhat' || network === 'localhost') ? 'hardhat-local' : network;
      const indexID = `${indexType}_${addressHash}`;
      const filePath = `data/${networkDir}/${indexType}_${addressHash}.bf`;
      
      // 전체 데이터 조회를 위한 Range 검색 (모든 데이터)
      const searchRequest = {
        IndexID: indexID,
        Field: 'IndexableData',
        Begin: '',        // 시작값 (빈 문자열 = 최소값)
        End: 'zzz',       // 끝값 (최대값)
        FilePath: filePath,
        KeySize: 64,
        ComOp: 'Range'    // Range 검색으로 모든 데이터 조회
      };
      
      console.log(`🔧 검색 요청:`, searchRequest);
      
      const result = await indexingClient.searchData(searchRequest);
      
      indexingClient.close();
      return result;
    }
    
  } catch (error) {
    console.error(`❌ ${network} 인덱스 전체 조회 실패: ${error.message}`);
    throw error;
  }
}



// PVD 전용 gRPC 클라이언트 (client.go 함수들에 맞춤)
class PvdClient {
  constructor(serverAddr) {
    this.serverAddr = serverAddr;
    this.client = null;
    this.grpcClient = null;
    this.protoPath = path.join(__dirname, '../../grpc-go/protos/pvd_hist.proto');
  }
  
  async connect() {
    try {
      console.log(`🔗 PVD 서버 연결 시도: ${this.serverAddr}`);
      
      // protobuf 파일 로드
      const packageDefinition = protoLoader.loadSync(this.protoPath, {
        keepCase: true,
        longs: String,
        enums: String,
        defaults: true,
        oneofs: true
      });
      
      const pvdProto = grpc.loadPackageDefinition(packageDefinition);
      
      // gRPC 클라이언트 생성 (TLS 완전 비활성화)
      this.grpcClient = new pvdProto.pvdapi.Pvd(
        this.serverAddr,
        grpc.credentials.createInsecure(),
        {
          'grpc.ssl_target_name_override': 'localhost',
          'grpc.default_authority': 'localhost'
        }
      );
      
      // 연결 상태 확인
      this.client = {
        connected: true,
        serverAddr: this.serverAddr
      };
      
      // console.log('✅ PVD gRPC 서버 연결 성공');
      return true;
      
    } catch (error) {
      console.error('❌ PVD 서버 연결 실패:', error.message);
      throw error;
    }
  }
  
  // client.go의 queryData 함수
  async queryData(chainInfo, pvd) {
    console.log('🔍 PVD queryData 호출:', { chainInfo, pvd });
    return { 
      success: true, 
      method: 'queryData', 
      data: 'PVD 데이터 조회 결과',
      obuId: pvd.obuId,
      timestamp: new Date().toISOString()
    };
  }
  
  // client.go의 createData 함수
  async createData(chainInfo, pvd) {
    console.log('🔍 PVD createData 호출:', { chainInfo, pvd });
    return { 
      success: true, 
      method: 'createData', 
      txId: `pvd_tx_${Date.now()}`,
      data: 'PVD 데이터 생성 결과'
    };
  }
  
  // client.go의 queryHistory 함수
  async queryHistory(chainInfo, pvd) {
    console.log('🔍 PVD queryHistory 호출:', { chainInfo, pvd });
    return { 
      success: true, 
      method: 'queryHistory', 
      data: 'PVD 히스토리 데이터',
      obuId: pvd.obuId,
      historyCount: 5
    };
  }
  
  // client.go의 queryDatasByField 함수
  async queryDatasByField(fieldInfo) {
    console.log('🔍 PVD queryDatasByField 호출:', fieldInfo);
    return { 
      success: true, 
      method: 'queryDatasByField', 
      data: '필드 검색 결과',
      field: fieldInfo.field,
      value: fieldInfo.value,
      matches: 3
    };
  }
  
  // client.go의 getWorldState 함수
  async getWorldState(chainInfo) {
    console.log('🔍 PVD getWorldState 호출:', chainInfo);
    
    return new Promise((resolve, reject) => {
      this.grpcClient.getWorldState(chainInfo, (error, response) => {
        if (error) {
          console.error('❌ gRPC getWorldState 호출 실패:', error);
          reject(error);
          return;
        }
        
        console.log('✅ gRPC getWorldState 호출 성공:', response);
        resolve(response);
      });
    });
  }
  
  // client.go의 queryDatasByTxid 함수 - 트랜잭션 ID로 상세 정보 조회
  async getDataByTxId(txId) {
    console.log('🔍 PVD 트랜잭션 상세 조회:', txId);
    
    if (!this.grpcClient) {
      throw new Error('gRPC 클라이언트가 연결되지 않음. connect() 메서드를 먼저 호출하세요.');
    }
    
    const request = {
      TxId: Array.isArray(txId) ? txId : [txId]
    };
    
    // console.log('📤 gRPC 요청 데이터:', JSON.stringify(request, null, 2));
    
    return new Promise((resolve, reject) => {
      // getDataByTxID는 스트리밍 메서드 (proto에서 소문자로 정의됨)
      const stream = this.grpcClient.getDataByTxID(request);
      
      const results = [];
      
      stream.on('data', (data) => {
        console.log('📥 트랜잭션 데이터 수신:', JSON.stringify(data, null, 2));
        if (data.Pvd) {
          results.push({
            txId: data.TxId,
            pvd: data.Pvd,
            timestamp: new Date().toISOString()
          });
        }
      });
      
      stream.on('end', () => {
        console.log('✅ 트랜잭션 상세 조회 완료');
        resolve({
          success: true,
          count: results.length,
          data: results
        });
      });
      
      stream.on('error', (error) => {
        console.error('❌ 트랜잭션 상세 조회 실패:', error);
        reject(error);
      });
    });
  }
  


  // client.go의 putDataWithIndexing 함수 (패브릭 데이터 저장 + 인덱싱 통합)
  async putDataWithIndexing(obuId, speed) {
    try {
      console.log('🚀 PVD 데이터 저장 + 인덱싱 통합 시작');
      console.log(`📝 OBU_ID: ${obuId}, Speed: ${speed}`);
      
      if (!this.grpcClient) {
        throw new Error('gRPC 클라이언트가 연결되지 않음. connect() 메서드를 먼저 호출하세요.');
      }
      
      // 1. PVD 데이터 생성 (client.go와 동일한 구조)
      const chainInfo = {
        ChannelName: 'pvdchannel',
        Chaincode: 'pvd'
      };
      
      const pvdData = {
        Obu_id: obuId || 'OBU-TEST-001',
        Collection_dt: '20250102120000000',
        Startvector_latitude: '37.5665',
        Startvector_longitude: '126.9780',
        Transmisstion: 'D',
        Speed: parseInt(speed) || 80,
        Hazard_lights: 'OFF',
        Left_turn_signal_on: 'OFF',
        Right_turn_signal_on: 'OFF',
        Steering: 0,
        Rpm: 2000,
        Footbrake: 'OFF',
        Gear: 'D',
        Accelator: 30,
        Wipers: 'OFF',
        Tire_warn_left_f: 'OK',
        Tire_warn_left_r: 'OK',
        Tire_warn_right_f: 'OK',
        Tire_warn_right_r: 'OK',
        Tire_psi_left_f: 32,
        Tire_psi_left_r: 32,
        Tire_psi_right_f: 32,
        Tire_psi_right_r: 32,
        Fuel_percent: 75,
        Fuel_liter: 45,
        Totaldist: 15000,
        Rsu_id: 'RSU-TEST-001',
        Msg_id: 'MSG-TEST-001',
        Startvector_heading: 90
      };
      
      const request = {
        ChainInfo: chainInfo,
        Pvd: pvdData
      };
      
      console.log('📤 1. PVD 데이터를 Fabric에 저장 중...');
      
      // 2. PVD 데이터 저장 (gRPC putData 호출)
      const putDataResult = await new Promise((resolve, reject) => {
        this.grpcClient.putData(request, (error, response) => {
          if (error) {
            console.error('❌ PVD 데이터 저장 실패:', error);
            reject(error);
          } else {
            console.log('✅ PVD 데이터 저장 성공:', response);
            resolve(response);
          }
        });
      });
      
      const txID = putDataResult.TxId;
      if (!txID) {
        throw new Error('TxID를 받지 못했습니다.');
      }
      
      console.log(`✅ PVD 데이터 저장 성공: TxID = ${txID}`);
      
      // 3. 인덱싱 처리 (client.go와 동일한 방식)
      console.log('📤 2. 인덱스에 데이터 삽입 중...');
      
      // 인덱싱 클라이언트 생성
      const indexingClient = new FabricIndexingClient({
        serverAddr: 'localhost:50052',
        protoPath: path.join(__dirname, '../../grpc-go/protos/index_manager.proto')
      });
      
      await indexingClient.connect();
      // console.log('✅ 인덱싱 클라이언트 연결 성공');
      
      // Speed 인덱스 삽입
      const speedIndexData = {
        IndexID: 'speed',
        BcList: [{
          TxId: txID,
          KeyCol: 'Speed',
          Pvd: {
            ObuId: obuId,
            Speed: parseInt(speed),
            CollectionDt: pvdData.Collection_dt
          }
        }],
        ColName: 'Speed',
        TxId: txID,
        OBU_ID: obuId,
        FilePath: 'data/fabric/speed.bf',
        Network: 'fabric'
      };
      
      await indexingClient.insertData(speedIndexData);
      console.log('✅ Speed 인덱스 삽입 성공');
      
      // DT 인덱스 삽입
      const dtIndexData = {
        IndexID: 'dt',
        BcList: [{
          TxId: txID,
          KeyCol: 'CollectionDt',
          Pvd: {
            ObuId: obuId,
            Speed: parseInt(speed),
            CollectionDt: pvdData.Collection_dt
          }
        }],
        ColName: 'CollectionDt',
        TxId: txID,
        OBU_ID: obuId,
        FilePath: 'data/fabric/dt.bf',
        Network: 'fabric'
      };
      
      await indexingClient.insertData(dtIndexData);
      console.log('✅ DT 인덱스 삽입 성공');
      
      // 인덱싱 클라이언트 연결 해제 (disconnect 함수가 없으므로 생략)
      
      console.log(' PVD 데이터 저장 + 인덱싱 완료!');
      
      return {
        success: true,
        txId: txID,
        message: 'PVD 데이터 저장 + 인덱싱 완료',
        obuId: obuId,
        speed: speed
      };
      
    } catch (error) {
      console.error('❌ putDataWithIndexing 실패:', error);
      throw error;
    }
  }

    // client.go의 putData 함수 (실제 gRPC 호출)
  async putData(pvdData) {
    try {
      // console.log('📝 PVD 데이터 저장 중...');
      
      if (!this.grpcClient) {
        throw new Error('gRPC 클라이언트가 연결되지 않음. connect() 메서드를 먼저 호출하세요.');
      }
      
      // client.go의 createData 함수와 동일한 방식으로 요청
      // console.log('📝 client.go createData 방식으로 PVD 데이터 저장 중...');
      
      const chainInfo = {
        ChannelName: 'pvdchannel',
        Chaincode: 'pvd'
      };
      
      // 매개변수로 받은 PVD 데이터를 gRPC 형식으로 변환
      const grpcPvdData = {
        Obu_id: pvdData.obuId || `OBU-${Date.now()}`,
        Collection_dt: pvdData.collectionDt || '20250101120000000',
        Startvector_latitude: pvdData.startvectorLatitude?.toString() || '37.5665',
        Startvector_longitude: pvdData.startvectorLongitude?.toString() || '126.9780',
        Transmisstion: pvdData.transmisstion || 'D',
        Speed: pvdData.speed || 60,
        Hazard_lights: pvdData.hazardLights ? 'ON' : 'OFF',
        Left_turn_signal_on: pvdData.leftTurnSignalOn ? 'ON' : 'OFF',
        Right_turn_signal_on: pvdData.rightTurnSignalOn ? 'ON' : 'OFF',
        Steering: pvdData.steering || 0,
        Rpm: pvdData.rpm || 2000,
        Footbrake: pvdData.footbrake ? 'ON' : 'OFF',
        Gear: pvdData.gear || 'D',
        Accelator: pvdData.accelator || 30,
        Wipers: pvdData.wipers ? 'ON' : 'OFF',
        Tire_warn_left_f: pvdData.tireWarnLeftF ? 'WARN' : 'OK',
        Tire_warn_left_r: pvdData.tireWarnLeftR ? 'WARN' : 'OK',
        Tire_warn_right_f: pvdData.tireWarnRightF ? 'WARN' : 'OK',
        Tire_warn_right_r: pvdData.tireWarnRightR ? 'WARN' : 'OK',
        Tire_psi_left_f: pvdData.tirePsiLeftF || 32,
        Tire_psi_left_r: pvdData.tirePsiLeftR || 32,
        Tire_psi_right_f: pvdData.tirePsiRightF || 32,
        Tire_psi_right_r: pvdData.tirePsiRightR || 32,
        Fuel_percent: pvdData.fuelPercent || 75,
        Fuel_liter: pvdData.fuelLiter || 45,
        Totaldist: pvdData.totaldist || 15000,
        Rsu_id: pvdData.rsuId || 'RSU-TEST-001',
        Msg_id: pvdData.msgId || 'MSG-TEST-001',
        Startvector_heading: pvdData.startvectorHeading || 90
      };
      
      // client.go와 정확히 동일한 구조: &pvd.SinglePvd{ChainInfo: &chainInfo, Pvd: &data}
      // Proto 필드명은 대문자로 시작해야 함
      const request = {
        ChainInfo: chainInfo,
        Pvd: grpcPvdData
      };
      
      // console.log('📤 client.go createData 요청 구조:', JSON.stringify(request, null, 2));
      
      // 실제 gRPC putData 호출
      // console.log('📤 gRPC 요청 데이터:', JSON.stringify(request, null, 2));
      
      return new Promise((resolve, reject) => {
        this.grpcClient.putData(request, (error, response) => {
          if (error) {
            console.error('❌ gRPC putData 호출 실패:', error);
            console.error('❌ 에러 코드:', error.code);
            console.error('❌ 에러 상세:', error.details);
            if (error.metadata) {
              console.error('❌ 메타데이터:', error.metadata.getMap());
            }
            reject(error);
            return;
          }
          
          console.log('✅ PVD 데이터 저장 성공 (실제 gRPC)');
          console.log(`🔑 트랜잭션 해시: ${response.TxId || response.txId || 'N/A'}`);
          console.log('📥 응답 데이터:', JSON.stringify(response, null, 2));
          
          // gRPC 응답 필드명 정확하게 매칭
          const txId = response.TxId || response.txId || 'N/A';
          const responseCode = response.Response_code || response.responseCode || 200;
          const responseMessage = response.Response_message || response.responseMessage || '';
          const duration = response.Duration || response.duration || 0;
          
          resolve({
            success: true,
            method: 'putData',
            txId: txId,
            data: 'PVD 데이터 저장 결과 (실제 트랜잭션)',
            obuId: pvdData.obuId || 'OBU-461001c4',
            speed: pvdData.speed || 0,
            collectionDt: pvdData.collectionDt || '20221001001000198',
            timestamp: new Date().toISOString(),
            responseCode: responseCode,
            responseMessage: responseMessage,
            duration: duration
          });
        });
      });
      
    } catch (error) {
      console.error('❌ PVD 데이터 저장 실패:', error);
      throw error;
    }
  }
  
  // 체인코드 상태 확인용 메서드
  async getWorldState(chainInfo) {
    try {
      console.log('🔍 체인코드 상태 확인 중...');
      
      if (!this.grpcClient) {
        throw new Error('gRPC 클라이언트가 연결되지 않음');
      }
      
      const request = {
        ChannelName: chainInfo.channelName,  // 대문자로 수정
        Chaincode: chainInfo.chaincode       // 대문자로 수정
      };
      
      // 보내는 데이터 로그 추가
      console.log('📤 [DEBUG] grpc-go 서버로 보내는 데이터:');
      console.log('   - request.ChannelName:', request.ChannelName);
      console.log('   - request.Chaincode:', request.Chaincode);
      console.log('   - request 전체:', JSON.stringify(request, null, 2));
      
      return new Promise((resolve, reject) => {
        this.grpcClient.getWorldState(request, (error, response) => {
          if (error) {
            console.error('❌ getWorldState 호출 실패:', error);
            reject(error);
            return;
          }
          
          console.log('✅ getWorldState 성공');
          resolve(response);
        });
      });
      
    } catch (error) {
      console.error('❌ getWorldState 실패:', error);
      throw error;
    }
  }
  
  // Speed 인덱스에 데이터 저장
  async putSpeedIndex(pvdData) {
    try {
      // console.log(`🔍 Speed 인덱스에 저장 중: ${pvdData.speed}`);
      
      // 인덱싱 서버를 통해 Speed 인덱스에 저장
      const indexingClient = new FabricIndexingClient({
        serverAddr: 'localhost:50052',
        protoPath: path.join(__dirname, '../../grpc-go/protos/index_manager.proto')
      });
      
      await indexingClient.connect();
      // console.log(`✅ Speed 인덱싱 클라이언트 연결 성공`);
      
      // 타임아웃 설정 (10초)
      const timeoutPromise = new Promise((_, reject) => {
        setTimeout(() => reject(new Error('Speed 인덱싱 타임아웃 (10초)')), 10000);
      });
      
      const indexRequest = {
        IndexID: 'speed',
        BcList: [{
          TxId: pvdData.txId || pvdData.msgId || `tx_${Date.now()}`,
          KeyCol: 'Speed',
          Pvd: pvdData
        }],
        ColName: 'Speed',
        ColIndex: 5, // CSV에서 Speed 컬럼 인덱스
        FilePath: 'data/fabric/speed.bf',
        Network: 'fabric'
      };
      
      // console.log(`📤 Speed 인덱싱 요청 전송 중...`);
      
      // 타임아웃과 함께 실행
      const result = await Promise.race([
        indexingClient.insertData(indexRequest),
        timeoutPromise
      ]);
      
      // console.log(`📥 Speed 인덱싱 응답:`, JSON.stringify(result, null, 2));
      
      // 명시적으로 연결 종료
      await indexingClient.close();
      console.log(`🔌 Speed 인덱싱 클라이언트 연결 종료`);
      
      return { success: true, message: 'Speed 인덱스 저장 완료' };
      
    } catch (error) {
      console.error(`❌ Speed 인덱스 저장 실패: ${error.message}`);
      return { success: false, error: error.message };
    }
  }
  
  // Speed 인덱싱 처리 (재시도 로직 포함)
  async processSpeedIndex(pvdData) {
    try {
      // console.log(`🔄 Speed 인덱싱 처리 시작...`);ㄴㄴ
      const result = await this.retryIndexing(pvdData, 'speed', 3);
      // console.log(`📊 Speed 인덱싱 처리 완료:`, result.success ? '✅' : '❌');
      return result;
    } catch (error) {
      console.error(`❌ Speed 인덱싱 처리 실패:`, error.message);
      return { success: false, error: error.message };
    }
  }

  // DT 인덱싱 처리 (재시도 로직 포함)
  async processDtIndex(pvdData) {
    try {
      // console.log(`🔄 DT 인덱싱 처리 시작...`);
      const result = await this.retryIndexing(pvdData, 'dt', 3);
      // console.log(`📊 DT 인덱싱 처리 완료:`, result.success ? '✅' : '❌');
      return result;
    } catch (error) {
      console.error(`❌ DT 인덱싱 처리 실패:`, error.message);
      return { success: false, error: error.message };
    }
  }

  // 인덱싱 재시도 함수 (최대 3회)
  async retryIndexing(pvdData, indexType, maxRetries = 3) {
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        console.log(`🔄 ${indexType} 인덱싱 재시도 ${attempt}/${maxRetries}...`);
        
        let result;
        if (indexType === 'speed') {
          result = await this.putSpeedIndex(pvdData);
        } else if (indexType === 'dt') {
          result = await this.putDtIndex(pvdData);
        }
        
        if (result.success) {
          console.log(`✅ ${indexType} 인덱싱 재시도 성공!`);
          return result;
        }
        
        console.log(`⚠️ ${indexType} 인덱싱 재시도 ${attempt} 실패, 다음 시도...`);
        await new Promise(resolve => setTimeout(resolve, 2000)); // 2초 대기
        
      } catch (error) {
        console.error(`❌ ${indexType} 인덱싱 재시도 ${attempt} 오류:`, error.message);
        if (attempt < maxRetries) {
          await new Promise(resolve => setTimeout(resolve, 2000));
        }
      }
    }
    
    console.error(`❌ ${indexType} 인덱싱 최대 재시도 횟수 초과`);
    return { success: false, error: '최대 재시도 횟수 초과' };
  }
  
  // DT 인덱스에 데이터 저장 (Speed와 동일한 로직)
  async putDtIndex(pvdData) {
    try {
      // console.log(`🔍 DT 인덱스에 저장 중: ${pvdData.collectionDt}`);
      
      // 인덱싱 서버를 통해 DT 인덱스에 저장
      const indexingClient = new FabricIndexingClient({
        serverAddr: 'localhost:50052',
        protoPath: path.join(__dirname, '../../grpc-go/protos/index_manager.proto')
      });
      
      await indexingClient.connect();
      // console.log(`✅ DT 인덱싱 클라이언트 연결 성공`);
      
      const indexRequest = {
        IndexID: 'dt',
        BcList: [{
          TxId: pvdData.txId || pvdData.msgId || `tx_${Date.now()}`,
          KeyCol: 'CollectionDt',
          Pvd: pvdData
        }],
        ColName: 'CollectionDt',
        ColIndex: 1, // CSV에서 CollectionDt 컬럼 인덱스
        FilePath: 'data/fabric/dt.bf',
        Network: 'fabric'
      };
      
      // console.log(`📤 DT 인덱싱 요청 전송 중...`);
      const result = await indexingClient.insertData(indexRequest);
      // console.log(`📥 DT 인덱싱 응답:`, JSON.stringify(result, null, 2));
      
      // 명시적으로 연결 종료
      await indexingClient.close();
      // console.log(`🔌 DT 인덱싱 클라이언트 연결 종료`);
      
      return { success: true, message: 'DT 인덱스 저장 완료' };
      
    } catch (error) {
      console.error(`❌ DT 인덱스 저장 실패: ${error.message}`);
      return { success: false, error: error.message };
    }
  }
  
  close() {
    if (this.client) {
      this.client.connected = false;
      // console.log('🔌 PVD 서버 연결 종료');
    }
  }
}


// Fabric 인덱스에서 실제 데이터 검색하는 함수
// 모든 speed_* 인덱스를 검색하는 함수
async function searchAllSpeedIndexes(indexingClient, searchValue) {
  console.log('🔍 모든 speed_* 인덱스에서 검색 중...');
  
  // 알려진 OBU ID들 (실제로는 동적으로 찾아야 하지만 임시로 하드코딩)
  const knownObuIds = [
    'OBU-TEST-001',
    'OBU-SPEED-001', 
    'OBU-SPEED-002',
    'OBU-SPEED-003', 
    'OBU-SPEED-004',
    'OBU-SPEED-005'
  ];
  
  const allResults = [];
  let totalCount = 0;
  
  for (const obuId of knownObuIds) {
    try {
      const indexID = `speed_${obuId}`;
      const filePath = `data/fabric/${indexID}.bf`;
      
      const searchRequest = {
        IndexID: indexID,
        Field: 'Speed',
        Value: searchValue,
        FilePath: filePath,
        KeySize: 64,
        ComOp: 'Eq'
      };
      
      console.log(`🔍 검색 중: ${indexID}`);
      const response = await indexingClient.searchData(searchRequest);
      
      if (response.IdxData && response.IdxData.length > 0) {
        console.log(`✅ ${indexID}에서 ${response.IdxData.length}개 발견`);
        allResults.push(...response.IdxData);
        totalCount += response.IdxData.length;
      }
    } catch (error) {
      console.log(`⚠️ ${indexID} 검색 실패: ${error.message}`);
    }
  }
  
  return {
    success: true,
    indexId: 'speed_*',
    indexName: 'All Speed Indexes',
    data: allResults,
    count: totalCount,
    network: 'fabric',
    searchType: 'speed',
    searchValue: searchValue,
    timestamp: new Date().toISOString()
  };
}

// Fabric 인덱스 전체 조회 함수 (grpc-go를 거쳐서 처리)
async function searchFabricIndexAll(indexType) {
  try {
    console.log(`🔍 Fabric ${indexType} 인덱스 전체 조회 중...`);
    
    // 인덱스 ID, 파일 경로, 필드명 설정
    let indexID, filePath, fieldName;
    
    // 직접 파일명이 지정된 경우 (예: speed.bf, dt.bf)
    if (indexType.includes('.bf')) {
      const fileName = indexType.replace('.bf', '');
      indexID = fileName;
      filePath = `data/fabric/${indexType}`;
      fieldName = fileName === 'speed' ? 'Speed' : fileName === 'dt' ? 'CollectionDt' : 'Speed';
      console.log(`📁 직접 파일 지정: ${filePath}`);
    } else {
      // 기존 타입 매핑 방식
        switch (indexType) {
          case 'speed':
          indexID = 'speed';
          filePath = 'data/fabric/speed.bf';
          fieldName = 'Speed';
            break;
          case 'dt':
          indexID = 'dt';
          filePath = 'data/fabric/dt.bf';
          fieldName = 'CollectionDt';
            break;
          case 'purpose':
          indexID = 'purpose';
          filePath = 'data/fabric/purpose.bf';
          fieldName = 'IndexableData';
            break;
          default:
          indexID = indexType;
          filePath = `data/fabric/${indexType}.bf`;
          fieldName = 'Speed'; // 기본값
      }
    }
    
    console.log(`🔍 인덱스 ID: ${indexID}, 파일 경로: ${filePath}`);
    
    // 인덱싱 서버를 통해 전체 데이터 조회
    console.log('🔗 Fabric 인덱싱 서버 연결 중...');
    
    const indexingClient = new FabricIndexingClient({
      serverAddr: 'localhost:50052',
      protoPath: path.join(__dirname, '../../grpc-go/protos/index_manager.proto')
    });
    
    await indexingClient.connect();
    // console.log('✅ Fabric 인덱싱 서버 연결 성공');
    
    // 전체 데이터 조회 요청 (Range로 모든 데이터 조회)
    const searchRequest = {
      IndexID: indexID,
      Field: fieldName, // 동적 필드명
      Value: fieldName === 'Speed' ? '' : '', // 빈 값으로 시작 (최소값)
      ValueEnd: fieldName === 'Speed' ? 'zzz' : 'zzz', // 최대값 (모든 문자열/숫자보다 큼)
      FilePath: filePath,
      KeySize: 64,
      ComOp: 'Range' // 범위 조회로 전체 데이터 조회
    };
    
    console.log('🔍 전체 데이터 조회 요청:', searchRequest);
    
    try {
      const result = await indexingClient.searchData(searchRequest);
      console.log('✅ Fabric 인덱스 전체 조회 완료!');
      
      // 응답 데이터 파싱
      const responseData = result.IdxData || result.data || [];
      const responseCount = responseData.length;
      
      console.log(`📊 조회 결과: ${responseCount}개 데이터 발견`);
      
      return {
        success: true,
        indexId: indexID,
        indexName: `Fabric ${indexType} Index`,
        data: responseData,
        count: responseCount,
        filePath: filePath,
        network: 'fabric',
        indexType: indexType,
        timestamp: new Date().toISOString()
      };
    
    } catch (searchError) {
      console.error('❌ 인덱스 검색 실패:', searchError.message);
      
      // 대안: fileidx 서버로 직접 조회 시도
      console.log('🔄 대안 방법으로 fileidx 서버 직접 조회 시도...');
        
        return {
        success: false,
        error: searchError.message,
        indexId: indexID,
        filePath: filePath,
        message: 'fileidx 서버로 직접 조회가 필요합니다',
        suggestion: `cd fileindex-go && ./fileidx -file=${filePath} -cmd=getall`
      };
    }
      
    } catch (error) {
    console.error(`❌ Fabric ${indexType} 인덱스 전체 조회 실패: ${error.message}`);
        throw error;
      }
    }
    


// 지갑 주소별 인덱스에 트랜잭션 ID 추가 (통합된 버전)
async function addToWalletIndex(walletAddress, txHash, network, organizationName = null) {
  const indexingClient = new IndexingClient({
    serverAddr: 'localhost:50052',
    protoPath: PROTO_PATH
  });
  
  try {
    await indexingClient.connect();
    
    // 모든 지갑 주소를 wallet_{hash} 형식으로 통일
    const addressHash = hashWalletAddress(walletAddress);
    const networkDir = (network === 'hardhat' || network === 'localhost') ? 'hardhat-local' : network;
    const indexID = `wallet_${addressHash}`;
    const filePath = `data/${networkDir}/wallet_${addressHash}.bf`;
    
    // 조직명 자동 매핑 (전달되지 않은 경우)
    if (!organizationName) {
      const orgMapping = {
        '0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC': 'Samsung',
        '0x90F79bf6EB2c4f870365E785982E1f101E93b906': 'LG',
        '0x70997970C51812dc3A010C7d01b50e0d17dc79C8': 'User1',
        '0x15d34AAf54267DB7D7c367839AAf71A00a2C6A65': 'User2',
        '0x9965507D1a55bcC2695C58ba16FB37d819B0A4dc': 'User3'
      };
      organizationName = orgMapping[walletAddress] || 'Unknown';
    }
    
    // 트랜잭션 ID를 인덱스에 추가
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
            "key": walletAddress,  // walletAddress를 직접 키로 사용
            "walletAddress": walletAddress,
            "organizationName": organizationName,
            "purpose": 'health_data_request',
            "status": 'PENDING',
            "timestamp": new Date().toISOString(),
            "createdAt": new Date().toISOString()
          },
          SchemaVersion: "1.0"
        }
      }],
      ColName: 'IndexableData',
      ColIndex: indexID,
      FilePath: filePath,
      Network: network
    };
    
    console.log(`  📝 지갑 인덱스 저장: ${organizationName} (${walletAddress.slice(0,10)}...) → ${txHash}`);
    await indexingClient.insertData(insertRequest);
    
    // 안전한 인덱싱을 위한 대기
    await new Promise(resolve => setTimeout(resolve, 200));
    
    indexingClient.close();
    
  } catch (error) {
    indexingClient.close();
    throw new Error(`지갑 인덱스 추가 실패: ${error.message}`);
  }
}

// 데이터 요청 함수 (생성된 인덱스들을 활용)
async function requestData(network) {
  try {
    console.log(`🔍 ${network} 네트워크에서 데이터 요청 시작...`);
    
    if (network === 'fabric') {
      throw new Error('Fabric 네트워크는 현재 지원하지 않습니다. Hardhat/EVM 네트워크를 사용하세요.');
    }
    
    // EVM 네트워크에서 컨트랙트를 통한 데이터 요청
    let provider, signer;
    
    if (network === 'hardhat') {
      // Hardhat 내장 네트워크 사용
      [signer] = await ethers.getSigners();
      provider = ethers.provider;
    } else {
      // 외부 네트워크 사용 (hardhat-local, localhost 등)
      const networkConfig = hre.config.networks[network];
      if (!networkConfig) {
        throw new Error(`hardhat.config.js에 ${network} 네트워크 설정이 없습니다.`);
      }
      
      provider = new ethers.JsonRpcProvider(networkConfig.url);
      signer = new ethers.Wallet(networkConfig.accounts[0], provider);
    }
    
    // 네트워크별 컨트랙트 주소 설정
    const contractAddress = network === 'monad' 
      ? '0x23EC7332865ecD204539f5C3535175C22D2C6388'  // Monad 테스트넷
      : '0x5FbDB2315678afecb367f032d93F642f64180aa3'; // Hardhat 로컬
    
    // AccessManagement 컨트랙트 연결
    const AccessManagement = await ethers.getContractFactory('AccessManagement', signer);
    const contract = AccessManagement.attach(contractAddress);
    
    console.log(`📝 요청자 주소: ${signer.address}`);
    console.log(`🔗 컨트랙트 주소: ${contractAddress}`);
    
    // 네트워크별 resourceOwner 주소 설정 (총 4개 주소)
    const resourceOwners = network === 'monad' 
      ? [
          '0x2630ffE517DFC9b0112317a2EC0AB4cE2a59CEb8',  // Monad 전용 주소
          '0xEeA02c9F24Bb2310167Cf2C9c3fD110348f98398',
          '0xB537086B2b20E864cEfFc8D2a32e2f037467661E',
          '0xfA29F5d9f7320b240Fa7F239466FDBf260d7BaB5'
        ]
      : [
          '0x70997970C51812dc3A010C7d01b50e0d17dc79C8',  // Hardhat 기본 주소
          '0xEeA02c9F24Bb2310167Cf2C9c3fD110348f98398',
          '0xB537086B2b20E864cEfFc8D2a32e2f037467661E',
          '0xfA29F5d9f7320b240Fa7F239466FDBf260d7BaB5'
        ];
    
    // BIMATRIX 기업의 건강 데이터 요청: 총 100개 요청 (수면 34개, 심박수 33개, 혈압 33개)
    const requests = [];
    
    // 수면 데이터 34개 생성 (4개 주소로 순환)
    for (let i = 0; i < 34; i++) {
      requests.push({
        resourceOwner: resourceOwners[i % 4], // 4개 주소로 순환
        purpose: '수면',
        organizationName: 'BIMATRIX'
      });
    }
    
    // 심박수 데이터 33개 생성 (4개 주소로 순환)
    for (let i = 0; i < 33; i++) {
      requests.push({
        resourceOwner: resourceOwners[i % 4], // 4개 주소로 순환
        purpose: '심박수',
        organizationName: 'BIMATRIX'
      });
    }
    
    // 혈압 데이터 33개 생성 (4개 주소로 순환)
    for (let i = 0; i < 33; i++) {
      requests.push({
        resourceOwner: resourceOwners[i % 4], // 4개 주소로 순환
        purpose: '혈압',
        organizationName: 'BIMATRIX'
      });
    }
    
    console.log(`\n📊 데이터 요청 구성:`);
    console.log(`   👤 resourceOwner 1: ${resourceOwners[0]}`);
    console.log(`   👤 resourceOwner 2: ${resourceOwners[1]}`);
    console.log(`   👤 resourceOwner 3: ${resourceOwners[2]}`);
    console.log(`   👤 resourceOwner 4: ${resourceOwners[3]}`);
    console.log(`   🛌 수면: 34개 (4개 주소로 순환)`);
    console.log(`   ❤️ 심박수: 33개 (4개 주소로 순환)`);
    console.log(`   🩺 혈압: 33개 (4개 주소로 순환)`);
    console.log(`   📋 총 100개 요청`);
    
    const results = [];
    
    for (let i = 0; i < requests.length; i++) {
      const req = requests[i];
      // console.log(`\n📋 데이터 요청 ${i + 1}/100: ${req.organizationName} → ${req.resourceOwner.slice(0,10)}... (${req.purpose})`);
      
      try {
        // 컨트랙트의 saveRequest 함수 호출
        console.log(`📤 트랜잭션 요청: ${req.organizationName} → ${req.purpose}`);
        const tx = await contract.saveRequest(
          req.resourceOwner,  // _resourceOwner (사용자 wallet 주소)
          req.purpose,        // _purpose (목적)
          req.organizationName // _organizationName (조직명)
        );
        
        if (!tx) {
          throw new Error('트랜잭션 생성 실패: tx가 undefined');
        }
        
        console.log(`⏳ 트랜잭션 전송: ${tx.hash}`);
        const receipt = await tx.wait();
        
        if (!receipt) {
          throw new Error('트랜잭션 영수증 수신 실패');
        }
        
        console.log(`✅ 트랜잭션 확인됨 (블록 ${receipt.blockNumber})`);
        
        // 트랜잭션 생성 후 인덱싱 수행
        console.log(`📊 인덱싱 시작: ${tx.hash}`);
        
        try {
          // Purpose 기반 인덱싱만 수행
          await addToPurposeIndexEVM(req.purpose, tx.hash, network, req.organizationName);
          await new Promise(resolve => setTimeout(resolve, 1000)); // 1초 대기
          
          console.log(`✅ Purpose 인덱싱 완료: ${tx.hash}`);
          
        } catch (indexError) {
          console.warn(`⚠️ 인덱싱 실패 (트랜잭션은 성공): ${indexError.message}`);
        }
        
        results.push({
          organizationName: req.organizationName,
          resourceOwner: req.resourceOwner,
          purpose: req.purpose,
          txHash: tx.hash,
          blockNumber: receipt.blockNumber,
          success: true
        });
        
        // 트랜잭션 간 충분한 대기 (블록 생성 시간 고려)
        await new Promise(resolve => setTimeout(resolve, 2000));
        
      } catch (error) {
        console.error(`❌ ${req.organizationName} 요청 실패:`, error.message);
        results.push({
          organizationName: req.organizationName,
          resourceOwner: req.resourceOwner,
          purpose: req.purpose,
          error: error.message,
          success: false
        });
      }
    }
    
    console.log('\n📊 데이터 요청 결과 요약:');
    console.log(`총 ${results.length}개 요청 처리 완료\n`);
    
    // 목적별 요약
    const sleepResults = results.filter(r => r.purpose === '수면');
    const heartResults = results.filter(r => r.purpose === '심박수');
    
    // console.log('😴 수면 데이터 요청 (Samsung):');
    // sleepResults.forEach((result, index) => {
    //   console.log(`   ${index + 1}. ${result.resourceOwner.slice(0,10)}... → ${result.purpose}: ${result.success ? '✅' : '❌'}`);
    //   if (result.success) console.log(`      트랜잭션: ${result.txHash}`);
    // });
    
    // console.log('\n💓 심박수 데이터 요청 (LG):');
    // heartResults.forEach((result, index) => {
    //   console.log(`   ${index + 1}. ${result.resourceOwner.slice(0,10)}... → ${result.purpose}: ${result.success ? '✅' : '❌'}`);
    //   if (result.success) console.log(`      트랜잭션: ${result.txHash}`);
    // });
    
    const successCount = results.filter(r => r.success).length;
    console.log(`\n✅ 성공: ${successCount}/${results.length}, ❌ 실패: ${results.length - successCount}/${results.length}`);
    
    return results;
    
  } catch (error) {
    console.error(`❌ ${network} 네트워크 데이터 요청 실패: ${error.message}`);
    throw error;
  }
}

// 트랜잭션 상세 조회 함수
async function getTxDetails(network, txId) {
  try {
    console.log(`🔍 ${network} 네트워크에서 트랜잭션 상세 조회 시작...`);
    console.log(`📄 트랜잭션 ID: ${txId}`);
    
    if (network === 'fabric') {
      return await getFabricTxDetails(txId);
    } else {
      return await getEvmTxDetails(network, txId);
    }
  } catch (error) {
    console.error(`❌ 트랜잭션 상세 조회 실패: ${error.message}`);
    throw error;
  }
}

// Fabric 트랜잭션 상세 조회
async function getFabricTxDetails(txId) {
  try {
    // PVD 클라이언트 연결
    const pvdClient = new PvdClient('localhost:19001');
    await pvdClient.connect();
    console.log('✅ PVD 서버 연결 성공');
    
    try {
      // 트랜잭션 상세 정보 조회
      console.log('🔄 트랜잭션 상세 정보 조회 중...');
      const result = await pvdClient.getDataByTxId(txId);
      
      if (result.success && result.data.length > 0) {
        console.log('\n🎉 트랜잭션 상세 조회 성공!');
        console.log(`📊 조회된 데이터 수: ${result.count}개`);
        
        result.data.forEach((item, index) => {
          console.log(`\n📋 트랜잭션 ${index + 1}:`);
          console.log(`   🔑 트랜잭션 ID: ${item.txId}`);
          console.log(`   ⏰ 조회 시간: ${item.timestamp}`);
          
          if (item.pvd) {
            console.log(`   🚗 PVD 상세 정보:`);
            console.log(`      • OBU ID: ${item.pvd.Obu_id || 'N/A'}`);
            console.log(`      • 수집 일시: ${item.pvd.Collection_dt || 'N/A'}`);
            console.log(`      • 속도: ${item.pvd.Speed || 'N/A'} km/h`);
            console.log(`      • 위도: ${item.pvd.Startvector_latitude || 'N/A'}`);
            console.log(`      • 경도: ${item.pvd.Startvector_longitude || 'N/A'}`);
            console.log(`      • 변속기: ${item.pvd.Transmisstion || 'N/A'}`);
            console.log(`      • RPM: ${item.pvd.Rpm || 'N/A'}`);
            console.log(`      • 기어: ${item.pvd.Gear || 'N/A'}`);
            console.log(`      • 연료량: ${item.pvd.Fuel_liter || 'N/A'}L (${item.pvd.Fuel_percent || 'N/A'}%)`);
            console.log(`      • 총 주행거리: ${item.pvd.Totaldist || 'N/A'}km`);
            console.log(`      • RSU ID: ${item.pvd.Rsu_id || 'N/A'}`);
            console.log(`      • MSG ID: ${item.pvd.Msg_id || 'N/A'}`);
          }
        });
        
        return result;
        
      } else {
        console.log('❌ 해당 트랜잭션 ID로 데이터를 찾을 수 없습니다');
        return {
          success: false,
          message: '데이터 없음',
          txId: txId
        };
      }
      
    } catch (error) {
      console.error('❌ 트랜잭션 상세 조회 실패:', error.message);
      throw error;
    } finally {
      pvdClient.close();
    }
  } catch (error) {
    console.error(`❌ Fabric 트랜잭션 상세 조회 실패: ${error.message}`);
    throw error;
  }
}

// ===== 메인 함수 =====
async function main() {
  // console.log(`🔧 BI-Index CLI - 명령어: ${cmd}, 네트워크: ${network}`);
  // console.log('=====================================');
  
  try {
    switch (cmd) {
      // ===== 컨트랙트 배포 =====
      case 'deploy':
        if (!network) {
          console.error('❌ deploy 명령어는 -network가 필요합니다');
          return;
        }
        await deployContract(network);
        break;
        

        // ===== 일반 인덱스 생성 =====
      case 'create-index':
        if (!type) {
          console.error('❌ create-index 명령어는 -type이 필요합니다');
          if (network === 'fabric') {
            console.log('예시: node cli.js -cmd=create-index -type=dt -network=fabric');
            console.log('예시: node cli.js -cmd=create-index -type=speed -network=fabric');
            console.log('예시: node cli.js -cmd=create-index -type=purpose2 -network=fabric');
            console.log('📝 Fabric 네트워크에서는 모든 인덱스 타입 생성 가능합니다');
          } else {
            console.log('예시: node cli.js -cmd=create-index -type=purpose2 -network=monad');
            console.log('예시: node cli.js -cmd=create-user-index -wallet=0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC -network=hardhat');
            console.log('📝 EVM 네트워크: create-index(타입만) 또는 create-user-index(지갑만) 사용');
          }
          return;
        }
        
        // 모든 네트워크에서 타입만 사용 (지갑 주소 없음)
        console.log(`📊 ${type} 타입 인덱스 생성 (지갑 주소 미사용)`);
        await createIndexUnified(network, type);
        break;
        
      // ===== 사용자 지정 지갑 인덱스 생성 =====
      case 'create-user-index':
        if (!wallet) {
          console.error('❌ create-user-index 명령어는 -wallet 파라미터가 필요합니다');
          console.log('예시: node cli.js -cmd=create-user-index -wallet=0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC -network=monad');
          console.log('예시: node cli.js -cmd=create-user-index -wallet=0xYourWalletAddress -network=hardhat');
          return;
        }
        
        // 지갑 주소 형식 검증 (0x로 시작하는 42자리 hex)
        if (!/^0x[a-fA-F0-9]{40}$/.test(wallet)) {
          console.error('❌ 올바르지 않은 지갑 주소 형식입니다');
          console.log('📝 올바른 형식: 0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC');
          return;
        }
        
        if (network === 'fabric') {
          console.error('❌ Fabric 네트워크에서는 create-user-index를 사용할 수 없습니다');
          console.log('📝 Fabric 네트워크에서는 create-index를 사용하세요');
          return;
        }
        
        // 지갑 주소만 사용 (타입 없음)
        const userIndexType = 'wallet'; // 기본 타입을 wallet로 설정
        console.log(`📱 사용자 지정 지갑 인덱스: ${wallet}`);
        await createIndexUnified(network, userIndexType, wallet);
        break;

      // ===== Fabric 인덱스 생성 =====
      case 'create-fabric-index':
        if (!type) {
          console.error('❌ create-fabric-index 명령어는 -type이 필요합니다');
          console.log('예시: node cli.js -cmd=create-fabric-index -type=speed -network=fabric');
          return;
        }
        await createIndexUnified(network, type);
        break;
        
      // ===== PVD 데이터 저장 =====
      case 'putdata':
        if (type === 'single') {
          // CSV 데이터 개별 처리
          const csvFile = value || 'pvd_hist_100.csv';
          const batchSize = process.argv.find(arg => arg.startsWith('-batch='))?.split('=')[1] || '1000';
          await putPvdMultiData(network, csvFile, parseInt(batchSize));
        } else {
          // 단건 데이터 넣기
          if (!value) {
            console.error('❌ putdata 명령어는 -value가 필요합니다');
            console.log('예시: node cli.js -cmd=putdata -value=OBU-TEST-001 -network=fabric');
            console.log('     node cli.js -cmd=putdata -type=single -value=scripts/pvd_hist_10.csv -network=fabric');
            return;
          }
          await putPvdData(network, value);
        }
        break;
        

      // ===== 지갑 주소별 데이터 조회 =====
      case 'search':
        if (!value) {
          console.error('❌ search 명령어는 -value(지갑 주소)가 필요합니다');
          console.log('예시: node cli.js -cmd=search -value=0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC -network=hardhat');
          console.log('예시: node cli.js -cmd=search -value=0x70997970C51812dc3A010C7d01b50e0d17dc79C8 -network=hardhat');
          return;
        }
        await searchByWalletAddress(network, value);
        break;
        
      // ===== 인덱스 전체 조회 =====
      case 'search-index':
        if (!type) {
          console.error('❌ search-index 명령어는 -type이 필요합니다');
          console.log('예시: node cli.js -cmd=search-index -type=speed -network=fabric');
          console.log('예시: node cli.js -cmd=search-index -type=purpose2 -network=monad');
          console.log('예시: node cli.js -cmd=search-index -type=custom -wallet=0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC -network=hardhat');
          console.log('📝 EVM 네트워크에서 -wallet은 선택사항입니다 (기본값 사용)');
          return;
        }
        await searchIndexAll(network, type);
        break;
        
      // ===== 트랜잭션 상세 조회 =====
      case 'get-tx-details':
        if (!value) {
          console.error('❌ get-tx-details 명령어는 -value(트랜잭션 ID)가 필요합니다');
          console.log('예시 (Fabric PVD): node cli.js -cmd=get-tx-details -value=05aba83a12c143d3843e363f21ac4759c61db8b6c4c1a609db62b40412fbe5d5 -network=fabric');
          console.log('예시 (EVM): node cli.js -cmd=get-tx-details -value=0x1234567890abcdef... -network=hardhat-local');
          return;
        }
        if (!network) {
          console.error('❌ get-tx-details 명령어는 -network가 필요합니다');
          console.log('지원되는 네트워크: fabric (Hyperledger Fabric), hardhat-local (EVM)');
          return;
        }
        if (network !== 'fabric' && network !== 'hardhat-local' && network !== 'hardhat' && network !== 'monad') {
          console.error('❌ 트랜잭션 상세 조회는 fabric, hardhat-local, hardhat, monad 네트워크에서만 지원됩니다');
          console.log('지원되는 네트워크: fabric, hardhat-local, hardhat, monad');
          return;
        }
        await getTxDetails(network, value);
        break;
        
      // ===== Access Management TxId 상세 조회 =====
      case 'get-access-tx-details':
        if (!value) {
          console.error('❌ get-access-tx-details 명령어는 -value(트랜잭션 ID)가 필요합니다');
          console.log('예시: node cli.js -cmd=get-access-tx-details -value=23ed3f54e86765409324ee100b1f80bd9d04ff08aff1169aaff054b7564de03a --network=fabric');
          return;
        }
        if (!network) {
          console.error('❌ get-access-tx-details 명령어는 --network가 필요합니다');
          return;
        }
        if (network !== 'fabric') {
          console.error('❌ Access Management TxId 조회는 fabric 네트워크에서만 지원됩니다');
          return;
        }
        await getAccessTxDetails(value);
        break;

      // ===== 성능 비교 (목적별) =====
      case 'compare-performance':
        if (!value) {
          console.log('❌ 목적이 필요합니다: -value=수면');
          return;
        }
        if (!network) {
          console.error('❌ compare-performance 명령어는 --network가 필요합니다');
          return;
        }
        await comparePerformanceByPurpose(network, value);
        break;

      // ===== 인덱스 기반 완전 조회 =====
      case 'search-and-fetch':
        if (!value) {
          console.log('❌ 목적이 필요합니다: -value=수면');
          return;
        }
        if (!network) {
          console.error('❌ search-and-fetch 명령어는 --network가 필요합니다');
          return;
        }
        await searchAndFetchDetailsByPurpose(network, value);
        break;
        
        
      // ===== Purpose 기반 검색 (네트워크별) =====
      case 'search-purpose':
        if (!network) {
          console.error('❌ search-purpose 명령어는 --network가 필요합니다');
          console.log('사용법:');
          console.log('  node cli.js -cmd=search-purpose -value="수면" --network=fabric');
          console.log('  node cli.js -cmd=search-purpose -value="수면" --network=hardhat');
          console.log('  node cli.js -cmd=search-purpose -value="수면" --network=monad');
          return;
        }
        if (!value) {
          console.error('❌ search-purpose 명령어는 -value(목적)가 필요합니다');
          console.log(`예시: node cli.js -cmd=search-purpose -value="수면" --network=${network}`);
          return;
        }
        
        if (network === 'fabric') {
          await fabricSearchByPurpose(value);
        } else {
          await searchByPurposeEVM(network, value);
        }
        break;
        
      // ===== 데이터 요청 =====
      case 'request-data':
        if (!network) {
          console.error('❌ request-data 명령어는 -network가 필요합니다');
          return;
        }
        
        if (network === 'fabric') {
          await fabricRequestData();
        } else {
          await requestData(network); // 기존 EVM 로직
        }
        break;
        
        
      // ===== 설정 확인 =====
      case 'check-config':
        checkConfig();
        break;
        
      // ===== 네트워크 설정 확인 =====
      case 'check-network-config':
        if (!network) {
          console.error('❌ check-network-config 명령어는 -network가 필요합니다');
          return;
        }
        checkNetworkConfig(network);
        break;
        
      // ===== 네트워크 업데이트 =====
      case 'update-network':
        if (!network || !contract) {
          console.error('❌ update-network 명령어는 -network와 -contract가 필요합니다');
          console.log('예시: node cli.js -cmd=update-network -network=hardhat -contract=0x1234...');
          return;
        }
        console.log(`🔧 ${network} 네트워크 설정 업데이트 완료`);
        console.log(`📝 컨트랙트 주소: ${contract}`);
        break;
        
      // ===== 성능 비교 테스트 =====
      case 'performance-test':
        if (!network) {
          console.error('❌ performance-test 명령어는 -network가 필요합니다');
          console.log('예시: node cli.js -cmd=performance-test -network=hardhat');
          console.log('📝 2000건 데이터로 인덱스 검색 vs 블록체인 직접 조회 성능 비교');
          return;
        }
        if (network === 'fabric') {
          console.error('❌ performance-test는 현재 EVM 네트워크에서만 지원됩니다');
          console.log('📝 지원 네트워크: hardhat, hardhat-local, localhost');
          return;
        }
        await runPerformanceComparisonTest(network);
        break;

      // ===== CSV 파일에서 데이터 생성 =====
      case 'generate-from-csv':
        if (!network) {
          console.error('❌ generate-from-csv 명령어는 -network가 필요합니다');
          console.log('예시: node cli.js -cmd=generate-from-csv -network=hardhat-local -value=data.csv');
          console.log('📝 CSV 파일에서 데이터를 읽어서 블록체인에 저장 + 인덱싱');
          return;
        }
        if (!value) {
          console.error('❌ generate-from-csv 명령어는 -value로 CSV 파일 경로가 필요합니다');
          console.log('예시: node cli.js -cmd=generate-from-csv -network=hardhat-local -value=./data/sample.csv');
          return;
        }
        if (network === 'fabric') {
          console.error('❌ generate-from-csv는 현재 EVM 네트워크에서만 지원됩니다');
          console.log('📝 지원 네트워크: hardhat-local, hardhat, localhost');
          return;
        }
        await generateDataFromCSV(network, value);
        break;
        
      // ===== 도움말 =====
      case 'help':
        showHelp();
        break;
        
      default:
        console.error(`❌ 알 수 없는 명령어: ${cmd}`);
        console.log('사용 가능한 명령어: deploy, create-index, create-user-index, create-fabric-index, putdata, search-index, get-tx-details, request-data, performance-test, compare-performance, large-scale-test, check-config, check-network-config, update-network, help');
        break;
    }
    
  } catch (error) {
    console.error(`❌ 명령어 실행 실패: ${error.message}`);
  }
}

// 도움말 함수
function showHelp() {
  console.log('\n🔧 BI-Index CLI 도움말');
  console.log('=====================================');
  console.log('\n📋 사용 가능한 명령어:');
  console.log('  deploy                    - 컨트랙트 배포');
  console.log('  create-index              - 인덱스 생성 (타입만 사용)');
  console.log('  create-user-index         - 사용자 지정 지갑 인덱스 생성 (지갑만 사용)');
  console.log('  create-fabric-index       - Fabric 인덱스 생성');
  console.log('  putdata                   - PVD 데이터 저장');
  console.log('  search                    - 지갑 주소별 데이터 조회');
  console.log('  search-index              - 인덱스 전체 조회');
  console.log('  search-purpose            - Purpose 기반 데이터 검색 (네트워크별)');
  console.log('  get-tx-details            - 트랜잭션 상세 조회 (PVD용)');
  console.log('  get-access-tx-details     - Access Management TxId 상세 조회');
  console.log('  request-data              - 샘플 데이터 생성 (네트워크별)');
  console.log('  generate-from-csv         - CSV 파일에서 데이터 생성 (컨트랙트 배포 + 인덱싱)');
  console.log('  performance-test          - 성능 비교 테스트 (인덱스 vs 블록체인 직접 조회)');
  console.log('  compare-performance       - 특정 목적 데이터 성능 비교 (인덱스 vs 블록체인)');
  console.log('  search-and-fetch          - 인덱스 조회 + 모든 상세 데이터 가져오기');
  console.log('  check-config              - 설정 확인');
  console.log('  check-network-config      - 네트워크 설정 확인');
  console.log('  update-network            - 네트워크 업데이트');
  console.log('  help                      - 이 도움말 표시');
  
  console.log('\n🌐 네트워크 옵션:');
  console.log('  -network=fabric           - Hyperledger Fabric (기본값)');
  console.log('  -network=hardhat          - Hardhat');
  console.log('  -network=hardhat-local    - Hardhat Local');
  console.log('  -network=localhost        - Localhost');
  
  console.log('\n📝 사용 예시:');
  console.log('  # Fabric 네트워크 (기본값) - 모든 타입 지원');
  console.log('  node scripts/cli.js -cmd=create-index -type=speed');
  console.log('  node scripts/cli.js -cmd=create-index -type=dt');
  console.log('  node scripts/cli.js -cmd=create-index -type=purpose2');
  console.log('  node scripts/cli.js -cmd=search-index -type=speed');
  console.log('  node scripts/cli.js -cmd=request-data --network=fabric');
  console.log('  node scripts/cli.js -cmd=search-purpose -value="수면" --network=fabric');
  console.log('');
  console.log('  # EVM 네트워크 - 두 가지 방식');
  console.log('  # 1) 순수 타입 인덱스 (타입만)');
  console.log('  node scripts/cli.js -cmd=create-index -type=custom -network=hardhat');
  console.log('  # 2) 사용자 지정 지갑 인덱스 (지갑만)');
  console.log('  node scripts/cli.js -cmd=create-user-index -wallet=0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC -network=monad');
  console.log('  node scripts/cli.js -cmd=create-user-index -wallet=0xYourWalletAddress -network=hardhat');
  console.log('  # 인덱스 조회');
  console.log('  node scripts/cli.js -cmd=search-purpose -value="수면" --network=hardhat');
  console.log('  node scripts/cli.js -cmd=search-purpose -value="수면" --network=monad');
  console.log('  node scripts/cli.js -cmd=get-tx-details -value="트랜잭션"... -network=hardhat');
  console.log('  node scripts/cli.js -cmd=request-data --network=hardhat');
  console.log('  node scripts/cli.js -cmd=compare-performance -value="수면" --network=hardhat-local');
  console.log('  node scripts/cli.js -cmd=search-and-fetch -value="수면" --network=hardhat-local');
  
  console.log('\n💡 팁:');
  console.log('  • -network를 생략하면 자동으로 fabric 네트워크가 사용됩니다');
}

// Access Management 모든 요청 조회 함수
async function getAllAccessManagementRequests() {
  try {
    console.log(`🔍 Access Management 모든 요청 조회...`);
    
    // gRPC 클라이언트 설정
    const grpc = require('@grpc/grpc-js');
    const protoLoader = require('@grpc/proto-loader');
    
    const PROTO_PATH = path.join(__dirname, '../../grpc-go/accessapi/access_management.proto');
    const packageDefinition = protoLoader.loadSync(PROTO_PATH, {
      keepCase: true,
      longs: String,
      enums: String,
      defaults: true,
      oneofs: true
    });
    
    const accessProto = grpc.loadPackageDefinition(packageDefinition).accessapi;
    const client = new accessProto.AccessManagementService('localhost:19001', grpc.credentials.createInsecure());
    
    // GetAllRequests 호출 (이 함수가 proto에 정의되어 있다고 가정)
    // 만약 없다면 다른 방법을 사용해야 함
    console.log(`❌ GetAllRequests 함수가 proto에 정의되지 않았습니다.`);
    client.close();
    return {
      success: false,
      message: 'GetAllRequests 함수를 사용할 수 없습니다.'
    };
    
  } catch (error) {
    console.error(`❌ Access Management 모든 요청 조회 실패: ${error.message}`);
    return {
      success: false,
      message: error.message
    };
  }
}

// Access Management 데이터 조회 함수
async function getAccessManagementData(txId) {
  try {
    console.log(`🔍 Access Management 데이터 조회: ${txId}`);
    
    // gRPC 클라이언트 설정
    const grpc = require('@grpc/grpc-js');
    const protoLoader = require('@grpc/proto-loader');
    
    const PROTO_PATH = path.join(__dirname, '../../grpc-go/accessapi/access_management.proto');
    const packageDefinition = protoLoader.loadSync(PROTO_PATH, {
      keepCase: true,
      longs: String,
      enums: String,
      defaults: true,
      oneofs: true
    });
    
    const accessProto = grpc.loadPackageDefinition(packageDefinition).accessapi;
    const client = new accessProto.AccessManagementService('localhost:19001', grpc.credentials.createInsecure());
    
    // TxId 형식 확인 및 RequestId 추출
    let requestId;
    
    if (txId.length === 64) {
      // 64자리 TxId인 경우 - Access Management 데이터도 TxId로 저장됨
      console.log(`🔍 64자리 TxId로 Access Management 데이터 조회: ${txId}`);
      // RequestId 추출 없이 바로 조회
    } else {
      // 기타 TxId 형식도 모두 TxId로 직접 조회 시도
      console.log(`🔍 TxId로 Access Management 데이터 조회: ${txId}`);
    }
    
    // GetAccessRequestByTxId 호출 (PVD 방식과 동일)
    const response = await new Promise((resolve, reject) => {
      client.GetAccessRequestByTxId({
        txId: txId
      }, (error, response) => {
        if (error) reject(error);
        else resolve(response);
      });
    });
    
    if (response.success) {
      console.log(`✅ Access Management 데이터 조회 성공`);
      // console.log(`   소유자: ${response.request.resourceOwner}`);
      // console.log(`   목적: ${response.request.purpose}`);
      // console.log(`   조직: ${response.request.organizationName}`);
      // console.log(`   상태: ${response.status}`);
      
      client.close();
      return {
        success: true,
        data: {
          requestId: requestId,
          resourceOwner: response.request.resourceOwner,
          purpose: response.request.purpose,
          organizationName: response.request.organizationName,
          status: response.status
        }
      };
    } else {
      console.log(`❌ Access Management 데이터 조회 실패: ${response.message}`);
      client.close();
      return {
        success: false,
        message: response.message
      };
    }
    
  } catch (error) {
    console.error(`❌ Access Management 데이터 조회 실패: ${error.message}`);
    return {
      success: false,
      message: error.message
    };
  }
}

// Access Management TxId 상세 조회 함수
async function getAccessTxDetails(txId) {
  try {
    console.log(`🔍 Access Management TxId 상세 조회: ${txId}`);
    
    // 1. 먼저 Access Management gRPC로 실제 요청 데이터 조회
    console.log('🔄 Access Management에서 실제 요청 데이터 조회 중...');
    const accessResult = await getAccessManagementData(txId);
    
    if (!accessResult.success) {
      console.log(`❌ Access Management에서 요청을 찾을 수 없습니다: ${txId}`);
      return {
        success: false,
        txId: txId,
        message: 'Access Management에서 해당 요청을 찾을 수 없습니다.'
      };
    }
    
    // gRPC 클라이언트 설정
    const grpc = require('@grpc/grpc-js');
    const protoLoader = require('@grpc/proto-loader');
    
    const PROTO_PATH = path.join(__dirname, '../../grpc-go/accessapi/access_management.proto');
    const packageDefinition = protoLoader.loadSync(PROTO_PATH, {
      keepCase: true,
      longs: String,
      enums: String,
      defaults: true,
      oneofs: true
    });
    
    const accessProto = grpc.loadPackageDefinition(packageDefinition).accessapi;
    const client = new accessProto.AccessManagementService('localhost:19001', grpc.credentials.createInsecure());
    
    // 모든 Access Management 요청 조회
    // console.log('🔄 모든 Access Management 요청 조회 중...');
    
    // 인덱스에서 해당 TxId로 Purpose 검색
    // console.log('🔍 인덱스에서 TxId 검색 중...');
    
    // 간단한 방법: Purpose 검색으로 해당 TxId가 포함된 결과 찾기
    const purposes = ['혈압', '수면', '심박수']; // 가능한 Purpose 목록
    
    for (const purpose of purposes) {
      const response = await new Promise((resolve, reject) => {
        client.SearchAccessRequestsByPurpose({
          purpose: purpose
        }, (error, response) => {
          if (error) reject(error);
          else resolve(response);
        });
      });
      
      // 해당 TxId가 결과에 포함되어 있는지 확인
      if (response.txIds && response.txIds.includes(txId)) {
        // console.log(`\n✅ TxId 매칭 성공!`);
        // console.log(`🎯 Purpose: ${purpose}`);
        // console.log(`🔑 Transaction ID: ${txId}`);
        
        console.log('=== 트랜잭션 상세 정보 ===');
        console.log(`🔗 트랜잭션 해시: ${txId}`);
        console.log(`🎯 Purpose: ${purpose}`);
        console.log(`✅ 상태: 성공`);
        
        // Access Management에서 조회한 실제 데이터 표시면ㅇㅡ로만 나온거야
        if (accessResult.data) {
          console.log(`\n📊 Access Management 데이터:`);
          // console.log(`   🔑 Request ID: ${accessResult.data.requestId}`);
          console.log(`   👤 소유자: ${accessResult.data.resourceOwner}`);
          console.log(`   🎯 목적: ${accessResult.data.purpose}`);
          console.log(`   🏢 조직: ${accessResult.data.organizationName}`);
          console.log(`   📊 상태: ${accessResult.data.status}`);
        }
        
        // 관련 요청 정보 표시 제거 - 불필요한 출력
        
        client.close();
        return {
          success: true,
          txId: txId,
          purpose: purpose,
          matchedRequests: response.requests || [],
          accessManagementData: accessResult.data
        };
      }
    }
    
    console.log(`❌ TxId ${txId}에 해당하는 Access Management 요청을 찾을 수 없습니다.`);
    client.close();
    
    return {
      success: false,
      txId: txId,
      message: 'TxId에 해당하는 요청을 찾을 수 없습니다.'
    };
    
  } catch (error) {
    console.error(`❌ Access Management TxId 상세 조회 실패: ${error.message}`);
    throw error;
  }
}

// 스크립트가 직접 실행될 때만 main 함수 호출
if (require.main === module) {
  main().catch(console.error);
}

// EVM 트랜잭션 상세 조회 (ABI 파싱 포함)
async function getEvmTxDetails(network, txHash) {
  try {
    console.log(`🔍 EVM 네트워크 트랜잭션 상세 조회: ${txHash}`);
    
    // 네트워크 설정
    let provider;
    if (network === 'hardhat' || network === 'hardhat-local' || network === 'localhost') {
      provider = new ethers.JsonRpcProvider('http://127.0.0.1:8545');
    } else {
      const networkConfig = hre.config.networks[network];
      if (!networkConfig) {
        throw new Error(`hardhat.config.js에 ${network} 네트워크 설정이 없습니다.`);
      }
      provider = new ethers.JsonRpcProvider(networkConfig.url);
    }
    
    console.log('📡 트랜잭션 정보 조회 중...');
    
    // 1. 트랜잭션 정보 조회
    const tx = await provider.getTransaction(txHash);
    if (!tx) {
      throw new Error(`트랜잭션을 찾을 수 없습니다: ${txHash}`);
    }
    
    // 2. 트랜잭션 영수증 조회
    const receipt = await provider.getTransactionReceipt(txHash);
    if (!receipt) {
      throw new Error(`트랜잭션 영수증을 찾을 수 없습니다: ${txHash}`);
    }
    
    // console.log('트랜잭션 상세 조회 성공!');
    console.log('=== 트랜잭션 상세 정보 ===');
    console.log(`🔗 트랜잭션 해시: ${tx.hash}`);
    console.log(`📦 블록 번호: ${receipt.blockNumber}`);
    // console.log(`📍 블록 해시: ${receipt.blockHash}`);
    // console.log(`📊 트랜잭션 인덱스: ${receipt.index}`);
    console.log(`👤 발신자: ${tx.from}`);
    console.log(`🎯 수신자: ${tx.to}`);
    // console.log(`💰 값: ${ethers.formatEther(tx.value)} ETH`);
    // console.log(`⛽ 가스 한도: ${tx.gasLimit.toString()}`);
    // console.log(`💸 가스 가격: ${ethers.formatUnits(tx.gasPrice, 'gwei')} Gwei`);
    // console.log(`⛽ 사용된 가스: ${receipt.gasUsed.toString()}`);
    console.log(`✅ 상태: ${receipt.status === 1 ? '성공' : '실패'}`);
    
    // 3. AccessManagement 컨트랙트 ABI 로드 및 디코딩
    try {
      const AccessManagementArtifact = require('../artifacts/contracts/AccessManagement.sol/AccessManagement.json');
      const contractInterface = new ethers.Interface(AccessManagementArtifact.abi);
      
      // console.log('\\n📝 === 함수 호출 정보 ===');
      
      // 4. 입력 데이터 디코딩
      if (tx.data && tx.data !== '0x') {
        try {
          const decodedData = contractInterface.parseTransaction({ 
            data: tx.data, 
            value: tx.value 
          });
          
          console.log(`🔧 함수명: ${decodedData.name}`);
          console.log(`📊 매개변수:`);
          
          decodedData.args.forEach((arg, index) => {
            const param = decodedData.fragment.inputs[index];
            console.log(`   ${param.name} (${param.type}): ${arg}`);
          });
          
        } catch (decodeError) {
          console.log(`⚠️ 함수 호출 데이터 디코딩 실패: ${decodeError.message}`);
        }
      }
      
      // 5. 이벤트 로그 디코딩
      if (receipt.logs && receipt.logs.length > 0) {
        console.log(' === 이벤트 로그 ===');
        
        receipt.logs.forEach((log, index) => {
          try {
            const parsedLog = contractInterface.parseLog({
              topics: log.topics,
              data: log.data
            });
            
            console.log(`\\n📋 이벤트 ${index + 1}: ${parsedLog.name}`);
            parsedLog.args.forEach((arg, argIndex) => {
              const param = parsedLog.fragment.inputs[argIndex];
              console.log(`   ${param.name} (${param.type}): ${arg}`);
            });
            
          } catch (logError) {
            console.log(`⚠️ 로그 ${index + 1} 디코딩 실패`);
          }
        });
      } else {
        // console.log("⚠️ 이벤트 로그가 없습니다");
      }
      
    } catch (abiError) {
      console.log(`⚠️ ABI 로드 실패: ${abiError.message}`);
    }
    
    return { success: true, transaction: tx, receipt: receipt };
    
  } catch (error) {
    console.error(`❌ EVM 트랜잭션 조회 실패: ${error.message}`);
    throw error;
  }
}

// EVM 전용 Purpose 기반 인덱싱 함수
async function addToPurposeIndexEVM(purpose, txHash, network, organizationName = null) {
  try {
    console.log(`📝 Purpose 인덱스에 저장 중: ${purpose} → ${txHash}`);
    
    // EVM 네트워크만 지원
    if (network === 'fabric') {
      throw new Error('Fabric 네트워크는 지원하지 않습니다. EVM 네트워크를 사용하세요.');
    }
    
    const indexingClient = new IndexingClient({
      serverAddr: 'localhost:50052',
      protoPath: PROTO_PATH
    });
    
    await indexingClient.connect();
    
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
    
    console.log(`  📝 Purpose 인덱스 저장: ${purpose} → ${txHash}`);
    await indexingClient.insertData(insertRequest);
    
    // 안전한 인덱싱을 위한 대기
    await new Promise(resolve => setTimeout(resolve, 500));
    
    indexingClient.close();
    
  } catch (error) {
    console.error(`❌ Purpose 인덱스 추가 실패: ${error.message}`);
    throw error;
  }
}

// EVM 전용 사용자 정의 인덱스 함수 (gender, age 등)
async function addToCustomIndex(indexType, indexValue, txHash, network, organizationName = null) {
  try {
    console.log(`📝 ${indexType} 인덱스에 저장 중: ${indexValue} → ${txHash}`);
    
    // EVM 네트워크만 지원
    if (network === 'fabric') {
      throw new Error('Fabric 네트워크는 지원하지 않습니다. EVM 네트워크를 사용하세요.');
    }
    
    const indexingClient = new IndexingClient({
      serverAddr: 'localhost:50052',
      protoPath: PROTO_PATH
    });
    
    await indexingClient.connect();
    
    const networkDir = (network === 'hardhat' || network === 'localhost') ? 'hardhat-local' : network;
    const indexID = indexType;
    const filePath = `data/${networkDir}/${indexType}.bf`;
    
    // IndexableData 안에 사용자 정의 값을 포함하여 동적 인덱싱
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
            "key": indexValue,  // 사용자 정의 값을 키로 사용
            [indexType]: indexValue,  // 동적 필드명
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
    
    console.log(`  📝 ${indexType} 인덱스 저장: ${indexValue} → ${txHash}`);
    await indexingClient.insertData(insertRequest);
    
    // 안전한 인덱싱을 위한 대기
    await new Promise(resolve => setTimeout(resolve, 500));
    
    indexingClient.close();
    
  } catch (error) {
    console.error(`❌ ${indexType} 인덱스 추가 실패: ${error.message}`);
    throw error;
  }
}

// EVM 전용 Purpose 기반 검색 함수
async function searchByPurposeEVM(network, purpose) {
  try {
    console.log(`🔍 ${network} 네트워크에서 Purpose 기반 검색 시작...`);
    console.log(`🎯 검색 목적: ${purpose}`);
    
    // EVM 네트워크만 지원
    if (network === 'fabric') {
      throw new Error('Fabric 네트워크는 지원하지 않습니다. EVM 네트워크를 사용하세요.');
    }
    
    const indexingClient = new IndexingClient({
      serverAddr: 'localhost:50052',
      protoPath: PROTO_PATH
    });
    
    await indexingClient.connect();
    console.log('✅ 인덱싱 서버 연결 성공');
    
    const networkDir = (network === 'hardhat' || network === 'localhost') ? 'hardhat-local' : network;
    const indexID = 'purpose';
    const filePath = `data/${networkDir}/purpose.bf`;
    
    // IndexableData 안의 purpose 필드로 검색
    const searchRequest = {
      IndexID: indexID,
      Field: 'IndexableData',
      Value: purpose,
      FilePath: filePath,
      KeySize: 64,
      ComOp: 'Eq'
    };
    
    // console.log(`🔧 검색 요청:`, searchRequest);
    
    const result = await indexingClient.searchData(searchRequest);
    
    // 결과 정리 및 출력
    const cleanResult = {
      success: true,
      purpose: purpose,
      indexId: indexID,
      data: result.IdxData || [],
      count: result.IdxData?.length || 0,
      network: network,
      timestamp: new Date().toISOString()
    };
    
    console.log(`\n📊 검색 결과:`);
    console.log(`   🎯 목적: ${purpose}`);
    console.log(`   🆔 인덱스 ID: ${indexID}`);
    console.log(`   📊 데이터 개수: ${cleanResult.count}`);
    
    if (cleanResult.data.length > 0) {
      console.log(`   📋 트랜잭션 목록:`);
      cleanResult.data.forEach((txHash, index) => {
        console.log(`      ${index + 1}. ${txHash}`);
      });
    } else {
      console.log(`   ℹ️  해당 목적과 관련된 데이터가 없습니다.`);
    }
    
    indexingClient.close();
    return cleanResult;
    
  } catch (error) {
    console.error(`❌ Purpose 기반 검색 실패: ${error.message}`);
    throw error;
  }
}

// EVM 전용 Purpose 인덱스 생성 함수
async function createPurposeIndexEVM(network) {
  try {
    console.log(`🔧 ${network} 네트워크에 Purpose 인덱스 생성 중...`);
    
    // EVM 네트워크만 지원
    if (network === 'fabric') {
      throw new Error('Fabric 네트워크는 지원하지 않습니다. EVM 네트워크를 사용하세요.');
    }
    
    const indexingClient = new IndexingClient({
      serverAddr: 'localhost:50052',
      protoPath: PROTO_PATH
    });
    
    await indexingClient.connect();
    console.log('✅ 인덱싱 서버 연결 성공');
    
    const networkDir = (network === 'hardhat' || network === 'localhost') ? 'hardhat-local' : network;
    const indexID = 'purpose';
    const filePath = `data/${networkDir}/purpose.bf`;
    
    const createRequest = {
      IndexID: indexID,
      IndexName: `${network.toUpperCase()} Purpose Index`,
      KeyCol: 'IndexableData',
      FilePath: filePath,
      KeySize: 64
    };
    
    console.log(`🔧 인덱스 생성 요청:`, createRequest);
    
    const response = await indexingClient.createIndex(createRequest);
    console.log(`✅ Purpose 인덱스 생성 완료!`);
    console.log(`📁 인덱스 파일: ${filePath}`);
    
    indexingClient.close();
    
    return {
      success: true,
      network: network,
      indexType: 'purpose',
      indexId: indexID,
      filePath: filePath,
      message: `${network} Purpose 인덱스 생성 완료`
    };
    
  } catch (error) {
    console.error(`❌ Purpose 인덱스 생성 실패: ${error.message}`);
    throw error;
  }
}

// ===== Fabric 전용 함수들 =====

// Fabric용 샘플 데이터 생성 함수
async function fabricRequestData() {
  try {
    console.log('🔍 Fabric 네트워크에서 샘플 데이터 요청 시작...');
    
    // gRPC 클라이언트 설정
    const grpc = require('@grpc/grpc-js');
    const protoLoader = require('@grpc/proto-loader');
    
    const PROTO_PATH = path.join(__dirname, '../../grpc-go/accessapi/access_management.proto');
    const packageDefinition = protoLoader.loadSync(PROTO_PATH, {
      keepCase: true,
      longs: String,
      enums: String,
      defaults: true,
      oneofs: true
    });
    
    const accessProto = grpc.loadPackageDefinition(packageDefinition).accessapi;
    const client = new accessProto.AccessManagementService('localhost:19001', grpc.credentials.createInsecure());
    
    // Fabric용 샘플 데이터 (EVM 예시 참고)
    const fabricRequests = [];
    
    // 총 100개 데이터 생성 (Fabric용 사용자명)
    const fabricUsers = [
      'alice',
      'bob', 
      'carol',
      'david'
    ];
    
    // 수면 데이터 34개 생성
    for (let i = 0; i < 34; i++) {
      fabricRequests.push({
        resourceOwner: fabricUsers[i % 4], // 4개 사용자로 순환
        purpose: '수면',
        organizationName: 'BIMATRIX'
      });
    }
    
    // 혈압 데이터 33개 생성
    for (let i = 0; i < 33; i++) {
      fabricRequests.push({
        resourceOwner: fabricUsers[i % 4],
        purpose: '혈압',
        organizationName: 'BIMATRIX'
      });
    }
    
    // 심박수 데이터 33개 생성
    for (let i = 0; i < 33; i++) {
      fabricRequests.push({
        resourceOwner: fabricUsers[i % 4],
        purpose: '심박수', 
        organizationName: 'BIMATRIX'
      });
    }
    
    console.log(`📊 총 ${fabricRequests.length}개의 Fabric 샘플 데이터 생성 완료`);
    
    const results = [];
    
    for (let i = 0; i < fabricRequests.length; i++) {
      const req = fabricRequests[i];
      console.log(`\n📋 데이터 요청 ${i + 1}/${fabricRequests.length}: ${req.organizationName} → ${req.resourceOwner} (${req.purpose})`);
      
      try {
        // gRPC를 통한 AccessManagement 서비스 호출
        const response = await new Promise((resolve, reject) => {
          client.SaveAccessRequest({
            resourceOwner: req.resourceOwner,
            purpose: req.purpose,
            organizationName: req.organizationName
          }, (error, response) => {
            if (error) reject(error);
            else resolve(response);
          });
        });
        
        console.log(`✅ 요청 저장 성공`);
        
        results.push({
          organizationName: req.organizationName,
          resourceOwner: req.resourceOwner,
          purpose: req.purpose,
          success: response.success,
          requestId: response.requestId
        });
        
        // 요청 간 간격 (서버 부하 방지)
        await new Promise(resolve => setTimeout(resolve, 500));
        
      } catch (error) {
        console.error(`❌ 요청 ${i + 1} 실패: ${error.message}`);
        results.push({
          organizationName: req.organizationName,
          resourceOwner: req.resourceOwner, 
          purpose: req.purpose,
          success: false,
          error: error.message
        });
      }
    }
    
    // 결과 요약
    const successCount = results.filter(r => r.success).length;
    const failCount = results.length - successCount;
    
    console.log(`\n🎉 Fabric 샘플 데이터 생성 완료!`);
    console.log(`✅ 성공: ${successCount}개`);
    console.log(`❌ 실패: ${failCount}개`);
    console.log(`📊 총 요청: ${results.length}개`);
    
    // Purpose별 통계
    const purposeStats = {};
    results.filter(r => r.success).forEach(r => {
      purposeStats[r.purpose] = (purposeStats[r.purpose] || 0) + 1;
    });
    
    console.log('\n📈 Purpose별 통계:');
    Object.entries(purposeStats).forEach(([purpose, count]) => {
      console.log(`  ${purpose}: ${count}개`);
    });
    
    client.close();
    
  } catch (error) {
    console.error(`❌ Fabric 샘플 데이터 생성 실패: ${error.message}`);
    throw error;
  }
}

// Fabric용 Purpose 검색 함수
async function fabricSearchByPurpose(purpose) {
  try {
    console.log(`🔍 Fabric 네트워크에서 Purpose 검색: "${purpose}"`);
    
    // gRPC 클라이언트 설정
    const grpc = require('@grpc/grpc-js');
    const protoLoader = require('@grpc/proto-loader');
    
    const PROTO_PATH = path.join(__dirname, '../../grpc-go/accessapi/access_management.proto');
    const packageDefinition = protoLoader.loadSync(PROTO_PATH, {
      keepCase: true,
      longs: String,
      enums: String,
      defaults: true,
      oneofs: true
    });
    
    const accessProto = grpc.loadPackageDefinition(packageDefinition).accessapi;
    const client = new accessProto.AccessManagementService('localhost:19001', grpc.credentials.createInsecure());
    
    // Purpose 검색 요청
    const response = await new Promise((resolve, reject) => {
      client.SearchAccessRequestsByPurpose({
        purpose: purpose
      }, (error, response) => {
        if (error) reject(error);
        else resolve(response);
      });
    });
    
    console.log(`\n📊 검색 결과:`);
    console.log(`   🎯 목적: ${purpose}`);
    console.log(`   🆔 인덱스 ID: purpose`);
    
    // 인덱스 기반 TxId 개수를 표시 (더 정확함)
    const indexTxIdCount = response.txIds ? response.txIds.length : 0;
    
    console.log(`   📊 인덱싱된 데이터 개수: ${indexTxIdCount}`);
    
    // 경고 메시지 제거 - 인덱스와 체인코드 데이터 개수가 다른 것은 정상적인 상황
    
    // EVM 스타일로 TxId 목록 출력
    if (response.txIds && response.txIds.length > 0) {
      console.log(`   📋 트랜잭션 목록:`);
      response.txIds.forEach((txId, index) => {
        console.log(`      ${index + 1}. ${txId}`);
      });
    } else {
      console.log(`   ℹ️  해당 목적과 관련된 데이터가 없습니다.`);
    }
    
    // 상세 정보는 TxId별 개별 조회 필요
    console.log(`\n💡 상세 정보 조회 방법:`);
    console.log(`   각 TxId의 상세 정보를 보려면:`);
    console.log(`   node cli.js -cmd=get-access-tx-details -value="[TxId]" --network=fabric`);
    console.log(`\n📊 총 매칭된 TxId 수: ${indexTxIdCount}개`);
    
    client.close();
    
  } catch (error) {
    console.error(`❌ Fabric Purpose 검색 실패: ${error.message}`);
    throw error;
  }
}


// ===== CSV 파일 처리 함수 =====

// CSV 파일에서 데이터를 읽어서 블록체인에 저장하는 함수
async function generateDataFromCSV(network, csvFilePath) {
  try {
    console.log('📄 CSV 파일에서 데이터 생성 시작...');
    console.log(`📁 파일 경로: ${csvFilePath}\n`);
    
    // CSV 파일 읽기
    const fs = require('fs');
    const path = require('path');
    
    // 파일 존재 확인
    const fullPath = path.resolve(csvFilePath);
    if (!fs.existsSync(fullPath)) {
      throw new Error(`CSV 파일을 찾을 수 없습니다: ${fullPath}`);
    }
    
    // CSV 파일 읽기
    const csvContent = fs.readFileSync(fullPath, 'utf8');
    const lines = csvContent.trim().split('\n');
    
    if (lines.length <= 1) {
      throw new Error('CSV 파일에 데이터가 없습니다 (헤더만 있음)');
    }
    
    // 헤더 파싱
    const headers = lines[0].split(',').map(h => h.trim());
    console.log('📋 CSV 헤더:', headers);
    
    // 필수 컬럼 확인
    const requiredColumns = ['resourceOwner', 'purpose', 'organizationName'];
    const missingColumns = requiredColumns.filter(col => !headers.includes(col));
    if (missingColumns.length > 0) {
      throw new Error(`필수 컬럼이 없습니다: ${missingColumns.join(', ')}`);
    }
    
    // 데이터 파싱
    const csvData = [];
    for (let i = 1; i < lines.length; i++) {
      const values = lines[i].split(',').map(v => v.trim());
      const row = {};
      headers.forEach((header, index) => {
        row[header] = values[index] || '';
      });
      
      // 필수 필드 검증
      if (row.resourceOwner && row.purpose && row.organizationName) {
        csvData.push(row);
      } else {
        console.warn(`⚠️ 라인 ${i + 1} 건너뜀: 필수 데이터 누락`);
      }
    }
    
    console.log(`📊 총 ${csvData.length}건의 유효한 데이터 발견\n`);
    
    // 네트워크 설정
    let provider, signer;
    if (network === 'hardhat') {
      [signer] = await ethers.getSigners();
      provider = ethers.provider;
    } else {
      const networkConfig = hre.config.networks[network];
      if (!networkConfig) {
        throw new Error(`hardhat.config.js에 ${network} 네트워크 설정이 없습니다.`);
      }
      provider = new ethers.JsonRpcProvider(networkConfig.url);
      signer = new ethers.Wallet(networkConfig.accounts[0], provider);
    }
    
    // 기존 배포된 컨트랙트 사용
    const contractAddress = '0x5FbDB2315678afecb367f032d93F642f64180aa3';
    console.log(`🔗 기존 배포된 컨트랙트 사용: ${contractAddress}\n`);
    
    // 컨트랙트 인스턴스 생성
    const AccessManagement = await ethers.getContractFactory('AccessManagement', signer);
    const contract = AccessManagement.attach(contractAddress);
    
    // Purpose 인덱스 생성
    console.log('🔧 Purpose 인덱스 생성 중...');
    await createIndexUnified(network, 'purpose');
    console.log('✅ Purpose 인덱스 생성 완료\n');
    
    // Gender 인덱스 생성 (CSV에 gender 컬럼이 있는 경우)
    if (headers.includes('gender')) {
      console.log('🔧 Gender 인덱스 생성 중...');
      await createIndexUnified(network, 'gender');
      console.log('✅ Gender 인덱스 생성 완료\n');
    }
    
    // 데이터 처리
    const results = [];
    let totalCount = 0;
    const startTime = Date.now();
    
    console.log('📝 CSV 데이터 처리 시작...\n');
    
    for (const row of csvData) {
      try {
        // 블록체인에 데이터 저장
        const tx = await contract.saveRequest(
          row.resourceOwner,
          row.purpose,
          row.organizationName
        );
        await tx.wait();
        
        // 인덱스에 저장
        console.log(`📝 Purpose 인덱스에 저장 중: ${row.purpose} → ${tx.hash}`);
        await addToPurposeIndexEVM(row.purpose, tx.hash, network, row.organizationName);
        
        // Gender 인덱싱 (gender 컬럼이 있고 값이 있는 경우)
        if (row.gender && row.gender.trim() !== '') {
          console.log(`📝 Gender 인덱스에 저장 중: ${row.gender} → ${tx.hash}`);
          await addToCustomIndex('gender', row.gender, tx.hash, network, row.organizationName);
        }
        
        results.push({
          purpose: row.purpose,
          organizationName: row.organizationName,
          txHash: tx.hash,
          success: true
        });
        
        totalCount++;
        
        // 진행 상황 표시 (10개마다)
        if (totalCount % 10 === 0) {
          console.log(`   📊 진행: ${totalCount}/${csvData.length} (${((totalCount/csvData.length)*100).toFixed(1)}%)`);
        }
        
        // nonce 충돌 방지를 위한 지연
        await new Promise(resolve => setTimeout(resolve, 200));
        
      } catch (error) {
        console.warn(`⚠️ 데이터 ${totalCount + 1} 처리 실패: ${error.message}`);
        results.push({
          purpose: row.purpose,
          organizationName: row.organizationName,
          txHash: null,
          success: false,
          error: error.message
        });
        totalCount++;
      }
    }
    
    const endTime = Date.now();
    const duration = (endTime - startTime) / 1000;
    const successCount = results.filter(r => r.success).length;
    
    console.log('\n🎉 CSV 데이터 처리 완료!');
    console.log(`📊 총 처리: ${successCount}/${csvData.length}건`);
    console.log(`⏱️  소요 시간: ${duration.toFixed(2)}초`);
    console.log(`🚀 평균 속도: ${(successCount / duration).toFixed(2)} 건/초\n`);
    
    // 목적별 통계
    const purposeStats = {};
    results.filter(r => r.success).forEach(r => {
      purposeStats[r.purpose] = (purposeStats[r.purpose] || 0) + 1;
    });
    
    console.log('📈 목적별 처리 통계:');
    Object.entries(purposeStats).forEach(([purpose, count]) => {
      console.log(`  ${purpose}: ${count}건`);
    });
    
    return {
      success: true,
      contractAddress,
      totalProcessed: totalCount,
      successCount,
      results,
      duration
    };
    
  } catch (error) {
    console.error(`❌ CSV 데이터 처리 실패: ${error.message}`);
    throw error;
  }
}

// ===== 성능 비교 테스트 함수들 =====

// 2000건 데이터 생성 함수
async function generate2000TestData(network) {
  try {
    console.log('🚀 50건 테스트 데이터 생성 시작...');
    console.log(`📊 데이터 구성: 수면 20건, 심박수 15건, 혈당 15건\n`);
    
    // 네트워크 설정
    let provider, signer;
    if (network === 'hardhat') {
      [signer] = await ethers.getSigners();
      provider = ethers.provider;
    } else {
      const networkConfig = hre.config.networks[network];
      if (!networkConfig) {
        throw new Error(`hardhat.config.js에 ${network} 네트워크 설정이 없습니다.`);
      }
      provider = new ethers.JsonRpcProvider(networkConfig.url);
      signer = new ethers.Wallet(networkConfig.accounts[0], provider);
    }
    
    // 기존 배포된 컨트랙트 사용
    const contractAddress = '0x5FbDB2315678afecb367f032d93F642f64180aa3';
    console.log(`🔗 기존 배포된 컨트랙트 사용: ${contractAddress}\n`);
    
    // 컨트랙트 인스턴스 생성
    const AccessManagement = await ethers.getContractFactory('AccessManagement', signer);
    const contract = AccessManagement.attach(contractAddress);
    
    // Purpose 인덱스 생성
    console.log('🔧 Purpose 인덱스 생성 중...');
    await createIndexUnified(network, 'purpose');
    console.log('✅ Purpose 인덱스 생성 완료\n');
    
    // 테스트 데이터 설정 (50건 테스트용)
    const purposes = [
      { name: '수면', count: 20 },
      { name: '심박수', count: 15 },
      { name: '혈당', count: 15 }
    ];
    
    const organizations = ['BIMATRIX', 'Samsung', 'LG', 'KT'];
    const users = [
      '0x70997970C51812dc3A010C7d01b50e0d17dc79C8',
      '0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC',
      '0x90F79bf6EB2c4f870365E785982E1f101E93b906',
      '0x15d34AAf54267DB7D7c367839AAf71A00a2C6A65'
    ];
    
    const results = [];
    let totalCount = 0;
    const startTime = Date.now();
    
    // 목적별 데이터 생성
    for (const purposeData of purposes) {
      console.log(`📝 ${purposeData.name} 데이터 ${purposeData.count}건 생성 중...`);
      
      for (let i = 0; i < purposeData.count; i++) {
        const orgIndex = totalCount % organizations.length;
        const userIndex = totalCount % users.length;
        
        const organization = organizations[orgIndex];
        const user = users[userIndex];
        
        try {
          // 컨트랙트 호출
          const tx = await contract.saveRequest(
            user,
            purposeData.name,
            organization
          );
          
          const receipt = await tx.wait();
          
          // Purpose 인덱싱
          await addToPurposeIndexEVM(purposeData.name, tx.hash, network, organization);
          
          results.push({
            purpose: purposeData.name,
            organization: organization,
            user: user,
            txHash: tx.hash,
            blockNumber: receipt.blockNumber,
            success: true
          });
          
          totalCount++;
          
          // 진행 상황 표시 (10개마다)
          if (totalCount % 10 === 0) {
            console.log(`   📊 진행: ${totalCount}/50 (${((totalCount/50)*100).toFixed(1)}%)`);
          }
          
          // 서버 부하 방지를 위한 짧은 지연
          if (totalCount % 25 === 0) {
            await new Promise(resolve => setTimeout(resolve, 500));
          }
          
        } catch (error) {
          console.warn(`⚠️ 데이터 ${totalCount + 1} 생성 실패: ${error.message}`);
          results.push({
            purpose: purposeData.name,
            organization: organization,
            user: user,
            error: error.message,
            success: false
          });
          totalCount++;
        }
      }
      
      console.log(`✅ ${purposeData.name} 데이터 생성 완료\n`);
    }
    
    const endTime = Date.now();
    const duration = (endTime - startTime) / 1000;
    const successCount = results.filter(r => r.success).length;
    
    console.log('🎉 50건 테스트 데이터 생성 완료!');
    console.log(`📊 총 생성: ${successCount}/50건`);
    console.log(`⏱️  소요 시간: ${duration.toFixed(2)}초`);
    console.log(`🚀 평균 속도: ${(successCount / duration).toFixed(2)} 건/초\n`);
    
    // 목적별 통계
    console.log('📈 목적별 생성 통계:');
    for (const purposeData of purposes) {
      const count = results.filter(r => r.success && r.purpose === purposeData.name).length;
      console.log(`  ${purposeData.name}: ${count}건`);
    }
    
    return {
      success: true,
      contractAddress,
      totalGenerated: successCount,
      results,
      duration
    };
    
  } catch (error) {
    console.error(`❌ 테스트 데이터 생성 실패: ${error.message}`);
    throw error;
  }
}

// 인덱스 검색 성능 측정 (TxId 조회 + 상세 정보 조회 포함)
async function measureIndexSearchPerformance(network) {
  try {
    console.log('🔍 인덱스 검색 성능 측정 시작 (TxId + 상세 정보)...\n');
    
    const purposes = ['수면', '심박수', '혈당'];
    const results = {};
    
    // 네트워크 설정
    let provider;
    if (network === 'hardhat') {
      provider = ethers.provider;
    } else {
      const networkConfig = hre.config.networks[network];
      provider = new ethers.JsonRpcProvider(networkConfig.url);
    }
    
    for (const purpose of purposes) {
      console.log(`📊 "${purpose}" 인덱스 검색 + 상세 조회 중...`);
      
      const startTime = process.hrtime.bigint();
      
      // 1단계: 인덱스에서 TxId 조회
      const searchResult = await searchByPurposeEVM(network, purpose);
      
      // 2단계: 상위 10개 TxId에 대해 상세 정보 조회 (샘플링)
      const sampleSize = Math.min(10, searchResult.data.length);
      const sampleTxIds = searchResult.data.slice(0, sampleSize);
      
      let detailsCount = 0;
      for (const txId of sampleTxIds) {
        try {
          const txDetails = await provider.getTransaction(txId);
          if (txDetails) detailsCount++;
        } catch (error) {
          console.warn(`   ⚠️ TxId ${txId} 조회 실패: ${error.message}`);
        }
      }
      
      const endTime = process.hrtime.bigint();
      const duration = Number(endTime - startTime) / 1000000; // 나노초를 밀리초로 변환
      
      results[purpose] = {
        method: 'index_with_details',
        duration: duration,
        count: searchResult.count,
        sampleSize: sampleSize,
        detailsRetrieved: detailsCount,
        success: searchResult.success
      };
      
      console.log(`   ⚡ 총 시간: ${duration.toFixed(2)}ms`);
      console.log(`   📋 TxId 결과: ${searchResult.count}건`);
      console.log(`   🔍 상세 조회 샘플: ${detailsCount}/${sampleSize}건\n`);
    }
    
    return results;
    
  } catch (error) {
    console.error(`❌ 인덱스 검색 성능 측정 실패: ${error.message}`);
    throw error;
  }
}

// 블록체인 직접 조회 성능 측정
async function measureBlockchainDirectQueryPerformance(network, contractAddress) {
  try {
    console.log('⛓️ 블록체인 직접 조회 성능 측정 시작...\n');
    
    // 네트워크 설정
    let provider;
    if (network === 'hardhat') {
      provider = ethers.provider;
    } else {
      const networkConfig = hre.config.networks[network];
      provider = new ethers.JsonRpcProvider(networkConfig.url);
    }
    
    // 컨트랙트 연결
    const AccessManagement = await ethers.getContractFactory('AccessManagement');
    const contract = AccessManagement.attach(contractAddress);
    
    const purposes = ['수면', '심박수', '혈당'];
    const results = {};
    
    for (const purpose of purposes) {
      console.log(`🔍 "${purpose}" 블록체인 직접 조회 중...`);
      
      const startTime = process.hrtime.bigint();
      
      // 모든 AccessRequestsSaved 이벤트 조회
      const filter = contract.filters.AccessRequestsSaved();
      const events = await contract.queryFilter(filter, 0, 'latest');
      
      // 목적별 필터링 (디버깅 정보 추가)
      console.log(`   🔍 전체 이벤트 수: ${events.length}건`);
      if (events.length > 0) {
        console.log(`   📋 첫 번째 이벤트 args:`, events[0].args);
      }
      
      const filteredEvents = events.filter(event => {
        // purpose는 이제 indexed 파라미터 (args[2])
        return event.args && (event.args.purpose === purpose || event.args[2] === purpose);
      });
      
      console.log(`   🎯 "${purpose}" 필터링 결과: ${filteredEvents.length}건`);
      
      const endTime = process.hrtime.bigint();
      const duration = Number(endTime - startTime) / 1000000; // 나노초를 밀리초로 변환
      
      results[purpose] = {
        method: 'blockchain_direct',
        duration: duration,
        count: filteredEvents.length,
        totalEventsScanned: events.length,
        success: true
      };
      
      console.log(`   ⚡ 조회 시간: ${duration.toFixed(2)}ms`);
      console.log(`   🔍 전체 이벤트 스캔: ${events.length}건`);
      console.log(`   📋 필터링 결과: ${filteredEvents.length}건\n`);
    }
    
    return results;
    
  } catch (error) {
    console.error(`❌ 블록체인 직접 조회 성능 측정 실패: ${error.message}`);
    throw error;
  }
}

// 성능 비교 결과 출력
function displayPerformanceComparison(indexResults, blockchainResults) {
  console.log('📊 성능 비교 결과');
  console.log('=====================================\n');
  
  const purposes = ['수면', '심박수', '혈당'];
  let totalIndexTime = 0;
  let totalBlockchainTime = 0;
  
  for (const purpose of purposes) {
    const indexResult = indexResults[purpose];
    const blockchainResult = blockchainResults[purpose];
    
    console.log(`🎯 목적: ${purpose}`);
    console.log('─────────────────────────────────────');
    console.log(`📊 인덱스 검색 + 상세 조회:`);
    console.log(`   ⚡ 시간: ${indexResult.duration.toFixed(2)}ms`);
    console.log(`   📋 TxId 결과: ${indexResult.count}건`);
    console.log(`   🔍 상세 조회 샘플: ${indexResult.detailsRetrieved}/${indexResult.sampleSize}건`);
    console.log(`⛓️  블록체인 직접 조회 (전체 스캔):`);
    console.log(`   ⚡ 시간: ${blockchainResult.duration.toFixed(2)}ms`);
    console.log(`   🔍 스캔: ${blockchainResult.totalEventsScanned}건`);
    console.log(`   📋 결과: ${blockchainResult.count}건`);
    
    const speedup = blockchainResult.duration / indexResult.duration;
    console.log(`🚀 속도 개선: ${speedup.toFixed(1)}배 빠름\n`);
    
    totalIndexTime += indexResult.duration;
    totalBlockchainTime += blockchainResult.duration;
  }
  
  console.log('📈 전체 성능 요약');
  console.log('=====================================');
  console.log(`📊 인덱스 검색 + 상세 조회 총 시간: ${totalIndexTime.toFixed(2)}ms`);
  console.log(`⛓️  블록체인 직접 조회 (전체 스캔) 총 시간: ${totalBlockchainTime.toFixed(2)}ms`);
  console.log(`🚀 전체 속도 개선: ${(totalBlockchainTime / totalIndexTime).toFixed(1)}배 빠름`);
  console.log(`💡 인덱스 효율성: ${(((totalBlockchainTime - totalIndexTime) / totalBlockchainTime) * 100).toFixed(1)}% 시간 단축`);
  console.log(`\n🔍 비교 방식:`);
  console.log(`   📊 인덱스: TxId 조회 + 10개 샘플 상세 조회`);
  console.log(`   ⛓️  직접: 전체 50개 이벤트 스캔 + 메모리 필터링`);
}

// 메인 성능 비교 테스트 함수
async function runPerformanceComparisonTest(network) {
  try {
    console.log('🎯 성능 비교 테스트 시작');
    console.log('=====================================');
    console.log(`🌐 네트워크: ${network}`);
    console.log(`📊 테스트 규모: 50건 데이터 (소규모 테스트)`);
    console.log(`🎯 목적: 수면(20건), 심박수(15건), 혈당(15건)\n`);
    
    const overallStartTime = Date.now();
    
    // 1단계: 50건 데이터 생성
    console.log('📝 1단계: 테스트 데이터 생성');
    console.log('─────────────────────────────────────');
    const dataGenResult = await generate2000TestData(network);
    
    if (!dataGenResult.success) {
      throw new Error('테스트 데이터 생성 실패');
    }
    
    console.log(`✅ 데이터 생성 완료: ${dataGenResult.totalGenerated}건\n`);
    
    // 2단계: 인덱스 검색 성능 측정
    console.log('🔍 2단계: 인덱스 검색 성능 측정');
    console.log('─────────────────────────────────────');
    const indexResults = await measureIndexSearchPerformance(network);
    
    // 3단계: 블록체인 직접 조회 성능 측정
    console.log('⛓️ 3단계: 블록체인 직접 조회 성능 측정');
    console.log('─────────────────────────────────────');
    const blockchainResults = await measureBlockchainDirectQueryPerformance(network, dataGenResult.contractAddress);
    
    // 4단계: 성능 비교 결과 출력
    console.log('📊 4단계: 성능 비교 결과');
    console.log('─────────────────────────────────────');
    displayPerformanceComparison(indexResults, blockchainResults);
    
    const overallEndTime = Date.now();
    const overallDuration = (overallEndTime - overallStartTime) / 1000;
    
    console.log('\n🎉 성능 비교 테스트 완료!');
    console.log(`⏱️  전체 소요 시간: ${overallDuration.toFixed(2)}초`);
    console.log(`📍 컨트랙트 주소: ${dataGenResult.contractAddress}`);
    
  } catch (error) {
    console.error(`❌ 성능 비교 테스트 실패: ${error.message}`);
    throw error;
  }
}

// 특정 목적에 대한 성능 비교 함수
async function comparePerformanceByPurpose(network, purpose) {
  console.log(`\n🚀 "${purpose}" 데이터 성능 비교 시작...\n`);
  
  try {
    // 1. 인덱스 기반 조회 성능 측정
    console.log('📊 1단계: 인덱스 기반 조회 성능 측정 중...');
    const indexStartTime = process.hrtime.bigint();
    
    // 인덱스에서 TxId 목록 조회
    const searchResult = await searchByPurposeEVM(network, purpose);
    const txHashes = searchResult.data || [];
    
    console.log(`📝 인덱스에서 ${txHashes.length}개 TxId 조회 완료`);
    
    // 각 TxId에 대해 상세 정보 조회 (인덱스에서 조회한 모든 TxId)
    // 중복 제거 후 처리
    const uniqueTxHashes = [...new Set(txHashes)];
    const sampleSize = uniqueTxHashes.length; // 인덱스에서 조회한 모든 고유 TxId
    const sampleTxHashes = uniqueTxHashes;
    
    console.log(`📋 ${sampleSize}개 트랜잭션 상세 정보 조회 중... (인덱스 조회 결과 전체)`);
    const txDetails = [];
    for (const txHash of sampleTxHashes) {
      try {
        const details = await getEvmTxDetails(network, txHash); // 기존 함수 시그니처 사용
        if (details) txDetails.push(details);
      } catch (error) {
        console.warn(`⚠️  TxId ${txHash} 상세 조회 실패: ${error.message}`);
      }
    }
    
    const indexEndTime = process.hrtime.bigint();
    const indexDuration = Number(indexEndTime - indexStartTime) / 1_000_000; // 밀리초로 변환
    
    console.log(`✅ 인덱스 기반 조회 완료: ${uniqueTxHashes.length}개 고유 TxId (총 ${txHashes.length}개) + ${txDetails.length}개 상세 조회`);
    
    // 2. 블록체인 직접 조회 성능 측정
    console.log('\n🔍 2단계: 블록체인 직접 조회 성능 측정 중...');
    const blockchainStartTime = process.hrtime.bigint();
    
    // 컨트랙트 주소 가져오기 (최근 배포된 컨트랙트 사용)
    const contractAddress = await getLatestContractAddress(network);
    if (!contractAddress) {
      throw new Error('배포된 컨트랙트를 찾을 수 없습니다. 먼저 데이터를 생성해주세요.');
    }
    
    const provider = getProvider(network);
    
    // AccessManagement 컨트랙트 ABI 로드
    const AccessManagementArtifact = require('../artifacts/contracts/AccessManagement.sol/AccessManagement.json');
    const contract = new ethers.Contract(contractAddress, AccessManagementArtifact.abi, provider);
    
    // 모든 이벤트 조회 후 필터링
    console.log(`📋 블록체인에서 "${purpose}" 이벤트 직접 조회 중...`);
    const allEvents = await contract.queryFilter('AccessRequestsSaved');
    
    // indexed string은 해시값으로 저장되므로 트랜잭션 데이터에서 원본 값을 디코딩해야 함
    const filteredEvents = [];
    for (const event of allEvents) {
      try {
        // 트랜잭션 데이터에서 원본 함수 호출 파라미터 디코딩
        const tx = await provider.getTransaction(event.transactionHash);
        if (tx && tx.data) {
          const contractInterface = new ethers.Interface(AccessManagementArtifact.abi);
          const parsed = contractInterface.parseTransaction({ data: tx.data });
          
          if (parsed && parsed.args && parsed.args._purpose === purpose) {
            filteredEvents.push(event);
          }
        }
      } catch (error) {
        console.warn(`⚠️  이벤트 ${event.transactionHash} 디코딩 실패: ${error.message}`);
      }
    }
    
    const blockchainEndTime = process.hrtime.bigint();
    const blockchainDuration = Number(blockchainEndTime - blockchainStartTime) / 1_000_000; // 밀리초로 변환
    
    console.log(`✅ 블록체인 직접 조회 완료: ${filteredEvents.length}개 이벤트 발견`);
    
    // 3. 결과 비교 및 출력
    console.log('\n📈 3단계: 성능 비교 결과...');
    
    const indexResults = {
      method: '인덱스 기반 조회',
      totalCount: uniqueTxHashes.length, // 고유 TxId 개수
      sampleDetailsCount: txDetails.length,
      duration: indexDuration,
      avgPerRecord: uniqueTxHashes.length > 0 ? indexDuration / uniqueTxHashes.length : 0
    };
    
    const blockchainResults = {
      method: '블록체인 직접 조회',
      totalCount: filteredEvents.length,
      duration: blockchainDuration,
      avgPerRecord: filteredEvents.length > 0 ? blockchainDuration / filteredEvents.length : 0
    };
    
    displayPurposePerformanceComparison(purpose, indexResults, blockchainResults);
    
    return {
      purpose,
      indexResults,
      blockchainResults,
      speedupFactor: blockchainDuration / indexDuration
    };
    
  } catch (error) {
    console.error(`❌ "${purpose}" 성능 비교 실패: ${error.message}`);
    throw error;
  }
}

// 목적별 성능 비교 결과 출력
function displayPurposePerformanceComparison(purpose, indexResults, blockchainResults) {
  const speedupFactor = blockchainResults.duration / indexResults.duration;
  const speedupPercentage = ((blockchainResults.duration - indexResults.duration) / blockchainResults.duration * 100).toFixed(1);
  
  console.log('\n' + '='.repeat(80));
  console.log(`🎯 "${purpose}" 데이터 성능 비교 결과`);
  console.log('='.repeat(80));
  
  console.log('\n📊 인덱스 기반 조회:');
  console.log(`   📋 조회된 TxId 수: ${indexResults.totalCount}개`);
  console.log(`   🔍 상세 조회 샘플: ${indexResults.sampleDetailsCount}개`);
  console.log(`   ⏱️  총 소요 시간: ${indexResults.duration.toFixed(2)}ms`);
  console.log(`   📈 평균 처리 시간: ${indexResults.avgPerRecord.toFixed(2)}ms/건`);
  
  console.log('\n🔍 블록체인 직접 조회:');
  console.log(`   📋 조회된 이벤트 수: ${blockchainResults.totalCount}개`);
  console.log(`   ⏱️  총 소요 시간: ${blockchainResults.duration.toFixed(2)}ms`);
  console.log(`   📈 평균 처리 시간: ${blockchainResults.avgPerRecord.toFixed(2)}ms/건`);
  
  console.log('\n🚀 성능 비교:');
  if (speedupFactor > 1) {
    console.log(`   ✅ 인덱스 방식이 ${speedupFactor.toFixed(2)}배 빠름`);
    console.log(`   📈 성능 향상: ${speedupPercentage}%`);
  } else {
    console.log(`   ⚠️  블록체인 직접 조회가 ${(1/speedupFactor).toFixed(2)}배 빠름`);
    console.log(`   📉 성능 저하: ${Math.abs(speedupPercentage)}%`);
  }
  
  console.log('\n💡 분석:');
  if (indexResults.totalCount !== blockchainResults.totalCount) {
    console.log(`   ⚠️  데이터 수 불일치: 인덱스 ${indexResults.totalCount}개 vs 블록체인 ${blockchainResults.totalCount}개`);
  } else {
    console.log(`   ✅ 데이터 일치성: ${indexResults.totalCount}개 동일`);
  }
  
  if (speedupFactor > 1) {
    console.log(`   🎯 인덱스의 O(log n) 검색이 O(n) 전체 스캔보다 효율적`);
    console.log(`   📊 대용량 데이터에서 성능 차이가 더욱 극명해질 것으로 예상`);
  }
  
  console.log('='.repeat(80));
}

// Provider 생성 함수
function getProvider(network) {
  if (network === 'hardhat') {
    return ethers.provider;
  } else if (network === 'hardhat-local' || network === 'localhost') {
    return new ethers.JsonRpcProvider('http://127.0.0.1:8545');
  } else {
    const networkConfig = hre.config.networks[network];
    if (!networkConfig) {
      throw new Error(`hardhat.config.js에 ${network} 네트워크 설정이 없습니다.`);
    }
    return new ethers.JsonRpcProvider(networkConfig.url);
  }
}

// 최근 배포된 컨트랙트 주소 가져오기 (임시 구현)
async function getLatestContractAddress(network) {
  // 실제로는 배포 로그나 설정 파일에서 가져와야 하지만,
  // 여기서는 하드코딩된 주소를 사용하거나 환경변수에서 가져옴
  // 또는 최근 트랜잭션에서 컨트랙트 생성을 찾을 수 있음
  
  // 임시로 하드코딩 (실제 환경에서는 동적으로 가져와야 함)
  if (network === 'hardhat-local' || network === 'hardhat' || network === 'localhost') {
    // 가장 최근에 배포된 컨트랙트 주소를 반환
    // 실제로는 배포 로그에서 가져와야 함
    return '0x5FbDB2315678afecb367f032d93F642f64180aa3'; // Hardhat 기본 첫 번째 컨트랙트 주소
  }
  
  return null;
}

// 인덱스 기반 완전 조회 함수 (조회 + 상세 데이터)
async function searchAndFetchDetailsByPurpose(network, purpose) {
  console.log(`\n🔍 "${purpose}" 데이터 인덱스 기반 완전 조회 시작...\n`);
  
  try {
    const startTime = process.hrtime.bigint();
    
    // 1. 인덱스에서 TxId 목록 조회
    console.log('📊 1단계: 인덱스에서 TxId 조회 중...');
    const searchResult = await searchByPurposeEVM(network, purpose);
    const txHashes = searchResult.data || [];
    
    if (txHashes.length === 0) {
      console.log('❌ 인덱스에서 해당 목적의 데이터를 찾을 수 없습니다.');
      return {
        success: false,
        purpose,
        totalCount: 0,
        details: [],
        duration: 0
      };
    }
    
    // 중복 제거
    const uniqueTxHashes = [...new Set(txHashes)];
    console.log(`📝 인덱스에서 ${uniqueTxHashes.length}개 고유 TxId 조회 완료 (총 ${txHashes.length}개)`);
    
    // 2. 모든 TxId에 대해 상세 정보 조회
    console.log(`📋 2단계: ${uniqueTxHashes.length}개 트랜잭션 상세 정보 조회 중...`);
    const txDetails = [];
    let successCount = 0;
    let failCount = 0;
    
    for (let i = 0; i < uniqueTxHashes.length; i++) {
      const txHash = uniqueTxHashes[i];
      try {
        console.log(`   진행률: ${i + 1}/${uniqueTxHashes.length} (${((i + 1) / uniqueTxHashes.length * 100).toFixed(1)}%)`);
        const details = await getEvmTxDetails(network, txHash);
        if (details) {
          txDetails.push({
            txHash,
            details,
            index: i + 1
          });
          successCount++;
        } else {
          failCount++;
        }
      } catch (error) {
        console.warn(`⚠️  TxId ${txHash} 상세 조회 실패: ${error.message}`);
        failCount++;
      }
      
      // 너무 빠른 요청 방지 (선택적)
      if (i < uniqueTxHashes.length - 1) {
        await new Promise(resolve => setTimeout(resolve, 50));
      }
    }
    
    const endTime = process.hrtime.bigint();
    const duration = Number(endTime - startTime) / 1_000_000; // 밀리초로 변환
    
    // 3. 결과 요약
    console.log('\n' + '='.repeat(80));
    console.log(`🎯 "${purpose}" 인덱스 기반 완전 조회 결과`);
    console.log('='.repeat(80));
    console.log(`📊 인덱스 조회 결과: ${uniqueTxHashes.length}개 고유 TxId`);
    console.log(`✅ 상세 조회 성공: ${successCount}개`);
    console.log(`❌ 상세 조회 실패: ${failCount}개`);
    console.log(`⏱️  총 소요 시간: ${duration.toFixed(2)}ms`);
    console.log(`📈 평균 처리 시간: ${(duration / uniqueTxHashes.length).toFixed(2)}ms/건`);
    console.log('='.repeat(80));
    
    // 상세 데이터 샘플 출력 (처음 3개)
    if (txDetails.length > 0) {
      console.log('\n📋 상세 데이터 샘플 (처음 3개):');
      txDetails.slice(0, 3).forEach((item, index) => {
        console.log(`\n${index + 1}. TxHash: ${item.txHash}`);
        if (item.details && item.details.functionCall) {
          console.log(`   목적: ${item.details.functionCall.args._purpose}`);
          console.log(`   기관: ${item.details.functionCall.args._organizationName}`);
          console.log(`   리소스 소유자: ${item.details.functionCall.args._resourceOwner}`);
        }
      });
      
      if (txDetails.length > 3) {
        console.log(`\n... 그 외 ${txDetails.length - 3}개 더`);
      }
    }
    
    return {
      success: true,
      purpose,
      totalCount: uniqueTxHashes.length,
      successCount,
      failCount,
      details: txDetails,
      duration,
      avgPerRecord: duration / uniqueTxHashes.length
    };
    
  } catch (error) {
    console.error(`❌ "${purpose}" 인덱스 기반 완전 조회 실패: ${error.message}`);
    return {
      success: false,
      purpose,
      error: error.message,
      totalCount: 0,
      details: [],
      duration: 0
    };
  }
}

module.exports = {
  searchIndexAll,
  searchFabricIndexAll,
  getEvmTxDetails,
  createPurposeIndexEVM,
  searchByPurposeEVM,
  addToCustomIndex,
  fabricRequestData,
  runPerformanceComparisonTest,
  comparePerformanceByPurpose,
  searchAndFetchDetailsByPurpose,
};
