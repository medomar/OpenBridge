# OpenBridge

## What is OpenBridge?

OpenBridge is an open-source platform that turns AI into a **self-governing autonomous worker for your project**. Point it at any workspace, connect your messaging app, and a Master AI explores your project, spawns worker agents to execute tasks, and continuously improves its own strategies — all using the AI tools already installed on your machine.

There are no API keys to configure. No map files to write. No complex setup. OpenBridge auto-discovers the AI tools on your system (Claude Code, Codex, Aider, etc.), picks the most capable one as the Master, and lets it govern itself.

## Why OpenBridge?

**The problem:** AI tools are powerful but isolated. You open Claude Code, type a question, get an answer, then manually relay instructions. You can't trigger AI work from your phone. You can't coordinate multiple AI tools. You can't give an AI persistent knowledge of your project that survives across sessions.

**The solution:** OpenBridge bridges the gap between you and your AI tools:

- **Message from anywhere** — send a WhatsApp message, the AI handles it in your workspace
- **Zero setup** — auto-discovers installed AI tools, no API keys, no config files to study
- **Self-governing Master** — the Master AI decides which model, tools, and strategy to use for each task
- **Worker delegation** — Master spawns short-lived worker agents with bounded permissions
- **Persistent knowledge** — everything the AI learns is stored in `.openbridge/` with git tracking
- **Self-improvement** — Master tracks what works and refines its own prompts over time
- **Your subscription** — runs locally, uses your existing AI tools, zero extra cost

## How It Works

### Setup (one time)

```
openbridge init
  → Workspace path? /Users/you/my-project
  → Phone whitelist? +1234567890
  → Done. Run: openbridge start
```

### On Startup

```
1. Load config (workspace path + channel + whitelist)
2. Connect channel (Console / WebChat / WhatsApp / Telegram / Discord)
3. Auto-discover AI tools:
   - Scan: claude? codex? aider? cursor?
   - Pick Master (most capable)
   - Register others as worker candidates
4. Launch Master AI as long-lived session:
   - Explore workspace via worker agents (read-only, haiku model)
   - Create .openbridge/ folder
   - Generate workspace understanding
   - Init local git repo for tracking
5. Ready. Waiting for messages.
```

### User Interaction

```
You (WhatsApp)                    OpenBridge (your machine)
    |                                     |
    |  "/ai what's in my project?"       |
    | ──────────────────────────────────> |
    |                                     |  Master AI replies from
    |                                     |  its workspace knowledge
    |  "Your project is a Node.js        |
    |   API with 12 routes, PostgreSQL   |
    |   database, React frontend..."     |
    | <────────────────────────────────── |
    |                                     |
    |  "/ai add input validation         |
    |   to the login endpoint"           |
    | ──────────────────────────────────> |
    |                                     |  Master spawns workers:
    |                                     |  → Worker 1 (haiku): read code
    |                                     |  → Worker 2 (sonnet): add validation
    |                                     |  → Worker 3 (haiku): run tests
    |  "Done. Added zod validation       |
    |   to POST /auth/login. Changes     |
    |   committed. All tests pass."      |
    | <────────────────────────────────── |
```

### How the Master Governs Workers

```
User sends: "/ai refactor auth to use JWT"
    │
    ▼
Master AI (long-lived session, opus)
    │ thinks: "Complex task. I need to:
    │   1. Read current auth code
    │   2. Implement JWT
    │   3. Run tests"
    │
    ├──► Worker 1: { model: "haiku", profile: "read-only", task: "read auth files" }
    │         └──► returns file contents
    │
    ├──► Master analyzes, plans the change
    │
    ├──► Worker 2: { model: "sonnet", profile: "code-edit", task: "implement JWT" }
    │         └──► returns diff + result
    │
    ├──► Worker 3: { model: "haiku", profile: "code-edit", task: "run tests" }
    │         └──► returns test output
    │
    ▼
Master: "Done. Refactored to JWT. 4 files modified, all tests pass."
    │
    ▼
User (WhatsApp) ← response
```

## Real-World Use Cases

### Manage Your Projects from Your Phone

> _"/ai what changed since yesterday?"_

The Master checks `.openbridge/.git` and your project's git log, then summarizes recent changes — files modified, commits made, current branch status.

### Explore Unfamiliar Codebases

> _"/ai explain how authentication works in this project"_

The Master already explored the workspace on startup. It knows the file structure, key modules, and how they connect. It replies with a clear explanation.

### Execute Tasks While Away

> _"/ai run the tests and fix any failures"_

The Master spawns a worker to run tests, another to read failing code, another to fix it. All changes tracked in `.openbridge/.git`.

### Multi-AI Collaboration

> _"/ai refactor the database layer to use Prisma"_

The Master delegates subtasks to workers — one analyzes the current schema, another generates Prisma models, the Master coordinates and verifies the result.

### Multi-Turn Conversations

> _You: "/ai which invoices are overdue?"_
> _AI: "3 invoices: Client A ($1,200), Client B ($850), Client C ($2,400)"_
> _You: "/ai send reminder emails to those clients"_

Session continuity preserves context across messages. The AI remembers "those clients" refers to A, B, and C from the previous question.

### Non-Code Workspaces

> _You: "/ai what ingredients are running low this week?"_

Point OpenBridge at a folder of spreadsheets — the Master reads your files and answers business questions. Works for cafes, law firms, real estate, accounting, and any business with files to query. See [USE_CASES.md](docs/USE_CASES.md).

## Architecture

OpenBridge has 5 layers:

```
┌──────────────────────────────────────────────────────────────────┐
│                        CHANNELS                                   │
│  Console · WebChat · WhatsApp · Telegram · Discord                 │
│  Messaging adapters that translate between platforms and bridge    │
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
│  Discovers AI tools on the machine, ranks them, picks Master      │
└──────────────────────┬────────────────────────────────────────────┘
                       │
                       ▼
┌──────────────────────────────────────────────────────────────────┐
│                   AGENT RUNNER                                     │
│  Unified executor: --allowedTools · --max-turns · --model          │
│  Retries · Disk logging · Streaming · Tool profiles                │
│  Spawns worker processes with bounded permissions                  │
└──────────────────────┬────────────────────────────────────────────┘
                       │
                       ▼
┌──────────────────────────────────────────────────────────────────┐
│                    MASTER AI                                       │
│  Self-governing: picks model, tools, strategy per task             │
│  Long-lived session · Worker spawning · Task decomposition         │
│  .openbridge/ knowledge · Self-improvement · Learnings             │
└──────────────────────────────────────────────────────────────────┘
```

### Layer 1: Channels (Connectors)

Messaging platform adapters. Each implements the `Connector` interface.

| Channel  | Status | Library           |
| -------- | :----: | ----------------- |
| Console  |   ✅   | built-in (stdin)  |
| WebChat  |   ✅   | built-in (ws)     |
| WhatsApp |   ✅   | `whatsapp-web.js` |
| Telegram |   ✅   | `grammy`          |
| Discord  |   ✅   | `discord.js` v14  |

### Layer 2: Bridge Core

The engine that wires everything together:

- **Router** — routes messages from connector → Master AI → connector, with streaming and progress updates
- **AuthService** — phone whitelist, command prefix (`/ai`), per-sender rate limiting
- **MessageQueue** — per-user sequential processing with retry and dead-letter queue
- **PluginRegistry** — auto-discovers connectors via factory pattern
- **Config** — Zod-validated `config.json` with hot-reload
- **Health + Metrics** — optional HTTP endpoints for monitoring

### Layer 3: AI Discovery

Auto-detects AI tools on the machine at startup:

- **CLI Scanner** — runs `which claude`, `which codex`, etc. to find installed tools
- **VS Code Scanner** — checks `~/.vscode/extensions/` for AI extensions
- **Auto-Selection** — ranks tools by capability, picks the best as Master
- **No API keys needed** — uses tools that are already authenticated via your terminal/IDE

### Layer 4: Agent Runner

Unified executor for all AI CLI calls. Inspired by the project's bash scripts (`scripts/run-tasks.sh`):

- **`--allowedTools`** — restricts what the AI can do (no `--dangerously-skip-permissions`)
- **`--max-turns`** — bounds agent execution to prevent runaway processes
- **`--model`** — selects the model per task (haiku for mechanical work, opus for reasoning)
- **Retry logic** — configurable retries with backoff (default: 3 attempts, 10s delay)
- **Disk logging** — full stdout/stderr written to `.openbridge/logs/`
- **Tool profiles** — `read-only`, `code-edit`, `full-access` — Master picks per task

### Layer 5: Master AI

The self-governing autonomous agent:

- **Long-lived session** — maintains context across messages (not single-turn `--print` calls)
- **Task decomposition** — breaks complex user requests into worker subtasks
- **Worker spawning** — creates short-lived worker agents with specific model + tools + turn limits
- **Auto-announcement** — workers report results back to Master (no polling)
- **`.openbridge/` Folder** — the AI's brain, stored inside your target project:
  ```
  .openbridge/
  ├── .git/                ← tracks all AI changes
  ├── workspace-map.json   ← auto-generated project understanding
  ├── master-session.json  ← Master session ID for resume across restarts
  ├── profiles.json        ← custom tool profiles created by Master
  ├── prompts/             ← editable prompt templates
  ├── learnings.json       ← what worked, what didn't, model selection patterns
  ├── exploration/         ← incremental exploration state
  ├── logs/                ← full worker execution logs
  ├── agents.json          ← discovered AI tools + roles
  ├── workers.json         ← active worker registry
  └── tasks/               ← task history
  ```
- **Self-improvement** — Master tracks prompt effectiveness, refines strategies, creates custom profiles
- **Silent by default** — only speaks when the user sends a message

## Business Model

OpenBridge is open source (Apache 2.0). The tool is free; the expertise to configure it is the service.

**For developers:** Run it on your machine, connect your AI subscription, and operate your projects from anywhere.

**For businesses:** Set up OpenBridge for a team — connect their workspace, configure their channel, and hand them a system they control from their phones.

**For the community:** Extend with new connectors, AI tool integrations, and exploration strategies.

## Current Status

| Component               | Status                                                                                    |
| ----------------------- | ----------------------------------------------------------------------------------------- |
| Console                 | ✅ Stable — simplest path; E2E verified, no external accounts required                    |
| WebChat                 | ✅ Stable — localhost:3000 UI, markdown rendering, connection status, typing indicator    |
| WhatsApp                | ✅ Stable — auto-reconnect, sessions, chunking, typing indicators, local web cache        |
| Telegram                | ✅ Stable — grammY, DM + group @mention support, typing indicator                         |
| Discord                 | ✅ Stable — discord.js v14, DM + guild channel, bot message filtering                     |
| Bridge Core             | ✅ Stable — router, auth, queue, metrics, health, audit, rate limiting                    |
| AI Discovery            | ✅ Stable — CLI scanner, VS Code scanner, auto-selection, capability ranking              |
| V2 Config               | ✅ Stable — 3-field setup, V0 backward compatibility, CLI init, tilde expansion           |
| Agent Runner            | ✅ Stable — `--allowedTools`, `--max-turns`, `--model`, retries, streaming, disk logging  |
| Tool Profiles           | ✅ Stable — read-only, code-edit, full-access, master; custom profiles registry           |
| Smart Orchestration     | ✅ Stable — task classifier (quick/tool-use/complex), auto-delegation, progress feedback  |
| Self-Governing Master   | ✅ Stable — persistent session, task decomposition, worker spawning, session recovery     |
| Worker Orchestration    | ✅ Stable — parallel workers, registry, depth limiting, task history, timeout + cleanup   |
| Incremental Exploration | ✅ Stable — 5-pass with checkpointing, git + timestamp change detection, freshness track  |
| Self-Improvement        | ✅ Stable — prompt library, learnings store, effectiveness tracking, idle self-refinement |

## Tech Stack

- **Runtime:** Node.js >= 22 (ESM)
- **Language:** TypeScript 5.7+ (strict mode)
- **Testing:** Vitest
- **Linting:** ESLint 9 flat config + typescript-eslint
- **Formatting:** Prettier
- **Git hooks:** Husky v9 + lint-staged + commitlint (conventional commits)
- **Config validation:** Zod
- **Logging:** Pino
- **License:** Apache 2.0
