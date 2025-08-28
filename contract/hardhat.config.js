require("@nomicfoundation/hardhat-toolbox");
require("dotenv").config();  // .env 파일 로드

/** @type import('hardhat/config').HardhatUserConfig */
module.exports = {
  solidity: "0.8.28",
  
  // 배포된 컨트랙트 주소들
  contractAddresses: {
    monadTest: "0x4D393E83C47AFFA1eE8eaB8eFCcBD0d2e1835F97"
  },
  
  networks: {
    hardhat: {
      chainId: 1337,
      loggingEnabled: true,
      // 상세한 로깅 설정
      console: true,
      // 트랜잭션 로깅 활성화
      verbose: true,
      accounts: {
        mnemonic: "test test test test test test test test test test test junk",
        accountsBalance: "10000000000000000000000"
      },
      // eth_getLogs 활성화
      allowUnlimitedContractSize: true,
      gas: 12000000,
      blockGasLimit: 12000000,
      // 이벤트 로깅 활성화
      mining: {
        auto: true,
        interval: 0
      }
    },
    monadTest: {
    url: "https://rpc.ankr.com/monad_testnet",  // MONAD TEST RPC
    chainId: 10143,  // MONAD TEST 체인 ID
    accounts: [process.env.PRIVATE_KEY]
    }
  },
  mocha: {
    timeout: 40000
  }
};
