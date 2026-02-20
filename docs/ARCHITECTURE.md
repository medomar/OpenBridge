# OpenBridge — Architecture

> **Last Updated:** 2026-02-20

---

## Overview

OpenBridge is a 4-layer system that connects messaging channels to an autonomous AI Master that explores and operates on your workspace.

```
┌──────────────────────────────────────────────────────────────────┐
│                        CHANNELS                                   │
│  WhatsApp · Telegram · Discord · Web Chat                         │
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
│  Autonomous exploration, task execution, multi-AI delegation,     │
│  git-tracked knowledge base in target workspace                    │
└──────────────────────────────────────────────────────────────────┘
```

---

## Layer 1: Channels (Connectors)

Messaging platform adapters. Each implements the `Connector` interface from `src/types/connector.ts`.

### Connector Interface

```typescript
interface Connector {
  name: string;
  initialize(): Promise<void>;
  shutdown(): Promise<void>;
  sendMessage(message: OutboundMessage): Promise<void>;
  sendTypingIndicator?(recipient: string): Promise<void>;
  isConnected(): boolean;
  on(event: 'message', handler: (msg: InboundMessage) => void): void;
  on(event: 'ready' | 'error' | 'disconnected', handler: Function): void;
}
```

### Implemented Connectors

| Connector | Directory                  | Library           | Features                                                                                               |
| --------- | -------------------------- | ----------------- | ------------------------------------------------------------------------------------------------------ |
| WhatsApp  | `src/connectors/whatsapp/` | `whatsapp-web.js` | QR auth, session persistence, auto-reconnect, message chunking, typing indicators, markdown formatting |
| Console   | `src/connectors/console/`  | built-in (stdin)  | Reference implementation for testing                                                                   |

### WhatsApp Connector Details

- **Auto-reconnect** with exponential backoff (1s → 2s → 4s → ... → 60s max)
- **Session persistence** via `LocalAuth` strategy — survives restarts without re-scanning QR
- **Message chunking** — splits responses > 4096 chars into multiple messages
- **Typing indicator** — shows "typing..." while AI processes
- **Markdown conversion** — converts AI markdown to WhatsApp formatting (bold, italic, code)

---

## Layer 2: Bridge Core

The engine that wires everything together. Lives in `src/core/`.

### Components

| Component          | File                | Purpose                                                                          |
| ------------------ | ------------------- | -------------------------------------------------------------------------------- |
| **Bridge**         | `bridge.ts`         | Main orchestrator — wires connectors, providers, auth, queue, Master AI          |
| **Router**         | `router.ts`         | Routes messages: connector → Master AI → connector. Sends ack + progress updates |
| **AuthService**    | `auth.ts`           | Phone whitelist, `/ai` prefix check, command allow/deny filters                  |
| **MessageQueue**   | `queue.ts`          | Per-user sequential processing, retry with backoff, dead-letter queue            |
| **PluginRegistry** | `registry.ts`       | Factory pattern for connectors. Auto-discovery from directories                  |
| **Config**         | `config.ts`         | Loads and validates `config.json` via Zod. Supports V0 and V2 formats            |
| **ConfigWatcher**  | `config-watcher.ts` | Hot-reload config on file change (auth + rate limit updates)                     |
| **HealthServer**   | `health.ts`         | HTTP `/health` endpoint with uptime, connector/queue status                      |
| **Metrics**        | `metrics.ts`        | Message counts, latency histograms, error rates                                  |
| **AuditLogger**    | `audit-logger.ts`   | Structured audit trail of all message events                                     |
| **RateLimiter**    | `rate-limiter.ts`   | Per-user sliding window rate limiting                                            |
| **Logger**         | `logger.ts`         | Pino logger with child logger factory                                            |

### Message Flow (V2 with Master AI)

```
1. WhatsApp message arrives
   │
2. connector.on('message') → bridge.handleIncomingMessage()
   │
3. Auth checks:
   ├─ Is sender whitelisted?       → reject if not
   ├─ Does message have /ai prefix? → ignore if not
   ├─ Is sender rate-limited?       → drop if exceeded
   └─ Is command allowed?           → block if denied
   │
4. queue.enqueue(message)
   │
5. Queue processes per-user sequentially:
   │
6. router.route(message)
   ├─ Send "Working on it..." ack to user
   ├─ Start progress timer (every 15s)
   ├─ Route to Master AI:
   │   └─ master.processMessage(message) → ProviderResult
   ├─ Stop progress timer
   └─ Send result back to user via connector
   │
7. Audit log + metrics recorded
```

### Message Flow (V0 legacy — direct provider)

```
Same as above but step 6 routes directly to an AIProvider instead of Master AI.
Router checks: master → orchestrator → direct provider (in priority order).
```

---

## Layer 3: AI Discovery

Auto-detects AI tools on the machine at startup. Lives in `src/discovery/`.

### How Discovery Works

```
1. CLI Scanner:
   - For each known AI tool (claude, codex, aider, cursor, cody):
     - Run `which <command>` to check if installed
     - If found: capture path, run `<tool> --version`
     - Record capabilities (code-gen, file-editing, conversation, tool-use)
   - Rank by priority (claude > codex > aider > cursor > cody)

2. VS Code Scanner:
   - Read ~/.vscode/extensions/ directory
   - Check for known AI extensions (Copilot, Cody, Continue)
   - Record as available (informational, not used for CLI delegation)

3. Selection:
   - Pick highest-priority available CLI tool as Master
   - Register all others as potential delegates
   - Return ScanResult { tools, master, scanDurationMs }
```

### Discovery Types

```typescript
interface DiscoveredTool {
  name: string; // 'claude', 'codex', 'aider'
  path: string; // '/usr/local/bin/claude'
  version?: string; // '1.2.3'
  capabilities: string[]; // ['code-generation', 'file-editing', 'conversation']
  role: 'master' | 'delegate';
  available: boolean;
}

interface ScanResult {
  tools: DiscoveredTool[];
  master: DiscoveredTool | null;
  scanDurationMs: number;
}
```

### Known AI Tools Registry

| Tool   | Command  | Priority | Capabilities                                   |
| ------ | -------- | :------: | ---------------------------------------------- |
| Claude | `claude` |    1     | code-gen, file-editing, conversation, tool-use |
| Codex  | `codex`  |    2     | code-gen, file-editing                         |
| Aider  | `aider`  |    3     | code-gen, file-editing                         |
| Cursor | `cursor` |    4     | code-gen, file-editing                         |
| Cody   | `cody`   |    5     | code-gen, conversation                         |

---

## Layer 4: Master AI

The autonomous agent that knows your project. Lives in `src/master/`.

### Master Manager

The central component that manages the Master AI lifecycle:

```
States:  idle → exploring → ready → error
                  │
         startExploration() fires on startup
                  │
         Sends exploration prompt to Master AI CLI
                  │
         Master AI reads project files, creates .openbridge/
                  │
         State transitions to 'ready'
                  │
         processMessage(msg) handles user requests
```

### `.openbridge/` Folder

Created by the Master AI inside the target workspace. This is the AI's persistent knowledge base.

```
target-project/
├── src/
├── package.json
├── ...
└── .openbridge/                 ← Created by Master AI
    ├── .git/                    ← Local git repo (Master's changes only)
    ├── workspace-map.json       ← Auto-generated project understanding
    │   {
    │     "name": "my-project",
    │     "description": "Node.js REST API",
    │     "languages": ["typescript", "sql"],
    │     "frameworks": ["express", "prisma"],
    │     "structure": { ... },
    │     "exploredAt": "2026-02-20T13:00:00Z"
    │   }
    ├── exploration.log          ← Timestamped scan history
    ├── agents.json              ← Discovered AI tools + their roles
    │   {
    │     "master": { "name": "claude", "path": "/usr/local/bin/claude" },
    │     "delegates": [ { "name": "codex", "path": "..." } ]
    │   }
    └── tasks/                   ← Task history (one JSON per task)
        ├── task-001.json
        └── task-002.json
```

### Exploration Prompt

On startup, the Master Manager sends a carefully crafted prompt to the Master AI CLI:

```
You are the Master AI for the project at /path/to/workspace.

Your job:
1. Silently explore the workspace — read key files (package.json, README, src/, etc.)
2. Create a .openbridge/ folder at the workspace root
3. Inside .openbridge/, create workspace-map.json with your findings
4. Initialize a git repo in .openbridge/ and commit your findings
5. Do NOT send any messages to the user — work silently

IMPORTANT: Only create files inside .openbridge/. Do not modify existing project files.
```

The AI does the exploring — we don't write framework detectors or file parsers.

### Delegation

When the Master needs help from another AI tool:

```
1. Master's response contains a delegation marker:
   [DELEGATE:codex] Refactor the auth module to use JWT

2. Master Manager intercepts the marker

3. DelegationCoordinator spawns the delegate CLI:
   codex --print "Refactor the auth module to use JWT"
   (using the generalized executor from claude-code-executor.ts)

4. Delegate's result is fed back to Master's session

5. Task recorded in .openbridge/tasks/ and committed to git
```

### Generalized CLI Executor

The `claude-code-executor.ts` module supports any CLI tool via the `command` option:

```typescript
// Run claude (default)
await executeClaudeCode({ prompt: '...', workspacePath: '...', timeout: 120000 });

// Run codex
await executeClaudeCode({ prompt: '...', workspacePath: '...', timeout: 120000, command: 'codex' });

// Run aider
await executeClaudeCode({ prompt: '...', workspacePath: '...', timeout: 120000, command: 'aider' });
```

Features: streaming via async generator, session support, prompt sanitization, graceful shutdown guard (active child processes tracked and waited for during SIGTERM/SIGINT).

---

## Configuration Model

### V2 Config (new — simplified)

```json
{
  "workspacePath": "/path/to/your/project",
  "channels": [{ "type": "whatsapp", "enabled": true }],
  "auth": {
    "whitelist": ["+1234567890"],
    "prefix": "/ai"
  }
}
```

Three fields. AI tools are auto-discovered, Master is auto-selected.

### V0 Config (legacy — still supported)

```json
{
  "connectors": [{ "type": "whatsapp", "enabled": true }],
  "providers": [{ "type": "claude-code", "enabled": true, "options": { "workspacePath": "..." } }],
  "defaultProvider": "claude-code",
  "auth": { "whitelist": [...], "prefix": "/ai" }
}
```

The config loader auto-detects the format and runs the appropriate startup flow.

---

## Startup Sequence

### V2 Flow (with discovery + Master)

```
1. loadConfig()                    → detect V2 format
2. scanForAITools()                → discover claude, codex, etc.
3. new Bridge(config)              → create bridge with auth, queue, router
4. registerBuiltInConnectors()     → register WhatsApp, Console
5. bridge.start()                  → initialize connectors, health, metrics
6. new MasterManager(tool, path)   → create Master with discovered tool
7. bridge.setMaster(master)        → wire Master into router
8. master.startExploration()       → fire-and-forget background exploration
9. Ready — waiting for messages
```

### V0 Flow (legacy — direct provider)

```
1. loadConfig()                    → detect V0 format
2. new Bridge(config)              → create bridge
3. registerBuiltInConnectors()     → register WhatsApp, Console
4. registerBuiltInProviders()      → register Claude Code provider
5. bridge.start()                  → initialize connectors + providers
6. Ready — messages route directly to provider
```

---

## Key Design Decisions

1. **The AI does the exploring, not our code.** We don't write framework detectors or package.json parsers. We send the AI a prompt and let it figure out the project. This is simpler and more powerful.

2. **`.openbridge/` lives inside the target project.** The AI's knowledge is co-located with the code it knows. It has its own git repo so changes are tracked without polluting the project's git history.

3. **Discovery runs once at startup.** We don't continuously scan for tools. Restart to re-discover.

4. **V0 config stays supported.** Auto-detect config version, run the appropriate flow. No breaking changes.

5. **The executor is generalized, not rewritten.** The existing `claude-code-executor.ts` handles spawning, streaming, sanitization, sessions, and graceful shutdown. Adding `command` option was a one-line change.

6. **Dead code is archived, not deleted.** Old knowledge/ and orchestrator/ modules go to `src/_archived/` — out of the compile path but preserved in git.

---

## Directory Structure

```
src/
├── index.ts                    ← Entry point (V0 + V2 startup flows)
├── cli/
│   ├── index.ts                ← CLI dispatcher
│   └── init.ts                 ← Config generator (3 questions for V2)
├── types/
│   ├── connector.ts            ← Connector interface
│   ├── provider.ts             ← AIProvider interface + ProviderContext
│   ├── message.ts              ← InboundMessage / OutboundMessage
│   ├── config.ts               ← AppConfigSchema (V0) + AppConfigV2Schema
│   ├── common.ts               ← Shared types
│   ├── agent.ts                ← Agent / TaskAgent types (reused)
│   ├── discovery.ts            ← DiscoveredTool, ScanResult schemas
│   └── master.ts               ← MasterState, ExplorationSummary schemas
├── core/
│   ├── bridge.ts               ← Main orchestrator (setMaster + lifecycle)
│   ├── router.ts               ← Message routing (Master → provider fallback)
│   ├── auth.ts                 ← Whitelist + prefix + command filters
│   ├── queue.ts                ← Per-user queues + retry + DLQ
│   ├── registry.ts             ← Plugin registry (auto-discovery)
│   ├── config.ts               ← Config loader (V2 detection + V0 fallback)
│   ├── config-watcher.ts       ← Config hot-reload
│   ├── health.ts               ← Health check endpoint
│   ├── metrics.ts              ← Metrics collection
│   ├── audit-logger.ts         ← Audit trail
│   ├── rate-limiter.ts         ← Per-user rate limiting
│   └── logger.ts               ← Pino logger
├── connectors/
│   ├── index.ts                ← Connector registry
│   ├── whatsapp/               ← WhatsApp connector (V0)
│   └── console/                ← Console connector (reference impl)
├── providers/
│   ├── index.ts                ← Provider registry
│   └── claude-code/            ← Claude Code CLI provider (V0)
│       ├── claude-code-provider.ts
│       ├── claude-code-executor.ts  ← Generalized executor (any CLI)
│       ├── claude-code-config.ts
│       ├── session-manager.ts
│       └── provider-error.ts
├── discovery/
│   ├── index.ts                ← scanForAITools() export
│   ├── tool-scanner.ts         ← CLI tool detection (which)
│   └── vscode-scanner.ts       ← VS Code extension detection
└── master/
    ├── index.ts                ← Module exports
    ├── master-manager.ts       ← Master AI lifecycle + message routing
    ├── dotfolder-manager.ts    ← .openbridge/ CRUD + git operations
    ├── exploration-prompt.ts   ← System prompt for workspace exploration
    └── delegation.ts           ← Multi-AI task delegation
```
