# OpenBridge — Docker Container Image
#
# Build:
#   docker build -t openbridge .
#
# Run (with ENV vars):
#   docker run -d \
#     -e OPENBRIDGE_WORKSPACE_PATH=/workspace \
#     -e OPENBRIDGE_AUTH_WHITELIST="+1234567890" \
#     -e OPENBRIDGE_HEADLESS=true \
#     -v /path/to/your/project:/workspace \
#     -v openbridge-data:/app/.wwebjs_auth \
#     -p 3000:3000 \
#     openbridge
#
# Or use docker-compose (see docker-compose.yml).

# ─── Stage 1: Builder ────────────────────────────────────────────────────────
FROM node:22-slim AS builder

# Install build dependencies required for better-sqlite3 native module
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 \
    make \
    g++ \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy package manifests first for layer caching
COPY package.json package-lock.json ./

# Install all dependencies (including devDependencies for build)
RUN npm ci

# Copy source files
COPY tsconfig.json ./
COPY src/ ./src/

# Compile TypeScript → dist/
RUN npm run build

# ─── Stage 2: Production image ───────────────────────────────────────────────
FROM node:22-slim AS production

# Install build dependencies needed to rebuild better-sqlite3 in production
# and chromium deps for whatsapp-web.js
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 \
    make \
    g++ \
    git \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy package manifests
COPY package.json package-lock.json ./

# Install production dependencies only (rebuilds native modules for this image)
RUN npm ci --omit=dev

# Copy compiled output from builder
COPY --from=builder /app/dist ./dist

# Copy example config for reference
COPY config.example.json ./

# Create workspace mount point and data directories
RUN mkdir -p /workspace /app/logs

# OpenBridge listens on port 3000 (WebChat connector)
EXPOSE 3000

# Default environment — override at runtime
ENV NODE_ENV=production
ENV OPENBRIDGE_HEADLESS=true

# Start the compiled bridge
CMD ["node", "dist/index.js"]
