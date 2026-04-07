const fs = require('fs');
const path = require('path');
const { Client } = require('pg');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const { csvPath, ensureDataDir, loadWords, toCsv } = require('./shared');

function chunk(items, size) {
  const chunks = [];

  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }

  return chunks;
}

function getConfig() {
  return {
    host: process.env.POSTGRES_HOST || 'localhost',
    port: Number(process.env.POSTGRES_PORT || 5432),
    database: process.env.POSTGRES_DB,
    user: process.env.POSTGRES_USER,
    password: process.env.POSTGRES_PASSWORD,
    table: process.env.POSTGRES_TABLE || 'words'
  };
}

function validateConfig(config) {
  const required = ['database', 'user', 'password'];
  const missing = required.filter((key) => !config[key]);

  if (missing.length > 0) {
    throw new Error(`Missing PostgreSQL env vars: ${missing.join(', ')}`);
  }

  if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(config.table)) {
    throw new Error('POSTGRES_TABLE must contain only letters, numbers, and underscores.');
  }
}

async function ensureTable(client, tableName) {
  await client.query(`
    CREATE TABLE IF NOT EXISTS ${tableName} (
      id INTEGER PRIMARY KEY,
      word TEXT NOT NULL,
      translation TEXT NOT NULL,
      language VARCHAR(16),
      status INTEGER,
      created_at TIMESTAMP NULL,
      updated_at TIMESTAMP NULL
    )
  `);
}

async function truncateTable(client, tableName) {
  await client.query(`TRUNCATE TABLE ${tableName}`);
}

async function insertBatch(client, tableName, rows) {
  const values = [];
  const placeholders = [];

  rows.forEach((row, rowIndex) => {
    const offset = rowIndex * 7;
    placeholders.push(
      `($${offset + 1}, $${offset + 2}, $${offset + 3}, $${offset + 4}, $${offset + 5}, $${offset + 6}, $${offset + 7})`
    );
    values.push(
      row.id,
      row.word,
      row.translation,
      row.language || null,
      row.status,
      row.created_at,
      row.updated_at
    );
  });

  await client.query(
    `
      INSERT INTO ${tableName} (id, word, translation, language, status, created_at, updated_at)
      VALUES ${placeholders.join(', ')}
    `,
    values
  );
}

async function main() {
  const config = getConfig();
  validateConfig(config);

  const words = loadWords();
  ensureDataDir();
  fs.writeFileSync(csvPath, toCsv(words), 'utf8');

  const client = new Client({
    host: config.host,
    port: config.port,
    database: config.database,
    user: config.user,
    password: config.password
  });

  await client.connect();

  try {
    await ensureTable(client, config.table);
    await truncateTable(client, config.table);

    for (const rows of chunk(words, 500)) {
      await insertBatch(client, config.table, rows);
    }

    console.log(`CSV created: ${csvPath}`);
    console.log(`Imported rows: ${words.length}`);
    console.log(`PostgreSQL table: ${config.table}`);
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});