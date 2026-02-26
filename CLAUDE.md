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

An open-source **autonomous AI bridge** — connects messaging channels to AI agents that **explore your workspace, discover your project, and execute tasks**. The AI auto-discovers tools on your machine (Claude Code, Codex, Aider), picks the best one as Master, and silently learns your project on startup through 5 incremental passes (never times out). Session continuity enables multi-turn conversations. You interact through messaging (WhatsApp or Console). Zero API keys. Zero extra cost.

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
3. Master silently explores the target workspace in 5 incremental passes:
   - Pass 1: Structure scan (list top-level files/dirs, count files per dir)
   - Pass 2: Classification (detect project type, frameworks, commands)
   - Pass 3: Directory dives (explore each significant directory)
   - Pass 4: Assembly (merge results into workspace-map.json)
   - Pass 5: Finalization (create agents.json, git commit)
4. Creates `.openbridge/` folder with a git repo and exploration/ subfolder to track everything
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

## Architecture (5 layers)

```
┌──────────────────────────────────────────────────────────────────┐
│                        CHANNELS                                   │
│  WhatsApp · Console · WebChat · Telegram · Discord                │
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
│                    AGENT RUNNER                                    │
│  Unified CLI executor — --allowedTools, --max-turns, --model      │
│  Retries, model fallback, disk logging, tool profiles             │
└──────────────────────┬────────────────────────────────────────────┘
                       │
                       ▼
┌──────────────────────────────────────────────────────────────────┐
│                     MASTER AI                                      │
│  Master Manager · .openbridge/ Folder · Worker Orchestration      │
│  Self-governing exploration, worker spawning, self-improvement    │
└──────────────────────────────────────────────────────────────────┘
```

### Key Files

| File                                     | Purpose                                                                                    |
| ---------------------------------------- | ------------------------------------------------------------------------------------------ |
| `config.json`                            | Your runtime config (gitignored)                                                           |
| `src/index.ts`                           | Entry point — V0 + V2 startup flows                                                        |
| `src/core/bridge.ts`                     | Orchestrator — wires connectors, auth, queue, Master AI                                    |
| `src/core/router.ts`                     | Routes messages: connector → Master AI → connector                                         |
| `src/core/auth.ts`                       | Phone whitelist + prefix + command allow/deny filters                                      |
| `src/core/queue.ts`                      | Per-user sequential processing, retry, DLQ                                                 |
| `src/core/registry.ts`                   | Plugin registry — auto-discovers connectors                                                |
| `src/core/config.ts`                     | Config loader — V2 detection + V0 fallback (Zod validated)                                 |
| `src/core/config-watcher.ts`             | Config hot-reload (file watcher)                                                           |
| `src/core/health.ts`                     | Health check HTTP endpoint                                                                 |
| `src/core/metrics.ts`                    | Message count, latency, error rate metrics                                                 |
| `src/core/audit-logger.ts`               | Structured audit trail of all message events                                               |
| `src/core/rate-limiter.ts`               | Per-user rate limiting                                                                     |
| `src/core/logger.ts`                     | Pino logger                                                                                |
| `src/types/connector.ts`                 | Interface every connector must implement                                                   |
| `src/types/provider.ts`                  | Interface every AI provider must implement                                                 |
| `src/types/message.ts`                   | InboundMessage / OutboundMessage types                                                     |
| `src/types/config.ts`                    | Zod config schemas (V0 + V2)                                                               |
| `src/types/discovery.ts`                 | DiscoveredTool, ScanResult Zod schemas                                                     |
| `src/types/master.ts`                    | MasterState, ExplorationSummary Zod schemas                                                |
| `src/types/common.ts`                    | Shared types                                                                               |
| `src/discovery/tool-scanner.ts`          | CLI tool detection (`which claude`, `which codex`, etc.)                                   |
| `src/discovery/vscode-scanner.ts`        | VS Code AI extension detection                                                             |
| `src/discovery/index.ts`                 | `scanForAITools()` export — combines CLI + VS Code scans                                   |
| `src/core/agent-runner.ts`               | Unified CLI executor (--allowedTools, --max-turns, --model, retries, error classification) |
| `src/core/model-selector.ts`             | Model recommendation per task type                                                         |
| `src/core/model-registry.ts`             | Provider-agnostic model tier resolution (fast/balanced/powerful → concrete model IDs)      |
| `src/core/cli-adapter.ts`                | CLIAdapter interface — translates SpawnOptions to tool-specific binary + args + env        |
| `src/core/adapter-registry.ts`           | Maps discovered tool names to CLIAdapter instances (lazy-loads built-ins)                  |
| `src/core/adapters/`                     | CLIAdapter implementations: ClaudeAdapter, CodexAdapter, AiderAdapter                      |
| `src/core/agent-orchestrator.ts`         | Agent orchestration layer — manages TaskAgent lifecycle, wired into Bridge + Router        |
| `src/core/fast-path-responder.ts`        | Quick-answer agent pool for low-latency responses during Master processing                 |
| `src/core/email-sender.ts`               | Outbound email delivery (SHARE email outputs)                                              |
| `src/core/file-server.ts`                | Static file server for media/file outputs                                                  |
| `src/core/github-publisher.ts`           | GitHub Pages publishing for HTML/report outputs                                            |
| `src/core/workspace-manager.ts`          | Workspace path validation and helper utilities                                             |
| `src/memory/database.ts`                 | SQLite DB init, schema creation, migration runner                                          |
| `src/memory/migration.ts`                | Schema migration runner (ALTER TABLE sequences)                                            |
| `src/memory/activity-store.ts`           | agent_activity CRUD — PID, status, turn counts, explorationId                              |
| `src/memory/task-store.ts`               | tasks + learnings tables (model success rates, retry patterns)                             |
| `src/memory/conversation-store.ts`       | conversation_messages + FTS5 full-text search                                              |
| `src/memory/chunk-store.ts`              | workspace_chunks + FTS5 semantic retrieval                                                 |
| `src/memory/prompt-store.ts`             | prompts + prompt_versions — effectiveness tracking                                         |
| `src/memory/access-store.ts`             | access_control table — role-based permissions per sender                                   |
| `src/memory/worker-briefing.ts`          | Per-worker context injection from DB before spawn                                          |
| `src/memory/retrieval.ts`                | Semantic + FTS5 search helpers for context assembly                                        |
| `src/memory/eviction.ts`                 | LRU eviction policy for workspace chunk cache                                              |
| `src/memory/sub-master-store.ts`         | Sub-master session state persistence                                                       |
| `src/memory/index.ts`                    | MemoryManager facade — unified API over all store modules                                  |
| `src/master/master-manager.ts`           | Master AI lifecycle + self-governing session + worker spawning + kill infra (5710 LOC)     |
| `src/master/master-system-prompt.ts`     | Master AI system prompt builder                                                            |
| `src/master/dotfolder-manager.ts`        | `.openbridge/` folder CRUD + exploration state CRUD (866 LOC)                              |
| `src/master/worker-registry.ts`          | Active worker tracking + concurrency limits                                                |
| `src/master/exploration-coordinator.ts`  | 5-phase incremental exploration orchestrator with checkpointing + resumability             |
| `src/master/exploration-prompts.ts`      | Focused prompts (structure scan, classification, directory dive, assembly)                 |
| `src/master/result-parser.ts`            | Robust JSON extraction from AI output with progressive fallbacks                           |
| `src/master/spawn-parser.ts`             | Parse worker spawn requests from Master output                                             |
| `src/master/worker-result-formatter.ts`  | Format worker results for Master consumption                                               |
| `src/master/workspace-change-tracker.ts` | Git-based workspace change detection                                                       |
| `src/master/prompt-evolver.ts`           | Prompt effectiveness tracking + self-improvement refinement                                |
| `src/master/sub-master-detector.ts`      | Sub-master capability detection and selection                                              |
| `src/master/sub-master-manager.ts`       | Sub-master session pool management                                                         |
| `src/master/delegation.ts`               | Multi-AI task delegation coordinator                                                       |
| `src/connectors/whatsapp/`               | WhatsApp connector — auto-reconnect, sessions, typing                                      |
| `src/connectors/console/`                | Console connector (reference implementation)                                               |
| `src/connectors/webchat/`                | WebChat connector — HTTP + WebSocket, browser UI                                           |
| `src/connectors/telegram/`               | Telegram connector                                                                         |
| `src/connectors/discord/`                | Discord connector                                                                          |
| `src/providers/claude-code/`             | Claude Code CLI provider — streaming, sessions, errors (uses AgentRunner)                  |
| `src/cli/init.ts`                        | CLI config generator — 3 questions for V2 config                                           |
| `src/cli/access.ts`                      | CLI access control tool — `openbridge access add/remove/list` (role management)            |

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
    ├── exploration/             ← Intermediate exploration state (for resumability)
    │   ├── exploration-state.json  ← Phase progress tracker
    │   ├── structure-scan.json     ← Pass 1 output
    │   ├── classification.json     ← Pass 2 output
    │   └── dirs/                   ← Pass 3 outputs (one per directory)
    │       ├── src.json
    │       ├── tests.json
    │       └── docs.json
    ├── workspace-map.json       ← Auto-generated project understanding (legacy)
    ├── agents.json              ← Discovered AI tools + their roles (legacy)
    ├── exploration.log          ← Timestamped scan history (legacy)
    ├── tasks/                   ← Task history (legacy JSON; superseded by SQLite)
    └── openbridge.db            ← SQLite memory (workspace chunks, conversations,
                                     tasks, learnings, agent activity, prompts)
```

> **Note:** `openbridge.db` (SQLite + FTS5) ships in v0.0.2 and progressively replaces JSON files. See [docs/ROADMAP.md](docs/ROADMAP.md).

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
│   ├── init.ts                 Config generator (3 questions for V2)
│   └── access.ts               Access control management (openbridge access)
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
│   ├── router.ts               Message routing + stop/status/confirm commands (1085 LOC)
│   ├── auth.ts                 Authentication + role-based access control
│   ├── queue.ts                Message queues (priority queue, fast-path classification)
│   ├── registry.ts             Plugin registry
│   ├── config.ts               Config loader (V2 detection + V0 fallback)
│   ├── config-watcher.ts       Hot-reload
│   ├── agent-runner.ts         Unified CLI executor (retries, error classification, adaptive turns)
│   ├── model-selector.ts       Model recommendation per task type
│   ├── model-registry.ts       Provider-agnostic model tiers (fast/balanced/powerful)
│   ├── cli-adapter.ts          CLIAdapter interface (SpawnOptions → binary + args + env)
│   ├── adapter-registry.ts     Maps tool names to CLIAdapter instances
│   ├── adapters/               CLIAdapter implementations (claude, codex, aider)
│   ├── agent-orchestrator.ts   TaskAgent lifecycle management (Bridge + Router)
│   ├── fast-path-responder.ts  Quick-answer agent pool (max 2 concurrent, maxTurns=3)
│   ├── email-sender.ts         Outbound email for SHARE outputs
│   ├── file-server.ts          Static file server for media outputs
│   ├── github-publisher.ts     GitHub Pages publishing for HTML outputs
│   ├── workspace-manager.ts    Workspace path validation utilities
│   ├── health.ts               Health checks
│   ├── metrics.ts              Metrics
│   ├── audit-logger.ts         Audit logging
│   ├── rate-limiter.ts         Rate limiting
│   └── logger.ts               Pino logger
├── connectors/
│   ├── index.ts                Registry
│   ├── whatsapp/               WhatsApp (whatsapp-web.js)
│   ├── console/                Console (reference)
│   ├── webchat/                WebChat (HTTP + WebSocket)
│   ├── telegram/               Telegram
│   └── discord/                Discord
├── providers/
│   ├── index.ts                Registry
│   └── claude-code/            Claude Code CLI provider (uses AgentRunner)
├── discovery/                  AI tool auto-discovery
│   ├── index.ts                scanForAITools() export
│   ├── tool-scanner.ts         CLI tool detection
│   └── vscode-scanner.ts       VS Code extension detection
├── memory/                     SQLite memory system (openbridge.db)
│   ├── index.ts                MemoryManager facade
│   ├── database.ts             DB init + schema
│   ├── migration.ts            Schema migration runner
│   ├── activity-store.ts       agent_activity CRUD (PID, status, turns)
│   ├── task-store.ts           tasks + learnings tables
│   ├── conversation-store.ts   conversation_messages + FTS5
│   ├── chunk-store.ts          workspace_chunks + FTS5
│   ├── prompt-store.ts         prompts + prompt_versions
│   ├── access-store.ts         access_control (role-based permissions)
│   ├── worker-briefing.ts      per-worker context injection
│   ├── retrieval.ts            semantic + FTS5 search helpers
│   ├── eviction.ts             LRU eviction for chunk cache
│   └── sub-master-store.ts     sub-master session state
├── orchestrator/               Task orchestration layer (experimental)
│   ├── index.ts                Exports TaskAgentRuntime + ScriptCoordinator
│   ├── task-agent-runtime.ts   Runs TaskAgent step-by-step (AI + API execution)
│   └── script-coordinator.ts   Multi-step script execution with step tracking
└── master/                     Master AI management
    ├── index.ts                Module exports
    ├── master-manager.ts       Master AI lifecycle + self-governing + worker spawning + kill infra (5710 LOC)
    ├── master-system-prompt.ts Master AI system prompt builder
    ├── worker-registry.ts      Active worker tracking + concurrency limits
    ├── dotfolder-manager.ts    .openbridge/ folder CRUD + exploration state (866 LOC)
    ├── exploration-coordinator.ts  5-phase incremental exploration orchestrator
    ├── exploration-prompts.ts      Focused prompts (structure, classification, dive, assembly)
    ├── result-parser.ts            Robust JSON extraction from AI output
    ├── spawn-parser.ts             Parse worker spawn requests from Master output
    ├── worker-result-formatter.ts  Format worker results for Master
    ├── workspace-change-tracker.ts Git-based workspace change detection
    ├── seed-prompts.ts             Initial prompt templates
    ├── exploration-prompt.ts       Legacy monolithic exploration prompt (V0)
    ├── prompt-evolver.ts           Prompt effectiveness tracking + refinement
    ├── sub-master-detector.ts      Sub-master capability detection
    ├── sub-master-manager.ts       Sub-master session pool management
    └── delegation.ts               Multi-AI task delegation

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
