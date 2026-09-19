const express = require('express');
const { randomBytes } = require('node:crypto');

function createTranslationAdmin({ pool, layout, escapeHtml: esc, adminUsername }) {
  const router = express.Router();
  const csrf = randomBytes(32).toString('hex');
  const token = () => `<input type="hidden" name="csrf" value="${csrf}">`;
  const direction = target => target === 'crh' ? 'Русский → Крымскотатарский' : 'Крымскотатарский → Русский';
  const date = value => new Date(value).toLocaleString('ru-RU', { timeZone: 'UTC' }) + ' UTC';
  const page = (title, body) => layout(title, `<div class="topbar"><h1 class="title">${esc(title)}</h1></div>${body}`);
  const textBlock = value => `<div class="translation-cell" style="max-width:none;overflow-wrap:anywhere">${esc(value)}</div>`;
  const route = fn => async (req, res, next) => {
    try { await fn(req, res); } catch (error) {
      if (error.status || error.code === '23505') return res.status(error.status || 409).send(page('Тексты: ошибка',
        `<div class="panel"><p>${esc(error.code === '23505' ? 'Этот перевод уже подтверждён. Откройте список подтверждённых переводов.' : error.message)}</p><a href="/text-translations">История текстов</a> · <a href="/confirmed-translations">Подтверждённые переводы</a></div>`));
      next(error);
    }
  };
  const fail = (message, status = 400) => { const error = new Error(message); error.status = status; throw error; };
  const id = value => { if (!/^[1-9]\d{0,17}$/.test(String(value))) fail('Некорректный ID.'); return String(value); };
  const uuid = value => { if (!/^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/i.test(String(value))) fail('Некорректный ID.'); return value; };
  const field = (value, max, name, required = true) => {
    if (typeof value !== 'string' || value.trim().length > max || (required && !value.trim())) fail(`${name}: требуется ${required ? 'от 1 до' : 'не более'} ${max} символов.`);
    return value.trim();
  };
  router.use((req, res, next) => {
    if (!/^\/(text-translations|confirmed-translations|translation-rules)(\/|$)/.test(req.path)) return next();
    if (req.method === 'POST' && req.body.csrf !== csrf) return res.status(403).send('Обновите страницу и повторите сохранение.');
    next();
  });
  function filters(req) {
    const p = Math.min(100000, Math.max(1, parseInt(req.query.page, 10) || 1));
    return { p, q: String(req.query.q || '').slice(0, 200), target: ['ru', 'crh'].includes(req.query.target) ? req.query.target : '' };
  }
  function searchForm(base, f, extra = '') {
    return `<form method="get" action="${base}" class="panel toolbar">
      <input aria-label="Поиск" name="q" placeholder="Поиск по оригиналу или переводу" value="${esc(f.q)}">
      <select aria-label="Направление" name="target"><option value="">Оба направления</option>${['crh','ru'].map(t => `<option value="${t}" ${f.target === t ? 'selected' : ''}>${direction(t)}</option>`).join('')}</select>
      ${extra}<button>Найти</button></form>`;
  }
  function pager(base, f, count, extra = {}) {
    const link = p => `${base}?${new URLSearchParams({ q: f.q, target: f.target, ...extra, page: String(p) })}`;
    return `<div class="pager"><span>Страница ${f.p}</span><div>${f.p > 1 ? `<a class="button secondary" href="${esc(link(f.p - 1))}">Назад</a>` : ''} ${count > 20 ? `<a class="button secondary" href="${esc(link(f.p + 1))}">Далее</a>` : ''}</div></div>`;
  }

  router.get('/text-translations', route(async (req, res) => {
    const f = filters(req);
    const status = ['reported','failed','completed'].includes(req.query.status) ? req.query.status : '';
    const rows = (await pool.query(`SELECT * FROM text_translations
      WHERE (source_text ILIKE $1 OR COALESCE(translated_text,'') ILIKE $1)
      AND ($2 = '' OR target = $2)
      AND ($3 = '' OR ($3 = 'reported' AND reported) OR status = $3)
      ORDER BY created_at DESC, id DESC LIMIT 21 OFFSET $4`, [`%${f.q}%`, f.target, status, (f.p-1)*20])).rows;
    res.send(page('Тексты: история переводов',
      searchForm('/text-translations', f, `<select aria-label="Статус" name="status">${[['','Все записи'],['reported','С жалобой'],['completed','Переведено'],['failed','Ошибка']].map(([v,l]) => `<option value="${v}" ${v === status ? 'selected' : ''}>${l}</option>`).join('')}</select>`) +
      `<p class="subtitle">Новые запросы из режима /text. Откройте запись, чтобы проверить и подтвердить перевод.</p>` +
      (rows.slice(0,20).map(r => `<article class="panel" style="margin-top:14px"><div class="toolbar"><strong>${direction(r.target)}</strong><span>${esc(date(r.created_at))}</span><span>${r.reported ? '⚠ Жалоба · ' : ''}${r.status === 'failed' ? 'Ошибка' : 'Переведено'}</span></div>
        <div class="grid"><div><h3>Оригинал</h3>${textBlock(r.source_text.slice(0,350))}</div><div><h3>Перевод</h3>${textBlock((r.translated_text || r.error_message || '').slice(0,350))}</div></div>
        <p><a class="button secondary" href="/text-translations/${r.id}">Открыть и проверить</a></p></article>`).join('') || '<div class="panel">Пока нет переводов по выбранным условиям.</div>') + pager('/text-translations', f, rows.length, { status })));
  }));

  router.get('/text-translations/:id', route(async (req, res) => {
    const r = (await pool.query('SELECT * FROM text_translations WHERE id=$1', [uuid(req.params.id)])).rows[0];
    if (!r) fail('Запись не найдена.', 404);
    const confirmed = (await pool.query('SELECT id FROM confirmed_translations WHERE history_id=$1 ORDER BY id LIMIT 1', [r.id])).rows[0];
    res.send(page('Тексты: проверка перевода', `<div class="panel">
      <p>${direction(r.target)} · ${esc(date(r.created_at))} ${r.reported ? '· ⚠ Есть жалоба' : ''}</p>
      <p class="subtitle">Пользователь: ${esc(r.username || r.user_id || r.chat_id)} · Модель: ${esc(r.model || '—')} · Версия правил: ${esc(r.rules_version || '—')} ${r.cached ? '· Из кеша' : ''}</p>
      <div class="grid"><div><h2>Оригинал</h2>${textBlock(r.source_text)}</div><div><h2>Ответ модели</h2>${textBlock(r.translated_text || r.error_message)}</div></div>
      <div class="actions" style="margin-top:20px"><a class="button" href="${confirmed ? `/confirmed-translations/${confirmed.id}` : `/confirmed-translations/new?history=${r.id}`}">${confirmed ? 'Открыть подтверждённый перевод' : 'Исправить и подтвердить'}</a><a class="button secondary" href="/text-translations">К истории</a></div></div>`));
  }));

  router.get('/confirmed-translations', route(async (req, res) => {
    const f = filters(req);
    const rows = (await pool.query(`SELECT * FROM confirmed_translations
      WHERE (source_text ILIKE $1 OR translated_text ILIKE $1) AND ($2 = '' OR target = $2)
      ORDER BY updated_at DESC, id DESC LIMIT 21 OFFSET $3`, [`%${f.q}%`, f.target, (f.p-1)*20])).rows;
    res.send(page('Подтверждённые переводы', `<p>Проверенные человеком примеры используются при переводе похожих текстов в том же направлении.</p><p><a class="button" href="/confirmed-translations/new">Добавить перевод</a></p>` + searchForm('/confirmed-translations', f) +
      (rows.slice(0,20).map(r => `<article class="panel" style="margin-top:14px"><strong>${direction(r.target)}</strong><div class="grid"><div><h3>Оригинал</h3>${textBlock(r.source_text.slice(0,350))}</div><div><h3>Подтверждённый перевод</h3>${textBlock(r.translated_text.slice(0,350))}</div></div><p class="subtitle">${esc(r.confirmed_by)} · ${esc(date(r.updated_at))}</p><p><a class="button secondary" href="/confirmed-translations/${r.id}">Редактировать</a></p></article>`).join('') || '<div class="panel">Подтверждённых переводов пока нет.</div>') + pager('/confirmed-translations', f, rows.length)));
  }));

  function form(r = {}, saved = false) {
    return page('Подтверждённые переводы: ' + (r.id ? 'редактирование' : 'новая запись'), `<div class="panel">${saved ? '<p class="flash">Подтверждённый перевод сохранён.</p>' : ''}<form method="post" action="/confirmed-translations${r.id ? `/${r.id}` : ''}">${token()}
      <input type="hidden" name="version" value="${esc(r.version)}"><input type="hidden" name="history_id" value="${esc(r.history_id)}">
      <div class="field"><label for="target">Направление</label><select id="target" name="target">${['crh','ru'].map(t => `<option value="${t}" ${r.target === t ? 'selected' : ''}>${direction(t)}</option>`).join('')}</select></div>
      <div class="grid" style="margin-top:14px"><div class="field"><label for="source_text">Оригинал</label><textarea id="source_text" name="source_text" maxlength="2000" required>${esc(r.source_text)}</textarea></div><div class="field"><label for="translated_text">Проверенный перевод</label><textarea id="translated_text" name="translated_text" maxlength="12000" required>${esc(r.translated_text)}</textarea></div></div>
      <div class="field"><label for="notes">Заметки для редактора (не передаются модели)</label><textarea id="notes" name="notes" maxlength="4000">${esc(r.notes)}</textarea></div>
      <p>Сохраняйте здесь только проверенные переводы. Изменения применяются к следующим запросам.</p><div class="actions"><button>Сохранить как подтверждённый</button><a class="button secondary" href="/confirmed-translations">Отмена</a></div></form>
      ${r.id ? `<hr><form method="post" action="/confirmed-translations/${r.id}/delete">${token()}<input type="hidden" name="version" value="${r.version}"><p>Удаление исключит пример из следующих запросов. Оригинал в истории сохранится.</p><button class="danger">Удалить подтверждённый пример</button></form>` : ''}</div>`);
  }
  router.get('/confirmed-translations/new', route(async (req, res) => {
    let values = {};
    if (req.query.history) {
      const historyId = uuid(req.query.history);
      const existing = (await pool.query('SELECT id FROM confirmed_translations WHERE history_id=$1 LIMIT 1', [historyId])).rows[0];
      if (existing) return res.redirect(`/confirmed-translations/${existing.id}`);
      const row = (await pool.query('SELECT * FROM text_translations WHERE id=$1', [historyId])).rows[0];
      if (!row) fail('Запись не найдена.', 404);
      values = { history_id: row.id, target: row.target, source_text: row.source_text, translated_text: row.translated_text };
    }
    res.send(form(values));
  }));
  router.get('/confirmed-translations/:id', route(async (req, res) => {
    const row = (await pool.query('SELECT * FROM confirmed_translations WHERE id=$1', [id(req.params.id)])).rows[0];
    if (!row) fail('Запись не найдена.', 404);
    res.send(form(row, req.query.saved === '1'));
  }));
  function values(body) {
    if (!['ru','crh'].includes(body.target)) fail('Выберите направление.');
    return [body.target, field(body.source_text,2000,'Оригинал'), field(body.translated_text,12000,'Перевод'), field(body.notes || '',4000,'Заметки',false)];
  }
  router.post('/confirmed-translations', route(async (req, res) => {
    const v = values(req.body);
    const historyId = req.body.history_id ? uuid(req.body.history_id) : null;
    if (historyId && !(await pool.query('SELECT id FROM text_translations WHERE id=$1', [historyId])).rowCount) fail('Запись истории не найдена.',404);
    const row = (await pool.query(`INSERT INTO confirmed_translations (target,source_text,translated_text,notes,history_id,confirmed_by)
      VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`, [...v,historyId,adminUsername])).rows[0];
    res.redirect(`/confirmed-translations/${row.id}?saved=1`);
  }));
  router.post('/confirmed-translations/:id', route(async (req, res) => {
    const result = await pool.query(`UPDATE confirmed_translations SET target=$1,source_text=$2,translated_text=$3,notes=$4,
      confirmed_by=$5,version=version+1,updated_at=NOW() WHERE id=$6 AND version=$7 RETURNING id`,
      [...values(req.body),adminUsername,id(req.params.id),id(req.body.version)]);
    if (!result.rowCount) fail('Запись изменилась или удалена. Обновите страницу перед сохранением.',409);
    res.redirect(`/confirmed-translations/${req.params.id}?saved=1`);
  }));
  router.post('/confirmed-translations/:id/delete', route(async (req,res) => {
    const result = await pool.query('DELETE FROM confirmed_translations WHERE id=$1 AND version=$2 RETURNING id', [id(req.params.id),id(req.body.version)]);
    if (!result.rowCount) fail('Запись изменилась или удалена. Обновите страницу.',409);
    res.redirect('/confirmed-translations');
  }));

  router.get('/translation-rules', route(async (req,res) => {
    const r = (await pool.query('SELECT * FROM translation_rules WHERE id=1')).rows[0];
    res.send(page('Правила перевода', `<div class="panel">${req.query.saved ? '<p class="flash">Правила сохранены и применяются к новым запросам.</p>' : ''}
      <p>Общие инструкции для всех переводов в обоих направлениях: стиль, терминология, алфавит и другие требования. При необходимости указывайте в правиле, к какому направлению оно относится.</p>
      <p class="subtitle">Версия ${r.version} · ${esc(date(r.updated_at))} · ${esc(r.updated_by || 'Пока не редактировались')}</p>
      <form method="post" action="/translation-rules">${token()}<input type="hidden" name="version" value="${r.version}">
      <div class="field"><label for="body">Инструкции</label><textarea id="body" name="body" maxlength="12000" style="min-height:320px" placeholder="Например: используйте современный литературный язык; сохраняйте имена и числа; не добавляйте пояснений.">${esc(r.body)}</textarea></div>
      <p>До 12 000 символов. Пустое поле оставляет только базовые инструкции переводчика. Правила влияют на следующие запросы; история не переписывается.</p><button>Сохранить правила</button></form></div>`));
  }));
  router.post('/translation-rules', route(async (req,res) => {
    const result = await pool.query(`UPDATE translation_rules SET body=$1,version=version+1,updated_by=$2,updated_at=NOW()
      WHERE id=1 AND version=$3 RETURNING version`, [field(req.body.body,12000,'Правила',false),adminUsername,id(req.body.version)]);
    if (!result.rowCount) fail('Правила уже изменены в другой вкладке. Обновите страницу.',409);
    res.redirect('/translation-rules?saved=1');
  }));
  return router;
}

module.exports = { createTranslationAdmin };
