const { randomUUID } = require('node:crypto');

async function ensureTranslationTables(pool) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    // Both the bot and admin can start at once.
    await client.query('SELECT pg_advisory_xact_lock(73109422)');
    await client.query(`
      CREATE TABLE IF NOT EXISTS translation_rules (
        id INTEGER PRIMARY KEY CHECK (id = 1), body TEXT NOT NULL DEFAULT '',
        version INTEGER NOT NULL DEFAULT 1, updated_by TEXT,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      INSERT INTO translation_rules(id) VALUES(1) ON CONFLICT DO NOTHING;
      CREATE TABLE IF NOT EXISTS text_translations (
        id UUID PRIMARY KEY, chat_id BIGINT NOT NULL, user_id BIGINT,
        username TEXT, target TEXT NOT NULL CHECK (target IN ('ru', 'crh')),
        source_text TEXT NOT NULL, translated_text TEXT, model TEXT,
        rules_version INTEGER, cached BOOLEAN NOT NULL DEFAULT FALSE,
        status TEXT NOT NULL CHECK (status IN ('completed', 'failed')),
        error_message TEXT, reported BOOLEAN NOT NULL DEFAULT FALSE,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS text_translations_created_idx ON text_translations(created_at DESC);
      CREATE TABLE IF NOT EXISTS confirmed_translations (
        id BIGSERIAL PRIMARY KEY, target TEXT NOT NULL CHECK (target IN ('ru', 'crh')),
        source_text TEXT NOT NULL CHECK (char_length(source_text) BETWEEN 1 AND 2000),
        translated_text TEXT NOT NULL CHECK (char_length(translated_text) BETWEEN 1 AND 12000),
        notes TEXT NOT NULL DEFAULT '', history_id UUID REFERENCES text_translations(id) ON DELETE SET NULL,
        confirmed_by TEXT NOT NULL, version INTEGER NOT NULL DEFAULT 1,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS confirmed_translations_search_idx
        ON confirmed_translations USING GIN (to_tsvector('simple', source_text));
      CREATE UNIQUE INDEX IF NOT EXISTS confirmed_translations_history_idx
        ON confirmed_translations(history_id) WHERE history_id IS NOT NULL;
    `);
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally { client.release(); }
}

function createTranslationStore(pool) {
  return {
    async context({ text, target }) {
      const tokens = [...new Set(text.toLowerCase().match(/[\p{L}\p{N}]+/gu) || [])].slice(0, 100);
      const rules = (await pool.query('SELECT body, version FROM translation_rules WHERE id = 1')).rows[0];
      const examples = (await pool.query(`SELECT id, source_text, translated_text FROM confirmed_translations
        WHERE target = $1 AND (source_text = $2 OR to_tsvector('simple', source_text) @@ to_tsquery('simple', $3))
        ORDER BY (source_text = $2) DESC,
          ts_rank(to_tsvector('simple', source_text), to_tsquery('simple', $3)) DESC, updated_at DESC, id DESC
        LIMIT 5`, [target, text, tokens.join(' | ')])).rows;
      const selected = [];
      let size = 0;
      for (const example of examples) {
        const length = JSON.stringify(example).length;
        if (size + length > 16000) continue;
        selected.push(example);
        size += length;
      }
      return { rules: rules.body, version: rules.version, examples: selected };
    },
    async record({ chatId, userId, username, text, target, result, model, rulesVersion, cached = false, error }) {
      const id = randomUUID();
      await pool.query(`INSERT INTO text_translations
        (id, chat_id, user_id, username, target, source_text, translated_text, model, rules_version, cached, status, error_message)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
      [id, chatId, userId || null, username || null, target, text, result || null, model || null,
        rulesVersion || null, cached, error ? 'failed' : 'completed', error || null]);
      return id;
    },
    async report(id, chatId, userId) {
      if (!/^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/i.test(id)) return false;
      const result = await pool.query(`UPDATE text_translations SET reported = TRUE
        WHERE id = $1 AND chat_id = $2 AND user_id = $3 AND status = 'completed' RETURNING id`, [id, chatId, userId]);
      return result.rowCount > 0;
    }
  };
}

module.exports = { ensureTranslationTables, createTranslationStore };
