# OpenBridge — Development Guide

## Quick Reference

```bash
npm run dev          # Start bridge (no watch — safe for AI execution)
npm run dev:watch    # Start with hot reload (ignores auth/cache dirs)
npm run build        # Compile TypeScript → dist/
npm run start        # Run compiled version from dist/
npm run test         # Run all tests
npm run lint         # Lint check
npm run typecheck    # Type check
npm run format:check # Check Prettier formatting
```

## What is OpenBridge?

An open-source **autonomous AI bridge** — connects messaging channels to AI agents that **explore your workspace, discover your project, and execute tasks**. The AI auto-discovers tools on your machine (Claude Code, Codex, Aider), picks the best one as Master, and silently learns your project on startup. You interact through messaging (WhatsApp). Zero API keys. Zero extra cost.

## How to Use OpenBridge

### Step 1: Create your config

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

That's it. Three fields. AI tools are auto-discovered on your machine.

### Step 2: Run the bridge

```bash
npm run dev
```

A QR code appears in the terminal. Scan it with WhatsApp (Linked Devices).

On startup, OpenBridge:

1. Scans your machine for AI tools (`which claude`, `which codex`, etc.)
2. Picks the most capable one as Master
3. Master silently explores the target workspace
4. Creates `.openbridge/` folder with a git repo to track everything
5. Waits for your messages

### Step 3: Send a command

From your phone, send a WhatsApp message:

```
/ai what's in this project?
```

The bridge will:

1. Check your phone number is whitelisted
2. Strip the `/ai` prefix
3. Route to the Master AI (which already explored your workspace)
4. Send the AI's response back to your WhatsApp

## Architecture (4 layers)

```
┌──────────────────────────────────────────────────────────────────┐
│                        CHANNELS                                   │
│  WhatsApp · Console · Telegram (planned) · Discord (planned)      │
│  Connectors translate between messaging APIs and OpenBridge       │
└──────────────────────┬────────────────────────────────────────────┘
                       │
                       ▼
┌──────────────────────────────────────────────────────────────────┐
│                      BRIDGE CORE                                  │
│  Router · Auth · Queue · Config · Registry · Health · Metrics     │
│  Message routing, authentication, rate limiting, plugin system    │
└──────────────────────┬────────────────────────────────────────────┘
                       │
                       ▼
┌──────────────────────────────────────────────────────────────────┐
│                    AI DISCOVERY                                    │
│  Tool Scanner · VS Code Scanner · Auto-Selection                  │
│  Discovers AI CLIs on machine, ranks by capability, picks Master  │
└──────────────────────┬────────────────────────────────────────────┘
                       │
                       ▼
┌──────────────────────────────────────────────────────────────────┐
│                     MASTER AI                                      │
│  Master Manager · .openbridge/ Folder · Delegation Coordinator    │
│  Autonomous exploration, task execution, multi-AI delegation      │
└──────────────────────────────────────────────────────────────────┘
```

### Key Files

| File                                                | Purpose                                                    |
| --------------------------------------------------- | ---------------------------------------------------------- |
| `config.json`                                       | Your runtime config (gitignored)                           |
| `src/index.ts`                                      | Entry point — V0 + V2 startup flows                        |
| `src/core/bridge.ts`                                | Orchestrator — wires connectors, auth, queue, Master AI    |
| `src/core/router.ts`                                | Routes messages: connector → Master AI → connector         |
| `src/core/auth.ts`                                  | Phone whitelist + prefix + command allow/deny filters      |
| `src/core/queue.ts`                                 | Per-user sequential processing, retry, DLQ                 |
| `src/core/registry.ts`                              | Plugin registry — auto-discovers connectors                |
| `src/core/config.ts`                                | Config loader — V2 detection + V0 fallback (Zod validated) |
| `src/core/config-watcher.ts`                        | Config hot-reload (file watcher)                           |
| `src/core/health.ts`                                | Health check HTTP endpoint                                 |
| `src/core/metrics.ts`                               | Message count, latency, error rate metrics                 |
| `src/core/audit-logger.ts`                          | Structured audit trail of all message events               |
| `src/core/rate-limiter.ts`                          | Per-user rate limiting                                     |
| `src/core/logger.ts`                                | Pino logger                                                |
| `src/types/connector.ts`                            | Interface every connector must implement                   |
| `src/types/provider.ts`                             | Interface every AI provider must implement                 |
| `src/types/message.ts`                              | InboundMessage / OutboundMessage types                     |
| `src/types/config.ts`                               | Zod config schemas (V0 + V2)                               |
| `src/types/discovery.ts`                            | DiscoveredTool, ScanResult Zod schemas                     |
| `src/types/master.ts`                               | MasterState, ExplorationSummary Zod schemas                |
| `src/types/common.ts`                               | Shared types                                               |
| `src/discovery/tool-scanner.ts`                     | CLI tool detection (`which claude`, `which codex`, etc.)   |
| `src/discovery/vscode-scanner.ts`                   | VS Code AI extension detection                             |
| `src/discovery/index.ts`                            | `scanForAITools()` export — combines CLI + VS Code scans   |
| `src/master/master-manager.ts`                      | Master AI lifecycle (idle → exploring → ready) + messaging |
| `src/master/dotfolder-manager.ts`                   | `.openbridge/` folder CRUD + git operations                |
| `src/master/exploration-prompt.ts`                  | System prompt for autonomous workspace exploration         |
| `src/master/delegation.ts`                          | Multi-AI task delegation coordinator                       |
| `src/connectors/whatsapp/`                          | WhatsApp connector — auto-reconnect, sessions, typing      |
| `src/connectors/console/`                           | Console connector (reference implementation)               |
| `src/providers/claude-code/`                        | Claude Code CLI provider — streaming, sessions, errors     |
| `src/providers/claude-code/claude-code-executor.ts` | Generalized CLI executor (any AI tool)                     |
| `src/cli/init.ts`                                   | CLI config generator — 3 questions for V2 config           |

### How `workspacePath` Works

The `workspacePath` in config.json is the **target project** — NOT the OpenBridge folder.

Example: if you're building an app at `~/Desktop/my-app`, you set:

```json
"workspacePath": "/Users/you/Desktop/my-app"
```

When a message arrives, the Master AI runs **inside that folder** with full access to its files, git, and terminal. OpenBridge is the messaging bridge; the target project is the AI's workspace.

On startup, the Master AI creates `.openbridge/` inside the target project:

```
my-app/
├── src/
├── package.json
└── .openbridge/                 ← Created by Master AI
    ├── .git/                    ← Local git repo (AI's changes only)
    ├── workspace-map.json       ← Auto-generated project understanding
    ├── exploration.log          ← Timestamped scan history
    ├── agents.json              ← Discovered AI tools + their roles
    └── tasks/                   ← Task history (one JSON per task)
```

### Adding a New Connector

1. Create `src/connectors/your-connector/`
2. Implement the `Connector` interface from `src/types/connector.ts`
3. Export a factory from `src/connectors/your-connector/index.ts`
4. Register it in `src/connectors/index.ts`
5. Add `{ "type": "your-connector" }` to the `channels` array in config.json

## Project Layout

```
src/
├── index.ts                    Entry point (V0 + V2 startup flows)
├── cli/                        CLI tools
│   ├── index.ts                CLI entry
│   └── init.ts                 Config generator (3 questions for V2)
├── types/                      Interfaces + Zod schemas
│   ├── connector.ts            Connector interface
│   ├── provider.ts             AIProvider interface
│   ├── message.ts              Message types
│   ├── config.ts               Config schemas (V0 + V2)
│   ├── common.ts               Shared types
│   ├── agent.ts                Agent / TaskAgent types
│   ├── discovery.ts            DiscoveredTool, ScanResult schemas
│   └── master.ts               MasterState, ExplorationSummary schemas
├── core/                       Bridge engine
│   ├── bridge.ts               Main orchestrator (setMaster + lifecycle)
│   ├── router.ts               Message routing (Master → provider fallback)
│   ├── auth.ts                 Authentication
│   ├── queue.ts                Message queues
│   ├── registry.ts             Plugin registry
│   ├── config.ts               Config loader (V2 detection + V0 fallback)
│   ├── config-watcher.ts       Hot-reload
│   ├── health.ts               Health checks
│   ├── metrics.ts              Metrics
│   ├── audit-logger.ts         Audit logging
│   ├── rate-limiter.ts         Rate limiting
│   └── logger.ts               Pino logger
├── connectors/
│   ├── index.ts                Registry
│   ├── whatsapp/               WhatsApp (V0)
│   └── console/                Console (reference)
├── providers/
│   ├── index.ts                Registry
│   └── claude-code/            Claude Code (V0) + generalized executor
├── discovery/                  AI tool auto-discovery
│   ├── index.ts                scanForAITools() export
│   ├── tool-scanner.ts         CLI tool detection
│   └── vscode-scanner.ts       VS Code extension detection
└── master/                     Master AI management
    ├── index.ts                Module exports
    ├── master-manager.ts       Master AI lifecycle + message routing
    ├── dotfolder-manager.ts    .openbridge/ folder CRUD + git
    ├── exploration-prompt.ts   Workspace exploration prompt
    └── delegation.ts           Multi-AI task delegation

tests/                          Vitest test suite
├── core/                       Unit tests for each core module
├── connectors/                 Connector tests
├── providers/                  Provider tests
├── discovery/                  Discovery module tests
├── master/                     Master AI tests
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
- Scopes: core, whatsapp, claude, connector, provider, config, discovery, master, deps, ci, docs
- Branch from `develop`, merge via PR
- All code must pass `npm run lint && npm run typecheck && npm run test && npm run build`
