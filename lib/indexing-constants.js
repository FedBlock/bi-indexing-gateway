const path = require("path");
const config = require("./indexing-config");

const INDEX_SCHEMA = config.defaultSchema || "access-requests";
const DEFAULT_NETWORK_KEY = config.defaultNetworkKey || "hardhat-local";
const INDEX_KEY_SIZE = Number(config.indexKeySize || 64);

const NETWORK_ALIASES = {
  hardhat: "hardhat-local",
  localhost: "hardhat-local",
};

function resolveNetworkKey(value) {
  const trimmed = typeof value === "string" ? value.trim() : "";
  if (!trimmed) {
    return DEFAULT_NETWORK_KEY;
  }
  return NETWORK_ALIASES[trimmed] || trimmed;
}

function buildIndexId(networkKey = DEFAULT_NETWORK_KEY) {
  const key = resolveNetworkKey(networkKey);
  return `${INDEX_SCHEMA}-${key}`;
}

function buildIndexFilePath(networkKey = DEFAULT_NETWORK_KEY) {
  const key = resolveNetworkKey(networkKey);
  return path.posix.join("data", key, `${INDEX_SCHEMA}.bf`);
}

module.exports = {
  INDEX_SCHEMA,
  INDEX_KEY_SIZE,
  DEFAULT_NETWORK_KEY,
  resolveNetworkKey,
  buildIndexId,
  buildIndexFilePath,
};
