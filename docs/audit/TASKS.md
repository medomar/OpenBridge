# OpenBridge — Task List

> **Pending:** 10 | **In Progress:** 0 | **Done:** 8 (1045 archived)
> **Last Updated:** 2026-03-05

<details>
<summary>Archive (1045 tasks completed across Phases 1–104 + Deep)</summary>

- [V0 — Phases 1–5](archive/v0/TASKS-v0.md)
- [V1 — Phases 6–10](archive/v1/TASKS-v1.md)
- [V2 — Phases 11–14](archive/v2/TASKS-v2.md)
- [MVP — Phase 15](archive/v3/TASKS-v3-mvp.md)
- [Self-Governing — Phases 16–21](archive/v4/TASKS-v4-self-governing.md)
- [E2E + Channels — Phases 22–24](archive/v5/TASKS-v5-e2e-channels.md)
- [Smart Orchestration — Phases 25–28](archive/v6/TASKS-v6-smart-orchestration.md)
- [AI Classification — Phase 29](archive/v7/TASKS-v7-ai-classification.md)
- [Production Readiness — Phase 30](archive/v8/TASKS-v8-production-readiness.md)
- [Memory + Scale — Phases 31–38](archive/v9/TASKS-v9-memory-scale.md)
- [Memory Wiring — Phase 40](archive/v10/TASKS-v10-memory-wiring.md)
- [Memory Fixes — Phases 41–44](archive/v11/TASKS-v11-memory-fixes.md)
- [Post-v0.0.2 — Phases 45–50](archive/v12/TASKS-v12-post-v002-phases-45-50.md)
- [v0.0.3 — Phases 51–56](archive/v13/TASKS-v13-v003-phases-51-56.md)
- [v0.0.4 — Phases 57–62](archive/v14/TASKS-v14-v004-phases-57-62.md)
- [v0.0.5 — Phases 63–66](archive/v15/TASKS-v15-v005-phases-63-66.md)
- [v0.0.6 — Phase 67](archive/v16/TASKS-v16-v006-phase-67.md)
- [v0.0.7 — Phases 68–69](archive/v17/TASKS-v17-v007-phases-68-69.md)
- [v0.0.8 — Phases 70–73](archive/v18/TASKS-v18-v008-phases-70-73.md)
- [v0.0.9–v0.0.11 + Deep-1 — Phases 74–86](archive/v20/TASKS-v20-v009-v011-phases-74-86-deep1.md)
- [v0.0.12 Sprint 4 — Phases RWT, Deep, 82–104](archive/v21/TASKS-v21-v012-sprint4-phases-rwt-deep-82-104.md)

</details>

---

## Phase 97 — Data Integrity Fixes (pre-v0.0.13)

**Goal:** Fix 7 broken data pipelines discovered by auditing `.openbridge/openbridge.db`. All features are implemented but have wiring gaps — data never reaches the DB.

**Findings:** OB-F89, OB-F90, OB-F91, OB-F92, OB-F93, OB-F94, OB-F95

---

### OB-F89 — Audit log always empty (config disabled by default)

| Task    | What                                                                | Key File              | Status  |
| ------- | ------------------------------------------------------------------- | --------------------- | ------- |
| OB-1600 | Default `audit.enabled` to `true` in config Zod schema              | `src/types/config.ts` | ✅ Done |
| OB-1601 | Update `config.example.json` to show `"audit": { "enabled": true }` | `config.example.json` | ✅ Done |

### OB-F90 — QA cache write path missing

| Task    | What                                                                                             | Key File                    | Status  |
| ------- | ------------------------------------------------------------------------------------------------ | --------------------------- | ------- |
| OB-1602 | Call `qaCache.store()` after successful Master response in Router (cache question + answer)      | `src/core/router.ts`        | ✅ Done |
| OB-1603 | Add guard: only cache when response is substantive (skip greetings, short acks, errors)          | `src/core/router.ts`        | ✅ Done |
| OB-1604 | Test: verify QA cache populates after real message flow and cache hit returns on repeat question | `tests/core/router.test.ts` | ✅ Done |

### OB-F91 — Sessions never close

| Task    | What                                                                                  | Key File                       | Status  |
| ------- | ------------------------------------------------------------------------------------- | ------------------------------ | ------- |
| OB-1605 | Call `closeActiveSessions()` in `MasterManager.shutdown()` after saving session state | `src/master/master-manager.ts` | ✅ Done |
| OB-1606 | Call `closeActiveSessions()` in `Bridge.shutdown()` as final cleanup step             | `src/core/bridge.ts`           | ✅ Done |
| OB-1607 | On startup, mark stale sessions (active but `last_used_at` > 24h ago) as `expired`    | `src/memory/index.ts`          | ✅ Done |

### OB-F92 — Learnings turns tracking broken (hardcoded zeros)

| Task    | What                                                                                  | Key File                       | Status  |
| ------- | ------------------------------------------------------------------------------------- | ------------------------------ | ------- |
| OB-1608 | Extract `turns_used` in `masterTaskToMemoryTask()` from task metadata                 | `src/master/master-manager.ts` | Pending |
| OB-1609 | Pass actual `turns_used` (not `0`) to `recordLearning()` at line ~2987 (worker tasks) | `src/master/master-manager.ts` | Pending |
| OB-1610 | Pass actual turns to `recordLearning()` at line ~3193 (classification tasks)          | `src/master/master-manager.ts` | Pending |

### OB-F93 — Prompt evolution never activates

| Task    | What                                                                                        | Key File                       | Status  |
| ------- | ------------------------------------------------------------------------------------------- | ------------------------------ | ------- |
| OB-1611 | Call `seedPromptLibrary()` after `seedSystemPrompt()` during Master initialization          | `src/master/master-manager.ts` | Pending |
| OB-1612 | Wire `recordPromptOutcome()` calls after worker tasks complete (connect to prompt tracking) | `src/master/master-manager.ts` | Pending |

### OB-F94 — Sub-master detection never triggered

| Task    | What                                                                                         | Key File                       | Status  |
| ------- | -------------------------------------------------------------------------------------------- | ------------------------------ | ------- |
| OB-1613 | Call `detectSubProjects()` after workspace exploration completes in `explore()` or `start()` | `src/master/master-manager.ts` | Pending |
| OB-1614 | If sub-projects detected, call `spawnSubMaster()` for each and store in `sub_masters` table  | `src/master/master-manager.ts` | Pending |

### OB-F95 — memory.md staleness (fire-and-forget)

| Task    | What                                                                                              | Key File                          | Status  |
| ------- | ------------------------------------------------------------------------------------------------- | --------------------------------- | ------- |
| OB-1615 | Add verification after `triggerMemoryUpdate()` — check memory.md was actually written/modified    | `src/master/master-manager.ts`    | Pending |
| OB-1616 | Add fallback: if Master's Write fails, directly write memory.md from conversation history summary | `src/master/dotfolder-manager.ts` | Pending |
| OB-1617 | On startup, detect stale memory.md (>24h old or missing) and regenerate from SQLite data          | `src/master/dotfolder-manager.ts` | Pending |

---

**Phase 97 Summary:** 18 tasks across 7 findings. All are surgical fixes (1–20 lines each) to existing code — no new modules needed.

**Priority order:** OB-F91 (sessions) → OB-F92 (turns) → OB-F90 (QA cache) → OB-F95 (memory.md) → OB-F93 (prompts) → OB-F89 (audit) → OB-F94 (sub-masters)

---

**Next after Phase 97:** Sprint 5 (v0.0.13) — Community-inspired improvements. See [FUTURE.md](FUTURE.md) for planned phases and [ROADMAP.md](../ROADMAP.md) for version milestones.

---
