// 전역 변수
let selectedNetwork = 'fabric'; // 기본값: Fabric
let currentIndexes = [];

// 페이지 로드 시 초기화
document.addEventListener('DOMContentLoaded', function() {
    initializePage();
    loadIndexes();
    onNetworkChange(); // 초기 네트워크 설정
});

// 페이지 초기화
function initializePage() {
    // 타임스탬프 초기값 설정
    document.getElementById('fabricTimestamp').value = new Date().toISOString().slice(0, 16);
    
    addLog('🚀 BI-Index 멀티 네트워크 인덱싱 시스템 시작');
    addLog('✅ Fabric 네트워크 기본 선택됨');
}

// 네트워크 변경 처리
function onNetworkChange() {
    selectedNetwork = document.getElementById('networkSelect').value;
    const networkName = document.getElementById('networkSelect').options[document.getElementById('networkSelect').selectedIndex].text;
    
    // 현재 네트워크 표시 업데이트
    document.getElementById('currentNetwork').textContent = networkName;
    
    // 네트워크별 입력 폼 표시
    if (selectedNetwork === 'fabric') {
        document.getElementById('fabricInput').style.display = 'block';
        document.getElementById('evmInput').style.display = 'none';
    } else {
        document.getElementById('fabricInput').style.display = 'none';
        document.getElementById('evmInput').style.display = 'block';
    }
    
    addLog(`✅ ${networkName} 네트워크 선택됨`);
}

// 네트워크 상태 업데이트
function updateNetworkStatus(network, status) {
    const card = document.querySelector(`[data-network="${network}"]`);
    const indicator = card.querySelector('.status-indicator');
    const statusText = card.querySelector('small');
    
    indicator.className = `status-indicator status-${status}`;
    
    switch(status) {
        case 'online':
            statusText.textContent = '온라인';
            break;
        case 'offline':
            statusText.textContent = '오프라인';
            break;
        case 'processing':
            statusText.textContent = '처리 중...';
            break;
    }
}

// Fabric 데이터 전송
async function submitFabricData() {
    if (!selectedNetwork || selectedNetwork !== 'fabric') {
        alert('Fabric 네트워크를 선택해주세요.');
        return;
    }
    
    const obuId = document.getElementById('fabricObuId').value;
    const speed = document.getElementById('fabricSpeed').value;
    const timestamp = document.getElementById('fabricTimestamp').value;
    
    if (!obuId || !speed || !timestamp) {
        alert('모든 필드를 입력해주세요.');
        return;
    }
    
    addLog(`📤 Fabric 데이터 전송 시작: OBU_ID=${obuId}, Speed=${speed}km/h`);
    
    try {
        // 실제 idxmngr에 데이터 삽입 (간단한 HTTP 요청)
        const insertData = {
            IndexID: 'fabric_speed',
            BcList: [{
                TxId: `fabric_${Date.now()}`,
                KeyCol: 'Speed',
                Pvd: {
                    ObuId: obuId,
                    Speed: parseInt(speed),
                    CollectionDt: timestamp
                }
            }],
            ColName: 'Speed',
            FilePath: 'fabric_speed.bf',
            Network: 'fabric'
        };
        
        addLog(`📤 idxmngr 서버로 데이터 전송 중...`);
        addLog(`   서버: localhost:50052`);
        addLog(`   데이터: ${JSON.stringify(insertData, null, 2)}`);
        
        // 실제 HTTP 요청 (idxmngr 서버가 HTTP API를 지원한다면)
        try {
            const response = await fetch('http://localhost:50052/insertData', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(insertData)
            });
            
            if (response.ok) {
                addLog(`✅ Fabric 데이터 전송 성공: ${obuId}`);
                // 인덱스 생성 시도
                await createFabricIndex();
            } else {
                addLog(`⚠️ HTTP 응답: ${response.status} - ${response.statusText}`);
                addLog(`📝 참고: idxmngr 서버가 HTTP API를 지원하지 않을 수 있습니다.`);
                addLog(`📝 실제 데이터 전송은 기존 스크립트를 사용하세요:`);
                addLog(`   npx hardhat run scripts/fabric-with-indexing.js --network localhost`);
            }
        } catch (httpError) {
            addLog(`⚠️ HTTP 요청 실패: ${httpError.message}`);
            addLog(`📝 idxmngr는 gRPC 서버입니다. HTTP API를 지원하지 않습니다.`);
            addLog(`📝 실제 데이터 전송은 기존 스크립트를 사용하세요:`);
            addLog(`   npx hardhat run scripts/fabric-with-indexing.js --network localhost`);
        }
        
    } catch (error) {
        addLog(`❌ Fabric 데이터 전송 실패: ${error.message}`);
    }
}

// EVM 데이터 전송
async function submitEVMData() {
    if (!selectedNetwork || selectedNetwork === 'fabric') {
        alert('EVM 네트워크를 선택해주세요.');
        return;
    }
    
    const orgName = document.getElementById('evmOrgName').value;
    const purpose = document.getElementById('evmPurpose').value;
    const resourceOwner = document.getElementById('evmResourceOwner').value;
    
    if (!orgName || !purpose || !resourceOwner) {
        alert('모든 필드를 입력해주세요.');
        return;
    }
    
    addLog(`📤 ${getNetworkDisplayName(selectedNetwork)} 데이터 전송 시작: Organization=${orgName}`);
    updateNetworkStatus(selectedNetwork, 'processing');
    
    try {
        // 실제 구현에서는 스마트 컨트랙트 호출
        await simulateEVMDataSubmission(selectedNetwork, orgName, purpose, resourceOwner);
        
        addLog(`✅ ${getNetworkDisplayName(selectedNetwork)} 데이터 전송 성공: ${orgName}`);
        updateNetworkStatus(selectedNetwork, 'online');
        
        // 인덱스 생성 시도
        await createEVMIndex(selectedNetwork);
        
    } catch (error) {
        addLog(`❌ ${getNetworkDisplayName(selectedNetwork)} 데이터 전송 실패: ${error.message}`);
        updateNetworkStatus(selectedNetwork, 'offline');
    }
}

// Fabric 데이터 전송 시뮬레이션
async function simulateFabricDataSubmission(obuId, speed, timestamp) {
    return new Promise((resolve) => {
        setTimeout(() => {
            // 실제로는 gRPC를 통해 Fabric에 데이터 전송
            resolve();
        }, 2000);
    });
}

// EVM 데이터 전송 시뮬레이션
async function simulateEVMDataSubmission(network, orgName, purpose, resourceOwner) {
    return new Promise((resolve) => {
        setTimeout(() => {
            // 실제로는 스마트 컨트랙트를 통해 EVM에 데이터 전송
            resolve();
        }, 2000);
    });
}

// Fabric 인덱스 생성
async function createFabricIndex() {
    addLog('🏗️ Fabric 인덱스 생성 중...');
    
    try {
        // 기존 IndexingClient 사용 (contract/scripts에서 사용한 것과 동일)
        const IndexingClient = require('../../indexing-client-package/lib/indexing-client');
        const indexingClient = new IndexingClient({
            serverAddr: 'localhost:50052',
            protoPath: '../idxmngr-go/protos/index_manager.proto'
        });
        
        const indexData = {
            IndexID: 'fabric_speed',
            IndexName: 'Fabric Speed Index',
            KeyCol: 'Speed',
            FilePath: 'fabric_speed.bf',
            KeySize: 5,
            Network: 'fabric'
        };
        
        await indexingClient.createIndex(indexData);
        addLog('✅ Fabric 인덱스 생성 완료');
        loadIndexes();
        
        indexingClient.close();
        
    } catch (error) {
        addLog(`❌ Fabric 인덱스 생성 실패: ${error.message}`);
    }
}

// EVM 인덱스 생성
async function createEVMIndex(network) {
    const indexId = `${network}_abcdef12_speed`;
    const filePath = `${network}_abcdef12_speed.bf`;
    
    addLog(`🏗️ ${getNetworkDisplayName(network)} 인덱스 생성 중...`);
    
    try {
        const indexData = {
            IndexID: indexId,
            IndexName: `${getNetworkDisplayName(network)} Samsung Index`,
            KeyCol: 'IndexableData',
            FilePath: filePath,
            KeySize: 7,
            Network: network
        };
        
        const result = await window.idxmngrClient.createIndex(indexData);
        addLog(`✅ ${getNetworkDisplayName(network)} 인덱스 생성 완료`);
        loadIndexes();
        
    } catch (error) {
        addLog(`❌ ${getNetworkDisplayName(network)} 인덱스 생성 실패: ${error.message}`);
    }
}

// 인덱스 생성 시뮬레이션
async function simulateIndexCreation(indexId, filePath) {
    return new Promise((resolve) => {
        setTimeout(() => {
            // 실제로는 idxmngr API를 통해 인덱스 생성
            resolve();
        }, 1500);
    });
}

// 인덱스 목록 로드
async function loadIndexes() {
    // 실제 구현에서는 idxmngr API에서 인덱스 목록 가져오기
    currentIndexes = [
        { id: 'fabric_speed', name: 'Fabric Speed Index', network: 'fabric', status: 'active' },
        { id: 'hardhat_a513E6E4_speed', name: 'Hardhat Samsung Index', network: 'hardhat', status: 'active' },
        { id: 'monad_abcdef12_speed', name: 'Monad Samsung Index', network: 'monad', status: 'active' },
    ];
    
    displayIndexes();
}

// 인덱스 목록 표시
function displayIndexes() {
    const indexList = document.getElementById('indexList');
    indexList.innerHTML = '';
    
    currentIndexes.forEach(index => {
        const indexDiv = document.createElement('div');
        indexDiv.className = 'index-info mb-2';
        indexDiv.innerHTML = `
            <strong>${index.name}</strong><br>
            <small>ID: ${index.id}</small><br>
            <small>네트워크: ${getNetworkDisplayName(index.network)}</small><br>
            <span class="badge ${index.status === 'active' ? 'bg-success' : 'bg-secondary'}">${index.status === 'active' ? '활성' : '비활성'}</span>
        `;
        indexList.appendChild(indexDiv);
    });
}

// 데이터 검색
async function searchData() {
    const searchField = document.getElementById('searchField').value;
    const searchValue = document.getElementById('searchValue').value;
    
    if (!searchValue) {
        alert('검색할 값을 입력해주세요.');
        return;
    }
    
    addLog(`🔍 데이터 검색: ${searchField} = ${searchValue}`);
    
    try {
        // 실제 구현에서는 idxmngr API를 통해 데이터 검색
        const results = await simulateDataSearch(searchField, searchValue);
        
        if (results.length > 0) {
            addLog(`✅ 검색 결과: ${results.length}개 발견`);
            results.forEach(result => {
                addLog(`   - ${result.txId}: ${result.data}`);
            });
        } else {
            addLog('📭 검색 결과가 없습니다.');
        }
        
    } catch (error) {
        addLog(`❌ 검색 실패: ${error.message}`);
    }
}

// 데이터 검색 시뮬레이션
async function simulateDataSearch(field, value) {
    return new Promise((resolve) => {
        setTimeout(() => {
            // 실제로는 idxmngr API를 통해 데이터 검색
            const mockResults = [
                { txId: '0x1234...', data: `${field}: ${value}` },
                { txId: '0x5678...', data: `${field}: ${value}` }
            ];
            resolve(mockResults);
        }, 1000);
    });
}

// 로그 추가
function addLog(message) {
    const logContainer = document.getElementById('logContainer');
    const timestamp = new Date().toLocaleTimeString();
    const logEntry = document.createElement('div');
    logEntry.innerHTML = `<span class="text-muted">[${timestamp}]</span> ${message}`;
    logContainer.appendChild(logEntry);
    logContainer.scrollTop = logContainer.scrollHeight;
}

// 로그 지우기
function clearLogs() {
    document.getElementById('logContainer').innerHTML = '';
    addLog('🧹 로그가 지워졌습니다.');
}

// 네트워크 표시 이름 가져오기
function getNetworkDisplayName(network) {
    const names = {
        'fabric': 'Hyperledger Fabric',
        'hardhat': 'Hardhat',
        'monad': 'Monad',
        'sepolia': 'Sepolia'
    };
    return names[network] || network;
}

// 네트워크 연결 상태 확인
async function checkNetworkStatus() {
    const networks = ['fabric', 'hardhat', 'monad', 'sepolia'];
    
    for (const network of networks) {
        try {
            // 실제 구현에서는 각 네트워크의 상태 확인
            await simulateNetworkCheck(network);
            updateNetworkStatus(network, 'online');
        } catch (error) {
            updateNetworkStatus(network, 'offline');
        }
    }
}

// 네트워크 상태 확인 시뮬레이션
async function simulateNetworkCheck(network) {
    return new Promise((resolve, reject) => {
        setTimeout(() => {
            // 실제로는 각 네트워크의 RPC/API 엔드포인트 확인
            if (Math.random() > 0.1) { // 90% 확률로 성공
                resolve();
            } else {
                reject(new Error('Connection failed'));
            }
        }, 500);
    });
}

// 주기적 상태 확인
setInterval(checkNetworkStatus, 30000); // 30초마다 확인
