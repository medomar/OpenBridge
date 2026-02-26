# OpenBridge — Archived Tasks: Phases 45–50

> **Archived:** 2026-02-26
> **Total tasks:** 75 (all ✅ Done)
> **Phases covered:** 47 (Exploration Progress), 48 (Worker Resilience), 46 (Worker Control), 49 (Responsive Master), 45 (Documentation Audit), 50 (Exploration Overhaul)
> **Previous archives:** [V0 (1–5)](../v0/TASKS-v0.md) | [V1 (6–10)](../v1/TASKS-v1.md) | [V2 (11–14)](../v2/TASKS-v2.md) | [MVP (15)](../v3/TASKS-v3-mvp.md) | [Self-Governing (16–21)](../v4/TASKS-v4-self-governing.md) | [E2E+Channels (22–24)](../v5/TASKS-v5-e2e-channels.md) | [Smart Orchestration (25–28)](../v6/TASKS-v6-smart-orchestration.md) | [AI Classification (29)](../v7/TASKS-v7-ai-classification.md) | [Production Readiness (30)](../v8/TASKS-v8-production-readiness.md) | [Memory+Scale (31–38)](../v9/TASKS-v9-memory-scale.md) | [Memory Wiring (40)](../v10/TASKS-v10-memory-wiring.md) | [Memory Fixes (41–44)](../v11/TASKS-v11-memory-fixes.md)

---

## Phase 47: Exploration Progress Tracking Fix _(v0.0.2)_

> **Bug:** `exploration_progress` table is always empty because `explorationId` is never passed to `ExplorationCoordinator`. See [OB-F23](../FINDINGS.md).

| #   | Task                                                                                                                                                                                                                                                                                                                  | ID     | Priority | Status  |
| --- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ | :------: | :-----: |
| 339 | **Create `agent_activity` row (type `explorer`) in `masterDrivenExplore()`.** Before creating `ExplorationCoordinator`, generate a UUID, call `memory.insertActivity({ id, type: 'explorer', status: 'running', ... })`. Pass the ID as `explorationId` option. Update to `done`/`failed` when exploration completes. | OB-890 | 🔴 High  | ✅ Done |
| 340 | **Create `agent_activity` row in `incrementalExplore()` stale dir re-exploration.** Same pattern as task 339 but for the `reexploreStaleDirs()` call path. Create explorer activity before coordinator, pass `explorationId`, update status on completion.                                                            | OB-891 | 🔴 High  | ✅ Done |
| 341 | **Verify `insertPhaseRow()` / `completePhaseRow()` / `failPhaseRow()` work end-to-end.** With `explorationId` now set, confirm that `exploration_progress` rows are created for each of the 5 phases during a full exploration.                                                                                       | OB-892 | 🔴 High  | ✅ Done |
| 342 | **Verify directory-level progress rows are created.** Confirm that each directory dive creates an `exploration_progress` row with `phase='directory-dive'`, `target=<dir>`, and that `progress_pct` updates from 0→100.                                                                                               | OB-893 | 🔴 High  | ✅ Done |
| 343 | **Verify `/status` command shows exploration progress.** Run the bridge, trigger exploration, send `status` command via Console connector. Confirm the response includes the exploration progress table.                                                                                                              | OB-894 | 🔴 High  | ✅ Done |
| 344 | **Integration test: exploration_progress populated after explore().** Create `tests/integration/exploration-progress.test.ts`.                                                                                                                                                                                        | OB-895 | 🔴 High  | ✅ Done |
| 345 | **Regression guard: add assertion to existing exploration tests.**                                                                                                                                                                                                                                                    | OB-896 |  🟡 Med  | ✅ Done |

---

## Phase 48: Worker Resilience — Max-Turns + Failure Recovery _(v0.0.2)_

> **Two bugs:** (1) Workers that hit max-turns exit with code 0 — no retry/detection. (2) Workers that fail default to `retries: 0`. See [OB-F24](../FINDINGS.md) and [OB-F25](../FINDINGS.md).

### Phase 48a: Max-Turns Detection & Adaptive Budget

| #   | Task                                                                                                                             | ID     | Priority | Status  |
| --- | -------------------------------------------------------------------------------------------------------------------------------- | ------ | :------: | :-----: |
| 346 | **Detect max-turns exhaustion in worker output.** Add `turnsExhausted: boolean` flag to `AgentResult`.                           | OB-900 | 🔴 High  | ✅ Done |
| 347 | **Add turn-budget warning to worker system prompt injection.**                                                                   | OB-901 | 🔴 High  | ✅ Done |
| 348 | **Adaptive max-turns based on prompt length.** Compute `maxTurns = baselineTurns + Math.ceil(promptLength / 1000)` capped at 50. | OB-902 |  🟡 Med  | ✅ Done |
| 349 | **Auto-retry on max-turns exhaustion.** Re-spawn with `maxTurns * 1.5` and partial output as context.                            | OB-903 | 🔴 High  | ✅ Done |

### Phase 48b: Worker Failure Classification & Recovery

| #   | Task                                                                                   | ID     | Priority | Status  |
| --- | -------------------------------------------------------------------------------------- | ------ | :------: | :-----: |
| 350 | **Classify worker exit errors.** Add `classifyError(stderr, exitCode): ErrorCategory`. | OB-904 | 🔴 High  | ✅ Done |
| 351 | **Change default retries from 0 to 2 for workers.**                                    | OB-905 | 🔴 High  | ✅ Done |
| 352 | **Master-driven worker re-delegation.**                                                | OB-906 |  🟡 Med  | ✅ Done |
| 353 | **Record worker failure patterns in learnings table.**                                 | OB-907 |  🟡 Med  | ✅ Done |

### Phase 48c: Tests & Verification

| #   | Task                                              | ID     | Priority | Status  |
| --- | ------------------------------------------------- | ------ | :------: | :-----: |
| 354 | **Unit tests for error classification.**          | OB-908 | 🔴 High  | ✅ Done |
| 355 | **Unit tests for adaptive max-turns.**            | OB-909 | 🔴 High  | ✅ Done |
| 356 | **Integration test for worker retry on failure.** | OB-910 | 🔴 High  | ✅ Done |
| 357 | **Verify all tests pass.**                        | OB-911 | 🔴 High  | ✅ Done |

---

## Phase 46: Worker Control Commands _(v0.1.1)_

> Stop commands, PID capture, kill infrastructure, WebChat stop buttons, cross-channel broadcast.

### Phase 46a: Worker Kill Infrastructure

| #   | Task                                                            | ID     | Priority | Status  |
| --- | --------------------------------------------------------------- | ------ | :------: | :-----: |
| 322 | **Expose ChildProcess handle from `execOnce()`.**               | OB-871 | 🔴 High  | ✅ Done |
| 323 | **Add `spawnWithHandle()` to AgentRunner.**                     | OB-872 | 🔴 High  | ✅ Done |
| 324 | **Capture real PID in `MasterManager.spawnWorker()`.**          | OB-873 | 🔴 High  | ✅ Done |
| 325 | **Add `killWorker()` and `killAllWorkers()` to MasterManager.** | OB-874 | 🔴 High  | ✅ Done |
| 326 | **Add PID column to `agent_activity` table.**                   | OB-875 |  🟡 Med  | ✅ Done |
| 327 | **Unit tests for worker kill infrastructure.**                  | OB-876 | 🔴 High  | ✅ Done |

### Phase 46b: Stop Command Handling

| #   | Task                                      | ID     | Priority | Status  |
| --- | ----------------------------------------- | ------ | :------: | :-----: |
| 328 | **Add `handleStopCommand()` to Router.**  | OB-877 | 🔴 High  | ✅ Done |
| 329 | **Add access control for stop command.**  | OB-878 | 🔴 High  | ✅ Done |
| 330 | **Add confirmation flow for `stop all`.** | OB-879 |  🟡 Med  | ✅ Done |
| 331 | **Format stop command responses.**        | OB-880 |  🟡 Med  | ✅ Done |
| 332 | **Unit tests for stop command handling.** | OB-881 | 🔴 High  | ✅ Done |

### Phase 46c: UI, Broadcast & Integration

| #   | Task                                              | ID     | Priority | Status  |
| --- | ------------------------------------------------- | ------ | :------: | :-----: |
| 333 | **Add stop buttons to WebChat dashboard.**        | OB-882 |  🟡 Med  | ✅ Done |
| 334 | **Broadcast worker stop events to all channels.** | OB-883 |  🟡 Med  | ✅ Done |
| 335 | **Notify Master AI on worker kill.**              | OB-884 | 🔴 High  | ✅ Done |
| 336 | **Integration test for stop command flow.**       | OB-885 | 🔴 High  | ✅ Done |
| 337 | **E2E test for stop all with confirmation.**      | OB-886 | 🔴 High  | ✅ Done |
| 338 | **Verify all tests pass.**                        | OB-887 | 🔴 High  | ✅ Done |

---

## Phase 49: Responsive Master — Message Handling During Processing _(v0.2.0)_

> Queue depth visibility, priority classification, fast-path responder during Master processing.

| #   | Task                                                                              | ID     | Priority | Status  |
| --- | --------------------------------------------------------------------------------- | ------ | :------: | :-----: |
| 358 | **Add queue depth + wait time to queued message acknowledgment.**                 | OB-920 | 🔴 High  | ✅ Done |
| 359 | **Implement message priority classification.**                                    | OB-921 | 🔴 High  | ✅ Done |
| 360 | **Add "fast-path" responder for quick-answer messages during Master processing.** | OB-922 | 🔴 High  | ✅ Done |
| 361 | **Expose processing state to users.**                                             | OB-923 |  🟡 Med  | ✅ Done |
| 362 | **Sub-master delegation for concurrent queries (v0.4.0 prep).**                   | OB-924 |  🟡 Med  | ✅ Done |
| 363 | **Tests for responsive Master.**                                                  | OB-925 | 🔴 High  | ✅ Done |

---

## Phase 45: Documentation Audit _(v0.0.2-post)_

> Align documentation with final codebase state after all code phases.

| #   | Task                                                        | ID     | Priority | Status  |
| --- | ----------------------------------------------------------- | ------ | :------: | :-----: |
| 311 | **Update ROADMAP.md.**                                      | OB-860 | 🔴 High  | ✅ Done |
| 312 | **Update TASKS.md header and backlog.**                     | OB-861 | 🔴 High  | ✅ Done |
| 313 | **Update OVERVIEW.md.**                                     | OB-862 | 🔴 High  | ✅ Done |
| 314 | **Create HEALTH.md.**                                       | OB-863 | 🔴 High  | ✅ Done |
| 315 | **Update CHANGELOG.md.**                                    | OB-864 | 🔴 High  | ✅ Done |
| 316 | **Update CLAUDE.md (both workspace root and OpenBridge/).** | OB-865 | 🔴 High  | ✅ Done |
| 317 | **Update MEMORY.md.**                                       | OB-866 | 🔴 High  | ✅ Done |
| 318 | **Audit milestone specs.**                                  | OB-867 |  🟡 Med  | ✅ Done |
| 319 | **Audit FINDINGS.md.**                                      | OB-868 |  🟡 Med  | ✅ Done |
| 320 | **Cross-reference code vs docs for gaps.**                  | OB-869 |  🟡 Med  | ✅ Done |
| 321 | **Verify tests pass after documentation changes.**          | OB-870 | 🔴 High  | ✅ Done |

---

## Phase 50: Exploration Overhaul _(v0.0.3)_

> Large directory splitting (OB-F26 fix), `/explore` command, exploration progress E2E validation, incremental progress tracking.

### Phase 50a: Large Directory Splitting

| #   | Task                                                          | ID     | Priority | Status  |
| --- | ------------------------------------------------------------- | ------ | :------: | :-----: |
| 364 | **Add `splitDirs` field to `StructureScanSchema`.**           | OB-940 | 🔴 High  | ✅ Done |
| 365 | **Add `expandLargeDirectories()` to ExplorationCoordinator.** | OB-941 | 🔴 High  | ✅ Done |
| 366 | **Update Phase 3 to use expanded directory list.**            | OB-942 | 🔴 High  | ✅ Done |
| 367 | **Scale timeout by file count.**                              | OB-943 |  🟡 Med  | ✅ Done |
| 368 | **Update `extractChangedScopes()` for 2-level scopes.**       | OB-944 |  🟡 Med  | ✅ Done |
| 369 | **Pass `splitDirs` to incremental explore.**                  | OB-945 |  🟡 Med  | ✅ Done |
| 370 | **Unit tests for directory splitting.**                       | OB-946 | 🔴 High  | ✅ Done |

### Phase 50b: User-Triggered `/explore` Command

| #   | Task                                             | ID     | Priority | Status  |
| --- | ------------------------------------------------ | ------ | :------: | :-----: |
| 371 | **Add `fullReExplore()` to MasterManager.**      | OB-950 | 🔴 High  | ✅ Done |
| 372 | **Add `explore` command detection in Router.**   | OB-951 | 🔴 High  | ✅ Done |
| 373 | **Implement `handleExploreCommand()` handler.**  | OB-952 | 🔴 High  | ✅ Done |
| 374 | **Implement `handleExploreStatusSubcommand()`.** | OB-953 |  🟡 Med  | ✅ Done |
| 375 | **Unit tests for explore command.**              | OB-954 | 🔴 High  | ✅ Done |

### Phase 50c: Exploration Progress E2E Validation

| #   | Task                                                                   | ID     | Priority | Status  |
| --- | ---------------------------------------------------------------------- | ------ | :------: | :-----: |
| 376 | **Validate `exploration_progress` populated after full explore.**      | OB-960 | 🔴 High  | ✅ Done |
| 377 | **Add exploration_progress assertions to existing coordinator tests.** | OB-961 | 🔴 High  | ✅ Done |
| 378 | **Clean up stuck `agent_activity` rows.**                              | OB-962 |  🟡 Med  | ✅ Done |

### Phase 50d: Incremental Re-Exploration Progress Tracking

| #   | Task                                          | ID     | Priority | Status  |
| --- | --------------------------------------------- | ------ | :------: | :-----: |
| 379 | **Track progress in `reexploreStaleDirs()`.** | OB-970 |  🟡 Med  | ✅ Done |
| 380 | **Track progress for incremental explore.**   | OB-971 |  🟡 Med  | ✅ Done |
| 381 | **Test incremental progress tracking.**       | OB-972 | 🔴 High  | ✅ Done |

### Phase 50e: Verification & Docs

| #   | Task                     | ID     | Priority | Status  |
| --- | ------------------------ | ------ | :------: | :-----: |
| 382 | **Run full test suite.** | OB-980 | 🔴 High  | ✅ Done |
| 383 | **Update FINDINGS.md.**  | OB-981 | 🔴 High  | ✅ Done |
| 384 | **Update TASKS.md.**     | OB-982 | 🔴 High  | ✅ Done |
| 385 | **Update CHANGELOG.md.** | OB-983 |  🟡 Med  | ✅ Done |
