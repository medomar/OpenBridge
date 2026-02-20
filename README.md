<div align="center">

# OpenBridge

**Your AI, one message away.**

[![License](https://img.shields.io/badge/license-Apache%202.0-blue.svg)](LICENSE)
[![Node.js](https://img.shields.io/badge/node-%3E%3D22.0.0-brightgreen.svg)](https://nodejs.org/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.7-blue.svg)](https://www.typescriptlang.org/)
[![CI](https://github.com/medomar/OpenBridge/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/medomar/OpenBridge/actions/workflows/ci.yml)
[![PRs Welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg)](CONTRIBUTING.md)

An open-source bridge that connects messaging channels to AI agents that **autonomously explore your workspace and execute tasks** — using the AI tools already on your machine. Zero API keys. Zero extra cost.

[Quick Start](#quick-start) |
[How It Works](#how-it-works) |
[Examples](#examples) |
[Documentation](#documentation) |
[Contributing](#contributing)

</div>

---

## Why OpenBridge?

You have AI tools installed — Claude Code, Codex, Aider. But they're stuck in your terminal. OpenBridge lets you **control them from your phone** through WhatsApp.

- **Auto-discovers** AI tools on your machine — no API keys, no manual config
- **Master AI** explores your workspace silently on startup and learns the project
- **Execute tasks** from anywhere — code changes, test runs, project analysis
- **Multi-AI delegation** — the Master assigns subtasks to other discovered tools
- **`.openbridge/` folder** — the AI's brain, git-tracked inside your project
- **Silent worker** — only speaks when you ask

---

## Examples

### Explore Your Project

```
You:    /ai what's in this project?
Master: This is a Node.js REST API (Express + TypeScript) with:
        - 12 routes in src/routes/
        - PostgreSQL via Prisma ORM
        - JWT authentication in src/middleware/auth.ts
        - 47 tests (all passing)
        - Docker setup with docker-compose.yml
```

### Execute Tasks

```
You:    /ai run the tests and fix any failures
Master: Running tests... 45/47 passing. 2 failures in auth.test.ts.
        → Reading failing tests...
        → Fixed: expired mock token + missing header check
        → Re-running... 47/47 passing.
        Changes committed to .openbridge/.git
```

### Understand Code

```
You:    /ai how does the payment flow work?
Master: Payment flow (src/services/payment.ts):
        1. POST /checkout → validates cart → creates Stripe session
        2. Stripe webhook → POST /webhooks/stripe → updates order status
        3. Order service notifies user via email (src/services/email.ts)
        Key files: payment.ts, order.ts, stripe-webhook.ts
```

### Delegate Work

```
You:    /ai refactor the user model to add role-based access
Master: Breaking this into subtasks...
        → Analyzing current user model (Master)
        → Generating migration script (Codex)
        → Updating middleware + tests (Master)
        Done. 4 files modified, migration ready, tests passing.
```

---

## Architecture

```
┌─────────────┐     ┌──────────────────────────────────┐     ┌──────────────┐
│  CHANNELS   │     │          BRIDGE CORE              │     │  MASTER AI   │
│             │     │                                    │     │              │
│  WhatsApp ──┼────>│  Auth → Queue → Router ───────────┼────>│  Explores    │
│  Telegram   │     │                                    │     │  workspace   │
│  Discord    │     │  Discovery: scans for AI tools     │     │  Delegates   │
│             │<────┼── Health · Metrics · Audit         │<────│  tasks       │
└─────────────┘     └──────────────────────────────────┘     └──────────────┘
                                                               .openbridge/
                                                               ├── .git/
                                                               ├── workspace-map.json
                                                               ├── agents.json
                                                               └── tasks/
```

| Layer            | What it does                                                    |
| ---------------- | --------------------------------------------------------------- |
| **Channels**     | Messaging adapters (WhatsApp, Telegram, Discord)                |
| **Bridge Core**  | Routing, auth, queuing, config, metrics, health                 |
| **AI Discovery** | Scans machine for AI CLIs + VS Code extensions, picks Master    |
| **Master AI**    | Explores workspace, executes tasks, delegates to other AI tools |

---

## Quick Start

### Prerequisites

- Node.js >= 22
- A WhatsApp account
- At least one AI CLI tool installed (e.g. [Claude Code](https://docs.anthropic.com/en/docs/claude-code))

### Install

```bash
git clone https://github.com/medomar/OpenBridge.git
cd OpenBridge
npm install
```

### Configure

```bash
npx openbridge init
```

Or create `config.json` manually:

```json
{
  "workspacePath": "/absolute/path/to/your/project",
  "channels": [{ "type": "whatsapp", "enabled": true }],
  "auth": {
    "whitelist": ["+1234567890"],
    "prefix": "/ai"
  }
}
```

That's it. Three fields.

### Run

```bash
npm run dev
```

Scan the QR code with WhatsApp. Then from your phone:

```
/ai what's in this project?
```

---

## How It Works

```
Your Phone                    Your Machine
──────────────────────────────────────────────

  "/ai what's new?"
        │
        ▼
  WhatsApp Connector ──> Auth (whitelist + prefix)
                              │
                              ▼
                         Queue ──> Router
                                     │
                                     ▼
                              Master AI (already explored your workspace)
                                     │
                              Reads .openbridge/workspace-map.json
                              Checks project git log
                              Builds response
                                     │
  WhatsApp <──── Response <──────────┘

  "3 commits today: added user roles,
   fixed payment bug, updated tests."
```

**On startup:**

1. OpenBridge scans your machine for AI tools (`which claude`, `which codex`, etc.)
2. Picks the best one as Master
3. Master silently explores the target workspace
4. Creates `.openbridge/` folder with a git repo to track everything
5. Waits for your messages

---

## Current Status

| Component        | Status                                               |
| ---------------- | ---------------------------------------------------- |
| WhatsApp         | Stable — auto-reconnect, sessions, chunking, typing  |
| Claude Code      | Stable — streaming, sessions, error classification   |
| Bridge Core      | Stable — router, auth, queue, metrics, health, audit |
| AI Discovery     | In development                                       |
| Master AI        | In development                                       |
| Multi-AI         | Planned                                              |
| Telegram/Discord | Planned                                              |

---

## Documentation

| Guide                                              | Description                         |
| -------------------------------------------------- | ----------------------------------- |
| [Project Overview](OVERVIEW.md)                    | Vision, architecture, roadmap       |
| [Architecture](docs/ARCHITECTURE.md)               | System design, message flow, layers |
| [Configuration Guide](docs/CONFIGURATION.md)       | All config options explained        |
| [API Reference](docs/API_REFERENCE.md)             | Interfaces, types, module APIs      |
| [Writing a Connector](docs/WRITING_A_CONNECTOR.md) | How to add a new messaging channel  |
| [Writing a Provider](docs/WRITING_A_PROVIDER.md)   | How to add a new AI backend         |
| [Deployment Guide](docs/DEPLOYMENT.md)             | Docker, PM2, systemd setup          |
| [Troubleshooting](docs/TROUBLESHOOTING.md)         | Common issues and solutions         |

---

## Contributing

We welcome contributions! Whether it's a new connector, AI tool integration, bug fix, or documentation improvement — see [CONTRIBUTING.md](CONTRIBUTING.md) for guidelines.

## Security

To report security vulnerabilities, please see [SECURITY.md](SECURITY.md).

## License

Apache License 2.0 — see [LICENSE](LICENSE).
