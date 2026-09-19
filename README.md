# Lugat Bot

## Text translation (experimental)

Requires Node.js 18+ and `OPENAI_API_KEY` in the ignored `.env` file.
`OPENAI_MODEL` defaults to `gpt-4.1`; quality on Crimean Tatar must be
reviewed by a native speaker before a broad release.

- `/text crh` selects Russian → Crimean Tatar in Latin script.
- `/text ru` selects Crimean Tatar → Russian.
- `/text crh Я читаю книгу.` translates immediately and selects that mode.
- `/dictionary` returns subsequent messages to dictionary lookup.
- `/translate <word>` always performs dictionary lookup.

Mode is per user per chat, stored in memory and resets on restart. Text is sent
to OpenAI Responses API with `store: false`, together with up to 25 relevant
dictionary entries (10,000-character glossary budget). The glossary currently
matches exact headwords and phrases up to five words, without lemmatization or
Cyrillic-to-Latin conversion. Missing forms are handled by the model. Dictionary
data is refreshed every minute; cached results include the selected glossary
in their key and expire after ten minutes (maximum 200 entries).

Limits per bot process: 2,000 input characters, one active request per user,
ten seconds between requests, three simultaneous translations, 200 API requests
per UTC day, 45-second API timeout. Failed API requests count toward the daily
limit. In-memory limits reset on restart; use one bot process and configure an
OpenAI project spend limit separately for a durable budget control.

Text translations and failures are saved in PostgreSQL and shown on the admin
**Тексты** page (`/text-translations`). Records include source, output, direction,
user, model, rules version, cache status and timestamp. The error button flags
the history record; these buttons survive bot restarts. If saving history fails,
the translation is still delivered, with a temporary report button that falls
back to the old Reports page. Old Reports entries are preserved; past successful
translations that were never stored cannot be reconstructed.

**Подтверждённые переводы** (`/confirmed-translations`) contains human-reviewed
pairs. Open a history record, choose **Исправить и подтвердить**, edit the answer,
and save; or add a pair manually. Entries can be edited or deleted. Removing an
example preserves the original history. Editor notes are not sent to the model.
The translator retrieves up to five examples in the same direction, preferring
exact source matches and then shared tokens (16,000-character budget). It does
not fine-tune the model or automatically mark generated translations as verified.

**Правила перевода** (`/translation-rules`) stores a shared instruction text for
both translation directions, up to 12,000 characters. Changes take effect on the
next request without a restart. Empty rules leave the base translator prompt.
Current rules and relevant examples are read before cache lookup and included in
the cache key, so edits invalidate affected cached results. A request already in
progress uses the version loaded when it began. Optimistic version checks protect
rule/example edits from silently overwriting another editor's saved changes.

Both processes initialize the new tables (`text_translations`,
`confirmed_translations`, `translation_rules`) automatically at startup; concurrent
startup is protected by a PostgreSQL advisory lock. Existing dictionary tables
are unchanged. The configured database role needs CREATE permissions for startup.
Deploy this update to **both the bot and admin** and restart both:

```bash
pm2 restart lugat-bot --update-env
pm2 restart lugat-admin --update-env
```

Run `npm test` for offline tests. For two small **paid** API checks, run
`node scripts/check-text-translation.js`; this uses the local dictionary export
and does not start the bot. Production translation uses PostgreSQL.
Deploy the changed files and configure the key on the server, then restart the
existing bot process with `pm2 restart lugat-bot --update-env`.

For the database/admin integration test, run
`TEST_POSTGRES=1 node --test test/translation-admin.integration.test.js` on Linux,
or `$env:TEST_POSTGRES='1'; node --test test/translation-admin.integration.test.js`
in PowerShell. It uses `.env` database settings, creates a uniquely named
`test_lugat_*` schema, tests the routes through HTTP, and removes that schema.
It does not call OpenAI or Telegram.

Telegram bot on Node.js that translates words between Russian and Crimean Tatar using PostgreSQL.

## Setup

1. Install dependencies:

```bash
npm install
```

2. Create `.env` file and add your Telegram bot token and PostgreSQL settings:

```env
TELEGRAM_BOT_TOKEN=your_telegram_bot_token_here
POSTGRES_HOST=localhost
POSTGRES_PORT=5432
POSTGRES_DB=lugat
POSTGRES_USER=postgres
POSTGRES_PASSWORD=your_password_here
POSTGRES_TABLE=words
```

3. Start the bot:

```bash
npm start
```

The bot now reads dictionary data from PostgreSQL on each lookup request.

## Admin Panel

Start the admin panel:

```bash
npm run admin
```

Add admin credentials to `.env`:

```env
ADMIN_PORT=3000
ADMIN_USERNAME=admin
ADMIN_PASSWORD=change_this_password
```

Open `http://localhost:3000` in your browser.

The admin panel supports:

- search
- add word
- edit word
- delete word

Changes made in the admin panel are visible to the bot on the next Telegram request. No bot restart is needed.

## Deploy On DigitalOcean

This project runs well on a basic Ubuntu Droplet.

### 1. Install system packages

```bash
sudo apt update
sudo apt install -y nginx postgresql postgresql-contrib git curl
```

### 2. Install Node.js

Using NodeSource:

```bash
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt install -y nodejs
```

### 3. Clone project

```bash
git clone <your-repository-url> lugat-bot
cd lugat-bot
npm install
```

### 4. Create PostgreSQL database

```bash
sudo -u postgres psql
```

Then inside PostgreSQL:

```sql
CREATE DATABASE lugat;
CREATE USER lugat_user WITH PASSWORD 'strong_password_here';
GRANT ALL PRIVILEGES ON DATABASE lugat TO lugat_user;
\q
```

### 5. Configure environment

Create `.env` with your production values:

```env
TELEGRAM_BOT_TOKEN=your_telegram_bot_token
POSTGRES_HOST=localhost
POSTGRES_PORT=5432
POSTGRES_DB=lugat
POSTGRES_USER=lugat_user
POSTGRES_PASSWORD=strong_password_here
POSTGRES_TABLE=words
ADMIN_PORT=3000
ADMIN_USERNAME=admin
ADMIN_PASSWORD=strong_admin_password_here
```

### 6. Import dictionary data

```bash
npm run import:postgres
```

### 7. Run both processes with PM2

Install PM2 globally:

```bash
sudo npm install -g pm2
```

Start both services:

```bash
pm2 start ecosystem.config.js
pm2 save
pm2 startup
```

Useful PM2 commands:

```bash
pm2 status
pm2 logs lugat-bot
pm2 logs lugat-admin
pm2 restart lugat-bot
pm2 restart lugat-admin
```

### 8. Reverse proxy admin panel with Nginx

Example Nginx config:

```nginx
server {
	listen 80;
	server_name admin.your-domain.com;

	location / {
		proxy_pass http://127.0.0.1:3000;
		proxy_http_version 1.1;
		proxy_set_header Host $host;
		proxy_set_header X-Real-IP $remote_addr;
		proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
		proxy_set_header X-Forwarded-Proto $scheme;
	}
}
```

Save it to `/etc/nginx/sites-available/lugat-admin`, then enable it:

```bash
sudo ln -s /etc/nginx/sites-available/lugat-admin /etc/nginx/sites-enabled/lugat-admin
sudo nginx -t
sudo systemctl reload nginx
```

### 9. Enable HTTPS

Point your domain to the Droplet IP, then install Certbot:

```bash
sudo apt install -y certbot python3-certbot-nginx
sudo certbot --nginx -d admin.your-domain.com
```

### 10. Firewall

Open only SSH, HTTP, and HTTPS:

```bash
sudo ufw allow OpenSSH
sudo ufw allow 'Nginx Full'
sudo ufw enable
```

Notes:

- The Telegram bot does not need a public port when using polling.
- The admin panel should stay behind Nginx, not exposed directly on port `3000`.
- After code updates, redeploy with `git pull`, `npm install`, and `pm2 restart all`.

## Export CSV

Create a CSV file from `words.json`:

```bash
npm run export:csv
```

The file will be created at `data/words.csv`.

## Import To PostgreSQL

Set PostgreSQL connection values in `.env`:

```env
POSTGRES_HOST=localhost
POSTGRES_PORT=5432
POSTGRES_DB=lugat
POSTGRES_USER=postgres
POSTGRES_PASSWORD=your_password_here
POSTGRES_TABLE=words
```

Then run:

```bash
npm run import:postgres
```

What the script does:

- creates `data/words.csv` from `words.json`
- creates the PostgreSQL table if it does not exist
- imports all records into PostgreSQL using batched inserts

## Commands

- `/start`
- `/help`
- `/translate <word>`

You can also send a Russian or Crimean Tatar word directly in chat.
