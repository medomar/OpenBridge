# OpenBridge Documentation

> **Last Updated:** 2026-02-20

An autonomous AI bridge — connects messaging channels to AI agents that explore your workspace and execute tasks. Zero API keys. Zero extra cost.

---

## Quick Links

| Doc                                             | Purpose                                          |
| ----------------------------------------------- | ------------------------------------------------ |
| [Architecture](./ARCHITECTURE.md)               | 4-layer system design, message flow, Master AI   |
| [Configuration](./CONFIGURATION.md)             | V2 config (3 fields), V0 legacy, all options     |
| [Use Cases](./USE_CASES.md)                     | Business examples (dev, cafe, law, marketing...) |
| [Writing a Connector](./WRITING_A_CONNECTOR.md) | Step-by-step guide to add a messaging platform   |
| [API Reference](./API_REFERENCE.md)             | Interfaces, types, module APIs                   |
| [Deployment](./DEPLOYMENT.md)                   | Docker, PM2, systemd setup                       |
| [Troubleshooting](./TROUBLESHOOTING.md)         | Common issues and solutions                      |
| [Audit Health](./audit/HEALTH.md)               | Project health score breakdown                   |
| [Audit Tasks](./audit/TASKS.md)                 | Prioritized task list by phase                   |
| [Audit Findings](./audit/FINDINGS.md)           | Known issues and gaps tracker                    |
| [Changelog](../CHANGELOG.md)                    | Change history                                   |
| [CLAUDE.md](../CLAUDE.md)                       | Project-specific development guide               |

---

## How It Works

```
Phone → WhatsApp → Connector → Auth → Queue → Router → Master AI
                                                            │
                                                   Explores workspace
                                                   Executes tasks
                                                   Delegates to other AI tools
                                                            │
Phone ← WhatsApp ← Connector ← Router ←──────────── Response
```

1. User sends `/ai what's in this project?` from WhatsApp
2. WhatsApp connector receives the message
3. Bridge core checks whitelist, strips prefix, rate-limits
4. Router sends the message to the Master AI
5. Master AI (already explored the workspace) processes the request
6. Response sent back through WhatsApp

---

## Quick Start

```bash
# Install
git clone https://github.com/medomar/OpenBridge.git
cd OpenBridge && npm install

# Configure (3 fields)
npx openbridge init
# Or: create config.json manually with workspacePath + channels + auth

# Run
npm run dev
# Scan QR code with WhatsApp → send "/ai hello"
```

---

## Project Structure

```
OpenBridge/
├── src/
│   ├── index.ts              # Entry point (V0 + V2 startup flows)
│   ├── cli/                  # CLI tools (npx openbridge init)
│   ├── types/                # Interfaces + Zod schemas
│   ├── core/                 # Bridge engine (router, auth, queue, config, ...)
│   ├── connectors/
│   │   ├── whatsapp/         # WhatsApp connector (V0)
│   │   └── console/          # Console connector (reference)
│   ├── providers/
│   │   └── claude-code/      # Claude Code CLI provider + generalized executor
│   ├── discovery/            # AI tool auto-discovery
│   └── master/               # Master AI management + .openbridge/ folder
├── tests/                    # Vitest test suite
├── docs/                     # This documentation
│   ├── audit/                # Health, tasks, findings
│   └── *.md                  # Guides
├── config.example.json       # Example V2 config
└── CLAUDE.md                 # Development guide
```
