const fs = require('fs');
const path = require('path');

const dictionaryPath = path.join(__dirname, '..', 'words.json');
const dataDir = path.join(__dirname, '..', 'data');
const csvPath = path.join(dataDir, 'words.csv');

function ensureDataDir() {
  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
  }
}

function normalizeEntry(entry) {
  return {
    id: entry.id ?? null,
    word: String(entry.word || '').trim(),
    translation: String(entry.translation || '').trim(),
    language: String(entry.language || '').trim(),
    status: entry.status ?? null,
    created_at: entry.created_at || null,
    updated_at: entry.updated_at || null
  };
}

function loadWords() {
  const raw = fs.readFileSync(dictionaryPath, 'utf8');
  const parsed = JSON.parse(raw);

  if (!Array.isArray(parsed)) {
    throw new Error('words.json must contain a JSON array.');
  }

  return parsed
    .filter((entry) => entry && typeof entry.word === 'string' && typeof entry.translation === 'string')
    .map(normalizeEntry);
}

function escapeCsvValue(value) {
  if (value === null || value === undefined) {
    return '';
  }

  const stringValue = String(value);

  if (/[",\n\r]/.test(stringValue)) {
    return `"${stringValue.replace(/"/g, '""')}"`;
  }

  return stringValue;
}

function toCsv(rows) {
  const headers = ['id', 'word', 'translation', 'language', 'status', 'created_at', 'updated_at'];
  const lines = [headers.join(',')];

  for (const row of rows) {
    lines.push(headers.map((header) => escapeCsvValue(row[header])).join(','));
  }

  return lines.join('\n');
}

module.exports = {
  csvPath,
  ensureDataDir,
  loadWords,
  toCsv
};