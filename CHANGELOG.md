# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.0.1] — 2026-02-23

### Added

#### Core Bridge

- **AI Tool Discovery** — auto-detects AI CLI tools (Claude Code, Codex, Aider, Cursor, Cody) and VS Code extensions (Copilot, Cody, Continue) installed on the machine. Zero API keys needed
- **Master AI Manager** — autonomous agent lifecycle (idle → exploring → ready), background workspace exploration, message routing, status queries
- **Incremental 5-pass exploration** — structure scan, classification, directory dives, assembly, finalization. Each pass checkpointed to disk, resumable on restart. Never times out
- **`.openbridge/` folder** — the AI's brain inside the target project. Git-tracked knowledge including workspace-map.json, agents.json, exploration state, and task history
- **Session continuity** — multi-turn Master conversations via `--session-id`/`--resume` with 30-minute TTL per sender; graceful restart on dead session
- **Multi-AI delegation** — Master can assign subtasks to other discovered AI tools via SPAWN markers
- **V2 config format** — simplified to 3 fields: `workspacePath`, `channels`, `auth`. V0 format auto-detected and supported for backward compatibility
- **Config watcher** — hot-reload config changes without restart
- **Health check endpoint** — system health monitoring
- **Metrics collection** — operational metrics tracking
- **Audit logger** — audit trail for message processing
- **Rate limiter** — per-user rate limiting

#### Connectors (5 total)

- **Console connector** — reference implementation for rapid testing without messaging platform setup
- **WebChat connector** — browser-based chat UI on `localhost:3000` with Markdown rendering, Thinking animation, and connection status indicator
- **WhatsApp connector** — via whatsapp-web.js with local webVersionCache, 3-attempt exponential backoff, session persistence, auto-reconnect
- **Telegram connector** — via grammY; DM and group @mention support, typing indicator, in-place message editing for progress
- **Discord connector** — via discord.js v14; DM and guild channel support, bot message filtering, in-place message editing for progress

#### Agent Runner

- **`AgentRunner` class** — unified CLI executor replacing all raw `spawn()` calls. Supports `--allowedTools`, `--max-turns`, `--model`, configurable retries with exponential backoff, and disk logging of every AI call
- **Streaming support** — `AgentRunner.stream()` yields stdout chunks in real time with full feature parity
- **Model fallback chain** — opus → sonnet → haiku on rate-limit or unavailability

#### Tool Profiles

- **Built-in profiles** — `read-only` (Read/Glob/Grep), `code-edit` (+Edit/Write/Bash git+npm), `full-access` (all tools), `master` (Read/Glob/Grep/Write/Edit — no Bash). Profile-based default `maxTurns`
- **Custom profile registry** — profiles stored in `.openbridge/` and resolved by AgentRunner
- **Model-selector** — recommends model based on profile and task description keywords

#### Self-Governing Master AI

- **Master system prompt** — generated from workspace context, seeded to `.openbridge/prompts/master-system.md`, editable by Master for self-improvement
- **Task decomposition** — `[SPAWN:profile]{JSON}[/SPAWN]` markers in Master output trigger concurrent worker spawning
- **Worker result injection** — structured result formatting with metadata (model, profile, duration, exit code) fed back to Master session
- **Master tool access control** — Master uses a restricted `master` profile (no Bash)

#### Worker Orchestration

- **Worker registry** — tracks all workers (pending/running/completed/failed/cancelled) with configurable concurrency limit (default 5), persisted to `.openbridge/workers.json`
- **Parallel spawning** — multiple workers run concurrently up to the concurrency limit
- **Worker timeout + cleanup** — SIGTERM/SIGKILL exit codes detected; workers marked as timeout failures
- **Depth limiting** — workers cannot spawn other workers; only Master (depth 0) can spawn
- **Task history** — every worker execution logged to `.openbridge/tasks/` with full manifest, result, duration, model, tools, and retry count

#### Self-Improvement

- **Prompt library** — prompt templates stored in `.openbridge/prompts/`, usage tracked, low-performing prompts flagged
- **Learnings store** — per-task-type learnings in `.openbridge/learnings.json`, stats calculated per model/profile
- **Prompt effectiveness tracking** — validates worker output structure, records success/failure, detects <50% success rate
- **Self-improvement cycle** — idle detection (5-min threshold) triggers: prompt rewriting via Master AI, profile creation from learnings, workspace re-exploration if package.json changed

#### Smart Orchestration

- **Task classifier** — classifies messages as `quick-answer`/`tool-use`/`complex-task` with appropriate `maxTurns` (3/10/15+)
- **Auto-delegation** — complex tasks use a planning prompt that forces the Master to output SPAWN markers rather than attempting execution directly
- **Worker turn budget** — profile-based default maxTurns per worker; `maxBudgetUsd` support via `--max-budget-usd`
- **Synthesis quality** — 5-turn synthesis step combines worker results into a coherent final response

#### AI Classification + Live Progress

- **AI-based task classifier** — 1-turn haiku call classifies intent and returns `{ class, maxTurns, reason }`. Falls back to keyword heuristics on failure. Falls back to `tool-use` on parse failure
- **Classification cache** — in-memory cache keyed by normalized message pattern, persisted to `.openbridge/classifications.json`. Post-task feedback auto-bumps `maxTurns` when timeouts occur
- **Progress event protocol** — typed `ProgressEvent` discriminated union (`classifying/planning/spawning/worker-progress/synthesizing/complete`). All connectors implement optional `sendProgress()`
- **WebChat live progress UI** — real-time status bar below the chat; step-by-step indicator with elapsed timer
- **Console progress** — overwrites same line with `\r` for clean terminal output
- **WhatsApp/Telegram/Discord progress** — single progress message sent/edited in-place (no spam)
- **Progress events wired into Master pipeline** — emitted at every stage of classification, planning, spawning, worker completion, and synthesis

#### CLI & Developer Experience

- **`npx openbridge init`** — interactive wizard with connector selection (console/whatsapp/webchat, default: console). Console and WebChat skip messaging-platform questions
- **`--help`/`-h`** — prints app name, description, version, commands; exits 0
- **`--version`/`-v`** — prints semver string; exits 0
- **Startup banner** — `OpenBridge v{version} | Master: {tool} | Connectors: {list}` printed unconditionally before Pino logging

#### Production Readiness

- **npm `"files"` field** — only `dist/`, `config.example.json`, `LICENSE`, `README.md`, `CHANGELOG.md` included in published package
- **`"exports"` map** — subpath control: `{ ".": { "import": "./dist/index.js", "types": "./dist/index.d.ts" } }`
- **Global error handlers** — `unhandledRejection`, `uncaughtException`, `SIGHUP` in `src/index.ts`; `shutdownInProgress` flag prevents double-shutdown
- **Shutdown drain timeout** — `drainTimeoutMs` (default 30 000 ms) prevents indefinite hang when a message handler is stuck
- **Inbound message length cap** — `MAX_INBOUND_LENGTH = 32 768` chars; truncation logged as warn before auth/queue
- **Empty whitelist warning** — `AuthService` constructor logs `warn` when whitelist is empty (silent open access footgun → observable)
- **`NODE_ENV=production` start script** — `npm start` sets `NODE_ENV=production node dist/index.js`
- **`pino-pretty` moved to devDependencies** — production installs stay lean; transport wrapped in try/catch for resilience
- **`LOG_LEVEL` env var override** — wired into root Pino logger alongside config `logLevel` field
- **Release workflow** — `.github/workflows/release.yml` on `v*` tag push: lint → typecheck → test → build → npm publish → GitHub Release
- **Dependabot** — weekly npm dependency updates, minor/patch grouped
- **1 218 tests passing** across 60 test files; discovery module tests, bridge/router coverage tests, AI classifier integration tests

### Changed

- **Documentation rewrite** — README, OVERVIEW, ARCHITECTURE, CONFIGURATION, and CLAUDE.md files rewritten for autonomous AI vision
- **Router** — added Master AI routing path with priority over direct provider; `sendDirect()` for connector-targeted delivery; `sendProgress()` for progress event dispatch
- **Bridge** — integrated Master AI lifecycle (discovery → exploration → ready); idempotent `stop()`; drain timeout
- **CLI executor** — generalized from Claude-only to support any AI tool CLI; all callers migrated to `AgentRunner`
- **Config loader** — auto-detects V2 vs V0 format, converts internally; tilde (`~`) expansion in `workspacePath`
- **ARCHITECTURE.md** — updated to 5-layer diagram, all connectors listed as stable
- **CHANGELOG** — versioned; `[Unreleased]` properly maintained above `[0.0.1]`

### Removed

- **Old knowledge layer** — workspace-scanner, api-executor, tool-catalog, tool-executor (archived to `src/_archived/knowledge/`)
- **Old orchestrator** — script-coordinator, task-agent-runtime (archived to `src/_archived/orchestrator/`)
- **Old core modules** — workspace-manager, map-loader (archived to `src/_archived/core/`)
- **`WORKSPACE_MAP_SPEC.md`** — no longer relevant (AI generates its own maps)
- **`--dangerously-skip-permissions` dead code** — removed from `claude-code-executor.ts`; closes privilege escalation surface
- **Internal utilities from public API** — `injectDevConnectors` and `expandTilde` removed from `src/core/index.ts` exports

### Fixed

- `tsx watch` killing process on file changes — switched to `tsx` without watch for AI execution safety
- No graceful shutdown guard — added `shutdownInProgress` flag + idempotent `Bridge.stop()`
- CLI executor hardcoded to `claude` — generalized for any AI tool
- Master session ID using invalid UUID format — removed `master-` prefix; Claude CLI requires raw UUID
- `maxTurns: 3` blocking all non-Q&A tasks — task classifier sets appropriate budgets per message
- Empty whitelist silently granting open access — warning log added in `AuthService` constructor
- `pino` `MaxListenersExceededWarning` — converted to singleton root logger + child() per module
- Missing config file showing stack trace — friendly ENOENT message with `npx openbridge init` hint

## [0.1.0] — 2026-02-19

### Added

- Initial project scaffolding
- Plugin architecture with Connector and AIProvider interfaces
- Bridge core: router, auth (whitelist), message queue, config loader, plugin registry
- WhatsApp connector (V0) via whatsapp-web.js
- Claude Code AI provider (V0) via CLI
- Zod-based configuration validation
- ESLint + Prettier + Husky + commitlint tooling
- CI workflow with GitHub Actions
- Community docs (README, CONTRIBUTING, CODE_OF_CONDUCT, SECURITY)
