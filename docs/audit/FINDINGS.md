# OpenBridge — Audit Findings

> **Purpose:** Real issues, gaps, and risks discovered during code audits and real-world testing.
> **This is NOT a task list.** Tasks live in [TASKS.md](TASKS.md). Findings document _what's wrong_ and _why it matters_.
> **Open:** 0 | **Fixed:** 11 | **Last Audit:** 2026-02-23
> **Resolved findings:** [V0 archive](archive/v0/FINDINGS-v0.md) | [V2 archive](archive/v2/FINDINGS-v2.md) | [V4 archive](archive/v4/FINDINGS-v4.md)

---

## Open Findings

_No open findings._

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
