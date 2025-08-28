const hre = require("hardhat");

/**
 * Hardhat 네트워크용 Samsung Access Request + Indexing 스크립트
 * 삼성전자 접근 요청을 생성하고 idxmngr에 인덱싱 요청
 */
async function main() {
  console.log("🏢 Hardhat 네트워크 - Samsung Access Request + Indexing 시작...");

  // 계정 및 컨트랙트 설정
  const [samsungAccount] = await hre.ethers.getSigners();
  const contractAddress = "0xa513E6E4b8f2a923D98304ec87F64353C4D5C853";
  
  console.log(`📱 Samsung 계정: ${samsungAccount.address}`);
  console.log(`📍 컨트랙트 주소: ${contractAddress}`);

  // AccessManagement 컨트랙트 인스턴스 생성
  const AccessManagement = await hre.ethers.getContractFactory("AccessManagement");
  const accessManagement = AccessManagement.attach(contractAddress);

  // Samsung 조직 정보
  const organizationName = "samsung";

  console.log(`\n📋 Access Request 정보:`);
  console.log(`   Organization: ${organizationName}`);

  try {
    // 1. saveRequest 함수 호출
    console.log(`\n🚀 saveRequest 함수 호출 중...`);
    const tx = await accessManagement.saveRequest(
      "0x8626f6940E2eb28930eFb4CeF49B2d1F2C9C1199", // resourceOwner
      "Business Partnership", // purpose
      organizationName
    );
    console.log(`📝 트랜잭션 전송됨: ${tx.hash}`);
    
    // 트랜잭션 완료 대기
    const receipt = await tx.wait();
    console.log(`✅ 트랜잭션 완료! Block: ${receipt.blockNumber}, Gas: ${receipt.gasUsed.toString()}`);

    // 2. 트랜잭션 해시를 직접 사용
    const txId = receipt.hash;
    console.log(`\n📊 트랜잭션 해시: ${txId}`);

    // 3. idxmngr에 인덱싱 요청 전송 (IndexingClient 사용)
    console.log(`\n📊 idxmngr에 인덱싱 요청 전송 중...`);
    
    // IndexingClient 사용 (create-samsung-index.js와 동일한 방식)
    const IndexingClient = require('../../indexing-client-package/lib/indexing-client');
    
    // IndexingClient 인스턴스 생성
    const indexingClient = new IndexingClient({
      serverAddr: 'localhost:50052',
      protoPath: '../idxmngr-go/protos/index_manager.proto'
    });

    try {
      // 연결 완료 대기
      await new Promise(resolve => setTimeout(resolve, 1000));
      
      // InsertDatatoIdx 구조체 생성 (Hardhat 네트워크용)
      const insertRequest = {
        IndexID: 'hardhat_a513E6E4_speed',
        BcList: [{
          TxId: txId,
          KeyCol: 'IndexableData',
          IndexableData: {
            OrganizationName: organizationName  // 인덱싱에 실제로 사용되는 key
          }
        }],
        ColName: 'IndexableData',
        TxId: txId,
        // OBU_ID 제거 (EVM 네트워크는 PVD 데이터가 아님)
        FilePath: 'hardhat_a513E6E4_speed.bf',
        Network: 'hardhat' // Hardhat 네트워크 지정
      };

      console.log(`\n🔌 IndexingClient로 InsertIndexRequest 호출 시작...`);
      console.log(`   서버 주소: localhost:50052`);
      console.log(`   요청 데이터: ${JSON.stringify(insertRequest, null, 2)}`);
      
      // IndexingClient를 사용해서 데이터 삽입 (create-samsung-index.js와 동일한 방식)
      await indexingClient.insertData(insertRequest);
      console.log(`✅ IndexingClient 인덱싱 요청 성공!`);
      
    } catch (error) {
      console.error(`❌ IndexingClient 인덱싱 요청 실패: ${error.message}`);
      throw error;
    } finally {
      indexingClient.close();
    }

    console.log(`✅ idxmngr 인덱싱 요청 전송 완료!`);
    console.log(`   Network: hardhat`);
    console.log(`   IndexID: hardhat_a513E6E4_speed`);
    console.log(`   FilePath: hardhat_a513E6E4_speed.bf`);

    return {
      txHash: txId,
      requestId: txId,
      indexData: {
        txHash: txId,
        organization: organizationName,
        network: 'hardhat',
        indexID: 'hardhat_a513E6E4_speed'
      }
    };

  } catch (error) {
    console.error(`❌ 테스트 실패: ${error.message}`);
    throw error;
  }
}

main()
  .then((result) => {
    console.log(`\n🎉 Hardhat 네트워크 - Samsung Access Request + Indexing 성공!`);
    console.log(`   Tx Hash: ${result.txHash}`);
    console.log(`   Network: ${result.indexData.network}`);
    console.log(`   IndexID: ${result.indexData.indexID}`);
    console.log(`\n📋 다음 단계: idxmngr에서 Hardhat 데이터 검색 테스트`);
    process.exit(0);
  })
  .catch((error) => {
    console.error("❌ 테스트 실패:", error);
    process.exit(1);
  });