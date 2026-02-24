# OpenBridge — Deployment Guide

> How to run OpenBridge in production using Docker, PM2, or systemd.

---

## Prerequisites

All deployment methods require:

- **Node.js >= 22** (for non-Docker setups)
- **Chromium/Chrome** — required by `whatsapp-web.js` for headless WhatsApp
- **At least one AI CLI tool** (e.g. `claude`, `codex`, `aider`) — must be installed and authenticated on the host
- A valid `config.json` (see [CONFIGURATION.md](./CONFIGURATION.md))

---

## 1. Docker

### Dockerfile

Create a `Dockerfile` in the project root:

```dockerfile
FROM node:22-slim

# Install Chromium dependencies for whatsapp-web.js
RUN apt-get update && apt-get install -y \
    chromium \
    fonts-liberation \
    libappindicator3-1 \
    libasound2 \
    libatk-bridge2.0-0 \
    libatk1.0-0 \
    libcups2 \
    libdbus-1-3 \
    libgbm1 \
    libgtk-3-0 \
    libnspr4 \
    libnss3 \
    libx11-xcb1 \
    libxcomposite1 \
    libxdamage1 \
    libxrandr2 \
    xdg-utils \
    --no-install-recommends \
  && rm -rf /var/lib/apt/lists/*

ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY dist/ ./dist/
COPY config.example.json ./

# WhatsApp session data persisted via volume
VOLUME ["/app/.wwebjs_auth"]

EXPOSE 8080

CMD ["node", "dist/index.js"]
```

### Build and run

```bash
# Build the TypeScript first
npm run build

# Build the Docker image
docker build -t openbridge .

# Run with config and session persistence
docker run -d \
  --name openbridge \
  --restart unless-stopped \
  -v $(pwd)/config.json:/app/config.json:ro \
  -v openbridge-session:/app/.wwebjs_auth \
  -p 8080:8080 \
  openbridge
```

### Key points

- **Build first**: The Docker image uses pre-compiled `dist/` output. Run `npm run build` before `docker build`.
- **Session volume**: Mount `.wwebjs_auth` as a volume so WhatsApp sessions survive container restarts.
- **Config mount**: Mount your `config.json` as read-only. Never bake secrets into the image.
- **AI CLI tools**: The AI CLI (e.g. `claude`) must be available inside the container. For Docker, you may need to install it in the image or mount the host binary.
- **QR code**: On first run, view logs with `docker logs -f openbridge` to scan the WhatsApp QR code.

### Docker Compose

```yaml
# docker-compose.yml
services:
  openbridge:
    build: .
    restart: unless-stopped
    volumes:
      - ./config.json:/app/config.json:ro
      - session-data:/app/.wwebjs_auth
    ports:
      - '8080:8080'

volumes:
  session-data:
```

```bash
docker compose up -d
docker compose logs -f   # Watch for QR code on first run
```

---

## 2. PM2

[PM2](https://pm2.keymetrics.io/) is a Node.js process manager with auto-restart, log management, and monitoring.

### Install PM2

```bash
npm install -g pm2
```

### ecosystem.config.cjs

Create `ecosystem.config.cjs` in the project root:

```js
module.exports = {
  apps: [
    {
      name: 'openbridge',
      script: 'dist/index.js',
      node_args: '--enable-source-maps',
      env: {
        NODE_ENV: 'production',
      },
      autorestart: true,
      max_restarts: 10,
      min_uptime: '10s',
      error_file: 'logs/error.log',
      out_file: 'logs/out.log',
      merge_logs: true,
      log_date_format: 'YYYY-MM-DD HH:mm:ss',
      watch: false,
    },
  ],
};
```

### Start with PM2

```bash
npm run build
pm2 start ecosystem.config.cjs
pm2 status
pm2 logs openbridge
pm2 startup   # Auto-start on system boot
pm2 save
```

### Common PM2 commands

```bash
pm2 restart openbridge
pm2 stop openbridge
pm2 delete openbridge
pm2 monit
pm2 logs openbridge --lines 100
```

---

## 3. systemd

For Linux servers without Docker or PM2.

### Create a service file

```bash
sudo nano /etc/systemd/system/openbridge.service
```

```ini
[Unit]
Description=OpenBridge AI Messaging Bridge
After=network.target

[Service]
Type=simple
User=openbridge
Group=openbridge
WorkingDirectory=/opt/openbridge
ExecStart=/usr/bin/node dist/index.js
Restart=on-failure
RestartSec=5
StandardOutput=journal
StandardError=journal
SyslogIdentifier=openbridge

Environment=NODE_ENV=production

NoNewPrivileges=true
ProtectSystem=strict
ReadWritePaths=/opt/openbridge/.wwebjs_auth /opt/openbridge/logs

[Install]
WantedBy=multi-user.target
```

### Setup

```bash
sudo useradd --system --home /opt/openbridge --shell /usr/sbin/nologin openbridge
sudo mkdir -p /opt/openbridge
sudo cp -r dist/ package.json package-lock.json config.json /opt/openbridge/
cd /opt/openbridge && sudo npm ci --omit=dev
sudo chown -R openbridge:openbridge /opt/openbridge

sudo systemctl daemon-reload
sudo systemctl enable openbridge
sudo systemctl start openbridge
```

### Common systemd commands

```bash
sudo systemctl status openbridge
sudo journalctl -u openbridge -f
sudo systemctl restart openbridge
sudo systemctl stop openbridge
```

---

## Health Check

Enable the health check endpoint in `config.json`:

```json
{
  "health": {
    "enabled": true,
    "port": 8080
  }
}
```

Test it:

```bash
curl http://localhost:8080/
```

Returns JSON with connector and queue status. HTTP 200 = healthy, 503 = unhealthy.

---

## Production Checklist

- [ ] Run `npm run build` before deploying
- [ ] Set `NODE_ENV=production` for JSON logs (no pretty-print)
- [ ] Configure `config.json` with real phone numbers in `auth.whitelist`
- [ ] Enable rate limiting (`auth.rateLimit.enabled: true`)
- [ ] Persist `.wwebjs_auth/` across restarts (volume or persistent directory)
- [ ] Enable health checks for external monitoring
- [ ] Set `logLevel` to `"info"` or `"warn"` in production
- [ ] Ensure Chromium is installed (required by `whatsapp-web.js`)
- [ ] Ensure at least one AI CLI tool is installed and authenticated
- [ ] Use `npm run dev` (not `dev:watch`) to avoid process kills during AI execution
