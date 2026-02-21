<div align="center">

# OpenBridge

**Your AI, one message away.**

[![License](https://img.shields.io/badge/license-Apache%202.0-blue.svg)](LICENSE)
[![Node.js](https://img.shields.io/badge/node-%3E%3D22.0.0-brightgreen.svg)](https://nodejs.org/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.7-blue.svg)](https://www.typescriptlang.org/)
[![CI](https://github.com/medomar/OpenBridge/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/medomar/OpenBridge/actions/workflows/ci.yml)
[![PRs Welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg)](CONTRIBUTING.md)

An open-source **autonomous AI bridge** that connects messaging channels to AI agents that **explore your workspace, discover your project structure, and execute tasks** — all using the AI tools already installed on your machine. Zero API keys. Zero extra cost.

[Quick Start](#quick-start) |
[How It Works](#how-it-works) |
[Examples](#examples) |
[Documentation](#documentation) |
[Contributing](#contributing)

</div>

---

## Why OpenBridge?

You have AI tools installed — Claude Code, Codex, Aider. But they're stuck in your terminal. OpenBridge lets you **control them from your phone** through WhatsApp.

**The Setup:**

You configure three things: **workspace path**, **messaging channel**, **phone whitelist**. That's it.

**What Happens Next:**

OpenBridge auto-discovers available AI tools on your machine, picks the best one as Master, silently explores your workspace in 5 incremental passes, and waits for your messages.

**Key Features:**

- **Zero-config AI** — auto-discovers Claude Code, Codex, Aider, etc. on your machine
- **Autonomous exploration** — Master AI silently learns your project structure on startup
- **Incremental 5-pass exploration** — short, checkpointed scans that never timeout
- **Session continuity** — multi-turn conversations with full context
- **Multi-AI delegation** — Master assigns subtasks to other discovered tools
- **`.openbridge/` folder** — the AI's brain, git-tracked inside your project
- **Silent worker** — only speaks when you ask

---

## Examples

### Code Project — Explore and Execute

```
You:    /ai what's in this project?
Master: This is a Node.js REST API (Express + TypeScript) with:
        - 12 routes in src/routes/
        - PostgreSQL via Prisma ORM
        - JWT authentication in src/middleware/auth.ts
        - 47 tests (all passing)
        - Docker setup with docker-compose.yml

You:    /ai run the tests and fix any failures
Master: Running tests... 45/47 passing. 2 failures in auth.test.ts.
        → Reading failing tests...
        → Fixed: expired mock token + missing header check
        → Re-running... 47/47 passing.
        Changes committed to .openbridge/.git

You:    /ai how does the payment flow work?
Master: Payment flow (src/services/payment.ts):
        1. POST /checkout → validates cart → creates Stripe session
        2. Stripe webhook → POST /webhooks/stripe → updates order status
        3. Order service notifies user via email (src/services/email.ts)
        Key files: payment.ts, order.ts, stripe-webhook.ts
```

### Non-Code Workspace — Business Questions

```
# A cafe with inventory spreadsheets

You:    /ai what's our current coffee inventory?
Master: Based on inventory.xlsx:
        - Arabica beans: 12kg (reorder threshold: 10kg)
        - Robusta beans: 8kg
        - Espresso blend: 15kg
        You're below the reorder threshold on Robusta.

You:    /ai which items sold best last week?
Master: Top 5 from sales_weekly.csv:
        1. Iced Latte (142 sold)
        2. Cappuccino (128 sold)
        3. Americano (97 sold)
        4. Cold Brew (89 sold)
        5. Mocha (76 sold)

You:    /ai create a reorder list for next week
Master: Created reorder_2026-02-21.txt with:
        - Robusta beans: 20kg
        - Oat milk: 15L (running low based on latte sales trend)
        - Paper cups (16oz): 500 units
```

### Multi-Turn Session Continuity

```
You:    /ai which invoices are overdue?
Master: 3 overdue invoices:
        - Invoice #1247 ($850) — 12 days overdue
        - Invoice #1289 ($1,200) — 8 days overdue
        - Invoice #1302 ($450) — 5 days overdue

You:    /ai send reminders to those clients
Master: Created reminder emails in drafts/:
        - reminder_1247_acme_corp.txt
        - reminder_1289_stellar_inc.txt
        - reminder_1302_zenith_co.txt
        Review and send when ready.
```

### Multi-AI Delegation

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
│  WhatsApp ──┼────>│  Auth → Queue → Router ───────────┼────>│  5-Pass      │
│  Console    │     │                                    │     │  Exploration │
│  Telegram   │     │  Discovery: scans for AI tools     │     │  Session     │
│  Discord    │     │                                    │     │  Continuity  │
│             │<────┼── Health · Metrics · Audit         │<────│  Delegation  │
└─────────────┘     └──────────────────────────────────┘     └──────────────┘
                                                               .openbridge/
                                                               ├── .git/
                                                               ├── exploration/
                                                               │   ├── exploration-state.json
                                                               │   ├── structure-scan.json
                                                               │   ├── classification.json
                                                               │   └── dirs/
                                                               ├── workspace-map.json
                                                               ├── agents.json
                                                               └── tasks/
```

| Layer            | What it does                                                        |
| ---------------- | ------------------------------------------------------------------- |
| **Channels**     | Messaging adapters (WhatsApp, Console, Telegram, Discord)           |
| **Bridge Core**  | Routing, auth, queuing, config, metrics, health, AI discovery       |
| **AI Discovery** | Scans machine for AI CLIs + VS Code extensions, ranks, picks Master |
| **Master AI**    | Incremental exploration, session continuity, delegation coordinator |

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

1. **AI Discovery** — scans your machine for AI CLIs (`which claude`, `which codex`, etc.) and VS Code extensions
2. **Master Selection** — picks the most capable tool as Master (ranked by features)
3. **Incremental Exploration** — Master explores the workspace in 5 short passes:
   - **Pass 1:** Structure scan (list files/dirs, detect config files) — 90s
   - **Pass 2:** Classification (detect project type, frameworks, dependencies) — 90s
   - **Pass 3:** Directory dives (explore key folders in parallel batches) — 90s/dir
   - **Pass 4:** Assembly (merge results into `workspace-map.json`) — 60s
   - **Pass 5:** Finalization (create `agents.json`, git commit, log)
4. **Checkpointing** — each pass is saved to `.openbridge/exploration/` for resumability
5. **Ready** — Master waits for your messages with full project context

---

## Current Status

| Component            | Status                                                                     |
| -------------------- | -------------------------------------------------------------------------- |
| WhatsApp             | ✅ Stable — auto-reconnect, sessions, chunking, typing                     |
| Claude Code Provider | ✅ Stable — streaming, sessions, error classification                      |
| Bridge Core          | ✅ Stable — router, auth, queue, metrics, health, audit                    |
| AI Discovery         | ✅ Stable — CLI scanner, VS Code scanner, auto-selection                   |
| Master AI            | ✅ Stable — incremental exploration, session continuity, resilient startup |
| Multi-AI Delegation  | ✅ Stable — task parsing, concurrent delegation, timeout handling          |
| Console Connector    | ✅ Stable — rapid preprod testing without WhatsApp QR                      |
| Telegram/Discord     | 🔜 Planned (Phase 15)                                                      |
| Web Chat UI          | 🔜 Planned (Phase 15)                                                      |
| Interactive Views    | 🔜 Planned (Phase 15)                                                      |

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
