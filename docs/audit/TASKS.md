# OpenBridge — Task List

> **Pending:** 139 | **In Progress:** 0 | **Done:** 33 (112 archived)
> **Last Updated:** 2026-03-02

<details>
<summary>Archive (764 tasks completed across Phases 1–86 + Deep-1)</summary>

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

</details>

---

## Task Summary

| Phase  | Description                          | Tasks | Status          |
| ------ | ------------------------------------ | ----- | --------------- |
| RWT    | Real-World Testing Fixes (OB-F89–92) | 23    | ✅ (23/23 done) |
| Deep   | Deep Mode (OB-F56) — remaining       | 20    | ◻ (24/35 done)  |
| 82     | Tunnel Integration                   | 10    | ◻               |
| 83     | Ephemeral App Server                 | 12    | ◻               |
| 84     | Interaction Relay                    | 8     | ◻               |
| 87     | Document Visibility Controls         | 14    | ◻               |
| 88     | WebChat Frontend Extraction          | 15    | ◻               |
| 89     | WebChat Authentication               | 12    | ◻               |
| 90     | Phone Access + Mobile PWA            | 15    | ◻               |
| 91     | Conversation History + Rich Input    | 15    | ◻               |
| 92     | Settings Panel + Deep Mode UI        | 12    | ◻               |
| Docker | Docker Sandbox                       | 16    | ◻               |

**Completed (archived):** Sprint 1 (34), Sprint 2 (43), Sprint 3 (20), Deep-1 (15) = 112 tasks
**Sprint 4 Remaining:** 170 tasks (v0.0.12)

See [FUTURE.md](FUTURE.md) for Sprint 5 (v0.0.13) and [ROADMAP.md](../ROADMAP.md) for version milestones.

---

# Sprint 4: Platform Completion (v0.0.12) — 172 tasks

## Phase RWT — Real-World Testing Fixes (OB-F89–F92) — 23 tasks

> **Goal:** Fix critical issues discovered during first real-world test session (2026-03-02). Codex multi-AI delegation is broken (raw JSON output, wasted turns), RAG system returns nothing, classifier wastes tokens on text tasks. These fixes should run FIRST before other Sprint 4 work.

### RWT-1 — Codex Streaming Output Parsing (OB-F89) — 6 tasks

| #   | Task ID | Description                                                                                                                                                                                                                                                                       | Status  |
| --- | ------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------- |
| 1   | OB-1561 | Apply `parseOutput()` to final accumulated stdout in `execOnceStreaming()` in `src/core/agent-runner.ts` — after the streaming generator completes, check if `config.parseOutput` exists and apply it to `result.stdout` before returning. Same pattern as `execOnce()` line ~803 | ✅ Done |
| 2   | OB-1562 | Add Codex JSONL incremental parser in `src/core/adapters/codex-adapter.ts` — new `parseCodexStreamChunk()` that extracts human-readable text from streaming events: `type: "message"` content, `type: "command_execution"` output, `type: "reasoning"` text (if not hidden)       | ✅ Done |
| 3   | OB-1563 | Wire incremental parser into `spawnWithStreamingHandle()` — when adapter has a stream parser, transform chunks before yielding to progress callbacks. Users see readable text in real-time, not raw JSON                                                                          | ✅ Done |
| 4   | OB-1564 | Update `worker-result-formatter.ts` — add fallback: if worker result looks like raw JSONL (starts with `{"type":`), run it through `parseCodexJsonlOutput()` before formatting. Defensive guard for any missed paths                                                              | ✅ Done |
| 5   | OB-1565 | Verify `-o` tempfile fallback works for Codex streaming — Codex adapter adds `-o /tmp/file` flag. Check if tempfile is written during streaming mode and can be used as primary output source instead of stdout parsing                                                           | ✅ Done |
| 6   | OB-1566 | Add tests in `tests/core/agent-runner-codex-streaming.test.ts` — test: (1) execOnceStreaming applies parseOutput, (2) Codex JSONL chunks parsed to readable text, (3) spawnWithStreamingHandle returns parsed output, (4) raw JSONL fallback in formatter. At least 4 tests       | ✅ Done |

### RWT-2 — RAG Zero Results Fix (OB-F90) — 8 tasks

| #   | Task ID | Description                                                                                                                                                                                                                                                                             | Status  |
| --- | ------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------- |
| 7   | OB-1567 | Relax `buildSearchQuery()` in `src/core/knowledge-retriever.ts` — reduce minimum token length from 3 to 2 chars, trim stop word list to only true stop words (a, the, is, it, etc.), keep domain terms (api, ui, db, cli, ai). Add fallback: if all tokens filtered, use original query | ✅ Done |
| 8   | OB-1568 | Add WARN log when `buildSearchQuery()` produces empty query — log original question, filtered tokens, and reason (all stop words, all too short). Helps diagnose RAG failures in production                                                                                             | ✅ Done |
| 9   | OB-1569 | Ensure exploration stores chunks even when workspace map is reused — in `MasterManager.start()`, after "skipping exploration" path, verify FTS5 chunk count > 0. If zero, force chunk indexing from existing workspace map                                                              | ✅ Done |
| 10  | OB-1570 | Auto-store worker results in chunk store — in `master-manager.ts` after worker completes, call `knowledgeRetriever.storeWorkerResult()` automatically. Currently only called explicitly in some paths                                                                                   | ✅ Done |
| 11  | OB-1571 | Add startup diagnostic for RAG health — on MasterManager start, count chunks in FTS5 table. Log INFO with count. If zero, log WARN: "RAG has no indexed chunks — retrieval will return empty results"                                                                                   | ✅ Done |
| 12  | OB-1572 | Add `hybridSearch()` fallback — in `src/memory/retrieval.ts`, if sanitized FTS5 query is empty string, fall back to recent chunks by timestamp (last 20) instead of returning empty array                                                                                               | ✅ Done |
| 13  | OB-1573 | Wire workspace map content into chunk store on first load — when `readWorkspaceMapFromStore()` returns a map but `searchContext()` returns 0 chunks, index the map content as chunks so FTS5 has something to search                                                                    | ✅ Done |
| 14  | OB-1574 | Add tests in `tests/core/knowledge-retriever-rag.test.ts` — test: (1) buildSearchQuery keeps short domain terms, (2) empty query falls back to original, (3) WARN logged on empty query, (4) zero chunks triggers re-indexing, (5) hybridSearch fallback returns recent chunks. 5 tests | ✅ Done |

### RWT-3 — Codex Worker Tool Compatibility (OB-F91) — 5 tasks

| #   | Task ID | Description                                                                                                                                                                                                                                                                                 | Status  |
| --- | ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------- |
| 15  | OB-1575 | Audit Codex CLI `--allowedTools` support in `src/core/adapters/codex-adapter.ts` — verify which tool names Codex accepts. If different from Claude, add tool name mapping in the adapter. If unsupported, remove `--allowedTools` from Codex spawn config and rely on system prompt instead | ✅ Done |
| 16  | OB-1576 | Add Codex-specific worker system prompt prefix in `src/master/seed-prompts.ts` — when tool is codex, prepend: "Use file reading commands to read files. Do NOT use complex bash/shell scripts for file operations. Use simple, direct commands."                                            | ✅ Done |
| 17  | OB-1577 | Add tool profile validation per adapter — in `src/core/adapter-registry.ts`, each adapter declares supported profiles. If Codex doesn't support `read-only` tool restrictions, fall back to `full-access` with system prompt constraints instead of broken tool restrictions                | ✅ Done |
| 18  | OB-1578 | Limit Codex worker shell complexity — in Codex adapter, if `read-only` profile, add system prompt instruction: "For this task, only read files. Do not create or modify files. Do not run complex scripts. Keep commands simple and direct."                                                | ✅ Done |
| 19  | OB-1579 | Add tests in `tests/core/codex-worker-tools.test.ts` — test: (1) Codex adapter tool name mapping, (2) read-only profile adds system prompt constraints, (3) unsupported allowedTools handled gracefully, (4) worker prompt includes file-reading guidance. At least 4 tests                 | ✅ Done |

### RWT-4 — Classifier Text-Generation Fix (OB-F92) — 4 tasks

| #   | Task ID | Description                                                                                                                                                                                                                                                                                     | Status  |
| --- | ------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------- |
| 20  | OB-1580 | Add `text-generation` task class keywords in `classifyTaskByKeywords()` in `src/master/master-manager.ts` — keywords: generate, write, draft, compose, create post, tweet, linkedin, rewrite, rephrase, reformulate, shorter, longer, attractive. Map to quick-answer class (5 turns, no tools) | ✅ Done |
| 21  | OB-1581 | Change keyword fallback from `tool-use` to `quick-answer` — when no keywords match, default to quick-answer (5 turns) instead of tool-use (15 turns). Most unrecognized conversational messages don't need tools                                                                                | ✅ Done |
| 22  | OB-1582 | Add conversation context to classifier — if the last 3 messages were text-generation (writing posts, tweets), classify follow-up messages ("shorter", "better hook", "mix of 1 and 3") as text-generation too. Check conversation history in `buildConversationContext()`                       | ✅ Done |
| 23  | OB-1583 | Add text-generation test cases in `tests/master/classifier.test.ts` — test: (1) "generate LinkedIn post" → quick-answer, (2) "shorter version" → quick-answer, (3) "tweet for non-developers" → quick-answer, (4) fallback is quick-answer not tool-use. At least 4 tests                       | ✅ Done |

---

---

## Phase Deep — Deep Mode (OB-F56) — 35 tasks

> **Goal:** Add multi-phase execution for complex analysis tasks. Instead of single-pass, Deep Mode adds: investigate, report, plan, execute, verify phases with user steering. Three profiles: fast (current), thorough (multi-phase auto), manual (pauses at each phase).

### Phase Deep-1 — Core State Machine (10 tasks)

| #   | Task ID | Description                                                                                                                                                                                                                                                                                           | Status  |
| --- | ------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------- |
| 1   | OB-1397 | Define Deep Mode types in `src/types/agent.ts` — add ExecutionProfile type (fast, thorough, manual), DeepPhase type (investigate, report, plan, execute, verify), DeepModeState interface with profile, currentPhase, phaseResults map, startedAt, taskSummary                                        | ✅ Done |
| 2   | OB-1398 | Create `src/master/deep-mode.ts` — DeepModeManager class with MasterManager reference. Methods: startSession(), advancePhase(), getCurrentPhase(), getPhaseResult(), skipPhase(), focusOnItem(), isActive(), abort(). Manages phase state machine lifecycle                                           | ✅ Done |
| 3   | OB-1399 | Add phase transition logic to DeepModeManager — advancePhase() moves investigate to report to plan to execute to verify to done. Thorough profile auto-advances, manual profile pauses between phases, fast profile skips Deep Mode                                                                   | ✅ Done |
| 4   | OB-1400 | Add per-phase model selection — PHASE_MODEL_MAP: investigate=powerful, report=balanced, plan=powerful, execute=balanced, verify=fast. Model tier passed to Master session per phase. Users can override via config                                                                                    | ✅ Done |
| 5   | OB-1401 | Add per-phase system prompts — each phase gets focused injection: investigate (explore and identify), report (summarize findings), plan (create actionable plan), execute (implement the plan), verify (run tests and checks)                                                                         | ✅ Done |
| 6   | OB-1402 | Add `deep.defaultProfile` and `deep.phaseModels` config options to `src/types/config.ts` — defaultProfile: fast/thorough/manual (default: fast). phaseModels: per-phase model tier overrides                                                                                                          | ✅ Done |
| 7   | OB-1403 | Wire DeepModeManager into MasterManager — instantiate during init. In processMessage(), check task class and user profile to determine if Deep Mode should activate. If thorough or manual, create session and start with investigate phase                                                           | ✅ Done |
| 8   | OB-1404 | Add Deep Mode task class detection — in classifyTaskByKeywords(), add keywords: audit, deep analysis, thorough review, security review, full review, investigate. Set suggestDeepMode: true in classification result so Master can offer Deep Mode                                                    | ✅ Done |
| 9   | OB-1405 | Add Deep Mode state persistence — store active sessions in agent_activity table with type: deep-mode. On restart, check for incomplete sessions and offer resume. Store phase results in SQLite                                                                                                       | ✅ Done |
| 10  | OB-1406 | Add tests in `tests/master/deep-mode.test.ts` — test: (1) correct phase transition order, (2) manual pauses between phases, (3) thorough auto-advances, (4) fast skips Deep Mode, (5) skipPhase moves to next, (6) focusOnItem repeats investigation, (7) model selection per phase. At least 7 tests | ✅ Done |

### Phase Deep-2 — Interactive Commands (10 tasks)

| #   | Task ID | Description                                                                                                                                                                                                                                                                                | Status  |
| --- | ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------- |
| 11  | OB-1407 | Add `/deep` command to Router — starts Deep Mode or toggles on/off. Usage: /deep (toggle), /deep thorough, /deep manual, /deep off. Shows current status if already active                                                                                                                 | ✅ Done |
| 12  | OB-1408 | Add `/proceed` command to Router — advances to next Deep Mode phase. Responds with "No active Deep Mode session" if none active. In manual mode triggers next phase, in thorough mode is a no-op                                                                                           | ✅ Done |
| 13  | OB-1409 | Add `/focus N` command to Router — digs deeper into finding number N from current phase results. Spawns additional investigation worker focused on that specific item                                                                                                                      | ✅ Done |
| 14  | OB-1410 | Add `/skip N` command to Router — skips task/finding number N in current plan. Marks as skipped in Deep Mode state. Execute phase will not process skipped items                                                                                                                           | ✅ Done |
| 15  | OB-1411 | Add `/phase` command to Router — shows current phase and progress: phase name, completed phases, pending phases, profile name. Shows phase results summary for completed phases                                                                                                            | ✅ Done |
| 16  | OB-1412 | Add model override via chat — parse "use opus for task 1" or "use haiku for this" from user message. Override per-phase model for that specific task. Confirm the override to user                                                                                                         | ✅ Done |
| 17  | OB-1413 | Add natural language phase navigation — recognize "proceed", "go", "next", "continue" as /proceed. Recognize "focus on #3", "dig into finding 3" as /focus 3. Recognize "skip item 2" as /skip 2                                                                                           | ✅ Done |
| 18  | OB-1414 | Add Deep Mode progress events — emit progress events during phase transitions with type, phase, status, resultSummary. Wire into existing WebSocket progress broadcasting                                                                                                                  | ✅ Done |
| 19  | OB-1415 | Add phase transition messages — when phase completes, send summary to user with item count and summaries. Include guidance for next actions (proceed, focus on N, etc.) tailored per phase                                                                                                 | ✅ Done |
| 20  | OB-1416 | Add tests in `tests/core/router.test.ts` — test: (1) /deep thorough activates, (2) /proceed advances phase, (3) /focus 3 spawns focused investigation, (4) /skip 2 marks skipped, (5) /phase shows status, (6) natural language proceed works, (7) /deep off deactivates. At least 7 tests | ✅ Done |

### Phase Deep-3 — Phase-Aware Workers (10 tasks)

| #   | Task ID | Description                                                                                                                                                                                                                                                                                                                 | Status    |
| --- | ------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------- |
| 21  | OB-1417 | Create `DEEP_INVESTIGATE` worker prompt in `src/master/seed-prompts.ts` — instructions to explore codebase, identify relevant files, patterns, dependencies, potential issues. List every file examined. Categorize findings by type. Number each finding for reference                                                     | ✅ Done   |
| 22  | OB-1418 | Create `DEEP_REPORT` worker prompt — organize investigation findings into: Executive Summary, Detailed Findings (numbered with severity), Files Affected, Dependencies, Recommendations                                                                                                                                     | ✅ Done   |
| 23  | OB-1419 | Create `DEEP_PLAN` worker prompt — for each finding: task description, files to modify, estimated complexity, dependencies on other tasks, risk level. Order by dependency and priority, group into parallel batches                                                                                                        | ✅ Done   |
| 24  | OB-1420 | Create `DEEP_EXECUTE` worker prompt — execute specific task from plan with given files and constraints. Make minimum changes, run tests after, report changes and test results                                                                                                                                              | ✅ Done   |
| 25  | OB-1421 | Create `DEEP_VERIFY` worker prompt — run npm test, lint, typecheck, build. Report pass/fail for each. Identify cause of failures and which task introduced them                                                                                                                                                             | ✅ Done   |
| 26  | OB-1422 | Wire phase-specific prompts into DeepModeManager — use corresponding DEEP\_\* template per phase. Pass previous phase results as context: investigation feeds report, report feeds plan, plan feeds execute                                                                                                                 | ◻ Pending |
| 27  | OB-1423 | Add parallel execution in execute phase — when plan defines independent tasks (no dependencies), spawn multiple workers simultaneously. Respect WorkerRegistry concurrency limit. Collect all results before advancing to verify                                                                                            | ◻ Pending |
| 28  | OB-1424 | Add Deep Mode result aggregation — after all phases, compile final summary: phases completed, findings count, tasks executed, test results, executive summary. Send as final response                                                                                                                                       | ◻ Pending |
| 29  | OB-1425 | Add Deep Mode history persistence — store complete session in .openbridge/deep-mode/session-{timestamp}.json with all phase results, decisions, skipped items. Provides review and prompt evolution training data                                                                                                           | ◻ Pending |
| 30  | OB-1426 | Add tests in `tests/master/deep-mode.test.ts` — test: (1) investigation prompt includes task context, (2) report receives investigation results, (3) plan receives report, (4) execute spawns per plan, (5) verify runs checks, (6) parallel execution respects limits, (7) final summary includes counts. At least 7 tests | ◻ Pending |

### Phase Deep-4 — User Preferences & Polish (5 tasks)

| #   | Task ID | Description                                                                                                                                                                                              | Status    |
| --- | ------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------- |
| 31  | OB-1427 | Add per-user execution profile preferences to `src/memory/access-store.ts` — extend access entry with executionProfile: ExecutionProfile (default: fast). Persists across sessions                       | ◻ Pending |
| 32  | OB-1428 | Add per-user model preferences to access-store — extend with modelPreferences: Record per DeepPhase. Users can override default model for each phase. Persists across sessions                           | ◻ Pending |
| 33  | OB-1429 | Add Deep Mode documentation to Master system prompt — explain when to suggest Deep Mode: "For complex tasks (audits, reviews, large refactors), suggest Deep Mode to users" with example suggestion text | ◻ Pending |
| 34  | OB-1430 | Add Deep Mode to `/help` command output — include /deep, /proceed, /focus N, /skip N, /phase commands with brief descriptions                                                                            | ◻ Pending |
| 35  | OB-1431 | Build + lint + typecheck + test validation for Deep Mode — all 35 tasks must pass. Fix any failures                                                                                                      | ◻ Pending |

---

## Phase 82 — Tunnel Integration (OB-F69) — 10 tasks

> **Goal:** Expose local file-server to the internet so Master can send public URLs to mobile users. Auto-detect cloudflared/ngrok/localtunnel.

| #   | Task ID | Description                                                                                                                                                                                                                                                                                 | Status    |
| --- | ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------- |
| 1   | OB-1432 | Auto-detect tunnel tools in `src/discovery/tool-scanner.ts` — add cloudflared, ngrok, localtunnel to detection list using which. Add metadata: name, version command, priority (cloudflared > ngrok > localtunnel). Return in scan results                                                  | ◻ Pending |
| 2   | OB-1433 | Create `src/core/tunnel-manager.ts` — TunnelManager class with methods: start(port) returns public URL, stop(), getUrl(), isActive(). Constructor takes detected tunnel tool name and optional config                                                                                       | ◻ Pending |
| 3   | OB-1434 | Implement cloudflared tunnel adapter — spawn `cloudflared tunnel --url localhost:{port}` as child process. Parse public URL from stdout. Handle errors and unexpected exits. Preferred — free, no signup                                                                                    | ◻ Pending |
| 4   | OB-1435 | Implement ngrok tunnel adapter — spawn `ngrok http {port}`. Query ngrok API at localhost:4040 for public URL. Handle auth token requirement. Fallback if cloudflared unavailable                                                                                                            | ◻ Pending |
| 5   | OB-1436 | Wire TunnelManager into Bridge startup in `src/core/bridge.ts` — if tunnel tool detected and tunnel.enabled is true, start tunnel during initialization. Store and log public URL                                                                                                           | ◻ Pending |
| 6   | OB-1437 | Update file-server to return public URL in `src/core/file-server.ts` — add setPublicUrl() method. getFileUrl() returns tunnel URL when active, localhost otherwise                                                                                                                          | ◻ Pending |
| 7   | OB-1438 | Update Master system prompt with tunnel capability — when tunnel active, add public URL info. When not active, note files only accessible on localhost                                                                                                                                      | ◻ Pending |
| 8   | OB-1439 | Add auto-cleanup tunnel on process exit — register exit and SIGINT handlers that call tunnelManager.stop(). Also call during Bridge graceful shutdown                                                                                                                                       | ◻ Pending |
| 9   | OB-1440 | Add tunnel config to `src/types/config.ts` — tunnel section: enabled (default: false), provider (auto/cloudflared/ngrok, default: auto), subdomain (optional). Add to schema and config.example.json                                                                                        | ◻ Pending |
| 10  | OB-1441 | Add tests in `tests/core/tunnel-manager.test.ts` — test: (1) start() spawns with correct args, (2) stop() kills process, (3) getUrl() null when not started, (4) getUrl() returns URL after start, (5) isActive() correct state, (6) exit handler registered. At least 6 tests (mock spawn) | ◻ Pending |

---

## Phase 83 — Ephemeral App Server (OB-F69) — 12 tasks

> **Goal:** Enable workers to scaffold interactive web apps that OpenBridge manages and serves. Workers create app files in `.openbridge/generated/apps/`, the AppServer detects and serves them.

| #   | Task ID | Description                                                                                                                                                                                                                                                       | Status    |
| --- | ------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------- |
| 1   | OB-1442 | Create `src/core/app-server.ts` — AppServer class with methods: startApp(appPath) returns AppInstance, stopApp(appId), listApps(), getApp(appId). AppInstance type: id, port, url, publicUrl, status, startedAt                                                   | ◻ Pending |
| 2   | OB-1443 | Add app scaffold detection — detect app type from directory: package.json with start script uses npm start, index.html uses static serve, server.js uses node. Return detected run command                                                                        | ◻ Pending |
| 3   | OB-1444 | Add app lifecycle — startApp: spawn process, health check (HTTP GET), set running. Add idle timeout: no requests in 30 min triggers auto-stop. stopApp: kill process, cleanup port                                                                                | ◻ Pending |
| 4   | OB-1445 | Add port allocation — assign unique ports in range 3100-3199. Track in Set. Release on stopApp. Scan for in-use ports on startup                                                                                                                                  | ◻ Pending |
| 5   | OB-1446 | Add tunnel integration for apps — when TunnelManager active, create tunnel for each app port. Store publicUrl in AppInstance. Stop tunnel when app stops                                                                                                          | ◻ Pending |
| 6   | OB-1447 | Add APP:start and APP:stop marker parsing to Router in `src/core/router.ts` — parse from Master output. APP:start triggers appServer.startApp(), APP:stop triggers stopApp(). Include app URL in response                                                         | ◻ Pending |
| 7   | OB-1448 | Add app scaffolding instructions to Master system prompt — guidance for creating apps in .openbridge/generated/apps/{name}/, using APP:start marker to launch                                                                                                     | ◻ Pending |
| 8   | OB-1449 | Add `TASK_BUILD_APP` seed prompt template to `src/master/seed-prompts.ts` — instructions for creating self-contained web apps with index.html, styles.css, JavaScript                                                                                             | ◻ Pending |
| 9   | OB-1450 | Add `/apps` command to Router — shows running apps with URLs and public URLs. Shows "No apps running" if none active                                                                                                                                              | ◻ Pending |
| 10  | OB-1451 | Add graceful app cleanup to Bridge shutdown — stop all running apps via appServer.stopAll(). Add stopAll() method to AppServer                                                                                                                                    | ◻ Pending |
| 11  | OB-1452 | Add resource limits to config — apps.maxConcurrent (default: 5), apps.maxMemoryMB (default: 256), apps.idleTimeoutMinutes (default: 30). Wire into AppServer                                                                                                      | ◻ Pending |
| 12  | OB-1453 | Add tests in `tests/core/app-server.test.ts` — test: (1) startApp with static HTML, (2) unique port allocation, (3) stopApp releases port, (4) idle timeout stops app, (5) listApps correct, (6) max concurrent enforced, (7) stopAll stops all. At least 7 tests | ◻ Pending |

---

## Phase 84 — Interaction Relay (OB-F69) — 8 tasks

> **Goal:** Enable bidirectional communication between served apps and the Master AI. Apps send data to Master, Master pushes updates back.

| #   | Task ID | Description                                                                                                                                                                                                                                                                          | Status    |
| --- | ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------- |
| 1   | OB-1454 | Create `src/core/interaction-relay.ts` — InteractionRelay class. WebSocket server on port 3099. Accept connections from served apps. Route messages between apps and Master. Methods: start(), stop(), sendToApp(), onAppMessage()                                                   | ◻ Pending |
| 2   | OB-1455 | Create openbridge-client.js SDK — small JS library auto-injected into served apps. Provides openbridge.submit(data) and openbridge.onUpdate(callback). Connects via WebSocket to relay. Auto-detects relay URL                                                                       | ◻ Pending |
| 3   | OB-1456 | Wire app interactions into Router — relay messages from apps route to Master as special messages with type app-interaction, appId, and data                                                                                                                                          | ◻ Pending |
| 4   | OB-1457 | Add Master response routing for apps in MasterManager — parse APP:update markers from Master response, send data to app via relay sendToApp()                                                                                                                                        | ◻ Pending |
| 5   | OB-1458 | Add client SDK methods — submit() sends JSON, onUpdate() registers handler, request() for request-response patterns (sends and waits for matching response)                                                                                                                          | ◻ Pending |
| 6   | OB-1459 | Add security to relay — only accept connections from known app origins. Reject unknown origins. Per-app authentication token generated during startApp()                                                                                                                             | ◻ Pending |
| 7   | OB-1460 | Add Smart Output Router to Master system prompt — guidance for auto-classifying output: data returns JSON, visualizations create HTML with charts, reports create HTML with print CSS, interactive tools use openbridge-client.js                                                    | ◻ Pending |
| 8   | OB-1461 | Add tests in `tests/core/interaction-relay.test.ts` — test: (1) relay starts WebSocket server, (2) app connects and sends message, (3) relay routes to Master, (4) sendToApp delivers data, (5) unknown origins rejected, (6) relay stops cleanly. At least 6 tests (mock WebSocket) | ◻ Pending |

---

## Phase 87 — Document Visibility Controls (OB-F72) — 14 tasks

> **Goal:** Control what the AI can see in the workspace. Detect and protect sensitive files. Add include/exclude rules and optional content redaction.

| #   | Task ID | Description                                                                                                                                                                                                                                                                                                                                        | Status    |
| --- | ------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------- |
| 1   | OB-1462 | Add workspace.include and workspace.exclude to config schema in `src/types/config.ts` — include: optional glob array (only these visible), exclude: optional glob array (hidden from AI). Both support standard glob syntax                                                                                                                        | ◻ Pending |
| 2   | OB-1463 | Add DEFAULT*EXCLUDE_PATTERNS to `src/types/config.ts` — .env, .env.*, _.pem, _.key, _.p12, _.pfx, credentials.\_, secrets/, id_rsa*, id_ed25519*, \*.sqlite, .git/objects/, node_modules/, .DS_Store. Always excluded unless user overrides                                                                                                        | ◻ Pending |
| 3   | OB-1464 | Add isFileVisible(filePath, config) to `src/core/workspace-manager.ts` — check against include/exclude rules. File must match at least one include (if set) and must not match any exclude. Exclude takes priority                                                                                                                                 | ◻ Pending |
| 4   | OB-1465 | Add symlink resolution in isFileVisible() — resolve real path with fs.realpath() before checking. Prevents symlink escape to files outside workspace                                                                                                                                                                                               | ◻ Pending |
| 5   | OB-1466 | Normalize paths with path.resolve() before scope checks — ensure both file path and workspace root are absolute. Prevents path traversal like ../../etc/passwd                                                                                                                                                                                     | ◻ Pending |
| 6   | OB-1467 | Create `src/core/secret-scanner.ts` — SecretScanner class with scanWorkspace(workspacePath) method. Scans root (1 level deep) for files matching sensitive patterns. Returns array of { path, pattern, severity }. Name check only, no content reading                                                                                             | ◻ Pending |
| 7   | OB-1468 | Add sensitive file patterns to SecretScanner — .env (any), _.pem, _.key, _.p12, _.pfx, service-account*.json, credentials*.json, id*rsa*, id_ed25519*, *.jks, \_.kdbx. Severity: critical (keys/certs), high (credentials), medium (config)                                                                                                        | ◻ Pending |
| 8   | OB-1469 | Add startup secret scanning to Bridge in `src/core/bridge.ts` — run scanner during init, log warning with detected count and paths. Auto-add detected paths to exclude list for current session                                                                                                                                                    | ◻ Pending |
| 9   | OB-1470 | Create `src/core/content-redactor.ts` — ContentRedactor class with redact(content) method returning { redacted, redactionCount }. Optional feature, disabled by default                                                                                                                                                                            | ◻ Pending |
| 10  | OB-1471 | Add redaction patterns — OpenAI keys (sk-...), AWS keys (AKIA...), GitHub PATs (ghp*..., ghs*...), PEM private keys, connection strings (mongodb://, postgres://, mysql://). Replace matches with REDACTED:{pattern_name}                                                                                                                          | ◻ Pending |
| 11  | OB-1472 | Add `/scope` command to Router — shows current visibility rules and detected secrets with severity. Shows "No sensitive files detected" if clean                                                                                                                                                                                                   | ◻ Pending |
| 12  | OB-1473 | Add visibility preferences to setup wizard in `src/cli/init.ts` — ask "Would you like to auto-detect and hide sensitive files? (recommended)" during init. Save to config                                                                                                                                                                          | ◻ Pending |
| 13  | OB-1474 | Update Master system prompt with visibility info — list hidden file patterns. Instruct Master to ask user for content from hidden files if needed                                                                                                                                                                                                  | ◻ Pending |
| 14  | OB-1475 | Add tests in workspace-manager, secret-scanner, content-redactor test files — test: (1) .env excluded by default, (2) include limits visible files, (3) exclude takes priority, (4) symlinks outside workspace rejected, (5) path traversal blocked, (6) scanner detects .env and \*.pem, (7) redactor replaces API key patterns. At least 7 tests | ◻ Pending |

---

## Phase 88 — WebChat Frontend Extraction (OB-F73, OB-F74) — 15 tasks

> **Goal:** Extract WebChat UI from inlined HTML string into proper component files with dark mode, markdown rendering, syntax highlighting, and build pipeline.

| #   | Task ID | Description                                                                                                                                                                                                                                    | Status    |
| --- | ------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------- |
| 1   | OB-1476 | Create `src/connectors/webchat/ui/` directory structure — ui/, ui/js/, ui/css/. Holds extracted frontend files replacing inlined HTML string                                                                                                   | ◻ Pending |
| 2   | OB-1477 | Extract HTML into `src/connectors/webchat/ui/index.html` — proper DOCTYPE, meta viewport, semantic HTML5, links to external CSS and JS                                                                                                         | ◻ Pending |
| 3   | OB-1478 | Extract CSS into `ui/css/styles.css` — CSS custom properties for theming (--bg-primary, --text-primary, --accent, etc.). Light theme as default                                                                                                | ◻ Pending |
| 4   | OB-1479 | Add dark theme CSS variables — data-theme="dark" selector with dark colors. Toggle button in header. Persist in localStorage. Apply before render to prevent flash                                                                             | ◻ Pending |
| 5   | OB-1480 | Extract JS into modular files — ui/js/app.js (main logic), websocket.js (connection), markdown.js (rendering), dashboard.js (status). Use ES modules                                                                                           | ◻ Pending |
| 6   | OB-1481 | Replace markdown splitter with marked library in markdown.js — bundle marked (no CDN). Configure gfm, breaks. Handle code blocks, links, lists, tables, blockquotes                                                                            | ◻ Pending |
| 7   | OB-1482 | Add syntax highlighting with highlight.js core — bundle with common languages (js, ts, python, bash, json, html, css, sql). Register as marked extension. Dark-compatible theme                                                                | ◻ Pending |
| 8   | OB-1483 | Add copy button on code blocks — inject Copy button top-right of code blocks. navigator.clipboard.writeText() on click. Show "Copied!" for 2s                                                                                                  | ◻ Pending |
| 9   | OB-1484 | Add collapsible sections for long responses — wrap responses over 500 chars in collapsible container. Show first 200 chars with "Show more" button. Smooth height transition                                                                   | ◻ Pending |
| 10  | OB-1485 | Create build script `scripts/build-webchat-ui.js` — esbuild bundles ui/ into single HTML string. Bundle JS, inline CSS and JS into HTML, write as TypeScript constant in ui-bundle.ts. Add npm run build:webchat script                        | ◻ Pending |
| 11  | OB-1486 | Update webchat-connector.ts to load bundled HTML — import WEBCHAT_HTML from ui-bundle.ts instead of inline string. Build step must run before main TS compilation                                                                              | ◻ Pending |
| 12  | OB-1487 | Add ARIA labels and keyboard navigation — aria-label on all interactive elements. Tab cycles, Enter sends, Escape clears. role="log" on messages, role="status" on indicators                                                                  | ◻ Pending |
| 13  | OB-1488 | Add message timestamps — relative time on each message ("2m ago"). Hover for absolute time. Option to always show. Update every minute                                                                                                         | ◻ Pending |
| 14  | OB-1489 | Add user/AI avatars — CSS-only icons for visual distinction. Different background colors per sender. Subtle entrance animation on new messages                                                                                                 | ◻ Pending |
| 15  | OB-1490 | Add tests in `tests/connectors/webchat/webchat-ui.test.ts` — test: (1) bundled HTML serves with 200, (2) contains required elements, (3) dark mode toggle, (4) markdown code blocks, (5) build script generates valid bundle. At least 5 tests | ◻ Pending |

---

## Phase 89 — WebChat Authentication (OB-F73) — 12 tasks

> **Goal:** Add authentication to WebChat for safe exposure beyond localhost. Token auth, password auth, session management, rate limiting.

| #   | Task ID | Description                                                                                                                                                                                                                                                                    | Status    |
| --- | ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------- |
| 1   | OB-1491 | Generate random auth token on first startup — crypto.randomBytes(32).toString("hex"). Persist in .openbridge/webchat-token. Read existing on subsequent starts                                                                                                                 | ◻ Pending |
| 2   | OB-1492 | Display auth token and URL in console on startup — log WebChat URL with token for easy copy-paste. Include in Bridge startup summary                                                                                                                                           | ◻ Pending |
| 3   | OB-1493 | Show QR code in console with authenticated URL — ASCII QR code for phone scanning. Use qrcode-terminal or similar library                                                                                                                                                      | ◻ Pending |
| 4   | OB-1494 | Validate token on HTTP requests — check query param or Authorization header. Reject with 401 if invalid. Allow session cookie after initial validation                                                                                                                         | ◻ Pending |
| 5   | OB-1495 | Validate token on WebSocket upgrade — check token in WebSocket URL query string. Reject upgrade with 401 if invalid                                                                                                                                                            | ◻ Pending |
| 6   | OB-1496 | Add optional password auth — webchat.password config field. If set, show login screen instead of token. Hash with bcrypt before comparison                                                                                                                                     | ◻ Pending |
| 7   | OB-1497 | Create login screen UI — password input, submit, error message area. Match WebChat theme. POST to /api/webchat/login                                                                                                                                                           | ◻ Pending |
| 8   | OB-1498 | Add session management — HTTP-only cookie with session ID on successful auth. Sessions expire after 24 hours. crypto.randomUUID() for IDs                                                                                                                                      | ◻ Pending |
| 9   | OB-1499 | Map WebChat users to access-store — create/update entry with channel: webchat, default role, budget on authentication                                                                                                                                                          | ◻ Pending |
| 10  | OB-1500 | Add per-IP rate limiting on login — track failures per IP. After 5 in 15 min, block for 30 min. Return 429. In-memory Map with TTL                                                                                                                                             | ◻ Pending |
| 11  | OB-1501 | Add webchat.auth section to config.example.json — examples for token auth, password auth, disabled auth                                                                                                                                                                        | ◻ Pending |
| 12  | OB-1502 | Add tests in `tests/connectors/webchat/webchat-auth.test.ts` — test: (1) valid token allows, (2) invalid returns 401, (3) password login flow, (4) session cookie set, (5) WebSocket rejects invalid, (6) rate limit after 5 failures, (7) rate limit resets. At least 7 tests | ◻ Pending |

---

## Phase 90 — Phone Access + Mobile PWA (OB-F75) — 15 tasks

> **Goal:** Make WebChat accessible from phone (LAN + internet). PWA support, push notifications, responsive design.

| #   | Task ID | Description                                                                                                                                                                                                                                                  | Status    |
| --- | ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------- |
| 1   | OB-1503 | Change default host from localhost to 0.0.0.0 in webchat config — binds to all interfaces for LAN access. Keep localhost as config fallback                                                                                                                  | ◻ Pending |
| 2   | OB-1504 | Auto-detect local IP addresses on startup — use os.networkInterfaces() for non-internal IPv4. Display LAN URL in console. Handle multiple interfaces                                                                                                         | ◻ Pending |
| 3   | OB-1505 | Display QR code with authenticated LAN URL — for phone scanning. Prefer tunnel URL for QR if tunnel active                                                                                                                                                   | ◻ Pending |
| 4   | OB-1506 | Display public URL in console and WebChat header when tunnel active — add copy button next to URL in header. Show both LAN and public URLs in console                                                                                                        | ◻ Pending |
| 5   | OB-1507 | Add "Share this link" button in WebChat header — copies current URL to clipboard. Toast notification "Link copied!" Uses navigator.clipboard with fallback                                                                                                   | ◻ Pending |
| 6   | OB-1508 | Add manifest.json for PWA — app name, short name, start URL, standalone display, theme color, icon placeholders. Serve via webchat connector                                                                                                                 | ◻ Pending |
| 7   | OB-1509 | Add service worker — cache HTML/CSS/JS shell for offline. Show "Reconnecting..." on WebSocket disconnect. Handle push notifications. Register in app.js                                                                                                      | ◻ Pending |
| 8   | OB-1510 | Add responsive CSS — mobile (< 768px): full-width, no padding, large targets. Desktop: centered card with max-width. Handle landscape                                                                                                                        | ◻ Pending |
| 9   | OB-1511 | Add touch-friendly sizing — 44px minimum tap targets. Larger send button on mobile. 8px gap between tappable elements. Prevent text selection on buttons                                                                                                     | ◻ Pending |
| 10  | OB-1512 | Add iOS safe area insets — env(safe-area-inset-\*) for notch and home indicator. Apply to input area, header, container. viewport-fit=cover on meta tag                                                                                                      | ◻ Pending |
| 11  | OB-1513 | Add browser notifications on task completion — request Notification.requestPermission(). Show notification when task completes and tab unfocused                                                                                                             | ◻ Pending |
| 12  | OB-1514 | Add tab title updates — show unread count "(3) OpenBridge" when unfocused. Reset on focus. Use document.visibilityState API                                                                                                                                  | ◻ Pending |
| 13  | OB-1515 | Add sound notification on response — Web Audio API notification sound when AI responds. Mute toggle in header (speaker icon). Persist in localStorage                                                                                                        | ◻ Pending |
| 14  | OB-1516 | Add "Add to Home Screen" prompt on first mobile visit — detect mobile, check not installed. Show banner to add PWA. Dismiss permanently on close                                                                                                             | ◻ Pending |
| 15  | OB-1517 | Add tests in `tests/connectors/webchat/webchat-mobile.test.ts` — test: (1) LAN IP detection, (2) QR generation, (3) manifest serves, (4) service worker registration, (5) responsive media queries exist, (6) 0.0.0.0 binding configurable. At least 6 tests | ◻ Pending |

---

## Phase 91 — Conversation History + Rich Input (OB-F74) — 15 tasks

> **Goal:** Add conversation history sidebar, file upload, voice input, slash command autocomplete to WebChat.

| #   | Task ID | Description                                                                                                                                                                                                                                                                                                   | Status    |
| --- | ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------- |
| 1   | OB-1518 | Add sidebar component in ui/js/sidebar.js — slide-out panel (left). Hidden on mobile, toggleable via hamburger. Desktop: optionally always visible (300px). Contains conversation list and search                                                                                                             | ◻ Pending |
| 2   | OB-1519 | Fetch past conversations — add GET /api/sessions endpoint to webchat-connector.ts returning session list from conversation-store: id, title, date, messageCount                                                                                                                                               | ◻ Pending |
| 3   | OB-1520 | Display session list in sidebar — each session as card with title, relative date, message count. Most recent first. Highlight current session                                                                                                                                                                 | ◻ Pending |
| 4   | OB-1521 | Click session to load transcript — add GET /api/sessions/{id} endpoint returning full conversation messages. Clear and render loaded transcript on click                                                                                                                                                      | ◻ Pending |
| 5   | OB-1522 | Add "New conversation" button — starts fresh session with new ID. Clears message area. Sends WebSocket message to create new backend session                                                                                                                                                                  | ◻ Pending |
| 6   | OB-1523 | Add search across conversations — search input at top of sidebar. GET /api/sessions/search?q={query} uses FTS5. Display matching messages with context and highlighted terms                                                                                                                                  | ◻ Pending |
| 7   | OB-1524 | Persist current conversation in localStorage — save on each new message. Restore on refresh. Clear on new session. Limit to last 100 messages                                                                                                                                                                 | ◻ Pending |
| 8   | OB-1525 | Switch input to textarea — Shift+Enter for newline, Enter to send. Auto-resize height (max 6 lines). Show character count over 500 chars                                                                                                                                                                      | ◻ Pending |
| 9   | OB-1526 | Add file upload button — paperclip icon next to send. Click opens file picker. Support drag-and-drop. Show preview (name, size, type) before sending                                                                                                                                                          | ◻ Pending |
| 10  | OB-1527 | Add file upload backend — POST /api/upload accepts multipart, stores in .openbridge/uploads/. Send path to Master. Limit 10MB. Return file ID                                                                                                                                                                 | ◻ Pending |
| 11  | OB-1528 | Add voice input button — microphone icon. MediaRecorder API for recording. Pulsing dot indicator. Send audio to existing voice transcription endpoint. Show transcribed text in input for review                                                                                                              | ◻ Pending |
| 12  | OB-1529 | Add slash command autocomplete in ui/js/autocomplete.js — show dropdown on "/". Commands: /history, /stop, /status, /deep, /audit, /scope, /apps, /help, /doctor, /confirm, /skip. Filter as typed. Arrow keys and Enter to select                                                                            | ◻ Pending |
| 13  | OB-1530 | Populate autocomplete from Router — GET /api/commands returns available commands with descriptions. Autocomplete fetches on load. Cache command list                                                                                                                                                          | ◻ Pending |
| 14  | OB-1531 | Add feedback buttons on AI responses — thumbs up/down below each AI message. POST /api/feedback with session, message, rating. Feed into prompt evolution. Show "Thanks!" toast                                                                                                                               | ◻ Pending |
| 15  | OB-1532 | Add tests in `tests/connectors/webchat/webchat-history.test.ts` — test: (1) /api/sessions returns list, (2) /api/sessions/{id} returns messages, (3) search uses FTS5, (4) upload accepts multipart, (5) size limit enforced, (6) autocomplete returns commands, (7) feedback stores rating. At least 7 tests | ◻ Pending |

---

## Phase 92 — Settings Panel + Deep Mode UI (OB-F74) — 12 tasks

> **Goal:** In-app settings panel and Deep Mode phase navigation UI for non-developer users.

| #   | Task ID | Description                                                                                                                                                                                                                                             | Status    |
| --- | ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------- |
| 1   | OB-1533 | Add settings panel in ui/js/settings.js — gear icon in header opens slide-out panel (right). Contains: AI tool selector, execution profile, notifications, theme. Close on outside click or Escape                                                      | ◻ Pending |
| 2   | OB-1534 | Settings: AI tool selector — dropdown of discovered tools (Claude, Codex, etc.) with versions from GET /api/discovery. Changes preferred tool for session                                                                                               | ◻ Pending |
| 3   | OB-1535 | Settings: execution profile selector — radio buttons for fast, thorough, manual with descriptions. Persist in localStorage and sync via PUT /api/webchat/settings                                                                                       | ◻ Pending |
| 4   | OB-1536 | Settings: notification preferences — checkboxes for sound and browser notifications. Persist in localStorage. Apply immediately                                                                                                                         | ◻ Pending |
| 5   | OB-1537 | Settings: theme toggle — light/dark switch. Same as header toggle but grouped with other settings. Persist in localStorage                                                                                                                              | ◻ Pending |
| 6   | OB-1538 | Add settings REST API — GET/PUT /api/webchat/settings. Store in localStorage client-side, optionally persist server-side in access-store. Validate with schema                                                                                          | ◻ Pending |
| 7   | OB-1539 | Add Deep Mode stepper UI in ui/js/deep-mode.js — horizontal progress bar with 5 phase dots: Investigate, Report, Plan, Execute, Verify. Current phase highlighted. Completed phases show checkmark. Appears when Deep Mode active                       | ◻ Pending |
| 8   | OB-1540 | Add phase action buttons — Proceed (green), Focus on # dropdown, Skip # dropdown. Send commands via WebSocket. Disable when not applicable                                                                                                              | ◻ Pending |
| 9   | OB-1541 | Render phase transitions as special cards — styled card with phase icon, name, status, collapsible result summary. Different colors per phase. Animate transitions                                                                                      | ◻ Pending |
| 10  | OB-1542 | Wire phase events from WebSocket — listen for deep-mode progress messages. Update stepper, show/hide buttons, render phase cards. Handle reconnection mid-Deep-Mode                                                                                     | ◻ Pending |
| 11  | OB-1543 | Restore MCP management UI — re-implement REST routes (GET/POST/DELETE/PUT toggle for /api/mcp/servers) or restore from git. Wire to mcp-registry.ts backend. Simple server list panel from settings                                                     | ◻ Pending |
| 12  | OB-1544 | Add tests in `tests/connectors/webchat/webchat-settings.test.ts` — test: (1) settings GET returns defaults, (2) PUT saves values, (3) Deep Mode events update stepper, (4) MCP endpoints respond, (5) settings persist across reloads. At least 5 tests | ◻ Pending |

---

## Phase Docker — Docker Sandbox (OB-193) — 16 tasks

> **Goal:** Run workers in Docker containers for untrusted/shared workspaces. Completes security boundary with env var protection and document visibility. Auto-detect Docker, build images, manage containers.

| #   | Task ID | Description                                                                                                                                                                                                                                                                                                 | Status    |
| --- | ------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------- |
| 1   | OB-1545 | Create `src/core/docker-sandbox.ts` — DockerSandbox class with methods: createContainer(), startContainer(), stopContainer(), removeContainer(), exec(), isAvailable(). Uses docker CLI via child_process, no SDK dependency                                                                                | ◻ Pending |
| 2   | OB-1546 | Add Docker detection to `src/discovery/tool-scanner.ts` — check for docker in PATH, verify daemon running with docker info. Report version and status. Handle: not installed, installed but no daemon, available                                                                                            | ◻ Pending |
| 3   | OB-1547 | Create `docker/Dockerfile.worker` — based on node:22-slim. Install claude CLI. Set /workspace working directory. Non-root user. Keep image < 500MB                                                                                                                                                          | ◻ Pending |
| 4   | OB-1548 | Add buildImage() to DockerSandbox — build worker image from Dockerfile.worker. Tag as openbridge-worker:latest. Cache layers. Skip if image exists                                                                                                                                                          | ◻ Pending |
| 5   | OB-1549 | Add workspace volume mounting — workspace as read-only (-v workspace:/workspace:ro). .openbridge/ as read-write for outputs. Validate mount paths                                                                                                                                                           | ◻ Pending |
| 6   | OB-1550 | Add network isolation — default --network none. Config: none (isolated), host (full), bridge (Docker only). Default none for max security                                                                                                                                                                   | ◻ Pending |
| 7   | OB-1551 | Add resource limits — --memory 512m, --cpus 1, --pids-limit 100 defaults. Config options for each. Kill container if exceeded                                                                                                                                                                               | ◻ Pending |
| 8   | OB-1552 | Add sandbox config to `src/types/config.ts` — security.sandbox section: mode (none/docker/bubblewrap, default: none), network, memoryMB, cpus. Zod validation                                                                                                                                               | ◻ Pending |
| 9   | OB-1553 | Wire sandbox into AgentRunner.spawn() — when mode is docker, spawn worker inside container. Build docker run command with volumes, env vars (sanitized), limits, and worker command. Capture stdout/stderr                                                                                                  | ◻ Pending |
| 10  | OB-1554 | Add container cleanup on worker completion — stop and remove container after exit. Timeout: maxTurns \* 30s force-kills container. Clean dangling containers on bridge startup                                                                                                                              | ◻ Pending |
| 11  | OB-1555 | Pass sanitized env vars through sandbox — use --env-file or -e flags for allowed vars only. Integrate with env sanitizer from Phase 85                                                                                                                                                                      | ◻ Pending |
| 12  | OB-1556 | Forward MCP config into container — mount temp MCP config as read-only. Pass --mcp-config inside container. Maintain per-worker isolation                                                                                                                                                                   | ◻ Pending |
| 13  | OB-1557 | Add startup health check — verify Docker daemon running before enabling sandbox. If unavailable, warn and fall back to unsandboxed. Recheck every 5 min                                                                                                                                                     | ◻ Pending |
| 14  | OB-1558 | Add fallback in AgentRunner — if docker mode set but Docker unavailable, fall back to direct spawn with warning. Never silently fail                                                                                                                                                                        | ◻ Pending |
| 15  | OB-1559 | Add tests in `tests/core/docker-sandbox.test.ts` — test: (1) isAvailable checks daemon, (2) createContainer builds correct command, (3) workspace read-only, (4) .openbridge read-write, (5) env vars sanitized, (6) resource limits applied, (7) cleanup after exit. At least 7 tests (mock child_process) | ◻ Pending |
| 16  | OB-1560 | Build + lint + typecheck + test validation for Sprint 4 — all 172 tasks must pass before tagging v0.0.12. Fix any failures                                                                                                                                                                                  | ◻ Pending |

---
