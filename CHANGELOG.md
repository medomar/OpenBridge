# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

_No unreleased changes._

## [0.0.8] — 2026-03-02

### Added

#### Voice Transcription with API Fallback (Phase 70)

- **Voice message support** — WhatsApp and Telegram voice messages automatically transcribed
- **API fallback pipeline** — tries local `ffmpeg` first, falls back to OpenAI Whisper API
- **Graceful degradation** — clear error message when neither transcription method is available

### Scaffolded (not yet validated)

- **Enhanced CLI Setup Wizard (Phase 71)** — guided `npx openbridge init` flow (needs testing)
- **Standalone Binary Packaging (Phase 72)** — `pkg`-based build scripts for macOS/Linux/Windows (never run)
- **Electron Desktop App (Phase 73)** — React GUI with setup wizard, dashboard, settings (has build issues)

### Changed

- grammy 1.40 → 1.41 (webhook JSON parse fix)
- eslint 9.39.2 → 9.39.3 (TypeScript compatibility)
- lint-staged 16.2 → 16.3 (switched from nano-spawn to tinyexec)
- @types/node patch update

## [0.0.7] — 2026-02-28

### Fixed

- **Telegram message splitting** — long responses now split at paragraph boundaries instead of mid-sentence; each chunk respects Telegram's 4096-char limit
- **Discord message splitting** — same splitting logic applied; respects Discord's 2000-char limit
- **Live context fixes** — worker progress events now correctly display elapsed time and turn counts across all connectors

## [0.0.6] — 2026-02-27

### Fixed

- **WhatsApp media handling** — voice messages, images, and documents now properly downloaded and forwarded to Master AI with MIME type metadata
- **Telegram media handling** — photos, documents, and voice messages extracted via grammY file API
- **MCP dashboard fixes** — WebChat agent dashboard correctly renders MCP server status when configured

## [0.0.5] — 2026-02-27

### Fixed

- **FTS5 syntax errors** — `searchConversations()` now calls `sanitizeFts5Query()` before MATCH; queries with `'`, `"`, `(`, `)`, `*`, `AND`, `OR`, `NOT` no longer crash (OB-F38)
- **memory.md never updates** — `triggerMemoryUpdate()` now injects last 20 messages from SQLite so the stateless AI has context to write meaningful notes (OB-F39)
- **Memory-update prompt hardcodes tool name** — uses generic language instead of `Use the Write tool` — works with both Claude and Codex (OB-F39)
- **`getRecentMessages()` missing** — added to `conversation-store.ts` and exposed on `MemoryManager` facade (OB-F39)
- **Ungraceful shutdown** — `shutdown()` now prints status, wraps `bridge.stop()` in 10s timeout, exits cleanly (OB-F40)
- **Session state lost on rapid shutdown** — `saveMasterSessionToStore()` (fast, <100ms) runs before `triggerMemoryUpdate()` (slow, 10–30s) (OB-F40)

## [0.0.4] — 2026-02-26

### Added

#### Codex Provider + Adapter Fixes (Phases 57–59)

- **`CodexProvider`** — implements `AIProvider` interface using `AgentRunner` + `CodexAdapter`
- **`CodexConfig` schema** — Zod schema with `workspacePath`, `timeout`, `model?`, `sandbox?`
- **`CodexSessionManager`** — session state for multi-turn Codex conversations
- **`--skip-git-repo-check`** always present in `CodexAdapter` — fixes non-git directory failures
- **Default sandbox `read-only`** — empty `allowedTools` → `--sandbox read-only`
- **`OPENAI_API_KEY` validation** before spawn — clear error instead of confusing timeout
- **`--json` flag** for structured JSONL output parsing
- **`-o` output file** for reliable result capture with temp file cleanup

#### MCP Integration — Model Context Protocol (Phases 60–62, scaffolded)

- **`MCPServerSchema` + `MCPConfigSchema`** in config types
- **Per-worker MCP isolation** — temp JSON configs with only requested servers, `--strict-mcp-config`
- **Global MCP config writer** — validates and writes `.openbridge/mcp-config.json` on startup
- **MCP server health checks** — verifies server commands exist on PATH
- **MCP step in CLI wizard** — optional MCP server configuration during `npx openbridge init`
- **Master MCP awareness** — system prompt includes available MCP servers; Master decides assignment
- **Status: scaffolded, not yet fully validated**

## [0.0.3] — 2026-02-26

### Added

#### Exploration Overhaul (Phase 50)

- **`explore` command** — users can trigger workspace re-exploration from any messaging channel. Syntax: `explore` (quick refresh), `explore full` (5-phase re-exploration), `explore status` (show progress)
- **Large directory splitting (OB-F26)** — directories exceeding 25 files are automatically split into subdirectories before Phase 3 dives
- **Per-directory timeout scaling** — dive timeout scales with file count: `max(180s, min(600s, fileCount * 4s))`

#### Prompt Library (Phase 51)

- **Prompt manifest** — `.openbridge/prompts/manifest.json` with usage tracking, success rates, versioning
- **7 prompt management methods** on `DotFolderManager` — read/write manifests, templates, usage recording, low-performer detection

#### Conversation Continuity — memory.md (Phase 52)

- **`memory.md` pattern** — Master reads a curated 200-line knowledge file on every session start, updates on session end
- **Cross-session context** — FTS5 search fallback when memory doesn't cover the current topic

#### /history Command (Phase 53)

- **`/history`** — lists last 10 sessions with title, date, message count
- **`/history search <query>`** — FTS5 search across past conversations
- **`/history <session-id>`** — full transcript for a session
- **REST endpoints** — `/api/sessions` and `/api/sessions/:id` for WebChat

#### Schema Versioning (Phase 54)

- **`schema_versions` table** — numbered migrations with transaction safety and idempotency

#### Worker Streaming & Checkpointing (Phase 55)

- **Worker progress streaming** — `execOnceStreaming()` streams stdout chunks from active workers
- **Session checkpointing** — `checkpointSession()` / `resumeSession()` for crash recovery
- **Priority queue integration** — urgent messages trigger checkpoint-handle-resume cycle

### Fixed

- `exploration_progress` always empty — `explorationId` now wired through all 5 phases (OB-F23)
- Workers hitting max-turns silently succeeded — now detected, logged, and retried (OB-F24)
- Worker failures not retried — default retries changed 0 → 2, with error classification (OB-F25)
- Prompt library methods unimplemented — fixed 39 test failures, 20 TS errors, 264 lint errors (OB-F32–F34)
- `AuditLogger` missing JSONL output — `write()` now appends to disk (OB-F27)
- No DB schema versioning — `schema_versions` table added (OB-F28)
- Session checkpointing not wired (OB-F31)

## [0.0.2] — 2026-02-25

### Added

#### Memory System — SQLite + FTS5

- **`src/memory/` module** — full SQLite + FTS5 layer with WAL mode
- **Workspace chunks** — ~500 token chunks with FTS5 full-text search
- **Conversation store** — message recording with FTS5 and 30/90-day eviction
- **Task store** — execution records + model performance learnings
- **Worker briefing** — context packages for each worker before spawn
- **Activity store** — real-time agent dashboard data (PID, status, turns)
- **Access control store** — role-based access (owner/admin/developer/viewer)

#### Worker Resilience (Phases 45–47)

- **Max-turns exhaustion detection** — stdout scan + `turnsExhausted` flag
- **Adaptive turn budget** — `baselineTurns + ⌈promptLength / 1000⌉` capped at 50
- **Auto-retry** on turns exhaustion with 1.5x budget
- **Error classification** — `rate-limit | auth | timeout | crash | context-overflow | unknown`
- **Master-driven re-delegation** — persistent failures reported back to Master

#### Worker Control (Phase 48)

- **`stop` / `stop all` / `stop <id>`** commands with confirmation flow
- **Real PID capture** via `spawnWithHandle()`
- **Cross-channel broadcast** on worker cancellation

#### Responsive Master (Phases 49–50)

- **Queue depth acknowledgment** — "You're #N in queue (~Xs)"
- **Message priority classification** — quick-answer/tool-use/complex-task
- **Fast-path responder** — lightweight `claude --print` for quick answers during Master processing
- **Enhanced `status` command** — current task, queue depth, worker count, exploration progress

#### Content Publishing & Sharing

- **`[SHARE:channel]` markers** — Master triggers file delivery via WhatsApp/WebChat/email
- **File server** — local HTTP server for generated content
- **Email sender** — SMTP integration for `[SHARE:email]` markers
- **GitHub publisher** — push to `gh-pages` for `[SHARE:github-pages]` markers

#### Access Control

- **Role-based access** — per-user roles enforced in auth layer
- **`npx openbridge access`** — CLI for managing user access
- **`stop` command restricted** to owner/admin roles

## [0.0.1] — 2026-02-23

### Added

#### Core Bridge

- **AI Tool Discovery** — auto-detects AI CLI tools (Claude Code, Codex, Aider, Cursor, Cody) and VS Code extensions
- **Master AI Manager** — autonomous agent lifecycle (idle → exploring → ready)
- **Incremental 5-pass exploration** — structure scan, classification, directory dives, assembly, finalization
- **`.openbridge/` folder** — the AI's brain inside the target project
- **Session continuity** — multi-turn Master conversations via `--session-id`/`--resume`
- **Multi-AI delegation** — Master assigns subtasks via SPAWN markers
- **V2 config format** — simplified to 3 fields; V0 auto-detected for backward compatibility
- **Config watcher** — hot-reload without restart

#### Connectors (5 total)

- **Console** — reference implementation for rapid testing
- **WebChat** — browser UI on `localhost:3000` with Markdown rendering
- **WhatsApp** — via whatsapp-web.js with session persistence and auto-reconnect
- **Telegram** — via grammY; DM and group @mention support
- **Discord** — via discord.js v14; DM and guild channel support

#### Agent Runner

- **`AgentRunner` class** — unified CLI executor with `--allowedTools`, `--max-turns`, `--model`, retries, disk logging
- **Streaming support** — `stream()` yields stdout chunks in real time
- **Model fallback chain** — opus → sonnet → haiku on rate-limit

#### Tool Profiles

- **Built-in profiles** — `read-only`, `code-edit`, `full-access`, `master`
- **Custom profile registry** — stored in `.openbridge/`
- **Model selector** — recommends model based on profile and task keywords

#### Self-Governing Master AI

- **Master system prompt** — generated from workspace context, self-editable
- **Task decomposition** — `[SPAWN:profile]{JSON}[/SPAWN]` markers trigger workers
- **Worker result injection** — structured formatting fed back to Master session

#### Worker Orchestration

- **Worker registry** — tracks all workers with configurable concurrency (default 5)
- **Parallel spawning** — up to concurrency limit
- **Depth limiting** — workers cannot spawn other workers

#### Production Readiness

- **npm packaging** — `files` field, `exports` map
- **Global error handlers** — `unhandledRejection`, `uncaughtException`, `SIGHUP`
- **Release workflow** — lint → typecheck → test → build → npm publish → GitHub Release
- **Dependabot** — weekly npm dependency updates
- **1,218 tests passing** across 60 test files

### Changed

- Documentation rewrite for autonomous AI vision
- Router with Master AI routing path
- CLI executor generalized from Claude-only to any AI tool

### Removed

- Old knowledge layer (archived to `src/_archived/`)
- `--dangerously-skip-permissions` dead code

### Fixed

- `tsx watch` killing process on file changes
- Master session ID using invalid UUID format
- `maxTurns: 3` blocking all non-Q&A tasks
- `pino` `MaxListenersExceededWarning`

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
