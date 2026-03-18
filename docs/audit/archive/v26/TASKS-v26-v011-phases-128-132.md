# OpenBridge — Archived Tasks v26

> **Version:** v0.1.1
> **Phases:** 128–132
> **Tasks:** 25 completed
> **Period:** 2026-03-15
> **Focus:** Real-world testing fixes — workspace map persistence, prompt budget, worker activity tracking, cost caps, classification improvements

---

## Phase 128 — Workspace Map & State File Fixes ⚡ P0

> **Goal:** Fix workspace-map.json not being created after exploration, and silence ENOENT spam for missing state files.
> **Findings:** OB-F194 (High), OB-F193 (Low)

| #       | Task                                                                                                                                                                                                                                  | Finding | Model  | Status  |
| ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------- | ------ | ------- |
| OB-1506 | In `dotfolder-manager.ts`, modify `readWorkspaceMap()` to check file existence with `fs.access()` before `fs.readFile()`. Return `null` silently if missing. Add `workspaceMapWarned` flag — only log WARN on first miss, then DEBUG. | OB-F194 | sonnet | ✅ Done |
| OB-1507 | In `exploration-coordinator.ts`, trace assembly phase output. Verify `workspace-map.json` is written after assembly worker completes. Add missing write call if needed.                                                               | OB-F194 | opus   | ✅ Done |
| OB-1508 | Add post-exploration assertion: after all 5 phases complete, check `workspace-map.json` exists. If missing, generate minimal map from intermediate files.                                                                             | OB-F194 | sonnet | ✅ Done |
| OB-1509 | Apply existence-check-before-read pattern to `readBatchState()`, `readPromptManifest()`, `readLearnings()`. Use `fs.access()` guard, return defaults silently on first run.                                                           | OB-F193 | sonnet | ✅ Done |
| OB-1510 | Unit tests: exploration writes `workspace-map.json`; `readWorkspaceMap()` returns `null` without throwing; WARN logged only once.                                                                                                     | OB-F194 | sonnet | ✅ Done |

---

## Phase 129 — Prompt Budget & Compaction Fixes ⚡ P0

> **Goal:** Fix 84% prompt truncation by implementing budget-aware prompt assembly and earlier compaction triggers.
> **Findings:** OB-F197 (High), OB-F192 (Medium)

| #       | Task                                                                                                                                                                     | Finding | Model  | Status  |
| ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------- | ------ | ------- |
| OB-1511 | Budget-aware prompt assembly in `prompt-context-builder.ts`. Section budgets: system (8K), memory.md (4K), workspace map (4K), RAG (6K), conversation (10K) = 32K total. | OB-F197 | opus   | ✅ Done |
| OB-1512 | Graduated prompt truncation in `agent-runner.ts`. Named `truncatePrompt()` function, WARN at 80% of limit, caller context in logs.                                       | OB-F197 | sonnet | ✅ Done |
| OB-1513 | Prompt-size-based compaction trigger in `session-compactor.ts`. `notifyPromptSize()` fires early compaction when prompt exceeds 80% of 32K limit.                        | OB-F197 | sonnet | ✅ Done |
| OB-1514 | Exploration prompt budget in `exploration-prompts.ts`. Per-phase 16K char budget, `trimPayload()` utility, slim workspace map for incremental prompts.                   | OB-F192 | opus   | ✅ Done |
| OB-1515 | Prompt-size metrics in `metrics.ts`. Track `runs`, `truncatedRuns`, `lastChars`, `maxChars`, `avgChars` per agent run.                                                   | OB-F197 | sonnet | ✅ Done |
| OB-1516 | Unit tests: 50-turn history stays under 32K; 200K conversation trimmed to 10K keeping recent messages.                                                                   | OB-F197 | sonnet | ✅ Done |

---

## Phase 130 — Worker Activity Tracking Fixes ⚡ P1

> **Goal:** Fix stale `running` status for completed Codex streaming workers, add startup sweep for orphaned records.
> **Findings:** OB-F196 (Medium)

| #       | Task                                                                                                                                               | Finding | Model  | Status  |
| ------- | -------------------------------------------------------------------------------------------------------------------------------------------------- | ------- | ------ | ------- |
| OB-1517 | Safety-net in `worker-orchestrator.ts` `finally` block: ensure `agent_activity` always transitions out of `running`. Track `activityUpdated` flag. | OB-F196 | opus   | ✅ Done |
| OB-1518 | Startup sweep in `bridge.ts`: query stale `running` records (>10 min old), update to `abandoned`.                                                  | OB-F196 | sonnet | ✅ Done |
| OB-1519 | `sweepStaleRunning(maxAgeMs)` method in `activity-store.ts`. Returns count of updated rows. Added `'abandoned'` status.                            | OB-F196 | sonnet | ✅ Done |
| OB-1520 | Unit tests: streaming agent → `done` with `completed_at`; 3 stale records swept to `abandoned`; fresh records untouched.                           | OB-F196 | sonnet | ✅ Done |

---

## Phase 131 — Worker Cost Cap & Codex Guardrails ⚡ P1

> **Goal:** Per-worker cost caps to prevent runaway Codex workers ($0.28 single worker).
> **Findings:** OB-F195 (Medium)

| #       | Task                                                                                                                                           | Finding | Model  | Status  |
| ------- | ---------------------------------------------------------------------------------------------------------------------------------------------- | ------- | ------ | ------- |
| OB-1521 | `maxCostUsd` field in `SpawnOptions` + per-profile defaults in `worker-orchestrator.ts` (read-only $0.05, code-edit $0.10, full-access $0.15). | OB-F195 | sonnet | ✅ Done |
| OB-1522 | Cost enforcement in streaming paths: kill process with SIGTERM when cost exceeds cap, return partial result with `costCapped: true`.           | OB-F195 | opus   | ✅ Done |
| OB-1523 | `checkCostCap()` and `formatCostWarning()` helpers in `cost-manager.ts`. Cost-capped event tracking in metrics.                                | OB-F195 | sonnet | ✅ Done |
| OB-1524 | Cost-cap advisory in `worker-result-formatter.ts`: "[Worker cost-capped at $X — output may be incomplete]" in Master summary.                  | OB-F195 | sonnet | ✅ Done |
| OB-1525 | Unit tests: cost cap triggered on third chunk → SIGTERM + `costCapped: true`; no cap → runs to completion.                                     | OB-F195 | sonnet | ✅ Done |

---

## Phase 132 — Classification Engine Improvements ⚡ P2

> **Goal:** Reduce false-positive keyword matches, improve conversational message handling.
> **Findings:** OB-F198 (Low)

| #       | Task                                                                                                                                       | Finding | Model  | Status  |
| ------- | ------------------------------------------------------------------------------------------------------------------------------------------ | ------- | ------ | ------- |
| OB-1526 | Conversational intent patterns in `classification-engine.ts`: "how can I", "can you explain", etc. → `quick-answer`.                       | OB-F198 | sonnet | ✅ Done |
| OB-1527 | Tighten `batch-mode` matcher: require compound patterns ("batch process", "run batch"), exclude "bon de commande" false positive.          | OB-F198 | sonnet | ✅ Done |
| OB-1528 | AI classifier priority: confidence ≥ 0.4 beats keyword fallback. Log conflicts between AI and keyword sources.                             | OB-F198 | opus   | ✅ Done |
| OB-1529 | Default keyword fallback changed from `tool-use` (15 turns) to `quick-answer` (5 turns).                                                   | OB-F198 | sonnet | ✅ Done |
| OB-1530 | Unit tests (18 tests): conversational → quick-answer; batch false positives blocked; batch true positives pass; AI priority over keywords. | OB-F198 | sonnet | ✅ Done |
