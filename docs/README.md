# OpenBridge Documentation

> **Last Updated:** 2026-02-24 | **Version:** v0.0.1 | **License:** Apache 2.0

Connect your messaging app to the AI tools on your machine. OpenBridge coordinates Claude, Codex, and Gemini to explore your workspace and execute tasks — using your existing subscriptions, at zero extra cost.

---

## Getting Started

| Doc                                     | Description                                                   |
| --------------------------------------- | ------------------------------------------------------------- |
| [Quick Start](../README.md#quick-start) | Install, configure, run in under 2 minutes                    |
| [Configuration](./CONFIGURATION.md)     | V2 config (3 fields), V0 legacy, all options                  |
| [Connectors](./CONNECTORS.md)           | Enable and test Console, WhatsApp, WebChat, Telegram, Discord |
| [Use Cases](./USE_CASES.md)             | Business examples — dev, restaurants, law firms, marketing    |

---

## Architecture & API

| Doc                                 | Description                                              |
| ----------------------------------- | -------------------------------------------------------- |
| [Architecture](./ARCHITECTURE.md)   | 5-layer system design, message flow, Master AI lifecycle |
| [API Reference](./API_REFERENCE.md) | All public interfaces, types, Zod schemas                |

---

## Extending OpenBridge

| Doc                                             | Description                                        |
| ----------------------------------------------- | -------------------------------------------------- |
| [Writing a Connector](./WRITING_A_CONNECTOR.md) | Step-by-step guide to add a new messaging platform |
| [Writing a Provider](./WRITING_A_PROVIDER.md)   | Add a new AI backend (CLI tool or API-based)       |

---

## Operations

| Doc                                     | Description                           |
| --------------------------------------- | ------------------------------------- |
| [Deployment](./DEPLOYMENT.md)           | Docker, PM2, systemd production setup |
| [Testing Guide](./TESTING_GUIDE.md)     | Console-based rapid testing workflows |
| [Troubleshooting](./TROUBLESHOOTING.md) | Common errors, causes, and fixes      |

---

## Project Planning

| Doc                          | Description                         |
| ---------------------------- | ----------------------------------- |
| [Roadmap](./ROADMAP.md)      | Future features, phases, and vision |
| [Changelog](../CHANGELOG.md) | Version history and change log      |

---

## Audit & Health

| Doc                               | Description                                |
| --------------------------------- | ------------------------------------------ |
| [Health Score](./audit/HEALTH.md) | Project health breakdown (current: 9.5/10) |
| [Task Tracker](./audit/TASKS.md)  | Active tasks + backlog                     |
| [Findings](./audit/FINDINGS.md)   | Known issues and fixes                     |

<details>
<summary>Archive — completed phases (v0 through v8)</summary>

| Archive                                                   | Phases | Scope                                           |
| --------------------------------------------------------- | ------ | ----------------------------------------------- |
| [v0](./audit/archive/v0/TASKS-v0.md)                      | 1–5    | Foundation — WhatsApp, Claude Code, bridge core |
| [v1](./audit/archive/v1/TASKS-v1.md)                      | 6–10   | AI tool auto-discovery                          |
| [v2](./audit/archive/v2/TASKS-v2.md)                      | 11–14  | Incremental exploration                         |
| [v3](./audit/archive/v3/TASKS-v3-mvp.md)                  | 15     | MVP release                                     |
| [v4](./audit/archive/v4/TASKS-v4-self-governing.md)       | 16–21  | Self-governing Master AI                        |
| [v5](./audit/archive/v5/TASKS-v5-e2e-channels.md)         | 22–24  | E2E hardening + 5 connectors                    |
| [v6](./audit/archive/v6/TASKS-v6-smart-orchestration.md)  | 25–28  | Smart orchestration                             |
| [v7](./audit/archive/v7/TASKS-v7-ai-classification.md)    | 29     | AI-powered classification                       |
| [v8](./audit/archive/v8/TASKS-v8-production-readiness.md) | 30     | Production readiness v0.0.1                     |

</details>

---

## Testing

| Doc                                                         | Description                              |
| ----------------------------------------------------------- | ---------------------------------------- |
| [WhatsApp E2E Test](./testing/WHATSAPP-E2E-TEST.md)         | Full WhatsApp integration test procedure |
| [Error Resilience Test](./testing/ERROR-RESILIENCE-TEST.md) | Failure scenarios and recovery testing   |

---

## Marketing & Presentations

| Doc                                                       | Description                |
| --------------------------------------------------------- | -------------------------- |
| [Investor Overview](./marketing/openbridge-investor.html) | Investor pitch deck (HTML) |
| [Product Overview](./marketing/openbridge-overview.html)  | Product positioning (HTML) |

---

## Releases

| Version                                      | Date       | Notes                                                                   |
| -------------------------------------------- | ---------- | ----------------------------------------------------------------------- |
| [v0.0.1](./releases/release-notes-v0.0.1.md) | 2026-02-23 | First release — 5 connectors, self-governing Master, 207 tasks complete |

---

## Directory Structure

```
docs/
├── README.md                  # This file — documentation hub
├── ROADMAP.md                 # Future features and vision
├── ARCHITECTURE.md            # System design (5 layers)
├── CONFIGURATION.md           # Config reference
├── CONNECTORS.md              # Connector setup guides
├── API_REFERENCE.md           # Public API docs
├── DEPLOYMENT.md              # Production deployment
├── TESTING_GUIDE.md           # Testing workflows
├── TROUBLESHOOTING.md         # Error reference
├── USE_CASES.md               # Business examples
├── WRITING_A_CONNECTOR.md     # Connector dev guide
├── WRITING_A_PROVIDER.md      # Provider dev guide
├── audit/                     # Project health + task tracking
│   ├── HEALTH.md              # Health score (9.5/10)
│   ├── TASKS.md               # Active tasks + backlog
│   ├── FINDINGS.md            # Issues tracker
│   └── archive/               # v0–v8 phase history
├── testing/                   # E2E and resilience test guides
├── releases/                  # Release notes per version
└── marketing/                 # Investor + product HTML decks
```
