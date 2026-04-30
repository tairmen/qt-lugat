# LibreTranslate Deployment Folder

This folder is a standalone LibreTranslate project for server deployment.

## Contents

- `docker-compose.yml` - service definition
- `.env.example` - environment settings template
- `data/` - model and runtime data volume (auto-created)

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
- Keep `LT_LOAD_ONLY=ru,uk` for better performance.
- If public API is needed, enable keys/rate limiting.

## Stop / Update

```bash
docker compose down
docker compose pull
docker compose up -d
```
