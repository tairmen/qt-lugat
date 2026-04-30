const express = require('express');
require('dotenv').config();

const { createDatabaseClient, getDatabaseConfig } = require('./database');

const app = express();
const databaseConfig = getDatabaseConfig();
const adminPort = Number(process.env.ADMIN_PORT || 3000);
const adminUsername = process.env.ADMIN_USERNAME || 'admin';
const adminPassword = process.env.ADMIN_PASSWORD;

if (!adminPassword) {
  throw new Error('ADMIN_PASSWORD is not set. Add it to your .env file.');
}

app.use(express.urlencoded({ extended: false }));

function escapeHtml(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function layout(title, content) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(title)}</title>
  <style>
    :root {
      --bg: #f6f3ec;
      --panel: #fffdf8;
      --line: #d7cfbf;
      --text: #1e1b16;
      --muted: #6b6256;
      --accent: #14532d;
      --accent-soft: #e7f4ea;
      --danger: #8a1c1c;
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      font-family: Georgia, "Times New Roman", serif;
      background: linear-gradient(180deg, #efe7d7 0%, var(--bg) 35%, #f9f7f1 100%);
      color: var(--text);
    }
    .shell {
      max-width: 1180px;
      margin: 0 auto;
      padding: 32px 20px 48px;
    }
    .topbar {
      display: flex;
      justify-content: space-between;
      gap: 16px;
      align-items: end;
      margin-bottom: 24px;
      flex-wrap: wrap;
    }
    .title {
      margin: 0;
      font-size: 36px;
      line-height: 1;
    }
    .subtitle {
      margin: 6px 0 0;
      color: var(--muted);
      font-size: 15px;
    }
    .panel {
      background: var(--panel);
      border: 1px solid var(--line);
      border-radius: 16px;
      padding: 18px;
      box-shadow: 0 10px 30px rgba(60, 44, 18, 0.06);
    }
    .toolbar {
      display: flex;
      gap: 12px;
      flex-wrap: wrap;
      align-items: center;
      margin-bottom: 18px;
    }
    .toolbar form {
      display: flex;
      gap: 10px;
      flex-wrap: wrap;
      align-items: center;
      flex: 1;
    }
    input, textarea, select, button, a.button {
      font: inherit;
    }
    input, textarea, select {
      width: 100%;
      border: 1px solid var(--line);
      border-radius: 10px;
      padding: 10px 12px;
      background: #fff;
      color: var(--text);
    }
    textarea {
      min-height: 180px;
      resize: vertical;
    }
    button, a.button {
      display: inline-block;
      border: 0;
      border-radius: 10px;
      padding: 10px 14px;
      background: var(--accent);
      color: white;
      text-decoration: none;
      cursor: pointer;
    }
    a.button.secondary, button.secondary {
      background: #eae4d6;
      color: var(--text);
    }
    button.danger {
      background: var(--danger);
    }
    table {
      width: 100%;
      border-collapse: collapse;
    }
    th, td {
      text-align: left;
      vertical-align: top;
      padding: 12px 10px;
      border-top: 1px solid #ece5d8;
      font-size: 14px;
    }
    th {
      color: var(--muted);
      font-weight: 600;
      border-top: 0;
    }
    .mono {
      font-family: Consolas, "Courier New", monospace;
      font-size: 13px;
    }
    .translation-cell {
      max-width: 460px;
      white-space: pre-wrap;
    }
    .flash {
      margin-bottom: 16px;
      padding: 12px 14px;
      border-radius: 12px;
      background: var(--accent-soft);
      color: var(--accent);
    }
    .grid {
      display: grid;
      gap: 14px;
      grid-template-columns: repeat(2, minmax(0, 1fr));
    }
    .field label {
      display: block;
      margin-bottom: 6px;
      color: var(--muted);
      font-size: 14px;
    }
    .actions {
      display: flex;
      gap: 8px;
      flex-wrap: wrap;
    }
    .pager {
      display: flex;
      justify-content: space-between;
      gap: 12px;
      margin-top: 18px;
      flex-wrap: wrap;
      align-items: center;
    }
    nav {
      display: flex;
      gap: 6px;
      margin-bottom: 24px;
    }
    nav a {
      display: inline-block;
      padding: 7px 14px;
      border-radius: 8px;
      text-decoration: none;
      font-size: 14px;
      color: var(--muted);
      border: 1px solid transparent;
    }
    nav a:hover {
      background: var(--accent-soft);
      color: var(--accent);
    }
    nav a.active {
      background: var(--accent-soft);
      color: var(--accent);
      border-color: #b2d9bc;
      font-weight: 600;
    }
    @media (max-width: 800px) {
      .grid { grid-template-columns: 1fr; }
      th:nth-child(4), td:nth-child(4), th:nth-child(5), td:nth-child(5) { display: none; }
      .title { font-size: 28px; }
    }
  </style>
</head>
<body>
  <div class="shell">
    <nav>
      <a href="/words" class="${title.includes('Session') || title.includes('User') ? '' : 'active'}">Words</a>
      <a href="/users" class="${title.includes('User') ? 'active' : ''}">Users</a>
      <a href="/sessions" class="${title.includes('Session') && !title.includes('User') ? 'active' : ''}">Sessions</a>
    </nav>
    ${content}
  </div>
</body>
</html>`;
}

function requireBasicAuth(req, res, next) {
  const header = req.headers.authorization || '';

  if (!header.startsWith('Basic ')) {
    res.set('WWW-Authenticate', 'Basic realm="Lugat Admin"');
    res.status(401).send('Authentication required');
    return;
  }

  const decoded = Buffer.from(header.slice(6), 'base64').toString('utf8');
  const separatorIndex = decoded.indexOf(':');
  const username = separatorIndex >= 0 ? decoded.slice(0, separatorIndex) : decoded;
  const password = separatorIndex >= 0 ? decoded.slice(separatorIndex + 1) : '';

  if (username !== adminUsername || password !== adminPassword) {
    res.set('WWW-Authenticate', 'Basic realm="Lugat Admin"');
    res.status(401).send('Invalid credentials');
    return;
  }

  next();
}

function parsePositiveInt(value, fallbackValue) {
  const number = Number(value);
  if (Number.isInteger(number) && number > 0) {
    return number;
  }

  return fallbackValue;
}

function createWhereClause(search) {
  if (!search) {
    return { clause: '', values: [] };
  }

  return {
    clause: 'WHERE word ILIKE $1 OR translation ILIKE $1 OR language ILIKE $1',
    values: [`%${search}%`]
  };
}

function renderWordForm(title, action, values, submitLabel) {
  return layout(
    title,
    `<div class="topbar">
      <div>
        <h1 class="title">${escapeHtml(title)}</h1>
        <p class="subtitle">Edit PostgreSQL dictionary records directly.</p>
      </div>
      <a class="button secondary" href="/words">Back To List</a>
    </div>
    <div class="panel">
      <form method="post" action="${escapeHtml(action)}">
        <div class="grid">
          <div class="field">
            <label for="word">Word</label>
            <input id="word" name="word" value="${escapeHtml(values.word)}" required>
          </div>
          <div class="field">
            <label for="language">Language</label>
            <input id="language" name="language" value="${escapeHtml(values.language)}" placeholder="R">
          </div>
          <div class="field">
            <label for="status">Status</label>
            <input id="status" name="status" value="${escapeHtml(values.status)}" placeholder="1">
          </div>
          <div class="field">
            <label for="id">ID</label>
            <input id="id" name="id" value="${escapeHtml(values.id)}" placeholder="Auto if empty on create">
          </div>
        </div>
        <div class="field" style="margin-top: 14px;">
          <label for="translation">Translation</label>
          <textarea id="translation" name="translation" required>${escapeHtml(values.translation)}</textarea>
        </div>
        <div class="actions" style="margin-top: 16px;">
          <button type="submit">${escapeHtml(submitLabel)}</button>
          <a class="button secondary" href="/words">Cancel</a>
        </div>
      </form>
    </div>`
  );
}

app.use(requireBasicAuth);

app.get('/', (req, res) => {
  res.redirect('/words');
});

app.get('/words', async (req, res, next) => {
  const page = parsePositiveInt(req.query.page, 1);
  const perPage = 50;
  const search = String(req.query.search || '').trim();
  const flash = String(req.query.flash || '').trim();
  const offset = (page - 1) * perPage;

  const client = createDatabaseClient(databaseConfig);

  try {
    await client.connect();

    const where = createWhereClause(search);
    const countResult = await client.query(
      `SELECT COUNT(*)::int AS count FROM ${databaseConfig.table} ${where.clause}`,
      where.values
    );
    const totalRows = countResult.rows[0].count;
    const totalPages = Math.max(1, Math.ceil(totalRows / perPage));

    const listValues = [...where.values, perPage, offset];
    const limitParam = where.values.length + 1;
    const offsetParam = where.values.length + 2;
    const listResult = await client.query(
      `
        SELECT id, word, translation, language, status, created_at, updated_at
        FROM ${databaseConfig.table}
        ${where.clause}
        ORDER BY id DESC
        LIMIT $${limitParam} OFFSET $${offsetParam}
      `,
      listValues
    );

    const prevPage = page > 1 ? page - 1 : null;
    const nextPage = page < totalPages ? page + 1 : null;
    const searchPart = search ? `&search=${encodeURIComponent(search)}` : '';
    const flashHtml = flash ? `<div class="flash">${escapeHtml(flash)}</div>` : '';

    const rowsHtml = listResult.rows.map((row) => `
      <tr>
        <td class="mono">${escapeHtml(row.id)}</td>
        <td>${escapeHtml(row.word)}</td>
        <td class="translation-cell">${escapeHtml(row.translation)}</td>
        <td>${escapeHtml(row.language || '')}</td>
        <td>${escapeHtml(row.status ?? '')}</td>
        <td>
          <div class="actions">
            <a class="button secondary" href="/words/${encodeURIComponent(row.id)}/edit">Edit</a>
            <form method="post" action="/words/${encodeURIComponent(row.id)}/delete" onsubmit="return confirm('Delete this word?');">
              <button type="submit" class="danger">Delete</button>
            </form>
          </div>
        </td>
      </tr>
    `).join('');

    res.send(layout(
      'Lugat Admin',
      `<div class="topbar">
        <div>
          <h1 class="title">Lugat Admin</h1>
          <p class="subtitle">Manage words in PostgreSQL table ${escapeHtml(databaseConfig.table)}. Restart the bot after changes so Telegram uses updated data.</p>
        </div>
        <a class="button" href="/words/new">Add Word</a>
      </div>
      ${flashHtml}
      <div class="panel">
        <div class="toolbar">
          <form method="get" action="/words">
            <input name="search" value="${escapeHtml(search)}" placeholder="Search by word or translation">
            <button type="submit">Search</button>
            <a class="button secondary" href="/words">Reset</a>
          </form>
        </div>
        <table>
          <thead>
            <tr>
              <th>ID</th>
              <th>Word</th>
              <th>Translation</th>
              <th>Language</th>
              <th>Status</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            ${rowsHtml || '<tr><td colspan="6">No records found.</td></tr>'}
          </tbody>
        </table>
        <div class="pager">
          <div>Page ${page} of ${totalPages} · ${totalRows} rows</div>
          <div class="actions">
            ${prevPage ? `<a class="button secondary" href="/words?page=${prevPage}${searchPart}">Previous</a>` : ''}
            ${nextPage ? `<a class="button secondary" href="/words?page=${nextPage}${searchPart}">Next</a>` : ''}
          </div>
        </div>
      </div>`
    ));
  } catch (error) {
    next(error);
  } finally {
    await client.end().catch(() => {});
  }
});

app.get('/words/new', (req, res) => {
  res.send(renderWordForm('Add Word', '/words', {
    id: '',
    word: '',
    translation: '',
    language: 'R',
    status: '1'
  }, 'Create Word'));
});

app.post('/words', async (req, res, next) => {
  const client = createDatabaseClient(databaseConfig);

  try {
    await client.connect();

    const word = String(req.body.word || '').trim();
    const translation = String(req.body.translation || '').trim();
    const language = String(req.body.language || 'R').trim() || 'R';
    const status = req.body.status === '' ? null : Number(req.body.status);
    const requestedId = String(req.body.id || '').trim();

    if (!word || !translation) {
      throw new Error('Word and translation are required.');
    }

    const idResult = requestedId
      ? { rows: [{ id: Number(requestedId) }] }
      : await client.query(`SELECT COALESCE(MAX(id), 0) + 1 AS id FROM ${databaseConfig.table}`);

    const id = idResult.rows[0].id;

    await client.query(
      `
        INSERT INTO ${databaseConfig.table} (id, word, translation, language, status, created_at, updated_at)
        VALUES ($1, $2, $3, $4, $5, NOW(), NOW())
      `,
      [id, word, translation, language, Number.isNaN(status) ? null : status]
    );

    res.redirect('/words?flash=' + encodeURIComponent('Word created successfully. Restart bot to reload dictionary.'));
  } catch (error) {
    next(error);
  } finally {
    await client.end().catch(() => {});
  }
});

app.get('/words/:id/edit', async (req, res, next) => {
  const client = createDatabaseClient(databaseConfig);

  try {
    await client.connect();
    const result = await client.query(
      `SELECT id, word, translation, language, status FROM ${databaseConfig.table} WHERE id = $1`,
      [req.params.id]
    );

    if (result.rows.length === 0) {
      res.status(404).send(layout('Not Found', '<div class="panel">Word not found.</div>'));
      return;
    }

    const row = result.rows[0];
    res.send(renderWordForm(`Edit Word #${row.id}`, `/words/${encodeURIComponent(row.id)}`, {
      id: row.id,
      word: row.word,
      translation: row.translation,
      language: row.language || '',
      status: row.status ?? ''
    }, 'Save Changes'));
  } catch (error) {
    next(error);
  } finally {
    await client.end().catch(() => {});
  }
});

app.post('/words/:id', async (req, res, next) => {
  const client = createDatabaseClient(databaseConfig);

  try {
    await client.connect();

    const word = String(req.body.word || '').trim();
    const translation = String(req.body.translation || '').trim();
    const language = String(req.body.language || 'R').trim() || 'R';
    const status = req.body.status === '' ? null : Number(req.body.status);
    const newIdRaw = String(req.body.id || '').trim();
    const newId = newIdRaw ? Number(newIdRaw) : Number(req.params.id);

    if (!word || !translation) {
      throw new Error('Word and translation are required.');
    }

    await client.query(
      `
        UPDATE ${databaseConfig.table}
        SET id = $1,
            word = $2,
            translation = $3,
            language = $4,
            status = $5,
            updated_at = NOW()
        WHERE id = $6
      `,
      [newId, word, translation, language, Number.isNaN(status) ? null : status, req.params.id]
    );

    res.redirect('/words?flash=' + encodeURIComponent('Word updated successfully. Restart bot to reload dictionary.'));
  } catch (error) {
    next(error);
  } finally {
    await client.end().catch(() => {});
  }
});

app.post('/words/:id/delete', async (req, res, next) => {
  const client = createDatabaseClient(databaseConfig);

  try {
    await client.connect();
    await client.query(`DELETE FROM ${databaseConfig.table} WHERE id = $1`, [req.params.id]);
    res.redirect('/words?flash=' + encodeURIComponent('Word deleted successfully. Restart bot to reload dictionary.'));
  } catch (error) {
    next(error);
  } finally {
    await client.end().catch(() => {});
  }
});

app.get('/users', async (req, res, next) => {
  const page = parsePositiveInt(req.query.page, 1);
  const perPage = 50;
  const search = String(req.query.search || '').trim();
  const offset = (page - 1) * perPage;

  const client = createDatabaseClient(databaseConfig);

  try {
    await client.connect();

    const where = search
      ? { clause: 'WHERE username ILIKE $1 OR first_name ILIKE $1 OR chat_id::text ILIKE $1', values: [`%${search}%`] }
      : { clause: '', values: [] };

    const countResult = await client.query(
      `SELECT COUNT(DISTINCT chat_id)::int AS count FROM chat_sessions ${where.clause}`,
      where.values
    );
    const totalRows = countResult.rows[0].count;
    const totalPages = Math.max(1, Math.ceil(totalRows / perPage));

    const limitParam = where.values.length + 1;
    const offsetParam = where.values.length + 2;
    const listResult = await client.query(
      `SELECT chat_id,
              MAX(username) AS username,
              MAX(first_name) AS first_name,
              COUNT(*)::int AS total_sessions,
              MIN(created_at) AS first_seen,
              MAX(created_at) AS last_seen
       FROM chat_sessions
       ${where.clause}
       GROUP BY chat_id
       ORDER BY last_seen DESC
       LIMIT $${limitParam} OFFSET $${offsetParam}`,
      [...where.values, perPage, offset]
    );

    const prevPage = page > 1 ? page - 1 : null;
    const nextPage = page < totalPages ? page + 1 : null;
    const searchPart = search ? `&search=${encodeURIComponent(search)}` : '';

    const rowsHtml = listResult.rows.map((row) => `
      <tr>
        <td class="mono">${escapeHtml(row.chat_id)}</td>
        <td>${escapeHtml(row.username ? '@' + row.username : '')}</td>
        <td>${escapeHtml(row.first_name || '')}</td>
        <td class="mono">${escapeHtml(row.total_sessions)}</td>
        <td class="mono" style="white-space:nowrap">${escapeHtml(new Date(row.first_seen).toISOString().replace('T', ' ').slice(0, 19))}</td>
        <td class="mono" style="white-space:nowrap">${escapeHtml(new Date(row.last_seen).toISOString().replace('T', ' ').slice(0, 19))}</td>
        <td><a class="button secondary" href="/users/${encodeURIComponent(row.chat_id)}/sessions">View Sessions</a></td>
      </tr>
    `).join('');

    res.send(layout(
      'Users',
      `<div class="topbar">
        <div>
          <h1 class="title">Users</h1>
          <p class="subtitle">All unique Telegram users who have interacted with the bot.</p>
        </div>
      </div>
      <div class="panel">
        <div class="toolbar">
          <form method="get" action="/users">
            <input name="search" value="${escapeHtml(search)}" placeholder="Search by username, name or chat ID">
            <button type="submit">Search</button>
            <a class="button secondary" href="/users">Reset</a>
          </form>
        </div>
        <table>
          <thead>
            <tr>
              <th>Chat ID</th>
              <th>Username</th>
              <th>Name</th>
              <th>Sessions</th>
              <th>First Seen</th>
              <th>Last Seen</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            ${rowsHtml || '<tr><td colspan="7">No users found.</td></tr>'}
          </tbody>
        </table>
        <div class="pager">
          <div>Page ${page} of ${totalPages} · ${totalRows} users</div>
          <div class="actions">
            ${prevPage ? `<a class="button secondary" href="/users?page=${prevPage}${searchPart}">Previous</a>` : ''}
            ${nextPage ? `<a class="button secondary" href="/users?page=${nextPage}${searchPart}">Next</a>` : ''}
          </div>
        </div>
      </div>`
    ));
  } catch (error) {
    next(error);
  } finally {
    await client.end().catch(() => {});
  }
});

app.get('/users/:chatId/sessions', async (req, res, next) => {
  const chatId = req.params.chatId;
  const page = parsePositiveInt(req.query.page, 1);
  const perPage = 50;
  const offset = (page - 1) * perPage;

  const client = createDatabaseClient(databaseConfig);

  try {
    await client.connect();

    const userResult = await client.query(
      `SELECT chat_id, MAX(username) AS username, MAX(first_name) AS first_name
       FROM chat_sessions WHERE chat_id = $1 GROUP BY chat_id`,
      [chatId]
    );

    if (userResult.rows.length === 0) {
      res.status(404).send(layout('User Sessions', '<div class="panel">User not found.</div>'));
      return;
    }

    const user = userResult.rows[0];
    const displayName = user.username ? '@' + user.username : (user.first_name || String(user.chat_id));

    const countResult = await client.query(
      `SELECT COUNT(*)::int AS count FROM chat_sessions WHERE chat_id = $1`,
      [chatId]
    );
    const totalRows = countResult.rows[0].count;
    const totalPages = Math.max(1, Math.ceil(totalRows / perPage));

    const listResult = await client.query(
      `SELECT id, query, response, created_at
       FROM chat_sessions
       WHERE chat_id = $1
       ORDER BY id DESC
       LIMIT $2 OFFSET $3`,
      [chatId, perPage, offset]
    );

    const prevPage = page > 1 ? page - 1 : null;
    const nextPage = page < totalPages ? page + 1 : null;

    const rowsHtml = listResult.rows.map((row) => `
      <tr>
        <td class="mono">${escapeHtml(row.id)}</td>
        <td>${escapeHtml(row.query || '')}</td>
        <td class="translation-cell">${escapeHtml(row.response || '')}</td>
        <td class="mono" style="white-space:nowrap">${escapeHtml(new Date(row.created_at).toISOString().replace('T', ' ').slice(0, 19))}</td>
      </tr>
    `).join('');

    res.send(layout(
      `User Sessions: ${displayName}`,
      `<div class="topbar">
        <div>
          <h1 class="title">${escapeHtml(displayName)}</h1>
          <p class="subtitle">Chat ID: ${escapeHtml(user.chat_id)} · ${totalRows} sessions total.</p>
        </div>
        <a class="button secondary" href="/users">Back to Users</a>
      </div>
      <div class="panel">
        <table>
          <thead>
            <tr>
              <th>ID</th>
              <th>Query</th>
              <th>Response</th>
              <th>Time</th>
            </tr>
          </thead>
          <tbody>
            ${rowsHtml || '<tr><td colspan="4">No sessions found.</td></tr>'}
          </tbody>
        </table>
        <div class="pager">
          <div>Page ${page} of ${totalPages} · ${totalRows} rows</div>
          <div class="actions">
            ${prevPage ? `<a class="button secondary" href="/users/${encodeURIComponent(chatId)}/sessions?page=${prevPage}">Previous</a>` : ''}
            ${nextPage ? `<a class="button secondary" href="/users/${encodeURIComponent(chatId)}/sessions?page=${nextPage}">Next</a>` : ''}
          </div>
        </div>
      </div>`
    ));
  } catch (error) {
    next(error);
  } finally {
    await client.end().catch(() => {});
  }
});

app.get('/sessions', async (req, res, next) => {
  const page = parsePositiveInt(req.query.page, 1);
  const perPage = 50;
  const search = String(req.query.search || '').trim();
  const offset = (page - 1) * perPage;

  const client = createDatabaseClient(databaseConfig);

  try {
    await client.connect();

    const where = search
      ? { clause: 'WHERE query ILIKE $1 OR response ILIKE $1 OR username ILIKE $1', values: [`%${search}%`] }
      : { clause: '', values: [] };

    const countResult = await client.query(
      `SELECT COUNT(*)::int AS count FROM chat_sessions ${where.clause}`,
      where.values
    );
    const totalRows = countResult.rows[0].count;
    const totalPages = Math.max(1, Math.ceil(totalRows / perPage));

    const limitParam = where.values.length + 1;
    const offsetParam = where.values.length + 2;
    const listResult = await client.query(
      `SELECT id, chat_id, username, first_name, query, response, created_at
       FROM chat_sessions
       ${where.clause}
       ORDER BY id DESC
       LIMIT $${limitParam} OFFSET $${offsetParam}`,
      [...where.values, perPage, offset]
    );

    const prevPage = page > 1 ? page - 1 : null;
    const nextPage = page < totalPages ? page + 1 : null;
    const searchPart = search ? `&search=${encodeURIComponent(search)}` : '';

    const rowsHtml = listResult.rows.map((row) => `
      <tr>
        <td class="mono">${escapeHtml(row.id)}</td>
        <td class="mono">${escapeHtml(row.chat_id)}</td>
        <td>${escapeHtml(row.username ? '@' + row.username : row.first_name || '')}</td>
        <td>${escapeHtml(row.query || '')}</td>
        <td class="translation-cell">${escapeHtml(row.response || '')}</td>
        <td class="mono" style="white-space:nowrap">${escapeHtml(new Date(row.created_at).toISOString().replace('T', ' ').slice(0, 19))}</td>
      </tr>
    `).join('');

    res.send(layout(
      'Sessions',
      `<div class="topbar">
        <div>
          <h1 class="title">Sessions</h1>
          <p class="subtitle">Every query sent to the Telegram bot and the response it returned.</p>
        </div>
      </div>
      <div class="panel">
        <div class="toolbar">
          <form method="get" action="/sessions">
            <input name="search" value="${escapeHtml(search)}" placeholder="Search by query, response or username">
            <button type="submit">Search</button>
            <a class="button secondary" href="/sessions">Reset</a>
          </form>
        </div>
        <table>
          <thead>
            <tr>
              <th>ID</th>
              <th>Chat ID</th>
              <th>User</th>
              <th>Query</th>
              <th>Response</th>
              <th>Time</th>
            </tr>
          </thead>
          <tbody>
            ${rowsHtml || '<tr><td colspan="6">No sessions found.</td></tr>'}
          </tbody>
        </table>
        <div class="pager">
          <div>Page ${page} of ${totalPages} · ${totalRows} rows</div>
          <div class="actions">
            ${prevPage ? `<a class="button secondary" href="/sessions?page=${prevPage}${searchPart}">Previous</a>` : ''}
            ${nextPage ? `<a class="button secondary" href="/sessions?page=${nextPage}${searchPart}">Next</a>` : ''}
          </div>
        </div>
      </div>`
    ));
  } catch (error) {
    next(error);
  } finally {
    await client.end().catch(() => {});
  }
});

app.use((error, req, res, next) => {
  res.status(500).send(layout(
    'Admin Error',
    `<div class="topbar">
      <div>
        <h1 class="title">Admin Error</h1>
        <p class="subtitle">The admin panel failed while handling your request.</p>
      </div>
      <a class="button secondary" href="/words">Back To List</a>
    </div>
    <div class="panel">
      <div class="flash" style="background:#fdebec;color:#8a1c1c;">${escapeHtml(error.message)}</div>
    </div>`
  ));
});

app.listen(adminPort, () => {
  console.log(`Admin panel is running at http://localhost:${adminPort}`);
});