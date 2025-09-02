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
const PROTO_PATH = path.join(process.cwd(), '../../idxmngr-go/protos/index_manager.proto');
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
    console.log(`🔧 ${network} 네트워크 설정 자동 업데이트 중...`);
    await updateNetworkConfig(network, contractAddress);
    
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
      
      // 배치 방식 선택 (type에 따라)
      if (type === 'batch') {
        // 진짜 배치 방식: 여러 데이터를 한번에 gRPC 호출
        await putPvdBatchData(network, batchLines, batchIndex);
        successCount += batchLines.length;
        console.log(`✅ 배치 ${batchIndex + 1} 완료 (${batchLines.length}개 한번에 처리)`);
      } else if (type === 'individual' || type === 'multi') {
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
              
              // PVD 클라이언트를 통해 인덱싱 처리 (single-csv와 동일한 방식)
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

// PVD 배치 데이터 저장 (진짜 배치 방식, Fabric 네트워크)
async function putPvdBatchData(network, batchLines, batchIndex) {
  console.log(`🚀 배치 ${batchIndex + 1} 데이터를 한번에 처리 중...`);
  
  if (network !== 'fabric') {
    throw new Error('배치 데이터는 Fabric 네트워크에서만 지원됩니다');
  }
  
  try {
    // PVD 클라이언트 연결
    const pvdClient = new PvdClient('localhost:19001');
    await pvdClient.connect();
    console.log('✅ PVD 서버 연결 성공');
    
    // 배치 데이터 준비
    const batchData = [];
    
    for (let i = 0; i < batchLines.length; i++) {
      const values = batchLines[i].split(',');
      
      if (values.length < 5) {
        console.log(`⚠️ 라인 스킵 (데이터 부족): ${values.join(',')}`);
        continue;
      }
      
      // CSV 데이터를 PVD 객체로 파싱
      const pvdData = {
        obuId: values[0] || `CSV-OBU-${Date.now()}-${i}`,
        speed: parseInt(values[5]) || 60,
        collectionDt: values[1] || new Date().toISOString(),
        startvectorLatitude: parseFloat(values[2]) || 37.5665,
        startvectorLongitude: parseFloat(values[3]) || 126.9780,
        transmisstion: values[4] || 'D',
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
      
      batchData.push(pvdData);
    }
    
    console.log(`📦 배치 데이터 준비 완료: ${batchData.length}개`);
    
    // 배치로 한번에 저장 (putMultiData 사용)
    const result = await pvdClient.putMultiData(batchData);
    
    pvdClient.close();
    console.log(`✅ 배치 ${batchIndex + 1} 처리 완료: ${batchData.length}개 데이터`);
    
    return result;
    
  } catch (error) {
    console.error(`❌ 배치 데이터 저장 실패: ${error.message}`);
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
      // EVM 계열 네트워크: type별 인덱스 생성
      switch (indexType) {
        case 'samsung':
          console.log(`📊 ${network} 네트워크 - Samsung 인덱스 생성...`);
          await createSamsungIndex(network);
          console.log('✅ Samsung 인덱스 생성 완료');
          return {
            success: true,
            network: network,
            indexType: 'samsung',
            message: `${network} Samsung 인덱스 생성 완료`
          };
          
        case 'lg':
          console.log(`📊 ${network} 네트워크 - LG 인덱스 생성...`);
          await createLgIndex(network);
          console.log('✅ LG 인덱스 생성 완료');
          return {
            success: true,
            network: network,
            indexType: 'lg',
            message: `${network} LG 인덱스 생성 완료`
          };
          
        case 'user':
        case 'users':
          console.log(`📊 ${network} 네트워크 - User 인덱스들 생성...`);
          await createUserIndexes(network);
          console.log('✅ User 인덱스들 생성 완료');
          return {
            success: true,
            network: network,
            indexType: 'user',
            message: `${network} User 인덱스들 생성 완료`
          };
          
        case 'all':
          console.log(`📊 ${network} 네트워크 - 모든 인덱스 생성...`);
          const results = [];
          
          try {
            await createSamsungIndex(network);
            results.push('Samsung');
          } catch (error) {
            console.log(`⚠️ Samsung 인덱스 생성 실패: ${error.message}`);
          }
          
          try {
            await createLgIndex(network);
            results.push('LG');
          } catch (error) {
            console.log(`⚠️ LG 인덱스 생성 실패: ${error.message}`);
          }
          
          try {
            await createUserIndexes(network);
            results.push('User');
          } catch (error) {
            console.log(`⚠️ User 인덱스들 생성 실패: ${error.message}`);
          }
          
          console.log(`✅ ${network} 네트워크 모든 인덱스 생성 완료`);
          return {
            success: true,
            network: network,
            indexType: 'all',
            indexes: results,
            message: `${network} 모든 인덱스 생성 완료`
          };
          
        default:
          // 동적 타입 처리: createIdx 함수 사용
          console.log(`📊 ${network} 네트워크 - 동적 인덱스 생성: ${indexType}`);
          const dynamicResult = await createIdx(indexType, indexType, network);
          console.log(`✅ ${indexType} 인덱스 생성 완료`);
          return {
            success: true,
            network: network,
            indexType: indexType,
            message: `${network} ${indexType} 인덱스 생성 완료`,
            result: dynamicResult
          };
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

// 네트워크별 데이터 조회
async function searchData(network, dataType, searchValue) {
  try {
    console.log(`🔍 ${network} 네트워크에서 ${dataType} 데이터 조회 시작...`);
    
    // Fabric 네트워크인 경우 grpc-go 서버를 통해 실시간 블록체인 조회
    if (network === 'fabric') {
      console.log('🔗 Fabric 네트워크 - grpc-go 서버 연결 중...');
      
      try {
        // 1. grpc-go 서버를 통해 Fabric 체인코드에서 실시간 데이터 조회
        const fabricResult = await callFabricChaincode(dataType, searchValue);
        console.log('🔍 Fabric 체인코드 조회 결과:', fabricResult);
        
        // 2. 인덱스에서도 검색 (병렬 수행)
        console.log('🔍 Fabric 인덱스에서도 검색 시작...');
        try {
          const indexResult = await searchFabricIndex(dataType, searchValue);
          console.log('🔍 Fabric 인덱스 검색 결과:', indexResult);
          
          // 체인코드 결과와 인덱스 결과를 합쳐서 반환
          return {
            ...fabricResult,
            indexSearchResult: indexResult
          };
        } catch (indexError) {
          console.warn('⚠️ 인덱스 검색 실패 (체인코드 결과만 반환):', indexError.message);
          return fabricResult;
        }
        
      } catch (error) {
        console.error('❌ Fabric 체인코드 조회 실패:', error.message);
        throw error;
      }
    }
    
    // Hardhat/Monad 네트워크는 기존 로직 사용
    const indexingClient = new IndexingClient({
      serverAddr: 'localhost:50052',
      protoPath: PROTO_PATH
    });
    
    // 연결 완료 대기
    await new Promise(resolve => setTimeout(resolve, 1000));
    
    let indexID, field, filePath;
    
    switch (dataType) {
      case 'organization':
        // 조직 검색은 주소로 검색 (조직명_해시된주소)
        const orgShortHash = hashWalletAddress(searchValue);
        
        // 네트워크별 계정 매칭 (디버깅 로그 추가)
        console.log(`🔍 계정 매칭 디버깅:`);
        console.log(`   네트워크: ${network}`);
        console.log(`   검색 주소: ${searchValue}`);
        console.log(`   주소 길이: ${searchValue.length}`);
        
        let orgName;
        if (network === 'monad') {
          // Monad 네트워크 계정 매칭
          if (searchValue === '0x2630ffE517DFC9b0112317a2EC0AB4cE2a59CEb8') {
            orgName = 'samsung';  // Monad Samsung 계정
          } else if (searchValue === '0xa5cc9D9F1f68546060852f7c685B99f0cD532229') {
            orgName = 'lg';       // Monad LG 계정
          } else {
            orgName = 'unknown';  // 기타 Monad 주소
          }
        } else {
          // Hardhat 네트워크 계정 매칭 (정확한 주소로 수정)
          if (searchValue === '0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC') {
            orgName = 'samsung';  // 계정 2번 → Samsung (정확한 대문자)
          } else if (searchValue === '0x90F79bf6EB2c4f870365E785982E1f101E93b906') {
            orgName = 'lg';       // 계정 3번 → LG (정확한 대문자)
          } else {
            orgName = 'unknown';  // 기타 주소
          }
        }
        
        console.log(`   매칭된 조직명: ${orgName}`);
        
        // 네트워크 경로 매핑 (hardhat -> hardhat-local)
        const networkDir = network === 'hardhat' ? 'hardhat-local' : network;
        
        indexID = `${orgName}_${orgShortHash}`;
        field = 'IndexableData';
        searchValue = orgName;   // 실제 조직명으로 검색
        filePath = `data/${networkDir}/${orgName}_${orgShortHash}.bf`;
        break;
        
      case 'user':
        // 사용자 검색도 IndexableData에서 지갑 주소로 검색
        const shortHash = hashWalletAddress(searchValue);
        const userNetworkDir = network === 'hardhat' ? 'hardhat-local' : network;
        indexID = `user_${shortHash}`;
        field = 'IndexableData';  // 🔥 DynamicFields → IndexableData
        // 🔥 지갑 주소 그대로 검색
        searchValue = searchValue;  // 원본 지갑 주소 사용
        filePath = `data/${userNetworkDir}/user_${shortHash}.bf`;
        break;
        
      case 'speed':
        const speedNetworkDir = network === 'hardhat' ? 'hardhat-local' : network;
        indexID = `${network}_speed`;
        field = 'Speed';
        filePath = `data/${speedNetworkDir}/speed.bf`;
        break;
        
      default:
        throw new Error(`지원하지 않는 데이터 타입: ${dataType}`);
    }
    
    const searchRequest = {
      IndexID: indexID,
      Field: field,
      Value: searchValue,
      FilePath: filePath,
      KeySize: 64,
      ComOp: 'Eq'
    };
    
    console.log(`🔍 검색 요청:`, searchRequest);
    
    const response = await indexingClient.searchData(searchRequest);
    console.log(`✅ 데이터 조회 완료!`);
    
    // 검색 결과를 깔끔하게 정리
    const cleanResult = {
      success: true,
      indexId: response.idxInfo?.IndexID || searchRequest.IndexID,
      indexName: response.idxInfo?.IndexName || 'Unknown Index',
      data: response.IdxData || [],
      count: response.IdxData?.length || 0,
      network: network,
      dataType: dataType,
      searchValue: value,
      timestamp: new Date().toISOString()
    };
    
    console.log(`📊 검색 결과:`);
    console.log(`   🆔 인덱스 ID: ${cleanResult.indexId}`);
    console.log(`   📝 인덱스 이름: ${cleanResult.indexName}`);
    console.log(`   📊 데이터 개수: ${cleanResult.count}`);
    console.log(`   🌐 네트워크: ${cleanResult.network}`);
    console.log(`   🔍 검색 타입: ${cleanResult.dataType}`);
    console.log(`   🔎 검색값: ${cleanResult.searchValue}`);
    
    if (cleanResult.data.length > 0) {
      console.log(`   📋 인덱싱된 데이터:`);
      cleanResult.data.forEach((item, index) => {
        console.log(`      ${index + 1}. 트랜잭션 ID: ${item}`);
        
        // 트랜잭션 ID가 있으면 상세 정보 표시
        if (item && item.startsWith('0x')) {
          console.log(`         🔗 해시: ${item}`);
          
          // 인덱스에서 저장된 데이터 구조 설명
          console.log(`         📊 인덱싱된 정보:`);
          console.log(`            • TxId: ${item}`);
          console.log(`            • EventName: AccessRequestsSaved`);
          console.log(`            • ContractAddress: AccessManagement 컨트랙트`);
          console.log(`            • DynamicFields: requestType(purpose), description, userId, requestingOrg 등`);
          
          // 만약 item이 객체라면 더 자세한 정보 표시
          if (typeof item === 'object' && item !== null) {
            console.log(`         📊 상세 데이터:`, item);
          }
        }
      });
      
      console.log(`\n💡 트랜잭션 상세 정보를 보려면:`);
      console.log(`   node cli.js -cmd=get-tx-details -value=[트랜잭션_해시] -network=hardhat-local`);
      console.log(`\n💡 인덱스에 저장된 실제 데이터 내용을 보려면:`);
      console.log(`   인덱스 파일을 직접 확인하거나, 트랜잭션 상세 정보 조회를 사용하세요.`);
    } else {
      console.log(`   ℹ️  인덱싱된 데이터가 없습니다.`);
    }
    
    indexingClient.close();
    return cleanResult;
    
  } catch (error) {
    console.error(`❌ 데이터 조회 실패: ${error.message}`);
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
  
  // client.go의 getChainInfo 함수
  async getChainInfo(chainInfo) {
    console.log('🔍 PVD getChainInfo 호출:', chainInfo);
    return { 
      success: true, 
      method: 'getChainInfo', 
      data: '체인 정보',
      height: 1000,
      nodes: ['peer0.org1.example.com', 'peer0.org2.example.com']
    };
  }
  
  // client.go의 getBlock 함수
  async getBlock(chainInfo) {
    console.log('🔍 PVD getBlock 호출:', chainInfo);
    return { 
      success: true, 
      method: 'getBlock', 
      data: '블록 데이터',
      blockNumber: chainInfo.height || 0,
      txCount: 10
    };
  }
  
  // client.go의 getRichQuery 함수
  async getRichQuery(queryInfo) {
    console.log('🔍 PVD getRichQuery 호출:', queryInfo);
    return { 
      success: true, 
      method: 'getRichQuery', 
      data: '리치 쿼리 결과',
      filter: queryInfo.filter,
      matches: 15
    };
  }
  
  // client.go의 getAllBlock 함수
  async getAllBlock(chainInfo) {
    console.log('🔍 PVD getAllBlock 호출:', chainInfo);
    
    return new Promise((resolve, reject) => {
      this.grpcClient.getAllBlock(chainInfo, (error, response) => {
        if (error) {
          console.error('❌ gRPC getAllBlock 호출 실패:', error);
          reject(error);
          return;
        }
        
        console.log('✅ gRPC getAllBlock 호출 성공:', response);
        resolve(response);
      });
    });
  }
  
  // client.go의 getRangeBlock 함수
  async getRangeBlock(chainInfo) {
    console.log('🔍 PVD getRangeBlock 호출:', chainInfo);
    
    return new Promise((resolve, reject) => {
      this.grpcClient.getRangeBlock(chainInfo, (error, response) => {
        if (error) {
          console.error('❌ gRPC getRangeBlock 호출 실패:', error);
          reject(error);
          return;
        }
        
        console.log('✅ gRPC getRangeBlock 호출 성공:', response);
        resolve(response);
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
          
        case 'allblock':
          // 모든 블록 조회: getAllBlock 사용
          console.log('🔍 모든 블록 데이터 조회 중...');
          result = await pvdClient.getAllBlock(chainInfo);
          break;
          
        case 'range':
          // 범위 블록 조회: getRangeBlock 사용
          console.log('🔍 범위 블록 데이터 조회 중...');
          const startBlock = 1;
          const endBlock = 1000;
          result = await pvdClient.getRangeBlock({
            ...chainInfo,
            Start: startBlock,
            End: endBlock
          });
          break;
          
        case 'chaininfo':
          // 체인 정보 조회: getChainInfo 사용
          console.log('🔍 체인 정보 조회 중...');
          result = await pvdClient.getChainInfo(chainInfo);
          break;
          
        case 'block':
          // 블록 데이터 조회: getBlock 사용
          console.log('🔍 블록 데이터 조회 중...');
          result = await pvdClient.getBlock(chainInfo);
          break;
          
        case 'allblock':
          // 모든 블록 데이터 조회: getAllBlock 사용
          console.log('🔍 모든 블록 데이터 조회 중...');
          result = await pvdClient.getAllBlock(chainInfo);
          break;
          
        case 'rangeblock':
          // 범위 블록 데이터 조회: getRangeBlock 사용
          console.log('🔍 범위 블록 데이터 조회 중...');
          chainInfo.start = parseInt(searchValue) || 0;
          chainInfo.end = parseInt(searchValue) + 100 || 100;
          result = await pvdClient.getRangeBlock(chainInfo);
          break;
          
        case 'richquery':
          // 리치 쿼리: getRichQuery 사용 (Speed 기반)
          console.log('🔍 리치 쿼리 실행 중...');
          const queryInfo = {
            chainInfo: chainInfo,
            filter: `{"filter": [{"var": "wstates"}, {">=": [{"var": ".SPEED"}, ${searchValue || 60}]}]}`
          };
          result = await pvdClient.getRichQuery(queryInfo);
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
    
// 네트워크별 데이터 조회
async function searchData(network, dataType, searchValue) {
  try {
    console.log(`🔍 ${network} 네트워크에서 ${dataType} 데이터 조회 시작...`);
    
    // Fabric 네트워크인 경우 grpc-go 서버를 통해 실시간 블록체인 조회
    if (network === 'fabric') {
      console.log('🔗 Fabric 네트워크 - grpc-go 서버 연결 중...');
      
      try {
        // 1. grpc-go 서버를 통해 Fabric 체인코드에서 실시간 데이터 조회
        const fabricResult = await callFabricChaincode(dataType, searchValue);
        console.log('🔍 Fabric 체인코드 조회 결과:', fabricResult);
        
        // 2. 인덱스에서도 검색 (병렬 수행)
        console.log('🔍 Fabric 인덱스에서도 검색 시작...');
        const indexResult = await searchFabricIndex(dataType, searchValue);
        console.log('🔍 Fabric 인덱스 검색 결과:', indexResult);
    
    return {
      success: true,
          fabricData: fabricResult,
          indexData: indexResult,
          network: network,
          dataType: dataType,
          searchValue: searchValue,
          timestamp: new Date().toISOString()
    };
    
  } catch (error) {
        console.error(`❌ Fabric 데이터 조회 실패: ${error.message}`);
    throw error;
      }
      
    } else {
      // EVM 계열 네트워크 처리
      console.log(`📊 ${network} 네트워크에서 ${dataType} 데이터 조회...`);
      
      // EVM 네트워크별 조회 로직 (기존 코드 유지)
    const indexingClient = new IndexingClient({
      serverAddr: 'localhost:50052',
      protoPath: PROTO_PATH
    });
    
    await indexingClient.connect();
    console.log('✅ 인덱싱 서버 연결 성공');
    
      const result = await indexingClient.searchData({
        network: network,
        dataType: dataType,
        searchValue: searchValue
      });
      
        indexingClient.close();
      return result;
    }
      
    } catch (error) {
    console.error(`❌ ${network} 네트워크 데이터 조회 실패: ${error.message}`);
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
        
      // ===== Samsung 인덱스 생성 =====
      case 'create-samsung':
        if (!network) {
          console.error('❌ create-samsung 명령어는 -network가 필요합니다');
          return;
        }
        await createSamsungIndex(network);
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
        await createFabricIndex(network, type);
        break;
        
      // ===== PVD 데이터 저장 =====
      case 'putdata':
        if (type === 'with-indexing') {
          // PVD 데이터 저장 + 인덱싱 통합 (client.go putDataWithIndexing 방식)
          const obuId = value || 'OBU-TEST-001';
          const speed = process.argv.find(arg => arg.startsWith('-speed='))?.split('=')[1] || '80';
          await putPvdDataWithIndexing(network, obuId, parseInt(speed));
        } else if (type === 'single-csv') {
          // CSV 파일의 첫 번째 행만 단건으로 저장
          const csvFile = value || 'pvd_test_10.csv';
          await putPvdSingleCsvData(network, csvFile);
        } else if (type === 'individual' || type === 'multi' || type === 'batch' || type === 'csv') {
          // CSV 데이터 넣기 (개별 또는 배치)
          const csvFile = value || 'pvd_hist_10.csv';
          const batchSize = process.argv.find(arg => arg.startsWith('-batch='))?.split('=')[1] || '1000';
          await putPvdMultiData(network, csvFile, parseInt(batchSize));
        } else {
          // 단건 데이터 넣기
          if (!value) {
            console.error('❌ putdata 명령어는 -value가 필요합니다');
            console.log('예시: node cli.js -cmd=putdata -value=OBU-TEST-001 -network=fabric');
            console.log('     node cli.js -cmd=putdata -type=single-csv -value=pvd_test_10.csv -network=fabric');
            console.log('     node cli.js -cmd=putdata -type=with-indexing -value=OBU-TEST-001 -speed=80 -network=fabric');
            return;
          }
          await putPvdData(network, value);
        }
        break;
        
      // ===== 데이터 조회 =====
      case 'search':
        if (!type || !value) {
          console.error('❌ search 명령어는 -type과 -value가 필요합니다');
          console.log('예시: node cli.js -cmd=search -type=organization -value=0x2630ffE517DFC9b0112317a2EC0AB4cE2a59CEb8');
          return;
        }
        await searchData(network, type, value);
        break;
        
      // ===== 인덱스 전체 조회 =====
      case 'search-all':
      case 'search-index':
        if (!type) {
          console.error('❌ search-all 명령어는 -type이 필요합니다');
          console.log('예시: node cli.js -cmd=search-all -type=speed -network=fabric');
          return;
        }
        await searchIndexAll(network, type);
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
        updateNetworkConfig(network, contract);
        break;
        
      // ===== 도움말 =====
      case 'help':
        showHelp();
        break;
        
      default:
        console.error(`❌ 알 수 없는 명령어: ${cmd}`);
        console.log('사용 가능한 명령어: deploy, create-samsung, create-user-indexes, create-fabric-index, putdata, search, search-all, request-data, large-scale-test, check-config, check-network-config, update-network, help');
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
  searchData,
  searchIndexAll,
  searchFabricIndexAll
};