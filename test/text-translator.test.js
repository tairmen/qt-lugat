const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createTextTranslator, selectGlossary } = require('../text-translator');
const { registerTextMode } = require('../text-mode');

const entries = [
  { word: 'яблоко', translation: 'alma', language: 'R' },
  { word: 'alma', translation: 'яблоко', language: 'Q' },
  { word: 'добрый день', translation: 'selâm', language: 'R' }
];
const success = text => ({ ok: true, json: async () => ({ status: 'completed', output: [
  { type: 'message', content: [{ type: 'output_text', text }] }
] }) });

test('glossary respects direction, punctuation, phrase priority and size limits', () => {
  assert.equal(selectGlossary(entries, 'Добрый день! Яблоко.', 'crh')[0].word, 'добрый день');
  assert.deepEqual(selectGlossary(entries, 'alma', 'ru'), [{ word: 'alma', translation: 'яблоко' }]);
  assert.deepEqual(selectGlossary(entries, 'alma', 'crh'), []);
  const many = Array.from({ length: 100 }, () => ({ word: 'alma', language: 'Q', translation: 'x'.repeat(900) }));
  assert.ok(JSON.stringify(selectGlossary(many, 'alma', 'ru')).length < 10100);
});

test('request keeps instructions separate, disables storage, caches and throttles', async () => {
  let calls = 0;
  let clock = 100000;
  const translator = createTextTranslator({ apiKey: 'test-only', now: () => clock,
    loadDictionary: async () => entries,
    fetchImpl: async (url, options) => {
      calls++;
      assert.equal(url, 'https://api.openai.com/v1/responses');
      const body = JSON.parse(options.body);
      assert.equal(body.store, false);
      assert.equal(JSON.parse(body.input).dictionary[0].word, 'яблоко');
      return success('alma');
    }
  });
  const input = { text: 'яблоко', target: 'crh', userId: 1 };
  assert.equal(await translator.translate(input), 'alma');
  await assert.rejects(translator.translate(input), /10 секунд/);
  clock += 11000;
  assert.equal(await translator.translate(input), 'alma');
  assert.equal(calls, 1);
  await assert.rejects(translator.translate({ ...input, text: 'x'.repeat(2001) }), /2000/);
});

test('API failures and truncated output are not returned as translations or cached', async () => {
  let clock = 100000;
  let calls = 0;
  const translator = createTextTranslator({ apiKey: 'test-only', now: () => clock,
    loadDictionary: async () => [], fetchImpl: async () => {
      calls++;
      if (calls === 1) return { ok: false, status: 429 };
      if (calls === 2) return { ok: true, json: async () => ({ status: 'incomplete', output: [] }) };
      return success('готово');
    }
  });
  const input = { text: 'test', target: 'ru', userId: 1 };
  await assert.rejects(translator.translate(input), /баланс/);
  clock += 11000;
  await assert.rejects(translator.translate(input), /полный перевод/);
  clock += 11000;
  assert.equal(await translator.translate(input), 'готово');
});

test('busy users cannot submit concurrent paid requests; network failure releases lock', async () => {
  let rejectFetch;
  const translator = createTextTranslator({ apiKey: 'test-only', loadDictionary: async () => [],
    fetchImpl: () => new Promise((resolve, reject) => { rejectFetch = reject; }) });
  const input = { text: 'test', target: 'ru', userId: 1 };
  const first = translator.translate(input);
  await new Promise(resolve => setImmediate(resolve));
  await assert.rejects(translator.translate(input), /ещё выполняется/);
  rejectFetch(new Error('private provider details'));
  await assert.rejects(first, error => !error.message.includes('private') && /позже/.test(error.message));
});

test('Telegram mode isolates users, accepts multiline text, and restores dictionary', async () => {
  const commands = [];
  const messages = [];
  const requests = [];
  const bot = { onText: (regex, fn) => commands.push({ regex, fn }), on() {},
    sendMessage: async (id, text) => messages.push(text) };
  const mode = registerTextMode({ bot, translator: { translate: async input => { requests.push(input); return 'alma'; } } });
  const message = { chat: { id: 10 }, from: { id: 1 }, text: '/text crh яблоко\nяблоко' };
  const command = commands.find(c => c.regex.test(message.text));
  await command.fn(message, message.text.match(command.regex));
  assert.equal(requests[0].text, 'яблоко\nяблоко');
  assert.equal(mode.handle({ ...message, from: { id: 2 }, text: 'test' }), false);
  const dictionary = commands.find(c => c.regex.test('/dictionary'));
  await dictionary.fn(message);
  assert.equal(mode.handle({ ...message, text: 'test' }), false);
  assert.ok(messages.some(text => text.includes('Машинный перевод')));
});

test('daily cap prevents additional paid calls', async () => {
  let calls = 0;
  const translator = createTextTranslator({ apiKey: 'test-only', loadDictionary: async () => [],
    fetchImpl: async () => { calls++; return success('ok'); } });
  for (let i = 0; i < 200; i++) {
    await translator.translate({ text: `input ${i}`, target: 'ru', userId: i });
  }
  await assert.rejects(translator.translate({ text: 'extra', target: 'ru', userId: 201 }), /Дневной лимит/);
  assert.equal(calls, 200);
});

test('error report stores source and output, but only for the requesting user', async () => {
  let command;
  let callback;
  let callbackData;
  const saved = [];
  const bot = {
    onText(regex, fn) { if (regex.test('/text crh hi')) command = fn; },
    on(event, fn) { callback = fn; },
    async sendMessage(id, text, options) { if (options) callbackData = options.reply_markup.inline_keyboard[0][0].callback_data; },
    async answerCallbackQuery() {}
  };
  registerTextMode({ bot, translator: { translate: async () => 'selâm' }, pool: {},
    logReport: async (pool, report) => saved.push(report) });
  await command({ chat: { id: 10 }, from: { id: 1 } }, ['', 'crh', 'привет']);
  await callback({ id: 'a', data: callbackData, message: { chat: { id: 10 } }, from: { id: 2 } });
  assert.equal(saved.length, 0);
  await callback({ id: 'b', data: callbackData, message: { chat: { id: 10 } }, from: { id: 1 } });
  assert.equal(saved.length, 1);
  assert.match(saved[0].word, /привет/);
  assert.match(saved[0].word, /selâm/);
});
