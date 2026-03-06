# OpenBridge — Task Archive v22: Phase 97 — Data Integrity Fixes (pre-v0.0.13)

> **Archived:** 2026-03-06 | **Tasks:** 18 (all done) | **Findings fixed:** 7 (OB-F89 through OB-F95)
> **Goal:** Fix 7 broken data pipelines discovered by auditing `.openbridge/openbridge.db`. All features were implemented but had wiring gaps — data never reached the DB.

---

## OB-F89 — Audit log always empty (config disabled by default)

| Task    | What                                                                | Key File              | Status  |
| ------- | ------------------------------------------------------------------- | --------------------- | ------- |
| OB-1600 | Default `audit.enabled` to `true` in config Zod schema              | `src/types/config.ts` | ✅ Done |
| OB-1601 | Update `config.example.json` to show `"audit": { "enabled": true }` | `config.example.json` | ✅ Done |

## OB-F90 — QA cache write path missing

| Task    | What                                                                                             | Key File                    | Status  |
| ------- | ------------------------------------------------------------------------------------------------ | --------------------------- | ------- |
| OB-1602 | Call `qaCache.store()` after successful Master response in Router (cache question + answer)      | `src/core/router.ts`        | ✅ Done |
| OB-1603 | Add guard: only cache when response is substantive (skip greetings, short acks, errors)          | `src/core/router.ts`        | ✅ Done |
| OB-1604 | Test: verify QA cache populates after real message flow and cache hit returns on repeat question | `tests/core/router.test.ts` | ✅ Done |

## OB-F91 — Sessions never close

| Task    | What                                                                                  | Key File                       | Status  |
| ------- | ------------------------------------------------------------------------------------- | ------------------------------ | ------- |
| OB-1605 | Call `closeActiveSessions()` in `MasterManager.shutdown()` after saving session state | `src/master/master-manager.ts` | ✅ Done |
| OB-1606 | Call `closeActiveSessions()` in `Bridge.shutdown()` as final cleanup step             | `src/core/bridge.ts`           | ✅ Done |
| OB-1607 | On startup, mark stale sessions (active but `last_used_at` > 24h ago) as `expired`    | `src/memory/index.ts`          | ✅ Done |

## OB-F92 — Learnings turns tracking broken (hardcoded zeros)

| Task    | What                                                                                  | Key File                       | Status  |
| ------- | ------------------------------------------------------------------------------------- | ------------------------------ | ------- |
| OB-1608 | Extract `turns_used` in `masterTaskToMemoryTask()` from task metadata                 | `src/master/master-manager.ts` | ✅ Done |
| OB-1609 | Pass actual `turns_used` (not `0`) to `recordLearning()` at line ~2987 (worker tasks) | `src/master/master-manager.ts` | ✅ Done |
| OB-1610 | Pass actual turns to `recordLearning()` at line ~3193 (classification tasks)          | `src/master/master-manager.ts` | ✅ Done |

## OB-F93 — Prompt evolution never activates

| Task    | What                                                                                        | Key File                       | Status  |
| ------- | ------------------------------------------------------------------------------------------- | ------------------------------ | ------- |
| OB-1611 | Call `seedPromptLibrary()` after `seedSystemPrompt()` during Master initialization          | `src/master/master-manager.ts` | ✅ Done |
| OB-1612 | Wire `recordPromptOutcome()` calls after worker tasks complete (connect to prompt tracking) | `src/master/master-manager.ts` | ✅ Done |

## OB-F94 — Sub-master detection never triggered

| Task    | What                                                                                         | Key File                       | Status  |
| ------- | -------------------------------------------------------------------------------------------- | ------------------------------ | ------- |
| OB-1613 | Call `detectSubProjects()` after workspace exploration completes in `explore()` or `start()` | `src/master/master-manager.ts` | ✅ Done |
| OB-1614 | If sub-projects detected, call `spawnSubMaster()` for each and store in `sub_masters` table  | `src/master/master-manager.ts` | ✅ Done |

## OB-F95 — memory.md staleness (fire-and-forget)

| Task    | What                                                                                              | Key File                          | Status  |
| ------- | ------------------------------------------------------------------------------------------------- | --------------------------------- | ------- |
| OB-1615 | Add verification after `triggerMemoryUpdate()` — check memory.md was actually written/modified    | `src/master/master-manager.ts`    | ✅ Done |
| OB-1616 | Add fallback: if Master's Write fails, directly write memory.md from conversation history summary | `src/master/dotfolder-manager.ts` | ✅ Done |
| OB-1617 | On startup, detect stale memory.md (>24h old or missing) and regenerate from SQLite data          | `src/master/dotfolder-manager.ts` | ✅ Done |

---

**Phase 97 Summary:** 18 tasks across 7 findings. All surgical fixes (1–20 lines each) to existing code — no new modules needed.
