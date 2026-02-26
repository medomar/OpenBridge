# OpenBridge — Audit Findings

> **Purpose:** Real issues, gaps, and risks discovered during code audits and real-world testing.
> **This is NOT a task list.** Tasks live in [TASKS.md](TASKS.md). Findings document _what's wrong_ and _why it matters_.
> **Open:** 4 | **Fixed:** 11 | **Last Audit:** 2026-02-26
> **Resolved findings:** [V0 archive](archive/v0/FINDINGS-v0.md) | [V2 archive](archive/v2/FINDINGS-v2.md) | [V4 archive](archive/v4/FINDINGS-v4.md)

---

## Open Findings

### OB-F23 — exploration_progress table is always empty (explorationId never passed)

**Discovered:** 2026-02-26 (database audit)
**Component:** `src/master/master-manager.ts` (lines 2678, 2591)
**Severity:** 🟠 High
**Affects:** `/status` command shows no exploration progress, no phase-by-phase tracking

**Root cause:** `MasterManager` creates `ExplorationCoordinator` in two places (`masterDrivenExplore()` line 2678 and `incrementalExplore()` line 2591) but never passes the `explorationId` option. The coordinator's constructor accepts `explorationId?: string` and uses it to guard all `exploration_progress` writes (`if (this.memory && this.explorationId)`). Since it's always `undefined`, zero rows are ever inserted.

**Fix:** Create an `agent_activity` row (type `explorer`) before each exploration, pass its `id` as `explorationId`. Update the activity to `done`/`failed` when exploration finishes. Add integration test to prevent regression.

**Tracked:** Phase 47 (OB-890 through OB-896)

---

### OB-F24 — Worker max-turns exhaustion is silent (no retry, no detection)

**Discovered:** 2026-02-26 (failure analysis)
**Component:** `src/core/agent-runner.ts`, `src/master/master-manager.ts`
**Severity:** 🟡 Medium
**Affects:** Workers that hit max-turns exit with code 0 — Master treats incomplete work as success

**Root cause:** Claude CLI returns exit 0 when max-turns is reached. The worker output may contain partial results but there's no detection mechanism. Default retries are 0. No turn-budget warning is injected into worker prompts. Static turn budgets don't scale with task complexity.

**Tracked:** Phase 48 (OB-900 through OB-907)

---

### OB-F25 — Worker auth/crash failures not retried or delegated

**Discovered:** 2026-02-26 (failure analysis)
**Component:** `src/master/master-manager.ts` (spawnWorker), `src/core/agent-runner.ts`
**Severity:** 🟡 Medium
**Affects:** Workers that fail due to auth errors, rate limits, or crashes are reported to Master but not automatically retried or delegated

**Root cause:** Default `retries: 0` in SPAWN markers means workers don't retry. No error categorization (rate limit vs auth vs file-not-found). No master-driven re-spawn on failure. `isRateLimitError()` detection exists in agent-runner but only for the Master fallback path, not for workers.

**Tracked:** Phase 48 (OB-900 through OB-907)

---

### OB-F26 — Large directory exploration times out (src/ exceeds 3-min dive budget)

**Discovered:** 2026-02-26 (production logs)
**Component:** `src/master/exploration-coordinator.ts` (line 852), `src/master/workspace-change-tracker.ts` (line 358)
**Severity:** 🟠 High
**Affects:** Workspace map incomplete — `src/` scope never explored, workers spawned without `src/` context

**Root cause:** Each top-level directory gets a single AI worker with `DIRECTORY_DIVE_TIMEOUT = 180_000` (3 minutes). For directories with 40+ files and deep nesting (e.g., `src/` containing `core/`, `master/`, `connectors/`, `providers/`, `discovery/`, `types/`), the worker cannot finish reading, analyzing, and producing structured JSON within the time budget. The worker is killed with SIGTERM (exit code 143, `AgentExhaustedError`). The exploration continues without `src/` data — subsequent incremental re-exploration retries the same single-worker approach and fails again.

**Proposed fix:** Split large directories into subdirectories before diving. Add a file count threshold (~25 files). Directories exceeding it get their immediate subdirectories explored as separate parallel workers (`src/core/`, `src/master/`, etc.) instead of one monolithic `src/` dive. Update scope tracking to use 2-level scopes (`src/core` instead of `src`) for finer-grained incremental re-exploration.

**Key files to modify:**

- `src/types/master.ts` — add `splitDirs` field to `StructureScanSchema`
- `src/master/exploration-coordinator.ts` — add `expandLargeDirectories()`, filesystem helpers, update Phase 3
- `src/master/workspace-change-tracker.ts` — update `extractChangedScopes()` for 2-level scopes
- `src/master/master-manager.ts` — pass `splitDirs` to `extractChangedScopes()` during incremental explore

**Tracked:** Not yet scheduled (will be Phase 50 after current phases complete)

---

### OB-F18 — Test suite has 7 failures due to git hook race condition ✅

**Discovered:** 2026-02-22 (post-automation audit)
**Fixed:** 2026-02-23 (OB-430)
**Component:** `tests/master/dotfolder-manager.test.ts`
**Severity:** 🟡 Medium → ✅ Fixed

**Fix applied:** Changed `dotfolder-manager.test.ts` to use `fs.mkdtemp(path.join(os.tmpdir(), 'openbridge-dfm-test-'))` instead of `path.join(process.cwd(), 'test-workspace-' + Date.now())`. This creates unique isolated temp directories outside the project git repo, eliminating `.git/hooks` race conditions during parallel test execution. 1114 tests passing.

---

### OB-F22 — maxTurns: 3 blocks all non-Q&A tasks ✅

**Discovered:** 2026-02-23 (real-world E2E testing)
**Fixed:** 2026-02-23 (OB-400)
**Component:** `src/master/master-manager.ts`
**Severity:** 🔴 Critical → ✅ Fixed

**Fix applied:** Added `classifyTask()` to `MasterManager` with keyword heuristics. `processMessage()` now classifies each message and sets `maxTurns` accordingly: quick-answer=3, tool-use=10, complex-task=15. "Generate me an HTML file" → tool-use → 10 turns. "Implement authentication" → complex-task → 15 turns.

---

## Fixed Findings (Recent)

### OB-F21 — Master session ID uses invalid UUID format ✅

Fixed 2026-02-22. Removed `master-` prefix from session ID generation. Claude CLI requires raw UUID.

### OB-F19 — handleSpawnMarkersWithProgress() missing or incomplete ✅

Fixed 2026-02-22 (OB-311). Method fully implemented with async generator yielding progress updates.

### OB-F20 — HEALTH.md scores outdated ✅

Fixed 2026-02-22 (OB-314). All categories re-scored, weighted total recalculated.

---

## Severity Guide

| Severity    | Meaning                                               |
| ----------- | ----------------------------------------------------- |
| 🔴 Critical | System broken, data loss risk, security vulnerability |
| 🟠 High     | Core functionality missing or significantly impaired  |
| 🟡 Medium   | Friction, technical debt, or non-blocking gaps        |
| 🟢 Low      | Polish, minor improvements, nice-to-have              |
