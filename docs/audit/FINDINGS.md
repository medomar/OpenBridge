# OpenBridge — Audit Findings

> **Purpose:** Real issues, gaps, and risks discovered during code audits and real-world testing.
> **This is NOT a task list.** Tasks live in [TASKS.md](TASKS.md). Findings document _what's wrong_ and _why it matters_.
> **Open:** 3 | **Fixed:** 7 | **Last Audit:** 2026-02-22
> **Resolved findings:** [V0 archive](archive/v0/FINDINGS-v0.md) | [V2 archive](archive/v2/FINDINGS-v2.md) | [V4 archive](archive/v4/FINDINGS-v4.md)

---

## Open Findings

### OB-F21 — Master session ID uses invalid UUID format (FIXED)

**Discovered:** 2026-02-22 (real-world E2E testing)
**Component:** `src/master/master-manager.ts:313, 513`
**Severity:** 🔴 Critical
**Impact:** Master AI exploration never completes. Session ID rejected by Claude CLI.

**Details:**
Session IDs were generated as `master-${randomUUID()}` (e.g., `master-dc262cc8-160a-410c-b5e3-96f7f2c905df`). Claude CLI's `--session-id` flag requires a raw UUID — the `master-` prefix makes it invalid. This caused exit code 1 ("Invalid session ID. Must be a valid UUID"). Combined with a 10-minute exploration timeout (DEFAULT_TIMEOUT = 600_000), the Master would either get rejected immediately or time out with exit code 143 (SIGTERM).

**Evidence from exploration.log:**

```
exit code 1 — Error: Invalid session ID. Must be a valid UUID.
exit code 143 — (timeout after 10 minutes)
```

**Fix applied:**

1. Removed `master-` prefix from session ID generation (lines 313, 516) — now uses raw `randomUUID()`
2. Increased DEFAULT_TIMEOUT from 600_000 (10 min) to 1_800_000 (30 min)
3. Added null safety check in `buildMasterSpawnOptions()` (line 369)
4. Updated 5 test assertions across 3 test files to match new UUID format

**Status:** ✅ Fixed (2026-02-22)

---

### OB-F18 — Test suite has 7 failures due to git hook race condition

**Discovered:** 2026-02-22 (post-automation audit)
**Component:** `tests/master/dotfolder-manager.test.ts`, `tests/master/exploration-coordinator.test.ts`, `tests/connectors/whatsapp.test.ts`
**Impact:** CI is red. Cannot verify DotFolderManager, ExplorationCoordinator, or WhatsApp reconnect logic.

**Details:**
DotFolderManager tests create temporary `.git` directories for testing. When tests run in parallel, they collide on `.git/hooks/update.sample` file creation. This cascades into 5 ExplorationCoordinator failures (which depend on DotFolderManager). The WhatsApp reconnect test is a separate issue — the reconnect counter reset logic isn't matching test expectations.

**Evidence:**

```
Test Files  1 failed | 47 passed (48)
Tests      10 failed | 961 passed (971)
```

**Fix:** Use unique temp directories per test (e.g., `mkdtemp`), or use `--pool forks` for test isolation.

**Resolves in:** Phase 22, OB-200 + OB-201 + OB-202

---

### OB-F19 — handleSpawnMarkersWithProgress() missing or incomplete

**Discovered:** 2026-02-22 (code audit)
**Component:** `src/master/master-manager.ts:1423-1437`
**Impact:** Multi-worker progress streaming doesn't work. When Master spawns 2+ workers, the user gets no progress updates until all workers finish.

**Details:**
The `streamMessage()` method calls `this.handleSpawnMarkersWithProgress(spawnResult.markers)` for multi-worker tasks, but the method is either missing or has an incomplete implementation. The code tries to iterate over an async generator but the underlying method doesn't exist properly.

**Fix:** Implement the method — yield "Working on it... (N/M subtasks done)" as each worker completes.

**Resolves in:** Phase 22, OB-204

---

### OB-F20 — HEALTH.md scores are outdated (still showing 0/10 for completed work)

**Discovered:** 2026-02-22 (post-automation audit)
**Component:** `docs/audit/HEALTH.md`
**Impact:** Health score breakdown shows 0/10 for Agent Runner, Tool Profiles, Self-Improvement — all of which are fully built. The overall score (7.05) doesn't match reality.

**Details:**
The score breakdown table was never updated after Phases 16–21 completed. It still shows the baseline from when the phases were empty. The increment-by-task scoring added 0.015 per task but the category weights were never re-evaluated.

**Fix applied:**
Re-scored all categories: Agent Runner 8.5/10, Tool Profiles 8.0/10, Master AI 7.5/10, Worker Orchestration 7.5/10, Self-Improvement 7.0/10, Testing 8.5/10. Recalculated weighted total to 7.925. Updated header Current Score to 7.930 (+0.005 for OB-314). Added new row to score history. README Current Status table also updated.

**Status:** ✅ Fixed (2026-02-22, OB-314)

---

## Severity Guide

| Severity    | Meaning                                               |
| ----------- | ----------------------------------------------------- |
| 🔴 Critical | System broken, data loss risk, security vulnerability |
| 🟠 High     | Core functionality missing or significantly impaired  |
| 🟡 Medium   | Friction, technical debt, or non-blocking gaps        |
| 🟢 Low      | Polish, minor improvements, nice-to-have              |
