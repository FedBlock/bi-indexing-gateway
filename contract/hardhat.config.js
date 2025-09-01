require("@nomicfoundation/hardhat-toolbox");
require("dotenv").config();  // .env 파일 로드

/** @type import('hardhat/config').HardhatUserConfig */
module.exports = {
  solidity: "0.8.28",
  
  // 배포된 컨트랙트 주소들
  contractAddresses: {
    hardhat: "0x5FbDB2315678afecb367f032d93F642f64180aa3", // Hardhat 로컬
    monadTest: "0x4D393E83C47AFFA1eE8eaB8eFCcBD0d2e1835F97", // Monad 테스트넷
  },
  
  networks: {
    // hardhat: {
    //   chainId: 1337,
    //   loggingEnabled: true,
    //   // 상세한 로깅 설정
    //   console: true,
    //   // 트랜잭션 로깅 활성화
    //   verbose: true,
    //   accounts: {
    //     mnemonic: "test test test test test test test test test test test junk",
    //     accountsBalance: "10000000000000000000000"
    //   },
    //   // eth_getLogs 활성화
    //   allowUnlimitedContractSize: true,
    //   gas: 12000000,
    //   blockGasLimit: 12000000,
    //   // 이벤트 로깅 활성화
    //   mining: {
    //     auto: true,
    //     interval: 0
    //   }
    // },
    "hardhat-local": {
      url: "http://127.0.0.1:8545",
      chainId: 1337,
      accounts: {
        mnemonic: "test test test test test test test test test test test junk",
        accountsBalance: "10000000000000000000000"
      }
    },
    monad: {
    url: "https://rpc.ankr.com/monad_testnet",  // MONAD TEST RPC
    chainId: 10143,  // MONAD TEST 체인 ID
    accounts: ["d67ceaf47fbb661f7746872e539db56b2d4c9e402e52df4a4c88de22e9904ea8"]
    }
  },
  mocha: {
    timeout: 40000
  }
};
