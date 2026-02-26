# OpenBridge — Audit Findings

> **Purpose:** Real issues, gaps, and risks discovered during code audits and real-world testing.
> **This is NOT a task list.** Tasks live in [TASKS.md](TASKS.md). Findings document _what's wrong_ and _why it matters_.
> **Open:** 0 | **Fixed:** 15 | **Last Audit:** 2026-02-26
> **Resolved findings:** [V0 archive](archive/v0/FINDINGS-v0.md) | [V2 archive](archive/v2/FINDINGS-v2.md) | [V4 archive](archive/v4/FINDINGS-v4.md)

---

## Open Findings

_No open findings._

---

## Fixed Findings (Recent)

### OB-F26 — Large directory exploration times out (src/ exceeds 3-min dive budget) ✅

**Discovered:** 2026-02-26 (production logs)
**Fixed:** 2026-02-26 (Phase 50, OB-940 through OB-946)
**Component:** `src/master/exploration-coordinator.ts`, `src/master/workspace-change-tracker.ts`
**Severity:** 🟠 High → ✅ Fixed

**Fix applied:** Added `expandLargeDirectories()` to `ExplorationCoordinator` — directories with >25 files are split into their immediate subdirectories before Phase 3 dives. Each subdirectory gets its own worker. Per-directory timeout scales with file count (`max(180s, min(600s, fileCount * 4s))`). `StructureScanSchema` now has a `splitDirs` field mapping parent → sub-paths. `extractChangedScopes()` produces 2-level scopes (e.g., `src/core` instead of `src`) when split directories are active. User-triggered re-exploration available via `explore` / `explore full` commands from any channel.

---

### OB-F23 — exploration_progress table is always empty (explorationId never passed) ✅

**Discovered:** 2026-02-26 (database audit)
**Fixed:** 2026-02-26 (Phase 47, OB-890 through OB-896)
**Component:** `src/master/master-manager.ts`
**Severity:** 🟠 High → ✅ Fixed

**Fix applied:** `MasterManager` now creates an `agent_activity` row (type `explorer`) before each `ExplorationCoordinator` invocation and passes its UUID as `explorationId`. Both `masterDrivenExplore()` and `incrementalExplore()` paths are covered. `exploration_progress` table is now populated for all 5 phases and each directory dive. Regression test added in `tests/integration/exploration-progress.test.ts`.

---

### OB-F24 — Worker max-turns exhaustion is silent (no retry, no detection) ✅

**Discovered:** 2026-02-26 (failure analysis)
**Fixed:** 2026-02-26 (Phase 48, OB-900 through OB-907)
**Component:** `src/core/agent-runner.ts`, `src/master/master-manager.ts`
**Severity:** 🟡 Medium → ✅ Fixed

**Fix applied:** Added `turnsExhausted` flag to `AgentResult`. `processWorkerResult()` detects max-turns stdout indicator. Worker prompts now include a turn-budget warning ("If you cannot finish, output `[INCOMPLETE: step X/Y]`"). Adaptive `maxTurns` scales with prompt length (capped at 50). On exhaustion, worker is automatically re-spawned with `maxTurns * 1.5` and the partial output injected as context.

---

### OB-F25 — Worker auth/crash failures not retried or delegated ✅

**Discovered:** 2026-02-26 (failure analysis)
**Fixed:** 2026-02-26 (Phase 48, OB-900 through OB-907)
**Component:** `src/master/master-manager.ts`, `src/core/agent-runner.ts`
**Severity:** 🟡 Medium → ✅ Fixed

**Fix applied:** `classifyError(stderr, exitCode)` added to `agent-runner.ts` — returns `'rate-limit' | 'auth' | 'timeout' | 'crash' | 'context-overflow' | 'unknown'`. Default retries changed from `0` to `2` for workers; auth and context-overflow errors are excluded from retry. Master system prompt updated to instruct re-delegation on failure. Worker failure patterns recorded in `learnings` table; model selection prefers models with <50% failure rate for the task type.

---

### OB-F22 — maxTurns: 3 blocks all non-Q&A tasks ✅

**Discovered:** 2026-02-23 (real-world E2E testing)
**Fixed:** 2026-02-23 (OB-400)
**Component:** `src/master/master-manager.ts`
**Severity:** 🔴 Critical → ✅ Fixed

**Fix applied:** Added `classifyTask()` to `MasterManager` with keyword heuristics. `processMessage()` now classifies each message and sets `maxTurns` accordingly: quick-answer=3, tool-use=10, complex-task=15. "Generate me an HTML file" → tool-use → 10 turns. "Implement authentication" → complex-task → 15 turns.

---

### OB-F18 — Test suite has 7 failures due to git hook race condition ✅

**Discovered:** 2026-02-22 (post-automation audit)
**Fixed:** 2026-02-23 (OB-430)
**Component:** `tests/master/dotfolder-manager.test.ts`
**Severity:** 🟡 Medium → ✅ Fixed

**Fix applied:** Changed `dotfolder-manager.test.ts` to use `fs.mkdtemp(path.join(os.tmpdir(), 'openbridge-dfm-test-'))` instead of `path.join(process.cwd(), 'test-workspace-' + Date.now())`. This creates unique isolated temp directories outside the project git repo, eliminating `.git/hooks` race conditions during parallel test execution. 1114 tests passing.

---

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
