// 새로운 통합 blockchain-search API 엔드포인트
app.get('/api/blockchain-search', async (req, res) => {
  const startTime = Date.now();
  
  try {
    let { network, purpose, indexed = 'true', ...customFilters } = req.query;
    
    // URL 디코딩 처리
    if (purpose) purpose = decodeURIComponent(purpose);
    if (network) network = decodeURIComponent(network);
    
    // 필수 파라미터 검증
    if (!network) {
      return res.status(400).json({
        success: false,
        error: 'network 파라미터가 필요합니다',
        example: '/api/blockchain-search?network=hardhat-local&purpose=수면&indexed=true'
      });
    }
    
    if (!purpose) {
      return res.status(400).json({
        success: false,
        error: 'purpose 파라미터가 필요합니다',
        example: '/api/blockchain-search?network=hardhat-local&purpose=수면&indexed=true'
      });
    }
    
    const useIndexed = indexed === 'true';
    console.log(`🔍 검색 시작: ${purpose} (인덱스: ${useIndexed ? 'ON' : 'OFF'})`);
    
    if (useIndexed) {
      // ======================
      // 인덱스 기반 검색
      // ======================
      const purposes = purpose.split(',').map(p => p.trim());
      const operationType = purposes.length > 1 ? 'OR' : 'SINGLE';
      
      console.log(`📊 1단계: purpose 인덱스 검색 중... (${purposes.length}개: ${purposes.join(', ')}, 연산: ${operationType})`);
      
      const IndexingClient = require('../bi-indexing-gateway/lib/indexing-client');
      const networkDir = (network === 'hardhat' || network === 'localhost') ? 'hardhat-local' : network;
      
      let allTxIds = new Set();
      
      // Purpose 검색 (OR 연산)
      for (const singlePurpose of purposes) {
        const indexingClient = new IndexingClient({
          serverAddr: 'localhost:50052',
          protoPath: require('path').join(__dirname, '../idxmngr-go/protos/index_manager.proto')
        });
        
        await indexingClient.connect();
        
        try {
          const searchData = {
            IndexID: 'purpose',
            Value: singlePurpose.trim()
          };
          
          const result = await indexingClient.searchData(searchData);
          console.log(`🔍 "${singlePurpose}" 검색 결과: ${result.TxIDs ? result.TxIDs.length : 0}건`);
          
          if (result.TxIDs && result.TxIDs.length > 0) {
            result.TxIDs.forEach(txId => allTxIds.add(txId));
          }
        } catch (searchError) {
          console.error(`❌ "${singlePurpose}" 검색 실패:`, searchError.message);
        } finally {
          await indexingClient.close();
        }
      }
      
      // 사용자 정의 필터 적용 (AND 연산)
      const customFilterKeys = Object.keys(customFilters);
      if (customFilterKeys.length > 0) {
        console.log(`📊 2단계: 사용자 정의 필터 적용 중... (${customFilterKeys.length}개)`);
        
        for (const filterKey of customFilterKeys) {
          const filterValue = decodeURIComponent(customFilters[filterKey]);
          console.log(`🔍 ${filterKey} = "${filterValue}" 필터링 중...`);
          
          const filterClient = new IndexingClient({
            serverAddr: 'localhost:50052',
            protoPath: require('path').join(__dirname, '../idxmngr-go/protos/index_manager.proto')
          });
          
          await filterClient.connect();
          
          try {
            const filterSearchData = {
              IndexID: filterKey,
              Value: filterValue
            };
            
            const filterResult = await filterClient.searchData(filterSearchData);
            console.log(`🔍 "${filterKey}=${filterValue}" 검색 결과: ${filterResult.TxIDs ? filterResult.TxIDs.length : 0}건`);
            
            if (filterResult.TxIDs && filterResult.TxIDs.length > 0) {
              const filterTxIds = new Set(filterResult.TxIDs);
              allTxIds = new Set([...allTxIds].filter(txId => filterTxIds.has(txId)));
            } else {
              allTxIds.clear();
              break;
            }
          } catch (filterError) {
            console.error(`❌ "${filterKey}" 필터 실패:`, filterError.message);
          } finally {
            await filterClient.close();
          }
        }
      }
      
      const txIds = Array.from(allTxIds);
      console.log(`📊 3단계: 최종 트랜잭션 ID 수: ${txIds.length}건`);
      
      if (txIds.length === 0) {
        return res.json({
          success: true,
          method: 'indexed-search',
          indexed: true,
          network,
          purpose,
          operator: operationType,
          filters: customFilters,
          totalCount: 0,
          transactions: [],
          message: `"${purpose}" 목적의 트랜잭션을 찾을 수 없습니다`,
          processingTime: `${Date.now() - startTime}ms`,
          timestamp: new Date().toISOString()
        });
      }
      
      // 트랜잭션 상세 정보 조회
      console.log(`📊 4단계: 트랜잭션 상세 정보 조회 중... (${txIds.length}건)`);
      
      const provider = new ethers.providers.JsonRpcProvider('http://localhost:8545');
      const contractAddress = '0x5FbDB2315678afecb367f032d93F642f64180aa3';
      const abiPath = require('path').join(__dirname, '../contract/artifacts/contracts/AccessManagement.sol/AccessManagement.json');
      const contractArtifact = JSON.parse(require('fs').readFileSync(abiPath, 'utf8'));
      const iface = new ethers.utils.Interface(contractArtifact.abi);
      
      const transactions = [];
      let errorCount = 0;
      const batchSize = 10;
      
      for (let i = 0; i < txIds.length; i += batchSize) {
        const batch = txIds.slice(i, i + batchSize);
        console.log(`📋 배치 ${Math.floor(i/batchSize) + 1} 처리 중... (${batch.length}건)`);
        
        const batchPromises = batch.map(async (txId) => {
          try {
            const tx = await provider.getTransaction(txId);
            const receipt = await provider.getTransactionReceipt(txId);
            const block = await provider.getBlock(tx.blockNumber);
            
            let decodedFunction = null;
            let decodedEvents = [];
            
            try {
              if (tx.data && tx.data !== '0x') {
                decodedFunction = iface.parseTransaction({ data: tx.data, value: tx.value });
              }
            } catch (decodeError) {
              console.log(`⚠️ 함수 디코딩 실패 ${txId}: ${decodeError.message}`);
            }
            
            try {
              if (receipt.logs && receipt.logs.length > 0) {
                for (const log of receipt.logs) {
                  try {
                    const parsedLog = iface.parseLog(log);
                    decodedEvents.push(parsedLog);
                  } catch (logError) {
                    console.log(`⚠️ 로그 디코딩 실패: ${logError.message}`);
                  }
                }
              }
            } catch (eventsError) {
              console.log(`⚠️ 이벤트 디코딩 실패 ${txId}: ${eventsError.message}`);
            }
            
            // 이벤트에서 실제 데이터 추출
            let actualPurpose = purpose;
            let organizationName = 'N/A';
            let requestId = 'N/A';
            let resourceOwner = 'N/A';
            let requester = tx.from;
            
            if (decodedEvents.length > 0) {
              const accessEvent = decodedEvents.find(event => event.name === 'AccessRequestsSaved');
              if (accessEvent && accessEvent.args) {
                requestId = accessEvent.args.requestId?.toString() || requestId;
                requester = accessEvent.args.requester || requester;
                resourceOwner = accessEvent.args.resourceOwner || resourceOwner;
              }
            }
            
            if (decodedFunction && decodedFunction.args) {
              const args = decodedFunction.args;
              if (args._purpose) actualPurpose = args._purpose;
              if (args._organizationName) organizationName = args._organizationName;
              if (args._resourceOwner) resourceOwner = args._resourceOwner;
            }
            
            return {
              txId: tx.hash,
              blockNumber: tx.blockNumber,
              timestamp: block.timestamp,
              date: new Date(block.timestamp * 1000).toISOString(),
              status: receipt.status === 1 ? 'success' : 'failed',
              requestId,
              requester,
              resourceOwner,
              purpose: actualPurpose,
              organizationName
            };
          } catch (error) {
            console.error(`❌ 트랜잭션 처리 실패 ${txId}:`, error.message);
            errorCount++;
            return null;
          }
        });
        
        const batchResults = await Promise.all(batchPromises);
        transactions.push(...batchResults.filter(tx => tx !== null));
        
        console.log(`📋 배치 ${Math.floor(i/batchSize) + 1} 완료`);
      }
      
      transactions.sort((a, b) => b.blockNumber - a.blockNumber);
      
      const processingTime = Date.now() - startTime;
      
      res.json({
        success: true,
        method: 'indexed-search',
        indexed: true,
        network,
        purpose,
        operator: operationType,
        filters: customFilters,
        totalCount: transactions.length,
        errorCount,
        transactions,
        processingTime: `${processingTime}ms`,
        timestamp: new Date().toISOString()
      });
      
    } else {
      // ======================
      // 블록체인 직접 검색
      // ======================
      console.log(`🔗 블록체인 직접 검색 시작: ${purpose}`);
      
      // hardhat-local만 지원
      if (network !== 'hardhat-local') {
        return res.status(400).json({
          success: false,
          error: 'blockchain-search는 hardhat-local 네트워크만 지원합니다',
          timestamp: new Date().toISOString()
        });
      }
      
      // ethers 설정
      const provider = new ethers.providers.JsonRpcProvider('http://localhost:8545');
      const contractAddress = '0x5FbDB2315678afecb367f032d93F642f64180aa3';
      const abiPath = require('path').join(__dirname, '../contract/artifacts/contracts/AccessManagement.sol/AccessManagement.json');
      const contractArtifact = JSON.parse(require('fs').readFileSync(abiPath, 'utf8'));
      const contract = new ethers.Contract(contractAddress, contractArtifact.abi, provider);
      
      // 최신 블록 번호 조회
      const latestBlock = await provider.getBlockNumber();
      console.log(`📊 블록 범위: 0 ~ ${latestBlock}`);
      
      // purpose를 keccak256 해시로 변환 (indexed 파라미터용)
      const purposeHash = ethers.utils.keccak256(ethers.utils.toUtf8Bytes(purpose));
      
      // 이벤트 로그 조회 (전체 블록 범위)
      const filter = contract.filters.AccessRequestsSaved();
      const allEvents = await contract.queryFilter(filter, 0, latestBlock);
      
      console.log(`📋 전체 이벤트 수: ${allEvents.length}`);
      
      // purpose로 필터링
      const events = allEvents.filter(event => {
        const args = event.args;
        if (args && args.purpose) {
          // Indexed 객체의 hash 속성과 비교
          const eventPurposeHash = args.purpose.hash || args.purpose;
          return eventPurposeHash === purposeHash;
        }
        return false;
      });
      
      console.log(`🎯 필터링된 이벤트 수: ${events.length}`);
      
      // 트랜잭션 상세 정보 조회
      const transactions = [];
      for (const event of events) {
        try {
          const tx = await provider.getTransaction(event.transactionHash);
          const receipt = await provider.getTransactionReceipt(event.transactionHash);
          const block = await provider.getBlock(tx.blockNumber);
          
          // 이벤트 파라미터에서 데이터 추출
          const args = event.args;
          
          const transaction = {
            txId: event.transactionHash,
            blockNumber: tx.blockNumber,
            timestamp: block.timestamp,
            date: new Date(block.timestamp * 1000).toISOString(),
            status: receipt.status === 1 ? 'success' : 'failed',
            requestId: args.requestId?.toString() || 'N/A',
            requester: args.requester || 'N/A',
            resourceOwner: args.resourceOwner || 'N/A',
            purpose: purpose, // 원본 purpose 사용
            organizationName: 'N/A', // 블록체인에서는 조직명을 직접 추출할 수 없음
            gasUsed: receipt.gasUsed?.toString() || 'N/A',
            gasPrice: tx.gasPrice?.toString() || 'N/A'
          };
          
          transactions.push(transaction);
        } catch (txError) {
          console.error(`❌ 트랜잭션 처리 실패 ${event.transactionHash}:`, txError.message);
        }
      }
      
      const processingTime = Date.now() - startTime;
      
      res.json({
        success: true,
        method: 'blockchain-direct',
        indexed: false,
        network,
        purpose,
        blockRange: `0-${latestBlock} (전체)`,
        totalCount: transactions.length,
        transactions,
        processingTime: `${processingTime}ms`,
        timestamp: new Date().toISOString()
      });
    }
    
  } catch (error) {
    console.error('❌ 블록체인 검색 실패:', error);
    res.status(500).json({
      success: false,
      error: error.message,
      timestamp: new Date().toISOString()
    });
  }
});
