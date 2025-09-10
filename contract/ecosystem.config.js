module.exports = {
  apps: [
    {
      name: 'hardhat-network',
      script: 'npx',
      args: 'hardhat node',
      cwd: '/home/blockchain/bi-index-migration/bi-index/contract',
      instances: 1,
      exec_mode: 'fork',
      autorestart: true,
      watch: false,
      max_memory_restart: '1G',
      env: {
        NODE_ENV: 'development'
      },
      log_file: './logs/hardhat-combined.log',
      out_file: './logs/hardhat-out.log',
      error_file: './logs/hardhat-error.log',
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
      merge_logs: true,
      time: true
    },
    {
      name: 'hardhat-performance-test',
      script: 'node',
      args: 'scripts/cli.js -cmd=performance-test -network=hardhat',
      cwd: '/home/blockchain/bi-index-migration/bi-index/contract',
      instances: 1,
      exec_mode: 'fork',
      autorestart: false,
      watch: false,
      max_memory_restart: '1G',
      env: {
        NODE_ENV: 'development'
      },
      log_file: './logs/performance-test-combined.log',
      out_file: './logs/performance-test-out.log',
      error_file: './logs/performance-test-error.log',
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
      merge_logs: true,
      time: true
    }
  ]
};
