# OpenBridge — Archived Findings (v5)

> **Archived:** 2026-02-26 | **Contains:** 9 fixed findings from Phases 22–50
> **All findings validated against source code on 2026-02-26 — confirmed fixed.**

---

### OB-F26 — Large directory exploration times out (src/ exceeds 3-min dive budget) ✅

**Discovered:** 2026-02-26 (production logs)
**Fixed:** 2026-02-26 (Phase 50, OB-940 through OB-946)
**Component:** `src/master/exploration-coordinator.ts`, `src/master/workspace-change-tracker.ts`
**Severity:** 🟠 High → ✅ Fixed

**Fix applied:** Added `expandLargeDirectories()` to `ExplorationCoordinator` — directories with >25 files are split into their immediate subdirectories before Phase 3 dives. Each subdirectory gets its own worker. Per-directory timeout scales with file count (`max(180s, min(600s, fileCount * 4s))`). `StructureScanSchema` now has a `splitDirs` field mapping parent → sub-paths. `extractChangedScopes()` produces 2-level scopes (e.g., `src/core` instead of `src`) when split directories are active. User-triggered re-exploration available via `explore` / `explore full` commands from any channel.

**Validation:** `expandLargeDirectories()` at exploration-coordinator.ts:396, `splitDirs` in types/master.ts:368. Tests passing.

---

### OB-F23 — exploration_progress table is always empty (explorationId never passed) ✅

**Discovered:** 2026-02-26 (database audit)
**Fixed:** 2026-02-26 (Phase 47, OB-890 through OB-896)
**Component:** `src/master/master-manager.ts`
**Severity:** 🟠 High → ✅ Fixed

**Fix applied:** `MasterManager` now creates an `agent_activity` row (type `explorer`) before each `ExplorationCoordinator` invocation and passes its UUID as `explorationId`. Both `masterDrivenExplore()` and `incrementalExplore()` paths are covered. `exploration_progress` table is now populated for all 5 phases and each directory dive. Regression test added in `tests/integration/exploration-progress.test.ts`.

**Validation:** `explorationId = randomUUID()` at master-manager.ts:2952, passed to coordinator at :2973. `insertExplorationProgress()` called at exploration-coordinator.ts:614,662,874,1344. Test: 10/10 passing.

---

### OB-F24 — Worker max-turns exhaustion is silent (no retry, no detection) ✅

**Discovered:** 2026-02-26 (failure analysis)
**Fixed:** 2026-02-26 (Phase 48, OB-900 through OB-907)
**Component:** `src/core/agent-runner.ts`, `src/master/master-manager.ts`
**Severity:** 🟡 Medium → ✅ Fixed

**Fix applied:** Added `turnsExhausted` flag to `AgentResult`. `processWorkerResult()` detects max-turns stdout indicator. Worker prompts now include a turn-budget warning ("If you cannot finish, output `[INCOMPLETE: step X/Y]`"). Adaptive `maxTurns` scales with prompt length (capped at 50). On exhaustion, worker is automatically re-spawned with `maxTurns * 1.5` and the partial output injected as context.

**Validation:** `turnsExhausted` field at agent-runner.ts:385, `isMaxTurnsExhausted()` at :141. Test: master-manager-adaptive-turns.test.ts 14/14 passing.

---

### OB-F25 — Worker auth/crash failures not retried or delegated ✅

**Discovered:** 2026-02-26 (failure analysis)
**Fixed:** 2026-02-26 (Phase 48, OB-900 through OB-907)
**Component:** `src/master/master-manager.ts`, `src/core/agent-runner.ts`
**Severity:** 🟡 Medium → ✅ Fixed

**Fix applied:** `classifyError(stderr, exitCode)` added to `agent-runner.ts` — returns `'rate-limit' | 'auth' | 'timeout' | 'crash' | 'context-overflow' | 'unknown'`. Default retries changed from `0` to `3` for workers; auth and context-overflow errors are excluded from retry. Master system prompt updated to instruct re-delegation on failure. Worker failure patterns recorded in `learnings` table; model selection prefers models with <50% failure rate for the task type.

**Validation:** `classifyError()` at agent-runner.ts:157, `AUTH_PATTERNS` at :81, default retries=3 at :800. Test: worker-failure-retry.test.ts 7/7 passing.

---

### OB-F22 — maxTurns: 3 blocks all non-Q&A tasks ✅

**Discovered:** 2026-02-23 (real-world E2E testing)
**Fixed:** 2026-02-23 (OB-400)
**Component:** `src/master/master-manager.ts`
**Severity:** 🔴 Critical → ✅ Fixed

**Fix applied:** Added `classifyTask()` to `MasterManager` with keyword heuristics. `processMessage()` now classifies each message and sets `maxTurns` accordingly. `computeAdaptiveMaxTurns()` scales with prompt length, capped at 50. Profile-based baselines: code-edit/full-access=15, read-only=10, default=25.

**Validation:** `classifyTask()` at master-manager.ts:2246, `computeAdaptiveMaxTurns()` at :4814, `defaultMaxTurnsForProfile()` at :4798. Test: 14/14 passing.

---

### OB-F18 — Test suite has 7 failures due to git hook race condition ✅

**Discovered:** 2026-02-22 (post-automation audit)
**Fixed:** 2026-02-23 (OB-430)
**Component:** `tests/master/dotfolder-manager.test.ts`
**Severity:** 🟡 Medium → ✅ Fixed

**Fix applied:** Changed `dotfolder-manager.test.ts` to use `fs.mkdtemp(path.join(os.tmpdir(), 'openbridge-dfm-test-'))` instead of `path.join(process.cwd(), 'test-workspace-' + Date.now())`. Creates unique isolated temp directories outside the project git repo.

**Validation:** `os.tmpdir()` used at dotfolder-manager.test.ts:21. Test: 62/62 passing.

---

### OB-F21 — Master session ID uses invalid UUID format ✅

**Discovered:** 2026-02-22
**Fixed:** 2026-02-22

**Fix applied:** Removed `master-` prefix from session ID generation. Claude CLI requires raw UUID.

**Validation:** `randomUUID()` at master-manager.ts:961, no prefix added. Comment confirms: "Claude CLI requires valid UUID format".

---

### OB-F19 — handleSpawnMarkersWithProgress() missing or incomplete ✅

**Discovered:** 2026-02-22
**Fixed:** 2026-02-22 (OB-311)

**Fix applied:** Method fully implemented with async generator yielding progress updates.

**Validation:** `handleSpawnMarkersWithProgress()` at master-manager.ts:4946, full AsyncGenerator implementation with worker registry, progress yields, concurrent spawning.

---

### OB-F20 — HEALTH.md scores outdated ✅

**Discovered:** 2026-02-22
**Fixed:** 2026-02-22 (OB-314)

**Fix applied:** All categories re-scored, weighted total recalculated.

**Validation:** docs/audit/HEALTH.md shows score 9.20/10, last audit 2026-02-26, all phases documented.
