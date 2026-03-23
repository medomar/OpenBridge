# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

_No pending changes._

## [0.1.0] — 2026-03-23

### Added

#### Document Intelligence Layer (Phase 116)

- **8 document processors** — PDF, Excel, Word, CSV, image (OCR), email (.eml), JSON, XML
- **MIME-based routing** — auto-detects file type and dispatches to correct processor
- **Entity extraction** — dates, amounts, names, addresses from business documents
- **FTS5 storage** — processed document content indexed for search

#### DocType Engine (Phases 117–118)

- **Metadata-driven schema system** — define business entities (Invoice, Contact, Product) as JSON schemas
- **Dynamic SQLite tables** — DDL generation from DocType definitions, child tables, computed columns
- **Lifecycle hooks** — auto-numbering, state machines, PDF generation, notifications, payment links
- **REST API** — CRUD endpoints for all DocTypes

#### Integration Hub (Phases 119–120)

- **Credential Store** — AES-256-GCM encrypted credential storage with OAuth flow support
- **Provider registry** — pluggable adapter framework for external services
- **4 built-in adapters** — Stripe, Google Drive, PostgreSQL, OpenAPI auto-adapter
- **Webhook router** — inbound webhook processing with signature verification

#### Workflow Engine (Phase 121)

- **Multi-step pipelines** — sequential and parallel step execution with branching
- **Schedule triggers** — cron-based workflow execution
- **Human approval gates** — pause workflow for user confirmation
- **Condition evaluation** — dynamic branching based on data state

#### Business Document Generation (Phase 122)

- **pdfmake integration** — programmatic PDF generation with templates
- **Invoice/quote/receipt templates** — pre-built business document layouts with QR codes
- **Multi-page layouts** — headers, footers, watermarks, page numbering

#### Universal API Adapter (Phase 123)

- **Swagger/Postman/cURL parsing** — auto-import API endpoints from spec files
- **Auto skill-pack generation** — discovered APIs become worker skill packs

#### Industry Templates (Phase 124)

- **4 starter templates** — café/restaurant, retail, freelance, real estate
- **Pre-built DocTypes** — per-industry entity schemas and workflows

#### Skill Packs & Agent SDK (Phases 126–127)

- **4 new skill packs** — cloud storage (AWS/GCP/Azure), web deploy (Docker/K8s), spreadsheet handler, file converter
- **Agent SDK permission relay** — `canUseTool` bridge between SDK and trust levels
- **Worker permissions** — role-based access control for worker tool usage

#### Model Budgets & Trust System (Phases 133–151)

- **Claude model-aware budgets** — Opus/Sonnet 128K prompt + 800K system; Haiku 32K + 180K
- **WebChat session isolation** — per-sender history filtering, conversation retrieval isolation
- **Worker file operations** — rm/mv/cp/mkdir added to code-edit profile with auto-escalation
- **Trust level system** — trust-level-aware cost caps, workspace boundary enforcement

#### Real-World Stability (Phases 152–169)

- **Channel + role context injection** — sender role and channel type injected into worker prompts
- **Remote file/app delivery** — file-server routing, GitHub Pages publishing, email delivery
- **Message queueing during processing** — incoming messages queued while Master is processing

### Fixed

- Workspace map not persisted — missing writes on exploration complete (OB-F193, OB-F194)
- 84% prompt truncation — budget-aware assembly with graduated warnings (OB-F192, OB-F197)
- Stale `running` status for Codex workers — startup sweep + safety-net finally blocks (OB-F196)
- Per-worker cost runaway — cost caps: read-only $0.05, code-edit $0.10, full-access $0.15 with SIGTERM (OB-F195)
- Classification false positives — reduced keyword-only matches, improved conversational patterns (OB-F198)
- Prompt size cap too low — raised to 55K with silent rejection prevention (OB-F200)
- Startup log noise — fs.access guards, warnings downgraded to debug (OB-F199, OB-F201)
- WebChat cross-session data leakage (OB-F202)
- Codex/Aider model registry — 400K budget for Codex, model-specific tiers (OB-F204)
- Worker prompt budgets and timeout alignment across all profiles (OB-F205–OB-F216)
- Escalation loop OOM — strip existing `-escalated` suffix, max depth guards (OB-F214)
- Docker health log noise — state-transition-only logging (OB-F215)
- System prompt budget cap — raised from 8K to 120K (OB-F216)
- Quick-answer timeout — reduced turns 5→3, aligned with processing deadline (OB-F217)
- Streaming timeout retry — classify timeout exits, skip futile retries (OB-F218)
- Codex cost estimation inaccuracy for streaming workers (OB-F219)
- DLQ silent failure — `onDeadLetter` sends error response to user (OB-F225)
- Classifier maxTurns=1 JSON truncation — increased to 2 (OB-F227)
- Concurrent exploration corruption — atomic writes + state recovery (OB-F224, OB-F228)
- Worker `.openbridge/` access — boundary instruction enforcement (OB-F223)
- Headless worker spawn without active session (OB-F226)
- Message queueing race conditions during processing (OB-F229)
- Classification escalation + max-turns UX — adaptive turn allocation (OB-F230)

## [0.0.15] — 2026-03-09

### Added

#### Prompt Budget & Assembly (Phase 105)

- **PromptAssembler** — priority-ranked section assembly with per-section `maxChars` caps and provider-aware total budget
- **`getPromptBudget()`** on CLIAdapter — each adapter declares model-aware prompt/systemPrompt limits
- **Budget-aware Master prompts** — `buildMasterSpawnOptions()` uses PromptAssembler instead of raw concatenation
- **Adapter-specific limits** — ClaudeAdapter (180K system), CodexAdapter (merged budget), AiderAdapter (conservative)

#### Classification Fixes (Phase 107)

- **Attachment-aware classification** — messages with file attachments auto-escalate from `quick-answer` to `tool-use`
- **File-reference keywords** — "xl", "pdf", "csv", "spreadsheet", "attachment" trigger `tool-use` classification

#### Worker & Exploration Cleanup (Phase 108)

- **Pending-worker watchdog** — workers stuck in `pending` for >5 min auto-cancelled
- **Stale exploration cleanup** — old `exploration_progress` rows deleted on new exploration start
- **Post-exploration memory.md** — `memory.md` seeded immediately after exploration completes

#### Monorepo Awareness (Phase 109)

- **`detectMonorepoPattern()`** — scans for multiple `package.json`/`.git`/`pom.xml`/`go.mod` at depth 1-2
- **Per-sub-project exploration** — each sub-project gets independent classification and directory dive
- **Monorepo workspace map** — Phase 4 assembly produces `{ type: "monorepo", subProjects: [...] }` structure

#### God-Class Refactoring (Phase 110)

- **8 new focused modules** extracted from 3 god-class files (16,291 LOC → manageable modules):
  - `classification-engine.ts` (942 LOC) — from master-manager.ts
  - `exploration-manager.ts` (1539 LOC) — from master-manager.ts
  - `worker-orchestrator.ts` (2065 LOC) — from master-manager.ts
  - `prompt-context-builder.ts` (560 LOC) — from master-manager.ts
  - `command-handlers.ts` (2936 LOC) — from router.ts
  - `output-marker-processor.ts` — from router.ts
  - `error-classifier.ts` — from agent-runner.ts
  - `cost-manager.ts` — from agent-runner.ts

#### Memory Leak Fixes (Phase 113)

- **Queue recursion → while loop** — prevents stack overflow with large queues
- **Rate limiter cleanup** — periodic 5-min sweep removes stale sender entries
- **Classification cache eviction** — LRU eviction at 10,000 entries (oldest 20% removed)
- **Connector session cleanup** — WebChat, Discord, WhatsApp Maps/Sets with TTL-based purge

### Fixed

- Process kill race condition — `killed` flag prevents double SIGKILL (OB-F162)
- Session checkpoint/resume race — `finally` block ensures `resumeSession()` always called (OB-F163)
- Memory init null pointer — eviction interval guarded by `if (this.memory)` (OB-F164)
- Config watcher unhandled rejection — `.catch()` on fire-and-forget reload (OB-F167)
- Spawn confirmation timer leak — clear existing timer before overwriting (OB-F168)
- Batch timers not cleaned on shutdown — iterate and clear all handles (OB-F170)
- Worker abort handle leak — `try/finally` ensures cleanup on pre-spawn failure (OB-F171)
- Pending messages dropped on drain failure — try-catch per message with user notification (OB-F172)
- Cancellation notifications re-injected — clear array after injection (OB-F173)
- DotFolderManager silent I/O errors — `logger.warn()` in all catch blocks (OB-F174)
- JSON.parse crashes on corrupt data — try-catch in observation-store, access-store, memory index (OB-F175)
- Connector Maps/Sets unbounded growth — periodic cleanup intervals with TTL (OB-F176)
- WhatsApp reconnect timer not cleared on shutdown (OB-F177)
- Self-improvement prompt growth unbounded — 45K char cap on `createPromptVersion()` (OB-F149)
- Workspace map duplicated in exploration prompts — `skipWorkspaceContext` flag (OB-F150)
- Prompt version seed duplicates — existence check + dedup migration (OB-F151)
- Quick-answer timeout too tight — 60s CLI startup budget floor (OB-F144)
- Idle self-improvement runs every 5 min — exponential backoff up to 2h (OB-F145)
- Phase 4 Assembly fails on large workspaces — budget-capped data + markdown fallback (OB-F146)
- Exit code 143 (SIGTERM) now classified as transient (retryable) instead of permanent
- 29 test regressions across 12 files restored to green (Phase 115)

## [0.0.14] — 2026-03-07

### Added

#### Skill Pack System Extensions (Phase 98)

- **SkillPack type + SKILLPACK.md format** — reusable domain-specific instruction sets for workers
- **5 built-in skill packs** — `security-audit`, `code-review`, `test-writer`, `data-analysis`, `documentation`
- **Master auto-selects skill packs** — task type determines which pack injects into worker system prompt
- **User-defined skill packs** — `.openbridge/skill-packs/` overrides built-in defaults
- **`/skill-packs` chat + CLI command** — list available packs with descriptions

#### Design & Creative Output (Phase 100)

- **6 creative skill packs** — `diagram-maker`, `chart-generator`, `web-designer`, `slide-designer`, `generative-art`, `brand-assets`
- **HTML-to-image pipeline** — Puppeteer rendering for sending visual outputs via messaging
- **SVG + Mermaid rendering** — diagram-to-image conversion via mermaid-cli
- **Creative task auto-detection** — intent classification extended with design/visual/chart intents
- **Image delivery** — rendered PNG/SVG sent as media via WhatsApp/Telegram

#### Agent Orchestration Patterns (Phase 101)

- **PlanningGate** — Master enters read-only analysis phase before code-edit execution phase
- **WorkerSwarm** — named worker groups (research, implement, review, test) with handoff protocol
- **Test protection** — workers cannot modify test files unless explicitly authorized by Master
- **Iteration cap** — max 3 lint/test fix attempts before escalating to Master (configurable)
- **Parallel spawning within swarms** — independent workers in same swarm run concurrently

## [0.0.13] — 2026-03-07

### Added

#### Structured Observations & Worker Summaries (Phase 93)

- **Observations table + FTS5** — typed facts, concepts, files_read, files_modified from every worker
- **Observation extractor** — auto-parses worker output into structured observations
- **WorkerSummary schema** — `request/investigated/completed/learned/next_steps` per worker
- **Content-hash deduplication** — SHA-256 dedup for workspace chunks with 30s write window
- **Master context injection** — `next_steps` from recent workers fed into system prompt

#### Session Compaction & Token Economics (Phase 95)

- **SessionCompactor** — auto-summarizes when Master session exceeds 80% of max-turns
- **Identifier preservation** — file paths, function names, finding IDs survive compaction
- **Token economics tracking** — discovery vs retrieval token costs, ROI calculation
- **`/stats` chat + CLI command** — exploration ROI visibility

#### Channel Role Management UX Fix (Phase 96d)

- **`auth.defaultRole` config** — whitelisted users default to `owner` (was `viewer`)
- **`auth.channelRoles`** — per-channel role overrides
- **`/whoami` + `/role` commands** — in-chat role visibility and management
- **Softened classification** — `chat` action default for conversational messages, allowed for all roles
- **Improved denial messages** — show role, classified action, and allowed actions

#### Document Generation Skills (Phase 99)

- **4 document skill packs** — `document-writer` (DOCX), `presentation-maker` (PPTX), `spreadsheet-builder` (XLSX), `report-generator` (PDF/HTML)
- **Skill pack loader** — discovers built-in + `.openbridge/skill-packs/` custom packs
- **Document task auto-detection** — intent classification extended with document/report/presentation intents
- **File attachment delivery** — generated documents sent via WhatsApp/Telegram/WebChat

#### Vector Search & Hybrid Retrieval (Phase 94)

- **sqlite-vec integration** — vector similarity search with cosine distance
- **Hybrid scoring** — 0.4 vector + 0.4 FTS5 + 0.2 temporal decay
- **MMR diversity** — prevents result clustering from same file
- **Progressive disclosure** — `searchIndex()` returns compact results, `getDetails()` loads full content
- **Graceful fallback** — FTS5-only when no embedding provider configured

#### Developer Experience (Phases 96a–96c)

- **`openbridge doctor`** — self-diagnostic command checking Node.js, AI tools, config, DB, channels
- **Pairing-based auth** — 6-digit codes for self-service user onboarding via DM
- **Skills directory** — `SkillManager` discovers SKILL.md files, Master auto-creates skills from patterns
- **`/doctor`, `/approve`, `/skills` chat commands**

### Fixed

- 7 data integrity findings (OB-F89–F95) — audit log, QA cache, sessions, turns, prompts, sub-masters, memory.md

## [0.0.12] — 2026-03-05

### Added

#### Deep Mode — 5-Phase Analysis (Phase Deep)

- **DeepModeManager** — investigate → report → plan → execute → verify state machine
- **Per-phase model selection** — each phase picks the best model for its task type
- **Interactive commands** — `/deep`, phase navigation, task model overrides via chat
- **Plan task parsing** — dependency-ordered batching with BFS topological sort
- **Session persistence** — completed sessions saved to `.openbridge/deep-mode/`

#### Output Delivery Pipeline (Phases 82–84)

- **Tunnel integration** — auto-detects cloudflared/ngrok, generates public URLs
- **Ephemeral app server** — scaffold detection, port allocation, idle timeout
- **Interaction relay** — WebSocket bidirectional app↔Master communication

#### WebChat Modernization (Phases 88–92)

- **Extracted frontend** — modular JS/CSS, dark mode, markdown, syntax highlighting
- **Authentication** — token/password auth, sessions, rate limiting
- **Mobile PWA** — LAN/tunnel access, QR codes, responsive, service worker
- **Conversation history** — sidebar, file upload, voice input, autocomplete
- **Settings panel** — gear panel, stepper, phase cards

#### Runtime Features (Phases 97–104)

- **Permission escalation** — `/allow`, `/deny`, persistent tool grants
- **Batch task continuation** — self-messaging loop with safety rails (iteration + cost + time limits)
- **Docker sandbox** — container isolation, resource limits, cleanup
- **Worker watchdog** — orphan detection, state audit, `/workers` command
- **Cost controls** — per-profile cost caps, partial status, adaptive maxTurns

### Fixed

- Codex streaming output parsing (RWT phase)
- RAG zero-result fallback (RWT phase)
- Classifier strategic keywords and menu-selection handling (Phase 100)
- Batch timer cleanup and .catch handlers (Phase 101)
- Whitelist diagnostics on startup (Phase 103)
- 14 stale test mocks updated (Phase 104)

## [0.0.11] — 2026-03-03

### Added

- **Master output sharing** — `[SHARE:*]` markers, file-server URL delivery, routing guidelines (Phase 81)
- **User consent** — risk classification, confirmation prompts for high-risk operations, cost estimation (Phase 86)

## [0.0.10] — 2026-03-02

### Added

- **RAG knowledge retrieval** — FTS5 queries, workspace map context, dir-dive results, Q&A cache infrastructure (Phases 74–77)
- **Environment variable protection** — deny-list, allow-list, per-adapter sanitization strips CLAUDECODE/CLAUDE*CODE*_/CLAUDE*AGENT_SDK*_ vars (Phase 85)

## [0.0.9] — 2026-03-02

### Fixed

- **Classification fixes** — strategic keywords, SPAWN response parsing, text-generation keyword classifier (Phase 78a)
- **Code-audit profile** — new read-only + analysis tool profile for security audits (Phase 78b)
- **Exploration bugs** — 8 bugs fixed: JSON fallbacks, chunk dedup, stale detection (Phase 79)
- **.openbridge data cleanup** — orphaned entries, corrupted state files (Phase 80)

## [0.0.8] — 2026-03-02

### Added

#### Voice Transcription with API Fallback (Phase 70)

- **Voice message support** — WhatsApp and Telegram voice messages automatically transcribed
- **API fallback pipeline** — tries local `ffmpeg` first, falls back to OpenAI Whisper API
- **Graceful degradation** — clear error message when neither transcription method is available

### Scaffolded (not yet validated)

- **Enhanced CLI Setup Wizard (Phase 71)** — guided `npx openbridge init` flow (needs testing)

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

#### Content Publishing & Sharing (scaffolded)

- **`[SHARE:channel]` markers** — parsing logic for file delivery via WhatsApp/WebChat/email (scaffolded — Master doesn't use these yet, see OB-F68)
- **File server** — local HTTP server for generated content (scaffolded)
- **Email sender** — SMTP integration (scaffolded)
- **GitHub publisher** — push to `gh-pages` (scaffolded)

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

## [0.0.0] — 2026-02-19

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
