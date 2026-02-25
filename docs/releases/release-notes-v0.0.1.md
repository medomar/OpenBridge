# OpenBridge v0.0.1 — Release Notes

**Release date:** 2026-02-23
**npm:** `npm install openbridge`
**Node.js:** >= 22.0.0

---

## What is OpenBridge?

OpenBridge is an **autonomous AI bridge** that connects messaging platforms (WhatsApp, Telegram, Discord, WebChat, Console) to a **self-governing Master AI** running on your machine. You configure three things — a workspace path, a messaging channel, and a phone whitelist — and OpenBridge handles the rest.

On startup the system:

1. Scans your machine for installed AI tools (`claude`, `codex`, `aider`, etc.)
2. Picks the most capable one as **Master AI**
3. Master silently explores your target workspace in 5 incremental passes (never times out)
4. Creates `.openbridge/` inside your project — the AI's persistent knowledge store
5. Waits for your messages

When a message arrives, the Master classifies intent, answers directly or decomposes the task into worker subtasks (SPAWN markers), and synthesizes the final response. Workers run with restricted tool access (`read-only`, `code-edit`, `full-access`) determined by the Master per task.

**Zero API keys. Zero extra cost. Uses your existing AI subscriptions.**

---

## What's in v0.0.1

### 5 Connectors

| Connector | Status | Notes                                  |
| --------- | :----: | -------------------------------------- |
| Console   |   ✅   | Default for local testing              |
| WebChat   |   ✅   | Browser UI at `localhost:3000`         |
| WhatsApp  |   ✅   | Via whatsapp-web.js, QR scan required  |
| Telegram  |   ✅   | Via grammY, BotFather setup required   |
| Discord   |   ✅   | Via discord.js v14, bot token required |

### Core Features

- **Agent Runner** — unified CLI executor with `--allowedTools`, `--max-turns`, `--model`, retries, disk logging
- **Tool profiles** — `read-only`, `code-edit`, `full-access`, `master` built-in profiles
- **Self-governing Master AI** — persistent session, editable system prompt, self-improvement cycle
- **Task decomposition** — `[SPAWN:profile]{JSON}[/SPAWN]` markers trigger concurrent workers
- **Worker registry** — tracks all workers with concurrency limits, timeout detection, task history
- **AI task classifier** — 1-turn haiku call with keyword fallback; returns class, maxTurns, reason
- **Classification cache** — in-memory + disk; feedback loop auto-adjusts turn budgets
- **Live progress events** — real-time status in all connectors; WebChat has animated status bar

### Developer Experience

- `npx openbridge init` — connector selection wizard (console/whatsapp/webchat)
- `openbridge --help` and `openbridge --version` exit 0
- Startup banner: `OpenBridge v0.0.1 | Master: claude | Connectors: console`
- Actionable error on missing config: `npx openbridge init`
- 1 218 tests across 60 test files; CI: lint + typecheck + test + build

### Production Hardening

- npm `"files"` + `"exports"` map — only `dist/` published
- Global error handlers (`unhandledRejection`, `uncaughtException`, `SIGHUP`)
- Shutdown drain timeout (30 s) — never hangs on stuck handler
- Inbound message length cap (32 768 chars)
- Empty whitelist emits a `warn` log (was silent open access)
- `NODE_ENV=production` start script
- `pino-pretty` in devDependencies only
- Release workflow on `v*` tag push

---

## Getting Started

### Option A — Console (fastest, no messaging platform)

```bash
npm install -g openbridge   # or: npx openbridge
openbridge init             # choose 'console', enter workspace path
npm run dev                 # or: node dist/index.js
```

### Option B — WebChat (browser UI)

```bash
openbridge init             # choose 'webchat', enter workspace path
npm run dev
# Open http://localhost:3000 in your browser
```

### Option C — WhatsApp

```bash
openbridge init             # choose 'whatsapp', enter workspace path + whitelist
npm run dev
# Scan the QR code with WhatsApp Linked Devices
# Send: /ai what's in this project?
```

---

## Known Limitations

| Limitation                           | Notes                                                                               |
| ------------------------------------ | ----------------------------------------------------------------------------------- |
| Single Master AI per instance        | Only one Master AI session; multi-Master coordination is a future phase             |
| Workers cannot spawn sub-workers     | Depth limited to 1 by design (prevents runaway recursion)                           |
| Self-improvement requires idle time  | The improvement cycle triggers after 5 minutes of inactivity                        |
| No vector memory                     | Long-term knowledge is in `workspace-map.json`; no embedding/similarity search yet  |
| WhatsApp session requires re-scan    | If WhatsApp session expires, a new QR code must be scanned                          |
| Discord/Telegram tokens in plaintext | Store in environment variables; do not commit `config.json` with real tokens        |
| `claude` CLI required for Master     | Other AI tools (Codex, Aider) are supported as workers but Claude Code is preferred |
| No Docker sandbox                    | Workers run on the host machine with the configured tool profile restrictions       |

---

## Upgrade Path from v0.0.0 / pre-release

There is no `v0.0.0`; this is the first published release. If you cloned the repository during development:

1. Pull the latest `main` branch
2. Run `npm install` to pick up dependency changes (`pino-pretty` moved to devDeps)
3. Run `npm run build` to compile TypeScript
4. Update your `config.json` — V0 format is still supported; V2 format adds `workspacePath` as the primary field

---

## What's Next (Backlog)

- Memory system — SQLite + FTS5 replacing JSON files, worker briefings, intelligent retrieval
- Media support — file attachments, voice messages, proactive messaging
- Conversation memory — long-term history with context retrieval, prompt evolution
- Agent dashboard — real-time worker tracking with progress bars, cost tracking
- Access control — per-user roles with scoped permissions
- Hierarchical masters — automatic sub-master creation for large workspaces
- Server deployment — Docker, headless mode, remote workspaces

---

## Full Changelog

See [CHANGELOG.md](../CHANGELOG.md) for the complete list of changes.
