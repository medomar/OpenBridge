# OpenBridge — Audit Findings

> **Purpose:** Real issues, gaps, and risks discovered during code audits and real-world testing.
> **This is NOT a task list.** Tasks live in [TASKS.md](TASKS.md). Findings document _what's wrong_ and _why it matters_.
> **Open:** 2 | **Fixed:** 9 | **Last Audit:** 2026-02-23
> **Resolved findings:** [V0 archive](archive/v0/FINDINGS-v0.md) | [V2 archive](archive/v2/FINDINGS-v2.md) | [V4 archive](archive/v4/FINDINGS-v4.md)

---

## Open Findings

### OB-F18 — Test suite has 7 failures due to git hook race condition

**Discovered:** 2026-02-22 (post-automation audit)
**Component:** `tests/master/dotfolder-manager.test.ts`, `tests/master/exploration-coordinator.test.ts`
**Severity:** 🟡 Medium
**Impact:** CI may be intermittently red. Test failures are from parallel test execution colliding on temp `.git` directories.

**Details:**
DotFolderManager tests create temporary `.git` directories. When tests run in parallel, they collide on `.git/hooks/update.sample` file creation. This cascades into ExplorationCoordinator failures (which depend on DotFolderManager).

**Fix:** Use unique temp directories per test (e.g., `mkdtemp` in os.tmpdir()). Already proven to work in `workspace-change-tracker.test.ts`.

**Resolves in:** Phase 28, OB-430

---

### OB-F22 — maxTurns: 3 blocks all non-Q&A tasks

**Discovered:** 2026-02-23 (real-world E2E testing)
**Component:** `src/master/master-manager.ts:89, 415`
**Severity:** 🔴 Critical
**Impact:** Any user request that requires file generation, code changes, or multi-step research fails with "Error: Reached max turns (3)". The Master cannot output SPAWN markers within 3 turns for complex tasks.

**Details:**
`MESSAGE_MAX_TURNS = 3` was set to keep Q&A fast (context is injected in system prompt, so the Master can answer most questions without tools). But tasks like "generate me an HTML file for investors" require the Master to: (1) read workspace context, (2) plan the approach, (3) decide to delegate or act directly. 3 turns isn't enough.

**Evidence from E2E log (2026-02-23):**

```
content: "can you generate me a small pdf or HTML file to share with potential investors?"
... (107 seconds of "Still working...")
Error: Reached max turns (3)
```

The 107s duration suggests the Master spent all 3 turns on tool calls (reading context) and never reached the point of generating output or SPAWN markers.

**Fix:** Task classification — classify messages as quick-answer/tool-use/complex-task, set maxTurns per category, auto-delegate complex tasks via planning prompt.

**Resolves in:** Phase 25, OB-400 + OB-401

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
