# OpenBridge — Findings Archive v7 (Phases 51–56)

> **Findings archived:** 9 (OB-F27, OB-F28, OB-F29, OB-F30, OB-F31, OB-F32, OB-F33, OB-F34, OB-F35)
> **All fixed in:** v0.0.3 (Phases 51–56)
> **Archived:** 2026-02-27

---

### OB-F32 — Prompt library methods missing from DotFolderManager (39 test failures)

**Discovered:** 2026-02-26 (code audit), **Fixed:** 2026-02-27 (Phase 51)
**Component:** `src/master/dotfolder-manager.ts`
**Backlog:** OB-836

**Problem:** Seven prompt library methods referenced by tests and `master-manager.ts` did not exist on `DotFolderManager`: `readPromptManifest()`, `writePromptManifest()`, `writePromptTemplate()`, `getPromptTemplate()`, `recordPromptUsage()`, `getLowPerformingPrompts()`, `resetPromptStats()`.

**Fix:** Implemented all 7 methods on `DotFolderManager` using `PromptManifestSchema` and `PromptTemplateSchema` Zod schemas. Methods read/write `.openbridge/prompts/manifest.json` and individual `.md` files. Resolved 39 test failures, 20 TS errors, 264 lint errors.

---

### OB-F33 — TypeScript compilation errors in master-manager.ts (20 errors)

**Discovered:** 2026-02-26, **Fixed:** 2026-02-27 (Phase 51)
**Component:** `src/master/master-manager.ts`
**Backlog:** OB-990

**Problem:** `rollbackDegradedPrompts()` cascaded 20 TS18046 errors due to missing methods from OB-F32.

**Fix:** Auto-resolved by OB-F32 fix + corrected `PromptRecord`→`PromptTemplate` type.

---

### OB-F27 — Audit logger missing JSONL flat-file output (8 test failures)

**Discovered:** 2026-02-26, **Fixed:** 2026-02-27 (Phase 51)
**Component:** `src/core/audit-logger.ts`
**Backlog:** OB-820

**Problem:** `AuditLogger.write()` only logged to Pino and SQLite, never wrote JSONL to the configured `logPath`.

**Fix:** Stored `logPath` in constructor, added `mkdir` + `appendFile` in `write()` with try-catch. Resolved 8 test failures.

---

### OB-F34 — ESLint reports 264 errors (cascading from OB-F32/F33)

**Discovered:** 2026-02-26, **Fixed:** 2026-02-27 (Phase 51)
**Component:** `src/master/master-manager.ts`, `tests/master/prompt-*.test.ts`
**Backlog:** OB-991

**Problem:** 264 ESLint `@typescript-eslint/no-unsafe-*` errors cascading from OB-F32.

**Fix:** Auto-resolved by OB-F32 fix.

---

### OB-F29 — Conversation continuity is shallow (no cross-session memory)

**Discovered:** 2026-02-26, **Fixed:** 2026-02-27 (Phase 52)
**Component:** `src/master/master-manager.ts`, `src/memory/conversation-store.ts`, `src/memory/eviction.ts`
**Backlog:** OB-822

**Problem:** Master AI treated every session as nearly fresh. Only FTS5 top-5 keyword match, no cross-session awareness.

**Fix:** Implemented `memory.md` pattern — Master reads `.openbridge/context/memory.md` on session start, updates on session end. FTS5 as fallback. Eviction scheduled on startup + every 24h.

---

### OB-F35 — No conversation history access for users

**Discovered:** 2026-02-26, **Fixed:** 2026-02-27 (Phase 53)
**Component:** `src/memory/conversation-store.ts`, `src/connectors/webchat/`, `src/core/router.ts`
**Backlog:** OB-992

**Problem:** No way for users to list, search, or browse past conversations.

**Fix:** Added `listSessions()`, `searchSessions()`, `/history` command (all channels), `/api/sessions` REST endpoints, session titles.

---

### OB-F28 — No DB schema versioning (manual ALTER TABLE sequences)

**Discovered:** 2026-02-26, **Fixed:** 2026-02-27 (Phase 54)
**Component:** `src/memory/migration.ts`
**Backlog:** OB-821

**Problem:** Migrations ran all ALTER statements every startup with no version tracking.

**Fix:** Added `schema_versions` table, numbered migrations, transactional execution, idempotency tests.

---

### OB-F30 — No real-time worker streaming progress

**Discovered:** 2026-02-26, **Fixed:** 2026-02-27 (Phase 55)
**Component:** `src/core/agent-runner.ts`, `src/master/master-manager.ts`
**Backlog:** OB-930

**Problem:** Workers showed only "running" with no granularity.

**Fix:** Implemented `execOnceStreaming()`, turn parsing, `worker-progress` event broadcasting, WebChat progress display.

---

### OB-F31 — Session checkpointing not implemented

**Discovered:** 2026-02-26, **Fixed:** 2026-02-27 (Phase 55)
**Component:** `src/master/master-manager.ts`, `src/core/queue.ts`, `src/core/router.ts`
**Backlog:** OB-931

**Problem:** Master couldn't be interrupted during complex multi-step tasks.

**Fix:** Added `checkpointSession()` / `resumeSession()`, wired to priority queue via `onUrgentEnqueued`.
