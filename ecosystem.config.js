module.exports = {
  apps: [
    {
      name: 'lugat-bot',
      script: 'index.js',
      cwd: __dirname,
      instances: 1,
      autorestart: true,
      watch: false,
      max_memory_restart: '300M'
    },
    {
      name: 'lugat-admin',
      script: 'admin.js',
      cwd: __dirname,
      instances: 1,
      autorestart: true,
      watch: false,
      max_memory_restart: '300M'
    }
  ]
};