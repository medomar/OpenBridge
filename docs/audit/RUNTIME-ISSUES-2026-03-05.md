# Runtime Issues — 2026-03-05 Telegram Session

**Source:** Production logs from Telegram channel session (PID 11034, 17:35–23:28)
**Findings:** OB-F95 through OB-F107 (13 new findings)
**Priority:** Fix before v0.0.12 release

---

## OB-F95 — Worker re-spawn crash after tool escalation grant (🔴 Critical)

**Problem:** When a user grants `/allow` for a worker, `respawnWorkerAfterGrant()` creates an escalated worker ID (`-escalated` suffix) but does NOT register it in `WorkerRegistry` before spawning. When the spawn fails or completes, `markFailed()` throws because the worker doesn't exist.

**Observed in logs:**

```
[17:48:39.527] Worker re-spawned with merged tool access after grant
    originalWorkerId: "worker-1772642884736-91w50p"
    newWorkerId: "worker-1772642884736-91w50p-escalated"

[17:48:39.664] WARN Worker re-spawn after tool grant failed
    err: Error: Worker worker-1772642884736-91w50p-escalated not found in registry
        at WorkerRegistry.markFailed (worker-registry.ts:205)
        at MasterManager.spawnWorker (master-manager.ts:7490)
```

**Impact:** Tool escalation grants silently fail — the user approves elevated permissions, but the worker never actually runs. The user gets no feedback that their approval was wasted.

**Proposed solution:**

1. In `respawnWorkerAfterGrant()` (`master-manager.ts:~6782`), call `WorkerRegistry.register()` for the new escalated worker ID BEFORE calling `spawnWorker()`
2. Alternatively, reuse the original worker ID instead of creating a `-escalated` suffix
3. Add error handling so if re-spawn fails, the user gets a message like "Worker re-spawn failed, please try again"
4. Add test: grant escalation → verify worker is registered → verify worker executes

**Key files:** `src/master/master-manager.ts` (lines ~6782, ~6972, ~7490), `src/master/worker-registry.ts` (line ~205)

**Scope:** ~3–5 tasks

---

## OB-F96 — Escalation state cleared before all workers are granted (🟠 High)

**Problem:** When multiple workers request tool escalation simultaneously, the user's `/allow` response consumes the escalation for one worker, but subsequent `/allow` attempts get `Allow: no pending escalation`. The escalation queue doesn't handle batched escalation requests properly.

**Observed in logs:**

```
[17:48:05] Tool escalation prompt sent to user (3 workers)
[17:48:39] /allow granted for worker-91w50p (but re-spawn crashed — OB-F95)
[17:48:44] Allow: no pending escalation  ← user tried to allow another worker
[17:51:32] Allow: no pending escalation  ← user tried again
```

**Impact:** When Master spawns 3 workers needing escalation, the user can only grant one. The other 2 are stuck. User asked "How can I allow all of them?" — there's no mechanism.

**Proposed solution:**

1. Implement an escalation queue that holds all pending escalation requests per sender (not just one)
2. Add `/allow all` command to grant all pending escalations at once
3. Each `/allow` should pop the next pending escalation from the queue, not clear all state
4. Show the user how many pending escalations remain after each grant

**Key files:** `src/core/router.ts`, `src/master/master-manager.ts`

**Scope:** ~6–8 tasks

---

## OB-F97 — Tool escalation timeout too short for multi-worker spawns (🟡 Medium)

**Problem:** Escalation requests auto-deny after 60 seconds. When 3 workers are spawned simultaneously, the user needs time to understand the prompts, decide, and respond. 60 seconds is insufficient — especially on mobile (Telegram).

**Observed in logs:**

```
[17:50:30] Tool escalation prompt sent (3 workers)
[17:51:30] Tool escalation timed out — auto-denied (60s elapsed)
```

**Impact:** Workers are auto-denied before the user can respond, especially for multi-worker batches.

**Proposed solution:**

1. Increase default timeout to 180 seconds (3 minutes)
2. Make timeout configurable in `config.json` (e.g., `escalationTimeoutMs`)
3. Scale timeout with number of pending escalations (e.g., +60s per additional worker)
4. Send a reminder at 50% timeout: "You have X pending escalation requests — reply /allow or /deny"

**Key files:** `src/core/router.ts`, `src/types/config.ts`

**Scope:** ~3–4 tasks

---

## OB-F98 — Message misclassification: strategic/brainstorming as quick-answer (🟠 High)

**Problem:** The keyword-based classifier assigns wrong task classes to several message types:

| Message                                                           | Got                                  | Should be                           |
| ----------------------------------------------------------------- | ------------------------------------ | ----------------------------------- |
| "Can you brainstorm with me? And check our docs roadmap..."       | `quick-answer` (maxTurns: 5)         | `complex-task` (25)                 |
| "Im thinking to create a strategy to commercialise openbridge..." | `quick-answer` via `text-generation` | `complex-task` (25)                 |
| "The main goal of openbridge is to make ai do real work..."       | `tool-use` (15)                      | `text-generation` or `complex-task` |

**Root causes:**

1. `keyword fallback: quick-answer` is too aggressive — any message that doesn't match specific keywords falls through to quick-answer
2. `keyword match: text-generation` catches strategy/planning requests that need more depth
3. "brainstorm", "strategy", "business model", "commercialise" should trigger `complex-task`

**Impact:** Strategic questions get only 5 turns, producing shallow answers. The Master can't do justice to complex planning requests.

**Proposed solution:**

1. Add keywords for `complex-task`: "brainstorm", "strategy", "business model", "commercialise", "plan", "roadmap review"
2. Increase `text-generation` maxTurns from 5 to at least 10 — long-form text generation needs more turns
3. Improve fallback logic: if message length > 100 chars and contains question marks, default to at least `tool-use` (15 turns)
4. Consider a lightweight LLM-based classifier as fallback when keyword matching is ambiguous

**Key files:** `src/master/master-manager.ts` (classification logic)

**Scope:** ~4–6 tasks

---

## OB-F99 — RAG returns zero results for real user questions (🟡 Medium)

**Problem:** Substantive user questions return `confidence: 0, chunkCount: 0` from the RAG system, while trivial single-character queries like "1" return `confidence: 0.8, chunkCount: 10`.

**Observed in logs:**

```
"Can you deployed and send the link?"          → confidence: 0, chunkCount: 0
"I don't have access to my mac so what other solutions" → confidence: 0, chunkCount: 0
"How can i allow all of them?"                 → confidence: 0, chunkCount: 0
"Wish option i have so we can use..."          → confidence: 0, chunkCount: 0

"1"                                            → confidence: 0.8, chunkCount: 10 (FTS5)
"3"                                            → confidence: 0.8, chunkCount: 10 (FTS5)
```

**Impact:** The RAG system fails to provide relevant workspace context for real questions, making Master responses less informed. It only "works" for meaningless single-character queries.

**Proposed solution:**

1. Investigate why FTS5 returns results for "1" but not for multi-word queries — likely a tokenization or query construction issue
2. Check if `buildSearchQuery` is over-filtering tokens for natural language questions
3. Verify workspace chunks are actually indexed — if chunkCount is always 0 for real queries, the index may be empty or stale
4. Add fallback: if FTS5 returns 0 results, try a broader query (e.g., individual keywords instead of full phrase)

**Key files:** `src/core/knowledge-retriever.ts`, `src/memory/chunk-store.ts`, `src/memory/retrieval.ts`

**Scope:** ~4–5 tasks (may overlap with existing OB-F90 work)

---

## OB-F100 — Single-character messages trigger full agent invocations (🟢 Low)

**Problem:** Messages like "1", "3", "4" (likely menu/option selections) go through the full pipeline: classification → RAG query → agent spawn. The message "1" at 17:35:30 took 64 seconds and cost $0.022.

**Observed in logs:**

```
[17:35:30] content: "1" → classified quick-answer → RAG query → agent spawn → 64s, $0.022
[17:37:30] content: "1" → classified quick-answer → RAG query → agent spawn → 47s, $0.011
[17:52:59] content: "3" → classified quick-answer → RAG query → agent spawn → 18s, $0.011
```

**Impact:** Wasted compute and user wait time for what are likely simple follow-up selections.

**Proposed solution:**

1. Detect numeric-only messages (1–9) and check if the previous response contained a numbered list/menu
2. If so, extract the selected option and process it as a follow-up rather than a new query
3. Alternatively, add a `menu-selection` task class with maxTurns: 2 and skip RAG
4. At minimum, skip RAG for messages shorter than 3 characters

**Key files:** `src/master/master-manager.ts`, `src/core/knowledge-retriever.ts`

**Scope:** ~3–4 tasks

---

## OB-F101 — Codex worker cost spike ($1.14 for single read-only task) (🟡 Medium)

**Problem:** One Codex worker (`gpt-5.2-codex`, read-only profile) cost $1.14 for a single invocation — roughly 100x the typical agent cost of ~$0.01.

**Observed in logs:**

```
[23:27:32] Streaming agent completed
    model: "gpt-5.2-codex"
    durationMs: 91904
    costUsd: 1.1433876953125   ← abnormally high
```

For comparison, other workers in the same batch:

- Worker 1: $0.096 (39s)
- Worker 3: $0.133 (118s, turns exhausted)

**Impact:** Unpredictable cost spikes. A read-only research task should not cost $1.14.

**Proposed solution:**

1. Add per-worker cost caps (e.g., abort if cost exceeds $0.50 for read-only tasks)
2. Log a warning when cost exceeds 10x the average for the profile tier
3. Investigate what the worker was doing — 91 seconds of Codex at read-only suggests it was reading many files
4. Consider using `maxTurns` more aggressively for Codex workers (e.g., cap read-only at 8 turns instead of 15)

**Key files:** `src/core/agent-runner.ts`, `src/master/master-manager.ts`

**Scope:** ~3–4 tasks

---

## OB-F102 — Master response truncated to empty after SPAWN marker removal (🟡 Medium)

**Problem:** When the Master's entire response consists of SPAWN markers with no surrounding text, removing the markers leaves `cleanedLength: 0`. The user gets a generic status message instead of the Master's analysis or explanation.

**Observed in logs (3 occurrences):**

```
[17:48:04] Response truncated after SPAWN marker removal
    originalLength: 1074, cleanedLength: 0, spawnCount: 3

[17:50:30] Response truncated after SPAWN marker removal
    originalLength: 885, cleanedLength: 0, spawnCount: 3

[23:26:00] Response truncated after SPAWN marker removal
    originalLength: 704, cleanedLength: 0, spawnCount: 3
```

**Impact:** The user receives a vague "I'm working on it" message instead of the Master's actual plan or context about what the workers will do.

**Proposed solution:**

1. When `cleanedLength === 0`, generate a structured status message from the SPAWN markers themselves (e.g., "I'm spawning 3 workers: 1) Research deployment options, 2) Review file sharing code, 3) Check WebChat setup")
2. Update the planning prompt to instruct the Master to always include a human-readable summary BEFORE or AFTER the SPAWN markers
3. Parse worker prompts from SPAWN markers and summarize them for the user

**Key files:** `src/master/master-manager.ts`, `src/master/master-system-prompt.ts`

**Scope:** ~3–4 tasks

---

## OB-F103 — Orphaned workers: 7 workers never completed or failed (🔴 Critical)

**Problem:** The worker batch stats show 61 total workers, but only 54 are accounted for (46 completed + 8 failed + 0 cancelled). **7 workers are unaccounted for** — they were spawned but never reached a terminal state (completed/failed/cancelled). These are likely stuck in a "pending" or "running" state indefinitely.

**Root causes (from other findings in this session):**

1. Workers spawned with escalation requests that timed out (OB-F97) — the worker was never started, but also never marked as cancelled
2. Workers that failed re-spawn after `/allow` grant (OB-F95) — the original worker was replaced but the escalated worker crashed, leaving both in limbo
3. Workers waiting for escalation when `/allow` state was already consumed (OB-F96) — stuck in "pending escalation" forever

**Observed in logs:**

```
[17:48:05] 3 workers spawned needing escalation
[17:48:39] 1 granted but re-spawn crashed (OB-F95)
[17:48:44] "no pending escalation" — 2 workers stuck
[17:51:30] 1 worker auto-denied (timeout) — but was it marked failed?

Batch stats at session end:
    totalWorkers: 61
    completed: 46 + failed: 8 + cancelled: 0 = 54
    MISSING: 7 workers (11.5%)
```

A worker running for **23,174 seconds (~6.4 hours)** was also observed — this is almost certainly an orphaned process that was never killed.

**Impact:**

- Orphaned workers consume system resources (memory, CPU, possible open file handles)
- Orphaned CLI processes (`claude` or `codex`) may hold API connections open indefinitely
- Worker concurrency limits may be hit prematurely if orphaned workers count against the limit
- No cleanup mechanism exists to reap these workers

**Proposed solution:**

1. Add a worker state audit on every batch stats collection — if `total != completed + failed + cancelled`, log a warning with the orphaned worker IDs
2. Implement a worker timeout/watchdog: if a worker hasn't reported progress in N minutes (e.g., 10 min for read-only, 30 min for complex), force-kill and mark as failed
3. When escalation times out, explicitly mark the worker as `cancelled` in WorkerRegistry
4. When re-spawn fails (OB-F95), mark BOTH the original and escalated worker as `failed`
5. Add a `/workers` command to list active workers with status, duration, and PID — so the user can manually kill stuck workers
6. On graceful shutdown, kill all running worker processes and mark them as cancelled

**Key files:** `src/master/worker-registry.ts`, `src/master/master-manager.ts`, `src/core/agent-runner.ts`

**Scope:** ~6–8 tasks

---

## OB-F104 — Workers exhaust max-turns without completing (🟡 Medium)

**Problem:** Multiple workers exit with code 0 but with `turnsExhausted: true` — meaning they hit the max-turns limit before finishing their task. The result is marked as "completed" but the work is incomplete.

**Observed in logs:**

```
[17:49:51] WARN Streaming agent exited with code 0 but max-turns was exhausted — result may be incomplete
    model: "gpt-5.2-codex", maxTurns: 15, durationMs: 71438, costUsd: $0.065

[23:27:59] WARN Streaming agent exited with code 0 but max-turns was exhausted — result may be incomplete
    model: "gpt-5.2-codex", maxTurns: 15, durationMs: 118186, costUsd: $0.133
```

**Impact:** Workers are counted as "completed" in batch stats even though their output is partial. The Master may receive incomplete results and synthesize a poor response. The user has no visibility into whether a worker finished its task or was cut short.

**Proposed solution:**

1. Mark `turnsExhausted` workers as a distinct status (e.g., `partial`) — don't count them as fully `completed`
2. Include `turnsExhausted` flag in worker result metadata so the Master knows the result is incomplete
3. When Master receives a partial result, it should either: (a) spawn a continuation worker, or (b) tell the user the analysis is incomplete
4. Log turn count vs maxTurns in worker completion for diagnostics (e.g., "used 15/15 turns")
5. Consider adaptive maxTurns: if the task prompt is long (>200 chars), add extra turns

**Key files:** `src/core/agent-runner.ts`, `src/master/master-manager.ts`, `src/master/worker-result-formatter.ts`

**Scope:** ~4–5 tasks

---

## OB-F105 — Master tool selection flow is redundant and confusing (🟡 Medium)

**Problem:** During startup, three separate mechanisms determine the Master AI tool, producing confusing log output:

1. Discovery selects `claude` as master (best capability)
2. `excludeTools` removes `claude` → auto-selects `codex`
3. Config override also specifies `codex`

All three fire sequentially, logging contradictory decisions. The logs don't explain _why_ Claude was excluded, making troubleshooting difficult.

**Observed in logs:**

```
[15:47:35.242] Selected master AI tool
    master: "claude"
[15:47:35.242] Excluded tools from discovery
    excludeTools: ["claude"]
    removed: 1
[15:47:35.242] Previous master was excluded — auto-selected next available tool
    newMaster: "codex"
[15:47:35.242] Master tool override specified in config
    override: "codex"
[15:47:35.242] Using overridden Master tool from discovered tools
    tool: "codex"
```

**Impact:** Debugging confusion when tool selection goes wrong. The reason for exclusion is never logged. If a user adds a new tool and it gets unexpectedly excluded, there's no way to understand why from the logs alone.

**Proposed solution:**

1. Log the _reason_ for each exclusion (e.g., "claude excluded: listed in config.excludeTools")
2. If config override matches the auto-selected fallback, skip the redundant override log
3. Consolidate to a single summary log: "Master AI: codex (claude excluded per config)"
4. Add a `--verbose` flag for the full selection trace

**Key files:** `src/index.ts`, `src/discovery/tool-scanner.ts`

**Scope:** ~2–3 tasks

---

## OB-F106 — Whitelist normalization drops entries without identifying which (🟡 Medium)

**Problem:** Auth initialization normalizes 7 whitelist entries down to 6, logging a warning but not identifying _which_ entry was dropped or _why_ (non-numeric? duplicate?).

**Observed in logs:**

```
[15:47:35.243] INFO (auth/87058): Auth service initialized
    whitelistedNumbers: 6
    rawEntries: 7

[15:47:35.243] WARN (auth/87058): Whitelist count changed after normalization — some entries were non-numeric or duplicates
    rawEntries: 7
    normalizedEntries: 6
```

**Impact:** If the dropped entry is a real phone number, that user is silently locked out with no diagnostic path. The admin has to guess which of their 7 entries was rejected.

**Proposed solution:**

1. Log each dropped entry with the reason (e.g., "Dropped whitelist entry '+1-abc': non-numeric characters")
2. Log each duplicate (e.g., "Duplicate whitelist entry: +212600000000 appears twice")
3. On `npx openbridge init`, validate entries at config generation time with clear feedback
4. Add a `--validate-config` command that checks whitelist entries without starting the bridge

**Key files:** `src/core/auth.ts`, `src/cli/init.ts`

**Scope:** ~2–3 tasks

---

## OB-F107 — `.env.example` incorrectly flagged as sensitive file (🟢 Low)

**Problem:** The sensitive file detector auto-excludes `.env.example` from AI visibility, but `.env.example` is a template/documentation file — it contains placeholder values, not real secrets. Excluding it prevents workers from understanding required environment variables.

**Observed in logs:**

```
[15:47:35.254] WARN (bridge/87058): Sensitive files detected in workspace — auto-excluding from AI visibility for this session
    count: 1
    paths: ["/Users/sayadimohamedomar/Desktop/AI-Bridge/OpenBridge/.env.example"]
```

**Impact:** Workers can't see what environment variables are expected. Minor usability issue since the file only contains examples, but it's a false positive that erodes trust in the detection system.

**Proposed solution:**

1. Whitelist `.env.example`, `.env.sample`, `.env.template` patterns — these are documentation, not secrets
2. Only flag `.env`, `.env.local`, `.env.production`, etc. (files likely to contain real values)
3. Allow a `sensitiveFileExceptions` list in config for custom overrides

**Key files:** `src/core/bridge.ts`

**Scope:** ~2 tasks

---

## OB-F108 — Batch continuation timers not cancelled on shutdown (🟡 Medium)

**Source:** Code review of Phase 98 batch continuation implementation (OB-1613–OB-1620)

**Problem:** Batch continuation uses `setTimeout()` at 4 locations in `master-manager.ts` (lines ~2518, ~2544, ~2561, ~5328) to schedule the next batch item. These timer handles are never stored or cleared. During shutdown, `MasterManager.shutdown()` calls `stopIdleDetection()` and `delegationCoordinator.shutdown()` but never cancels pending batch timers.

**Impact:** If `shutdown()` is called while a batch timer is pending (within the 0.5–2s window), the timer fires into a partially destroyed system. The `void router.routeBatchContinuation(...)` call will either:

- Throw because `router` is null/destroyed (unhandled rejection from `void`)
- Succeed and start a new batch item on a shutting-down system

**Proposed solution:**

1. Store each `setTimeout` handle in a `Set<NodeJS.Timeout>` on MasterManager (e.g., `batchTimers`)
2. Remove handles from the set when they fire
3. In `shutdown()`, call `clearTimeout()` on all remaining handles
4. Guard the timer callback: `if (this.state === 'shutdown') return;`

**Key files:** `src/master/master-manager.ts` (lines ~2518, ~2544, ~2561, ~5328, ~6426)

**Scope:** ~2 tasks

---

## OB-F109 — Unhandled rejections in batch continuation fire-and-forget (🟡 Medium)

**Source:** Code review of Phase 98 batch continuation implementation

**Problem:** All batch continuation timers use `void router.routeBatchContinuation(...)` — the `void` operator discards the Promise, meaning any rejection is an unhandled promise rejection. If `routeBatchContinuation()` throws (e.g., router disconnected, processMessage error not caught), Node.js emits `unhandledRejection` which can crash the process with `--unhandled-rejections=throw`.

**Observed pattern:**

```typescript
setTimeout(() => {
  void router.routeBatchContinuation(batchId, sender); // ← unhandled rejection
}, 2000);
```

**Impact:** A single failing batch item can crash the entire bridge process instead of gracefully pausing the batch.

**Proposed solution:**

1. Replace `void` with `.catch()`: `router.routeBatchContinuation(batchId, sender).catch(err => { ... })`
2. In the catch handler, call `batchManager.pauseBatch()` and notify the user
3. Alternatively, wrap in a `try/catch` inside an `async` IIFE

**Key files:** `src/master/master-manager.ts` (lines ~2519, ~2545, ~2562, ~5329)

**Scope:** ~1 task

---

## OB-F110 — Docker sandbox `exec()` reads wrong property for exit code (🟡 Medium)

**Source:** Code review of OB-1545 (Docker sandbox implementation)

**Problem:** In `docker-sandbox.ts:206`, the error handler reads `execErr.code` to get the exit code. But `child_process.execFile` error objects use `.code` as a string (e.g., `'ENOENT'`, `'ERR_CHILD_PROCESS_STDIO_MAXBUFFER'`). The actual process exit code is on the error's `.status` property. Since `typeof execErr.code === 'number'` is almost always `false`, all non-zero exits default to `1`.

**Code:**

```typescript
const execErr = err as NodeJS.ErrnoException & {
  stdout?: string;
  stderr?: string;
  code?: number; // ← typed as number but is actually string
};
const exitCode = typeof execErr.code === 'number' ? execErr.code : 1; // ← always 1
```

**Impact:** Callers cannot distinguish between exit code 1 (general error), exit code 2 (misuse), exit code 137 (OOM-killed), etc. All failures look the same.

**Proposed solution:**

1. Read `.status` instead of `.code` for the exit code
2. Type the error correctly: `code?: string; status?: number`
3. Fallback chain: `execErr.status ?? (typeof execErr.code === 'number' ? execErr.code : 1)`

**Key files:** `src/core/docker-sandbox.ts` (line ~201–206)

**Scope:** ~1 task

---

## OB-F111 — Docker sandbox has no container cleanup on process crash (🟡 Medium)

**Source:** Code review of OB-1545 (Docker sandbox implementation)

**Problem:** `DockerSandbox` creates containers via `createContainer()` + `startContainer()` but has no process exit handler (`SIGINT`, `SIGTERM`, `beforeExit`) to clean up running containers. If the bridge crashes, orphaned Docker containers continue running indefinitely.

This contrasts with `TunnelManager` which already registers exit handlers for cleanup.

**Impact:** Orphaned Docker containers consume system resources (memory, CPU, network). With `--network none` (default), they're relatively harmless but still waste memory. With network access enabled, they could hold open connections indefinitely.

**Proposed solution:**

1. Track all created container IDs in a `Set<string>`
2. Register `process.on('exit')` / `process.on('SIGINT')` handlers that call `removeContainer(id, true)` for each tracked container
3. Add a `cleanup()` method that stops and removes all tracked containers
4. Wire `cleanup()` into `Bridge.shutdown()` alongside existing graceful shutdown hooks

**Key files:** `src/core/docker-sandbox.ts`, `src/core/bridge.ts`

**Scope:** ~2 tasks

---

## OB-F112 — Batch sender info not persisted across process restarts (🟢 Low)

**Source:** Code review of Phase 98 batch continuation implementation

**Problem:** `batchSenderInfo` is an in-memory `Map<string, { sender, source }>` on MasterManager (line ~600). BatchManager persists batch state to `.openbridge/batch-state.json` and reloads it on `initialize()`, but the sender routing info is lost. After a process restart, batch failure/completion messages cannot be routed to the original user.

**Impact:** If the bridge restarts mid-batch (OOM, crash, manual restart), the resumed batch silently loses the ability to send status messages. Failures are swallowed and the user never learns the batch completed or failed.

**Proposed solution:**

1. Include `senderInfo: { sender, source }` in the persisted batch state JSON
2. On `initialize()` reload, restore `batchSenderInfo` from persisted state
3. Alternatively, derive sender from the most recent conversation message in the memory system

**Key files:** `src/master/master-manager.ts` (line ~600), `src/master/batch-manager.ts` (state persistence)

**Scope:** ~2 tasks

---

## OB-F113 — 37 test failures from stale mocks after Phase 98 (🟠 High)

**Source:** Test suite analysis after automated task runner session (OB-1610–OB-1625)

**Problem:** The batch continuation feature (Phase 98) added new methods to `DotFolderManager` (`readBatchState`, `writeBatchState`, `deleteBatchState`) and new behavior to `MasterManager.start()` (calls `batchManager.initialize()`). Test files that mock `DotFolderManager` or `MasterManager` were not updated, causing 37 test failures across 7 files.

**Affected test files:**

| File                                                | Failures | Root Cause                                                         |
| --------------------------------------------------- | -------- | ------------------------------------------------------------------ |
| `tests/integration/memory-wiring.test.ts`           | 18       | Mock missing `readBatchState`/`writeBatchState`/`deleteBatchState` |
| `tests/cli/init-mcp.test.ts`                        | 7        | CLI wizard `createLineFeeder()` timeout (pre-existing)             |
| `tests/cli/init-wizard.test.ts`                     | 2        | CLI wizard health check test drift (pre-existing)                  |
| `tests/master/master-manager.test.ts`               | 3        | Progress Events mocks return wrong values after batch code changes |
| `tests/e2e/graceful-unknown-handling.test.ts`       | 2        | DotFolderManager mock incomplete                                   |
| `tests/integration/master-prefix-stripping.test.ts` | 3        | DotFolderManager mock incomplete                                   |
| `tests/connectors/webchat/webchat-mobile.test.ts`   | 1        | `node:os` mock missing `homedir` (pre-existing)                    |

**Impact:** CI is red. Test failures mask real regressions. Pre-existing CLI wizard failures (9 tests) have been broken since Phase 62 but were never fixed.

**Proposed solution:**

1. Add `readBatchState: vi.fn().mockReturnValue(null)`, `writeBatchState: vi.fn()`, `deleteBatchState: vi.fn()` to all DotFolderManager mocks
2. Fix Progress Events tests in master-manager.test.ts to match new processMessage flow
3. Address pre-existing CLI wizard test timeouts (separate finding or mark as known)
4. Add a "mock completeness" lint check to catch this pattern

**Key files:** All 7 test files listed above

**Scope:** ~4–6 tasks

---

## OB-F114 — `getActiveBatchId()` returns paused batches, inconsistent with `isActive()` (🟢 Low)

**Source:** Code review of Phase 98 batch continuation implementation

**Problem:** `isActive(batchId)` at line ~472 returns `false` for paused batches, but `getActiveBatchId()` at line ~493 iterates all batches and returns any with `currentIndex < totalItems` — including paused ones. This asymmetry is currently intentional (commands like `/batch`, `/batch abort`, `/pause` need to find paused batches), but it's undocumented and fragile.

**Code:**

```typescript
// isActive() excludes paused
isActive(batchId?: string): boolean {
  const state = this.batches.get(batchId);
  return state !== undefined && !state.paused && state.currentIndex < state.totalItems;
}

// getActiveBatchId() includes paused
getActiveBatchId(): string | undefined {
  for (const [id, state] of this.batches.entries()) {
    if (state.currentIndex < state.totalItems) return id;  // ← no paused check
  }
}
```

**Impact:** If someone adds `const id = getActiveBatchId(); if (id) { /* assume running */ }` they'll get a paused batch back. Not a bug today since all callers either check `isActive()` first or specifically want paused batches, but it's a trap.

**Proposed solution:**

1. Rename `getActiveBatchId()` to `getAnyBatchId()` or `getCurrentBatchId()` to signal it includes paused batches
2. Or add an optional `includePaused` parameter: `getActiveBatchId(includePaused = true)`
3. Add JSDoc clarifying the difference from `isActive()`

**Key files:** `src/master/batch-manager.ts` (lines ~472, ~493)

**Scope:** ~1 task

---

## Summary Table

| Finding | Title                                                    | Severity    | Scope     |
| ------- | -------------------------------------------------------- | ----------- | --------- |
| OB-F95  | Worker re-spawn crash after escalation grant             | 🔴 Critical | 3–5 tasks |
| OB-F96  | Escalation state cleared before all workers granted      | 🟠 High     | 6–8 tasks |
| OB-F97  | Escalation timeout too short for multi-worker spawns     | 🟡 Medium   | 3–4 tasks |
| OB-F98  | Misclassification of strategic/brainstorming messages    | 🟠 High     | 4–6 tasks |
| OB-F99  | RAG returns zero results for real questions              | 🟡 Medium   | 4–5 tasks |
| OB-F100 | Single-character messages trigger full agent invocations | 🟢 Low      | 3–4 tasks |
| OB-F101 | Codex worker cost spike ($1.14 for read-only task)       | 🟡 Medium   | 3–4 tasks |
| OB-F102 | Master response truncated to empty after SPAWN removal   | 🟡 Medium   | 3–4 tasks |
| OB-F103 | Orphaned workers never reach terminal state              | 🔴 Critical | 6–8 tasks |
| OB-F104 | Workers exhaust max-turns without completing             | 🟡 Medium   | 4–5 tasks |
| OB-F105 | Master tool selection flow redundant and confusing       | 🟡 Medium   | 2–3 tasks |
| OB-F106 | Whitelist normalization drops entries without details    | 🟡 Medium   | 2–3 tasks |
| OB-F107 | `.env.example` incorrectly flagged as sensitive          | 🟢 Low      | 2 tasks   |
| OB-F108 | Batch continuation timers not cancelled on shutdown      | 🟡 Medium   | 2 tasks   |
| OB-F109 | Unhandled rejections in batch fire-and-forget            | 🟡 Medium   | 1 task    |
| OB-F110 | Docker sandbox `exec()` reads wrong exit code property   | 🟡 Medium   | 1 task    |
| OB-F111 | Docker sandbox no container cleanup on crash             | 🟡 Medium   | 2 tasks   |
| OB-F112 | Batch sender info not persisted across restarts          | 🟢 Low      | 2 tasks   |
| OB-F113 | 37 test failures from stale mocks after Phase 98         | 🟠 High     | 4–6 tasks |
| OB-F114 | `getActiveBatchId()` inconsistent with `isActive()`      | 🟢 Low      | 1 task    |

**Total estimated scope:** 58–78 tasks

---

## Worker Batch Stats (Session Summary)

| Metric                      | Value                    |
| --------------------------- | ------------------------ |
| Total workers spawned       | 61                       |
| Completed                   | 46 (75.4%)               |
| Failed                      | 8 (13.1%)                |
| **Orphaned (unaccounted)**  | **7 (11.5%)**            |
| Turns exhausted (partial)   | 2+                       |
| code-edit success rate      | 58.3% (7/12)             |
| read-only success rate      | 79.2% (38/48)            |
| fast model success rate     | 66.7% (20/30)            |
| Avg duration (read-only)    | 61.3s                    |
| Avg duration (code-edit)    | 121.4s                   |
| **Longest observed worker** | **~23,174s (6.4 hours)** |
