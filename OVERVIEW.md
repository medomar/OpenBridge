# OpenBridge

## What is OpenBridge?

OpenBridge is an open-source platform that turns AI into an **autonomous worker for your project**. Point it at any workspace, connect your messaging app, and the AI explores your project, learns its structure, and executes tasks on your behalf — all using the AI tools already installed on your machine.

There are no API keys to configure. No map files to write. No complex setup. OpenBridge auto-discovers the AI tools on your system (Claude Code, Codex, Aider, etc.), picks the most capable one as the "Master", and lets it work.

## Why OpenBridge?

**The problem:** AI tools are powerful but isolated. You open Claude Code, type a question, get an answer, then manually relay instructions. You can't trigger AI work from your phone. You can't coordinate multiple AI tools. You can't give an AI persistent knowledge of your project that survives across sessions.

**The solution:** OpenBridge bridges the gap between you and your AI tools:

- **Message from anywhere** — send a WhatsApp message, the AI handles it in your workspace
- **Zero setup** — auto-discovers installed AI tools, no API keys, no config files to study
- **Autonomous exploration** — the Master AI silently learns your project on startup
- **Persistent knowledge** — everything the AI learns is stored in `.openbridge/` with git tracking
- **Multi-AI** — the Master can delegate tasks to other AI tools found on your machine
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
2. Connect WhatsApp (restore session or scan QR)
3. Auto-discover AI tools:
   - Scan: claude? codex? aider? cursor?
   - Pick Master (most capable)
   - Register others as delegates
4. Launch Master AI silently:
   - Explore target workspace
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
    |                                     |  Master AI already explored
    |                                     |  Replies from its knowledge
    |  "Your project is a Node.js        |
    |   API with 12 routes, PostgreSQL   |
    |   database, React frontend..."     |
    | <────────────────────────────────── |
    |                                     |
    |  "/ai add input validation         |
    |   to the login endpoint"           |
    | ──────────────────────────────────> |
    |                                     |  Master AI modifies files
    |                                     |  Changes tracked in .openbridge/.git
    |  "Done. Added zod validation       |
    |   to POST /auth/login. Changes     |
    |   committed."                      |
    | <────────────────────────────────── |
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

The Master runs your test suite, identifies failures, reads the failing code, applies fixes, and reports back. All changes tracked in `.openbridge/.git`.

### Multi-AI Collaboration

> _"/ai refactor the database layer to use Prisma"_

The Master delegates subtasks — one AI tool analyzes the current schema, another generates Prisma models, the Master coordinates and verifies the result.

## Architecture

OpenBridge has 4 layers:

```
┌──────────────────────────────────────────────────────────────────┐
│                        CHANNELS                                   │
│  WhatsApp · Telegram · Discord · Web Chat                         │
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
│                     MASTER AI                                      │
│  Master Manager · .openbridge/ Folder · Delegation Coordinator    │
│  Autonomous workspace exploration, task execution, multi-AI        │
│  delegation, git-tracked knowledge in .openbridge/                 │
└──────────────────────────────────────────────────────────────────┘
```

### Layer 1: Channels (Connectors)

Messaging platform adapters. Each implements the `Connector` interface.

| Channel  | Status | Library           |
| -------- | :----: | ----------------- |
| WhatsApp |   V0   | `whatsapp-web.js` |
| Console  |   V0   | built-in (stdin)  |
| Telegram |   --   | planned           |
| Discord  |   --   | planned           |

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

### Layer 4: Master AI

The autonomous agent that knows your project:

- **Master Manager** — launches the Master AI, manages its lifecycle (idle → exploring → ready)
- **`.openbridge/` Folder** — the AI's brain, stored inside your target project:
  ```
  .openbridge/
  ├── .git/                ← tracks all AI changes
  ├── workspace-map.json   ← auto-generated project understanding
  ├── exploration.log      ← scan history
  ├── agents.json          ← discovered AI tools + roles
  └── tasks/               ← task history
  ```
- **Delegation** — Master can assign subtasks to other discovered AI tools
- **Silent by default** — only speaks when the user sends a message

## Business Model

OpenBridge is open source (Apache 2.0). The tool is free; the expertise to configure it is the service.

**For developers:** Run it on your machine, connect your AI subscription, and operate your projects from anywhere.

**For businesses:** Set up OpenBridge for a team — connect their workspace, configure their channel, and hand them a system they control from their phones.

**For the community:** Extend with new connectors, AI tool integrations, and exploration strategies.

## Current Status

| Component        | Status                                                     |
| ---------------- | ---------------------------------------------------------- |
| WhatsApp         | V0 — auto-reconnect, sessions, chunking, typing indicators |
| Claude Code      | V0 — streaming, sessions, error classification             |
| Bridge Core      | V0 — router, auth, queue, metrics, health, audit           |
| AI Discovery     | Planned — Phase 6                                          |
| Master AI        | Planned — Phase 7                                          |
| V2 Config        | Planned — Phase 8                                          |
| Multi-AI         | Planned — Phase 10                                         |
| Telegram/Discord | Planned — Phase 14                                         |

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
