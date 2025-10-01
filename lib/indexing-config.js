const DEFAULT_SCHEMA = process.env.INDEX_SCHEMA || 'purpose';
const DEFAULT_NETWORK_KEY = process.env.INDEX_DEFAULT_NETWORK || 'hardhat-local';
const INDEX_KEY_SIZE = Number(process.env.INDEX_KEY_SIZE || 64);

module.exports = {
  defaultSchema: DEFAULT_SCHEMA,
  defaultNetworkKey: DEFAULT_NETWORK_KEY,
  indexKeySize: INDEX_KEY_SIZE,
};
