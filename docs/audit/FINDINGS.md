# OpenBridge — Audit Findings

> **Purpose:** Real issues, gaps, and risks discovered during code audits and real-world testing.
> **This is NOT a task list.** Tasks live in [TASKS.md](TASKS.md). Findings document _what's wrong_ and _why it matters_.
> **Open:** 10 | **Fixed:** 24 (143 prior findings archived) | **Last Audit:** 2026-03-09
> **History:** 151 findings fixed across v0.0.1–v0.0.15. All prior archived in [archive/](archive/).

---

## Open Findings

### OB-F147 — Master prompt assembled without budget — silent truncation

- **Severity:** 🔴 Critical
- **Status:** Open
- **Key Files:** `src/core/agent-runner.ts:18,631-640`, `src/master/master-manager.ts:1970-2027,5550-5580`
- **Root Cause / Impact:**
  `sanitizePrompt()` hard-caps `opts.prompt` at 32,768 chars via `slice()` — no priority, no section awareness. The Master's prompt reached 96,930 chars at startup and was silently truncated to 32K, losing ~66% of context. Meanwhile `opts.systemPrompt` (43K+ base + 15-30K injected context) bypasses all size checks — passed raw via `--append-system-prompt`. The 10+ context sections (workspace, memory, RAG, history, learnings, worker next steps, analysis) are concatenated with zero budget awareness.
- **Fix:** Replace raw concatenation with a `PromptAssembler` using priority-ranked sections, per-section `maxChars` caps, and a provider-aware total budget from `CLIAdapter.getPromptBudget()`.

---

### OB-F148 — Adapter-inconsistent prompt size handling

- **Severity:** 🟠 High
- **Status:** ✅ Fixed
- **Key Files:** `src/core/adapters/claude-adapter.ts:66-68`, `src/core/adapters/codex-adapter.ts:274-279`, `src/core/cli-adapter.ts`
- **Root Cause / Impact:**
  Each CLIAdapter handles `systemPrompt` differently: ClaudeAdapter passes it raw via `--append-system-prompt` (no cap), CodexAdapter merges it INTO the `prompt` field (line 279, doubling size before the 32K truncation), AiderAdapter merges it into `--message`. No adapter declares its model's context window or budget. Adding future providers (Google, local models with 4K-32K context) will silently lose critical prompt content.
- **Fix:** Extend `CLIAdapter` with `getPromptBudget(model?)` so each adapter declares its limits and the assembler adapts automatically per provider.

---

### OB-F149 — Self-improvement grows system prompt unboundedly

- **Severity:** 🟡 Medium
- **Status:** Open
- **Key Files:** `src/memory/prompt-store.ts:61`, `src/master/prompt-evolver.ts`
- **Root Cause / Impact:**
  The Master AI can edit its own system prompt via self-improvement. The generated base prompt is 35,908 chars but the DB-stored version has grown to 43,642 chars (+22%). No size cap on `createPromptVersion()`. Over time the system prompt will keep growing, consuming more context window and pushing other sections out.
- **Fix:** Add a hard cap (e.g., 45K chars) in `createPromptVersion()`. Reject updates that exceed the cap and log a warning.

---

### OB-F150 — Workspace map duplicated in exploration prompts

- **Severity:** 🟢 Low
- **Status:** ✅ Fixed
- **Key Files:** `src/master/exploration-prompts.ts:414`, `src/master/master-manager.ts:4734-4740`
- **Root Cause / Impact:**
  During incremental exploration, the workspace map appears in both: (1) `opts.prompt` via `generateIncrementalExplorationPrompt()` which embeds `JSON.stringify(currentMap, null, 2)` (~11K), and (2) `opts.systemPrompt` via `buildMasterSpawnOptions()` → `getWorkspaceContextSummary()` (~3K summary). The AI receives redundant workspace context.
- **Fix:** Added a `skipWorkspaceContext` flag to `SpawnOptions` (OB-1252); set it to true when calling `buildMasterSpawnOptions()` for incremental exploration (OB-1253) since the prompt already contains the workspace map.

---

### OB-F151 — Prompt version table has duplicate seed rows

- **Severity:** 🟢 Low
- **Status:** ✅ Fixed
- **Key Files:** `src/master/master-manager.ts` (seedPromptLibrary), `src/memory/prompt-store.ts`
- **Root Cause / Impact:**
  The `prompt_versions` table contains 14 repeated sets of identical prompt content (378 total rows for 14 unique prompts). Each startup re-seeds all prompt versions without checking if they already exist, wasting ~200KB of DB space.
- **Fix:** Added existence check before inserting (OB-1254), one-time dedup migration (OB-1255), and idempotency test verifying `seedPromptLibrary()` called twice produces no duplicate rows (OB-1256).

---

### OB-F152 — Classifier ignores message attachments — file analysis tasks misclassified as quick-answer

- **Severity:** 🟠 High
- **Status:** Open
- **Key Files:** `src/master/master-manager.ts` (lines 5303, 6117)
- **Root Cause / Impact:**
  `classifyTask()` only examines `message.content` text. Messages with file attachments (XLS, PDF, images) fall through to the default `quick-answer` (5 turns, 210s timeout) when the accompanying text is short/generic (e.g. "explore this file"). File analysis inherently requires more turns and time. Observed in production: user sent XLS file, follow-up "explore the xl file" classified as `quick-answer`, worker timed out at 210s (exit 143), message moved to DLQ with no retry (timeout errors skip retries per OB-F144 fix).
- **Fix:** After classification in `processMessage()`, check `message.attachments` — if non-empty and class is `quick-answer`, escalate to `tool-use` (15 turns, 510s).

---

### OB-F153 — Orphaned workers persist in pending state — never cleaned up

- **Severity:** 🟠 High
- **Status:** ✅ Fixed
- **Key Files:** `src/master/worker-registry.ts` (lines 410–439, 534–636), `src/master/master-manager.ts`
- **Root Cause / Impact:**
  Workers registered via `addWorker()` that fail before `markRunning()` (spawn error, escalation timeout, slot wait timeout) remain in `pending` state indefinitely. `getAggregatedStats()` detects and logs them as warnings but does NOT remove or cancel them. The watchdog (lines 534–636) only monitors `running` workers, not `pending`. Orphans accumulate across message cycles, consuming concurrency slots and polluting batch stats. Observed: 2 workers stayed orphaned across 3+ message cycles.
- **Fix:** (1) Add pending-worker timeout to watchdog (e.g. 5 min). (2) Auto-cancel orphans in `getAggregatedStats()` instead of just logging. (3) Wrap `spawnWorker()` with try-catch that calls `removeWorker()` on failure.

---

### OB-F154 — File-reference keywords missing from classifier

- **Severity:** 🟡 Medium
- **Status:** ✅ Fixed
- **Key Files:** `src/master/master-manager.ts` (classifyTaskByKeywords)
- **Root Cause / Impact:**
  The keyword classifier has no detection for file-reference phrases. Messages like "explore the xl file I sent" or "what's in the pdf" contain clear signals that file analysis is needed, but none of these terms ("the file", "xl", "pdf", "document", "attachment", "spreadsheet") appear in any keyword list. Combined with OB-F152 (no attachment awareness), these messages get the minimum 5-turn/210s budget. Should escalate to at least `tool-use` (15 turns, 510s).
- **Fix:** Add a file-reference keyword group in `classifyTaskByKeywords()` that triggers `tool-use` classification.

---

### OB-F155 — Stale exploration_progress rows accumulate on retry

- **Severity:** 🟡 Medium
- **Status:** Open
- **Key Files:** `src/master/exploration-coordinator.ts:509-523`, `src/memory/activity-store.ts`
- **Root Cause / Impact:**
  When exploration fails and retries, `explore()` creates a new `explorationId` via `randomUUID()` each time (line 510). New `exploration_progress` rows are inserted for all directories with `pending` status. Previous exploration's rows are never cleaned up — rows from failed attempts remain `pending` forever. `cleanupOldActivity()` only cleans `agent_activity`, not `exploration_progress`. Real-world evidence: `/Desktop/API` workspace had 4 exploration IDs producing 82 rows, most stuck in `pending` indefinitely.
- **Fix:** On exploration start, delete stale `exploration_progress` rows from previous failed explorations (`WHERE status IN ('pending','in_progress') AND exploration_id != current`), or add cleanup to `cleanupOldActivity()`.

---

### OB-F156 — memory.md stays empty after exploration completes

- **Severity:** 🟠 High
- **Status:** ✅ Fixed
- **Key Files:** `src/master/master-manager.ts` (triggerMemoryUpdate, masterDrivenExplore), `src/master/dotfolder-manager.ts`
- **Root Cause / Impact:**
  `memory.md` is only populated via `triggerMemoryUpdate()` which fires after every 50 completed user tasks (`MEMORY_UPDATE_INTERVAL`). During initial startup, exploration completes and the Master enters `ready` state, but `completedTaskCount` is still 0 — so `triggerMemoryUpdate()` is never called. `memory.md` remains a fallback stub (`"No recent messages."`). The Master loses all exploration knowledge on session restart because `memory.md` is the primary cross-session context source. Real-world evidence: `/Desktop/API` had 58 chunks in DB + 19 completed directory dives, but `memory.md` was empty.
- **Fix:** Call `triggerMemoryUpdate()` (or a dedicated `writeExplorationSummaryToMemory()`) immediately after exploration completes, seeding `memory.md` with project type, frameworks, structure overview, and key findings.

---

### OB-F157 — No monorepo/sub-project awareness during exploration

- **Severity:** 🟡 Medium
- **Status:** Open
- **Key Files:** `src/master/exploration-coordinator.ts` (expandLargeDirectories), `src/master/exploration-prompts.ts`, `src/master/sub-master-detector.ts`
- **Root Cause / Impact:**
  Exploration treats multi-project workspaces (monorepos with independent sub-projects each having their own `package.json` + `.git`) as a flat directory structure. Structure scan and classification see sub-projects as sibling directories — not as independent projects. `expandLargeDirectories()` splits by file count only (threshold: 1000 files), not by project boundaries. Sub-project detection (`detectSubProjects()` in `sub-master-detector.ts`) runs AFTER exploration completes but doesn't feed back into the workspace map or memory.md. Real-world evidence: `/Desktop/API` with 3 sub-projects got shallow directory-level coverage instead of per-project understanding.
- **Fix:** Enhance Phase 2 (Classification) to detect monorepo patterns (multiple `package.json`/`.git` at depth 1-2), then treat each sub-project as an independent exploration target with its own classification and summary.

---

### OB-F158 — `master-manager.ts` god class — 8,869 LOC, 59+ methods

- **Severity:** 🟠 High
- **Status:** Open
- **Key Files:** `src/master/master-manager.ts`
- **Root Cause / Impact:**
  Single file handles 6+ responsibility groups: task classification, workspace exploration, worker orchestration, prompt/context assembly, persistence, and session management. 8,869 LOC = 12.4% of 71,683 total source LOC. Hinders testability, readability, code review, and parallel development. CLAUDE.md lists it as 6,155 LOC (stale by +2,714 lines).
- **Fix:** Extract into focused modules: `classification-engine.ts`, `exploration-manager.ts`, `worker-orchestrator.ts`, `prompt-context-builder.ts`, `master-persistence.ts`, `master-session-manager.ts`.

---

### OB-F159 — `router.ts` god class — 5,086 LOC, 37+ methods

- **Severity:** 🟠 High
- **Status:** Open
- **Key Files:** `src/core/router.ts`
- **Root Cause / Impact:**
  Single file mixes message routing with 40+ command handlers, deep-mode commands, output marker processing (SHARE/VOICE/APP), and confirmation management. 5,086 LOC = 7.1% of total source. CLAUDE.md lists it as 1,554 LOC (stale by +3,532 lines).
- **Fix:** Extract into: `command-handlers.ts`, `deep-mode-commands.ts`, `output-marker-processor.ts`, `confirmation-manager.ts`, `escalation-commands.ts`.

---

### OB-F160 — `agent-runner.ts` oversized — 2,336 LOC, 39+ functions

- **Severity:** 🟡 Medium
- **Status:** Open
- **Key Files:** `src/core/agent-runner.ts`
- **Root Cause / Impact:**
  Mixes error classification, cost management, process execution, and profile resolution in one file. 2,336 LOC = 3.3% of total source. Less critical than F158/F159 but growing.
- **Fix:** Extract: `error-classifier.ts`, `cost-manager.ts`, `process-executor.ts`, `profile-resolver.ts`.

---

### OB-F161 — Stale LOC references in CLAUDE.md files

- **Severity:** 🟢 Low
- **Status:** Open
- **Key Files:** `CLAUDE.md`, `OpenBridge/CLAUDE.md`
- **Root Cause / Impact:**
  Both `CLAUDE.md` (root) and `OpenBridge/CLAUDE.md` list outdated LOC counts: `master-manager.ts` 6,155 (actual: 8,869), `router.ts` 1,554 (actual: 5,086), `dotfolder-manager.ts` 903 (actual: 1,090). Misleads contributors about file complexity.
- **Fix:** Update LOC references in both CLAUDE.md files to reflect actual sizes.

---

> **Discovered:** 2026-03-09 | **Audit:** Large file analysis (OB-F158–F161)
> **Impact:** The 3 god-class files total 16,291 LOC = 23% of all source code. Splitting would produce ~15 focused modules, improving testability, code review efficiency, and parallel development.

---

### OB-F162 — Agent-runner timeout/kill race condition — double SIGKILL

- **Severity:** 🟠 High
- **Status:** ✅ Fixed
- **Key Files:** `src/core/agent-runner.ts` (execOnce, ~lines 987-1090)
- **Root Cause / Impact:**
  In `execOnce()`, timeout and grace-period timers are cleared by multiple code paths (child 'close', child 'error', manual `kill()`) without synchronization. If `kill()` is called while a timeout handler is mid-execution, the grace period timer can fire after the process is already killed, attempting a second SIGKILL. The `killed` flag is not atomic across the timeout handler and kill function.
- **Fix:** Add a `killed = false` flag. Check it in both the timeout handler and kill function. Set `killed = true` before any cleanup to prevent race.

---

### OB-F163 — Session checkpoint/resume race — checkpoint never resumed on error

- **Severity:** 🟠 High
- **Status:** ✅ Fixed
- **Key Files:** `src/core/router.ts` (~lines 1707-1814)
- **Root Cause / Impact:**
  In Router's message processing, when `isUrgentCycle` is true, `checkpointSession()` is called before `processMessage()`. If `processMessage()` throws, the catch block rethrows without calling `resumeSession()`. The session stays in "checkpointed" state. Next message processing inherits corrupted session state, causing unpredictable Master behavior.
- **Fix:** Added `sessionCheckpointed` flag; set to `true` after `checkpointSession()` succeeds. `resumeSession()` moved to a `finally` block (guarded by flag) with try-catch and error logging.

---

### OB-F164 — Memory init failure leaves eviction interval running against null

- **Severity:** 🟠 High
- **Status:** ✅ Fixed
- **Key Files:** `src/core/bridge.ts` (~lines 302-337)
- **Root Cause / Impact:**
  If `MemoryManager.init()` or `migrate()` fails in `Bridge.start()`, memory is set to null. But the eviction interval may still be set from a previous partial state or if the failure happens between init and interval setup. The interval callback calls `evictOldData()` on a null memory reference, causing unhandled errors.
- **Fix:** Only set eviction interval inside a `if (this.memory)` guard. Add null check inside the interval callback itself. Also deduplicated process signal handler registration via `tunnelExitHandler`/`tunnelSigintHandler` instance properties and `process.once()`. Tests added in `tests/core/bridge-memory-init.test.ts` and `tests/core/bridge-signal-handlers.test.ts`.

---

### OB-F165 — Queue `processNextForUser()` uses recursion — stack overflow under load

- **Severity:** 🟡 Medium
- **Status:** Open
- **Key Files:** `src/core/queue.ts` (~line 266)
- **Root Cause / Impact:**
  `processNextForUser()` recursively calls itself when processing queued messages for a user. If a single user has many queued messages processed in rapid succession, the call stack grows unboundedly. With 1000+ queued messages, this can cause a stack overflow.
- **Fix:** Replace recursion with a `while` loop or add `setImmediate()` between iterations to yield to the event loop.

---

### OB-F166 — Rate limiter `windows` Map leaks stale entries forever

- **Severity:** 🟡 Medium
- **Status:** ✅ Fixed
- **Key Files:** `src/core/rate-limiter.ts` (~lines 36-38)
- **Root Cause / Impact:**
  The `windows` Map stores per-sender timestamp arrays. While old timestamps within a window are filtered on each `isAllowed()` call, if a sender never sends another message, their entry stays in the Map permanently. With thousands of unique senders over time, memory grows linearly.
- **Fix:** Add periodic cleanup (e.g., every 5 min) that deletes entries with no timestamps within `2 * windowMs`.

---

### OB-F167 — Config watcher `reload()` — unhandled promise rejection

- **Severity:** 🟡 Medium
- **Status:** ✅ Fixed
- **Key Files:** `src/core/config-watcher.ts` (~lines 58-82)
- **Root Cause / Impact:**
  `scheduleReload()` calls `void this.reload()` (fire-and-forget). If `reload()` rejects before reaching its catch handler (e.g., synchronous throw from `loadConfig()`), the promise rejection goes unhandled. Node.js may terminate on unhandled rejections depending on `--unhandled-rejections` flag.
- **Fix:** Wrap the `void this.reload()` call in `.catch()` or use `try/catch` inside `scheduleReload()`.

---

### OB-F168 — Spawn confirmation timer leak on duplicate requests

- **Severity:** 🟡 Medium
- **Status:** ✅ Fixed
- **Key Files:** `src/core/router.ts` (~lines 811-831)
- **Root Cause / Impact:**
  In Router, `requestSpawnConfirmation()` stores a `setTimeout()` handle in `pendingSpawnConfirmations[sender]`. If called twice for the same sender before the first timeout fires, the first timer is orphaned — the new entry overwrites the old one, leaving the old timer running but unreachable. After 60s, the old timer fires and tries to access already-deleted state.
- **Fix:** Clear any existing pending confirmation for the same sender before creating a new one.

---

### OB-F169 — Master `classificationCache` unbounded memory growth

- **Severity:** 🟠 High
- **Status:** ✅ Fixed
- **Key Files:** `src/master/master-manager.ts` (~lines 625-626)
- **Root Cause / Impact:**
  The `classificationCache` Map in `master-manager.ts` grows without any eviction policy. Every unique user message (normalized) adds an entry. Over weeks/months of usage, thousands of entries accumulate, consuming unbounded memory. No periodic cleanup, no max-size cap, no LRU eviction.
- **Fix:** Add `MAX_CACHE_SIZE = 10_000` cap with LRU eviction (delete oldest 20% when exceeded). Add `cachedAt` timestamp to entries for age-based cleanup.

---

### OB-F170 — Master batch timers not cleaned up on shutdown

- **Severity:** 🟠 High
- **Status:** ✅ Fixed
- **Key Files:** `src/master/master-manager.ts` (~lines 643-644, 2769-2782)
- **Root Cause / Impact:**
  The `batchTimers` Set in `master-manager.ts` holds `setTimeout` handles for batch task resumption. These timers are added to the Set but never cleared during shutdown. Timers prevent Node.js process from exiting cleanly and accumulate if batches are repeatedly paused/resumed.
- **Fix:** In shutdown/cleanup, iterate `batchTimers` and call `clearTimeout()` on each, then `batchTimers.clear()`.

---

### OB-F171 — Worker abort handles leak on pre-spawn failure

- **Severity:** 🟡 Medium
- **Status:** ✅ Fixed
- **Key Files:** `src/master/master-manager.ts` (~lines 7597-8409)
- **Root Cause / Impact:**
  In `spawnWorker()`, the abort handle is stored in `workerAbortHandles` Map. If an exception occurs before the worker actually spawns (escalation timeout, slot wait timeout, spawn error), the catch block may not always clean up the abort handle. Stale handles accumulate, holding references to streams/sockets.
- **Fix:** Wrap entire `spawnWorker()` logic in `try/finally` that always deletes the abort handle from the map.

---

### OB-F172 — Pending messages silently dropped when exploration drain fails

- **Severity:** 🟡 Medium
- **Status:** ✅ Fixed
- **Key Files:** `src/master/master-manager.ts` (~lines 2195-2220)
- **Root Cause / Impact:**
  In `explore()`, after exploration completes, `drainPendingMessages()` processes queued user messages. If `processMessage()` throws during drain, remaining messages in `pendingMessages` are silently lost — no retry, no notification to the user.
- **Fix:** Wrap the drain loop in try-catch; on error, keep remaining messages in queue for next drain attempt, or notify the user.

---

### OB-F173 — Cancellation notifications re-injected on every session restart

- **Severity:** 🟡 Medium
- **Status:** ✅ Fixed
- **Key Files:** `src/master/master-manager.ts` (~lines 2447-2517)
- **Root Cause / Impact:**
  `restartMasterSession()` re-injects `pendingCancellationNotifications` into the system prompt but never clears them after injection. On subsequent session restarts, the same stale cancellation messages are injected again and again, confusing the Master AI.
- **Fix:** Clear `pendingCancellationNotifications` array after injecting them into the system prompt.

---

### OB-F174 — DotFolderManager silently swallows all file I/O errors

- **Severity:** 🟡 Medium
- **Status:** ✅ Fixed
- **Key Files:** `src/master/dotfolder-manager.ts` (all read methods)
- **Root Cause / Impact:**
  All read methods in `DotFolderManager` catch errors and return `null` without logging. If a file exists but is corrupt or unreadable (permissions, disk error), the error is completely invisible. Makes debugging extremely difficult — users don't know their exploration state, memory.md, or prompts are missing due to I/O errors.
- **Fix:** Add `logger.warn()` calls in catch blocks with the file path and error message.

---

### OB-F175 — JSON.parse without try-catch in memory stores — crash on corrupt data

- **Severity:** 🟠 High
- **Status:** ✅ Fixed
- **Key Files:** `src/memory/observation-store.ts:44-47`, `src/memory/access-store.ts:119-121`, `src/memory/index.ts:1147-1150`
- **Root Cause / Impact:**
  Multiple memory store modules call `JSON.parse()` on database fields without error handling: `observation-store.ts` (facts, concepts, files_read, files_modified), `access-store.ts` (scopes, allowed_actions, blocked_actions), `memory/index.ts` (session observations). If any JSON field is malformed (DB corruption, manual editing), the application crashes with an unhandled error.
- **Fix:** Wrap all `JSON.parse()` calls in try-catch, returning empty arrays/null as fallback.

---

### OB-F176 — Connector Maps/Sets grow unbounded — memory leaks in long-running instances

- **Severity:** 🟡 Medium
- **Status:** ✅ Fixed
- **Key Files:** `src/connectors/webchat/webchat-connector.ts`, `src/connectors/discord/discord-connector.ts`, `src/connectors/whatsapp/whatsapp-connector.ts`
- **Root Cause / Impact:**
  Multiple connectors maintain in-memory Maps/Sets with no cleanup: WebChat `sessions` Map (no expiry purge), Discord `progressMessages` Map (stale message refs), WhatsApp `progressSent` Set (never cleared after session). Over hours/days of runtime, these accumulate entries from disconnected/completed sessions.
- **Fix:** Add periodic cleanup (TTL-based) or clear entries on session end/disconnect.

---

### OB-F177 — WhatsApp reconnect timer not cleared on shutdown

- **Severity:** 🟡 Medium
- **Status:** ✅ Fixed
- **Key Files:** `src/connectors/whatsapp/whatsapp-connector.ts` (~lines 114, 549-560)
- **Root Cause / Impact:**
  The WhatsApp connector's `reconnectTimer` schedules reconnection attempts but `shutdown()` does not clear this timer. After graceful shutdown, the connector still attempts reconnection, causing potential race conditions and resource leaks.
- **Fix:** In `shutdown()`, call `clearTimeout(this.reconnectTimer)` and set it to null.

---

> **Discovered:** 2026-03-09 | **Audit:** Deep stability analysis (OB-F162–F177)
> **Impact:** 7 HIGH severity issues affecting process stability (timer races, session corruption, memory leaks), 9 MEDIUM issues affecting long-running reliability (unbounded Maps, silent error swallowing, timer leaks). Combined with existing 15 findings, total = 31 open.

---

## Fixed Findings (v0.0.15)

### OB-F144 — Quick-answer timeout too tight (150s)

- **Severity:** 🟠 High
- **Status:** ✅ Fixed
- **Key Files:** `src/master/master-manager.ts`
- **Root Cause / Impact:**
  `turnsToTimeout(5) = 5 × 30s = 150s` doesn't account for CLI startup overhead (20-60s). Messages timeout with exit 143 on slow starts, then succeed on retry. Queue skips retries for timeout errors, so messages go to DLQ.
- **Fix:** Added `CLI_STARTUP_BUDGET_MS = 60s` floor to all timeouts. Quick-answer now 210s.

---

### OB-F145 — Self-improvement idle cycle runs every 5 min forever

- **Severity:** 🟡 Medium
- **Status:** ✅ Fixed
- **Key Files:** `src/master/master-manager.ts`
- **Root Cause / Impact:**
  `checkIdleAndImprove()` resets `lastMessageTimestamp = Date.now()` after each cycle with no backoff. Produces 60+ no-op log entries over hours of idle time.
- **Fix:** Added `consecutiveIdleCycles` counter with exponential backoff (5m → 10m → 20m → ... → 2h cap). Resets on user message.

---

### OB-F146 — Phase 4 Assembly fails on large workspaces

- **Severity:** 🟠 High
- **Status:** ✅ Fixed
- **Key Files:** `src/master/exploration-prompts.ts`, `src/master/exploration-coordinator.ts`, `src/master/result-parser.ts`
- **Root Cause / Impact:**
  `generateSummaryPrompt()` embeds full `JSON.stringify(partialMap)` (92KB for OpenBridge). Agent-runner truncates at 32KB, cutting off the JSON output format instructions. AI returns markdown instead of JSON → `parseAIResult()` throws → exploration falls back to monolithic mode.
- **Fix:** (1) Moved output format instructions before data so they survive truncation. (2) Added `SUMMARY_DATA_BUDGET = 28KB` with key-file trimming. (3) Added markdown-fallback in `executePhase4Assembly()` — uses raw AI text as summary instead of failing.

---

## How to Add a Finding

```markdown
### OB-F### — Description here

- **Severity:** 🔴/🟠/🟡/🟢
- **Status:** Open
- **Key Files:** `file.ts`
- **Root Cause / Impact:**
  Why it matters.
- **Fix:** How to fix it.
```

Severity levels: 🔴 Critical | 🟠 High | 🟡 Medium | 🟢 Low

---

## Archive

143 findings fixed across v0.0.1–v0.0.14:
[V0](archive/v0/FINDINGS-v0.md) | [V2](archive/v2/FINDINGS-v2.md) | [V4](archive/v4/FINDINGS-v4.md) | [V5](archive/v5/FINDINGS-v5.md) | [V6](archive/v6/FINDINGS-v6.md) | [V7](archive/v7/FINDINGS-v7.md) | [V8](archive/v8/FINDINGS-v8.md) | [V15](archive/v15/FINDINGS-v15.md) | [V16](archive/v16/FINDINGS-v16.md) | [V17](archive/v17/FINDINGS-v17.md) | [V18](archive/v18/FINDINGS-v18.md) | [V19](archive/v19/FINDINGS-v19.md) | [V21](archive/v21/FINDINGS-v21.md)

---
