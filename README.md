<div align="center">

# OpenBridge

**Your AI workforce, one message away.**

[![License](https://img.shields.io/badge/license-Apache%202.0-blue.svg)](LICENSE)
[![Node.js](https://img.shields.io/badge/node-%3E%3D22.0.0-brightgreen.svg)](https://nodejs.org/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.7-blue.svg)](https://www.typescriptlang.org/)
[![CI](https://github.com/medomar/OpenBridge/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/medomar/OpenBridge/actions/workflows/ci.yml)
[![PRs Welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg)](CONTRIBUTING.md)

An open-source platform that connects messaging channels to AI agents that **know your APIs, execute real business tasks, and orchestrate multi-step workflows** — all using your own AI subscription.

[Quick Start](#quick-start) |
[How It Works](#how-it-works) |
[Real-World Examples](#real-world-examples) |
[Documentation](#documentation) |
[Contributing](#contributing)

</div>

---

## Why OpenBridge?

Most AI tools are chatbots — you ask questions, they answer. OpenBridge is different. It gives you **AI agents that act on your behalf**: calling your APIs, processing orders, syncing inventory, onboarding suppliers — triggered from a WhatsApp message while you're on the go.

- **Workspace-aware** — the AI knows your project's API endpoints, authentication, and data schemas
- **Action-oriented** — agents don't just answer questions, they execute HTTP calls, modify data, and report results
- **Multi-agent** — complex tasks get broken into subtasks, each handled by a specialized agent working in parallel
- **Channel-agnostic** — WhatsApp today, Telegram and Discord tomorrow. Same agents, any channel.
- **AI-agnostic** — Claude Code today, OpenAI or local LLMs tomorrow. Swap backends without changing anything.
- **Zero cloud cost** — runs locally on your machine, uses your existing AI subscription

---

## Real-World Examples

### E-commerce Operations

```
You:    /ai check if any products are out of stock and restock them
Agent:  Scanning inventory via Shopify API...
        Found 3 products below threshold:
        - Blue Widget (2 left, min: 10) → restocking 50 units
        - Red Gadget (0 left, min: 5) → restocking 25 units
        - Green Thing (1 left, min: 10) → restocking 50 units
        ✓ Purchase orders created for all 3 items.
```

### Supplier Onboarding

```
You:    /ai onboard supplier "Acme Corp" with catalog from their API
Agent:  Starting supplier onboarding flow...
        → Agent 1: Registering Acme Corp in vendor system
        → Agent 2: Fetching product catalog (247 items)
        → Agent 3: Mapping categories to our taxonomy
        All 247 products imported. 12 need manual category review.
        Sending review link to your WhatsApp.
```

### Multi-Store Sync

```
You:    /ai sync prices between Shopify and Amazon stores
Agent:  Comparing 1,204 products across both platforms...
        Found 87 price mismatches.
        → Updating Amazon listings to match Shopify prices
        ✓ 87 prices synced. Full report: [view link]
```

### Developer Workflow

```
You:    /ai run the test suite and fix any failures
Agent:  Running tests in ~/projects/backend...
        23/25 tests passing. 2 failures in auth module.
        → Reading failing tests...
        → Identified: expired mock token in auth.test.ts
        → Fixed and re-running...
        ✓ 25/25 tests passing. Changes committed.
```

---

## Architecture

```
┌─────────────┐     ┌──────────────────────────────────────┐     ┌──────────────┐
│  CHANNELS   │     │            BRIDGE CORE                │     │  AI PROVIDERS │
│             │     │                                        │     │              │
│  WhatsApp ──┼────▶│  Router ─▶ Agent Orchestrator         │────▶│  Claude Code  │
│  Telegram   │     │                │                      │     │  OpenAI       │
│  Discord    │     │           Task Agents (parallel)      │     │  Local LLMs   │
│  Web Chat   │     │                │                      │     │              │
│             │◀────┼── Auth · Queue · Workspace Knowledge  │◀────│              │
└─────────────┘     └──────────────────────────────────────┘     └──────────────┘
```

**Five layers work together:**

| Layer                   | What it does                                                      |
| ----------------------- | ----------------------------------------------------------------- |
| **Channels**            | Messaging adapters (WhatsApp, Telegram, Discord, web)             |
| **Core Engine**         | Routing, auth, queuing, config, metrics, health checks            |
| **Agent Orchestrator**  | Creates task agents, delegates work, coordinates multi-step flows |
| **Workspace Knowledge** | API maps, endpoint discovery, HTTP executor — the AI's memory     |
| **AI Providers**        | AI backends (Claude Code, OpenAI, etc.) with tool-use protocol    |

---

## Quick Start

### Prerequisites

- Node.js >= 22
- A WhatsApp account
- [Claude Code CLI](https://docs.anthropic.com/en/docs/claude-code) installed

### Install

```bash
git clone https://github.com/medomar/OpenBridge.git
cd OpenBridge
npm install
```

### Configure

```bash
cp config.example.json config.json
```

Edit `config.json` with your settings:

```json
{
  "providers": [
    {
      "type": "claude-code",
      "enabled": true,
      "options": {
        "workspacePath": "/absolute/path/to/your/project"
      }
    }
  ],
  "auth": {
    "whitelist": ["+1234567890"],
    "prefix": "/ai"
  }
}
```

### Run

```bash
npm run dev
```

Scan the QR code with WhatsApp when it appears. Then send a message from your phone:

```
/ai what files are in this project?
```

The AI processes your request inside the configured workspace and sends the response back to your WhatsApp.

---

## How It Works

```
Your Phone                    Your Machine                     Your Project
─────────────────────────────────────────────────────────────────────────────

  "/ai check inventory"
        │
        ▼
  WhatsApp Connector ──▶ Auth (whitelist + prefix)
                              │
                              ▼
                         Router ──▶ Agent Orchestrator
                                         │
                                    Reads workspace map
                                    (API endpoints, auth)
                                         │
                                    Creates task agent ──▶ AI Provider
                                                               │
                                                          Calls your APIs
                                                          Processes data
                                                          Returns results
                                                               │
                                    Collects results ◀─────────┘
                                         │
  WhatsApp ◀──── Response ◀──────────────┘

  "3 items restocked ✓"
```

---

## Current Status

OpenBridge is under active development. The V0 foundation is complete and working:

| Component            | Status                                                         |
| -------------------- | -------------------------------------------------------------- |
| WhatsApp connector   | Stable — auto-reconnect, sessions, chunking, typing indicators |
| Claude Code provider | Stable — streaming, sessions, error classification             |
| Bridge core          | Stable — router, auth, queue, metrics, health, audit logging   |
| Plugin architecture  | Stable — connector + provider interfaces, auto-discovery       |
| Workspace knowledge  | In progress — API maps, endpoint discovery                     |
| Agent orchestrator   | In progress — multi-agent task execution                       |
| Tool-use protocol    | Planned — structured AI actions                                |
| Telegram / Discord   | Planned                                                        |

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

We welcome contributions! Whether it's a new connector, AI provider, bug fix, or documentation improvement — see [CONTRIBUTING.md](CONTRIBUTING.md) for guidelines.

## Security

To report security vulnerabilities, please see [SECURITY.md](SECURITY.md).

## License

Apache License 2.0 — see [LICENSE](LICENSE).
