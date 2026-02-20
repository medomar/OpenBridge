# OpenBridge — Development Guide

## Quick Reference

```bash
npm run dev          # Start bridge (hot reload) — reads config.json
npm run build        # Compile TypeScript → dist/
npm run start        # Run compiled version from dist/
npm run test         # Run all tests
npm run lint         # Lint check
npm run typecheck    # Type check
npm run format:check # Check Prettier formatting
```

## What is OpenBridge?

An open-source **AI workforce platform** — agents that know your project's APIs, execute real business tasks, and coordinate multi-step workflows. You interact through messaging (WhatsApp, Telegram, Slack). The AI runs locally, uses your own subscription, and has deep workspace knowledge.

## How to Use OpenBridge

### Step 1: Create your config

```bash
cp config.example.json config.json
```

Edit `config.json`:

- Set `workspacePath` to the **absolute path** of the project you want the AI to work on
- Set `whitelist` to your phone number (with country code, e.g. `+212612345678`)
- Set `prefix` to whatever trigger word you want (default: `/ai`)

Example:

```json
{
  "providers": [
    {
      "type": "claude-code",
      "options": {
        "workspacePath": "/Users/you/Desktop/my-app"
      }
    }
  ],
  "auth": {
    "whitelist": ["+212XXXXXXXXX"],
    "prefix": "/ai"
  }
}
```

### Step 2: Run the bridge

```bash
npm run dev
```

A QR code appears in the terminal. Scan it with WhatsApp (Linked Devices).

### Step 3: Send a command

From your phone, send a WhatsApp message to yourself:

```
/ai what files are in this project?
```

The bridge will:

1. Check your phone number is whitelisted
2. Strip the `/ai` prefix
3. Route through the agent orchestrator (or direct to provider in V0)
4. Send the AI's response back to your WhatsApp

## Architecture (5 layers)

```
┌──────────────────────────────────────────────────────────────────┐
│                        CHANNELS                                  │
│  WhatsApp · Console · Telegram (planned) · Discord (planned)     │
│  Connectors translate between messaging APIs and OpenBridge      │
└──────────────────────┬───────────────────────────────────────────┘
                       │
                       ▼
┌──────────────────────────────────────────────────────────────────┐
│                      BRIDGE CORE                                 │
│  Router · Auth · Queue · Config · Registry · Health · Metrics    │
│  Message routing, authentication, rate limiting, plugin system   │
└──────────────────────┬───────────────────────────────────────────┘
                       │
                       ▼
┌──────────────────────────────────────────────────────────────────┐
│                  AGENT ORCHESTRATOR (planned)                     │
│  Main Agent · Task Agents · Script Coordinator · Event Bus       │
│  Breaks tasks into subtasks, delegates to specialized agents     │
└──────────────────────┬───────────────────────────────────────────┘
                       │
                       ▼
┌──────────────────────────────────────────────────────────────────┐
│                 WORKSPACE KNOWLEDGE (planned)                     │
│  Workspace Maps · API Discovery · API Executor · Data Schemas    │
│  Structured knowledge of every endpoint and data model           │
└──────────────────────┬───────────────────────────────────────────┘
                       │
                       ▼
┌──────────────────────────────────────────────────────────────────┐
│               VIEWS + INTERACTION (planned)                       │
│  Reports · Dashboards · Interactive Flows · Onboarding Wizards   │
│  AI generates visual outputs and multi-step Q&A flows            │
└──────────────────────────────────────────────────────────────────┘

AI PROVIDERS (pluggable at every layer)
  Claude Code · OpenAI · Gemini · Local LLMs
```

### Key Files

| File                            | Purpose                                                      |
| ------------------------------- | ------------------------------------------------------------ |
| `config.json`                   | Your runtime config (gitignored)                             |
| `src/index.ts`                  | Entry point — loads config, registers plugins, starts bridge |
| `src/core/bridge.ts`            | Orchestrator — wires connectors, providers, auth, queue      |
| `src/core/router.ts`            | Routes messages with streaming support + progress updates    |
| `src/core/auth.ts`              | Phone whitelist + prefix + command allow/deny filters        |
| `src/core/queue.ts`             | Per-user sequential processing, retry, DLQ                   |
| `src/core/registry.ts`          | Plugin registry — auto-discovers connectors and providers    |
| `src/core/config.ts`            | Zod-validated config loader                                  |
| `src/core/config-watcher.ts`    | Config hot-reload (file watcher)                             |
| `src/core/workspace-manager.ts` | Multi-workspace routing via `@workspace-name` syntax         |
| `src/core/health.ts`            | Health check HTTP endpoint                                   |
| `src/core/metrics.ts`           | Message count, latency, error rate metrics                   |
| `src/core/audit-logger.ts`      | Structured audit trail of all message events                 |
| `src/core/rate-limiter.ts`      | Per-user rate limiting                                       |
| `src/core/logger.ts`            | Pino logger                                                  |
| `src/types/connector.ts`        | Interface every connector must implement                     |
| `src/types/provider.ts`         | Interface every AI provider must implement                   |
| `src/types/message.ts`          | InboundMessage / OutboundMessage types                       |
| `src/types/config.ts`           | Zod config schemas                                           |
| `src/types/common.ts`           | Shared types                                                 |
| `src/connectors/whatsapp/`      | WhatsApp connector (V0) — auto-reconnect, sessions, typing   |
| `src/connectors/console/`       | Console connector (reference implementation)                 |
| `src/providers/claude-code/`    | Claude Code CLI provider — streaming, sessions, errors       |
| `src/cli/init.ts`               | CLI config generator (`npx openbridge init`)                 |

### How `workspacePath` Works

The `workspacePath` in config.json is the target project — **not** the OpenBridge folder.

Example: if you're building an app at `~/Desktop/my-app`, you set:

```json
"workspacePath": "/Users/you/Desktop/my-app"
```

When a message arrives, the AI provider runs **inside that folder** with full access to its files, git, and terminal. OpenBridge is the messaging bridge; the target project is the AI's workspace.

Multi-workspace: use `@workspace-name` syntax in messages to switch between configured workspaces.

### Adding a New Connector

1. Create `src/connectors/your-connector/`
2. Implement the `Connector` interface from `src/types/connector.ts`
3. Export a factory from `src/connectors/your-connector/index.ts`
4. Register it in `src/connectors/index.ts`
5. Add `{ "type": "your-connector" }` to config.json

### Adding a New AI Provider

1. Create `src/providers/your-provider/`
2. Implement the `AIProvider` interface from `src/types/provider.ts`
3. Export a factory from `src/providers/your-provider/index.ts`
4. Register it in `src/providers/index.ts`
5. Add `{ "type": "your-provider" }` to config.json

## Project Layout

```
src/
├── index.ts                    Entry point
├── cli/                        CLI tools
│   ├── index.ts                CLI entry
│   └── init.ts                 Config generator
├── types/                      Interfaces + schemas
│   ├── connector.ts            Connector interface
│   ├── provider.ts             AIProvider interface
│   ├── message.ts              Message types
│   ├── config.ts               Zod config schemas
│   └── common.ts               Shared types
├── core/                       Bridge engine (14 modules)
│   ├── bridge.ts               Main orchestrator
│   ├── router.ts               Message routing
│   ├── auth.ts                 Authentication
│   ├── queue.ts                Message queues
│   ├── registry.ts             Plugin registry
│   ├── config.ts               Config loader
│   ├── config-watcher.ts       Hot-reload
│   ├── workspace-manager.ts    Multi-workspace
│   ├── health.ts               Health checks
│   ├── metrics.ts              Metrics
│   ├── audit-logger.ts         Audit logging
│   ├── rate-limiter.ts         Rate limiting
│   └── logger.ts               Pino logger
├── connectors/
│   ├── index.ts                Registry
│   ├── whatsapp/               WhatsApp (V0)
│   └── console/                Console (reference)
└── providers/
    ├── index.ts                Registry
    └── claude-code/            Claude Code (V0)

tests/                          Vitest test suite
├── core/                       Unit tests for each core module
├── connectors/                 Connector tests
├── providers/                  Provider tests
├── integration/                Full message flow tests
├── e2e/                        End-to-end with mock WhatsApp
├── cli/                        CLI tests
└── helpers/                    Mock utilities

benchmarks/                     Performance benchmarks
docs/                           Documentation + audit tracking
scripts/                        Task runner utilities
```

## Conventions

- Conventional commits: `feat(scope): description`
- Scopes: core, whatsapp, claude, connector, provider, config, deps, ci, docs
- Branch from `develop`, merge via PR
- All code must pass `npm run lint && npm run typecheck && npm run test && npm run build`
