# Lugat Bot

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