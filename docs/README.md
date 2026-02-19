# OpenBridge Documentation

> **Version:** 0.1.0 | **Status:** V0 Scaffolding Complete | **Health Score:** 6.0/10
> **Last Updated:** 2026-02-19

Modular bridge connecting messaging platforms to AI providers. WhatsApp + Claude Code in V0.

---

## Quick Links

| Doc                                             | Purpose                                        |
| ----------------------------------------------- | ---------------------------------------------- |
| [Architecture](./ARCHITECTURE.md)               | System design, plugin model, data flow         |
| [Configuration](./CONFIGURATION.md)             | All config options, env vars, examples         |
| [Writing a Connector](./WRITING_A_CONNECTOR.md) | Step-by-step guide to add a messaging platform |
| [Writing a Provider](./WRITING_A_PROVIDER.md)   | Step-by-step guide to add an AI backend        |
| [Audit Health](./audit/HEALTH.md)               | Project health score breakdown                 |
| [Audit Tasks](./audit/TASKS.md)                 | Prioritized task list by phase                 |
| [Audit Findings](./audit/FINDINGS.md)           | Known issues and gaps tracker                  |
| [Changelog](../CHANGELOG.md)                    | Change history                                 |
| [CLAUDE.md](../CLAUDE.md)                       | Project-specific development guide             |

---

## How It Works

```
Phone → WhatsApp → Connector → Bridge Core → Router → AI Provider → Claude CLI
                                                                        ↓
Phone ← WhatsApp ← Connector ← Bridge Core ← Router ←────────── Response
```

1. User sends `/ai fix the login bug` from WhatsApp
2. WhatsApp connector receives the message
3. Bridge core checks whitelist + strips prefix
4. Router sends `fix the login bug` to Claude Code provider
5. Claude Code runs `claude --print "fix the login bug"` inside the target workspace
6. Response sent back through WhatsApp

---

## Quick Start

```bash
# Install
git clone https://github.com/medomar/OpenBridge.git
cd OpenBridge && npm install

# Configure
cp config.example.json config.json
# Edit config.json: set workspacePath + whitelist phone number

# Run
npm run dev
# Scan QR code with WhatsApp → send "/ai hello"
```

---

## Project Structure

```
OpenBridge/
├── src/
│   ├── index.ts              # Entry point
│   ├── types/                # Plugin contracts (Connector, AIProvider, Message)
│   ├── core/                 # Bridge engine (router, auth, queue, registry, config)
│   ├── connectors/
│   │   └── whatsapp/         # V0 connector
│   └── providers/
│       └── claude-code/      # V0 AI provider
├── tests/                    # Vitest unit tests (19 passing)
├── docs/                     # This documentation
│   ├── audit/                # Health, tasks, findings
│   └── *.md                  # Guides
├── config.example.json       # Example runtime config
└── CLAUDE.md                 # Development guide
```
