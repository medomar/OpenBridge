# OpenBridge — Task List

> **Pending:** 15 | **In Progress:** 0 | **Done:** 10 (1505 archived)
> **Last Updated:** 2026-03-15

<details>
<summary>Archive (1505 tasks completed across v0.0.1–v0.1.0)</summary>

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
- [Phase 97 — Data Integrity Fixes](archive/v22/TASKS-v22-phase97-data-integrity.md)
- [Sprint 5 + Sprint 6 — Phases 93–101](archive/v23/TASKS-v23-sprint5-sprint6-phases-93-101.md)
- [v0.0.15 — Phases 105–115](archive/v24/TASKS-v24-v015-phases-105-115.md)
- [v0.1.0 Business Platform — Phases 116–127](archive/v25/TASKS-v25-business-platform-phases-116-127.md)

</details>

---

## Task Summary — v0.1.1 (Priority-Sorted)

> Phases ordered by release priority: P0 = release blocker, P1 = must fix, P2 = should fix, P3 = nice to have.
> Findings from real-world testing on elgrotte-data workspace (2026-03-15).

| Pri | Phase | Title                              | Tasks | Findings     | Status      |
| --- | ----- | ---------------------------------- | ----- | ------------ | ----------- |
| P0  | 128   | Workspace Map & State File Fixes   | 5     | OB-F194/F193 | ✅          |
| P0  | 129   | Prompt Budget & Compaction Fixes   | 6     | OB-F197/F192 | In Progress |
| P1  | 130   | Worker Activity Tracking Fixes     | 4     | OB-F196      | Pending     |
| P1  | 131   | Worker Cost Cap & Codex Guardrails | 5     | OB-F195      | Pending     |
| P2  | 132   | Classification Engine Improvements | 5     | OB-F198      | Pending     |

---

## Phase 128 — Workspace Map & State File Fixes ⚡ P0

> **Goal:** Fix workspace-map.json not being created after exploration, and silence ENOENT spam for missing state files. These cause log noise on every message and deprive Master of workspace context.
> **Findings:** OB-F194 (High), OB-F193 (Low)
> **Priority:** P0 — Master operates without workspace map context, WARN logged 15+ times per session.

| #       | Task                                                                                                                                                                                                                                                                                                                                                                                                                                | Finding | Model  | Status  |
| ------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------- | ------ | ------- |
| OB-1506 | In `src/master/dotfolder-manager.ts`, modify `readWorkspaceMap()` to check file existence with `fs.access()` before `fs.readFile()`. If the file doesn't exist, return `null` silently. Add a class-level `workspaceMapWarned = false` flag — only log WARN on the first miss per session, then log DEBUG for subsequent misses. This eliminates the ENOENT spam (15+ WARNs per session).                                           | OB-F194 | sonnet | ✅ Done |
| OB-1507 | In `src/master/exploration-coordinator.ts`, trace the assembly phase output path. After the assembly worker completes, verify that `workspace-map.json` is written to `.openbridge/workspace-map.json`. If the worker output contains the map data but `writeWorkspaceMap()` is never called, add the missing write call. Read both `exploration-coordinator.ts` and `dotfolder-manager.ts` `writeWorkspaceMap()` to trace the gap. | OB-F194 | opus   | ✅ Done |
| OB-1508 | Add a post-exploration assertion in `exploration-coordinator.ts`: after all 5 phases complete, check that `workspace-map.json` exists on disk. If missing, log an ERROR with the exploration summary and attempt to generate a minimal map from the `exploration/` intermediate files (structure-scan.json + classification.json).                                                                                                  | OB-F194 | sonnet | ✅ Done |
| OB-1509 | In `src/master/dotfolder-manager.ts`, apply the same existence-check-before-read pattern to `readBatchState()`, `readPromptManifest()`, and `readLearnings()`. Use `fs.access()` guard and return defaults silently on first run. Log DEBUG instead of WARN for expected first-run ENOENT cases. Verify that the write paths match the read paths for each file.                                                                    | OB-F193 | sonnet | ✅ Done |
| OB-1510 | Add unit test: run exploration on a mock workspace, assert that `workspace-map.json` exists after completion. Add a second test: call `readWorkspaceMap()` when the file is missing, assert it returns `null` without throwing and only logs WARN once. File: `tests/master/workspace-map-persistence.test.ts`.                                                                                                                     | OB-F194 | sonnet | ✅ Done |

---

## Phase 129 — Prompt Budget & Compaction Fixes ⚡ P0

> **Goal:** Fix the 84% prompt truncation by implementing budget-aware prompt assembly, and trigger compaction earlier to prevent prompt bloat. Related to the existing 66% exploration truncation (OB-F192).
> **Findings:** OB-F197 (High), OB-F192 (Medium)
> **Priority:** P0 — Master loses nearly all context when prompt exceeds 32K, severely degrading response quality.

| #       | Task                                                                                                                                                                                                                                                                                                                                                                                                                                                                      | Finding | Model  | Status  |
| ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------- | ------ | ------- |
| OB-1511 | In `src/master/prompt-context-builder.ts`, implement budget-aware prompt assembly. Define section budgets: system prompt (8K chars), memory.md (4K chars), workspace map (4K chars), RAG results (6K chars), conversation history (10K chars) — totaling 32K. Each section must be trimmed to its budget _before_ concatenation. For conversation history, keep the most recent messages when trimming. Log the actual size of each section vs its budget at DEBUG level. | OB-F197 | opus   | ✅ Done |
| OB-1512 | In `src/core/agent-runner.ts`, replace the single `maxLength = 32768` truncation with a graduated approach: log a WARN when any prompt exceeds 80% of the limit (26K chars), and include the caller context (exploration vs message-processing vs worker) in the log. Move the truncation to a named function `truncatePrompt(prompt, maxLength, context)` that logs what was lost.                                                                                       | OB-F197 | sonnet | ✅ Done |
| OB-1513 | In `src/master/session-compactor.ts`, add a prompt-size-based compaction trigger alongside the existing turn-count trigger. When `prompt-context-builder.ts` reports a prompt exceeding 80% of the 32K limit, trigger early compaction regardless of turn count. Add a `promptSizeExceeded` event or callback from the builder to the compactor.                                                                                                                          | OB-F197 | sonnet | ✅ Done |
| OB-1514 | For exploration prompts (OB-F192): in `src/master/exploration-prompts.ts`, split the monolithic exploration prompt into per-phase focused prompts. Each phase prompt should be self-contained and under 16K chars. The assembly phase should receive only the intermediate outputs (structure-scan.json, classification.json, directory dive results) — not the full workspace content. Read the current prompt sizes and measure what each phase actually needs.         | OB-F192 | opus   | ✅ Done |
| OB-1515 | Add a prompt-size metric to `src/core/metrics.ts`: track `prompt_size_chars`, `prompt_size_limit`, `prompt_truncated_pct` per agent run. Expose via the existing metrics endpoint. This enables monitoring prompt budget health over time without parsing logs.                                                                                                                                                                                                           | OB-F197 | sonnet | ✅ Done |
| OB-1516 | Add unit test: build a conversation context with 50 turns of history, assert the assembled prompt is under 32K chars and all sections are present (system prompt, memory, RAG, history). Add a second test: verify that when conversation history is 200K chars, it is trimmed to the 10K budget while keeping the most recent messages. File: `tests/master/prompt-budget.test.ts`.                                                                                      | OB-F197 | sonnet | Pending |

---

## Phase 130 — Worker Activity Tracking Fixes ⚡ P1

> **Goal:** Fix stale `running` status in agent_activity for completed Codex streaming workers, and add startup sweep for orphaned records.
> **Findings:** OB-F196 (Medium)
> **Priority:** P1 — corrupts worker stats, may block concurrency slots.

| #       | Task                                                                                                                                                                                                                                                                                                                                                                                                                                           | Finding | Model  | Status  |
| ------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------- | ------ | ------- |
| OB-1517 | In `src/master/worker-orchestrator.ts`, find the worker completion handler for streaming agents (the Codex/streaming path). Ensure the `finally` block calls `this.memory.updateActivity(workerId, { status: 'done', completed_at: new Date().toISOString() })` for ALL agent types — not just the non-streaming Claude path. Read both the streaming and non-streaming completion paths and verify they converge on the same activity update. | OB-F196 | opus   | Pending |
| OB-1518 | In `src/core/bridge.ts` `start()` method, add a startup sweep after `MemoryManager.init()`: query `agent_activity` for records with `status = 'running'` and `started_at` older than 10 minutes. Update them to `status = 'abandoned'` with a log entry. This cleans up orphans from prior crashes or missed completion callbacks.                                                                                                             | OB-F196 | sonnet | Pending |
| OB-1519 | In `src/memory/activity-store.ts`, add a method `sweepStaleRunning(maxAgeMs: number): number` that updates all `running` records older than `maxAgeMs` to `abandoned` status and returns the count. Add a `completed_at` timestamp set to the sweep time.                                                                                                                                                                                      | OB-F196 | sonnet | Pending |
| OB-1520 | Add unit test: mock a streaming agent (Codex path) that completes with exit code 0, assert that `agent_activity` record transitions from `running` → `done` with a `completed_at` timestamp. Add a second test: create 3 stale `running` records older than 15 minutes, call `sweepStaleRunning(600000)`, assert all 3 are now `abandoned`. File: `tests/master/worker-activity-tracking.test.ts`.                                             | OB-F196 | sonnet | Pending |

---

## Phase 131 — Worker Cost Cap & Codex Guardrails ⚡ P1

> **Goal:** Add per-worker cost caps to prevent a single worker from consuming disproportionate budget, especially for Codex workers which can cost 28x more than Claude workers.
> **Findings:** OB-F195 (Medium)
> **Priority:** P1 — a single runaway Codex worker can double the session cost.

| #       | Task                                                                                                                                                                                                                                                                                                                                                                                                                          | Finding | Model  | Status  |
| ------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------- | ------ | ------- |
| OB-1521 | In `src/types/agent.ts`, add an optional `maxCostUsd?: number` field to the `SpawnOptions` type. Default values: `0.05` for read-only profile, `0.10` for code-edit, `0.15` for full-access. In `src/master/worker-orchestrator.ts`, set `maxCostUsd` on each worker spawn based on the profile. Allow Master spawn markers to override with an explicit cost cap.                                                            | OB-F195 | sonnet | Pending |
| OB-1522 | In `src/core/agent-runner.ts` streaming path (`execStreaming()`), after each chunk that reports cost, check cumulative `costUsd` against `maxCostUsd`. If exceeded, kill the process with SIGTERM, log a WARN with the cost details, and set a `costCapped: true` flag on the result. Return the partial output collected so far.                                                                                             | OB-F195 | opus   | Pending |
| OB-1523 | In `src/core/cost-manager.ts`, add a `checkCostCap(currentCost: number, maxCost: number): boolean` method and a `formatCostWarning(workerId, currentCost, maxCost, model)` helper for consistent cost-cap logging. Track cost-capped events in the existing metrics.                                                                                                                                                          | OB-F195 | sonnet | Pending |
| OB-1524 | In `src/master/worker-orchestrator.ts`, when a worker result has `costCapped: true`, include this in the worker result summary sent back to Master. Add a note like `"[Worker cost-capped at $0.05 — output may be incomplete. Consider narrowing the prompt or using a cheaper model.]"` so Master can adapt its strategy.                                                                                                   | OB-F195 | sonnet | Pending |
| OB-1525 | Add unit test: mock a streaming agent that reports cumulative costs of $0.01, $0.03, $0.06 — assert that the process is killed after the third chunk exceeds the $0.05 cap. Assert the result has `costCapped: true` and contains partial output. Add a second test: verify that a worker with no cost cap (`maxCostUsd: undefined`) runs to completion regardless of cost. File: `tests/core/agent-runner-cost-cap.test.ts`. | OB-F195 | sonnet | Pending |

---

## Phase 132 — Classification Engine Improvements ⚡ P2

> **Goal:** Reduce false-positive keyword matches and improve handling of conversational/planning messages that don't need file access.
> **Findings:** OB-F198 (Low)
> **Priority:** P2 — wastes turns and cost but doesn't break functionality.

| #       | Task                                                                                                                                                                                                                                                                                                                                                                                                                                                                | Finding | Model  | Status  |
| ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------- | ------ | ------- |
| OB-1526 | In `src/master/classification-engine.ts`, add a `conversational` intent category to the keyword map. Messages containing patterns like "how can I", "can you explain", "I want to know", "what about", "is it possible", "let's configure", "not yet" should match `quick-answer` with 3–5 max turns instead of falling through to `tool-use` default. Add these as a new keyword group with priority above the fallback.                                           | OB-F198 | sonnet | Pending |
| OB-1527 | In `src/master/classification-engine.ts`, tighten the `batch-mode` keyword matcher. Currently "command" or "batch" alone can trigger it — require compound patterns like "batch process", "batch run", "run batch", "bon de commande" (exact phrase), "batch of". Avoid false positives from voice transcription where "command" appears in conversational context (e.g., "bon de commande" is a French business document, not a batch command).                    | OB-F198 | sonnet | Pending |
| OB-1528 | In `src/master/classification-engine.ts`, when the AI classifier returns a classification result (even with moderate confidence ≥ 0.4), prefer it over keyword fallback. Currently keyword fallback can override the AI classifier's result. Change the priority: AI classifier (confidence ≥ 0.4) > keyword match > default fallback. Log which source won when there's a conflict.                                                                                | OB-F198 | opus   | Pending |
| OB-1529 | Change the default keyword fallback from `tool-use` (15 max turns) to `quick-answer` (5 max turns). Rationale: if neither the AI classifier nor keyword matching can determine intent, the message is likely conversational. A `quick-answer` with 5 turns is sufficient for clarification, and costs 3x less than a `tool-use` with 15 turns. If the quick-answer agent determines it needs file access, it can say so and the user can re-send with more context. | OB-F198 | sonnet | Pending |
| OB-1530 | Add unit tests for classification improvements: (1) "I want to know if I can add a worker" → `quick-answer`, (2) "normally know about the sub-companies and about the stock" → NOT `batch-mode`, (3) "run a batch process on all files" → `batch-mode` (true positive), (4) AI classifier returns `quick-answer` at confidence 0.5 but keyword matches `tool-use` → `quick-answer` wins. File: `tests/master/classification-improvements.test.ts`.                  | OB-F198 | sonnet | Pending |
