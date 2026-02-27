# OpenBridge — Audit Findings (v6 Archive)

> **Archived:** 2026-02-27 — All findings resolved. Archived after Phase 56 documentation audit.
> **Active findings:** [FINDINGS.md](../../FINDINGS.md)

---

## Priority Order

| #   | Finding | Severity | Impact                                            | Why this order                                                                                                            |
| --- | ------- | -------- | ------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| 1   | OB-F32  | ✅ Fixed | 39 test failures + 20 TS errors + 264 lint errors | Implemented 7 prompt library methods on `DotFolderManager`.                                                               |
| 2   | OB-F33  | ✅ Fixed | 20 TypeScript errors                              | Auto-resolved by OB-F32 fix + corrected `PromptRecord`→`PromptTemplate` type in master-manager.                           |
| 3   | OB-F27  | ✅ Fixed | 8 test failures                                   | Restored JSONL flat-file output in `AuditLogger` alongside SQLite sink.                                                   |
| 4   | OB-F34  | ✅ Fixed | 264 lint errors                                   | Auto-resolved by OB-F32 fix.                                                                                              |
| 5   | OB-F29  | ✅ Fixed | Core UX gap                                       | memory.md pattern implemented: read/write, context injection, session-end update, FTS5 fallback, eviction, tests.         |
| 6   | OB-F35  | ✅ Fixed | Missing feature                                   | Full conversation history feature shipped: listSessions, searchSessions, /history command, REST endpoints, tests.         |
| 7   | OB-F28  | ✅ Fixed | Technical debt                                    | schema_versions table added, migrations numbered + transactional, idempotency tests added.                                |
| 8   | OB-F30  | ✅ Fixed | Polish                                            | Worker streaming implemented: execOnceStreaming(), worker-progress events, WebChat progress display.                      |
| 9   | OB-F31  | ✅ Fixed | Polish                                            | Checkpoint/resume wired to priority queue via `onUrgentEnqueued`; urgent messages trigger checkpoint-handle-resume cycle. |

---

## Findings

### #1 — OB-F32 — Prompt library methods missing from DotFolderManager (39 test failures)

**Discovered:** 2026-02-26 (code audit), **Updated:** 2026-02-27 (fixed)
**Component:** `src/master/dotfolder-manager.ts`
**Severity:** ✅ Fixed
**Backlog:** OB-836
**Test failures:** 39 across 3 files (`prompt-library.test.ts`, `prompt-effectiveness.test.ts`, `prompt-degradation.test.ts`)
**Blocks:** OB-F33 (TypeScript errors), OB-F34 (ESLint errors)

**Problem:** Seven prompt library methods are referenced by tests and by `master-manager.ts` (line 4535, 4580) but **do not exist** on `DotFolderManager`: `readPromptManifest()`, `writePromptManifest()`, `writePromptTemplate()`, `getPromptTemplate()`, `recordPromptUsage()`, `getLowPerformingPrompts()`, `resetPromptStats()`. The types (`PromptManifest`, `PromptTemplate`) are fully defined in `src/types/master.ts` with Zod schemas. The manifest file path is `.openbridge/prompts/manifest.json`. `MasterManager.rollbackDegradedPrompts()` calls `this.dotFolder.readPromptManifest()` and `this.dotFolder.writePromptManifest()` — causing 20 TypeScript compilation errors and 264 ESLint errors.

**Recommended fix:** Implement all 7 methods on `DotFolderManager` using the `PromptManifestSchema` and `PromptTemplateSchema` Zod schemas from `src/types/master.ts`. Methods should read/write `.openbridge/prompts/manifest.json` and individual `.md` files in `.openbridge/prompts/`. `recordPromptUsage(id, success)` should increment `usageCount`/`successCount` and recalculate `successRate`. `resetPromptStats(id)` should preserve `previousSuccessRate`. This is the JSON fallback path for when SQLite memory is unavailable — `master-manager.ts` already has the `if (this.memory) { ... } else { this.dotFolder.* }` branching.

---

### #2 — OB-F33 — TypeScript compilation errors in master-manager.ts (20 errors)

**Discovered:** 2026-02-26 (typecheck validation), **Updated:** 2026-02-27 (fixed)
**Component:** `src/master/master-manager.ts` (lines 4538–4585)
**Severity:** ✅ Fixed
**Backlog:** OB-990
**Blocked by:** OB-F32

**Problem:** `rollbackDegradedPrompts()` iterates `Object.values(manifest.prompts)` but TypeScript infers each value as `unknown` because `readPromptManifest()` doesn't exist on `DotFolderManager` (see OB-F32). This cascades into 20 TS18046 errors ("'prompt' is of type 'unknown'") and 1 TS2339 error ("Property 'writePromptManifest' does not exist on type 'DotFolderManager'"). The `typecheck` command fails, meaning CI would also fail.

**Recommended fix:** Implementing OB-F32 (adding the methods to `DotFolderManager`) will resolve all 20 errors. No independent action needed.

---

### #3 — OB-F27 — Audit logger missing JSONL flat-file output (8 test failures)

**Discovered:** 2026-02-26 (health score audit), **Updated:** 2026-02-27 (fixed)
**Component:** `src/core/audit-logger.ts`
**Severity:** ✅ Fixed
**Backlog:** OB-820 | **Health Impact:** +0.05
**Test failures:** 8 in `tests/core/audit-logger.test.ts`

**Problem:** The `AuditLogger` constructor accepts a `logPath` from `AuditConfig` but never stores or uses it. The `write()` method only logs to Pino (console) and SQLite (if memory is attached), but does NOT write JSONL entries to the flat file at `logPath`. Tests expect: JSONL file creation, parent directory creation, multi-entry appending, and ISO timestamp formatting — none of which are implemented. The `AuditConfig` schema defines `logPath: z.string().default('audit.log')` but the constructor ignores it.

**Recommended fix:** Store `logPath` in the constructor as `private readonly logPath: string`. In `write()`, after Pino logging: (1) `await mkdir(dirname(this.logPath), { recursive: true })`, (2) `await appendFile(this.logPath, JSON.stringify(entry) + '\n', 'utf-8')`. Wrap in try-catch to prevent crashes on write errors. Keep Pino and SQLite as secondary sinks.

---

### #4 — OB-F29 — Conversation continuity is shallow (no cross-session memory, no topic merging)

**Discovered:** 2026-02-26 (health score audit), **Updated:** 2026-02-27 (fixed)
**Component:** `src/master/master-manager.ts`, `src/memory/conversation-store.ts`, `src/memory/eviction.ts`
**Severity:** ✅ Fixed
**Backlog:** OB-822 | **Health Impact:** +0.10

**Problem:** The Master AI treats every session as nearly fresh. `buildConversationContext()` retrieves only 5 keyword-matched messages via FTS5 — no full session recall, no cross-session awareness, no topic continuity. Two specific issues:

1. **Weight problem** — As conversations accumulate, injecting raw history into the system prompt will bloat the context window. No compaction, no summarization pipeline is wired (the `evictConversations()` AI summarizer exists in `conversation-store.ts` lines 232–374 but is never called — no scheduled job triggers it).

2. **No topic-aware merging** — When a user revisits a topic discussed in a prior session (e.g., talked about "authentication" last week, now asks about "login flow"), the Master can't merge context from both sessions. Each session's context is isolated. The user has to re-explain everything.

**Fix:** Implemented `memory.md` pattern — `.openbridge/context/memory.md` curated by Master AI on every session start/end. Loaded as primary context in `buildConversationContext()`. FTS5 search retained as fallback.

---

### #5 — OB-F35 — No conversation history access for users (no list, no search, no browse)

**Discovered:** 2026-02-26 (feature gap analysis), **Updated:** 2026-02-27 (fixed)
**Component:** `src/memory/conversation-store.ts`, `src/connectors/webchat/`, `src/core/router.ts`
**Severity:** ✅ Fixed
**Backlog:** OB-992 | **Health Impact:** +0.10
**Related:** OB-F29 (conversation continuity — Master side). This is the **user side**.

**Problem:** No way for users to list, browse, or search past conversations.

**Fix:** Implemented `listSessions()`, `searchSessions()`, `title` column migration, `/history` command family (list, search, transcript), `/api/sessions` REST endpoints, and unit tests.

---

### #6 — OB-F28 — No DB schema versioning (manual ALTER TABLE sequences)

**Discovered:** 2026-02-26 (health score audit), **Updated:** 2026-02-27 (fixed)
**Component:** `src/memory/migration.ts`
**Severity:** ✅ Fixed
**Backlog:** OB-821 | **Health Impact:** +0.05

**Problem:** Schema migrations use ad-hoc `ALTER TABLE` sequences with no version tracking. The migration runner (`migration.ts`) executes all ALTER statements on every startup, relying on SQLite's `ALTER TABLE ADD COLUMN` being idempotent (it errors on duplicate columns, caught silently). No way to know which migrations have been applied, rollback on failure, or skip already-applied migrations.

**Fix:** Added `schema_versions` table, numbered all migrations 1–N, updated runner to query `MAX(version)` and only run newer migrations, wrapped each in a transaction.

---

### #7 — OB-F34 — ESLint reports 264 errors (cascading from OB-F32/F33)

**Discovered:** 2026-02-26 (lint validation), **Updated:** 2026-02-27 (fixed)
**Component:** `src/master/master-manager.ts`, `tests/master/prompt-*.test.ts`
**Severity:** ✅ Fixed
**Backlog:** OB-991
**Blocked by:** OB-F32

**Problem:** ESLint's `@typescript-eslint/no-unsafe-*` rules flag 264 errors, all cascading from the same root cause as OB-F32 and OB-F33. The `unknown` type propagation triggers `no-unsafe-member-access`, `no-unsafe-call`, `no-unsafe-assignment`, and `no-unsafe-argument` rules. These are not independent issues — they will auto-resolve when OB-F32 is fixed.

**Fix:** Auto-resolved by implementing OB-F32 (7 prompt library methods on `DotFolderManager`).

---

### #8 — OB-F30 — No real-time worker streaming progress

**Discovered:** 2026-02-26 (health score audit), **Updated:** 2026-02-27 (fixed)
**Component:** `src/core/agent-runner.ts`, `src/master/master-manager.ts`
**Severity:** ✅ Fixed
**Backlog:** OB-930 | **Health Impact:** +0.05

**Problem:** Active workers appear as "running" in the status command and WebChat dashboard with no granularity. Users can't see how many turns a worker has consumed, what it's currently doing, or how close it is to finishing. The only visibility is start time and elapsed duration.

**Fix:** Implemented `execOnceStreaming()` in AgentRunner, turn parsing from CLI output, `worker-progress` event broadcasting with `{ workerId, turnsUsed, turnsMax, lastAction }`, and WebChat progress display.

---

### #9 — OB-F31 — Session checkpointing not implemented (Master can't pause/resume)

**Discovered:** 2026-02-26 (health score audit), **Updated:** 2026-02-27 (fixed)
**Component:** `src/master/master-manager.ts`, `src/core/queue.ts`, `src/core/router.ts`
**Severity:** ✅ Fixed
**Backlog:** OB-931 | **Health Impact:** +0.05

**Problem:** When the Master AI is processing a complex multi-step task (spawning workers, waiting for results), it can't be interrupted. The fast-path responder (Phase 49) handles simple questions, but tool-use and complex messages must wait in the priority queue. There's no way to checkpoint the Master's current state, handle an urgent request, then resume.

**Fix:** Implemented `checkpointSession()` / `resumeSession()` on MasterManager. Wired to priority queue via `onUrgentEnqueued` so urgent messages trigger a checkpoint-handle-resume cycle.

---

## Severity Guide

| Severity    | Meaning                                               |
| ----------- | ----------------------------------------------------- |
| 🔴 Critical | System broken, data loss risk, security vulnerability |
| 🟠 High     | Core functionality missing or significantly impaired  |
| 🟡 Medium   | Friction, technical debt, or non-blocking gaps        |
| 🟢 Low      | Polish, minor improvements, nice-to-have              |
