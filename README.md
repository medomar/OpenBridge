<div align="center">

# OpenBridge

**Your AI team, one message away.**

[![License](https://img.shields.io/badge/license-Apache%202.0-blue.svg)](LICENSE)
[![Node.js](https://img.shields.io/badge/node-%3E%3D22.0.0-brightgreen.svg)](https://nodejs.org/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.7-blue.svg)](https://www.typescriptlang.org/)
[![CI](https://github.com/medomar/OpenBridge/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/medomar/OpenBridge/actions/workflows/ci.yml)
[![PRs Welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg)](CONTRIBUTING.md)

Connect your messaging app to the AI tools on your machine. Send a message from your phone, and OpenBridge coordinates Claude, Codex, and Gemini to explore your workspace and execute tasks — using your existing subscriptions, at zero extra cost.

[Features](#features) |
[Quick Start](#quick-start) |
[Examples](#see-it-in-action) |
[How It Works](#how-it-works) |
[Documentation](#documentation)

</div>

---

## Features

### Multi-AI Orchestration

Claude, Codex, Gemini — working together on your tasks. OpenBridge discovers every AI tool installed on your machine and coordinates them automatically. One AI reads your codebase, another writes the fix, a third runs the tests. You send one message; the system figures out which AI handles which part.

### Manage Your AI From Your Phone

Send a WhatsApp message, and a team of AI agents gets to work on your project. OpenBridge supports **5 channels** — WhatsApp, Telegram, Discord, WebChat, and Console. Break complex tasks into subtasks, check progress, ask follow-up questions — all from your phone. Session continuity means the AI remembers every previous conversation.

### You Control What AI Can Access

Three access levels keep you in control: **read-only** (browse files), **code-edit** (modify files and run tests), and **full-access** (everything). The AI only touches the workspace folder you point it at — nothing else on your machine. A phone whitelist ensures only authorized users can send commands.

### Always Up-to-Date Project Context

On startup, OpenBridge explores your workspace and builds a knowledge base inside your project. It detects git commits and file changes, then re-explores incrementally — so the AI's understanding is always current. Multi-turn conversations maintain context across messages: ask a question, get an answer, follow up — the AI remembers.

### Zero Extra Cost

No API keys. No per-request fees. No new subscriptions. OpenBridge runs locally on your machine and uses whatever AI tools you already have installed — Claude Code, Codex, Aider, or anything else. Your subscription, your machine, your data.

---

## Quick Start

### Try It Now — Console Mode

No external accounts needed. Use the built-in Console connector to try OpenBridge immediately.

**Prerequisites:** Node.js >= 22, [Claude Code](https://docs.anthropic.com/en/docs/claude-code) installed

```bash
git clone https://github.com/medomar/OpenBridge.git
cd OpenBridge
npm install
```

Create `config.json`:

```json
{
  "workspacePath": "/absolute/path/to/your/project",
  "channels": [{ "type": "console", "enabled": true }],
  "auth": {
    "whitelist": ["console-user"],
    "prefix": "/ai"
  }
}
```

```bash
npm run dev
```

Type a message in the terminal:

```
/ai what's in this project?
```

### Connect WhatsApp

**Prerequisites:** Node.js >= 22, a WhatsApp account, Claude Code installed.

```bash
npx openbridge init
npm run dev
```

Scan the QR code with WhatsApp. Then from your phone:

```
/ai what's in this project?
```

### Other Channels

OpenBridge supports 5 channels: Console, WebChat, WhatsApp, Telegram, and Discord. See the [Connector Setup Guide](docs/CONNECTORS.md) for all options.

---

## See It In Action

### Code Project — Explore and Execute

```
You:    /ai what's in this project?
AI:     This is a Node.js REST API (Express + TypeScript) with:
        - 12 routes in src/routes/
        - PostgreSQL via Prisma ORM
        - JWT authentication in src/middleware/auth.ts
        - 47 tests (all passing)
        - Docker setup with docker-compose.yml

You:    /ai run the tests and fix any failures
AI:     On it...
        → Reading test output... 45/47 passing
        → Fixing 2 failures in auth.test.ts
        → Re-running tests... 47/47 passing
        Changes committed. All tests pass.

You:    /ai how does the payment flow work?
AI:     Payment flow (src/services/payment.ts):
        1. POST /checkout → validates cart → creates Stripe session
        2. Stripe webhook → POST /webhooks/stripe → updates order status
        3. Order service notifies user via email (src/services/email.ts)
        Key files: payment.ts, order.ts, stripe-webhook.ts
```

### Business Workspace — No Code Required

```
You:    /ai what's our current coffee inventory?
AI:     Based on inventory.xlsx:
        - Arabica beans: 12kg (reorder threshold: 10kg)
        - Robusta beans: 8kg
        - Espresso blend: 15kg
        You're below the reorder threshold on Robusta.

You:    /ai which items sold best last week?
AI:     Top 5 from sales_weekly.csv:
        1. Iced Latte (142 sold)
        2. Cappuccino (128 sold)
        3. Americano (97 sold)
        4. Cold Brew (89 sold)
        5. Mocha (76 sold)
```

### Multi-AI Task Delegation

```
You:    /ai refactor auth to use JWT

AI:     Complex task. Breaking it down...

        → AI 1 (fast, read-only): reading current auth code
        → AI 2 (powerful, code-edit): implementing JWT authentication
        → AI 3 (fast, code-edit): running tests and verifying

AI:     Done. Refactored to JWT. 4 files modified, all tests pass.
```

One message from you. Three AI agents coordinated automatically. Each with the right capabilities for its subtask.

More examples: [Use Cases](docs/USE_CASES.md) — software teams, cafes, law firms, real estate, and more.

---

## How It Works

```
  Your Phone / Browser              Your Machine                 Your Workspace
  ─────────────────────           ─────────────────            ─────────────────
  WhatsApp · Telegram              OpenBridge                   .openbridge/
  Discord · WebChat    ──────>     authenticates,   ──────>     workspace map
  Console                          routes messages,             learnings
                       <──────     coordinates AI   <──────     session state
                                   workers                      task history
```

1. You send a message from any channel.
2. OpenBridge authenticates it and routes it to the lead AI, which decides how to handle it.
3. For complex tasks, the AI spawns focused workers — each with specific access permissions and capabilities — then synthesizes the results and responds.

Deep dive: [Architecture](docs/ARCHITECTURE.md) | [Project Overview](OVERVIEW.md) | [API Reference](docs/API_REFERENCE.md)

---

## Documentation

| Guide                                        | Description                         |
| -------------------------------------------- | ----------------------------------- |
| [Documentation Hub](docs/README.md)          | All docs in one place               |
| [Project Overview](OVERVIEW.md)              | Vision, architecture, roadmap       |
| [Configuration Guide](docs/CONFIGURATION.md) | All config options explained        |
| [Connector Setup](docs/CONNECTORS.md)        | Setup guides for all 5 channels     |
| [Use Cases](docs/USE_CASES.md)               | Examples for every industry         |
| [Architecture](docs/ARCHITECTURE.md)         | System design, message flow, layers |
| [Deployment Guide](docs/DEPLOYMENT.md)       | Docker, PM2, systemd setup          |
| [Troubleshooting](docs/TROUBLESHOOTING.md)   | Common issues and solutions         |

---

## Contributing

We welcome contributions! Whether it's a new connector, AI tool integration, bug fix, or documentation improvement — see [CONTRIBUTING.md](CONTRIBUTING.md) for guidelines.

## Security

To report security vulnerabilities, please see [SECURITY.md](SECURITY.md).

## License

Apache License 2.0 — see [LICENSE](LICENSE).
