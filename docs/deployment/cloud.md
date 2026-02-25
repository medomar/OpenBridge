# Cloud Provider Quick-Start Guides

All guides assume you have the Docker image built and pushed, or that you deploy
directly from source. Set at minimum `OPENBRIDGE_WORKSPACE_PATH` and
`OPENBRIDGE_AUTH_WHITELIST` as env vars. See [docker.md](docker.md) for the
full ENV var reference.

---

## AWS EC2

```bash
# 1. Launch an EC2 instance (Ubuntu 22.04, t3.small or larger)
# 2. SSH in and install Docker
sudo apt-get update && sudo apt-get install -y docker.io docker-compose-v2
sudo usermod -aG docker ubuntu && newgrp docker

# 3. Clone and start
git clone https://github.com/your-org/openbridge.git && cd openbridge
OPENBRIDGE_WORKSPACE_PATH=/home/ubuntu/my-project \
OPENBRIDGE_AUTH_WHITELIST="+1234567890" \
docker compose up -d

# 4. Open port 3000 in the EC2 Security Group (or put ALB in front)
```

**Storage:** Mount an EBS volume at `/home/ubuntu/my-project` for the workspace.
**HTTPS:** Use an Application Load Balancer with ACM certificate in front of port 3000.

---

## DigitalOcean Droplet

```bash
# 1. Create a Droplet — Ubuntu 22.04, Basic $6/mo (1 GB RAM minimum)
# 2. Use the Docker 1-Click App image for convenience, or install manually

# 3. Clone and start
git clone https://github.com/your-org/openbridge.git && cd openbridge
cat > .env <<EOF
OPENBRIDGE_WORKSPACE_PATH=/root/my-project
OPENBRIDGE_AUTH_WHITELIST=+1234567890
OPENBRIDGE_HEADLESS=true
EOF
docker compose --env-file .env up -d
```

**Volume:** Attach a DigitalOcean Block Storage volume for the workspace and DB.
**HTTPS:** Use DigitalOcean's managed Load Balancer or Caddy (`apt install caddy`).

---

## Railway

```bash
# 1. Install Railway CLI
npm install -g @railway/cli && railway login

# 2. Create project and deploy
railway init
railway up --dockerfile Dockerfile

# 3. Set env vars in the Railway dashboard (or via CLI)
railway variables set OPENBRIDGE_WORKSPACE_PATH=/workspace
railway variables set OPENBRIDGE_AUTH_WHITELIST="+1234567890"
railway variables set OPENBRIDGE_HEADLESS=true

# 4. Add a Volume and mount it at /workspace for your project files
```

**Note:** Railway provides automatic HTTPS on the generated `.railway.app` domain.
The WebChat UI will be available there after deployment.

---

## Fly.io

```toml
# fly.toml
app = "openbridge"
primary_region = "iad"

[build]
  dockerfile = "Dockerfile"

[env]
  OPENBRIDGE_HEADLESS = "true"
  NODE_ENV = "production"

[[mounts]]
  source = "openbridge_workspace"
  destination = "/workspace"

[[services]]
  internal_port = 3000
  protocol = "tcp"
  [[services.ports]]
    port = 443
    handlers = ["tls", "http"]
```

```bash
fly launch --no-deploy      # import fly.toml
fly secrets set OPENBRIDGE_WORKSPACE_PATH=/workspace
fly secrets set OPENBRIDGE_AUTH_WHITELIST="+1234567890"
fly volumes create openbridge_workspace --size 5
fly deploy
```

**Note:** Fly.io handles HTTPS automatically. Use `fly logs` to stream output.
