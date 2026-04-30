const TelegramBot = require('node-telegram-bot-api');
require('dotenv').config();

const { createDatabaseClient, createDatabasePool, getDatabaseConfig, ensureChatSessionsTable, logChatSession, ensureReportsTable, logReport } = require('./database');

const token = process.env.TELEGRAM_BOT_TOKEN;

if (!token) {
  throw new Error('TELEGRAM_BOT_TOKEN is not set. Add it to your .env file.');
}

function normalize(text) {
  return String(text || '')
    .trim()
    .toLowerCase()
    .replace(/ё/g, 'е')
    .replace(/\s+/g, ' ');
}

function hasCyrillic(text) {
  return /[а-яёіїєґ]/i.test(String(text || ''));
}

function extractReverseTerms(translation) {
  const parts = String(translation || '')
    .split(/[\n;,]/)
    .map((part) => part.trim())
    .filter(Boolean);

  const terms = new Set();

  for (const part of parts) {
    const withoutNumbering = part.replace(/^\d+\)\s*/, '').trim();
    const withoutBrackets = withoutNumbering.replace(/\([^)]*\)/g, '').trim();
    const fragments = [withoutNumbering, withoutBrackets];

    for (const fragment of fragments) {
      if (!fragment) {
        continue;
      }

      for (const candidate of fragment.split(/\s+-\s+/)) {
        const cleaned = candidate.trim();

        if (!cleaned || hasCyrillic(cleaned)) {
          continue;
        }

        terms.add(cleaned);
      }
    }
  }

  return Array.from(terms);
}

function getReverseLookupTerms(entry) {
  const terms = new Set(entry.reverseTerms || []);

  if (entry.word && !hasCyrillic(entry.word)) {
    terms.add(entry.word.trim());
  }

  return Array.from(terms);
}

async function loadDictionaryFromPostgres() {
  const config = getDatabaseConfig();
  const result = await databasePool.query(`
    SELECT id, word, translation, language
    FROM ${config.table}
    WHERE word IS NOT NULL
      AND translation IS NOT NULL
    ORDER BY id ASC
  `);

  return result.rows
    .filter((entry) => typeof entry.word === 'string' && typeof entry.translation === 'string')
    .map((entry) => ({
      id: entry.id,
      word: entry.word.trim(),
      translation: entry.translation.trim(),
      reverseTerms: extractReverseTerms(entry.translation),
      language: entry.language || 'R'
    }));
}

function buildIndex(entries) {
  const forwardExact = new Map();
  const reverseExact = new Map();

  for (const entry of entries) {
    const key = normalize(entry.word);
    const bucket = forwardExact.get(key) || [];
    bucket.push(entry);
    forwardExact.set(key, bucket);

    for (const term of getReverseLookupTerms(entry)) {
      const reverseKey = normalize(term);
      const reverseBucket = reverseExact.get(reverseKey) || [];
      reverseBucket.push({ entry, term });
      reverseExact.set(reverseKey, reverseBucket);
    }
  }

  return { forwardExact, reverseExact, entries };
}

function uniqueByWord(entries) {
  const seen = new Set();
  return entries.filter((entry) => {
    const key = normalize(entry.word);
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}

function uniqueReverseMatches(matches) {
  const seen = new Set();
  return matches.filter((match) => {
    const key = `${normalize(match.term)}:${normalize(match.entry.word)}`;
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}

function getMaxDistance(query) {
  if (query.length <= 4) {
    return 1;
  }

  return 2;
}

function getBoundedEditDistance(left, right, maxDistance) {
  const leftLength = left.length;
  const rightLength = right.length;

  if (Math.abs(leftLength - rightLength) > maxDistance) {
    return maxDistance + 1;
  }

  const previousRow = new Array(rightLength + 1);
  const currentRow = new Array(rightLength + 1);

  for (let column = 0; column <= rightLength; column += 1) {
    previousRow[column] = column;
  }

  for (let row = 1; row <= leftLength; row += 1) {
    currentRow[0] = row;
    let rowMin = currentRow[0];

    for (let column = 1; column <= rightLength; column += 1) {
      const cost = left[row - 1] === right[column - 1] ? 0 : 1;
      currentRow[column] = Math.min(
        previousRow[column] + 1,
        currentRow[column - 1] + 1,
        previousRow[column - 1] + cost
      );

      if (currentRow[column] < rowMin) {
        rowMin = currentRow[column];
      }
    }

    if (rowMin > maxDistance) {
      return maxDistance + 1;
    }

    for (let column = 0; column <= rightLength; column += 1) {
      previousRow[column] = currentRow[column];
    }
  }

  return previousRow[rightLength];
}

function findTypoMatches(candidates, normalizedQuery, getText, limit) {
  const maxDistance = getMaxDistance(normalizedQuery);
  const scoredMatches = [];

  for (const candidate of candidates) {
    const candidateText = normalize(getText(candidate));
    const distance = getBoundedEditDistance(normalizedQuery, candidateText, maxDistance);

    if (distance <= maxDistance) {
      scoredMatches.push({ candidate, distance, textLength: candidateText.length });
    }
  }

  scoredMatches.sort((left, right) => {
    if (left.distance !== right.distance) {
      return left.distance - right.distance;
    }

    if (left.textLength !== right.textLength) {
      return left.textLength - right.textLength;
    }

    return normalize(getText(left.candidate)).localeCompare(normalize(getText(right.candidate)));
  });

  return scoredMatches.slice(0, limit).map((match) => match.candidate);
}

function findForwardSuggestions(entries, normalizedQuery) {
  const startsWithMatches = [];
  const containsMatches = [];

  for (const entry of entries) {
    const normalizedWord = normalize(entry.word);

    if (normalizedWord.startsWith(normalizedQuery)) {
      startsWithMatches.push(entry);
      continue;
    }

    if (normalizedWord.includes(normalizedQuery)) {
      containsMatches.push(entry);
    }
  }

  const directMatches = uniqueByWord([...startsWithMatches, ...containsMatches]);

  if (directMatches.length > 0) {
    return directMatches.slice(0, 10);
  }

  return findTypoMatches(uniqueByWord(entries), normalizedQuery, (entry) => entry.word, 10);
}

function findReverseSuggestions(entries, normalizedQuery) {
  const startsWithMatches = [];
  const containsMatches = [];

  for (const entry of entries) {
    for (const term of getReverseLookupTerms(entry)) {
      const normalizedTerm = normalize(term);

      if (normalizedTerm.startsWith(normalizedQuery)) {
        startsWithMatches.push({ entry, term });
        continue;
      }

      if (normalizedTerm.includes(normalizedQuery)) {
        containsMatches.push({ entry, term });
      }
    }
  }

  const directMatches = uniqueReverseMatches([...startsWithMatches, ...containsMatches]);

  if (directMatches.length > 0) {
    return directMatches.slice(0, 10);
  }

  const reverseCandidates = [];

  for (const entry of entries) {
    for (const term of getReverseLookupTerms(entry)) {
      reverseCandidates.push({ entry, term });
    }
  }

  return findTypoMatches(
    uniqueReverseMatches(reverseCandidates),
    normalizedQuery,
    (match) => match.term,
    10
  );
}

function findMatches(index, query) {
  const normalizedQuery = normalize(query);

  if (!normalizedQuery) {
    return { source: 'word', exact: [], suggestions: [] };
  }

  const exactWordMatches = index.forwardExact.get(normalizedQuery) || [];

  if (exactWordMatches.length > 0) {
    return { source: 'word', exact: exactWordMatches, suggestions: [] };
  }

  const exactTranslationMatches = index.reverseExact.get(normalizedQuery) || [];

  if (exactTranslationMatches.length > 0) {
    return { source: 'translation', exact: exactTranslationMatches, suggestions: [] };
  }

  const wordSuggestions = findForwardSuggestions(index.entries, normalizedQuery);

  if (wordSuggestions.length > 0) {
    return { source: 'word', exact: [], suggestions: wordSuggestions };
  }

  const translationSuggestions = findReverseSuggestions(index.entries, normalizedQuery);

  return {
    source: 'translation',
    exact: [],
    suggestions: translationSuggestions
  };
}

function formatForwardExactMatches(query, matches) {
  const lines = [`Translation for: ${query}`];

  matches.slice(0, 5).forEach((match) => {
    lines.push('');
    lines.push(match.translation);
  });

  return lines.join('\n');
}

function formatReverseExactMatches(query, matches) {
  const firstMatch = matches[0];
  const lines = [`Translation for: ${query}`];

  if (!firstMatch) {
    return lines.join('\n');
  }

  lines.push('');
  lines.push(firstMatch.entry.word);
  lines.push('');
  lines.push(firstMatch.entry.translation);

  return lines.join('\n');
}

function formatForwardSuggestions(query, suggestions) {
  const lines = [`No exact translation found for: ${query}`, '', 'Close matches:'];

  suggestions.forEach((entry, index) => {
    lines.push(`${index + 1}. ${entry.word} -> ${entry.translation.split('\n')[0]}`);
  });

  return lines.join('\n');
}

function formatReverseSuggestions(query, suggestions) {
  const lines = [`No exact translation found for: ${query}`, '', 'Close matches:'];

  suggestions.forEach((match, index) => {
    lines.push(`${index + 1}. ${match.term} -> ${match.entry.word}`);
  });

  return lines.join('\n');
}

const databaseConfig = getDatabaseConfig();
const databasePool = createDatabasePool(databaseConfig);
const bot = new TelegramBot(token, { polling: false });

async function respondWithLookup(chatId, query, meta = {}) {
  const cleanedQuery = String(query || '').trim();

  if (!cleanedQuery) {
    const reply = 'Send a Russian or Crimean Tatar word, or use /translate <word>.';
    bot.sendMessage(chatId, reply);
    logChatSession(databasePool, { chatId, ...meta, query: cleanedQuery, response: reply }).catch(() => {});
    return;
  }

  try {
    const dictionary = await loadDictionaryFromPostgres();
    const index = buildIndex(dictionary);
    const result = findMatches(index, cleanedQuery);

    let message;

    if (result.exact.length > 0) {
      message = result.source === 'translation'
        ? formatReverseExactMatches(cleanedQuery, result.exact)
        : formatForwardExactMatches(cleanedQuery, result.exact);
    } else if (result.suggestions.length > 0) {
      message = result.source === 'translation'
        ? formatReverseSuggestions(cleanedQuery, result.suggestions)
        : formatForwardSuggestions(cleanedQuery, result.suggestions);
    } else {
      message = `No translation found for: ${cleanedQuery}`;
    }

    if (result.exact.length === 0) {
      const reportKeyboard = {
        reply_markup: {
          inline_keyboard: [[
            { text: '⚠️ Report issue', callback_data: `report:${cleanedQuery.slice(0, 57)}` }
          ]]
        }
      };

      bot.sendMessage(chatId, message, reportKeyboard);
    } else {
      bot.sendMessage(chatId, message);
    }
    logChatSession(databasePool, { chatId, ...meta, query: cleanedQuery, response: message }).catch(() => {});
  } catch (error) {
    console.error(`Lookup failed: ${error.message}`);
    const reply = 'Database request failed. Try again later.';
    bot.sendMessage(chatId, reply);
    logChatSession(databasePool, { chatId, ...meta, query: cleanedQuery, response: reply }).catch(() => {});
  }
}

function getMeta(message) {
  return {
    username: message.from && message.from.username,
    firstName: message.from && message.from.first_name
  };
}

bot.onText(/^\/start$/, (message) => {
  const reply = [
    'Russian -> Crimean Tatar dictionary bot.',
    'Crimean Tatar -> Russian lookup is also supported.',
    '',
    'Commands:',
    '/translate <word> - find translation',
    '/report <word> - report a translation issue',
    '/help - show help',
    '',
    'You can also just send a Russian or Crimean Tatar word directly.'
  ].join('\n');
  bot.sendMessage(message.chat.id, reply);
  logChatSession(databasePool, { chatId: message.chat.id, ...getMeta(message), query: '/start', response: reply }).catch(() => {});
});

bot.onText(/^\/help$/, (message) => {
  const reply = [
    'Usage examples:',
    '/translate яблоко',
    '/translate alma',
    '/translate язык',
    '',
    'Or send a word without a command.',
    '',
    'Found a wrong translation? Use /report <word>.'
  ].join('\n');
  bot.sendMessage(message.chat.id, reply);
  logChatSession(databasePool, { chatId: message.chat.id, ...getMeta(message), query: '/help', response: reply }).catch(() => {});
});

bot.onText(/^\/report(?:\s+(.+))?$/i, async (message, match) => {
  const word = match && match[1] ? match[1].trim() : '';

  if (!word) {
    bot.sendMessage(message.chat.id, 'Usage: /report <word>\nExample: /report яблоко');
    return;
  }

  try {
    await logReport(databasePool, { chatId: message.chat.id, ...getMeta(message), word });
    bot.sendMessage(message.chat.id, `Thank you! Your report for "${word}" has been submitted.`);
  } catch (error) {
    console.error(`Failed to save report: ${error.message}`);
    bot.sendMessage(message.chat.id, 'Failed to submit report. Try again later.');
  }
});

bot.onText(/^\/translate(?:\s+(.+))?$/i, (message, match) => {
  void respondWithLookup(message.chat.id, match && match[1], getMeta(message));
});

bot.on('message', (message) => {
  if (typeof message.text !== 'string') {
    return;
  }

  if (message.text.startsWith('/')) {
    return;
  }

  void respondWithLookup(message.chat.id, message.text, getMeta(message));
});

bot.on('callback_query', async (query) => {
  if (!query.data || !query.data.startsWith('report:')) {
    return;
  }

  const word = query.data.slice('report:'.length);
  const meta = {
    username: query.from && query.from.username,
    firstName: query.from && query.from.first_name
  };

  try {
    await logReport(databasePool, { chatId: query.message.chat.id, ...meta, word });
    bot.answerCallbackQuery(query.id, { text: 'Report submitted. Thank you!' });
  } catch (error) {
    console.error(`Failed to save report: ${error.message}`);
    bot.answerCallbackQuery(query.id, { text: 'Failed to submit report. Try again later.' });
  }
});

bot.on('polling_error', (error) => {
  console.error('Polling error:', error.message);
});

async function startBot() {
  const client = createDatabaseClient(databaseConfig);

  await client.connect();
  await client.end();
  await ensureChatSessionsTable(databasePool);
  await ensureReportsTable(databasePool);
  await bot.startPolling();
  console.log(
    `Bot is running. Every lookup reads dictionary data from PostgreSQL table ${databaseConfig.table}.`
  );
}

startBot().catch((error) => {
  console.error(`Failed to start bot: ${error.message}`);
  process.exit(1);
});