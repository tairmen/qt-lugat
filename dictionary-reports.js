const { randomUUID } = require('node:crypto');

function createDictionaryReports({ now = Date.now, maxEntries = 1000, ttl = 86400000 } = {}) {
  const entries = new Map();
  return {
    create(chatId, word) {
      for (const [id, entry] of entries) if (entry.expires <= now()) entries.delete(id);
      if (entries.size >= maxEntries) entries.delete(entries.keys().next().value);
      const id = randomUUID();
      entries.set(id, { chatId, word, expires: now() + ttl });
      return `dict-report:${id}`;
    },
    resolve(data, chatId) {
      const entry = entries.get(data.slice('dict-report:'.length));
      return entry && entry.chatId === chatId && entry.expires > now() ? entry.word : null;
    }
  };
}

// Event listeners do not await Telegram promises; handle rejection at the boundary.
async function telegramCall(bot, method, ...args) {
  try {
    return await bot[method](...args);
  } catch {
    console.error(`Telegram ${method} failed.`);
    return null;
  }
}

module.exports = { createDictionaryReports, telegramCall };
