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
    //   accounts: {
    //     mnemonic: "test test test test test test test test test test test junk",
    //     accountsBalance: "10000000000000000000000"
    //   },
    //   allowUnlimitedContractSize: true,
    //   gas: 12000000,
    //   blockGasLimit: 12000000
    // },
    // localhost: {
    //   url: "http://127.0.0.1:8545",
    //   chainId: 1337,
    //   accounts: [
    //     "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80", // account 0
    //     "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d", // account 1
    //     "0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a"  // account 2
    //   ]
    // },
    "hardhat-local": {
      url: "http://127.0.0.1:8545",
      chainId: 1337,
      accounts: [
        "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80", // account 0
      ]
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
