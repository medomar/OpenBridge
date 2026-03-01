# OpenBridge — Future Work

> **Purpose:** Planned features, deferred findings, finalization items, and backlog for future versions.
> **Last Updated:** 2026-03-01 | **Current Release:** v0.0.8 (Phases 1–73, 652 tasks shipped)

---

## Finalization Required (Phases 72–73 + MCP UI)

These features were scaffolded/built but have bugs and build issues that prevent them from actually working. They need debugging and finalization before they can be considered truly shipped.

### Standalone Binary Packaging (Phase 72) — Needs Testing & CI Fix

**Current state:** Scripts and config fully scaffolded. Never actually built or tested.

**What exists:**

- `@yao-pkg/pkg` in devDependencies
- `pkg` config block in `package.json` (targets: node22-macos-arm64/x64, win-x64, linux-x64)
- `scripts/package.sh` (184 lines) — cross-platform build script
- `scripts/create-dmg.sh` (316 lines) — macOS DMG creator with icon generation
- `scripts/macos-app-template/` — .app bundle template (placeholder icons/binaries)
- `.github/workflows/release-binaries.yml` — 3-OS CI workflow for binary builds

**Known issues:**

1. `release/` directory is empty — no binaries have ever been built
2. `.nvmrc` file missing — all CI workflows reference it and will fail
3. `better-sqlite3` native addon bundling untested — may need prebuilt binaries per platform
4. DMG script assumes `create-dmg` or `hdiutil` — needs testing on clean macOS
5. Windows NSIS installer not implemented (just raw `.exe`)

**Finalization tasks (~8–12 tasks):**

- Add `.nvmrc` with `22`
- Run `npm run package` locally and fix any pkg errors
- Test binary startup on macOS (does it find `better-sqlite3`? does `whatsapp-web.js` work?)
- Test DMG creation flow
- Fix CI workflow issues
- Add Windows installer (NSIS or Inno Setup) if needed
- Smoke test on each platform

---

### Electron Desktop App (Phase 73) — Build Broken, Wiring Gaps

**Current state:** Substantially built (main process, preload, React UI, settings, dashboard). Cannot run due to build configuration issues.

**What exists:**

- `desktop/electron/main.ts` (518 lines) — full Electron main process with IPC handlers
- `desktop/electron/preload.ts` — contextBridge with all IPC methods
- `desktop/electron/bridge-process.ts` — bridge lifecycle manager (fork/stop)
- `desktop/electron/tray.ts` — system tray with programmatic icons
- `desktop/ui/App.tsx` — React router with pages
- `desktop/ui/pages/Dashboard.tsx` — full live dashboard
- `desktop/ui/pages/Settings.tsx` — 6-tab settings panel
- `desktop/ui/pages/Setup.tsx` + `pages/setup/*.tsx` — 7-step setup wizard (complete)
- `desktop/ui/pages/settings/McpSettings.tsx` (827 lines) — full MCP management UI
- `desktop/ui/pages/settings/AccessSettings.tsx` — access control UI
- `electron-builder.yml` — build config for native installers
- `.github/workflows/release-desktop.yml` — 3-OS CI workflow

**Known issues (build-breaking):**

1. **No Electron TS compile step** — `dev` and `build` scripts don't run `tsc` on `electron/*.ts`. The entry point `electron/main.js` will not exist. The app cannot start.
2. **Setup wizard not wired** — `App.tsx` has a stub `<div>Setup Wizard</div>` on `/setup` instead of importing the real `Setup.tsx` component
3. **Vite output path mismatch** — `vite.config.ts` outputs to `dist/ui/` but `electron-builder.yml` expects `ui/dist/`
4. `.nvmrc` missing (same as binary packaging CI issue)

**Finalization tasks (~10–15 tasks):**

- Add `tsc -p tsconfig.electron.json` step to compile `electron/*.ts` → `electron/*.js`
- Fix `dev` script: compile Electron TS, then run concurrently
- Fix `build` script: compile Electron TS before `electron-builder`
- Wire `Setup.tsx` import in `App.tsx` (replace stub)
- Fix Vite output path to match `electron-builder.yml` expectation
- Add `.nvmrc`
- Test `npm run dev` — does the window open? Does the setup wizard work?
- Test bridge start/stop from dashboard
- Test `electron-builder` — does it produce a working `.dmg`/`.exe`?
- Fix any runtime errors in IPC handlers
- Test auto-updater flow

---

### MCP Management UI — Removed from WebChat, Electron Layer Blocked

**Current state:** WebChat MCP UI has been **removed** to avoid confusing users with non-functional features. Backend is intact. Electron UI is coded but blocked by Electron build issues above.

**What's preserved (backend — still functional):**

- `src/core/mcp-registry.ts` — backend MCP server registry (add/remove/toggle/health/persist)
- `src/core/mcp-catalog.ts` — catalog of 12 known MCP servers with docs + env vars
- Master AI MCP-aware worker spawning (per-worker `--mcp-config` isolation)

**What was removed (WebChat UI):**

- WebChat REST API routes at `/api/mcp/*` (6 endpoints)
- WebChat browser dashboard panel (server cards, catalog modal, search, env var forms)
- WebSocket `mcp-status` broadcast + polling
- `setMcpRegistry()` connector wiring in `bridge.ts`
- Test files: `webchat-mcp-api.test.ts`, `webchat-mcp-websocket.test.ts`

**What's blocked (Electron):**

- `desktop/ui/pages/settings/McpSettings.tsx` (827 lines) — complete React component but cannot run until Electron build issues are fixed
- `desktop/electron/main.ts` IPC handlers for `mcp:*` — proxy to bridge REST API, functional code but untested

**Finalization tasks (~8–12 tasks, after Electron is fixed):**

- Re-implement WebChat MCP REST API routes (or restore from git history)
- Re-implement WebChat MCP browser dashboard
- Verify MCP settings tab renders correctly in Electron
- Test add/remove/toggle server flow end-to-end
- Test catalog browse + connect flow
- Verify WebSocket status updates propagate to Electron UI

---

## Deferred Findings

### OB-F52 — Complex tasks use same 180s timeout as quick answers

**Severity:** Critical | **Status:** Open (deferred)

**Problem:** All message types (quick-answer, tool-use, complex-task) use `DEFAULT_MESSAGE_TIMEOUT = 180_000` (3 minutes). Complex tasks get 25 turns but only 180s — 7.2s per turn, too tight for planning tasks that involve git operations, multi-file refactors, or branch management.

**Root cause:** `buildMasterSpawnOptions()` defaults timeout to `this.messageTimeout` (180s) for all task classes.

**Solution needed:** Per-class timeout map or proportional timeout scaling (e.g., quick-answer: 60s, tool-use: 180s, complex-task: 600s).

**Component:** `src/master/master-manager.ts`

---

### OB-F53 — Classification escalation over-triggers

**Severity:** Medium | **Status:** Open (deferred)

**Problem:** The escalation logic checks **global aggregate** success rate. If `tool-use` has 90% success across ALL tasks, it escalates **every** `quick-answer` to `tool-use` (5→15 turns), wasting budget on trivial questions.

**Root cause:** `getLearnedParams('classification')` returns a single best-performing class. The escalation check (`success_rate > 0.5 && learnedRank > currentRank`) is too aggressive.

**Solution needed:** Disable quick-answer→tool-use escalation, or add per-category success tracking instead of global aggregation.

**Component:** `src/master/master-manager.ts` (lines 2706–2751)

---

### OB-F48 — Knowledge-First Retrieval (RAG) — Phases 74–77

**Original Finding:** Master AI answers codebase questions from stale context (workspace map + memory.md + last 20 messages). Never queries the chunk store, exploration JSONs, or workspace map key files. Expensive exploration data goes unused after startup.

**Planned Solution:** Query existing knowledge base first (FTS5 chunks, workspace map, dir-dive JSONs), spawn targeted read workers only for gaps.

| Phase | What                                                                                                                 | Estimated Tasks |
| ----- | -------------------------------------------------------------------------------------------------------------------- | --------------- |
| 74    | Knowledge Retriever — new `knowledge-retriever.ts`, FTS5 + workspace map + dir-dive queries, confidence scoring      | ~10             |
| 75    | Context Injection — wire retriever into `processMessage()`, `codebase-question` task class, format knowledge context | ~8              |
| 76    | Targeted Reader — spawn focused read workers for low-confidence gaps, enrich chunks from reads                       | ~6              |
| 77    | Chunk Enrichment — store worker read results as chunks, Q&A pair caching, entity extraction                          | ~8              |

**Key files to modify:**

- `src/core/knowledge-retriever.ts` (new) — RAG query orchestrator
- `src/master/master-manager.ts` — wire retriever into `processMessage()`
- `src/master/master-system-prompt.ts` — `codebase-question` classifier
- `src/memory/retrieval.ts` — new query helpers for key file matching
- `src/master/dotfolder-manager.ts` — dir-dive JSON loading API
- `src/memory/chunk-store.ts` — chunk enrichment from worker reads + Q&A pairs

**Full design spec:** [V18 findings archive](archive/v18/FINDINGS-v18.md)

---

## Planned Features

### MCP Management UI

**Status:** WebChat UI removed (backend preserved). Electron UI coded but blocked by build issues. See "Finalization Required" section above for full details and restoration plan.

---

### Access Control Dashboard

**What:** Web-based UI for managing per-user access control — roles, scopes, action permissions, daily cost budgets.

**Context:** Access control infrastructure already exists (`src/memory/access-store.ts`, `src/cli/access.ts`). This adds the visual layer.

**Estimated effort:** ~10–15 tasks.

---

## Backlog (Unscoped Ideas)

These are captured for future consideration. Not yet designed or estimated.

| Feature                  | ID     | Description                                                        | Notes                    |
| ------------------------ | ------ | ------------------------------------------------------------------ | ------------------------ |
| Docker sandbox           | OB-193 | Run workers in containers for untrusted workspaces                 | Security isolation       |
| Interactive AI views     | OB-124 | AI generates live reports/dashboards on local HTTP                 | Needs content publishing |
| E2E test: business files | OB-306 | CSV workspace E2E test                                             | Testing gap              |
| Scheduled tasks          | —      | Cron-like task scheduling ("run tests every morning at 9am")       | New capability           |
| AI tool marketplace      | —      | Browse and install community-built connectors and providers        | Plugin ecosystem         |
| Webhook connector        | —      | HTTP webhook endpoint for CI/CD integration (GitHub Actions, etc.) | New connector type       |
| PDF generation           | —      | Built-in HTML-to-PDF conversion for generated reports              | Uses Puppeteer           |
| Secrets management       | —      | Encrypted storage for Discord/Telegram tokens                      | Security improvement     |
| WhatsApp session persist | —      | Avoid re-scan when session expires                                 | UX improvement           |
| Skill creator            | OB-192 | Master creates reusable skill templates from successful patterns   | Self-improvement         |
| Context compaction       | OB-190 | Progressive summarization when context grows large                 | Memory optimization      |

---

## Legacy Roadmap Phases (Superseded)

The original ROADMAP.md contained planned Phases 31–39 with detailed designs. Most of these features were **already shipped** under different phase numbers during actual development. The remaining unshipped portions are captured above.

| Original Phase | Feature                                 | Status                                                             |
| -------------- | --------------------------------------- | ------------------------------------------------------------------ |
| 31             | Memory Foundation (SQLite)              | Shipped (Phases 31–44 actual)                                      |
| 32             | Intelligent Retrieval + Worker Briefing | Partially shipped; RAG portion deferred (OB-F48)                   |
| 33             | Media & Proactive Messaging             | Shipped (Phases 67–69 actual)                                      |
| 34             | Content Publishing & Sharing            | Shipped (email, file server, GitHub Pages)                         |
| 35             | Conversation Memory + Prompt Evolution  | Shipped (Phases 51–55 actual)                                      |
| 36             | Agent Dashboard + Exploration Progress  | Partially shipped (status commands, WebChat dashboard in Electron) |
| 37             | Access Control + Hierarchical Masters   | Access control shipped; hierarchical masters deferred              |
| 38             | Server Deployment Mode                  | Not started                                                        |
| 39             | Agent Orchestration                     | Not started                                                        |

---

## How to Start a Future Feature

1. Create a new finding in [FINDINGS.md](FINDINGS.md) if the feature addresses a gap
2. Design the implementation and estimate tasks
3. Add a new phase section to [TASKS.md](TASKS.md) with task IDs
4. Update [ROADMAP.md](../ROADMAP.md) to reflect the new phase
5. Implement, test, and mark tasks as Done
6. Archive completed tasks when the phase ships
