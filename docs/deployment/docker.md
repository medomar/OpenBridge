# Docker Deployment

## Prerequisites

- Docker 24+ and Docker Compose v2
- Your project directory accessible on the host
- (Optional) WhatsApp account for the WhatsApp connector

## Quick Start with docker-compose

```bash
# Clone OpenBridge
git clone https://github.com/your-org/openbridge.git
cd openbridge

# Start (set required vars inline or in a .env file)
OPENBRIDGE_WORKSPACE_PATH=/path/to/your/project \
OPENBRIDGE_AUTH_WHITELIST="+1234567890" \
docker compose up -d

# View logs
docker compose logs -f openbridge

# Stop
docker compose down
```

## Manual Docker Run

```bash
# Build
docker build -t openbridge .

# Run
docker run -d \
  -e OPENBRIDGE_WORKSPACE_PATH=/workspace \
  -e OPENBRIDGE_AUTH_WHITELIST="+1234567890" \
  -e OPENBRIDGE_HEADLESS=true \
  -v /path/to/your/project:/workspace \
  -v openbridge-whatsapp:/app/.wwebjs_auth \
  -p 3000:3000 \
  --name openbridge \
  openbridge
```

## Environment Variables

| Variable                    | Required | Default | Description                                       |
| --------------------------- | :------: | ------- | ------------------------------------------------- |
| `OPENBRIDGE_WORKSPACE_PATH` |    ✓     | —       | Path inside the container to your mounted project |
| `OPENBRIDGE_AUTH_WHITELIST` |    ✓     | —       | Comma-separated allowed numbers/usernames         |
| `OPENBRIDGE_AUTH_PREFIX`    |          | `/ai`   | Command prefix (e.g. `/ai hello`)                 |
| `OPENBRIDGE_LOG_LEVEL`      |          | `info`  | `trace`/`debug`/`info`/`warn`/`error`/`fatal`     |
| `OPENBRIDGE_CHANNELS`       |          | —       | JSON array of channel configs (overrides config)  |
| `OPENBRIDGE_HEADLESS`       |          | `true`  | Skip terminal QR code; serve QR via HTTP instead  |
| `TELEGRAM_BOT_TOKEN`        |          | —       | Required for Telegram connector                   |
| `DISCORD_BOT_TOKEN`         |          | —       | Required for Discord connector                    |

## WhatsApp QR Code (Headless)

In headless mode the QR code is served at `http://localhost:3000/qr`.
Open it in a browser on your workstation, scan with WhatsApp → Linked Devices.
After scanning, the session is persisted in the `openbridge-whatsapp` volume.

## Health Check

```bash
curl http://localhost:3000/health   # { "status": "healthy", ... }
curl http://localhost:3000/ready    # 200 once Master AI is initialized
curl http://localhost:3000/metrics  # Prometheus-format metrics
```

## Using a .env File

```bash
# .env (never commit this file)
OPENBRIDGE_WORKSPACE_PATH=/path/to/project
OPENBRIDGE_AUTH_WHITELIST="+1234567890,+0987654321"
OPENBRIDGE_AUTH_PREFIX=/ai
OPENBRIDGE_LOG_LEVEL=info
```

```bash
docker compose --env-file .env up -d
```
