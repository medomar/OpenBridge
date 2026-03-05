# OpenBridge Documentation

> **Last Updated:** 2026-03-05 | **Version:** v0.0.12 | **License:** Apache 2.0

Connect your messaging app to the AI tools on your machine. OpenBridge coordinates Claude, Codex, and Gemini to explore your workspace and execute tasks — using your existing subscriptions, at zero extra cost.

---

## Getting Started

| Doc                                     | Description                                                   |
| --------------------------------------- | ------------------------------------------------------------- |
| [Quick Start](../README.md#quick-start) | Install, configure, run in under 2 minutes                    |
| [Configuration](./CONFIGURATION.md)     | V2 config (3 fields), V0 legacy, MCP, all options             |
| [Connectors](./CONNECTORS.md)           | Enable and test Console, WhatsApp, WebChat, Telegram, Discord |
| [Use Cases](./USE_CASES.md)             | Business examples — dev, restaurants, law firms, marketing    |

---

## Architecture & API

| Doc                                 | Description                                              |
| ----------------------------------- | -------------------------------------------------------- |
| [Architecture](./ARCHITECTURE.md)   | 6-layer system design, message flow, Master AI lifecycle |
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
| [Troubleshooting](./TROUBLESHOOTING.md) | Common errors, causes, and fixes      |

---

## Project Planning

| Doc                              | Description                                  |
| -------------------------------- | -------------------------------------------- |
| [Roadmap](./ROADMAP.md)          | Shipped features + Phase 97 + v0.0.13 vision |
| [Changelog](../CHANGELOG.md)     | Version history (v0.0.1–v0.0.12)             |
| [Future Work](./audit/FUTURE.md) | Sprint 5 task breakdowns, deferred features  |

---

## Audit & Health

| Doc                               | Description                                        |
| --------------------------------- | -------------------------------------------------- |
| [Health Score](./audit/HEALTH.md) | Project health breakdown (current: 9.65/10)        |
| [Task Tracker](./audit/TASKS.md)  | Phase 97: 18 pending data integrity tasks          |
| [Findings](./audit/FINDINGS.md)   | 17 open findings (7 data integrity + 10 community) |

<details>
<summary>Archive — 1045 completed tasks (v0 through v21)</summary>

| Archive                                                                     | Phases            | Scope                         |
| --------------------------------------------------------------------------- | ----------------- | ----------------------------- |
| [v0](./audit/archive/v0/TASKS-v0.md)                                        | 1–5               | Foundation — bridge core      |
| [v1–v8](./audit/archive/v1/TASKS-v1.md)                                     | 6–30              | Discovery → production v0.0.1 |
| [v9–v11](./audit/archive/v9/TASKS-v9-memory-scale.md)                       | 31–44             | SQLite memory system          |
| [v12–v13](./audit/archive/v12/TASKS-v12-post-v002-phases-45-50.md)          | 45–56             | Resilience, prompts, history  |
| [v14–v18](./audit/archive/v14/TASKS-v14-v004-phases-57-62.md)               | 57–73             | Codex, MCP, media, voice      |
| [v20](./audit/archive/v20/TASKS-v20-v009-v011-phases-74-86-deep1.md)        | 74–86             | RAG, sharing, consent         |
| [v21](./audit/archive/v21/TASKS-v21-v012-sprint4-phases-rwt-deep-82-104.md) | RWT, Deep, 82–104 | Deep Mode, WebChat, Docker    |

</details>

---

## Testing

| Doc                                                 | Description                                              |
| --------------------------------------------------- | -------------------------------------------------------- |
| [Testing Guide](./TESTING_GUIDE.md)                 | Automated testing workflows + post-branch checklist      |
| [Manual Test Guide](./testing/MANUAL-TEST-GUIDE.md) | Full manual QA checklist (70+ tests across all features) |

---

## Directory Structure

```
docs/
├── README.md                  # This file — documentation hub
├── ROADMAP.md                 # Shipped features + roadmap
├── ARCHITECTURE.md            # System design (6 layers)
├── CONFIGURATION.md           # Config reference
├── CONNECTORS.md              # Connector setup guides
├── API_REFERENCE.md           # Public API docs
├── DEPLOYMENT.md              # Production deployment
├── TESTING_GUIDE.md           # Testing workflows + checklists
├── TROUBLESHOOTING.md         # Error reference
├── USE_CASES.md               # Business examples
├── WRITING_A_CONNECTOR.md     # Connector dev guide
├── WRITING_A_PROVIDER.md      # Provider dev guide
├── audit/                     # Project health + task tracking
│   ├── HEALTH.md              # Health score (9.65/10)
│   ├── TASKS.md               # Active tasks (Phase 97)
│   ├── FINDINGS.md            # 17 open findings
│   ├── FUTURE.md              # Sprint 5 + deferred work
│   └── archive/               # v0–v21 (1045 tasks)
├── testing/
│   └── MANUAL-TEST-GUIDE.md   # Full manual QA checklist (70+ tests)
└── marketing/                 # Product HTML presentations
```
