# OpenBridge — Architecture

> **Last Updated:** 2026-02-27

---

## Overview

OpenBridge is a 5-layer autonomous AI bridge that connects messaging channels to AI agents. The system auto-discovers AI tools on your machine, picks the most capable one as "Master", and launches it to autonomously explore and operate on your workspace using an incremental, resumable exploration strategy.

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
│                   CLIADAPTER LAYER                                 │
│  AdapterRegistry · ClaudeAdapter · CodexAdapter · AiderAdapter    │
│  Maps discovered tool names to CLI-specific spawn configurations  │
│  Translates SpawnOptions → binary + args + env per tool           │
└──────────────────────┬────────────────────────────────────────────┘
                       │
                       ▼
┌──────────────────────────────────────────────────────────────────┐
│                     AGENT RUNNER                                   │
│  AgentRunner · Model Selector · Tool Profiles                     │
│  Unified CLI executor: --allowedTools, --max-turns, --model,      │
│  retries, disk logging, model fallback, worker orchestration      │
└──────────────────────┬────────────────────────────────────────────┘
                       │
                       ▼
┌──────────────────────────────────────────────────────────────────┐
│                     MASTER AI                                      │
│  Master Manager · Worker Registry · Exploration Coordinator       │
│  Self-governing Master, AI task classification, auto-delegation   │
│  via SPAWN markers, worker orchestration, session continuity,     │
│  self-improvement, git-tracked knowledge in .openbridge/          │
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
| Console   | `src/connectors/console/`  | built-in (stdin)  | Rapid local testing without any external service dependency                                            |
| WebChat   | `src/connectors/webchat/`  | built-in (ws)     | Browser chat UI on localhost, markdown rendering, live progress bar, Thinking animation                |
| WhatsApp  | `src/connectors/whatsapp/` | `whatsapp-web.js` | QR auth, session persistence, auto-reconnect, message chunking, typing indicators, markdown formatting |
| Telegram  | `src/connectors/telegram/` | `grammy`          | DM and group @mention support, in-place progress editing via editMessageText                           |
| Discord   | `src/connectors/discord/`  | `discord.js` v14  | DM and guild channel support, bot message filtering, in-place progress editing                         |

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

| Component          | File                | Purpose                                                                                                                                                                                          |
| ------------------ | ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Bridge**         | `bridge.ts`         | Main orchestrator — wires connectors, providers, auth, queue, Master AI                                                                                                                          |
| **Router**         | `router.ts`         | Routes messages: connector → Master AI → connector. Sends ack + progress updates. Built-in commands: `/history`, `/history search <q>`, `/history <session-id>`, `/stop`, `/stop-all`, `/status` |
| **AuthService**    | `auth.ts`           | Phone whitelist, `/ai` prefix check, command allow/deny filters                                                                                                                                  |
| **MessageQueue**   | `queue.ts`          | Per-user sequential processing, retry with backoff, dead-letter queue                                                                                                                            |
| **PluginRegistry** | `registry.ts`       | Factory pattern for connectors. Auto-discovery from directories                                                                                                                                  |
| **Config**         | `config.ts`         | Loads and validates `config.json` via Zod. Supports V0 and V2 formats                                                                                                                            |
| **ConfigWatcher**  | `config-watcher.ts` | Hot-reload config on file change (auth + rate limit updates)                                                                                                                                     |
| **HealthServer**   | `health.ts`         | HTTP `/health` endpoint with uptime, connector/queue status                                                                                                                                      |
| **Metrics**        | `metrics.ts`        | Message counts, latency histograms, error rates                                                                                                                                                  |
| **AuditLogger**    | `audit-logger.ts`   | Structured audit trail of all message events                                                                                                                                                     |
| **RateLimiter**    | `rate-limiter.ts`   | Per-user sliding window rate limiting                                                                                                                                                            |
| **Logger**         | `logger.ts`         | Pino logger with child logger factory                                                                                                                                                            |

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
   │       ├─ Session continuity: --resume <session-id> for existing conversation
   │       ├─ New session: --session-id <uuid> for first message from sender
   │       └─ Timeout: 30-minute TTL per session
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

### Adapter Resolution

After discovery, each `DiscoveredTool` is matched to a `CLIAdapter` in the `AdapterRegistry`. Only tools with a registered adapter can be used to spawn workers. Built-in adapters are provided for `claude`, `codex`, and `aider`. Tools without an adapter (e.g. `cursor`, `cody`) are recorded in `agents.json` but cannot be delegated to at runtime.

```
scanForAITools()
  → ScanResult { tools: DiscoveredTool[], master: DiscoveredTool }
      → adapterRegistry.getForTool(master)
          → CLIAdapter (ClaudeAdapter | CodexAdapter | AiderAdapter)
              → used by AgentRunner for every spawn() call
```

---

## CLIAdapter Layer

Lives in `src/core/cli-adapter.ts`, `src/core/adapter-registry.ts`, and `src/core/adapters/`.

The `CLIAdapter` interface decouples `AgentRunner` from the specific CLI invocation details of each AI tool. When `AgentRunner.spawn()` is called, it asks the appropriate adapter to build a `CLISpawnConfig` and then passes that config directly to `child_process.spawn()`.

### CLIAdapter Interface

```typescript
interface CLIAdapter {
  /** Provider name matching DiscoveredTool.name ('claude', 'codex', 'aider') */
  readonly name: string;

  /**
   * Translate provider-neutral SpawnOptions into the binary, args, and env
   * for this CLI. Called once per spawn() or stream() invocation.
   */
  buildSpawnConfig(opts: SpawnOptions): CLISpawnConfig;

  /**
   * Clean the process environment before spawning.
   * Removes vars that would cause nested-session conflicts
   * (e.g. CLAUDECODE, CLAUDE_CODE_*, CLAUDE_AGENT_SDK_*).
   */
  cleanEnv(env: Record<string, string | undefined>): Record<string, string | undefined>;

  /**
   * Map a CapabilityLevel to CLI-specific access restrictions.
   * Claude → tool name lists for --allowedTools.
   * Codex  → sandbox mode strings (handled in buildSpawnConfig).
   * Aider  → flags like --yes.
   * Returns undefined if the CLI has no restriction mechanism.
   */
  mapCapabilityLevel(level: CapabilityLevel): string[] | undefined;

  /**
   * Validate a model string for this provider.
   * Returns true if recognized or safely passable to the CLI.
   */
  isValidModel(model: string): boolean;
}
```

### CLISpawnConfig

The output of `buildSpawnConfig()` — everything `child_process.spawn()` needs:

```typescript
interface CLISpawnConfig {
  binary: string; // e.g. 'claude', 'codex'
  args: string[]; // CLI argument array
  env: Record<string, string | undefined>; // Cleaned environment
  stdin?: 'ignore' | 'pipe'; // stdin behavior (default: 'ignore')
  parseOutput?: (stdout: string) => string; // Optional post-processor for raw stdout
}
```

The `parseOutput` hook lets adapters that emit structured output (e.g. Codex `--json` JSONL) extract the final human-readable message before `AgentRunner` returns the result.

### CapabilityLevel

Maps tool profiles to CLI-specific access mechanisms:

| Level         | Claude (`--allowedTools`)                  | Codex (`--sandbox`)  |
| ------------- | ------------------------------------------ | -------------------- |
| `read-only`   | `Read`, `Glob`, `Grep`                     | `read-only`          |
| `code-edit`   | `Read`, `Edit`, `Write`, `Glob`, ...       | `workspace-write`    |
| `full-access` | `Read`, `Edit`, `Write`, `Glob`, `Bash(*)` | `danger-full-access` |

### Built-in Adapters

| Adapter         | File                         | Tool     | Key Flags                                                                                                                       |
| --------------- | ---------------------------- | -------- | ------------------------------------------------------------------------------------------------------------------------------- |
| `ClaudeAdapter` | `adapters/claude-adapter.ts` | `claude` | `--print`, `--session-id`, `--resume`, `--model`, `--max-turns`, `--allowedTools`, `--append-system-prompt`, `--max-budget-usd` |
| `CodexAdapter`  | `adapters/codex-adapter.ts`  | `codex`  | `exec`, `--skip-git-repo-check`, `--model`, `--sandbox`, `--full-auto`, `--ephemeral`, `--json`, `-o <file>`, `-c <mcp-config>` |
| `AiderAdapter`  | `adapters/aider-adapter.ts`  | `aider`  | `--no-auto-commits`, `--yes`, `--model`, `--message`                                                                            |

**ClaudeAdapter** translates `allowedTools` directly to repeated `--allowedTools <tool>` flags. Session management uses `--print` (worker/stateless), `--session-id <uuid>` (new session), or `--resume <id>` (continue session).

**CodexAdapter** uses the `exec` subcommand for non-interactive execution. Key behaviors:

- Always pushes `--skip-git-repo-check` (required for non-git or untrusted workspaces)
- Validates `OPENAI_API_KEY` at build time — throws if missing
- Maps `allowedTools` → sandbox mode heuristically (`Bash(*)` → `danger-full-access`, `Edit/Write` → `workspace-write`, otherwise `read-only`)
- Emits `--json` (JSONL structured output) + `-o <tempfile>` (reliable final answer capture)
- Session resume uses `exec resume --last`; new sessions omit `--ephemeral` so Codex saves state
- MCP passthrough: when `opts.mcpConfigPath` is set, passes it via `-c <path>`

### AdapterRegistry

`AdapterRegistry` (`src/core/adapter-registry.ts`) maps tool names to `CLIAdapter` instances. Built-in adapters are lazy-loaded on first access; custom adapters registered via `register()` take priority.

```typescript
const registry = createAdapterRegistry(); // pre-registers ClaudeAdapter
const adapter = registry.get('codex'); // lazy-loads CodexAdapter
const adapter2 = registry.getForTool(tool); // looks up by DiscoveredTool.name
registry.has('aider'); // true (built-in exists)
registry.register('my-tool', myAdapter); // register a custom adapter
```

`createAdapterRegistry()` is the production factory — it pre-registers `ClaudeAdapter` so the most common case never incurs lazy-load overhead.

---

## Layer 4: Master AI

The autonomous agent that knows your project. Lives in `src/master/`.

### Master Manager

The central component that manages the Master AI lifecycle and session continuity:

```
States:  idle → exploring → ready → error

Lifecycle:
  1. startExploration() fires on startup
  2. Delegates to ExplorationCoordinator.explore()
  3. State transitions to 'ready' when all 5 passes complete
  4. processMessage(msg) handles user requests with session continuity

Session Continuity:
  - Maps sender → sessionId with 30-minute TTL
  - First message from sender: creates new session with --session-id <uuid>
  - Subsequent messages: resumes with --resume <session-id>
  - Preserves context across multi-turn conversations
  - Cleans up expired sessions automatically

Conversation Context (memory.md pattern — v0.0.2):
  - On session start: buildConversationContext() loads .openbridge/context/memory.md
    into the Master's system prompt (always small, always relevant)
  - Fallback: findRelevantHistory() FTS5 search when memory.md is empty/missing
  - On session end: Master receives "update memory" prompt and writes its own
    memory.md (keep under 200 lines, remove outdated info, merge related topics)
  - Dual-layer: memory.md = curated brain; SQLite conversations = raw archive

Session Checkpointing (v0.0.2):
  - checkpointSession(): serializes pending workers + accumulated results to DB
  - resumeSession(): restores state and continues processing
  - Integrated with priority queue: urgent messages trigger checkpoint-handle-resume
```

### Incremental Exploration Architecture

The exploration is split into **5 short passes** to avoid timeouts on large projects. Each pass is independently checkpointed and resumable.

```
┌─────────────────────────────────────────────────────────────────┐
│                  INCREMENTAL 5-PASS EXPLORATION                  │
└─────────────────────────────────────────────────────────────────┘

Pass 1: Structure Scan (90s timeout)
  ├─ List top-level files/dirs
  ├─ Count files per directory
  ├─ Detect config files (package.json, tsconfig.json, etc.)
  ├─ Skip: node_modules, .git, dist, build
  └─ Output: exploration/structure-scan.json

Pass 2: Classification (90s timeout)
  ├─ Read config files from Pass 1
  ├─ Detect project type (Node.js, Python, Go, etc.)
  ├─ Identify frameworks (Express, React, Django, etc.)
  ├─ Extract dependencies and scripts
  └─ Output: exploration/classification.json

Pass 3: Directory Dives (90s timeout per directory, batched)
  ├─ For each significant directory (src, tests, docs, etc.):
  │   ├─ Explore contents (purpose, key files, subdirs)
  │   └─ Output: exploration/dirs/<dirname>.json
  ├─ Process in batches of 3 via Promise.allSettled()
  ├─ Retry failed dives up to 3 times with backoff
  └─ Checkpoint after each batch

Pass 4: Assembly (60s timeout)
  ├─ Merge partial results from Passes 1-3
  ├─ Generate human-readable summary field
  └─ Output: workspace-map.json (final assembled map)

Pass 5: Finalization (no AI call, pure code)
  ├─ Create agents.json (discovered tools + roles)
  ├─ Git commit all files in .openbridge/
  └─ Write log entry to exploration.log
```

**Resumability:** The `exploration-state.json` file tracks which passes are complete. On restart, the coordinator loads this file and skips completed phases.

```json
{
  "currentPhase": "directory_dives",
  "status": "in_progress",
  "startedAt": "2026-02-21T10:00:00.000Z",
  "phases": {
    "structure_scan": "completed",
    "classification": "completed",
    "directory_dives": "in_progress",
    "assembly": "pending",
    "finalization": "pending"
  },
  "directoryDives": [
    { "path": "src", "status": "completed", "outputFile": "dirs/src.json" },
    { "path": "tests", "status": "pending" },
    { "path": "docs", "status": "failed", "attempts": 1 }
  ],
  "totalCalls": 5,
  "totalAITimeMs": 45000
}
```

### `.openbridge/` Folder Specification

Created by the Master AI inside the target workspace. This is the AI's persistent knowledge base.

```
target-project/
├── src/
├── package.json
├── ...
└── .openbridge/                 ← Created by Master AI
    ├── .git/                    ← Local git repo (Master's changes only)
    │   ├── HEAD
    │   ├── objects/
    │   └── refs/
    ├── exploration/             ← Incremental exploration state (Phase 11)
    │   ├── exploration-state.json  ← Single source of truth for resumability
    │   │   {
    │   │     "currentPhase": "assembly",
    │   │     "status": "in_progress",
    │   │     "startedAt": "2026-02-21T10:00:00.000Z",
    │   │     "phases": {
    │   │       "structure_scan": "completed",
    │   │       "classification": "completed",
    │   │       "directory_dives": "completed",
    │   │       "assembly": "in_progress",
    │   │       "finalization": "pending"
    │   │     },
    │   │     "directoryDives": [...],
    │   │     "totalCalls": 12,
    │   │     "totalAITimeMs": 108000
    │   │   }
    │   ├── structure-scan.json     ← Pass 1 output
    │   │   {
    │   │     "topLevelFiles": ["package.json", "README.md", ...],
    │   │     "directories": [
    │   │       { "path": "src", "fileCount": 42 },
    │   │       { "path": "tests", "fileCount": 18 }
    │   │     ],
    │   │     "configFiles": ["package.json", "tsconfig.json", ...]
    │   │   }
    │   ├── classification.json     ← Pass 2 output
    │   │   {
    │   │     "projectType": "Node.js",
    │   │     "languages": ["typescript"],
    │   │     "frameworks": ["express"],
    │   │     "dependencies": { "express": "^4.18.0", ... },
    │   │     "scripts": { "dev": "tsx src/index.ts", ... }
    │   │   }
    │   └── dirs/                   ← Pass 3 outputs (one per directory)
    │       ├── src.json
    │       │   {
    │       │     "path": "src",
    │       │     "purpose": "Main application source code",
    │       │     "keyFiles": ["index.ts", "server.ts", ...],
    │       │     "subdirs": ["routes", "middleware", "services"]
    │       │   }
    │       ├── tests.json
    │       └── docs.json
    ├── workspace-map.json       ← Final assembled map (Pass 4)
    │   {
    │     "name": "my-project",
    │     "description": "Node.js REST API with Express and TypeScript",
    │     "summary": "A production-ready API server with 12 routes...",
    │     "languages": ["typescript"],
    │     "frameworks": ["express", "prisma"],
    │     "structure": {
    │       "src": { "purpose": "Main application source", ... },
    │       "tests": { "purpose": "Vitest test suite", ... }
    │     },
    │     "exploredAt": "2026-02-21T10:05:30.000Z"
    │   }
    ├── context/                 ← Master AI memory (added in v0.0.2)
    │   └── memory.md            ← Master's curated brain — decisions, preferences,
    │                               project state, active threads. Cap: 200 lines.
    │                               Read on every session start. Updated by Master
    │                               at session end via "update memory" prompt.
    ├── prompts/                 ← Prompt library (added in v0.0.2)
    │   ├── manifest.json        ← Prompt registry: id, filename, usageCount,
    │   │                           successRate, lastUsedAt, previousVersion
    │   └── *.md                 ← Individual prompt template files
    ├── exploration.log          ← Timestamped scan history
    │   2026-02-21T10:00:00Z | Exploration started
    │   2026-02-21T10:01:30Z | Pass 1 (structure_scan) completed in 90s
    │   2026-02-21T10:03:00Z | Pass 2 (classification) completed in 90s
    │   ...
    ├── agents.json              ← Discovered AI tools + their roles (Pass 5)
    │   {
    │     "master": { "name": "claude", "path": "/usr/local/bin/claude" },
    │     "delegates": [
    │       { "name": "codex", "path": "/usr/local/bin/codex" }
    │     ]
    │   }
    ├── tasks/                   ← Task history JSON (superseded by openbridge.db)
    │   ├── task-001.json
    │   └── task-002.json
    └── openbridge.db            ← SQLite memory (shipped in v0.0.2)
                                    Tables: workspace_chunks (FTS5), conversation_messages (FTS5),
                                    tasks, learnings, agent_activity (PID tracking), prompts,
                                    prompt_versions, access_control, sessions, schema_versions
```

### Exploration Components

| Module                     | File                         | Purpose                                                                                                                                                                                                                                                        |
| -------------------------- | ---------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **ExplorationCoordinator** | `exploration-coordinator.ts` | Orchestrates the 5-pass flow, loads/saves state, skips completed phases, checkpoints progress                                                                                                                                                                  |
| **Exploration Prompts**    | `exploration-prompts.ts`     | 4 focused prompt generators (structure scan, classification, directory dive, summary)                                                                                                                                                                          |
| **Result Parser**          | `result-parser.ts`           | Robust JSON extraction with fallbacks (direct parse → markdown fence → regex → retry)                                                                                                                                                                          |
| **DotFolderManager**       | `dotfolder-manager.ts`       | `.openbridge/` CRUD, exploration state, git ops, prompt library (readPromptManifest, writePromptManifest, writePromptTemplate, getPromptTemplate, recordPromptUsage, getLowPerformingPrompts, resetPromptStats), memory file (readMemoryFile, writeMemoryFile) |
| **Exploration Types**      | `types/master.ts`            | Zod schemas for all exploration data structures                                                                                                                                                                                                                |

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

**Delegation features:**

- Concurrent delegation limit (max 3 at once)
- Timeout handling per delegate (default 120s)
- Result aggregation and error handling
- Git commit per completed task

### Agent Runner (Unified CLI Executor)

The `agent-runner.ts` module (`src/core/agent-runner.ts`) is the production-grade CLI executor that uses `AdapterRegistry` to resolve the correct `CLIAdapter` for each spawn call. It supports:

```typescript
const runner = new AgentRunner();

// Single-turn execution with tool restrictions
const result = await runner.spawn({
  prompt: 'Fix the auth bug',
  workspacePath: '/path/to/project',
  model: 'sonnet',
  allowedTools: ['Read', 'Edit', 'Write', 'Glob', 'Grep'],
  maxTurns: 25,
  timeout: 120_000,
  retries: 3,
});

// Streaming execution
const stream = runner.stream({ prompt: '...', workspacePath: '...' });
for await (const chunk of stream) {
  /* ... */
}
```

Internally, `spawn()` calls `adapterRegistry.get(toolName).buildSpawnConfig(opts)` to produce the binary + args + env for the selected tool. The result is passed to `child_process.spawn()`. If `CLISpawnConfig.parseOutput` is set, `AgentRunner` applies it to accumulated stdout after the process exits — this is how `CodexAdapter` extracts the final message from `--json` JSONL output.

Features: `--allowedTools` for tool restrictions (via adapter), `--max-turns` for bounded execution, `--model` for model selection, automatic retries with model fallback chain (opus → sonnet → haiku), session support (`--session-id`, `--resume`), prompt sanitization, disk logging, tool profiles (`read-only`, `code-edit`, `full-access`).

---

## SQLite Memory System (v0.0.2)

The memory system lives at `.openbridge/openbridge.db` inside the target workspace. It provides persistent storage across sessions via 13 store modules, all exposed through a single `MemoryManager` facade (`src/memory/index.ts`).

### Store Modules

| Module                | File                    | Tables                              | Purpose                                           |
| --------------------- | ----------------------- | ----------------------------------- | ------------------------------------------------- |
| **ActivityStore**     | `activity-store.ts`     | `agent_activity`                    | Worker PID tracking, status, turn counts          |
| **TaskStore**         | `task-store.ts`         | `tasks`, `learnings`                | Task history, model success rates, retry patterns |
| **ConversationStore** | `conversation-store.ts` | `conversation_messages` (FTS5)      | Full conversation archive, FTS5 search            |
| **ChunkStore**        | `chunk-store.ts`        | `workspace_chunks` (FTS5)           | Workspace file chunks, semantic retrieval         |
| **PromptStore**       | `prompt-store.ts`       | `prompts`, `prompt_versions`        | Prompt effectiveness tracking in SQLite           |
| **AccessStore**       | `access-store.ts`       | `access_control`                    | Role-based permissions per sender                 |
| **SubMasterStore**    | `sub-master-store.ts`   | `sessions`                          | Sub-master session state + checkpoints            |
| **WorkerBriefing**    | `worker-briefing.ts`    | (reads multiple tables)             | Assembles per-worker context before spawn         |
| **Retrieval**         | `retrieval.ts`          | (reads chunk + conversation tables) | Semantic + FTS5 search helpers                    |
| **Eviction**          | `eviction.ts`           | (writes multiple tables)            | LRU eviction + AI-powered conversation compaction |

### Schema Versioning

`schema_versions` table tracks applied migrations (version INTEGER, applied_at, description). The migration runner only applies versions > MAX(version), wrapped in transactions for rollback safety.

### Conversation History Commands

The router (`src/core/router.ts`) handles built-in `/history` commands — intercepted before routing to Master AI:

| Command                  | Description                                        |
| ------------------------ | -------------------------------------------------- |
| `history`                | List last 10 sessions (title, date, message count) |
| `history search <query>` | FTS5 search across all past conversations          |
| `history <session-id>`   | Show full transcript for one session               |

WebChat connector also exposes `/api/sessions` (list) and `/api/sessions/:id` (full session) REST endpoints.

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
                                     → ScanResult { tools, master }
3. adapterRegistry.getForTool(master)
                                   → resolve master to CLIAdapter
                                     (ClaudeAdapter, CodexAdapter, or AiderAdapter)
4. new Bridge(config)              → create bridge with auth, queue, router
5. registerBuiltInConnectors()     → register Console, WebChat, WhatsApp, Telegram, Discord
6. bridge.start()                  → initialize connectors, health, metrics
7. new MasterManager(tool, path)   → create Master with discovered tool + adapter
8. bridge.setMaster(master)        → wire Master into router
9. master.startExploration()       → fire-and-forget incremental exploration
   ├─ ExplorationCoordinator.explore()
   ├─ Load exploration-state.json (if exists)
   ├─ Skip completed phases
   ├─ Execute remaining passes (each calls agentRunner.spawn() → adapter.buildSpawnConfig())
   ├─ Checkpoint after each pass
   └─ State transitions: idle → exploring → ready
10. Ready — waiting for messages with full project context
```

### V0 Flow (legacy — direct provider)

```
1. loadConfig()                    → detect V0 format
2. new Bridge(config)              → create bridge
3. registerBuiltInConnectors()     → register Console, WebChat, WhatsApp, Telegram, Discord
4. registerBuiltInProviders()      → register Claude Code provider
5. bridge.start()                  → initialize connectors + providers
6. Ready — messages route directly to provider
```

---

## Resilient Startup

On restart, the Master AI reuses valid state and resumes incomplete exploration:

```
Scenario 1: Valid .openbridge/ exists
  → Skip exploration, load workspace-map.json
  → State: ready immediately

Scenario 2: Incomplete exploration (exploration-state.json exists)
  → Load exploration-state.json
  → Resume from last completed phase
  → Continue with remaining passes
  → State: exploring → ready

Scenario 3: Corrupted or missing workspace-map.json
  → Delete exploration/ folder
  → Start fresh 5-pass exploration
  → State: exploring → ready

Scenario 4: First run (no .openbridge/)
  → Create .openbridge/ folder
  → Start 5-pass exploration
  → State: exploring → ready
```

---

## Key Design Decisions

1. **Incremental exploration, not monolithic.** The old architecture used a single giant AI call that timed out on real projects. The new 5-pass strategy breaks exploration into short, checkpointed phases that never timeout.

2. **The AI does the exploring, not our code.** We don't write framework detectors or package.json parsers. We send the AI focused prompts and let it figure out the project. This is simpler and more powerful.

3. **`.openbridge/` lives inside the target project.** The AI's knowledge is co-located with the code it knows. Uses a SQLite database (`openbridge.db`, shipped in v0.0.2) alongside JSON files for exploration state. JSON files remain for exploration checkpointing; `openbridge.db` stores conversations, tasks, prompts, agent activity, access control, and schema versions.

4. **Session continuity enables multi-turn conversations.** The Master tracks sessions per sender with 30-minute TTL. First message creates a session, subsequent messages resume it. This enables natural business conversations: "which invoices are overdue?" → "send reminders to those clients".

5. **Discovery runs once at startup.** We don't continuously scan for tools. Restart to re-discover.

6. **V0 config stays supported.** Auto-detect config version, run the appropriate flow. No breaking changes.

7. **AgentRunner replaced the original executor.** The `agent-runner.ts` module provides retries, model fallback, tool restrictions (`--allowedTools`), bounded execution (`--max-turns`), and disk logging — inspired by the bash scripts in `scripts/`.

8. **CLIAdapter decouples AgentRunner from per-tool CLI details.** Each tool (`claude`, `codex`, `aider`) has its own `CLIAdapter` that translates provider-neutral `SpawnOptions` into CLI-specific binary + args + env. Lossy translation is intentional — if a CLI doesn't support a feature (e.g. Codex has no `--max-turns`), the adapter silently drops it. This means AgentRunner code never needs to special-case individual tools.

9. **Dead code is deleted, not archived.** Old modules (like `claude-code-executor.ts`) are removed once replaced. Git history preserves them if needed.

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
│   └── master.ts               ← MasterState, ExplorationSummary, exploration schemas
├── core/
│   ├── bridge.ts               ← Main orchestrator (setMaster + lifecycle)
│   ├── router.ts               ← Message routing (Master → provider fallback)
│   ├── auth.ts                 ← Whitelist + prefix + command filters
│   ├── queue.ts                ← Per-user queues + retry + DLQ
│   ├── registry.ts             ← Plugin registry (auto-discovery)
│   ├── config.ts               ← Config loader (V2 detection + V0 fallback)
│   ├── config-watcher.ts       ← Config hot-reload
│   ├── agent-runner.ts         ← Unified CLI executor (--allowedTools, --max-turns, --model, retries)
│   ├── model-selector.ts       ← Model recommendation per task type + profile
│   ├── cli-adapter.ts          ← CLIAdapter interface + CLISpawnConfig + CapabilityLevel
│   ├── adapter-registry.ts     ← Maps tool names to CLIAdapter instances (lazy-loads built-ins)
│   ├── adapters/               ← Built-in CLIAdapter implementations
│   │   ├── index.ts            ← Re-exports all adapters
│   │   ├── claude-adapter.ts   ← ClaudeAdapter: --print, --session-id, --resume, --allowedTools
│   │   ├── codex-adapter.ts    ← CodexAdapter: exec, --skip-git-repo-check, --json, -o, sandbox
│   │   └── aider-adapter.ts    ← AiderAdapter: --no-auto-commits, --yes, --message
│   ├── health.ts               ← Health check endpoint
│   ├── metrics.ts              ← Metrics collection
│   ├── audit-logger.ts         ← Audit trail
│   ├── rate-limiter.ts         ← Per-user rate limiting
│   └── logger.ts               ← Pino logger
├── connectors/
│   ├── index.ts                ← Connector registry
│   ├── console/                ← Console connector (reference impl)
│   ├── webchat/                ← WebChat connector (browser UI)
│   ├── whatsapp/               ← WhatsApp connector
│   ├── telegram/               ← Telegram connector (grammY)
│   └── discord/                ← Discord connector (discord.js v14)
├── providers/
│   ├── index.ts                ← Provider registry
│   ├── claude-code/            ← Claude Code CLI provider (uses AgentRunner + ClaudeAdapter)
│   │   ├── claude-code-provider.ts
│   │   ├── claude-code-config.ts
│   │   ├── session-manager.ts
│   │   └── provider-error.ts
│   └── codex/                  ← Codex CLI provider (uses AgentRunner + CodexAdapter)
│       ├── codex-provider.ts   ← CodexProvider: processMessage(), streamMessage(), isAvailable()
│       ├── codex-config.ts     ← CodexConfig Zod schema (workspacePath, timeout, model, sandbox)
│       └── session-manager.ts  ← Codex session management (ephemeral → named session → resume)
├── discovery/
│   ├── index.ts                ← scanForAITools() export
│   ├── tool-scanner.ts         ← CLI tool detection (which)
│   └── vscode-scanner.ts       ← VS Code extension detection
└── master/
    ├── index.ts                ← Module exports
    ├── master-manager.ts       ← Master AI lifecycle + task classification + sessions +
    │                              checkpointSession() / resumeSession() (5710+ LOC)
    ├── master-system-prompt.ts ← Master AI system prompt builder (includes memory.md guidance)
    ├── worker-registry.ts      ← Active worker tracking + concurrency limits
    ├── dotfolder-manager.ts    ← .openbridge/ CRUD + exploration state + prompt library +
    │                              readMemoryFile() / writeMemoryFile() (866+ LOC)
    ├── exploration-coordinator.ts ← 5-pass orchestration + checkpointing
    ├── exploration-prompts.ts  ← Pass-specific prompt generators
    ├── exploration-prompt.ts   ← Legacy monolithic exploration prompt (V0)
    ├── result-parser.ts        ← Robust JSON extraction with fallbacks
    ├── seed-prompts.ts         ← Initial prompt templates for Master AI
    ├── spawn-parser.ts         ← Parse worker spawn requests from Master output
    ├── worker-result-formatter.ts ← Format worker results for Master
    ├── workspace-change-tracker.ts ← Git-based workspace change detection
    ├── prompt-evolver.ts       ← Prompt effectiveness tracking + self-improvement
    ├── sub-master-detector.ts  ← Sub-master capability detection
    ├── sub-master-manager.ts   ← Sub-master session pool management
    └── delegation.ts           ← Multi-AI task delegation
```
