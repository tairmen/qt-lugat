# LibreTranslate Deployment Folder

This folder is a standalone LibreTranslate project for server deployment.

## Contents

- `docker-compose.yml` - service definition
- `.env.example` - environment settings template
- Docker named volume `libretranslate_data` for model/runtime data

## Deploy On Server

1. Copy this folder to your server.
2. Install Docker and Docker Compose plugin.
3. In this folder, create env file:

```bash
cp .env.example .env
```

4. Start service:

```bash
docker compose up -d
```

If you previously used a bind mount and saw `Permission denied` for
`/home/libretranslate/.local/share`, run:

```bash
docker compose down
docker compose rm -f libretranslate
docker volume prune -f
docker compose up -d
```

5. Check logs while models download first time:

```bash
docker compose logs -f libretranslate
```

## Test API

```bash
curl -X POST "http://127.0.0.1:5000/translate" \
  -H "Content-Type: application/json" \
  -d '{"q":"яблоко","source":"ru","target":"uk","format":"text"}'
```

## Recommended Production Notes

- Put Nginx in front of this service.
- Expose only Nginx ports to the internet.
- Keep `LT_LOAD_ONLY=ru,en,uk` for RU<->UK usage.
- RU<->UK in Argos uses EN as a bridge, so excluding `en` can break startup.
- If public API is needed, enable keys/rate limiting.
- Set `LT_THREADS` in `.env` if you want to tune worker count.

## Stop / Update

```bash
docker compose down
docker compose pull
docker compose up -d
```

## Troubleshooting OOM (Worker SIGKILL)

If logs show `Worker was sent SIGKILL! Perhaps out of memory?`, your server RAM
is too small for current worker/model load.

Use these fixes:

1. Keep only one worker in `.env`:

```dotenv
LT_THREADS=1
```

2. Restart cleanly:

```bash
docker compose down
docker compose up -d
docker compose logs -f libretranslate
```

3. On small VPS (1-2 GB RAM), add swap (Ubuntu example):

```bash
sudo fallocate -l 2G /swapfile
sudo chmod 600 /swapfile
sudo mkswap /swapfile
sudo swapon /swapfile
echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab
free -h
```

4. After first successful model download, you can disable model auto-update:

```dotenv
LT_UPDATE_MODELS=false
```
