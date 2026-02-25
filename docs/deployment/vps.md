# VPS Deployment (Ubuntu / Debian)

## Prerequisites

- Ubuntu 22.04 LTS or Debian 12 server
- Node.js 22, git, and npm installed
- A user account with sudo access (do **not** run as root)

## 1. Install Node.js 22

```bash
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt-get install -y nodejs git build-essential python3
```

## 2. Clone and Build OpenBridge

```bash
cd /opt
sudo git clone https://github.com/your-org/openbridge.git
sudo chown -R $USER:$USER /opt/openbridge
cd /opt/openbridge
npm ci
npm run build
```

## 3. Create Config

```bash
# Option A: config.json
cp config.example.json config.json
# Edit workspacePath, channels, auth.whitelist

# Option B: environment variables only (no config.json)
# All values come from the ENV vars in the systemd unit below
```

## 4. systemd Service

Create `/etc/systemd/system/openbridge.service`:

```ini
[Unit]
Description=OpenBridge AI Bridge
After=network.target

[Service]
Type=simple
User=YOUR_USER
WorkingDirectory=/opt/openbridge
ExecStart=/usr/bin/node dist/index.js
Restart=on-failure
RestartSec=10

# Required
Environment=OPENBRIDGE_WORKSPACE_PATH=/path/to/your/project
Environment=OPENBRIDGE_AUTH_WHITELIST=+1234567890
Environment=OPENBRIDGE_HEADLESS=true
# Optional
Environment=OPENBRIDGE_AUTH_PREFIX=/ai
Environment=OPENBRIDGE_LOG_LEVEL=info
Environment=NODE_ENV=production

[Install]
WantedBy=multi-user.target
```

Enable and start:

```bash
sudo systemctl daemon-reload
sudo systemctl enable openbridge
sudo systemctl start openbridge
sudo systemctl status openbridge
```

## 5. nginx Reverse Proxy (WebChat)

Install nginx and create `/etc/nginx/sites-available/openbridge`:

```nginx
server {
    listen 80;
    server_name your-domain.com;

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
    }
}
```

```bash
sudo ln -s /etc/nginx/sites-available/openbridge /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx
# Add HTTPS with: sudo certbot --nginx -d your-domain.com
```

## 6. Logs

```bash
sudo journalctl -u openbridge -f   # live log stream
sudo journalctl -u openbridge -n 200 --no-pager
```
