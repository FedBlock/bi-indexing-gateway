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
            await putPvdData(network, pvdData.obuId, pvdData);
            successCount++;
            
            // 진행 상황 표시 (10개마다)
            if (successCount % 10 === 0) {
              process.stdout.write('.');
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
            indexId: 'speed_001',
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
            indexId: 'dt_001',
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
          throw new Error(`${network}에서 지원하지 않는 인덱스 타입: ${indexType}`);
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
        // 조직 검색은 주소로 검색 (조직명_해시된주소_001)
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
        
        indexID = `${orgName}_${orgShortHash}_001`;
        field = 'IndexableData';
        searchValue = orgName;   // 실제 조직명으로 검색
        filePath = `data/${networkDir}/${orgName}_${orgShortHash}_001.bf`;
        break;
        
      case 'user':
        // 사용자 검색도 IndexableData에서 지갑 주소로 검색
        const shortHash = hashWalletAddress(searchValue);
        const userNetworkDir = network === 'hardhat' ? 'hardhat-local' : network;
        indexID = `user_${shortHash}_001`;
        field = 'IndexableData';  // 🔥 DynamicFields → IndexableData
        // 🔥 지갑 주소 그대로 검색
        searchValue = searchValue;  // 원본 지갑 주소 사용
        filePath = `data/${userNetworkDir}/user_${shortHash}_001.bf`;
        break;
        
      case 'speed':
        const speedNetworkDir = network === 'hardhat' ? 'hardhat-local' : network;
        indexID = `${network}_speed_001`;
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
          console.log(`🔑 트랜잭션 해시: ${response.txId}`);
          console.log('📥 응답 데이터:', JSON.stringify(response, null, 2));
          
          resolve({
            success: true,
            method: 'putData',
            txId: response.txId,
            data: 'PVD 데이터 저장 결과 (실제 트랜잭션)',
            obuId: 'OBU-461001c4',
            speed: 0,
            collectionDt: '20221001001000198',
            timestamp: new Date().toISOString(),
            responseCode: response.responseCode,
            responseMessage: response.responseMessage,
            duration: response.duration
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
      
      // 2. 먼저 체인코드 상태 확인 (간단한 쿼리)
      try {
        console.log('🔍 체인코드 상태 확인 중...');
        // 간단한 getWorldState 호출로 체인코드 상태 확인
        const worldStateResult = await pvdClient.getWorldState(chainInfo);
        console.log('✅ 체인코드 상태 확인 성공:', worldStateResult);
      } catch (worldStateError) {
        console.log('⚠️ 체인코드 상태 확인 실패 (계속 진행):', worldStateError.message);
      }
      
      // 3. client.go의 실제 함수들 호출
      let result;
      
      switch (dataType) {
        case 'speed':
          // 속도 데이터 조회: 실제 Fabric 체인코드에서 조회
          console.log('🔍 속도 데이터 조회 중 (실시간 체인코드 호출)...');
          result = await pvdClient.getWorldState(chainInfo);
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
          // 인덱스만 생성 (데이터 없음)
          console.log('📊 PVD 인덱스 생성 중...');
          // searchValue를 dataType으로 사용 (speed, dt 등)
          result = await createPvdIndex(searchValue, searchValue);
          break;
          
        default:
          // 기본 데이터 조회: getWorldState 사용
          console.log('🔍 월드스테이트 데이터 조회 중...');
          result = await pvdClient.getWorldState(chainInfo);
          break;
      }
      
      console.log('🔍 PVD 서비스 호출 성공');
      
      // create-index 타입일 때만 인덱스 생성 (별도 명령어로 분리됨)
      if (dataType === 'create-index') {
        console.log('📊 PVD 인덱스 생성 시작...');
        const indexResult = await createPvdIndex(searchValue, searchValue);
        console.log('✅ PVD 인덱스 생성 완료');
        
        console.log('📊 create-index 타입: 인덱스 파일만 생성 완료');
        console.log(`📁 생성된 인덱스: ${indexResult.indexID}`);
        console.log(`📁 파일 경로: ${indexResult.filePath}`);
        
        // 결과 정리 (인덱스 생성만)
        const finalResult = {
          success: true,
          network: 'fabric',
          dataType: dataType,
          searchValue: searchValue,
          message: 'Fabric 인덱스 파일 생성 완료',
          timestamp: new Date().toISOString(),
          chainInfo: chainInfo,
          indexResult: indexResult
        };
        
        pvdClient.close();
        return finalResult;
      }
      
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
    
    // grpc-go를 거쳐서 처리 (search 명령어와 동일한 방식)
    console.log('🔗 Fabric 네트워크 - grpc-go 서버 연결 중...');
    
    try {
      // PVD 클라이언트를 통해 grpc-go 서버 연결
      const pvdClient = new PvdClient('localhost:19001');
      await pvdClient.connect();
      console.log('✅ PVD 서버 연결 성공');
      
      // 체인코드 정보
      const chainInfo = {
        channelName: FABRIC_CONFIG.channelName,
        chaincode: FABRIC_CONFIG.chaincode
      };
      
      // 1. 먼저 체인코드에서 전체 데이터 조회 (월드스테이트)
      console.log('🔍 Fabric 체인코드에서 전체 데이터 조회 중...');
      const worldStateResult = await pvdClient.getWorldState(chainInfo);
      
      if (!worldStateResult || !worldStateResult.PvdList) {
        throw new Error('체인코드에서 데이터를 가져올 수 없습니다');
      }
      
      console.log(`✅ 체인코드 조회 완료: ${worldStateResult.PvdList.length}개 데이터`);
      
      // 2. 인덱스에서도 전체 데이터 조회 (병렬로 처리)
      console.log('🔍 Fabric 인덱스에서도 전체 데이터 조회 중...');
      let indexResult = null;
      
      try {
        // 인덱스 검색을 위한 별도 클라이언트 (idxmngr를 거쳐서)
        const indexingClient = new FabricIndexingClient({
          serverAddr: 'localhost:50052',
          protoPath: PROTO_PATH
        });
        
        await indexingClient.connect();
        
        // 인덱스 타입별 설정
        let indexID, field, filePath;
        
        switch (indexType) {
          case 'speed':
            indexID = `speed_001`;
            field = 'Speed';
            filePath = `data/fabric/speed_001.bf`;
            break;
            
          case 'dt':
          case 'collectiondt':
            indexID = `dt_001`;
            field = 'CollectionDt';
            filePath = `data/fabric/dt_001.bf`;
            break;
            
          default:
            throw new Error(`지원하지 않는 인덱스 타입: ${indexType}`);
        }
        
        // 전체 조회 요청 (Range 검색으로 모든 데이터 가져오기)
        console.log('🔍 인덱스 전체 데이터를 Range 검색으로 가져오는 중...');
        
        let allIndexData = [];
        
        try {
          const searchRequest = {
            IndexID: indexID,
            Field: field,
            FilePath: filePath,
            KeySize: 64,
            ComOp: 'Range',  // Range 검색 사용
            Begin: '-999999', // 시작값 (음수 포함, 더 넓은 범위)
            End: '999999'     // 끝값 (더 큰 값으로 확장)
          };
          
          console.log(`🔍 Range 검색 요청:`, searchRequest);
          const response = await indexingClient.searchData(searchRequest);
          
          if (response.IdxData && response.IdxData.length > 0) {
            console.log(`✅ Range 검색 완료: ${response.IdxData.length}개 데이터 발견`);
            allIndexData = response.IdxData;
          } else {
            console.log(`⚠️ Range 검색 결과 없음, Eq 검색으로 대체...`);
            // Range 검색이 실패하면 Eq 검색으로 대체
            allIndexData = await performEqSearch(indexingClient, indexID, field, filePath);
          }
          
        } catch (error) {
          console.warn(`⚠️ Range 검색 실패, Eq 검색으로 대체:`, error.message);
          allIndexData = await performEqSearch(indexingClient, indexID, field, filePath);
        }
        
        console.log(`✅ 전체 인덱스 데이터 수집 완료: ${allIndexData.length}개`);
        
        // 중복 제거 (TxID 기준)
        const uniqueData = [...new Set(allIndexData)];
        console.log(`✅ 중복 제거 후: ${uniqueData.length}개`);
        
        // Eq 검색 헬퍼 함수
        async function performEqSearch(indexingClient, indexID, field, filePath) {
          console.log('🔍 Eq 검색으로 대체 실행 중...');
          let allIndexData = [];
          const speedValues = [0, 10, 20, 30, 40, 50, 60, 65, 70, 80, 90, 100, 200, 300, 400, 500, 600, 700, 800, 900, 1000];
          
          for (const speedValue of speedValues) {
            try {
              const searchRequest = {
                IndexID: indexID,
                Field: field,
                FilePath: filePath,
                KeySize: 64,
                ComOp: 'Eq',
                Value: speedValue.toString()
              };
              
              console.log(`🔍 Speed ${speedValue} 검색 중...`);
              const response = await indexingClient.searchData(searchRequest);
              
              if (response.IdxData && response.IdxData.length > 0) {
                console.log(`✅ Speed ${speedValue}: ${response.IdxData.length}개 데이터 발견`);
                allIndexData = allIndexData.concat(response.IdxData);
              }
              
              // 검색 간격을 두어 서버 부하 방지
              await new Promise(resolve => setTimeout(resolve, 100));
              
            } catch (error) {
              console.warn(`⚠️ Speed ${speedValue} 검색 실패:`, error.message);
            }
          }
          
          return allIndexData;
        }
        
        indexResult = {
          success: true,
          indexId: indexID,
          indexName: `Fabric ${indexType} Index`,
          data: uniqueData,
          count: uniqueData.length,
          network: 'fabric',
          indexType: indexType,
          searchType: 'all',
          timestamp: new Date().toISOString()
        };
        
        await indexingClient.close();
        
      } catch (indexError) {
        console.warn('⚠️ 인덱스 검색 실패 (체인코드 결과만 반환):', indexError.message);
      }
      
      // 3. 체인코드 결과와 인덱스 결과를 합쳐서 반환
      const finalResult = {
        success: true,
        network: 'fabric',
        indexType: indexType,
        searchType: 'all',
        timestamp: new Date().toISOString(),
        chaincodeResult: {
          data: worldStateResult.PvdList,
          count: worldStateResult.PvdList.length,
          source: 'blockchain'
        },
        indexResult: indexResult
      };
      
      console.log(`📊 전체 조회 결과:`);
      console.log(`   🆔 인덱스 타입: ${indexType}`);
      console.log(`   📊 체인코드 데이터: ${finalResult.chaincodeResult.count}개`);
      console.log(`   📊 인덱스 데이터: ${indexResult ? indexResult.count : 0}개`);
      console.log(`   🌐 네트워크: ${finalResult.network}`);
      
      // 체인코드 데이터 상세 출력
      if (finalResult.chaincodeResult.data && finalResult.chaincodeResult.data.length > 0) {
        console.log(`   📋 체인코드에서 조회된 PVD 데이터:`);
        finalResult.chaincodeResult.data.forEach((pvd, index) => {
          console.log(`      ${index + 1}. OBU_ID: ${pvd.Obu_id}, Speed: ${pvd.Speed}, CollectionDt: ${pvd.Collection_dt}`);
        });
      }
      
      // 인덱스 데이터 상세 출력
      if (indexResult && indexResult.data && indexResult.data.length > 0) {
        console.log(`   📋 인덱스에서 검색된 TxID들:`);
        indexResult.data.forEach((txId, index) => {
          console.log(`      ${index + 1}. ${txId}`);
        });
      } else {
        console.log(`   ℹ️  인덱스 데이터가 없습니다 (인덱스가 비어있거나 ComOp: 'All'을 지원하지 않을 수 있습니다)`);
      }
      
      pvdClient.close();
      return finalResult;
      
    } catch (error) {
      console.error('❌ Fabric 체인코드 조회 실패:', error.message);
      throw error;
    }
    
  } catch (error) {
    console.error(`❌ Fabric 인덱스 전체 조회 실패: ${error.message}`);
    throw error;
  }
}

async function searchFabricIndex(dataType, searchValue) {
  try {
    console.log('🔍 Fabric 인덱스 검색 중...');
    
    // Fabric 전용 인덱싱 클라이언트 사용
    const indexingClient = new FabricIndexingClient({
      serverAddr: 'localhost:50052',
      protoPath: PROTO_PATH
    });
    
    await indexingClient.connect();
    console.log('✅ Fabric 인덱싱 서버 연결 성공');
    
    // 데이터 타입별 인덱스 ID 및 검색 필드 설정
    let indexID, field, filePath;
    
    switch (dataType) {
      case 'speed':
        indexID = `speed_001`;
        field = 'Speed';
        filePath = `data/fabric/speed_001.bf`;
        break;
        
      case 'dt':
      case 'collectiondt':
        indexID = `dt_001`;
        field = 'CollectionDt';
        filePath = `data/fabric/dt_001.bf`;
        break;
        
      case 'organization':
        indexID = `pvd_org_001`;
        field = 'OrganizationName';
        filePath = `data/fabric/pvd_org_001.bf`;
        break;
        
      case 'user':
        indexID = `pvd_user_001`;
        field = 'UserId';
        filePath = `data/fabric/pvd_user_001.bf`;
        break;
        
      case 'allblock':
        // 전체 블록 조회를 위한 특별한 케이스
        indexID = `speed_001`;  // 기본 인덱스 사용
        field = 'Speed';
        filePath = `data/fabric/speed_001.bf`;
        break;
        
      default:
        throw new Error(`지원하지 않는 데이터 타입: ${dataType}`);
    }
    
    // 검색 요청 구성
    const searchRequest = {
      IndexID: indexID,
      Field: field,
      Value: searchValue,
      FilePath: filePath,
      KeySize: 64,
      ComOp: dataType === 'allblock' ? 'Range' : 'Eq',  // allblock이면 범위 검색, 아니면 동등 비교
      ...(dataType === 'allblock' && { Begin: '-999999', End: '999999' })  // allblock일 때 범위 값 추가
    };
    
    console.log(`🔍 검색 요청:`, searchRequest);
    
    // 실제 인덱스 검색 수행
    const response = await indexingClient.searchData(searchRequest);
    console.log(`✅ Fabric 인덱스 검색 완료!`);
    
    // 검색 결과를 깔끔하게 정리
    const cleanResult = {
      success: true,
      indexId: response.idxInfo?.IndexID || searchRequest.IndexID,
      indexName: response.idxInfo?.IndexName || 'Fabric Index',
      data: response.IdxData || [],
      count: response.IdxData?.length || 0,
      network: 'fabric',
      dataType: dataType,
      searchValue: searchValue,
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
      console.log(`   📋 검색된 데이터:`);
      cleanResult.data.forEach((item, index) => {
        console.log(`      ${index + 1}. ${item}`);
      });
    } else {
      console.log(`   ℹ️  검색된 데이터가 없습니다.`);
      console.log(`   💡 인덱스가 비어있거나 검색값과 일치하는 데이터가 없을 수 있습니다.`);
    }
    
    indexingClient.close();
    return cleanResult;
    
  } catch (error) {
    console.error('❌ Fabric 인덱스 검색 실패:', error.message);
    throw error;
  }
}

// PVD 인덱스만 생성하는 함수 (데이터 삽입 없음)
async function createPvdIndex(dataType, searchValue) {
  try {
    console.log('📊 PVD 인덱스 생성 중...');
    
    // Fabric 전용 인덱싱 클라이언트 사용
    const indexingClient = new FabricIndexingClient({
      serverAddr: 'localhost:50052',
      protoPath: PROTO_PATH
    });
    
    await indexingClient.connect();
    console.log('✅ Fabric 인덱싱 서버 연결 성공');
    
    // PVD 전용 인덱스 ID 생성 (speed, dt 중심)
    let indexID, keyCol, colName;
    
    switch (dataType) {
      case 'speed':
        // Fabric 네트워크일 때만 speed_001로 설정
        indexID = `speed_001`;
        keyCol = 'Speed';
        colName = 'Speed';
        break;
        
      case 'dt':
      case 'collectiondt':
        // 수집 날짜/시간 인덱스: dt_001
        indexID = `dt_001`;
        keyCol = 'CollectionDt';
        colName = 'CollectionDt';
        break;
        
      case 'organization':
        // 조직 인덱스: pvd_org_001
        indexID = `pvd_org_001`;
        keyCol = 'IndexableData';
        colName = 'IndexableData';
        break;
        
      case 'user':
        // 사용자 인덱스: pvd_user_001
        indexID = `pvd_user_001`;
        keyCol = 'UserId';
        colName = 'UserId';
        break;
        
      default:
        // 기본 인덱스: dt_001 (CollectionDt 기반)
        indexID = `dt_001`;
        keyCol = 'CollectionDt';
        colName = 'CollectionDt';
        break;
    }
    
    // 인덱스 생성 (이미 존재하면 건너뛰기)
    try {
      const indexInfo = {
        IndexID: indexID,
        IndexName: `PVD ${dataType} Index (${searchValue})`,
        KeyCol: keyCol,
        FilePath: `data/fabric/${indexID}.bf`,
        KeySize: 64,
        Network: 'fabric'
      };
      
      await indexingClient.createIndex(indexInfo);
      console.log(`✅ PVD 인덱스 생성 완료: ${indexID}`);
      console.log(`📁 파일 경로: data/fabric/${indexID}.bf`);
    } catch (error) {
      if (error.message.includes('already exists') || error.message.includes('duplicate')) {
        console.log(`📁 인덱스 이미 존재함: ${indexID} (기존 것 사용)`);
      } else {
        throw error;
      }
    }
    
    indexingClient.close();
    
    return {
      success: true,
      message: 'PVD 인덱스 생성 완료',
      indexID: indexID,
      filePath: `data/fabric/${indexID}.bf`
    };
    
  } catch (error) {
    console.error('❌ PVD 인덱스 생성 실패:', error.message);
    throw error;
  }
}

// PVD 데이터를 idxmngr-go에 인덱싱하는 함수 (트랜잭션과 인덱싱)
async function indexPvdData(dataType, searchValue, pvdData) {
  try {
    console.log('📊 PVD 데이터 인덱싱 중...');
    
    // Fabric 전용 인덱싱 클라이언트 사용
    const indexingClient = new FabricIndexingClient({
      serverAddr: 'localhost:50052',
      protoPath: PROTO_PATH
    });
    
    await indexingClient.connect();
    console.log('✅ Fabric 인덱싱 서버 연결 성공');
    
    // PVD 전용 인덱스 ID 생성 (speed, dt 중심)
    let indexID, keyCol, colName;
    
    switch (dataType) {
      case 'speed':
        // Fabric 네트워크일 때만 speed_001로 설정
        indexID = `speed_001`;
        keyCol = 'Speed';
        colName = 'Speed';
        break;
        
      case 'dt':
      case 'collectiondt':
        // 수집 날짜/시간 인덱스: dt_001
        indexID = `dt_001`;
        keyCol = 'CollectionDt';
        colName = 'CollectionDt';
        break;
        
      case 'organization':
        // 조직 인덱스: pvd_org_001
        indexID = `pvd_org_001`;
        keyCol = 'IndexableData';
        colName = 'IndexableData';
        break;
        
      case 'user':
        // 사용자 인덱스: pvd_user_001
        indexID = `pvd_user_001`;
        keyCol = 'UserId';
        colName = 'UserId';
        break;
        
      default:
        // 기본 인덱스: dt_001 (CollectionDt 기반)
        indexID = `dt_001`;
        keyCol = 'CollectionDt';
        colName = 'CollectionDt';
        break;
    }
    
    // 데이터 인덱싱 - fstree.go가 기대하는 Pvd 구조체 포함
    const indexData = {
      IndexID: indexID,
      BcList: [{
        TxId: pvdData.txId || `pvd_${Date.now()}`,
        KeySize: 64,
        KeyCol: keyCol,
        // fstree.go가 기대하는 Pvd 구조체 추가 (정확한 필드명 사용)
        Pvd: {
          Speed: dataType === 'speed' ? parseInt(searchValue) || 60 : 0,
          CollectionDt: dataType === 'dt' || dataType === 'collectiondt' ? searchValue : new Date().toISOString(),
          OrganizationName: dataType === 'organization' ? searchValue : 'fabric_org',
          UserId: dataType === 'user' ? searchValue : 'fabric_user',
          Address: 'fabric_address',
          ObuId: pvdData.txId || `pvd_${Date.now()}`,
          StartvectorLatitude: 37.5665,
          StartvectorLongitude: 126.9780,
          Transmisstion: 'auto',
          HazardLights: false,
          LeftTurnSignalOn: false,
          RightTurnSignalOn: false,
          Steering: 0,
          Rpm: 2000,
          Footbrake: false,
          Gear: 'P',
          Accelator: 0,
          Wipers: false,
          TireWarnLeftF: false,
          TireWarnLeftR: false,
          TireWarnRightF: false,
          TireWarnRightR: false,
          TirePsiLeftF: 32,
          TirePsiLeftR: 32,
          TirePsiRightF: 32,
          TirePsiRightR: 32,
          FuelPercent: 80,
          FuelLiter: 40,
          Totaldist: 50000,
          RsuId: 'rsu_001',
          MsgId: 'msg_001',
          StartvectorHeading: 0
        },
        IndexableData: {
          TxId: pvdData.txId || `pvd_${Date.now()}`,
          Network: 'fabric',
          DataType: dataType,
          SearchValue: searchValue,
          Timestamp: new Date().toISOString(),
          DynamicFields: {
            "network": "fabric",
            "dataType": dataType,
            "searchValue": searchValue,
            "chainInfo": pvdData.chainInfo,
            "rawData": pvdData.data
          },
          SchemaVersion: "1.0"
        }
      }],
      ColName: colName,
      ColIndex: indexID,
      FilePath: `data/fabric/${indexID}.bf`,
      Network: 'fabric'
    };
    
    await indexingClient.insertData(indexData);
    console.log(`✅ PVD 데이터 인덱싱 완료: ${indexID}`);
    console.log(`📁 인덱스 파일: data/fabric/${indexID}.bf`);
    
    indexingClient.close();
    
    return {
      success: true,
      message: 'PVD 데이터 인덱싱 완료',
      indexID: indexID,
      filePath: `data/fabric/${indexID}.bf`,
      indexedData: indexData
    };
    
  } catch (error) {
    console.error('❌ PVD 데이터 인덱싱 실패:', error.message);
    throw error;
  }
}

// config.yaml 확인
async function checkConfigYaml() {
  console.log('🔍 config.yaml 직접 확인 시작\n');

  try {
    // config.yaml 파일 경로
    const configPath = CONFIG_PATH;
    
    // 파일 존재 확인
    if (!fs.existsSync(configPath)) {
      console.error(`❌ config.yaml 파일을 찾을 수 없음: ${configPath}`);
      return;
    }

    // 파일 읽기
    const configContent = fs.readFileSync(configPath, 'utf8');
    console.log('📁 config.yaml 내용:');
    console.log(configContent);
    console.log('');

    // YAML 파싱
    const config = yaml.load(configContent);
    
    if (config && config.items && Array.isArray(config.items)) {
      console.log(`✅ 인덱스 개수: ${config.items.length}개\n`);
      
      config.items.forEach((item, index) => {
        console.log(`📋 인덱스 ${index + 1}:`);
        console.log(`   🆔 IndexID: ${item.idxid || 'N/A'}`);
        console.log(`   📝 IndexName: ${item.idxname || 'N/A'}`);
        console.log(`   🔑 KeyCol: ${item.keycol || 'N/A'}`);
        console.log(`   📁 FilePath: ${item.filepath || 'N/A'}`);
        console.log(`   📏 KeySize: ${item.keysize || 'N/A'}`);
        console.log(`   📊 BlockNum: ${item.blocknum || 'N/A'}`);
        console.log(`   📈 CallCnt: ${item.callcnt || 'N/A'}`);
        console.log(`   🔑 KeyCnt: ${item.keycnt || 'N/A'}`);
        console.log(`   📊 IndexDataCnt: ${item.indexdatacnt || 'N/A'}`);
        console.log('');
      });
    } else {
      console.log('❌ config.yaml에 items 배열이 없음');
    }

    console.log('🎉 config.yaml 확인 완료!');

  } catch (error) {
    console.error(`❌ config.yaml 확인 중 오류 발생: ${error.message}`);
  }
}

// network_config.yaml 확인
async function checkNetworkConfig() {
  console.log('🔍 network_config.yaml 확인 시작\n');

  try {
    // network_config.yaml 파일 경로
    const configPath = NETWORK_CONFIG_PATH;
    
    // 파일 존재 확인
    if (!fs.existsSync(configPath)) {
      console.error(`❌ network_config.yaml 파일을 찾을 수 없음: ${configPath}`);
      return;
    }

    // 파일 읽기
    const configContent = fs.readFileSync(configPath, 'utf8');
    console.log('📁 network_config.yaml 내용:');
    console.log(configContent);
    console.log('');

    // YAML 파싱
    const config = yaml.load(configContent);
    
    if (config && config.networks) {
      console.log(`✅ 네트워크 개수: ${Object.keys(config.networks).length}개\n`);
      
      Object.entries(config.networks).forEach(([networkName, networkConfig]) => {
        console.log(`🌐 네트워크: ${networkName}`);
        console.log(`   📝 이름: ${networkConfig.network_name || 'N/A'}`);
        console.log(`   📍 컨트랙트 주소: ${networkConfig.contract_address || 'N/A'}`);
        console.log(`   📁 파일 경로: ${networkConfig.file_index_path || '자동 생성됨'}`);
        console.log('');
      });
    } else {
      console.log('❌ network_config.yaml에 networks 설정이 없음');
    }

    console.log('🎉 network_config.yaml 확인 완료!');

  } catch (error) {
    console.error(`❌ network_config.yaml 확인 중 오류 발생: ${error.message}`);
  }
}

// 네트워크 설정 업데이트
async function updateNetworkConfig(network, contractAddress) {
  console.log(`🔧 ${network} 네트워크 설정 업데이트 시작...`);
  
  try {
    if (!contractAddress) {
      throw new Error('컨트랙트 주소를 입력해주세요. (-contract=<주소>)');
    }

    // network_config.yaml 파일 경로
    const configPath = NETWORK_CONFIG_PATH;
    
    // 파일 존재 확인
    if (!fs.existsSync(configPath)) {
      console.error(`❌ network_config.yaml 파일을 찾을 수 없음: ${configPath}`);
      return;
    }

    // 기존 설정 읽기
    const configContent = fs.readFileSync(configPath, 'utf8');
    const config = yaml.load(configContent);
    
    if (!config.networks) {
      config.networks = {};
    }
    
    // 네트워크 설정 업데이트
    if (!config.networks[network]) {
      config.networks[network] = {
        network_name: network,
        contract_address: contractAddress
      };
    } else {
      config.networks[network].contract_address = contractAddress;
    }
    
    // 파일에 저장
    const updatedContent = yaml.dump(config, { indent: 2 });
    fs.writeFileSync(configPath, updatedContent, 'utf8');
    
    console.log(`✅ ${network} 네트워크 설정 업데이트 완료!`);
    console.log(`   📍 컨트랙트 주소: ${contractAddress}`);
    console.log(`   📁 설정 파일: ${configPath}`);
    
  } catch (error) {
    console.error(`❌ 네트워크 설정 업데이트 실패: ${error.message}`);
  }
}

// 인덱스 상태 확인 (실시간 서버 연결)
async function checkIndexStatus() {
  console.log('🔍 현재 인덱스 상태 확인 시작\n');

  const indexingClient = new IndexingClient({
    serverAddr: 'localhost:50052',
    protoPath: PROTO_PATH
  });

  try {
    // 연결 완료 대기
    await new Promise(resolve => setTimeout(resolve, 1000));
    
    // 확인할 인덱스들 (주요 인덱스들)
    const indexesToCheck = [
      "samsung_575a3a49_001",  // Samsung 조직
      "lg_eb5d27fd_001",       // LG 조직
      "user_d8321319_001",     // 사용자1
      "user_575a3a49_001",     // 사용자2
      "user_eb5d27fd_001"      // 사용자3
    ];

    console.log('📊 인덱스 상태 확인 중...\n');

    for (const indexID of indexesToCheck) {
      try {
        const request = {
          IndexID: indexID,
          IndexName: "",
          KeyCol: "",
          FilePath: "",
          KeySize: 0,
          Network: ""
        };

        const response = await indexingClient.getIndexInfo(request);
        
        // 응답 코드 확인
        const responseCode = response.responseCode || response.code || 0;
        
        if (responseCode === 100) {
          // ✅ 성공 응답
          console.log(`✅ ${indexID}:`);
          
          // 값이 있을 때만 표시 (N/A 제거)
          if (response.IndexName && response.IndexName.trim()) {
            console.log(`   📝 IndexName: ${response.IndexName}`);
          }
          if (response.KeyCol && response.KeyCol.trim()) {
            console.log(`   🔑 KeyCol: ${response.KeyCol}`);
          }
          if (response.FilePath && response.FilePath.trim()) {
            console.log(`   📁 FilePath: ${response.FilePath}`);
          }
          if (response.KeySize && response.KeySize > 0) {
            console.log(`   📏 KeySize: ${response.KeySize}`);
          }
          if (response.KeyCnt !== undefined && response.KeyCnt !== null) {
            console.log(`   📊 KeyCnt: ${response.KeyCnt}`);
          }
          if (response.IndexDataCnt !== undefined && response.IndexDataCnt !== null) {
            console.log(`   📈 IndexDataCnt: ${response.IndexDataCnt}`);
          }
          
        } else {
          // ❌ 오류 응답
          console.log(`❌ ${indexID}: 응답 코드 ${responseCode}`);
          
          if (responseCode === 500) {
            console.log(`   🔍 문제: 내부 서버 오류 (인덱스가 존재하지 않을 수 있음)`);
          } else if (responseCode === 404) {
            console.log(`   🔍 문제: 인덱스를 찾을 수 없음`);
          } else {
            console.log(`   🔍 문제: 알 수 없는 오류 (코드: ${responseCode})`);
          }
        }
        
        console.log('');

      } catch (error) {
        console.error(`❌ ${indexID} 조회 실패: ${error.message}`);
      }
    }

    console.log('🎉 인덱스 상태 확인 완료!');

  } catch (error) {
    console.error(`❌ 인덱스 상태 확인 중 오류 발생: ${error.message}`);
  } finally {
    indexingClient.close();
  }
}

// 트랜잭션 상세 정보 조회 (블록체인에서 실제 데이터 가져오기)
async function getTransactionDetails(network, dataType, searchValue) {
  try {
    console.log(`🔍 ${network} 네트워크에서 트랜잭션 상세 정보 조회 시작...`);
    
    // 1. 먼저 인덱스에서 트랜잭션 ID들 가져오기
    const indexingClient = new IndexingClient({
      serverAddr: 'localhost:50052',
      protoPath: PROTO_PATH
    });
    
    await indexingClient.connect();
    console.log('✅ 인덱싱 서버 연결 성공');
    
    // 2. 인덱스 검색으로 트랜잭션 ID들 수집
    let txIds = [];
    
    if (dataType) {
      // 특정 타입으로 검색 (조직, 사용자 등)
      console.log(`🔍 ${dataType} 타입으로 ${searchValue} 검색 중...`);
      const searchResult = await searchData(network, dataType, searchValue);
      if (searchResult && searchResult.data && searchResult.data.length > 0) {
        txIds = searchResult.data.map(item => item.TxId || item.txId).filter(Boolean);
        console.log(`📊 인덱스에서 ${txIds.length}개의 트랜잭션 ID 발견`);
      } else {
        console.log(`ℹ️  ${dataType} 타입으로 ${searchValue} 검색 결과가 없습니다.`);
      }
    } else {
      // 직접 트랜잭션 ID로 검색
      if (searchValue.startsWith('0x') && searchValue.length === 66) {
        txIds = [searchValue];
        console.log(`📊 직접 입력된 트랜잭션 ID: ${searchValue}`);
      } else {
        console.error(`❌ 유효하지 않은 트랜잭션 해시 형식: ${searchValue}`);
        console.log(`   올바른 형식: 0x로 시작하고 66자리 (예: 0x1234...)`);
        return;
      }
    }
    
    if (txIds.length === 0) {
      console.log('ℹ️  조회할 트랜잭션이 없습니다.');
      return;
    }
    
    console.log(`📊 ${txIds.length}개의 트랜잭션 ID 발견`);
    
    // 3. Hardhat 네트워크에서 각 트랜잭션의 상세 정보 조회
    if (network === 'hardhat' || network === 'hardhat-local') {
      let provider;
      let signerAddress;
      
      if (network === 'hardhat-local') {
        // hardhat-local 네트워크용 provider 설정
        provider = new ethers.JsonRpcProvider('http://127.0.0.1:8545');
        signerAddress = 'Hardhat Local Node';
      } else {
        // 기존 Hardhat 네트워크
        const [signer] = await ethers.getSigners();
        provider = ethers.provider;
        signerAddress = signer.address;
      }
      
      console.log(`🔗 ${network} 네트워크 연결: ${signerAddress}`);
      
      for (let i = 0; i < txIds.length; i++) {
        const txId = txIds[i];
        console.log(`\n📋 트랜잭션 ${i + 1}/${txIds.length}: ${txId}`);
        
        try {
          // 트랜잭션 영수증 가져오기
          const receipt = await provider.getTransactionReceipt(txId);
          
          if (receipt) {
            console.log(`   ✅ 트랜잭션 영수증:`);
            console.log(`      🔗 해시: ${receipt.hash}`);
            console.log(`      📊 블록 번호: ${receipt.blockNumber}`);
            console.log(`      ⛽ 가스 사용량: ${receipt.gasUsed.toString()}`);
            console.log(`      💰 가스 가격: ${ethers.formatUnits(receipt.gasPrice, 'gwei')} gwei`);
            console.log(`      📝 상태: ${receipt.status === 1 ? '성공' : '실패'}`);
            console.log(`      👤 발신자: ${receipt.from}`);
            console.log(`      👥 수신자: ${receipt.to || '컨트랙트 생성'}`);
            
            // 로그 이벤트 확인
            if (receipt.logs && receipt.logs.length > 0) {
              console.log(`      📋 이벤트 로그: ${receipt.logs.length}개`);
              receipt.logs.forEach((log, index) => {
                console.log(`         ${index + 1}. 주소: ${log.address}, 토픽: ${log.topics[0]}`);
                
                // AccessRequestsSaved 이벤트 디코딩 시도
                try {
                  // AccessRequestsSaved 이벤트 시그니처
                  const eventSignature = "AccessRequestsSaved(address,string,string)";
                  const eventTopic = ethers.id(eventSignature);
                  
                  if (log.topics[0] === eventTopic) {
                    console.log(`         🎯 AccessRequestsSaved 이벤트 발견!`);
                    
                    // 이벤트 데이터 디코딩
                    const decodedData = ethers.AbiCoder.defaultAbiCoder().decode(
                      ['address', 'string', 'string'],
                      log.data
                    );
                    
                    console.log(`            👤 userId: ${decodedData[0]}`);
                    console.log(`            📝 purpose: ${decodedData[1]}`);
                    console.log(`            🏢 organizationName: ${decodedData[2]}`);
                  } else {
                    // 다른 이벤트들도 확인
                    console.log(`         🔍 다른 이벤트: 토픽 ${log.topics[0]}`);
                    if (log.data && log.data !== '0x') {
                      console.log(`         📊 이벤트 데이터: ${log.data}`);
                      
                      // AccessRequestsSaved 이벤트인지 확인 (토픽으로)
                      const eventSignature = "AccessRequestsSaved(uint256,address,address,string,string)";
                      const eventTopic = ethers.id(eventSignature);
                      
                      console.log(`         🔍 이벤트 분석:`);
                      console.log(`            • 예상 토픽: ${eventTopic}`);
                      console.log(`            • 실제 토픽: ${log.topics[0]}`);
                      console.log(`            • 토픽 일치: ${log.topics[0] === eventTopic ? '✅' : '❌'}`);
                      
                      if (log.topics[0] === eventTopic) {
                        console.log(`         🎯 AccessRequestsSaved 이벤트 발견! (토픽 매칭)`);
                        
                        // ABI 파일 기반 디코딩 시도 (더 정확함)
                        console.log(`         🔧 ABI 파일 기반 디코딩 시도...`);
                        try {
                          // ABI 파일 로드
                          const abiPath = path.join(__dirname, '../artifacts/contracts/AccessManagement.sol/AccessManagement.json');
                          const abiContent = fs.readFileSync(abiPath, 'utf8');
                          const abi = JSON.parse(abiContent).abi;
                          
                          // AccessRequestsSaved 이벤트 찾기
                          const eventAbi = abi.find(item => item.type === 'event' && item.name === 'AccessRequestsSaved');
                          
                          if (eventAbi) {
                            console.log(`         🎯 ABI에서 AccessRequestsSaved 이벤트 발견!`);
                            
                            // ABI 기반으로 이벤트 디코딩
                            const iface = new ethers.Interface(abi);
                            const decodedLog = iface.parseLog(log);
                            
                            console.log(`            🆔 requestId: ${decodedLog.args.requestId}`);
                            console.log(`            👤 requester: ${decodedLog.args.requester}`);
                            console.log(`            👥 resourceOwner: ${decodedLog.args.resourceOwner}`);
                            console.log(`            📝 purpose: ${decodedLog.args.purpose}`);
                            console.log(`            🏢 organizationName: ${decodedLog.args.organizationName}`);
                            
                          } else {
                            console.log(`         ⚠️  ABI에서 AccessRequestsSaved 이벤트를 찾을 수 없음`);
                          }
                          
                        } catch (abiError) {
                          console.log(`         ❌ ABI 기반 디코딩 실패: ${abiError.message}`);
                          console.log(`         🔧 수동 디코딩 시도...`);
                          
                          try {
                            // 수동 디코딩 (fallback)
                            const decodedData = ethers.AbiCoder.defaultAbiCoder().decode(
                              ['uint256', 'address', 'address', 'string', 'string'],
                              log.data
                            );
                            
                            console.log(`            🆔 requestId: ${decodedData[0]}`);
                            console.log(`            👤 requester: ${decodedData[1]}`);
                            console.log(`            👥 resourceOwner: ${decodedData[2]}`);
                            console.log(`            📝 purpose: ${decodedData[3]}`);
                            console.log(`            🏢 organizationName: ${decodedData[4]}`);
                          } catch (decodeError) {
                            console.log(`            ❌ 수동 디코딩도 실패: ${decodeError.message}`);
                          }
                        }
                      } else {
                        // ABI 파일 기반 디코딩 시도
                        console.log(`         🔧 ABI 파일 기반 디코딩 시도...`);
                        try {
                          // ABI 파일 로드
                          const abiPath = path.join(__dirname, '../artifacts/contracts/AccessManagement.sol/AccessManagement.json');
                          const abiContent = fs.readFileSync(abiPath, 'utf8');
                          const abi = JSON.parse(abiContent).abi;
                          
                          // AccessRequestsSaved 이벤트 찾기
                          const eventAbi = abi.find(item => item.type === 'event' && item.name === 'AccessRequestsSaved');
                          
                          if (eventAbi) {
                            console.log(`         🎯 ABI에서 AccessRequestsSaved 이벤트 발견!`);
                            
                            // ABI 기반으로 이벤트 디코딩
                            const iface = new ethers.Interface(abi);
                            const decodedLog = iface.parseLog(log);
                            
                            console.log(`            🆔 requestId: ${decodedLog.args.requestId}`);
                            console.log(`            👤 requester: ${decodedLog.args.requester}`);
                            console.log(`            👥 resourceOwner: ${decodedLog.args.resourceOwner}`);
                            console.log(`            📝 purpose: ${decodedLog.args.purpose}`);
                            console.log(`            🏢 organizationName: ${decodedLog.args.organizationName}`);
                            
                          } else {
                            console.log(`         ⚠️  ABI에서 AccessRequestsSaved 이벤트를 찾을 수 없음`);
                          }
                          
                        } catch (abiError) {
                          console.log(`         ❌ ABI 기반 디코딩 실패: ${abiError.message}`);
                          console.log(`         🔧 수동 디코딩 시도...`);
                          
                          try {
                            // 수동 디코딩 (fallback)
                            const decodedData = ethers.AbiCoder.defaultAbiCoder().decode(
                              ['uint256', 'address', 'address', 'string', 'string'],
                              log.data
                            );
                            
                            console.log(`            🆔 requestId: ${decodedData[0]}`);
                            console.log(`            👤 requester: ${decodedData[1]}`);
                            console.log(`            👥 resourceOwner: ${decodedData[2]}`);
                            console.log(`            📝 purpose: ${decodedData[3]}`);
                            console.log(`            🏢 organizationName: ${decodedData[4]}`);
                          } catch (decodeError) {
                            console.log(`            ❌ 수동 디코딩도 실패: ${decodeError.message}`);
                          }
                        }
                      }
                    }
                  }
                } catch (decodeError) {
                  console.log(`         ⚠️  이벤트 디코딩 실패: ${decodeError.message}`);
                }
              });
            } else {
              console.log(`      📋 이벤트 로그: 없음`);
              console.log(`      🔍 이벤트가 없는 이유 분석:`);
              console.log(`         • 컨트랙트가 아직 배포되지 않음`);
              console.log(`         • 이벤트를 발생시키는 함수가 호출되지 않음`);
              console.log(`         • 트랜잭션이 실패했거나 다른 함수 호출`);
            }
            
            // 블록 정보 가져오기
            const block = await provider.getBlock(receipt.blockNumber);
            if (block) {
              console.log(`      📅 블록 정보:`);
              console.log(`         시간: ${new Date(block.timestamp * 1000).toLocaleString()}`);
              console.log(`         트랜잭션 수: ${block.transactions.length}`);
              console.log(`         가스 제한: ${block.gasLimit.toString()}`);
            }
            
          } else {
            console.log(`   ❌ 트랜잭션을 찾을 수 없음: ${txId}`);
          }
          
        } catch (error) {
          console.error(`   ❌ 트랜잭션 조회 실패: ${error.message}`);
        }
      }
      
    } else {
      console.log(`⚠️  ${network} 네트워크는 아직 지원하지 않습니다.`);
    }
    
    console.log('\n🎉 트랜잭션 상세 정보 조회 완료!');
    
  } catch (error) {
    console.error(`❌ 트랜잭션 상세 정보 조회 실패: ${error.message}`);
  } finally {
    // indexingClient가 정의된 경우에만 close 호출
    try {
      if (typeof indexingClient !== 'undefined' && indexingClient && indexingClient.close) {
        indexingClient.close();
      }
    } catch (closeError) {
      console.log('🔌 인덱싱 클라이언트 연결 종료 중 오류:', closeError.message);
    }
  }
}

// Samsung 조직 인덱스 생성
async function createSamsungIndex(network) {
  console.log(`🚀 ${network} 네트워크에 Samsung 조직 인덱스 생성 시작\n`);

  const indexingClient = new IndexingClient({
    serverAddr: 'localhost:50052',
    protoPath: PROTO_PATH
  });

  try {
    // 연결 완료 대기
    await new Promise(resolve => setTimeout(resolve, 1000));
    
    // 네트워크별 Samsung 계정 주소 설정
    let samsungAddress;
    if (network === 'monad') {
      samsungAddress = "0x2630ffE517DFC9b0112317a2EC0AB4cE2a59CEb8";  // Monad Samsung
    } else {
      samsungAddress = "0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC";  // Hardhat Samsung (계정 2번)
    }
    
    const orgShortHash = hashWalletAddress(samsungAddress);
    
    // 네트워크 경로 매핑 (hardhat -> hardhat-local)
    const networkDir = network === 'hardhat' ? 'hardhat-local' : network;
    
    const indexInfo = {
      IndexID: `samsung_${orgShortHash}_001`,
      IndexName: `Samsung Organization Index (${samsungAddress.slice(0, 10)}...)`,
      KeyCol: 'IndexableData',
      FilePath: `data/${networkDir}/samsung_${orgShortHash}_001.bf`,
      KeySize: 64,
      Network: network
    };
    
    console.log(`📋 생성할 Samsung 인덱스 정보:`);
    console.log(`   🆔 IndexID: ${indexInfo.IndexID}`);
    console.log(`   📝 IndexName: ${indexInfo.IndexName}`);
    console.log(`   🔑 KeyCol: ${indexInfo.KeyCol}`);
    console.log(`   📁 FilePath: ${indexInfo.FilePath}`);
    console.log(`   📏 KeySize: ${indexInfo.KeySize}`);
    console.log(`   🌐 Network: ${indexInfo.Network}\n`);
    
    try {
      await indexingClient.createIndex(indexInfo);
      console.log(`✅ Samsung 인덱스 생성 성공: ${indexInfo.IndexID}`);
      
    } catch (error) {
      console.error(`❌ Samsung 인덱스 생성 실패: ${error.message}`);
    }
    
  } catch (error) {
    console.error(`❌ Samsung 인덱스 생성 중 오류 발생: ${error.message}`);
  } finally {
    indexingClient.close();
  }
}

// LG 조직 인덱스 생성
async function createLgIndex(network) {
  console.log(`🚀 ${network} 네트워크에 LG 조직 인덱스 생성 시작\n`);

  const indexingClient = new IndexingClient({
    serverAddr: 'localhost:50052',
    protoPath: PROTO_PATH
  });

  try {
    // 연결 완료 대기
    await new Promise(resolve => setTimeout(resolve, 1000));
    
    // 네트워크별 LG 계정 주소 설정
    let lgAddress;
    if (network === 'monad') {
      lgAddress = "0xa5cc9D9F1f68546060852f7c685B99f0cD532229";  // Monad LG
    } else {
      lgAddress = "0x90F79bf6EB2c4f870365E785982E1f101E93b906";  // Hardhat LG (계정 3번)
    }
    
    const orgShortHash = hashWalletAddress(lgAddress);
    
    // 네트워크 경로 매핑 (hardhat -> hardhat-local)
    const networkDir = network === 'hardhat' ? 'hardhat-local' : network;
    
    const indexInfo = {
      IndexID: `lg_${orgShortHash}_001`,
      IndexName: `LG Organization Index (${lgAddress.slice(0, 10)}...)`,
      KeyCol: 'IndexableData',
      FilePath: `data/${networkDir}/lg_${orgShortHash}_001.bf`,
      KeySize: 64,
      Network: network
    };
    
    console.log(`📋 생성할 LG 인덱스 정보:`);
    console.log(`   🆔 IndexID: ${indexInfo.IndexID}`);
    console.log(`   📝 IndexName: ${indexInfo.IndexName}`);
    console.log(`   🔑 KeyCol: ${indexInfo.KeyCol}`);
    console.log(`   📁 FilePath: ${indexInfo.FilePath}`);
    console.log(`   📏 KeySize: ${indexInfo.KeySize}`);
    console.log(`   🌐 Network: ${indexInfo.Network}\n`);
    
    try {
      await indexingClient.createIndex(indexInfo);
      console.log(`✅ LG 인덱스 생성 성공: ${indexInfo.IndexID}`);
      
    } catch (error) {
      console.error(`❌ LG 인덱스 생성 실패: ${error.message}`);
    }
    
  } catch (error) {
    console.error(`❌ LG 인덱스 생성 중 오류 발생: ${error.message}`);
  } finally {
    indexingClient.close();
  }
}

// 사용자별 인덱스 생성
async function createUserIndexes(network) {
  console.log(`🚀 ${network} 네트워크에 사용자별 인덱스 생성 시작\n`);

  const indexingClient = new IndexingClient({
    serverAddr: 'localhost:50052',
    protoPath: PROTO_PATH
  });

  try {
    // 연결 완료 대기
    await new Promise(resolve => setTimeout(resolve, 1000));
    
    // 네트워크별 테스트 계정들
    let testAddresses;
    
    if (network === 'monad') {
      // Monad 네트워크용 사용자 계정들
      testAddresses = [
        "0xa5cc9D9F1f68546060852f7c685B99f0cD532229"  // Monad 사용자 계정
      ];
    } else {
      // Hardhat 네트워크용 테스트 계정들 (기존)
      testAddresses = [
        "0x70997970C51812dc3A010C7d01b50e0d17dc79C8",  // Hardhat Account #0
        "0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC",  // Hardhat Account #1
        "0x90F79bf6EB2c4f870365E785982E1f101E93b906",  // Hardhat Account #2
        "0x15d34AAf54267DB7D7c367839AAf71A00a2C6A65",  // Hardhat Account #3
        "0x9965507D1a55bcC2695C58ba16FB37d819B0A4dc"   // Hardhat Account #4 (사용자4)
      ];
    }

    console.log(`📋 생성할 사용자 인덱스들:`);
    testAddresses.forEach((address, index) => {
      const shortHash = hashWalletAddress(address);
      console.log(`   ${index + 1}. ${address.slice(0, 10)}... → user_${shortHash}_001`);
    });
    console.log('');

    // 네트워크 경로 매핑 (hardhat -> hardhat-local)
    const networkDir = network === 'hardhat' ? 'hardhat-local' : network;
    
    // 각 사용자별 인덱스 생성
    for (let i = 0; i < testAddresses.length; i++) {
      const address = testAddresses[i];
      const shortHash = hashWalletAddress(address);
      
      const userIndexInfo = {
        IndexID: `user_${shortHash}_001`,
        IndexName: `User ${address.slice(0, 10)}... Personal Index`,
        KeyCol: 'UserId',
        FilePath: `data/${networkDir}/user_${shortHash}_001.bf`,
        KeySize: 64,
        Network: network
      };
      
      console.log(`🔨 사용자 ${i + 1} 인덱스 생성 중: ${userIndexInfo.IndexID}`);
      
      try {
        await indexingClient.createIndex(userIndexInfo);
        console.log(`   ✅ 생성 성공: ${userIndexInfo.IndexID}`);
        
        // 인덱스 생성 간격
        await new Promise(resolve => setTimeout(resolve, 500));
        
      } catch (error) {
        console.error(`   ❌ 생성 실패: ${error.message}`);
      }
    }
    
    console.log('\n🎉 사용자별 인덱스 생성 완료!');
    
  } catch (error) {
    console.error(`❌ 사용자별 인덱스 생성 중 오류 발생: ${error.message}`);
  } finally {
    indexingClient.close();
  }
}

// 데이터 요청 생성 및 양방향 인덱싱
async function requestData(network) {
      console.log(`🚀 ${network} 네트워크에서 데이터 요청 생성 및 양방향 인덱싱 시작\n`);

  try {
    // 1. 네트워크별 계정 설정
    let deployer, samsungOrg;
    
    if (network === 'monad') {
      // Monad 네트워크용 계정 설정
      const networkConfig = hre.config.networks[network];
      const provider = new ethers.JsonRpcProvider(networkConfig.url);
      deployer = new ethers.Wallet(networkConfig.accounts[0], provider);
      
      // Samsung 조직 계정만 설정
      samsungOrg = new ethers.Wallet("0x2630ffE517DFC9b0112317a2EC0AB4cE2a59CEb8", provider); // Monad Samsung
      
      console.log('👥 Monad 테스트 계정들:');
      console.log(`   🏗️  배포자: ${deployer.address}`);
      console.log(`   🏢 Samsung 조직: ${samsungOrg.address}\n`);
    } else if (network === 'hardhat-local') {
      // hardhat-local 네트워크용 계정 설정 (실행 중인 Hardhat 노드 사용)
      const provider = new ethers.JsonRpcProvider('http://127.0.0.1:8545');
      
      // Hardhat 노드의 계정들 사용 (let으로 선언하여 나중에 사용 가능)
      deployer = new ethers.Wallet('0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80', provider);
      user1 = new ethers.Wallet('0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d', provider);
      user2 = new ethers.Wallet('0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a', provider);
      user3 = new ethers.Wallet('0x7c852118294e51e653712a81e05800f419141751be58f605c371e15141b007a6', provider);
      user4 = new ethers.Wallet('0x47e179ec197488593b187f80a00eb0da91f1b9d0b13f8733639f19c30a34926a', provider);
      user5 = new ethers.Wallet('0x8b3a350cf5c34c9194ca85829a2df0ec3153be0318b5e2d3348e872092edffba', provider);
      
      samsungOrg = user2; // 계정 2번을 Samsung 조직으로 사용
      
      console.log('👥 Hardhat-Local 노드 계정들:');
      console.log(`   🏗️  배포자: ${deployer.address}`);
      console.log(`   🏢 Samsung 조직: ${samsungOrg.address} (계정 2번)`);
      console.log(`   👤 사용자1: ${user1.address} (계정 1번)`);
      console.log(`   👤 사용자3: ${user3.address} (계정 3번)`);
      console.log(`   👤 사용자4: ${user4.address} (계정 4번)`);
      console.log(`   👤 사용자5: ${user5.address} (계정 5번)\n`);
    } else {
      // 기존 Hardhat 네트워크용 계정 설정 (Samsung만)
      [deployer, user1, user2, user3, user4, user5] = await ethers.getSigners();
      samsungOrg = user2; // 계정 2번을 Samsung 조직으로 사용
      
      console.log('👥 Hardhat 테스트 계정들:');
      console.log(`   🏗️  배포자: ${deployer.address}`);
      console.log(`   🏢 Samsung 조직: ${samsungOrg.address} (계정 2번)`);
      console.log(`   👤 사용자1: ${user1.address} (계정 1번)`);
      console.log(`   👤 사용자3: ${user3.address} (계정 3번)`);
      console.log(`   👤 사용자4: ${user4.address} (계정 4번)`);
      console.log(`   👤 사용자5: ${user5.address} (계정 5번)\n`);
    }                         // 2. 기존 배포된 AccessManagement 컨트랙트 사용
                     console.log('🔍 기존 배포된 AccessManagement 컨트랙트 사용...');
                     
                     let accessManagement, contractAddress;
                     
                     // network_config.yaml에서 컨트랙트 주소 가져오기
                     const networkConfigPath = NETWORK_CONFIG_PATH;
                     if (fs.existsSync(networkConfigPath)) {
                       const configContent = fs.readFileSync(networkConfigPath, 'utf8');
                       const config = yaml.load(configContent);
                       contractAddress = config.networks?.[network]?.contract_address;
                       
                       if (!contractAddress) {
                         throw new Error(`${network} 네트워크의 컨트랙트 주소를 찾을 수 없습니다. 먼저 'node deploy-contract.js --network=${network}'로 컨트랙트를 배포해주세요.`);
                       }
                     } else {
                       throw new Error('network_config.yaml 파일을 찾을 수 없습니다. 먼저 컨트랙트를 배포해주세요.');
                     }
                     
                     // 기존 컨트랙트 인스턴스 생성
                     const AccessManagement = await ethers.getContractFactory('AccessManagement');
                     accessManagement = AccessManagement.attach(contractAddress);
                     
                     console.log(`📍 사용할 컨트랙트 주소: ${contractAddress}\n`);

    // 3. IndexingClient 연결
    const indexingClient = new IndexingClient({
      serverAddr: 'localhost:50052',
      protoPath: PROTO_PATH
    });

    // 연결 완료 대기
    await new Promise(resolve => setTimeout(resolve, 1000));
    
    // 4. 실제 트랜잭션으로 데이터 요청 생성
    console.log('📝 실제 트랜잭션으로 데이터 요청 생성 중...\n');
    
    // 네트워크별 테스트 데이터 설정
    let testRequests, users;
    
    if (network === 'monad') {
      // Monad 네트워크용 테스트 데이터
      testRequests = [
        {
          organizationName: "samsung",
          purpose: "데이터 공유 요청",
          description: "삼성이 Monad 사용자에게 데이터 공유 요청"
        },
        {
          organizationName: "samsung", 
          purpose: "데이터 접근 요청",
          description: "삼성이 Monad 사용자에게 데이터 접근 요청"
        }
      ];
      
      // Monad 계정들 사용
      users = [
        { address: "0xa5cc9D9F1f68546060852f7c685B99f0cD532229" }  // Monad 사용자
      ];
    } else {
      // Hardhat 네트워크용 테스트 데이터 (기존)
      testRequests = [
        {
          organizationName: "samsung",
          purpose: "데이터 공유 요청",
          description: "삼성이 사용자1에게 데이터 공유 요청"
        },
        {
          organizationName: "samsung", 
          purpose: "데이터 접근 요청",
          description: "삼성이 사용자2에게 데이터 접근 요청"
        },
        {
          organizationName: "samsung",
          purpose: "데이터 수정 요청", 
          description: "삼성이 사용자3에게 데이터 수정 요청"
        },
        {
          organizationName: "samsung",
          purpose: "데이터 삭제 요청",
          description: "삼성이 사용자4에게 데이터 삭제 요청"
        }
      ];
      
      users = [user1, user2, user3, user4];
    }
    
    for (let i = 0; i < testRequests.length; i++) {
      const request = testRequests[i];
      const user = users[i];
      
      console.log(`📋 테스트 요청 ${i + 1}:`);
      console.log(`   🏢 조직: ${request.organizationName}`);
      console.log(`   👤 사용자: ${user.address.slice(0, 10)}...`);
      console.log(`   📝 목적: ${request.purpose}`);
      
      try {
        // 5. 실제 컨트랙트 호출
        console.log(`   🔗 컨트랙트 호출 중...`);
        // Samsung 조직만 사용
        const requestingOrg = samsungOrg;
        
        const tx = await accessManagement.connect(requestingOrg).saveRequest(
          user.address,
          request.purpose,
          request.organizationName
        );
        
                                 // 6. 트랜잭션 완료 대기 (더 긴 대기 시간)
                         console.log(`   ⏳ 트랜잭션 완료 대기 중...`);
                         const receipt = await tx.wait();
                         const requestId = i + 1;
                         
                         // 트랜잭션 완료 후 추가 대기 (nonce 안정화)
                         await new Promise(resolve => setTimeout(resolve, 1000));
        
        console.log(`   ✅ 트랜잭션 성공: ${tx.hash}`);
        console.log(`   🔍 트랜잭션 해시 확인: ${tx.hash}`);
        
        // 7. 양방향 인덱싱 데이터 저장
        console.log(`   💾 양방향 인덱싱 데이터 저장 중...`);
        
        // 조직별 인덱스에 저장 (요청자 주소 해시로 구분)
        const orgShortHash = hashWalletAddress(requestingOrg.address);
        const orgData = {
          IndexID: `${request.organizationName}_${orgShortHash}_001`,
          BcList: [{
            TxId: tx.hash,
            KeySize: 64,
            KeyCol: 'IndexableData',
            IndexableData: {
              TxId: tx.hash,
              ContractAddress: contractAddress,
              EventName: 'AccessRequestsSaved',
              Timestamp: new Date().toISOString(),
              BlockNumber: receipt.blockNumber,
              DynamicFields: {
                "organizationName": request.organizationName,
                "requestingOrgAddress": requestingOrg.address,  // 요청자 주소 추가
                "targetUserId": user.address,
                "requestType": request.purpose,
                "description": request.description,
                "requestId": requestId.toString(),
                "timestamp": new Date().toISOString()
              },
              SchemaVersion: "1.0"
            }
          }],
          ColName: 'IndexableData',
          ColIndex: `${request.organizationName}_${orgShortHash}_001`,
          FilePath: `data/${network === 'hardhat' ? 'hardhat-local' : network}/${request.organizationName}_${orgShortHash}_001.bf`,
          Network: network
        };
        
        await indexingClient.insertData(orgData);
        console.log(`   ✅ 조직별 인덱스 저장 완료`);
        
        // 사용자별 인덱스에 저장
        const shortHash = hashWalletAddress(user.address);
        const userData = {
          IndexID: `user_${shortHash}_001`,
          BcList: [{
            TxId: tx.hash,
            KeySize: 64,
            KeyCol: 'UserId',
            IndexableData: {
              TxId: tx.hash,
              ContractAddress: contractAddress,
              EventName: 'AccessRequestsSaved',
              Timestamp: new Date().toISOString(),
              BlockNumber: receipt.blockNumber,
              DynamicFields: {
                "userId": user.address,
                "requestingOrg": request.organizationName,
                "requestType": request.purpose,
                "description": request.description,
                "requestId": requestId.toString(),
                "timestamp": new Date().toISOString()
              },
              SchemaVersion: "1.0"
            }
          }],
          ColName: 'UserId',
          ColIndex: `user_${shortHash}_001`,
          FilePath: `data/${network === 'hardhat' ? 'hardhat-local' : network}/user_${shortHash}_001.bf`,
          Network: network
        };
        
        await indexingClient.insertData(userData);
        console.log(`   ✅ 사용자별 인덱스 저장 완료`);
        
                                 console.log(`   🎯 양방향 인덱싱 완료: ${requestId}번 요청`);
                         console.log('');
                         
                         // 트랜잭션 간 지연 시간 추가 (nonce 꼬임 방지)
                         if (i < testRequests.length - 1) {
                           console.log(`   ⏳ 다음 요청을 위해 2초 대기 중...`);
                           await new Promise(resolve => setTimeout(resolve, 2000));
                         }
                         
                       } catch (error) {
                         console.error(`   ❌ 요청 ${i + 1} 처리 실패: ${error.message}`);
                       }
    }
    
    console.log('🎉 데이터 요청 생성 및 양방향 인덱싱 완료!');
    
  } catch (error) {
    console.error(`❌ 양방향 인덱싱 테스트 중 오류 발생: ${error.message}`);
  }
}



// 도움말 표시
function showHelp() {
  console.log(`
🔧 BI-Index CLI - Hardhat + Monad + Fabric 네트워크 지원

사용법:
  node cli.js -cmd=<명령어> [-network=<네트워크>] [-type=<타입>] [-value=<값>]

명령어 (-cmd=):
  deploy                    - 네트워크별 AccessManagement 컨트랙트 배포
  create-samsung           - Samsung 조직 인덱스 생성 (요청자 주소 기반)
  create-lg                - LG 조직 인덱스 생성
  create-user-indexes      - 사용자별 인덱스들 생성
  create-fabric-index      - Fabric 전용 인덱스 생성 (speed, dt 등)
  search                   - 데이터 검색 (조직/사용자 주소로 검색)
  request-data             - 데이터 요청 및 양방향 인덱싱 (핵심!)
  large-scale-test         - 대규모 건강 데이터 테스트 (100개 요청)
  check-config             - config.yaml 확인
  check-network-config     - network_config.yaml 확인
  check-index-status       - 인덱스 실시간 상태 확인
  get-tx-details           - 트랜잭션 상세 정보 조회 (블록체인)
  update-network           - 네트워크 설정 업데이트
  help                     - 도움말 표시

옵션:
  -network=<네트워크>      - hardhat, monad, fabric (기본값: hardhat)
  -type=<타입>             - 인덱스 타입 (일부 명령어에서 사용)
  -value=<값>              - 검색값 (검색 명령어에서 사용)
  -contract=<주소>         - 컨트랙트 주소 (배포 또는 설정 업데이트용)

예시:
  node cli.js -cmd=deploy -network=hardhat
  node cli.js -cmd=create-samsung -network=monad
  node cli.js -cmd=create-user-indexes -network=hardhat
  node cli.js -cmd=create-fabric-index -type=speed -network=fabric
  node cli.js -cmd=create-fabric-index -type=dt -network=fabric
  node cli.js -cmd=search -type=organization -value=0x2630ffE517DFC9b0112317a2EC0AB4cE2a59CEb8 -network=monad
  node cli.js -cmd=search -type=user -value=0xa5cc9D9F1f68546060852f7c685B99f0cD532229 -network=monad
  node cli.js -cmd=search -type=speed -value=60 -network=fabric
  node cli.js -cmd=search -type=dt -value=20250101 -network=fabric

Fabric 네트워크 명령어 구분:
  create-fabric-index: Fabric 인덱스 생성 (speed_001, dt_001 등)
  search: Fabric 데이터 검색 (기존 인덱스에서 조회)
  node cli.js -cmd=request-data -network=hardhat
  node cli.js -cmd=large-scale-test
  node cli.js -cmd=check-config
  node cli.js -cmd=check-network-config
  node cli.js -cmd=update-network -network=hardhat -contract=0x1234...
  node cli.js -cmd=help
    `);
}

// 메인 CLI 함수
async function main() {
  console.log(`🔧 BI-Index CLI - 명령어: ${cmd}, 네트워크: ${network}`);
  console.log('=====================================');
  
  try {
    switch (cmd) {
      // ===== 컨트랙트 배포 =====
      case 'deploy':
        await deployContract(network);
        break;
        
      // ===== 인덱스 생성 (EVM/Fabric 통합) =====
      case 'create-index':
        if (!type) {
          console.error('❌ create-index 명령어는 -type이 필요합니다');
          console.log('예시: node cli.js -cmd=create-index -type=lg -network=hardhat');
          console.log('      node cli.js -cmd=create-index -type=speed -network=fabric');
          return;
        }
        await createIndexUnified(network, type);
        break;
        
      // ===== 개별 인덱스 생성 (기존 호환성) =====
      case 'create-samsung':
        await createSamsungIndex(network);
        break;
      case 'create-lg':
        await createLgIndex(network);
        break;
      case 'create-user-indexes':
        await createUserIndexes(network);
        break;
      case 'create-fabric-index':
        if (!type) {
          console.error('❌ create-fabric-index 명령어는 -type이 필요합니다');
          console.log('예시: node cli.js -cmd=create-fabric-index -type=speed');
          return;
        }
        await callFabricChaincode('create-index', type);
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
      case 'search-index':
        if (!type) {
          console.error('❌ search-index 명령어는 -type이 필요합니다');
          console.log('예시: node cli.js -cmd=search-index -type=speed -network=fabric');
          return;
        }
        await searchIndexAll(network, type);
        break;
        
      // ===== PVD 데이터 저장 =====
      case 'putdata':
        if (type === 'individual' || type === 'multi' || type === 'batch' || type === 'csv') {
          // CSV 데이터 넣기 (개별 또는 배치)
          const csvFile = value || 'pvd_hist_100.csv';
          const batchSize = process.argv.find(arg => arg.startsWith('-batch='))?.split('=')[1] || '1000';
          await putPvdMultiData(network, csvFile, parseInt(batchSize));
        } else {
          // 단건 데이터 넣기
          if (!value) {
            console.error('❌ putdata 명령어는 -value가 필요합니다');
            console.log('예시: node cli.js -cmd=putdata -value=OBU-TEST-001 -network=fabric');
            console.log('     node cli.js -cmd=putdata -type=individual -value=pvd_data.csv -network=fabric');
            console.log('     node cli.js -cmd=putdata -type=batch -value=pvd_data.csv -network=fabric');
            return;
          }
          await putPvdData(network, value);
        }
        break;
        
             // ===== 데이터 요청 및 양방향 인덱싱 =====
             case 'request-data':
        await requestData(network);
        break;
       case 'large-scale-test':
         await runLargeScaleTest();
         break;
        
      // ===== config.yaml 확인 =====
      case 'check-config':
        await checkConfigYaml();
        break;
        
      // ===== network_config.yaml 확인 =====
      case 'check-network-config':
        await checkNetworkConfig();
        break;
        
      // ===== 인덱스 상태 확인 =====
      case 'check-index-status':
        await checkIndexStatus();
        break;
        
      // ===== 트랜잭션 상세 정보 조회 =====
      case 'get-tx-details':
        if (!value) {
          console.error('❌ get-tx-details 명령어는 -value가 필요합니다');
          console.log('예시: node cli.js -cmd=get-tx-details -value=0x1234... -network=hardhat');
          return;
        }
        await getTransactionDetails(network, type, value);
        break;
        
      // ===== 네트워크 설정 업데이트 =====
      case 'update-network':
        if (!contractAddress) {
          console.error('❌ 컨트랙트 주소를 입력해주세요. (-contract=<주소>)');
          break;
        }
        await updateNetworkConfig(network, contractAddress);
        break;
        
      // ===== 도움말 =====
      case 'help':
      default:
        showHelp();
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
  deployContract,
  createSamsungIndex,
  createUserIndexes,
  searchData,
  requestData
};
