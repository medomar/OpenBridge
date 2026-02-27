# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.0.3] — 2026-02-26

### Added

#### Exploration Overhaul (Phase 50)

- **`explore` command** — users can trigger workspace re-exploration from any messaging channel (WhatsApp, Console, WebChat, Telegram, Discord). Syntax: `explore` (quick refresh), `explore full` (5-phase re-exploration), `explore status` (show progress)
- **`fullReExplore()` on MasterManager** — public method that clears exploration state and runs the complete 5-phase ExplorationCoordinator pipeline; accessible from any channel via the `explore full` command
- **Large directory splitting (OB-F26)** — directories exceeding 25 files are automatically split into subdirectories before Phase 3 dives. Each subdirectory gets its own worker. `src/` with 8 subdirs no longer times out
- **Per-directory timeout scaling** — dive timeout scales with file count: `max(180s, min(600s, fileCount * 4s))`. Small dirs get 3 min, large dirs up to 10 min
- **2-level scopes for incremental re-exploration** — `extractChangedScopes()` produces `src/core` instead of `src` when split directories are active, enabling finer-grained stale scope detection
- **`splitDirs` field on `StructureScanSchema`** — records which top-level directories were split and into which subdirectories, persisted for incremental scope matching
- **`fileCount` field on `DirectoryDiveStatusSchema`** — stores estimated file count per dive target for timeout scaling
- **Stale re-exploration progress tracking** — `reexploreStaleDirs()` now inserts `exploration_progress` rows for the parent operation and each directory dive
- **Incremental exploration activity tracking** — `incrementalExplore()` creates an `agent_activity` row (type `explorer`) with start/completion tracking
- **Stuck activity cleanup** — MasterManager marks `agent_activity` rows stuck in `running` for over 1 hour as `failed` on startup

### Fixed

- Large directory exploration times out (OB-F26) — `src/` with 40+ files across 8 subdirs is now split into separate workers (`src/core`, `src/master`, etc.) instead of one monolithic 3-minute dive

## [Unreleased]

### Added

#### Prompt Library — DotFolderManager (Phase 51)

- **`readPromptManifest()`** on `DotFolderManager` — reads `.openbridge/prompts/manifest.json`, validates with `PromptManifestSchema`, returns `PromptManifest | null`
- **`writePromptManifest(manifest)`** on `DotFolderManager` — validates + writes manifest file, creates directory if needed
- **`writePromptTemplate(filename, content, metadata)`** on `DotFolderManager` — writes `.md` file to `.openbridge/prompts/`, creates/updates manifest entry, preserves `createdAt` on update, sets `previousVersion`/`previousSuccessRate` when overwriting
- **`getPromptTemplate(id)`** on `DotFolderManager` — looks up prompt by id in manifest, returns `PromptTemplate | null`
- **`recordPromptUsage(id, success)`** on `DotFolderManager` — increments `usageCount`/`successCount`, recalculates `successRate`, updates `lastUsedAt`
- **`getLowPerformingPrompts(threshold)`** on `DotFolderManager` — filters manifest prompts where `usageCount >= 3` and `successRate < threshold`
- **`resetPromptStats(id)`** on `DotFolderManager` — zeros usage stats, preserves current `successRate` as `previousSuccessRate`
- **JSONL flat-file output in `AuditLogger`** — `write()` now appends JSON lines to `logPath` (parent directories auto-created); Pino + SQLite remain as secondary sinks

#### Conversation Continuity — `memory.md` Pattern (Phase 52)

- **`readMemoryFile()`** on `DotFolderManager` — reads `.openbridge/context/memory.md`, returns `string | null`; `.openbridge/context/` created on `initialize()`
- **`writeMemoryFile(content)`** on `DotFolderManager` — writes to `.openbridge/context/memory.md`, validates content length ≤ 200 lines
- **`memory.md` context injection** — `buildConversationContext()` loads `memory.md` as primary context on every session start; FTS5 search used only as fallback when memory doesn't cover the topic
- **Session-end memory update** — when Master session ends or after N messages, a final prompt is sent: _"Update your memory file. Keep under 200 lines. Remove outdated info. Merge related topics."_; Master writes via worker with `Write` tool
- **`memory.md` instructions in Master system prompt** — what to remember (decisions, preferences, project state), what not to remember (raw transcripts, every worker result), 200-line cap, merge topics guidance
- **`searchConversations()` fallback** — when Master detects the current topic is not in `memory.md`, FTS5 cross-session search is triggered for deeper context
- **`evictOldData()` scheduled** — called on Bridge startup and on a `setInterval(24h)` to keep SQLite lean; wired into `bridge.ts`

#### Conversation History Access — `/history` Command (Phase 53)

- **`listSessions(limit, offset)`** on `conversation-store.ts` — returns `{ session_id, title, first_message_at, last_message_at, message_count, channel, user_id }[]` ordered by `last_message_at DESC`
- **`title` column on `conversations` table** — nullable `TEXT`, set to first user message (truncated to 50 chars) on session creation; added via migration
- **`searchSessions(query, limit)`** on `conversation-store.ts` — FTS5 search returning session-level results grouped by `session_id`, ranked by relevance
- **`/history` command** — lists the last 10 sessions with title, date, and message count; available on all channels (WhatsApp = numbered list, Console = table, WebChat = HTML)
- **`/history search <query>` command** — searches past conversations by keyword via `searchSessions()`
- **`/history <session-id>` command** — shows full conversation transcript for a session via `getSessionHistory()`
- **`/api/sessions` REST endpoint** (WebChat) — JSON list of sessions for frontend consumption
- **`/api/sessions/:id` REST endpoint** (WebChat) — full conversation JSON for a single session

#### Schema Versioning (Phase 54)

- **`schema_versions` table** — `(version INTEGER PRIMARY KEY, applied_at TEXT, description TEXT)` tracks every applied migration
- **Numbered migrations** — all existing `ALTER TABLE` sequences assigned version numbers 1–N in `migration.ts`
- **Idempotent migration runner** — on startup, queries `MAX(version)` from `schema_versions` and only runs migrations with version > max; each migration wrapped in a transaction for safe rollback
- **Migration tests** — verify idempotency (running twice is safe), version tracking, and rollback-on-failure behaviour

#### Worker Streaming & Session Checkpointing (Phase 55)

- **Worker progress streaming** — `execOnceStreaming()` streams stdout chunks from active workers; turn indicators parsed from CLI output
- **`worker-progress` broadcast events** — `{ workerId, turnsUsed, turnsMax, lastAction }` sent to all connectors as workers execute; WebChat displays a live progress bar
- **`checkpointSession()`** on `MasterManager` — serializes pending workers, accumulated results, and message context to the `sessions` table so state survives restart or preemption
- **`resumeSession()`** on `MasterManager` — restores session state from the `sessions` table and continues processing from the checkpoint
- **Checkpoint/resume wired to priority queue** — urgent messages trigger a checkpoint-handle-resume cycle via `onUrgentEnqueued`; urgent messages are handled immediately without losing in-flight work

#### Memory System (SQLite + FTS5)

- **`src/memory/` module** — full SQLite + FTS5 memory layer replacing all `.openbridge/` JSON files. Single database file: `.openbridge/openbridge.db` (WAL mode)
- **`database.ts`** — DB initialisation, WAL mode, PRAGMA tuning, schema creation
- **`chunk-store.ts`** — workspace knowledge chunks (~500 tokens each) with FTS5 full-text search
- **`conversation-store.ts`** — every user↔Master message exchange with FTS5 search and 30/90-day eviction policy
- **`task-store.ts`** — task execution records + aggregated model/task-type performance learnings
- **`prompt-store.ts`** — versioned prompts with effectiveness tracking (usage_count, success_count)
- **`retrieval.ts`** — hybrid search: FTS5 layer + AI-powered semantic reranking (top-20 → top-5 via haiku call)
- **`worker-briefing.ts`** — context packages built for each worker before spawn: relevant chunks, past task history, learned patterns
- **`activity-store.ts`** — real-time `agent_activity` and `exploration_progress` table CRUD for agent dashboard
- **`migration.ts`** — one-time JSON → SQLite migration for existing `.openbridge/` installs
- **`eviction.ts`** — configurable data lifecycle (30 day full / 90 day summary / 365 day archive / 500 MB hard cap)
- **`access-store.ts`** — role-based access control DB layer (owner/admin/developer/viewer/custom roles)
- **`sub-master-store.ts`** — `sub_masters` registry table for hierarchical master management

#### Media & Proactive Messaging

- **`OutboundMessage.media`** — optional attachment field (`{ type, data, mimeType, filename? }`) — every connector now supports sending documents, images, audio, and video alongside text
- **`[SEND:channel]recipient|content[/SEND]` marker** — Master AI can proactively message specific users on any channel; only whitelisted numbers can be targeted
- **`[VOICE]text[/VOICE]` marker** — Master AI wraps text in VOICE markers for connectors that support TTS delivery

#### Content Publishing & Sharing

- **`[SHARE:channel]/path/to/file[/SHARE]` marker** — Master AI output triggers file delivery via the named channel (whatsapp/webchat/email)
- **`src/core/file-server.ts`** — local HTTP file server; generated content available at `http://localhost:3000/shared/<file>` instantly, zero config
- **`src/core/email-sender.ts`** — SMTP integration; Master can email generated files to a configured address using `[SHARE:email]` markers
- **`src/core/github-publisher.ts`** — pushes HTML/static content to a `gh-pages` branch; Master can publish reports to GitHub Pages using `[SHARE:github-pages]` markers

#### Access Control

- **Role-based access control** — per-user roles (owner/admin/developer/viewer/custom) enforced in the auth layer. Roles control allowed actions, workspace scopes, and daily cost budget
- **`npx openbridge access`** — CLI subcommands: `access add <number> --role <role>`, `access list`, `access remove <number>`, `access update <number> --role <role>`
- **`stop` command restricted to owner/admin** — viewer and developer roles receive a permission-denied response

#### Agent Dashboard & Exploration Progress

- **`agent_activity` table** — every Master session, worker spawn, and exploration run recorded with real-time status, model, PID, and cost. Powers the `/status` command
- **`exploration_progress` table** — per-phase (structure_scan/classification/directory_dives/assembly/finalization) and per-directory progress rows with `progress_pct` 0→100
- **`explorationId` wired through** — `masterDrivenExplore()` and `incrementalExplore()` now create an `agent_activity` row (type `explorer`) and pass its ID to `ExplorationCoordinator`, so all 5 exploration phases are tracked
- **WebChat agent dashboard** — live activity view in the browser UI: worker rows with model/profile/status/elapsed time; stop buttons per worker and a "Stop All" header button; exploration progress bars during startup

#### Worker Resilience — Max-Turns + Failure Recovery

- **Max-turns exhaustion detection** — worker stdout scanned for Claude CLI's turn-limit indicator; `AgentResult.turnsExhausted` flag set on detection
- **Adaptive turn budget** — `spawnWorker()` computes `maxTurns = baselineTurns + ⌈promptLength / 1000⌉` capped at 50; explicit SPAWN marker `maxTurns` overrides adaptive value
- **Turn-budget warning injected into worker prompts** — workers instructed to output `[INCOMPLETE: step X/Y]` if they cannot finish within their budget
- **Auto-retry on turns exhaustion** — `turnsExhausted=true` triggers one retry with `maxTurns * 1.5`; partial output injected as context ("Previous attempt completed X steps. Continue from step X+1.")
- **`classifyError(stderr, exitCode): ErrorCategory`** — returns `'rate-limit' | 'auth' | 'timeout' | 'crash' | 'context-overflow' | 'unknown'` via stderr pattern matching
- **Default retries 0 → 2** — workers now retry twice by default; retries fire only for `rate-limit`, `timeout`, and `crash` — not for `auth` or `context-overflow`
- **Master-driven re-delegation** — persistent worker failure formatted as `[WORKER FAILED: <category>]`; Master instructed to retry with a different model on rate-limit, split tasks on context-overflow, and report to user on auth errors
- **Worker failure patterns recorded** — `memory.recordLearning({ task_type, model, success: false })` after each failure; models with >50% failure rate for a task type are deprioritised on next spawn

#### Worker Control Commands

- **Real PID capture** — `AgentRunner.spawnWithHandle()` returns `{ promise, pid, abort }`; `spawnWorker()` records the actual process PID instead of -1
- **`killWorker(workerId)`** — calls stored abort handle (SIGTERM → 5s grace → SIGKILL), marks worker cancelled in WorkerRegistry + `agent_activity` table
- **`killAllWorkers()`** — iterates all running workers and kills each
- **`stop` / `stop all` / `stop <id>` commands** — intercepted by Router before Master AI routing; partial worker ID matching supported (e.g., `stop w8f3` matches `worker-…-w8f3`)
- **`stop all` confirmation flow** — replies "This will terminate N running workers. Reply 'confirm' within 30 seconds to proceed."; pending confirmation stored in `Map<sender, { action, expiresAt }>` with 30s TTL; single-worker stops execute immediately without confirmation
- **Cross-channel broadcast on kill** — `worker-cancelled` progress event broadcast to all connectors when any worker is stopped
- **Master AI notified on kill** — cancellation injected into Master session: "Worker <id> was CANCELLED by user <sender>. Do NOT retry this task unless the user asks."
- **`pid` column added to `agent_activity`** — `ALTER TABLE agent_activity ADD COLUMN pid INTEGER` migration

#### Responsive Master — Message Handling During Processing

- **Queue depth + wait time acknowledgment** — queued messages receive: "You're #N in queue (~Xs). I'll get to your message shortly." based on rolling average of recent processing times
- **Message priority classification** — messages classified as `quick-answer` (priority 1), `tool-use` (priority 2), or `complex-task` (priority 3) before queuing; quick-answer messages jump ahead
- **Fast-path responder** — when Master is in `processing` state and a `quick-answer` message arrives, a lightweight `claude --print` call (read-only profile, maxTurns=3, cached workspace context) returns a response immediately without waiting for Master
- **`FastPathResponder` class** — manages a pool of up to 2 concurrent fast-path agent sessions; configurable `maxConcurrent`
- **`status` command enhanced** — shows current task being processed, queue depth per user, estimated completion time, active worker count, and exploration progress table

#### Intelligent Retrieval & Worker Briefing

- **Hybrid FTS5 search** — sub-millisecond full-text search over context chunks; for ambiguous queries (>10 results) an optional haiku reranking call filters down to the top 5
- **Worker briefing** — every worker spawned by Master receives a context package: relevant project chunks, past similar tasks + outcomes, and project-specific guidelines (detected framework, test runner, etc.)
- **Adaptive model selection** — learnings table queried before each spawn; if a model has >50% failure rate for a task type, a different model is preferred

#### Conversation Memory & Prompt Evolution

- **Conversation recording** — all user↔Master messages stored in `conversations` table with FTS5 index; past context retrieved and injected for follow-up queries ("do the same for payments")
- **`prompt-evolver.ts`** — underperforming prompts (effectiveness < 0.7) auto-flagged every 50 tasks; Master proposes improved variation; new version runs in parallel until it earns its place

#### Hierarchical Masters (Sub-Masters)

- **`sub-master-detector.ts`** — detects large sub-projects by file count/complexity and flags them for sub-master creation
- **`sub-master-manager.ts`** — spawns and manages independent sub-master DB sessions per sub-project; root Master delegates cross-cutting tasks
- **`sub_masters` registry table** — root DB tracks all active sub-masters with paths, models, and status

### Fixed

- `exploration_progress` table always empty — `explorationId` never passed to `ExplorationCoordinator`; now wired from `agent_activity` row through all 5 exploration phases (OB-F23)
- Workers hitting max-turns silently succeeded — exit code 0 mistaken for complete work; now detected, logged, and retried with larger budget (OB-F24)
- Worker failures not retried — default `retries: 0` meant all errors were final; changed to 2, with error classification driving retry strategy (OB-F25)
- Prompt library methods missing from `DotFolderManager` — 7 methods (`readPromptManifest`, `writePromptManifest`, `writePromptTemplate`, `getPromptTemplate`, `recordPromptUsage`, `getLowPerformingPrompts`, `resetPromptStats`) were referenced but unimplemented; fixed 39 test failures, 20 TypeScript errors, and 264 lint errors (OB-F32, OB-F33, OB-F34)
- `AuditLogger` missing JSONL flat-file output — constructor accepted `logPath` but never used it; `write()` now appends JSONL lines to disk alongside Pino + SQLite sinks; fixed 8 test failures (OB-F27)
- Conversation continuity shallow — every session started nearly fresh; `memory.md` pattern implemented so the Master reads a curated 200-line knowledge file on every session start and updates it on session end (OB-F29)
- No conversation history access for users — `listSessions()` and `searchSessions()` added to `conversation-store.ts`; `/history` command, `/history search`, and `/history <id>` commands added to router; REST endpoints added to WebChat connector (OB-F35)
- No DB schema versioning — migrations ran ad-hoc `ALTER TABLE` sequences with no version tracking; `schema_versions` table added, all migrations numbered and transactional (OB-F28)
- Session checkpointing not wired — `checkpointSession()` and `resumeSession()` on `MasterManager` now integrated with priority queue so urgent messages trigger a safe checkpoint-handle-resume cycle (OB-F31)

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
