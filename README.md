<div align="center">

# OpenBridge

**Your AI, one message away.**

[![License](https://img.shields.io/badge/license-Apache%202.0-blue.svg)](LICENSE)
[![Node.js](https://img.shields.io/badge/node-%3E%3D22.0.0-brightgreen.svg)](https://nodejs.org/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.7-blue.svg)](https://www.typescriptlang.org/)
[![CI](https://github.com/medomar/OpenBridge/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/medomar/OpenBridge/actions/workflows/ci.yml)
[![PRs Welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg)](CONTRIBUTING.md)

An open-source **self-governing AI bridge** that connects messaging channels to a **Master AI** that explores your workspace, spawns worker agents, and executes tasks — all using the AI tools already installed on your machine. Zero API keys. Zero extra cost.

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

OpenBridge auto-discovers AI tools on your machine, picks the best one as Master, explores your workspace using worker agents, and waits for your messages. The Master AI governs itself — it decides which model, tools, and strategy to use for each task.

**Key Features:**

- **Zero-config AI** — auto-discovers Claude Code, Codex, Aider, etc. on your machine
- **Self-governing Master** — decides which model and tools each worker gets
- **Worker delegation** — spawns short-lived agents with bounded permissions (`--allowedTools`, `--max-turns`)
- **Session continuity** — multi-turn conversations with full context
- **Self-improvement** — learns from task outcomes, refines its own prompts
- **`.openbridge/` folder** — the AI's brain, git-tracked inside your project
- **Your subscription** — uses your existing AI tools, zero extra cost

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
Master: Spawning workers...
        → Worker 1 (haiku): running tests... 45/47 passing
        → Worker 2 (sonnet): fixing 2 failures in auth.test.ts
        → Worker 3 (haiku): re-running tests... 47/47 passing
        Changes committed. All tests pass.

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
```

### How Workers Are Governed

```
You:    /ai refactor auth to use JWT

Master (opus, long-lived session):
  "Complex task. Breaking it down..."

  → Worker 1: { model: "haiku",  profile: "read-only",  task: "read current auth code" }
  → Worker 2: { model: "sonnet", profile: "code-edit",  task: "implement JWT auth" }
  → Worker 3: { model: "haiku",  profile: "code-edit",  task: "run tests" }

Master: "Done. Refactored to JWT. 4 files modified, all tests pass."
```

The Master decides the model, tool permissions, and turn limits for each worker. No human configuration needed.

---

## Architecture

```
┌─────────────┐     ┌──────────────────────────────────┐     ┌──────────────┐
│  CHANNELS   │     │          BRIDGE CORE              │     │  MASTER AI   │
│             │     │                                    │     │              │
│  WhatsApp ──┼────>│  Auth → Queue → Router ───────────┼────>│  Self-       │
│  Console    │     │                                    │     │  Governing   │
│  Telegram   │     │  Discovery: scans for AI tools     │     │  Session     │
│  Discord    │     │                                    │     │  Continuity  │
│             │<────┼── Health · Metrics · Audit         │<────│  Workers     │
└─────────────┘     └──────────────────────────────────┘     └──────┬───────┘
                                                                     │
                                                              ┌──────▼───────┐
                                                              │ AGENT RUNNER  │
                                                              │ --allowedTools│
                                                              │ --max-turns   │
                                                              │ --model       │
                                                              │ retries+logs  │
                                                              └──────┬───────┘
                                                                     │
                                                              ┌──────▼───────┐
                                                              │   WORKERS    │
                                                              │ Short-lived  │
                                                              │ Bounded      │
                                                              │ per-task     │
                                                              └──────────────┘

.openbridge/                          ← The AI's brain
├── .git/                             ← tracks all changes
├── workspace-map.json                ← project understanding
├── master-session.json               ← session ID for resume
├── profiles.json                     ← custom tool profiles
├── prompts/                          ← editable prompt templates
├── learnings.json                    ← what works, what doesn't
├── logs/                             ← full worker execution logs
├── exploration/                      ← exploration state
├── agents.json                       ← discovered AI tools
├── workers.json                      ← active worker registry
└── tasks/                            ← task history
```

| Layer            | What it does                                                                |
| ---------------- | --------------------------------------------------------------------------- |
| **Channels**     | Messaging adapters (WhatsApp, Console)                                      |
| **Bridge Core**  | Routing, auth, queuing, config, metrics, health, AI discovery               |
| **Master AI**    | Self-governing agent: task decomposition, worker spawning, self-improvement |
| **Agent Runner** | Unified CLI executor: tool profiles, model selection, retries, logging      |
| **Workers**      | Short-lived agents with bounded permissions, spawned per-task               |

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
                              Master AI (long-lived session)
                                     │
                              Thinks: "Simple query, I know the answer"
                              Reads .openbridge/workspace-map.json
                              Checks project git log
                                     │
  WhatsApp <──── Response <──────────┘

  "3 commits today: added user roles,
   fixed payment bug, updated tests."
```

**On startup:**

1. **AI Discovery** — scans your machine for AI CLIs and VS Code extensions
2. **Master Selection** — picks the most capable tool as Master
3. **Master Session** — launches Master as a long-lived Claude session
4. **Workspace Exploration** — Master spawns read-only workers (haiku) to explore:
   - Workers scan files/dirs, classify project type, dive into directories
   - Master assembles results into `workspace-map.json`
   - All checkpointed to `.openbridge/exploration/` for resumability
5. **Ready** — Master waits for your messages with full project context

**On user message:**

1. Master receives the message in its long-lived session
2. Master decides how to handle it (answer directly or delegate to workers)
3. For complex tasks, Master creates **task manifests** for workers:
   - Each manifest specifies: model, tool profile, max turns, timeout
   - Workers execute and report results back to Master
4. Master synthesizes results and responds to user

---

## Current Status

| Component             | Status                                                             |
| --------------------- | ------------------------------------------------------------------ |
| WhatsApp              | ✅ Stable — auto-reconnect, sessions, chunking, typing             |
| Console               | ✅ Stable — rapid preprod testing                                  |
| Bridge Core           | ✅ Stable — router, auth, queue, metrics, health, audit            |
| AI Discovery          | ✅ Stable — CLI scanner, VS Code scanner, auto-selection           |
| Agent Runner          | 🔧 Building — Phase 16 (core executor with profiles + retries)     |
| Self-Governing Master | 🔧 Planned — Phase 18 (long-lived session, task decomposition)     |
| Worker Orchestration  | 🔧 Planned — Phase 19 (parallel workers, registry, depth limiting) |
| Self-Improvement      | 🔧 Planned — Phase 20 (learnings, prompt refinement)               |
| Telegram/Discord      | ⏳ Backlog — after Master is stable                                |

---

## Documentation

| Guide                                              | Description                         |
| -------------------------------------------------- | ----------------------------------- |
| [Project Overview](OVERVIEW.md)                    | Vision, architecture, roadmap       |
| [Architecture](docs/ARCHITECTURE.md)               | System design, message flow, layers |
| [Configuration Guide](docs/CONFIGURATION.md)       | All config options explained        |
| [Use Cases](docs/USE_CASES.md)                     | Examples for every industry         |
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
