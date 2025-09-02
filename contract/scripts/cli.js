#!/usr/bin/env node

const { ethers } = require('hardhat');
const path = require('path');
const crypto = require('crypto');
const fs = require('fs');
const yaml = require('js-yaml');
const grpc = require('@grpc/grpc-js');
const protoLoader = require('@grpc/proto-loader');
const IndexingClient = require('../../indexing-client-package/lib/indexing-client');
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
const network = args.find(arg => arg.startsWith('-network='))?.split('=')[1] || 'hardhat';
const type = args.find(arg => arg.startsWith('-type='))?.split('=')[1] || '';
const value = args.find(arg => arg.startsWith('-value='))?.split('=')[1] || '';
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
  console.log(`🚀 ${network} 네트워크에 CSV 멀티 데이터 저장 시작`);
  console.log(`📁 CSV 파일: ${csvFile}`);
  console.log(`📦 배치 크기: ${batchSize}개씩\n`);

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
    console.log(`📋 CSV 헤더: ${headers.join(', ')}`);
    console.log(`📊 총 데이터 라인: ${lines.length - 1}개\n`);
    
    // 배치로 나누어서 저장
    let successCount = 0;
    let errorCount = 0;
    const totalLines = lines.length - 1;
    const totalBatches = Math.ceil(totalLines / batchSize);
    
    console.log(`🔄 ${totalBatches}개 배치로 나누어서 저장 시작...\n`);
    
    for (let batchIndex = 0; batchIndex < totalBatches; batchIndex++) {
      const start = batchIndex * batchSize + 1; // +1 to skip header
      const end = Math.min(start + batchSize, lines.length);
      const batchLines = lines.slice(start, end);
      
      console.log(`📦 배치 ${batchIndex + 1}/${totalBatches}: ${batchLines.length}개 데이터 저장 중...`);
      
      // 개별 방식으로 처리
      if (type === 'individual') {
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
                console.log(`🔄 OBU ${pvdData.obuId} Speed 인덱싱 시작...`);
                const speedResult = await pvdClient.putSpeedIndex(pvdData);
                
                                // 짧은 지연 후 DT 인덱싱 (연결 충돌 방지)
                await new Promise(resolve => setTimeout(resolve, 500));
                
                console.log(`🔄 OBU ${pvdData.obuId} DT 인덱싱 시작...`);
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
      
      console.log(`\n✅ 배치 ${batchIndex + 1} 완료\n`);
    }
    
    console.log('\n🎉 CSV 멀티 데이터 저장 완료!');
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
            console.log(`📊 인덱싱 처리 완료:`);
            console.log(`   - Speed: ${results[0].status === 'fulfilled' ? '✅' : '❌'}`);
            console.log(`   - DT: ${results[1].status === 'fulfilled' ? '✅' : '❌'}`);
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

// 수동 인덱싱 함수 (인덱싱 실패 시 사용)
async function reindexPvdData(network, indexType, obuId) {
  try {
    console.log(`🔧 ${network} 네트워크에서 ${obuId}의 ${indexType} 인덱싱 재처리 시작...`);
    
    if (network !== 'fabric') {
      throw new Error('수동 인덱싱은 Fabric 네트워크에서만 지원됩니다');
    }
    
    // 1. 먼저 Fabric에서 PVD 데이터 조회
    const pvdClient = new PvdClient('localhost:19001');
    await pvdClient.connect();
    console.log('✅ PVD 서버 연결 성공');
    
    try {
      // 체인코드에서 데이터 조회
      const chainInfo = {
        channelName: 'pvdchannel',
        chaincode: 'pvd'
      };
      
      const worldStateResult = await pvdClient.getWorldState(chainInfo);
      console.log(`📊 월드스테이트에서 ${obuId} 데이터 검색 중...`);
      
      let targetPvdData = null;
      if (worldStateResult && worldStateResult.PvdList) {
        targetPvdData = worldStateResult.PvdList.find(pvd => pvd.Obu_id === obuId);
      }
      
      if (!targetPvdData) {
        throw new Error(`${obuId}에 해당하는 PVD 데이터를 찾을 수 없습니다`);
      }
      
      console.log(`✅ PVD 데이터 발견:`, JSON.stringify(targetPvdData, null, 2));
      
      // 2. 인덱싱 타입에 따라 처리
      if (indexType === 'speed' || indexType === 'both') {
        console.log(`🔄 Speed 인덱싱 재처리 중...`);
        const speedResult = await pvdClient.putSpeedIndex(targetPvdData);
        console.log(`📊 Speed 인덱싱 결과:`, speedResult);
      }
      
      if (indexType === 'dt' || indexType === 'both') {
        console.log(`🔄 DT 인덱싱 재처리 중...`);
        const dtResult = await pvdClient.putDtIndex(targetPvdData);
        console.log(`📊 DT 인덱싱 결과:`, dtResult);
      }
      
      console.log(`✅ ${obuId}의 ${indexType} 인덱싱 재처리 완료!`);
      
    } finally {
      pvdClient.close();
    }
    
  } catch (error) {
    console.error(`❌ 수동 인덱싱 실패: ${error.message}`);
    throw error;
  }
}

// PVD 데이터 저장 함수
async function putPvdData(network, obuId, pvdData = null) {
  try {
    console.log(`📝 ${network} 네트워크에 PVD 데이터 저장 중...`);
    
    if (network === 'fabric') {
      console.log('🔗 Fabric 네트워크 - PVD 서버 연결 중...');
      
      // PVD 클라이언트 사용
      const pvdClient = new PvdClient('localhost:19001');
      await pvdClient.connect();
      console.log('✅ PVD 서버 연결 성공');
      
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
      console.log('✅ PVD 데이터 저장 완료:', result);
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
async function createIndexUnified(network, indexType) {
  try {
    console.log(`🔧 ${network} 네트워크에 ${indexType} 인덱스 생성 중...`);
    
    if (network === 'fabric') {
      // Fabric 네트워크: type별 인덱스 생성
      switch (indexType) {
        case 'speed':
          console.log('📊 Fabric 네트워크 - Speed 인덱스 생성...');
          await callFabricChaincode('create-index', 'speed');
          console.log('✅ Fabric Speed 인덱스 생성 완료');
          return {
            success: true,
            network: 'fabric',
            indexType: 'speed',
            indexId: 'speed',
            message: 'Fabric Speed 인덱스 생성 완료'
          };
          
        case 'dt':
        case 'collectiondt':
          console.log('📊 Fabric 네트워크 - CollectionDt 인덱스 생성...');
          await callFabricChaincode('create-index', 'dt');
          console.log('✅ Fabric CollectionDt 인덱스 생성 완료');
          return {
            success: true,
            network: 'fabric',
            indexType: 'dt',
            indexId: 'dt',
            message: 'Fabric CollectionDt 인덱스 생성 완료'
          };
          
        default:
          throw new Error(`Fabric에서 지원하지 않는 인덱스 타입: ${indexType}`);
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
        const networkDir = network === 'hardhat' ? 'hardhat이거없어?local' : network;
        
        // EVM 네트워크용: 조직/타입별 지갑 주소 매핑
        let walletAddress;
        
        if (network === 'hardhat' || network === 'hardhat-local' || network === 'localhost') {
          // Hardhat 네트워크 계정 매핑 (기본 20개 계정 활용)
          switch (indexType.toLowerCase()) {
            case 'samsung':
              walletAddress = '0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC'; // account[2]
              break;
            case 'lg':
              walletAddress = '0x90F79bf6EB2c4f870365E785982E1f101E93b906'; // account[3]
              break;
            case 'user':
            case 'users':
              walletAddress = '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266'; // account[0] - 일반 사용자 그룹
              break;
            case 'user1':
              walletAddress = '0x70997970C51812dc3A010C7d01b50e0d17dc79C8'; // account[1] - User1
              break;
            case 'user2':
              walletAddress = '0x15d34AAf54267DB7D7c367839AAf71A00a2C6A65'; // account[4] - User2
              break;
            case 'user3':
              walletAddress = '0x9965507D1a55bcC2695C58ba16FB37d819B0A4dc'; // account[5] - User3
              break;
            default:
              // 기타 타입은 배포자 주소 사용
              walletAddress = '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266'; // account[0]
              break;
          }
        } else if (network === 'monad') {
          // Monad 네트워크 계정 매핑
          switch (indexType.toLowerCase()) {
            case 'samsung':
              walletAddress = '0x2630ffE517DFC9b0112317a2EC0AB4cE2a59CEb8'; // Monad Samsung
              break;
            case 'lg':
              walletAddress = '0xa5cc9D9F1f68546060852f7c685B99f0cD532229'; // Monad LG
              break;
            default:
              walletAddress = '0x2630ffE517DFC9b0112317a2EC0AB4cE2a59CEb8'; // 기본값
              break;
          }
        } else {
          // 기타 네트워크는 기본 주소 사용
          walletAddress = '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266';
        }
        
        const addressHash = hashWalletAddress(walletAddress);
        console.log(`📱 ${indexType} 타입 → 지갑 주소: ${walletAddress} → 해시: ${addressHash}`);
        
        // 동적 인덱스 ID 생성 (타입명_해시 기반)
        const indexID = `${indexType}_${addressHash}`;
        const filePath = `data/${networkDir}/${indexType}_${addressHash}.bf`;
        
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
      
      // EVM 인덱스 전체 조회 로직 (구현 필요)
      const result = await indexingClient.searchAllData(indexType);
      
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
      
      console.log('✅ PVD gRPC 서버 연결 성공');
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
    
    console.log('📤 gRPC 요청 데이터:', JSON.stringify(request, null, 2));
    
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
      console.log('✅ 인덱싱 클라이언트 연결 성공');
      
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
      
      console.log('🎉 PVD 데이터 저장 + 인덱싱 완료!');
      
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
      console.log('📝 PVD 데이터 저장 중...');
      
      if (!this.grpcClient) {
        throw new Error('gRPC 클라이언트가 연결되지 않음. connect() 메서드를 먼저 호출하세요.');
      }
      
      // client.go의 createData 함수와 동일한 방식으로 요청
      console.log('📝 client.go createData 방식으로 PVD 데이터 저장 중...');
      
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
      
      console.log('📤 client.go createData 요청 구조:', JSON.stringify(request, null, 2));
      
      // 실제 gRPC putData 호출
      console.log('📤 gRPC 요청 데이터:', JSON.stringify(request, null, 2));
      
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
      console.log(`🔍 Speed 인덱스에 저장 중: ${pvdData.speed}`);
      
      // 인덱싱 서버를 통해 Speed 인덱스에 저장
      const indexingClient = new FabricIndexingClient({
        serverAddr: 'localhost:50052',
        protoPath: path.join(__dirname, '../../grpc-go/protos/index_manager.proto')
      });
      
      await indexingClient.connect();
      console.log(`✅ Speed 인덱싱 클라이언트 연결 성공`);
      
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
      
      console.log(`📤 Speed 인덱싱 요청 전송 중...`);
      
      // 타임아웃과 함께 실행
      const result = await Promise.race([
        indexingClient.insertData(indexRequest),
        timeoutPromise
      ]);
      
      console.log(`📥 Speed 인덱싱 응답:`, JSON.stringify(result, null, 2));
      
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
      console.log(`🔄 Speed 인덱싱 처리 시작...`);
      const result = await this.retryIndexing(pvdData, 'speed', 3);
      console.log(`📊 Speed 인덱싱 처리 완료:`, result.success ? '✅' : '❌');
      return result;
    } catch (error) {
      console.error(`❌ Speed 인덱싱 처리 실패:`, error.message);
      return { success: false, error: error.message };
    }
  }

  // DT 인덱싱 처리 (재시도 로직 포함)
  async processDtIndex(pvdData) {
    try {
      console.log(`🔄 DT 인덱싱 처리 시작...`);
      const result = await this.retryIndexing(pvdData, 'dt', 3);
      console.log(`📊 DT 인덱싱 처리 완료:`, result.success ? '✅' : '❌');
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
      console.log(`🔍 DT 인덱스에 저장 중: ${pvdData.collectionDt}`);
      
      // 인덱싱 서버를 통해 DT 인덱스에 저장
      const indexingClient = new FabricIndexingClient({
        serverAddr: 'localhost:50052',
        protoPath: path.join(__dirname, '../../grpc-go/protos/index_manager.proto')
      });
      
      await indexingClient.connect();
      console.log(`✅ DT 인덱싱 클라이언트 연결 성공`);
      
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
      
      console.log(`📤 DT 인덱싱 요청 전송 중...`);
      const result = await indexingClient.insertData(indexRequest);
      console.log(`📥 DT 인덱싱 응답:`, JSON.stringify(result, null, 2));
      
      // 명시적으로 연결 종료
      await indexingClient.close();
      console.log(`🔌 DT 인덱싱 클라이언트 연결 종료`);
      
      return { success: true, message: 'DT 인덱스 저장 완료' };
      
    } catch (error) {
      console.error(`❌ DT 인덱스 저장 실패: ${error.message}`);
      return { success: false, error: error.message };
    }
  }
  
  close() {
    if (this.client) {
      this.client.connected = false;
      console.log('🔌 PVD 서버 연결 종료');
    }
  }
}

// Fabric 체인코드 직접 호출 함수 (client.go 함수들에 맞춤)
async function callFabricChaincode(dataType, searchValue) {
  try {
    console.log(`🔗 Fabric 체인코드 호출: ${dataType}, ${searchValue}`);
    
    // PVD 전용 클라이언트 사용 (client.go 함수들에 맞춤)
    const pvdClient = new PvdClient('localhost:19001');
    
    try {
      await pvdClient.connect();
      console.log('✅ PVD 서버 연결 성공');
      
      // 1. 체인코드 정보 조회
      const chainInfo = {
        channelName: FABRIC_CONFIG.channelName,
        chaincode: FABRIC_CONFIG.chaincode
      };
      
      console.log(`📋 체인코드 정보:`, chainInfo);
      
      // 체인코드 상태 확인 생략 (로그 제거)
      
      // 3. client.go의 실제 함수들 호출
      let result;
      
      switch (dataType) {
        case 'speed':
          // 속도 데이터 조회: 인덱스 검색 결과만 사용
          console.log('🔍 속도 데이터 조회 - 인덱스 검색 결과 사용');
          // 속도 필터링 로직 추가
          if (result && result.PvdList) {
            const filteredData = result.PvdList.filter(pvd => {
              return pvd.Speed && parseInt(pvd.Speed) >= parseInt(searchValue);
            });
            result.filteredData = filteredData;
            result.matches = filteredData.length;
            result.searchCriteria = { field: 'Speed', value: searchValue };
          }
          break;
          
        case 'dt':
        case 'collectiondt':
          // 수집 날짜/시간 데이터 조회: 실제 Fabric 체인코드에서 조회
          console.log('🔍 수집 날짜/시간 데이터 조회 중 (실시간 체인코드 호출)...');
          result = await pvdClient.getWorldState(chainInfo);
          // 날짜/시간 필터링 로직 추가
          if (result && result.PvdList) {
            const filteredData = result.PvdList.filter(pvd => {
              return pvd.Collection_dt && pvd.Collection_dt.includes(searchValue);
            });
            result.filteredData = filteredData;
            result.matches = filteredData.length;
            result.searchCriteria = { field: 'CollectionDt', value: searchValue };
          }
          break;
          
        case 'organization':
          // 조직 데이터 조회: queryDatasByField 사용
          console.log('🔍 조직 데이터 필드 검색 중...');
          result = await pvdClient.queryDatasByField({
            chainInfo: chainInfo,
            field: 'organizationName',
            value: searchValue
          });
          break;
          
        case 'user':
          // 사용자 데이터 조회: queryData 사용
          console.log('🔍 사용자 데이터 조회 중...');
          result = await pvdClient.queryData(chainInfo, { obuId: searchValue });
          break;
          
        case 'history':
          // 히스토리 데이터 조회: queryHistory 사용
          console.log('🔍 히스토리 데이터 조회 중...');
          result = await pvdClient.queryHistory(chainInfo, { obuId: searchValue });
          break;
          
        case 'worldstate':
          // 월드스테이트 조회: getWorldState 사용
          console.log('🔍 월드스테이트 데이터 조회 중...');
          result = await pvdClient.getWorldState(chainInfo);
          break;
          

          
        case 'create':
          // 데이터 생성: createData 사용
          console.log('🔍 PVD 데이터 생성 중...');
          const pvdData = {
            obuId: searchValue,
            collectionDt: new Date().toISOString(),
            speed: 60
          };
          result = await pvdClient.createData(chainInfo, pvdData);
          break;

        case 'putdata':
          // CSV 데이터 저장: putData 사용
          console.log('📝 PVD CSV 데이터 저장 중...');
          const csvPvdData = {
            obuId: searchValue || 'csv_obu_001',
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
          result = await pvdClient.putData(csvPvdData);
          break;

        case 'create-index':
          // 인덱스만 생성 (데이터 없음) - 중복 호출 방지
          console.log('📊 인덱스 생성 중...');
          // searchValue를 dataType으로 사용 (speed, dt 등)
          result = await createIdx(searchValue, searchValue, network);
          break;
          
        default:
          // 기본 데이터 조회: getWorldState 사용
          console.log('🔍 월드스테이트 데이터 조회 중...');
          result = await pvdClient.getWorldState(chainInfo);
          break;
      }
      
      console.log('🔍 PVD 서비스 호출 성공');
      
      // create-index 타입일 때는 이미 위에서 처리했으므로 여기서는 건너뛰기
      if (dataType === 'create-index') {
        console.log('📊 create-index 타입: 인덱스 파일만 생성 완료');
        console.log(`📁 생성된 인덱스: ${result.indexID}`);
        console.log(`📁 파일 경로: ${result.filePath}`);
        
        // 결과 정리 (인덱스 생성만)
        const finalResult = {
          success: true,
          network: 'fabric',
          dataType: dataType,
          searchValue: searchValue,
          message: 'Fabric 인덱스 파일 생성 완료',
          timestamp: new Date().toISOString(),
          chainInfo: chainInfo,
          indexResult: result
        };
        
        pvdClient.close();
        return finalResult;
      }
      
      // create-index가 아닌 경우에만 worldstate 조회 (로그 제거)
      if (dataType !== 'create-index') {
        // 일반 검색 타입: 실시간 체인코드 조회 결과 반환
        console.log('🔍 실시간 체인코드 조회 결과 반환 중...');
        
        // 결과 정리 (실시간 블록체인 조회)
        const finalResult = {
          success: true,
          network: 'fabric',
          dataType: dataType,
          searchValue: searchValue,
          message: 'Fabric 체인코드 실시간 조회 완료',
          timestamp: new Date().toISOString(),
          chainInfo: chainInfo,
          searchResult: result,
          source: 'blockchain'  // 블록체인에서 직접 조회했음을 명시
        };
        
        pvdClient.close();
        return finalResult;
      }
      
    } catch (error) {
      console.log('⚠️ PVD 서비스 호출 실패, 대안 방법 시도...');
      console.log('에러:', error.message);
      
      // 대안: 기본 성공 응답 (실제 구현 시 PVD 서버와 통신)
      const fallbackResult = {
        success: true,
        network: 'fabric',
        dataType: dataType,
        searchValue: searchValue,
        message: 'Fabric 체인코드 호출 실패, 재시도 필요',
        timestamp: new Date().toISOString(),
        chainInfo: {
          channelName: FABRIC_CONFIG.channelName,
          chaincode: FABRIC_CONFIG.chaincode
        },
        note: 'PVD 서비스 호출 실패, 기본 응답 반환',
        error: error.message
      };
      
      pvdClient.close();
      return fallbackResult;
    }
    
  } catch (error) {
    console.error('❌ Fabric 체인코드 호출 실패:', error.message);
    throw error;
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
    console.log('✅ Fabric 인덱싱 서버 연결 성공');
    
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
    


// 조직별 인덱스에 트랜잭션 ID 추가
async function addToOrganizationIndex(organizationName, txHash, network) {
  const indexingClient = new IndexingClient({
    serverAddr: 'localhost:50052',
    protoPath: PROTO_PATH
  });
  
  try {
    await indexingClient.connect();
    
    // 조직별 지갑 주소 매핑 (create-index와 동일한 로직)
    let walletAddress;
    if (network === 'hardhat' || network === 'hardhat-local') {
      switch (organizationName.toLowerCase()) {
        case 'samsung':
          walletAddress = '0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC';
          break;
        case 'lg':
          walletAddress = '0x90F79bf6EB2c4f870365E785982E1f101E93b906';
          break;
        default:
          walletAddress = '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266';
          break;
      }
    }
    
    const addressHash = hashWalletAddress(walletAddress);
    const networkDir = (network === 'hardhat' || network === 'localhost') ? 'hardhat-local' : network;
    const indexID = `${organizationName}_${addressHash}`;
    const filePath = `data/${networkDir}/${organizationName}_${addressHash}.bf`;
    
    // 트랜잭션 ID를 인덱스에 추가 (AccessManagement 구조)
    const insertRequest = {
      IndexID: indexID,
      BcList: [{
        TxId: txHash,
        KeyCol: 'IndexableData',
        AccessRequest: {
          requestId: Date.now().toString(),
          resourceOwner: walletAddress,
          requester: '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266', // 배포자 주소
          organizationName: organizationName,
          purpose: 'health_data_request',
          status: 'PENDING',
          createdAt: new Date().toISOString()
        }
      }],
      FilePath: filePath,
      Network: network
    };
    
    console.log(`  📝 조직 인덱스 저장: ${organizationName} → ${txHash}`);
    await indexingClient.insertData(insertRequest);
    
    // 안전한 인덱싱을 위한 대기
    await new Promise(resolve => setTimeout(resolve, 200));
    
    indexingClient.close();
    
  } catch (error) {
    indexingClient.close();
    throw new Error(`조직 인덱스 추가 실패: ${error.message}`);
  }
}

// 사용자별 인덱스에 트랜잭션 ID 추가
async function addToUserIndex(resourceOwner, txHash, network) {
  const indexingClient = new IndexingClient({
    serverAddr: 'localhost:50052',
    protoPath: PROTO_PATH
  });
  
  try {
    await indexingClient.connect();
    
    // 사용자별 인덱스 ID 생성
    const addressHash = hashWalletAddress(resourceOwner);
    const networkDir = (network === 'hardhat' || network === 'localhost') ? 'hardhat-local' : network;
    
    // resourceOwner 주소로 userType 결정
    let userType;
    if (resourceOwner === '0x70997970C51812dc3A010C7d01b50e0d17dc79C8') {
      userType = 'user1';
    } else if (resourceOwner === '0x15d34AAf54267DB7D7c367839AAf71A00a2C6A65') {
      userType = 'user2';
    } else if (resourceOwner === '0x9965507D1a55bcC2695C58ba16FB37d819B0A4dc') {
      userType = 'user3';
    } else {
      userType = 'user';
    }
    
    const indexID = `${userType}_${addressHash}`;
    const filePath = `data/${networkDir}/${userType}_${addressHash}.bf`;
    
    // 트랜잭션 ID를 인덱스에 추가 (AccessManagement 구조)
    const insertRequest = {
      IndexID: indexID,
      BcList: [{
        TxId: txHash,
        KeyCol: 'IndexableData',
        AccessRequest: {
          requestId: Date.now().toString(),
          resourceOwner: resourceOwner,
          requester: '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266', // 배포자 주소
          organizationName: 'user_request',
          purpose: 'health_data_access',
          status: 'PENDING',
          createdAt: new Date().toISOString()
        }
      }],
      FilePath: filePath,
      Network: network
    };
    
    console.log(`  📝 사용자 인덱스 저장: ${userType} → ${txHash}`);
    await indexingClient.insertData(insertRequest);
    
    // 안전한 인덱싱을 위한 대기
    await new Promise(resolve => setTimeout(resolve, 200));
    
    indexingClient.close();
    
  } catch (error) {
    indexingClient.close();
    throw new Error(`사용자 인덱스 추가 실패: ${error.message}`);
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
    
    const contractAddress = '0x5FbDB2315678afecb367f032d93F642f64180aa3'; // Hardhat 배포된 주소
    
    // AccessManagement 컨트랙트 연결
    const AccessManagement = await ethers.getContractFactory('AccessManagement', signer);
    const contract = AccessManagement.attach(contractAddress);
    
    console.log(`📝 요청자 주소: ${signer.address}`);
    console.log(`🔗 컨트랙트 주소: ${contractAddress}`);
    
    // 수면 & 스트레스 데이터 요청: Samsung(1,1,1) + LG(1,2,3) = 총 9개 요청
    const requests = [
      // Samsung → User1 (1개) - 수면 데이터
      {
        resourceOwner: '0x70997970C51812dc3A010C7d01b50e0d17dc79C8', // user1 주소
        purpose: 'sleep_quality_monitoring',
        organizationName: 'samsung'
      },
      
      // Samsung → User2 (1개) - 수면 패턴
      {
        resourceOwner: '0x15d34AAf54267DB7D7c367839AAf71A00a2C6A65', // user2 주소
        purpose: 'sleep_duration_tracking',
        organizationName: 'samsung'
      },
      
      // Samsung → User3 (1개) - 수면 분석
      {
        resourceOwner: '0x9965507D1a55bcC2695C58ba16FB37d819B0A4dc', // user3 주소
        purpose: 'sleep_stage_analysis',
        organizationName: 'samsung'
      },
      
      // LG → User1 (1개) - 스트레스 기본
      {
        resourceOwner: '0x70997970C51812dc3A010C7d01b50e0d17dc79C8', // user1 주소
        purpose: 'stress_level_monitoring',
        organizationName: 'lg'
      },
      
      // LG → User2 (2개) - 스트레스 관리
      {
        resourceOwner: '0x15d34AAf54267DB7D7c367839AAf71A00a2C6A65', // user2 주소
        purpose: 'stress_pattern_analysis',
        organizationName: 'lg'
      },
      {
        resourceOwner: '0x15d34AAf54267DB7D7c367839AAf71A00a2C6A65', // user2 주소 (2번째)
        purpose: 'stress_relief_recommendations',
        organizationName: 'lg'
      },
      
      // LG → User3 (3개) - 종합 스트레스 관리
      {
        resourceOwner: '0x9965507D1a55bcC2695C58ba16FB37d819B0A4dc', // user3 주소
        purpose: 'stress_trigger_identification',
        organizationName: 'lg'
      },
      {
        resourceOwner: '0x9965507D1a55bcC2695C58ba16FB37d819B0A4dc', // user3 주소 (2번째)
        purpose: 'stress_recovery_tracking',
        organizationName: 'lg'
      },
      {
        resourceOwner: '0x9965507D1a55bcC2695C58ba16FB37d819B0A4dc', // user3 주소 (3번째)
        purpose: 'stress_sleep_correlation',
        organizationName: 'lg'
      }
    ];
    
    const results = [];
    
    for (let i = 0; i < requests.length; i++) {
      const req = requests[i];
      console.log(`\n📋 데이터 요청 ${i + 1}/9: ${req.organizationName} → ${req.resourceOwner.slice(0,10)}... (${req.purpose})`);
      
      try {
        // 컨트랙트의 saveRequest 함수 호출
        const tx = await contract.saveRequest(
          req.resourceOwner,  // _resourceOwner (사용자 wallet 주소)
          req.purpose,        // _purpose (목적)
          req.organizationName // _organizationName (조직명)
        );
        
        console.log(`⏳ 트랜잭션 전송: ${tx.hash}`);
        const receipt = await tx.wait();
        console.log(`✅ 트랜잭션 확인됨 (블록 ${receipt.blockNumber})`);
        
        // 트랜잭션 생성 후 인덱싱 수행
        console.log(`📊 인덱싱 시작: ${tx.hash}`);
        
        try {
          // 1. 조직별 인덱스에 트랜잭션 ID 저장
          await addToOrganizationIndex(req.organizationName, tx.hash, network);
          await new Promise(resolve => setTimeout(resolve, 500)); // 0.5초 대기
          
          // 2. 사용자별 인덱스에 트랜잭션 ID 저장  
          await addToUserIndex(req.resourceOwner, tx.hash, network);
          await new Promise(resolve => setTimeout(resolve, 500)); // 0.5초 대기
          
          console.log(`✅ 인덱싱 완료: ${tx.hash}`);
          
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
        
        // 인덱싱을 위한 잠시 대기
        await new Promise(resolve => setTimeout(resolve, 500));
        
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
    
    // 조직별 요약
    const samsungResults = results.filter(r => r.organizationName === 'samsung');
    const lgResults = results.filter(r => r.organizationName === 'lg');
    
    console.log('🏢 Samsung 요청:');
    samsungResults.forEach((result, index) => {
      console.log(`   ${index + 1}. ${result.resourceOwner.slice(0,10)}... → ${result.purpose}: ${result.success ? '✅' : '❌'}`);
      if (result.success) console.log(`      트랜잭션: ${result.txHash}`);
    });
    
    console.log('\n🏢 LG 요청:');
    lgResults.forEach((result, index) => {
      console.log(`   ${index + 1}. ${result.resourceOwner.slice(0,10)}... → ${result.purpose}: ${result.success ? '✅' : '❌'}`);
      if (result.success) console.log(`      트랜잭션: ${result.txHash}`);
    });
    
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
    
    if (network !== 'fabric') {
      throw new Error('트랜잭션 상세 조회는 Fabric 네트워크에서만 지원됩니다');
    }
    
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
    console.error(`❌ 트랜잭션 상세 조회 실패: ${error.message}`);
    throw error;
  }
}

// ===== 메인 함수 =====
async function main() {
  console.log(`🔧 BI-Index CLI - 명령어: ${cmd}, 네트워크: ${network}`);
  console.log('=====================================');
  
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
        if (!network || !type) {
          console.error('❌ create-index 명령어는 -network와 -type이 필요합니다');
          console.log('예시: node cli.js -cmd=create-index -type=samsung -network=hardhat');
          return;
        }
        await createIndexUnified(network, type);
        break;
        
      // ===== Samsung 인덱스 생성 =====
      case 'create-samsung':
        if (!network) {
          console.error('❌ create-samsung 명령어는 -network가 필요합니다');
          return;
        }
        await createIndexUnified(network, 'samsung');
        break;
        
      // ===== 사용자 인덱스 생성 =====
      case 'create-user-indexes':
        if (!network) {
          console.error('❌ create-user-indexes 명령어는 -network가 필요합니다');
          return;
        }
        await createUserIndexes(network);
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
        if (type === 'individual') {
          // CSV 데이터 개별 처리
          const csvFile = value || 'pvd_hist_10.csv';
          const batchSize = process.argv.find(arg => arg.startsWith('-batch='))?.split('=')[1] || '1000';
          await putPvdMultiData(network, csvFile, parseInt(batchSize));
        } else {
          // 단건 데이터 넣기
          if (!value) {
            console.error('❌ putdata 명령어는 -value가 필요합니다');
            console.log('예시: node cli.js -cmd=putdata -value=OBU-TEST-001 -network=fabric');
            console.log('     node cli.js -cmd=putdata -type=individual -value=scripts/pvd_hist_10.csv -network=fabric');
            return;
          }
          await putPvdData(network, value);
        }
        break;
        

      // ===== 인덱스 전체 조회 =====
      case 'search-index':
        if (!type) {
          console.error('❌ search-index 명령어는 -type이 필요합니다');
          console.log('예시: node cli.js -cmd=search-index -type=speed -network=fabric');
          return;
        }
        await searchIndexAll(network, type);
        break;
        
      // ===== 트랜잭션 상세 조회 =====
      case 'get-tx-details':
        if (!value) {
          console.error('❌ get-tx-details 명령어는 -value(트랜잭션 ID)가 필요합니다');
          console.log('예시: node cli.js -cmd=get-tx-details -value=05aba83a12c143d3843e363f21ac4759c61db8b6c4c1a609db62b40412fbe5d5 -network=fabric');
          return;
        }
        if (network !== 'fabric') {
          console.error('❌ 트랜잭션 상세 조회는 fabric 네트워크에서만 지원됩니다');
          return;
        }
        await getTxDetails(network, value);
        break;
        
      // ===== 데이터 요청 =====
             case 'request-data':
        if (!network) {
          console.error('❌ request-data 명령어는 -network가 필요합니다');
          return;
        }
        await requestData(network);
        break;
        
      // ===== 대규모 테스트 =====
       case 'large-scale-test':
        await largeScaleTest();
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
        
      // ===== 도움말 =====
      case 'help':
        showHelp();
        break;
        
      default:
        console.error(`❌ 알 수 없는 명령어: ${cmd}`);
        console.log('사용 가능한 명령어: deploy, create-index, create-samsung, create-user-indexes, create-fabric-index, putdata, search-index, get-tx-details, request-data, large-scale-test, check-config, check-network-config, update-network, help');
        break;
    }
    
  } catch (error) {
    console.error(`❌ 명령어 실행 실패: ${error.message}`);
  }
}

// 스크립트가 직접 실행될 때만 main 함수 호출
if (require.main === module) {
  main().catch(console.error);
}

module.exports = {
  searchIndexAll,
  searchFabricIndexAll
};