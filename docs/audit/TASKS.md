# OpenBridge — Task List

> **Pending:** 50 tasks | **In Progress:** 0
> **Last Updated:** 2026-02-26
> **Execution order:** Phase 47 → 48 → 46 → 49 → 45 (docs last — reflects all code changes)
> **Completed work:** [V0 (Phases 1–5)](archive/v0/TASKS-v0.md) | [V1 (Phases 6–10)](archive/v1/TASKS-v1.md) | [V2 (Phases 11–14)](archive/v2/TASKS-v2.md) | [MVP (Phase 15)](archive/v3/TASKS-v3-mvp.md) | [Self-Governing (Phases 16–21)](archive/v4/TASKS-v4-self-governing.md) | [E2E + Channels (Phases 22–24)](archive/v5/TASKS-v5-e2e-channels.md) | [Smart Orchestration (Phases 25–28)](archive/v6/TASKS-v6-smart-orchestration.md) | [AI Classification (Phase 29)](archive/v7/TASKS-v7-ai-classification.md) | [Production Readiness (Phase 30)](archive/v8/TASKS-v8-production-readiness.md) | [Memory + Scale (Phases 31–38)](archive/v9/TASKS-v9-memory-scale.md) | [Memory Wiring (Phase 40)](archive/v10/TASKS-v10-memory-wiring.md) | [Memory Fixes (Phases 41–44)](archive/v11/TASKS-v11-memory-fixes.md)

---

## ① Phase 47: Exploration Progress Tracking Fix _(v0.0.2 — do first)_

> **Bug:** `exploration_progress` table is always empty because `explorationId` is never passed to `ExplorationCoordinator`. This breaks the `/status` command's exploration progress display and prevents any historical tracking of exploration phases. See [OB-F23](FINDINGS.md).
>
> **Why first:** Standalone 2-line fix + tests. No dependencies. Unblocks `/status` visibility for all subsequent phases.

| #   | Task                                                                                                                                                                                                                                                                                                                  | ID     | Priority |  Status   |
| --- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ | :------: | :-------: |
| 339 | **Create `agent_activity` row (type `explorer`) in `masterDrivenExplore()`.** Before creating `ExplorationCoordinator`, generate a UUID, call `memory.insertActivity({ id, type: 'explorer', status: 'running', ... })`. Pass the ID as `explorationId` option. Update to `done`/`failed` when exploration completes. | OB-890 | 🔴 High  |  ✅ Done  |
| 340 | **Create `agent_activity` row in `incrementalExplore()` stale dir re-exploration.** Same pattern as task 339 but for the `reexploreStaleDirs()` call path. Create explorer activity before coordinator, pass `explorationId`, update status on completion.                                                            | OB-891 | 🔴 High  |  ✅ Done  |
| 341 | **Verify `insertPhaseRow()` / `completePhaseRow()` / `failPhaseRow()` work end-to-end.** With `explorationId` now set, confirm that `exploration_progress` rows are created for each of the 5 phases (structure_scan, classification, directory_dives, assembly, finalization) during a full exploration.             | OB-892 | 🔴 High  |  ✅ Done  |
| 342 | **Verify directory-level progress rows are created.** Confirm that each directory dive creates an `exploration_progress` row with `phase='directory-dive'`, `target=<dir>`, and that `progress_pct` updates from 0→100 as the dive completes.                                                                         | OB-893 | 🔴 High  | ◻ Pending |
| 343 | **Verify `/status` command shows exploration progress.** Run the bridge, trigger exploration, send `status` command via Console connector. Confirm the response includes the exploration progress table (phases, directories, percentages).                                                                           | OB-894 | 🔴 High  | ◻ Pending |
| 344 | **Integration test: exploration_progress populated after explore().** Create `tests/integration/exploration-progress.test.ts`. Use in-memory SQLite + mock AgentRunner. Call `coordinator.explore()` with an `explorationId`. Assert `exploration_progress` table has rows for all phases and directories.            | OB-895 | 🔴 High  | ◻ Pending |
| 345 | **Regression guard: add assertion to existing exploration tests.** In `tests/master/exploration-coordinator.test.ts`, add assertions that when `memory` and `explorationId` are provided, `insertExplorationProgress` is called. This prevents future regressions.                                                    | OB-896 |  🟡 Med  | ◻ Pending |

---

## ② Phase 48: Worker Resilience — Max-Turns + Failure Recovery _(v0.0.2 — after Phase 47)_

> **Two bugs:** (1) Workers that hit max-turns exit with code 0 — Master treats incomplete work as success. No retry, no detection, no turn-budget warning. (2) Workers that fail due to auth errors, rate limits, or crashes default to `retries: 0` and are never re-tried or delegated. See [OB-F24](FINDINGS.md) and [OB-F25](FINDINGS.md).
>
> **Why second:** Core reliability fix. Every feature after this (worker control, responsive Master) benefits from resilient workers. Error classification from OB-904 is reused by Phase 46's stop command formatting.

### Phase 48a: Max-Turns Detection & Adaptive Budget

| #   | Task                                                                                                                                                                                                                                                                                                     | ID     | Priority |  Status   |
| --- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ | :------: | :-------: |
| 346 | **Detect max-turns exhaustion in worker output.** In `master-manager.ts` `processWorkerResult()`, scan worker stdout for Claude CLI's max-turns indicator (e.g., `"max turns reached"`, `"turn limit"`). Add a `turnsExhausted: boolean` flag to `AgentResult`.                                          | OB-900 | 🔴 High  | ◻ Pending |
| 347 | **Add turn-budget warning to worker system prompt injection.** In `master-system-prompt.ts` worker instructions, tell the Master to include in SPAWN marker prompts: "You have N turns. If you cannot finish, output `[INCOMPLETE: step X/Y]` so the system can retry with a higher budget."             | OB-901 | 🔴 High  | ◻ Pending |
| 348 | **Adaptive max-turns based on prompt length.** In `spawnWorker()`, compute `maxTurns = baselineTurns + Math.ceil(promptLength / 1000)` capped at 50. Override only if the SPAWN marker didn't explicitly set `maxTurns`. Log the computed value.                                                         | OB-902 |  🟡 Med  | ◻ Pending |
| 349 | **Auto-retry on max-turns exhaustion.** When `turnsExhausted=true` and retry budget allows, re-spawn the worker with `maxTurns * 1.5` (rounded up). Inject the partial output as context in the retry prompt: "Previous attempt completed X steps. Continue from step X+1." Max 1 turn-escalation retry. | OB-903 | 🔴 High  | ◻ Pending |

### Phase 48b: Worker Failure Classification & Recovery

| #   | Task                                                                                                                                                                                                                                                                                                                                                                 | ID     | Priority  |  Status   |
| --- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ | :-------: | :-------: | ------------------ | ------------------------------------------------------------------------------------------- | ------ | ------- | --------- |
| 350 | **Classify worker exit errors.** In `agent-runner.ts`, add `classifyError(stderr, exitCode): ErrorCategory` returning `'rate-limit'                                                                                                                                                                                                                                  | 'auth' | 'timeout' |  'crash'  | 'context-overflow' | 'unknown'`. Use stderr pattern matching (already partially exists in `isRateLimitError()`). | OB-904 | 🔴 High | ◻ Pending |
| 351 | **Change default retries from 0 to 2 for workers.** In `master-manager.ts` `spawnWorker()`, set `retries = body.retries ?? 2` (was `?? 0`). Update `master-system-prompt.ts` to document the default. Only retry on `rate-limit`, `timeout`, and `crash` categories — not `auth` or `context-overflow`.                                                              | OB-905 |  🔴 High  | ◻ Pending |
| 352 | **Master-driven worker re-delegation.** When a worker fails after exhausting retries, format the failure as `[WORKER FAILED: <category>]` in Master's context. Update Master system prompt to instruct: "If a worker fails with rate-limit, retry with a different model. If auth error, report to user. If context-overflow, split the task into smaller subtasks." | OB-906 |  🟡 Med   | ◻ Pending |
| 353 | **Record worker failure patterns in learnings table.** After each worker failure, call `memory.recordLearning({ task_type, model, success: false })`. Query learnings before spawning: if a model has >50% failure rate for a task type, prefer a different model.                                                                                                   | OB-907 |  🟡 Med   | ◻ Pending |

### Phase 48c: Tests & Verification

| #   | Task                                                                                                                                                                                                         | ID     | Priority |  Status   |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------ | :------: | :-------: |
| 354 | **Unit tests for error classification.** Test `classifyError()` correctly categorizes rate-limit, auth, timeout, crash, context-overflow, and unknown errors. Test with real stderr samples from Claude CLI. | OB-908 | 🔴 High  | ◻ Pending |
| 355 | **Unit tests for adaptive max-turns.** Test that prompt length scaling works. Test that explicit SPAWN marker maxTurns overrides adaptive. Test the 50-turn cap.                                             | OB-909 | 🔴 High  | ◻ Pending |
| 356 | **Integration test for worker retry on failure.** Mock a worker that fails once then succeeds. Verify retry fires, verify learnings updated, verify Master receives the successful result.                   | OB-910 | 🔴 High  | ◻ Pending |
| 357 | **Verify all tests pass.** Run `npm run lint && npm run typecheck && npm test && npm run build`.                                                                                                             | OB-911 | 🔴 High  | ◻ Pending |

---

## ③ Phase 46: Worker Control Commands _(v0.1.1 — after Phase 48)_

> Give users the ability to see real-time worker details, stop individual workers by ID, or emergency-stop all workers — from any channel (WebChat, WhatsApp, Telegram, Discord, Console). Currently `WorkerRegistry.markCancelled()` exists but is never called from user-facing code, and worker PIDs are set to -1 (not captured). This phase captures real PIDs, adds kill mechanisms, stop commands, WebChat stop buttons, and cross-channel broadcast.
>
> **Why third:** Builds on Phase 48's error classification (`classifyError()` reused in stop response formatting). PID capture (OB-873) pairs naturally with the worker retry infrastructure.

### Phase 46a: Worker Kill Infrastructure

| #   | Task                                                                                                                                                                                                                                                                                                                                                                                                                                    | ID     | Priority |  Status   |
| --- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ | :------: | :-------: |
| 322 | **Expose ChildProcess handle from `execOnce()`.** In `src/core/agent-runner.ts`, change `execOnce()` to return `{ promise, pid, kill }` instead of a bare `Promise`. The `child.pid` is available after `nodeSpawn()` but is never returned to the caller. Follow the same pattern as `execOnceStreaming()` which already returns `{ chunks, abort }`.                                                                                  | OB-871 | 🔴 High  | ◻ Pending |
| 323 | **Add `spawnWithHandle()` to AgentRunner.** New method returning `{ promise: Promise<AgentResult>, pid: number, abort: () => void }`. Wraps existing `spawn()` logic but exposes the PID and an abort function (SIGTERM → 5s grace period → SIGKILL). Keep `spawn()` unchanged for backward compatibility.                                                                                                                              | OB-872 | 🔴 High  | ◻ Pending |
| 324 | **Capture real PID in `MasterManager.spawnWorker()`.** Replace `this.workerRegistry.markRunning(workerId, -1)` with the actual PID from `spawnWithHandle()`. Store the `abort` function handle in `private workerAbortHandles: Map<string, () => void>`. Update `agent_activity` record with real PID.                                                                                                                                  | OB-873 | 🔴 High  | ◻ Pending |
| 325 | **Add `killWorker()` and `killAllWorkers()` to MasterManager.** `killWorker(workerId)`: retrieve abort handle from map, call it, mark worker as cancelled in both `WorkerRegistry` (`markCancelled()`) and `agent_activity` (`memory.updateActivity()`). `killAllWorkers()`: iterate all running workers and call `killWorker()` for each. Handle edge cases: worker already finished, invalid ID, no workers running, PID -1 (legacy). | OB-874 | 🔴 High  | ◻ Pending |
| 326 | **Add PID column to `agent_activity` table.** In `src/memory/database.ts`, add `pid INTEGER` column. In `src/memory/activity-store.ts`, update `insertActivity()` and `updateActivity()` to support the new column. Add `ActivityRecord.pid?: number`. Write a migration in `src/memory/migration.ts` that runs `ALTER TABLE agent_activity ADD COLUMN pid INTEGER`.                                                                    | OB-875 |  🟡 Med  | ◻ Pending |
| 327 | **Unit tests for worker kill infrastructure.** Test `spawnWithHandle()` returns a valid PID. Test `abort()` sends SIGTERM then SIGKILL. Test `killWorker()` marks the worker as cancelled. Test `killAllWorkers()` stops all running workers. Test edge cases: kill already-finished worker, kill with invalid ID, kill when no workers running.                                                                                        | OB-876 | 🔴 High  | ◻ Pending |

### Phase 46b: Stop Command Handling

| #   | Task                                                                                                                                                                                                                                                                                                                                                                                                                              | ID     | Priority |  Status   |
| --- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ | :------: | :-------: |
| 328 | **Add `handleStopCommand()` to Router.** Follow the exact pattern of `handleStatusCommand()`. Parse message content: `"stop"` or `"stop all"` → `killAllWorkers()`, `"stop <id>"` → `killWorker(id)`. Intercept in `route()` before Master AI routing (same as existing `status` check). Support partial worker ID matching (e.g., `stop w8f3` matches `worker-1708123456789-w8f3`).                                              | OB-877 | 🔴 High  | ◻ Pending |
| 329 | **Add access control for stop command.** In `src/core/auth.ts`, add `'stop'` to the action classification. Update `ROLE_ALLOWED_ACTIONS` to allow stop for `owner` and `admin` only (not developer or viewer). In `handleStopCommand()`, call `auth.checkAccessControl(sender, channel, 'stop')` before executing the kill. Return a permission-denied message if the user lacks the `stop` action.                               | OB-878 | 🔴 High  | ◻ Pending |
| 330 | **Add confirmation flow for `stop all`.** When a user sends `"stop all"`, reply with "This will terminate N running workers. Reply 'confirm' within 30 seconds to proceed." Store a pending confirmation in a `Map<string, { action, expiresAt }>` keyed by sender. If the user replies "confirm" within the timeout, execute the kill. Single-worker stops (`stop <id>`) do NOT require confirmation — they execute immediately. | OB-879 |  🟡 Med  | ◻ Pending |
| 331 | **Format stop command responses.** `killWorker()` returns: "Stopped worker w8f3 (sonnet, 'Fix auth bug', 45s)". `killAllWorkers()` returns: "Stopped 3 workers:\n- w8f3 (sonnet, 'Fix auth bug', 45s)\n..." Handle zero workers: "No workers are currently running." Handle already-finished: "Worker w8f3 has already completed."                                                                                                | OB-880 |  🟡 Med  | ◻ Pending |
| 332 | **Unit tests for stop command handling.** Test router intercepts "stop", "stop all", "stop w8f3". Test access control blocks viewer/developer from stopping. Test confirmation flow for "stop all" (confirm within timeout, timeout expiry, cancel). Test response formatting. Test partial ID matching.                                                                                                                          | OB-881 | 🔴 High  | ◻ Pending |

### Phase 46c: UI, Broadcast & Integration

| #   | Task                                                                                                                                                                                                                                                                                                                                                                                                                                               | ID     | Priority |  Status   |
| --- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ | :------: | :-------: |
| 333 | **Add stop buttons to WebChat dashboard.** In `src/connectors/webchat/webchat-connector.ts`, update the dashboard to add a red "X" button next to each worker row and a "Stop All" button in the header. When clicked, send WS message `{ type: 'stop-worker', workerId }` or `{ type: 'stop-all' }`. Handle the WS message server-side by calling `masterManager.killWorker(id)` or `killAllWorkers()`. Send the result back as a system message. | OB-882 |  🟡 Med  | ◻ Pending |
| 334 | **Broadcast worker stop events to all channels.** Add `'worker-cancelled'` to the `ProgressEvent` discriminated union in `src/types/message.ts`. When any worker is killed, broadcast via `router.broadcastProgress()`. Each connector's progress handler displays: "Worker w8f3 was stopped by <user>." This ensures all channels stay in sync.                                                                                                   | OB-883 |  🟡 Med  | ◻ Pending |
| 335 | **Notify Master AI on worker kill.** When a worker is killed by the user, inject a worker result into the Master's session: "Worker <id> was CANCELLED by user <sender>. Task: <summary>. Do NOT retry this task unless the user asks." This prevents the Master from re-spawning the killed worker.                                                                                                                                               | OB-884 | 🔴 High  | ◻ Pending |
| 336 | **Integration test for stop command flow.** Create `tests/integration/stop-command.test.ts`: start Bridge with mock agent runner, trigger "stop" via console connector, verify worker process receives SIGTERM, verify WorkerRegistry marks cancelled, verify agent_activity updated in DB, verify response sent back to connector.                                                                                                                | OB-885 | 🔴 High  | ◻ Pending |
| 337 | **E2E test for stop all with confirmation.** Create `tests/e2e/stop-all.test.ts`: spawn 3 mock workers, send "stop all" via console, verify confirmation prompt, send "confirm", verify all 3 workers cancelled, verify broadcast notification to all connectors.                                                                                                                                                                                  | OB-886 | 🔴 High  | ◻ Pending |
| 338 | **Verify all tests pass.** Run `npm run lint && npm run typecheck && npm test && npm run build`. Fix any regressions. Ensure test count is at or above 1807 + new tests from Phase 46. All CI checks must pass.                                                                                                                                                                                                                                    | OB-887 | 🔴 High  | ◻ Pending |

---

## ④ Phase 49: Responsive Master — Message Handling During Processing _(v0.2.0 — after Phase 48)_

> **Problem:** When Master AI is busy processing a complex task (spawning workers, waiting for results), subsequent user messages are queued with no meaningful response. Users wait minutes for simple questions. No queue visibility, no prioritization, no delegation to a fast-path responder.
>
> **Why fourth:** Depends on Phase 48's worker resilience — fast-path responder agents need the same error classification and retry logic. Also benefits from Phase 46's PID capture (fast-path agents need killable handles).

| #   | Task                                                                                                                                                                                                                                                                                                                                                      | ID     | Priority |  Status   |
| --- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ | :------: | :-------: |
| 358 | **Add queue depth + wait time to queued message acknowledgment.** When a message is queued because Master is busy, include queue position and estimated wait: "You're #2 in queue (~30s). I'll get to your message shortly." Base estimate on rolling average of recent message processing times.                                                         | OB-920 | 🔴 High  | ◻ Pending |
| 359 | **Implement message priority classification.** In `router.ts`, before queuing, classify messages: `quick-answer` (status, list, "what is", simple questions) → priority 1, `tool-use` (generate, create, fix) → priority 2, `complex-task` (implement, refactor, multi-step) → priority 3. Quick-answer messages jump ahead in queue.                     | OB-921 | 🔴 High  | ◻ Pending |
| 360 | **Add "fast-path" responder for quick-answer messages during Master processing.** When Master is in `processing` state and a `quick-answer` message arrives, spawn a lightweight `claude --print` call (read-only profile, maxTurns=3) with workspace context from cached `workspaceMapSummary`. Return the response directly without waiting for Master. | OB-922 | 🔴 High  | ◻ Pending |
| 361 | **Expose processing state to users.** Extend the `status` command to show: current task being processed, queue depth per user, estimated completion time, and active worker count. Format for all channels.                                                                                                                                               | OB-923 |  🟡 Med  | ◻ Pending |
| 362 | **Sub-master delegation for concurrent queries (v0.4.0 prep).** Add `FastPathResponder` class that manages a pool of short-lived agent sessions for quick answers. Shares the workspace map and context chunks (read-only DB access). Configurable max concurrent fast-path agents (default: 2).                                                          | OB-924 |  🟡 Med  | ◻ Pending |
| 363 | **Tests for responsive Master.** Test priority queue ordering. Test fast-path responder returns answers during Master processing. Test queue depth reporting. Test that fast-path doesn't interfere with Master session.                                                                                                                                  | OB-925 | 🔴 High  | ◻ Pending |

---

## ⑤ Phase 45: Documentation Audit _(v0.0.2-post — do last)_

> Align every documentation file with the real codebase state. This phase runs **after all code phases** (47, 48, 46, 49) so that documentation reflects the final state of the codebase including exploration progress fix, worker resilience, worker control, and responsive Master.
>
> **Why last:** Every code phase above changes files that docs reference (ROADMAP, CLAUDE.md, OVERVIEW, CHANGELOG, milestone specs). Doing docs first would require re-doing them after each code phase. One pass at the end captures everything.

| #   | Task                                                                                                                                                                                                                                                                                                                                     | ID     | Priority |  Status   |
| --- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ | :------: | :-------: |
| 311 | **Update ROADMAP.md.** Fix task/phase counts. Move completed OB-IDs from "Planned" to "Released." Add all new phases. Update dependency graph and version milestones.                                                                                                                                                                    | OB-860 | 🔴 High  | ◻ Pending |
| 312 | **Update TASKS.md header and backlog.** Update header summary to reflect total completed tasks. Verify all archive links point to correct files. Ensure execution order reflects final state.                                                                                                                                            | OB-861 | 🔴 High  | ◻ Pending |
| 313 | **Update OVERVIEW.md.** Remove all references to `.openbridge/.git` (replaced by SQLite). Add memory system description (SQLite + FTS5, worker briefings). Update `.openbridge/` folder contents to show `openbridge.db` instead of JSON files. Update "How the Master Governs Workers" section to mention worker briefings from memory. | OB-862 | 🔴 High  | ◻ Pending |
| 314 | **Create HEALTH.md.** No current `docs/audit/HEALTH.md` exists — only an archived v4 at score 7.050. Create a fresh HEALTH.md with updated scoring reflecting all completed work.                                                                                                                                                        | OB-863 | 🔴 High  | ◻ Pending |
| 315 | **Update CHANGELOG.md.** Fill empty `[Unreleased]` section with all features shipped since v0.0.1: SQLite memory, media support, SHARE/VOICE markers, file server, email sender, GitHub Pages publisher, access control, agent dashboard, exploration progress fix, worker resilience, worker control, responsive Master.                | OB-864 | 🔴 High  | ◻ Pending |
| 316 | **Update CLAUDE.md (both workspace root and OpenBridge/).** Add missing modules, fix LOC counts, update test counts, update "Current Development Focus" section to reflect post-Phase 49 state.                                                                                                                                          | OB-865 | 🔴 High  | ◻ Pending |
| 317 | **Update MEMORY.md.** Fix task/test counts. Mark all shipped systems. Update phase statuses. Update architecture section.                                                                                                                                                                                                                | OB-866 | 🔴 High  | ◻ Pending |
| 318 | **Audit milestone specs.** Update `v0.1.0-memory-system.md`, `v0.2.0-smart-system.md`, `v0.3.0-visibility.md`, `v0.4.0-scale.md`. Mark shipped items. Redraw milestone boundaries if needed.                                                                                                                                             | OB-867 |  🟡 Med  | ◻ Pending |
| 319 | **Audit FINDINGS.md.** Verify open/fixed counts are accurate. Check if any new bugs were introduced during Phases 46–49. Update "Last Audit" date.                                                                                                                                                                                       | OB-868 |  🟡 Med  | ◻ Pending |
| 320 | **Cross-reference code vs docs for gaps.** Run through every file in `src/` and verify it has a corresponding mention in at least one documentation file. Check for dead code references in docs. Verify all config options match Zod schemas.                                                                                           | OB-869 |  🟡 Med  | ◻ Pending |
| 321 | **Verify tests pass after documentation changes.** Run `npm run lint && npm run typecheck && npm test && npm run build`. No code changes in this phase — confirm all tests green. All CI checks must pass.                                                                                                                               | OB-870 | 🔴 High  | ◻ Pending |

---

## Status Legend

|  Status   | Description               |
| :-------: | ------------------------- |
|  ✅ Done  | Completed and verified    |
| 🔄 Active | Currently being worked on |
| ◻ Pending | Not started               |

---

## Execution Order Rationale

```
① Phase 47: Exploration Progress Fix (7 tasks)
   No deps. Quick bug fix. Unblocks /status visibility.
       ↓
② Phase 48: Worker Resilience (12 tasks)
   No deps. Core reliability. Error classification reused by Phase 46.
       ↓
③ Phase 46: Worker Control (17 tasks)
   Benefits from Phase 48's classifyError() + retry infra.
   PID capture pairs with worker resilience work.
       ↓
④ Phase 49: Responsive Master (6 tasks)
   Depends on Phase 48 (fast-path agents need resilient spawning).
   Benefits from Phase 46 (killable handles for fast-path agents).
       ↓
⑤ Phase 45: Documentation Audit (11 tasks)
   LAST — one clean pass capturing all code changes from 47→48→46→49.
   Avoids re-doing docs after each code phase.
```

---

## Backlog — Unscheduled

| Task                                                                      | ID     | Priority |
| ------------------------------------------------------------------------- | ------ | :------: |
| Migrate audit-logger.ts to SQLite (create audit_log table)                | OB-820 |  🟡 Med  |
| Add DB schema versioning (migration table with version number)            | OB-821 |  🟡 Med  |
| Conversation context injection from DB (replace buildConversationContext) | OB-822 |  🟡 Med  |
| Worker streaming progress — real-time turn count visibility               | OB-930 |  🟡 Med  |
| Session checkpointing — pause/resume Master for priority interrupts       | OB-931 |  🟡 Med  |
