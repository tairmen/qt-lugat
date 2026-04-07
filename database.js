const { Client, Pool } = require('pg');

function getDatabaseConfig() {
  return {
    host: process.env.POSTGRES_HOST || 'localhost',
    port: Number(process.env.POSTGRES_PORT || 5432),
    database: process.env.POSTGRES_DB,
    user: process.env.POSTGRES_USER,
    password: process.env.POSTGRES_PASSWORD,
    table: process.env.POSTGRES_TABLE || 'words'
  };
}

function validateDatabaseConfig(config) {
  const required = ['database', 'user', 'password'];
  const missing = required.filter((key) => !config[key]);

  if (missing.length > 0) {
    throw new Error(`Missing PostgreSQL env vars: ${missing.join(', ')}`);
  }

  if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(config.table)) {
    throw new Error('POSTGRES_TABLE must contain only letters, numbers, and underscores.');
  }
}

function createDatabaseClient(config = getDatabaseConfig()) {
  validateDatabaseConfig(config);

  return new Client({
    host: config.host,
    port: config.port,
    database: config.database,
    user: config.user,
    password: config.password
  });
}

function createDatabasePool(config = getDatabaseConfig()) {
  validateDatabaseConfig(config);

  return new Pool({
    host: config.host,
    port: config.port,
    database: config.database,
    user: config.user,
    password: config.password
  });
}

module.exports = {
  createDatabaseClient,
  createDatabasePool,
  getDatabaseConfig,
  validateDatabaseConfig
};