const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createDictionaryReports, telegramCall } = require('../dictionary-reports');

test('long Cyrillic and emoji queries fit Telegram callback limit without losing report text', () => {
  const reports = createDictionaryReports();
  for (const text of ['Сегодня я проснулся рано и приготовил завтрак. Потом пошёл на рынок.', '😀'.repeat(200), 'a'.repeat(2000)]) {
    const data = reports.create(1, text);
    assert.ok(Buffer.byteLength(data, 'utf8') <= 64);
    assert.equal(reports.resolve(data, 1), text);
    assert.equal(reports.resolve(data, 2), null);
  }
});

test('expired and evicted reports are unavailable', () => {
  let time = 0;
  const reports = createDictionaryReports({ now: () => time, maxEntries: 1, ttl: 10 });
  const old = reports.create(1, 'old');
  const current = reports.create(1, 'new');
  assert.equal(reports.resolve(old, 1), null);
  time = 10;
  assert.equal(reports.resolve(current, 1), null);
});

test('Telegram API rejection is handled instead of becoming an unhandled rejection', async () => {
  const bot = { sendMessage: async () => { throw new Error('BUTTON_DATA_INVALID'); } };
  assert.equal(await telegramCall(bot, 'sendMessage', 1, 'text'), null);
});
