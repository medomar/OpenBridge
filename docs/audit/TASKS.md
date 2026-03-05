# OpenBridge — Task List

> **Pending:** 51 | **In Progress:** 0 | **Done:** 230 (112 archived)
> **Last Updated:** 2026-03-05

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
| Deep   | Deep Mode (OB-F56) — remaining       | 20    | ✅ (35/35 done) |
| 97     | Runtime Permission Escalation        | 20    | ✅ (20/20 done) |
| 98     | Batch Task Continuation              | 22    | ✅ (22/22 done) |
| 82     | Tunnel Integration                   | 10    | ✅ (10/10 done) |
| 83     | Ephemeral App Server                 | 12    | ✅ (12/12 done) |
| 84     | Interaction Relay                    | 8     | ✅ (8/8 done)   |
| 87     | Document Visibility Controls         | 14    | ✅ (14/14 done) |
| 88     | WebChat Frontend Extraction          | 15    | ✅ (15/15 done) |
| 89     | WebChat Authentication               | 12    | ✅ (12/12 done) |
| 90     | Phone Access + Mobile PWA            | 15    | ✅ (15/15 done) |
| 91     | Conversation History + Rich Input    | 15    | ✅ (15/15 done) |
| 92     | Settings Panel + Deep Mode UI        | 12    | ✅ (12/12 done) |
| Docker | Docker Sandbox                       | 16    | ✅ (16/16 done) |
| 99     | Escalation Queue & Orphan Fixes      | 22    | ◻               |
| 100    | Classification & RAG Fixes           | 16    | ◻               |
| 101    | Batch & Shutdown Safety              | 7     | ◻               |
| 102    | Worker & Cost Controls               | 8     | ◻               |
| 103    | Docker & Startup Polish              | 9     | ◻               |
| 104    | Test Suite Fixes (Stale Mocks)       | 5     | ◻               |

**Completed (archived):** Sprint 1 (34), Sprint 2 (43), Sprint 3 (20), Deep-1 (15) = 112 tasks
**Sprint 4 Remaining:** 277 tasks (v0.0.12) — includes Phases 97–104 (runtime fixes from production testing)

See [FUTURE.md](FUTURE.md) for Sprint 5 (v0.0.13), Sprint 6 (v0.0.14), and [ROADMAP.md](../ROADMAP.md) for version milestones.

---

# Sprint 4: Platform Completion (v0.0.12) — 210 tasks

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

| #   | Task ID | Description                                                                                                                                                                                                                                                                                                                 | Status  |
| --- | ------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------- |
| 21  | OB-1417 | Create `DEEP_INVESTIGATE` worker prompt in `src/master/seed-prompts.ts` — instructions to explore codebase, identify relevant files, patterns, dependencies, potential issues. List every file examined. Categorize findings by type. Number each finding for reference                                                     | ✅ Done |
| 22  | OB-1418 | Create `DEEP_REPORT` worker prompt — organize investigation findings into: Executive Summary, Detailed Findings (numbered with severity), Files Affected, Dependencies, Recommendations                                                                                                                                     | ✅ Done |
| 23  | OB-1419 | Create `DEEP_PLAN` worker prompt — for each finding: task description, files to modify, estimated complexity, dependencies on other tasks, risk level. Order by dependency and priority, group into parallel batches                                                                                                        | ✅ Done |
| 24  | OB-1420 | Create `DEEP_EXECUTE` worker prompt — execute specific task from plan with given files and constraints. Make minimum changes, run tests after, report changes and test results                                                                                                                                              | ✅ Done |
| 25  | OB-1421 | Create `DEEP_VERIFY` worker prompt — run npm test, lint, typecheck, build. Report pass/fail for each. Identify cause of failures and which task introduced them                                                                                                                                                             | ✅ Done |
| 26  | OB-1422 | Wire phase-specific prompts into DeepModeManager — use corresponding DEEP\_\* template per phase. Pass previous phase results as context: investigation feeds report, report feeds plan, plan feeds execute                                                                                                                 | ✅ Done |
| 27  | OB-1423 | Add parallel execution in execute phase — when plan defines independent tasks (no dependencies), spawn multiple workers simultaneously. Respect WorkerRegistry concurrency limit. Collect all results before advancing to verify                                                                                            | ✅ Done |
| 28  | OB-1424 | Add Deep Mode result aggregation — after all phases, compile final summary: phases completed, findings count, tasks executed, test results, executive summary. Send as final response                                                                                                                                       | ✅ Done |
| 29  | OB-1425 | Add Deep Mode history persistence — store complete session in .openbridge/deep-mode/session-{timestamp}.json with all phase results, decisions, skipped items. Provides review and prompt evolution training data                                                                                                           | ✅ Done |
| 30  | OB-1426 | Add tests in `tests/master/deep-mode.test.ts` — test: (1) investigation prompt includes task context, (2) report receives investigation results, (3) plan receives report, (4) execute spawns per plan, (5) verify runs checks, (6) parallel execution respects limits, (7) final summary includes counts. At least 7 tests | ✅ Done |

### Phase Deep-4 — User Preferences & Polish (5 tasks)

| #   | Task ID | Description                                                                                                                                                                                              | Status  |
| --- | ------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------- |
| 31  | OB-1427 | Add per-user execution profile preferences to `src/memory/access-store.ts` — extend access entry with executionProfile: ExecutionProfile (default: fast). Persists across sessions                       | ✅ Done |
| 32  | OB-1428 | Add per-user model preferences to access-store — extend with modelPreferences: Record per DeepPhase. Users can override default model for each phase. Persists across sessions                           | ✅ Done |
| 33  | OB-1429 | Add Deep Mode documentation to Master system prompt — explain when to suggest Deep Mode: "For complex tasks (audits, reviews, large refactors), suggest Deep Mode to users" with example suggestion text | ✅ Done |
| 34  | OB-1430 | Add Deep Mode to `/help` command output — include /deep, /proceed, /focus N, /skip N, /phase commands with brief descriptions                                                                            | ✅ Done |
| 35  | OB-1431 | Build + lint + typecheck + test validation for Deep Mode — all 35 tasks must pass. Fix any failures                                                                                                      | ✅ Done |

---

## Phase 82 — Tunnel Integration (OB-F69) — 10 tasks

> **Goal:** Expose local file-server to the internet so Master can send public URLs to mobile users. Auto-detect cloudflared/ngrok/localtunnel.

| #   | Task ID | Description                                                                                                                                                                                                                                                                                 | Status  |
| --- | ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------- |
| 1   | OB-1432 | Auto-detect tunnel tools in `src/discovery/tool-scanner.ts` — add cloudflared, ngrok, localtunnel to detection list using which. Add metadata: name, version command, priority (cloudflared > ngrok > localtunnel). Return in scan results                                                  | ✅ Done |
| 2   | OB-1433 | Create `src/core/tunnel-manager.ts` — TunnelManager class with methods: start(port) returns public URL, stop(), getUrl(), isActive(). Constructor takes detected tunnel tool name and optional config                                                                                       | ✅ Done |
| 3   | OB-1434 | Implement cloudflared tunnel adapter — spawn `cloudflared tunnel --url localhost:{port}` as child process. Parse public URL from stdout. Handle errors and unexpected exits. Preferred — free, no signup                                                                                    | ✅ Done |
| 4   | OB-1435 | Implement ngrok tunnel adapter — spawn `ngrok http {port}`. Query ngrok API at localhost:4040 for public URL. Handle auth token requirement. Fallback if cloudflared unavailable                                                                                                            | ✅ Done |
| 5   | OB-1436 | Wire TunnelManager into Bridge startup in `src/core/bridge.ts` — if tunnel tool detected and tunnel.enabled is true, start tunnel during initialization. Store and log public URL                                                                                                           | ✅ Done |
| 6   | OB-1437 | Update file-server to return public URL in `src/core/file-server.ts` — add setPublicUrl() method. getFileUrl() returns tunnel URL when active, localhost otherwise                                                                                                                          | ✅ Done |
| 7   | OB-1438 | Update Master system prompt with tunnel capability — when tunnel active, add public URL info. When not active, note files only accessible on localhost                                                                                                                                      | ✅ Done |
| 8   | OB-1439 | Add auto-cleanup tunnel on process exit — register exit and SIGINT handlers that call tunnelManager.stop(). Also call during Bridge graceful shutdown                                                                                                                                       | ✅ Done |
| 9   | OB-1440 | Add tunnel config to `src/types/config.ts` — tunnel section: enabled (default: false), provider (auto/cloudflared/ngrok, default: auto), subdomain (optional). Add to schema and config.example.json                                                                                        | ✅ Done |
| 10  | OB-1441 | Add tests in `tests/core/tunnel-manager.test.ts` — test: (1) start() spawns with correct args, (2) stop() kills process, (3) getUrl() null when not started, (4) getUrl() returns URL after start, (5) isActive() correct state, (6) exit handler registered. At least 6 tests (mock spawn) | ✅ Done |

---

## Phase 83 — Ephemeral App Server (OB-F69) — 12 tasks

> **Goal:** Enable workers to scaffold interactive web apps that OpenBridge manages and serves. Workers create app files in `.openbridge/generated/apps/`, the AppServer detects and serves them.

| #   | Task ID | Description                                                                                                                                                                                                                                                       | Status  |
| --- | ------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------- |
| 1   | OB-1442 | Create `src/core/app-server.ts` — AppServer class with methods: startApp(appPath) returns AppInstance, stopApp(appId), listApps(), getApp(appId). AppInstance type: id, port, url, publicUrl, status, startedAt                                                   | ✅ Done |
| 2   | OB-1443 | Add app scaffold detection — detect app type from directory: package.json with start script uses npm start, index.html uses static serve, server.js uses node. Return detected run command                                                                        | ✅ Done |
| 3   | OB-1444 | Add app lifecycle — startApp: spawn process, health check (HTTP GET), set running. Add idle timeout: no requests in 30 min triggers auto-stop. stopApp: kill process, cleanup port                                                                                | ✅ Done |
| 4   | OB-1445 | Add port allocation — assign unique ports in range 3100-3199. Track in Set. Release on stopApp. Scan for in-use ports on startup                                                                                                                                  | ✅ Done |
| 5   | OB-1446 | Add tunnel integration for apps — when TunnelManager active, create tunnel for each app port. Store publicUrl in AppInstance. Stop tunnel when app stops                                                                                                          | ✅ Done |
| 6   | OB-1447 | Add APP:start and APP:stop marker parsing to Router in `src/core/router.ts` — parse from Master output. APP:start triggers appServer.startApp(), APP:stop triggers stopApp(). Include app URL in response                                                         | ✅ Done |
| 7   | OB-1448 | Add app scaffolding instructions to Master system prompt — guidance for creating apps in .openbridge/generated/apps/{name}/, using APP:start marker to launch                                                                                                     | ✅ Done |
| 8   | OB-1449 | Add `TASK_BUILD_APP` seed prompt template to `src/master/seed-prompts.ts` — instructions for creating self-contained web apps with index.html, styles.css, JavaScript                                                                                             | ✅ Done |
| 9   | OB-1450 | Add `/apps` command to Router — shows running apps with URLs and public URLs. Shows "No apps running" if none active                                                                                                                                              | ✅ Done |
| 10  | OB-1451 | Add graceful app cleanup to Bridge shutdown — stop all running apps via appServer.stopAll(). Add stopAll() method to AppServer                                                                                                                                    | ✅ Done |
| 11  | OB-1452 | Add resource limits to config — apps.maxConcurrent (default: 5), apps.maxMemoryMB (default: 256), apps.idleTimeoutMinutes (default: 30). Wire into AppServer                                                                                                      | ✅ Done |
| 12  | OB-1453 | Add tests in `tests/core/app-server.test.ts` — test: (1) startApp with static HTML, (2) unique port allocation, (3) stopApp releases port, (4) idle timeout stops app, (5) listApps correct, (6) max concurrent enforced, (7) stopAll stops all. At least 7 tests | ✅ Done |

---

## Phase 84 — Interaction Relay (OB-F69) — 8 tasks

> **Goal:** Enable bidirectional communication between served apps and the Master AI. Apps send data to Master, Master pushes updates back.

| #   | Task ID | Description                                                                                                                                                                                                                                                                          | Status  |
| --- | ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------- |
| 1   | OB-1454 | Create `src/core/interaction-relay.ts` — InteractionRelay class. WebSocket server on port 3099. Accept connections from served apps. Route messages between apps and Master. Methods: start(), stop(), sendToApp(), onAppMessage()                                                   | ✅ Done |
| 2   | OB-1455 | Create openbridge-client.js SDK — small JS library auto-injected into served apps. Provides openbridge.submit(data) and openbridge.onUpdate(callback). Connects via WebSocket to relay. Auto-detects relay URL                                                                       | ✅ Done |
| 3   | OB-1456 | Wire app interactions into Router — relay messages from apps route to Master as special messages with type app-interaction, appId, and data                                                                                                                                          | ✅ Done |
| 4   | OB-1457 | Add Master response routing for apps in MasterManager — parse APP:update markers from Master response, send data to app via relay sendToApp()                                                                                                                                        | ✅ Done |
| 5   | OB-1458 | Add client SDK methods — submit() sends JSON, onUpdate() registers handler, request() for request-response patterns (sends and waits for matching response)                                                                                                                          | ✅ Done |
| 6   | OB-1459 | Add security to relay — only accept connections from known app origins. Reject unknown origins. Per-app authentication token generated during startApp()                                                                                                                             | ✅ Done |
| 7   | OB-1460 | Add Smart Output Router to Master system prompt — guidance for auto-classifying output: data returns JSON, visualizations create HTML with charts, reports create HTML with print CSS, interactive tools use openbridge-client.js                                                    | ✅ Done |
| 8   | OB-1461 | Add tests in `tests/core/interaction-relay.test.ts` — test: (1) relay starts WebSocket server, (2) app connects and sends message, (3) relay routes to Master, (4) sendToApp delivers data, (5) unknown origins rejected, (6) relay stops cleanly. At least 6 tests (mock WebSocket) | ✅ Done |

---

## Phase 87 — Document Visibility Controls (OB-F72) — 14 tasks

> **Goal:** Control what the AI can see in the workspace. Detect and protect sensitive files. Add include/exclude rules and optional content redaction.

| #   | Task ID | Description                                                                                                                                                                                                                                                                                                                                        | Status  |
| --- | ------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------- |
| 1   | OB-1462 | Add workspace.include and workspace.exclude to config schema in `src/types/config.ts` — include: optional glob array (only these visible), exclude: optional glob array (hidden from AI). Both support standard glob syntax                                                                                                                        | ✅ Done |
| 2   | OB-1463 | Add DEFAULT*EXCLUDE_PATTERNS to `src/types/config.ts` — .env, .env.*, _.pem, _.key, _.p12, _.pfx, credentials.\_, secrets/, id_rsa*, id_ed25519*, \*.sqlite, .git/objects/, node_modules/, .DS_Store. Always excluded unless user overrides                                                                                                        | ✅ Done |
| 3   | OB-1464 | Add isFileVisible(filePath, config) to `src/core/workspace-manager.ts` — check against include/exclude rules. File must match at least one include (if set) and must not match any exclude. Exclude takes priority                                                                                                                                 | ✅ Done |
| 4   | OB-1465 | Add symlink resolution in isFileVisible() — resolve real path with fs.realpath() before checking. Prevents symlink escape to files outside workspace                                                                                                                                                                                               | ✅ Done |
| 5   | OB-1466 | Normalize paths with path.resolve() before scope checks — ensure both file path and workspace root are absolute. Prevents path traversal like ../../etc/passwd                                                                                                                                                                                     | ✅ Done |
| 6   | OB-1467 | Create `src/core/secret-scanner.ts` — SecretScanner class with scanWorkspace(workspacePath) method. Scans root (1 level deep) for files matching sensitive patterns. Returns array of { path, pattern, severity }. Name check only, no content reading                                                                                             | ✅ Done |
| 7   | OB-1468 | Add sensitive file patterns to SecretScanner — .env (any), _.pem, _.key, _.p12, _.pfx, service-account*.json, credentials*.json, id*rsa*, id_ed25519*, *.jks, \_.kdbx. Severity: critical (keys/certs), high (credentials), medium (config)                                                                                                        | ✅ Done |
| 8   | OB-1469 | Add startup secret scanning to Bridge in `src/core/bridge.ts` — run scanner during init, log warning with detected count and paths. Auto-add detected paths to exclude list for current session                                                                                                                                                    | ✅ Done |
| 9   | OB-1470 | Create `src/core/content-redactor.ts` — ContentRedactor class with redact(content) method returning { redacted, redactionCount }. Optional feature, disabled by default                                                                                                                                                                            | ✅ Done |
| 10  | OB-1471 | Add redaction patterns — OpenAI keys (sk-...), AWS keys (AKIA...), GitHub PATs (ghp*..., ghs*...), PEM private keys, connection strings (mongodb://, postgres://, mysql://). Replace matches with REDACTED:{pattern_name}                                                                                                                          | ✅ Done |
| 11  | OB-1472 | Add `/scope` command to Router — shows current visibility rules and detected secrets with severity. Shows "No sensitive files detected" if clean                                                                                                                                                                                                   | ✅ Done |
| 12  | OB-1473 | Add visibility preferences to setup wizard in `src/cli/init.ts` — ask "Would you like to auto-detect and hide sensitive files? (recommended)" during init. Save to config                                                                                                                                                                          | ✅ Done |
| 13  | OB-1474 | Update Master system prompt with visibility info — list hidden file patterns. Instruct Master to ask user for content from hidden files if needed                                                                                                                                                                                                  | ✅ Done |
| 14  | OB-1475 | Add tests in workspace-manager, secret-scanner, content-redactor test files — test: (1) .env excluded by default, (2) include limits visible files, (3) exclude takes priority, (4) symlinks outside workspace rejected, (5) path traversal blocked, (6) scanner detects .env and \*.pem, (7) redactor replaces API key patterns. At least 7 tests | ✅ Done |

---

## Phase 88 — WebChat Frontend Extraction (OB-F73, OB-F74) — 15 tasks

> **Goal:** Extract WebChat UI from inlined HTML string into proper component files with dark mode, markdown rendering, syntax highlighting, and build pipeline.

| #   | Task ID | Description                                                                                                                                                                                                                                    | Status  |
| --- | ------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------- |
| 1   | OB-1476 | Create `src/connectors/webchat/ui/` directory structure — ui/, ui/js/, ui/css/. Holds extracted frontend files replacing inlined HTML string                                                                                                   | ✅ Done |
| 2   | OB-1477 | Extract HTML into `src/connectors/webchat/ui/index.html` — proper DOCTYPE, meta viewport, semantic HTML5, links to external CSS and JS                                                                                                         | ✅ Done |
| 3   | OB-1478 | Extract CSS into `ui/css/styles.css` — CSS custom properties for theming (--bg-primary, --text-primary, --accent, etc.). Light theme as default                                                                                                | ✅ Done |
| 4   | OB-1479 | Add dark theme CSS variables — data-theme="dark" selector with dark colors. Toggle button in header. Persist in localStorage. Apply before render to prevent flash                                                                             | ✅ Done |
| 5   | OB-1480 | Extract JS into modular files — ui/js/app.js (main logic), websocket.js (connection), markdown.js (rendering), dashboard.js (status). Use ES modules                                                                                           | ✅ Done |
| 6   | OB-1481 | Replace markdown splitter with marked library in markdown.js — bundle marked (no CDN). Configure gfm, breaks. Handle code blocks, links, lists, tables, blockquotes                                                                            | ✅ Done |
| 7   | OB-1482 | Add syntax highlighting with highlight.js core — bundle with common languages (js, ts, python, bash, json, html, css, sql). Register as marked extension. Dark-compatible theme                                                                | ✅ Done |
| 8   | OB-1483 | Add copy button on code blocks — inject Copy button top-right of code blocks. navigator.clipboard.writeText() on click. Show "Copied!" for 2s                                                                                                  | ✅ Done |
| 9   | OB-1484 | Add collapsible sections for long responses — wrap responses over 500 chars in collapsible container. Show first 200 chars with "Show more" button. Smooth height transition                                                                   | ✅ Done |
| 10  | OB-1485 | Create build script `scripts/build-webchat-ui.js` — esbuild bundles ui/ into single HTML string. Bundle JS, inline CSS and JS into HTML, write as TypeScript constant in ui-bundle.ts. Add npm run build:webchat script                        | ✅ Done |
| 11  | OB-1486 | Update webchat-connector.ts to load bundled HTML — import WEBCHAT_HTML from ui-bundle.ts instead of inline string. Build step must run before main TS compilation                                                                              | ✅ Done |
| 12  | OB-1487 | Add ARIA labels and keyboard navigation — aria-label on all interactive elements. Tab cycles, Enter sends, Escape clears. role="log" on messages, role="status" on indicators                                                                  | ✅ Done |
| 13  | OB-1488 | Add message timestamps — relative time on each message ("2m ago"). Hover for absolute time. Option to always show. Update every minute                                                                                                         | ✅ Done |
| 14  | OB-1489 | Add user/AI avatars — CSS-only icons for visual distinction. Different background colors per sender. Subtle entrance animation on new messages                                                                                                 | ✅ Done |
| 15  | OB-1490 | Add tests in `tests/connectors/webchat/webchat-ui.test.ts` — test: (1) bundled HTML serves with 200, (2) contains required elements, (3) dark mode toggle, (4) markdown code blocks, (5) build script generates valid bundle. At least 5 tests | ✅ Done |

---

## Phase 89 — WebChat Authentication (OB-F73) — 12 tasks

> **Goal:** Add authentication to WebChat for safe exposure beyond localhost. Token auth, password auth, session management, rate limiting.

| #   | Task ID | Description                                                                                                                                                                                                                                                                    | Status  |
| --- | ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------- |
| 1   | OB-1491 | Generate random auth token on first startup — crypto.randomBytes(32).toString("hex"). Persist in .openbridge/webchat-token. Read existing on subsequent starts                                                                                                                 | ✅ Done |
| 2   | OB-1492 | Display auth token and URL in console on startup — log WebChat URL with token for easy copy-paste. Include in Bridge startup summary                                                                                                                                           | ✅ Done |
| 3   | OB-1493 | Show QR code in console with authenticated URL — ASCII QR code for phone scanning. Use qrcode-terminal or similar library                                                                                                                                                      | ✅ Done |
| 4   | OB-1494 | Validate token on HTTP requests — check query param or Authorization header. Reject with 401 if invalid. Allow session cookie after initial validation                                                                                                                         | ✅ Done |
| 5   | OB-1495 | Validate token on WebSocket upgrade — check token in WebSocket URL query string. Reject upgrade with 401 if invalid                                                                                                                                                            | ✅ Done |
| 6   | OB-1496 | Add optional password auth — webchat.password config field. If set, show login screen instead of token. Hash with bcrypt before comparison                                                                                                                                     | ✅ Done |
| 7   | OB-1497 | Create login screen UI — password input, submit, error message area. Match WebChat theme. POST to /api/webchat/login                                                                                                                                                           | ✅ Done |
| 8   | OB-1498 | Add session management — HTTP-only cookie with session ID on successful auth. Sessions expire after 24 hours. crypto.randomUUID() for IDs                                                                                                                                      | ✅ Done |
| 9   | OB-1499 | Map WebChat users to access-store — create/update entry with channel: webchat, default role, budget on authentication                                                                                                                                                          | ✅ Done |
| 10  | OB-1500 | Add per-IP rate limiting on login — track failures per IP. After 5 in 15 min, block for 30 min. Return 429. In-memory Map with TTL                                                                                                                                             | ✅ Done |
| 11  | OB-1501 | Add webchat.auth section to config.example.json — examples for token auth, password auth, disabled auth                                                                                                                                                                        | ✅ Done |
| 12  | OB-1502 | Add tests in `tests/connectors/webchat/webchat-auth.test.ts` — test: (1) valid token allows, (2) invalid returns 401, (3) password login flow, (4) session cookie set, (5) WebSocket rejects invalid, (6) rate limit after 5 failures, (7) rate limit resets. At least 7 tests | ✅ Done |

---

## Phase 90 — Phone Access + Mobile PWA (OB-F75) — 15 tasks

> **Goal:** Make WebChat accessible from phone (LAN + internet). PWA support, push notifications, responsive design.

| #   | Task ID | Description                                                                                                                                                                                                                                                  | Status  |
| --- | ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------- |
| 1   | OB-1503 | Change default host from localhost to 0.0.0.0 in webchat config — binds to all interfaces for LAN access. Keep localhost as config fallback                                                                                                                  | ✅ Done |
| 2   | OB-1504 | Auto-detect local IP addresses on startup — use os.networkInterfaces() for non-internal IPv4. Display LAN URL in console. Handle multiple interfaces                                                                                                         | ✅ Done |
| 3   | OB-1505 | Display QR code with authenticated LAN URL — for phone scanning. Prefer tunnel URL for QR if tunnel active                                                                                                                                                   | ✅ Done |
| 4   | OB-1506 | Display public URL in console and WebChat header when tunnel active — add copy button next to URL in header. Show both LAN and public URLs in console                                                                                                        | ✅ Done |
| 5   | OB-1507 | Add "Share this link" button in WebChat header — copies current URL to clipboard. Toast notification "Link copied!" Uses navigator.clipboard with fallback                                                                                                   | ✅ Done |
| 6   | OB-1508 | Add manifest.json for PWA — app name, short name, start URL, standalone display, theme color, icon placeholders. Serve via webchat connector                                                                                                                 | ✅ Done |
| 7   | OB-1509 | Add service worker — cache HTML/CSS/JS shell for offline. Show "Reconnecting..." on WebSocket disconnect. Handle push notifications. Register in app.js                                                                                                      | ✅ Done |
| 8   | OB-1510 | Add responsive CSS — mobile (< 768px): full-width, no padding, large targets. Desktop: centered card with max-width. Handle landscape                                                                                                                        | ✅ Done |
| 9   | OB-1511 | Add touch-friendly sizing — 44px minimum tap targets. Larger send button on mobile. 8px gap between tappable elements. Prevent text selection on buttons                                                                                                     | ✅ Done |
| 10  | OB-1512 | Add iOS safe area insets — env(safe-area-inset-\*) for notch and home indicator. Apply to input area, header, container. viewport-fit=cover on meta tag                                                                                                      | ✅ Done |
| 11  | OB-1513 | Add browser notifications on task completion — request Notification.requestPermission(). Show notification when task completes and tab unfocused                                                                                                             | ✅ Done |
| 12  | OB-1514 | Add tab title updates — show unread count "(3) OpenBridge" when unfocused. Reset on focus. Use document.visibilityState API                                                                                                                                  | ✅ Done |
| 13  | OB-1515 | Add sound notification on response — Web Audio API notification sound when AI responds. Mute toggle in header (speaker icon). Persist in localStorage                                                                                                        | ✅ Done |
| 14  | OB-1516 | Add "Add to Home Screen" prompt on first mobile visit — detect mobile, check not installed. Show banner to add PWA. Dismiss permanently on close                                                                                                             | ✅ Done |
| 15  | OB-1517 | Add tests in `tests/connectors/webchat/webchat-mobile.test.ts` — test: (1) LAN IP detection, (2) QR generation, (3) manifest serves, (4) service worker registration, (5) responsive media queries exist, (6) 0.0.0.0 binding configurable. At least 6 tests | ✅ Done |

---

## Phase 91 — Conversation History + Rich Input (OB-F74) — 15 tasks

> **Goal:** Add conversation history sidebar, file upload, voice input, slash command autocomplete to WebChat.

| #   | Task ID | Description                                                                                                                                                                                                                                                                                                   | Status  |
| --- | ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------- |
| 1   | OB-1518 | Add sidebar component in ui/js/sidebar.js — slide-out panel (left). Hidden on mobile, toggleable via hamburger. Desktop: optionally always visible (300px). Contains conversation list and search                                                                                                             | ✅ Done |
| 2   | OB-1519 | Fetch past conversations — add GET /api/sessions endpoint to webchat-connector.ts returning session list from conversation-store: id, title, date, messageCount                                                                                                                                               | ✅ Done |
| 3   | OB-1520 | Display session list in sidebar — each session as card with title, relative date, message count. Most recent first. Highlight current session                                                                                                                                                                 | ✅ Done |
| 4   | OB-1521 | Click session to load transcript — add GET /api/sessions/{id} endpoint returning full conversation messages. Clear and render loaded transcript on click                                                                                                                                                      | ✅ Done |
| 5   | OB-1522 | Add "New conversation" button — starts fresh session with new ID. Clears message area. Sends WebSocket message to create new backend session                                                                                                                                                                  | ✅ Done |
| 6   | OB-1523 | Add search across conversations — search input at top of sidebar. GET /api/sessions/search?q={query} uses FTS5. Display matching messages with context and highlighted terms                                                                                                                                  | ✅ Done |
| 7   | OB-1524 | Persist current conversation in localStorage — save on each new message. Restore on refresh. Clear on new session. Limit to last 100 messages                                                                                                                                                                 | ✅ Done |
| 8   | OB-1525 | Switch input to textarea — Shift+Enter for newline, Enter to send. Auto-resize height (max 6 lines). Show character count over 500 chars                                                                                                                                                                      | ✅ Done |
| 9   | OB-1526 | Add file upload button — paperclip icon next to send. Click opens file picker. Support drag-and-drop. Show preview (name, size, type) before sending                                                                                                                                                          | ✅ Done |
| 10  | OB-1527 | Add file upload backend — POST /api/upload accepts multipart, stores in .openbridge/uploads/. Send path to Master. Limit 10MB. Return file ID                                                                                                                                                                 | ✅ Done |
| 11  | OB-1528 | Add voice input button — microphone icon. MediaRecorder API for recording. Pulsing dot indicator. Send audio to existing voice transcription endpoint. Show transcribed text in input for review                                                                                                              | ✅ Done |
| 12  | OB-1529 | Add slash command autocomplete in ui/js/autocomplete.js — show dropdown on "/". Commands: /history, /stop, /status, /deep, /audit, /scope, /apps, /help, /doctor, /confirm, /skip. Filter as typed. Arrow keys and Enter to select                                                                            | ✅ Done |
| 13  | OB-1530 | Populate autocomplete from Router — GET /api/commands returns available commands with descriptions. Autocomplete fetches on load. Cache command list                                                                                                                                                          | ✅ Done |
| 14  | OB-1531 | Add feedback buttons on AI responses — thumbs up/down below each AI message. POST /api/feedback with session, message, rating. Feed into prompt evolution. Show "Thanks!" toast                                                                                                                               | ✅ Done |
| 15  | OB-1532 | Add tests in `tests/connectors/webchat/webchat-history.test.ts` — test: (1) /api/sessions returns list, (2) /api/sessions/{id} returns messages, (3) search uses FTS5, (4) upload accepts multipart, (5) size limit enforced, (6) autocomplete returns commands, (7) feedback stores rating. At least 7 tests | ✅ Done |

---

## Phase 92 — Settings Panel + Deep Mode UI (OB-F74) — 12 tasks

> **Goal:** In-app settings panel and Deep Mode phase navigation UI for non-developer users.

| #   | Task ID | Description                                                                                                                                                                                                                                             | Status  |
| --- | ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------- |
| 1   | OB-1533 | Add settings panel in ui/js/settings.js — gear icon in header opens slide-out panel (right). Contains: AI tool selector, execution profile, notifications, theme. Close on outside click or Escape                                                      | ✅ Done |
| 2   | OB-1534 | Settings: AI tool selector — dropdown of discovered tools (Claude, Codex, etc.) with versions from GET /api/discovery. Changes preferred tool for session                                                                                               | ✅ Done |
| 3   | OB-1535 | Settings: execution profile selector — radio buttons for fast, thorough, manual with descriptions. Persist in localStorage and sync via PUT /api/webchat/settings                                                                                       | ✅ Done |
| 4   | OB-1536 | Settings: notification preferences — checkboxes for sound and browser notifications. Persist in localStorage. Apply immediately                                                                                                                         | ✅ Done |
| 5   | OB-1537 | Settings: theme toggle — light/dark switch. Same as header toggle but grouped with other settings. Persist in localStorage                                                                                                                              | ✅ Done |
| 6   | OB-1538 | Add settings REST API — GET/PUT /api/webchat/settings. Store in localStorage client-side, optionally persist server-side in access-store. Validate with schema                                                                                          | ✅ Done |
| 7   | OB-1539 | Add Deep Mode stepper UI in ui/js/deep-mode.js — horizontal progress bar with 5 phase dots: Investigate, Report, Plan, Execute, Verify. Current phase highlighted. Completed phases show checkmark. Appears when Deep Mode active                       | ✅ Done |
| 8   | OB-1540 | Add phase action buttons — Proceed (green), Focus on # dropdown, Skip # dropdown. Send commands via WebSocket. Disable when not applicable                                                                                                              | ✅ Done |
| 9   | OB-1541 | Render phase transitions as special cards — styled card with phase icon, name, status, collapsible result summary. Different colors per phase. Animate transitions                                                                                      | ✅ Done |
| 10  | OB-1542 | Wire phase events from WebSocket — listen for deep-mode progress messages. Update stepper, show/hide buttons, render phase cards. Handle reconnection mid-Deep-Mode                                                                                     | ✅ Done |
| 11  | OB-1543 | Restore MCP management UI — re-implement REST routes (GET/POST/DELETE/PUT toggle for /api/mcp/servers) or restore from git. Wire to mcp-registry.ts backend. Simple server list panel from settings                                                     | ✅ Done |
| 12  | OB-1544 | Add tests in `tests/connectors/webchat/webchat-settings.test.ts` — test: (1) settings GET returns defaults, (2) PUT saves values, (3) Deep Mode events update stepper, (4) MCP endpoints respond, (5) settings persist across reloads. At least 5 tests | ✅ Done |

---

## Phase 97 — Runtime Permission Escalation (OB-F93) — 20 tasks

> **Goal:** Allow workers to request elevated tool access at runtime. Users grant/deny via chat. Grants can be one-time, session-scoped, or permanent. Extends existing consent flow. **Priority: High — enables OpenBridge to self-improve by requesting the tools it needs instead of failing silently.**

### 97-1 — Escalation Queue & Router Commands (~8 tasks)

| #   | Task ID | Description                                                                                                                                                                                                                                                             | Status  |
| --- | ------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------- |
| 1   | OB-1584 | Add `PendingEscalation` interface in `src/core/router.ts` — fields: workerId, requestedTools (string[]), currentProfile, reason (string from worker failure), message (original InboundMessage), connector, timeoutHandle. Add `pendingEscalations` Map keyed by sender | ✅ Done |
| 2   | OB-1585 | Add `requestToolEscalation()` method to Router — sends escalation prompt to user: "Worker {id} needs {tools} access for: {reason}. Reply '/allow {tool}' or '/allow {profile}' to grant, '/deny' to reject." Sets 60s auto-deny timeout                                 | ✅ Done |
| 3   | OB-1586 | Add `/allow` command handler in Router — parse `/allow Bash(npm:test)` (single tool) or `/allow code-edit` (profile upgrade). Support scope suffix: `/allow code-edit --permanent`, `/allow Bash(npm:test) --session`. Default scope: `once`                            | ✅ Done |
| 4   | OB-1587 | Add `/deny` command handler in Router — reject pending escalation, notify Master to continue without the tool or abort the worker. Remove from pendingEscalations map                                                                                                   | ✅ Done |
| 5   | OB-1588 | Add escalation grant scopes — `once` (applies to current worker only), `session` (all workers this session, stored in-memory Map), `permanent` (stored in access_control DB). Wire each scope into the grant logic                                                      | ✅ Done |
| 6   | OB-1589 | Add `/permissions` command to Router — show current user's permanent tool grants, session grants, and consent mode. Lists all approved escalations with grant date                                                                                                      | ✅ Done |
| 7   | OB-1590 | Add escalation timeout handling — auto-deny after 60s with message "Escalation timed out — worker continuing with current profile." Log the timeout                                                                                                                     | ✅ Done |
| 8   | OB-1591 | Add escalation commands to `/help` output — include /allow, /deny, /permissions with brief descriptions                                                                                                                                                                 | ✅ Done |

### 97-2 — Master Failure Detection & Re-Spawn (~6 tasks)

| #   | Task ID | Description                                                                                                                                                                                                                                           | Status  |
| --- | ------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------- |
| 9   | OB-1592 | Add tool-access failure detection in `src/master/master-manager.ts` — after worker completes, check if result contains "tool not allowed", "permission denied", or "not in allowedTools". Extract the tool name from the error message                | ✅ Done |
| 10  | OB-1593 | Wire failure detection to Router escalation — when tool-access failure detected, call `router.requestToolEscalation()` with worker context. If user grants, respawn the worker with upgraded profile/tools                                            | ✅ Done |
| 11  | OB-1594 | Add worker re-spawn after grant — when user approves escalation, spawn a new worker with the same prompt but upgraded allowedTools. Merge granted tools with original profile tools. Log the upgrade                                                  | ✅ Done |
| 12  | OB-1595 | Add pre-flight tool prediction in MasterManager — before spawning, analyze task prompt for tool-related keywords (test, lint, build, deploy, install). If predicted tools exceed profile, request upfront escalation instead of failing mid-execution | ✅ Done |
| 13  | OB-1596 | Add session tool grants cache — in-memory Map of `sender → Set<grantedTools>` cleared on Bridge restart. Workers auto-receive session-granted tools without re-asking                                                                                 | ✅ Done |
| 14  | OB-1597 | Add system prompt guidance for escalation — update Master system prompt: "If a worker fails due to tool restrictions, request escalation from the user. Explain what tool is needed and why."                                                         | ✅ Done |

### 97-3 — Persistent Grants & Config (~6 tasks)

| #   | Task ID | Description                                                                                                                                                                                                                                                                                                                                               | Status  |
| --- | ------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------- |
| 15  | OB-1598 | Add `approved_tool_escalations` column to `access_control` table in `src/memory/access-store.ts` — JSON array of permanently granted tool names. Migration adds column with default `[]`                                                                                                                                                                  | ✅ Done |
| 16  | OB-1599 | Add `getApprovedEscalations()` and `addApprovedEscalation()` to access-store — CRUD for permanent grants. `addApprovedEscalation(userId, channel, tool)` appends to JSON array                                                                                                                                                                            | ✅ Done |
| 17  | OB-1600 | Wire permanent grants into worker spawning — in MasterManager.spawnWorker(), merge user's `approved_tool_escalations` with profile tools before building allowedTools list                                                                                                                                                                                | ✅ Done |
| 18  | OB-1601 | Add `auto-approve-up-to-edit` consent mode — new mode that auto-approves escalations to `code-edit` or lower, asks for `full-access`. Add to ConsentMode type and wire into escalation logic                                                                                                                                                              | ✅ Done |
| 19  | OB-1602 | Add `openbridge access grants <user>` CLI command — list permanent tool grants for a user. `openbridge access revoke-grant <user> <tool>` removes a specific grant                                                                                                                                                                                        | ✅ Done |
| 20  | OB-1603 | Add tests in `tests/core/permission-escalation.test.ts` — test: (1) escalation prompt sent on tool failure, (2) /allow grants tool and respawns, (3) /deny rejects, (4) timeout auto-denies, (5) permanent grant persists in DB, (6) session grant clears on restart, (7) pre-flight prediction works, (8) auto-approve-up-to-edit mode. At least 8 tests | ✅ Done |

---

## Phase 98 — Batch Task Continuation (OB-F94) — 22 tasks

> **Goal:** Enable Master to autonomously loop through multi-task batch requests. Self-messaging continuation, persistent batch state, progress reporting, safety rails. **Priority: High — enables "implement all tasks" workflow, making OpenBridge useful for its own development.**

### 98-1 — Batch Detection & State Machine (~8 tasks)

| #   | Task ID | Description                                                                                                                                                                                                                                                                     | Status  |
| --- | ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------- |
| 1   | OB-1604 | Add `BatchState` interface in `src/types/agent.ts` — fields: batchId, sourceType (tasks-md, findings, custom-list), totalItems, currentIndex, completedItems (array of {id, summary, status}), failedItems, startedAt, totalCostUsd, paused                                     | ✅ Done |
| 2   | OB-1605 | Add batch detection keywords in `classifyTaskByKeywords()` in `src/master/master-manager.ts` — keywords: "one by one", "all tasks", "each one", "implement all", "go through all", "for each", "iterate through", "all pending". Set `batchMode: true` in classification result | ✅ Done |
| 3   | OB-1606 | Create `src/master/batch-manager.ts` — BatchManager class with methods: createBatch(), advanceBatch(), pauseBatch(), resumeBatch(), abortBatch(), getStatus(), isActive(). Manages batch lifecycle                                                                              | ✅ Done |
| 4   | OB-1607 | Add batch plan generation — when batch detected, Master reads task source (TASKS.md, findings list), extracts individual items, creates ordered batch plan. Store in BatchState                                                                                                 | ✅ Done |
| 5   | OB-1608 | Add batch state persistence — save to `.openbridge/batch-state.json` after each item. Load on startup to resume interrupted batches. Delete on batch completion or abort                                                                                                        | ✅ Done |
| 6   | OB-1609 | Wire BatchManager into MasterManager — instantiate during init. In processMessage(), check if batch is active: if yes, process next item instead of re-parsing message                                                                                                          | ✅ Done |
| 7   | OB-1610 | Add `maxBatchIterations` and `batchBudgetUsd` to config in `src/types/config.ts` — defaults: maxBatchIterations=20, batchBudgetUsd=5.00, batchTimeoutMinutes=120. Zod validation                                                                                                | ✅ Done |
| 8   | OB-1611 | Add safety rail checks in BatchManager — before each iteration: check iteration count < max, cumulative cost < budget, elapsed time < timeout. If any exceeded, pause batch and notify user                                                                                     | ✅ Done |

### 98-2 — Self-Messaging Loop & Continuation (~7 tasks)

| #   | Task ID | Description                                                                                                                                                                                                                               | Status  |
| --- | ------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------- |
| 9   | OB-1612 | Add `[CONTINUE:batch-{id}]` marker recognition in Router — detect internal continuation messages. Route to Master without auth checks or rate limiting. Log as internal continuation                                                      | ✅ Done |
| 10  | OB-1613 | Add continuation trigger in MasterManager — after workers complete and response sent, check BatchManager.isActive(). If yes, inject `[CONTINUE:batch-{id}]` synthetic message into Router after 2s delay                                  | ✅ Done |
| 11  | OB-1614 | Add progress messages between iterations — after each item completes, send to user: "Task {id} done. Starting {nextId}... ({current}/{total})" with brief summary of completed work                                                       | ✅ Done |
| 12  | OB-1615 | Add per-item commit support — when user requests "commit after each", BatchManager sets `commitAfterEach: true`. After each worker completes, spawn a `code-edit` worker with "git add and commit changes for: {task description}" prompt | ✅ Done |
| 13  | OB-1616 | Add failure handling in batch loop — when a worker fails, pause batch. Send to user: "Task {id} failed: {reason}. Reply '/batch skip' to skip and continue, '/batch retry' to retry, '/batch abort' to stop."                             | ✅ Done |
| 14  | OB-1617 | Add Master context injection for batches — inject batch context into Master system prompt: current item, completed items summary, remaining count. Prevents Master from losing track of batch progress                                    | ✅ Done |
| 15  | OB-1618 | Add batch completion summary — when all items done, send final summary: total completed, total failed, total skipped, cumulative cost, total duration, list of completed items with one-line summaries                                    | ✅ Done |

### 98-3 — Batch Commands & UX (~7 tasks)

| #   | Task ID | Description                                                                                                                                                                                                                                                                                                                                                                                                | Status  |
| --- | ------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------- |
| 16  | OB-1619 | Add `/pause` command to Router — pause active batch. Workers in progress finish, no new items started. Send "Batch paused at item {current}/{total}. Reply '/continue' to resume."                                                                                                                                                                                                                         | ✅ Done |
| 17  | OB-1620 | Add `/continue` command to Router — resume paused batch. Re-inject continuation message. Send "Resuming batch from item {current}..."                                                                                                                                                                                                                                                                      | ✅ Done |
| 18  | OB-1621 | Add `/batch` command to Router — show batch status: current item, progress (N/total), cost so far, elapsed time, failed items. Shows "No active batch" if none                                                                                                                                                                                                                                             | ✅ Done |
| 19  | OB-1622 | Add `/batch abort` command to Router — cancel remaining items. Send summary of what was completed. Clean up batch state file                                                                                                                                                                                                                                                                               | ✅ Done |
| 20  | OB-1623 | Add `/batch skip` command to Router — skip current failed item, mark as skipped, continue with next item                                                                                                                                                                                                                                                                                                   | ✅ Done |
| 21  | OB-1624 | Add batch commands to `/help` output — include /pause, /continue, /batch, /batch abort, /batch skip with descriptions                                                                                                                                                                                                                                                                                      | ✅ Done |
| 22  | OB-1625 | Add tests in `tests/master/batch-manager.test.ts` — test: (1) batch detection from keywords, (2) plan extraction from TASKS.md, (3) continuation message injected, (4) progress messages sent, (5) safety rails pause at limit, (6) pause/resume works, (7) failure pauses batch, (8) commit-after-each spawns commit worker, (9) abort cleans state, (10) batch state survives restart. At least 10 tests | ✅ Done |

---

## Phase Docker — Docker Sandbox (OB-193) — 16 tasks

> **Goal:** Run workers in Docker containers for untrusted/shared workspaces. Completes security boundary with env var protection and document visibility. Auto-detect Docker, build images, manage containers.

| #   | Task ID | Description                                                                                                                                                                                                                                                                                                 | Status  |
| --- | ------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------- |
| 1   | OB-1545 | Create `src/core/docker-sandbox.ts` — DockerSandbox class with methods: createContainer(), startContainer(), stopContainer(), removeContainer(), exec(), isAvailable(). Uses docker CLI via child_process, no SDK dependency                                                                                | ✅ Done |
| 2   | OB-1546 | Add Docker detection to `src/discovery/tool-scanner.ts` — check for docker in PATH, verify daemon running with docker info. Report version and status. Handle: not installed, installed but no daemon, available                                                                                            | ✅ Done |
| 3   | OB-1547 | Create `docker/Dockerfile.worker` — based on node:22-slim. Install claude CLI. Set /workspace working directory. Non-root user. Keep image < 500MB                                                                                                                                                          | ✅ Done |
| 4   | OB-1548 | Add buildImage() to DockerSandbox — build worker image from Dockerfile.worker. Tag as openbridge-worker:latest. Cache layers. Skip if image exists                                                                                                                                                          | ✅ Done |
| 5   | OB-1549 | Add workspace volume mounting — workspace as read-only (-v workspace:/workspace:ro). .openbridge/ as read-write for outputs. Validate mount paths                                                                                                                                                           | ✅ Done |
| 6   | OB-1550 | Add network isolation — default --network none. Config: none (isolated), host (full), bridge (Docker only). Default none for max security                                                                                                                                                                   | ✅ Done |
| 7   | OB-1551 | Add resource limits — --memory 512m, --cpus 1, --pids-limit 100 defaults. Config options for each. Kill container if exceeded                                                                                                                                                                               | ✅ Done |
| 8   | OB-1552 | Add sandbox config to `src/types/config.ts` — security.sandbox section: mode (none/docker/bubblewrap, default: none), network, memoryMB, cpus. Zod validation                                                                                                                                               | ✅ Done |
| 9   | OB-1553 | Wire sandbox into AgentRunner.spawn() — when mode is docker, spawn worker inside container. Build docker run command with volumes, env vars (sanitized), limits, and worker command. Capture stdout/stderr                                                                                                  | ✅ Done |
| 10  | OB-1554 | Add container cleanup on worker completion — stop and remove container after exit. Timeout: maxTurns \* 30s force-kills container. Clean dangling containers on bridge startup                                                                                                                              | ✅ Done |
| 11  | OB-1555 | Pass sanitized env vars through sandbox — use --env-file or -e flags for allowed vars only. Integrate with env sanitizer from Phase 85                                                                                                                                                                      | ✅ Done |
| 12  | OB-1556 | Forward MCP config into container — mount temp MCP config as read-only. Pass --mcp-config inside container. Maintain per-worker isolation                                                                                                                                                                   | ✅ Done |
| 13  | OB-1557 | Add startup health check — verify Docker daemon running before enabling sandbox. If unavailable, warn and fall back to unsandboxed. Recheck every 5 min                                                                                                                                                     | ✅ Done |
| 14  | OB-1558 | Add fallback in AgentRunner — if docker mode set but Docker unavailable, fall back to direct spawn with warning. Never silently fail                                                                                                                                                                        | ✅ Done |
| 15  | OB-1559 | Add tests in `tests/core/docker-sandbox.test.ts` — test: (1) isAvailable checks daemon, (2) createContainer builds correct command, (3) workspace read-only, (4) .openbridge read-write, (5) env vars sanitized, (6) resource limits applied, (7) cleanup after exit. At least 7 tests (mock child_process) | ✅ Done |
| 16  | OB-1560 | Build + lint + typecheck + test validation for Sprint 4 — all 172 tasks must pass before tagging v0.0.12. Fix any failures                                                                                                                                                                                  | ✅ Done |

---

## Phase 99 — Escalation Queue & Orphan Fixes (OB-F95, F96, F97, F103) — 22 tasks

> **Goal:** Fix critical worker lifecycle bugs discovered during production Telegram session (2026-03-05). Workers crash on re-spawn after escalation grant, escalation queue handles only one request, timeouts are too short, and orphaned workers never reach terminal state. **Priority: Critical — these bugs cause silent failures and resource leaks.**

### 99-1 — Worker Re-Spawn Crash (OB-F95) — 5 tasks

| #   | Task ID | Description                                                                                                                                                                                                                                                                  | Status  |
| --- | ------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------- |
| 1   | OB-1626 | Register escalated worker ID in `WorkerRegistry` BEFORE calling `spawnWorker()` in `respawnWorkerAfterGrant()` (`src/master/master-manager.ts` ~line 6782). Currently the `-escalated` suffix worker is never registered, causing `markFailed()` to throw "worker not found" | ✅ Done |
| 2   | OB-1627 | Add error handling around re-spawn in `respawnWorkerAfterGrant()` — if spawn fails, send user message "Worker re-spawn failed after grant, please retry" and mark both original and escalated worker as `failed` in WorkerRegistry                                           | ✅ Done |
| 3   | OB-1628 | When re-spawn fails, clean up the escalated worker entry from `WorkerRegistry` to prevent orphaned state. Call `markFailed()` with reason "respawn-failed" for the escalated worker ID                                                                                       | ✅ Done |
| 4   | OB-1629 | Add integration test: grant escalation → verify worker is registered in WorkerRegistry → verify worker executes successfully. Test in `tests/core/permission-escalation.test.ts`                                                                                             | ✅ Done |
| 5   | OB-1630 | Add integration test: grant escalation → spawn fails → verify both workers marked as failed → verify user gets error message. Test in `tests/core/permission-escalation.test.ts`                                                                                             | ✅ Done |

### 99-2 — Escalation Queue for Multiple Workers (OB-F96) — 7 tasks

| #   | Task ID | Description                                                                                                                                                                                                                             | Status  |
| --- | ------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------- |
| 6   | OB-1631 | Refactor `pendingEscalations` in Router from single-entry to queue — change from `Map<sender, PendingEscalation>` to `Map<sender, PendingEscalation[]>`. Each `/allow` pops the next pending escalation instead of clearing all state   | ✅ Done |
| 7   | OB-1632 | Add `/allow all` command to Router — grants all pending escalations for a sender at once. Iterates through the queue and processes each grant sequentially                                                                              | ✅ Done |
| 8   | OB-1633 | After each `/allow`, show remaining count: "Granted. X more pending escalation(s) — reply /allow for next or /allow all for all"                                                                                                        | ✅ Done |
| 9   | OB-1634 | Add `/deny all` command — denies all pending escalations for a sender at once. Marks all queued workers as denied                                                                                                                       | ✅ Done |
| 10  | OB-1635 | Update escalation prompt message to show queue count: "3 workers requesting elevated access: (1) worker-xxx needs Bash(npm:test), (2) worker-yyy needs code-edit, (3) worker-zzz needs full-access. Reply /allow, /allow all, or /deny" | ✅ Done |
| 11  | OB-1636 | Add test: 3 workers request escalation → user sends /allow → first is granted, 2 remain → user sends /allow all → remaining 2 granted. Test in `tests/core/permission-escalation.test.ts`                                               | ✅ Done |
| 12  | OB-1637 | Add test: escalation queue with /deny all — verify all queued workers are marked denied and user is notified. Test in `tests/core/permission-escalation.test.ts`                                                                        | ✅ Done |

### 99-3 — Escalation Timeout Scaling (OB-F97) — 4 tasks

| #   | Task ID | Description                                                                                                                                                                | Status  |
| --- | ------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------- |
| 13  | OB-1638 | Increase default escalation timeout from 60s to 180s in Router. Add `escalationTimeoutMs` to config schema in `src/types/config.ts` with default 180000. Validate with Zod | ✅ Done |
| 14  | OB-1639 | Scale timeout with queue size — add 60s per additional pending escalation beyond the first. E.g., 3 pending = 180s + (2 × 60s) = 300s. Cap at 600s (10 minutes)            | ✅ Done |
| 15  | OB-1640 | Send reminder at 50% timeout elapsed: "You have X pending escalation requests — reply /allow, /allow all, or /deny". Only send once per batch                              | ✅ Done |
| 16  | OB-1641 | Add test: verify timeout scales with queue size, verify reminder sent at 50%, verify auto-deny after full timeout. Test in `tests/core/permission-escalation.test.ts`      | ✅ Done |

### 99-4 — Orphaned Worker Cleanup (OB-F103) — 6 tasks

| #   | Task ID | Description                                                                                                                                                                                                                                                  | Status    |
| --- | ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------- |
| 17  | OB-1642 | Add worker state audit in `WorkerRegistry` — on batch stats collection, if `total != completed + failed + cancelled`, log WARNING with orphaned worker IDs and their last known state. Add `getOrphanedWorkers()` method                                     | ◻ Pending |
| 18  | OB-1643 | Add worker watchdog timer — if a worker hasn't reported progress in 10 minutes (read-only) or 30 minutes (code-edit/full-access), force-kill via PID and mark as `failed` with reason "watchdog-timeout". Configurable via `workerWatchdogMinutes` in config | ◻ Pending |
| 19  | OB-1644 | When escalation times out (auto-deny), explicitly mark the worker as `cancelled` in WorkerRegistry — currently the worker is left in "pending" state indefinitely                                                                                            | ◻ Pending |
| 20  | OB-1645 | When re-spawn fails (OB-F95 fix), mark BOTH the original worker and the escalated worker as `failed` in WorkerRegistry — prevent either from being counted as "active"                                                                                       | ◻ Pending |
| 21  | OB-1646 | Add `/workers` command to Router — list all active workers with: worker ID, status, profile, duration, PID. Include count of orphaned workers. User can reply `/kill <worker-id>` to force-stop a stuck worker                                               | ◻ Pending |
| 22  | OB-1647 | Add tests: (1) watchdog kills worker after timeout, (2) escalation timeout marks worker cancelled, (3) `/workers` shows active and orphaned workers, (4) batch stats audit detects orphans. At least 4 tests in `tests/master/worker-registry.test.ts`       | ◻ Pending |

---

## Phase 100 — Classification & RAG Fixes (OB-F98, F99, F100, F102) — 16 tasks

> **Goal:** Fix message misclassification and RAG retrieval failures discovered during production testing. Strategic/brainstorming messages get too few turns, RAG returns zero results for real queries, single-character messages waste compute, and Master responses are truncated to empty after SPAWN removal.

### 100-1 — Message Classification Improvements (OB-F98) — 5 tasks

| #   | Task ID | Description                                                                                                                                                                                                                                                  | Status    |
| --- | ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------- |
| 1   | OB-1648 | Add `complex-task` keywords in `classifyTaskByKeywords()` in `src/master/master-manager.ts`: "brainstorm", "strategy", "business model", "commercialise", "commercialize", "roadmap review", "strategic plan", "market analysis", "go-to-market"             | ◻ Pending |
| 2   | OB-1649 | Increase `text-generation` maxTurns from 5 to 10 in task class definitions — long-form text generation (articles, strategies, plans) needs more turns than quick answers                                                                                     | ◻ Pending |
| 3   | OB-1650 | Improve fallback logic in classifier — if message length > 100 chars AND contains question marks or multiple sentences, default to `tool-use` (15 turns) instead of `quick-answer` (5 turns)                                                                 | ◻ Pending |
| 4   | OB-1651 | Add length-based heuristic for `complex-task` — messages > 200 chars with planning/strategy language patterns should be `complex-task` (25 turns) regardless of keyword matches                                                                              | ◻ Pending |
| 5   | OB-1652 | Add tests for classification improvements: (1) "brainstorm with me" → complex-task, (2) "create a strategy to commercialise" → complex-task, (3) long multi-sentence message → not quick-answer, (4) "write a tweet" stays text-generation. At least 4 tests | ◻ Pending |

### 100-2 — RAG Zero-Results Fix (OB-F99) — 5 tasks

| #   | Task ID | Description                                                                                                                                                                                                                                      | Status    |
| --- | ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------- |
| 6   | OB-1653 | Investigate `buildSearchQuery()` in `src/core/knowledge-retriever.ts` — log the actual FTS5 query string being generated for multi-word queries vs single-character queries. Add debug logging to identify tokenization issues                   | ◻ Pending |
| 7   | OB-1654 | Fix FTS5 query construction — natural language questions ("Can you deploy and send the link?") likely fail because of stop-word filtering or over-quoting. Ensure individual content words are OR-joined, not AND-joined                         | ◻ Pending |
| 8   | OB-1655 | Add fallback query strategy — if initial FTS5 query returns 0 results, retry with individual keywords extracted from the query (top 3 content words by length). Log "RAG fallback: retrying with individual keywords"                            | ◻ Pending |
| 9   | OB-1656 | Skip RAG for messages shorter than 3 characters — single-character inputs ("1", "3") should bypass RAG entirely. Return empty results with `confidence: 0` immediately                                                                           | ◻ Pending |
| 10  | OB-1657 | Add tests: (1) multi-word query returns results when chunks exist, (2) single-char query skipped, (3) fallback retry triggers on zero results, (4) FTS5 query logged for debugging. At least 4 tests in `tests/core/knowledge-retriever.test.ts` | ◻ Pending |

### 100-3 — Single-Character Message Optimization (OB-F100) — 3 tasks

| #   | Task ID | Description                                                                                                                                                                                                                                          | Status    |
| --- | ------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------- |
| 11  | OB-1658 | Add `menu-selection` task class in `classifyTaskByKeywords()` — detect numeric-only messages (1–9 or single digits). Set maxTurns: 2, skip RAG. Check if previous response contained a numbered list and extract the selected option                 | ◻ Pending |
| 12  | OB-1659 | In `processMessage()`, when `menu-selection` detected, inject the selected option text from the previous response into the Master prompt instead of the raw number. E.g., user sends "3" → Master sees "User selected option 3: 'Deploy to staging'" | ◻ Pending |
| 13  | OB-1660 | Add tests: (1) "1" classified as menu-selection, (2) "hello" NOT classified as menu-selection, (3) RAG skipped for menu-selection, (4) option text injected from previous response. At least 3 tests                                                 | ◻ Pending |

### 100-4 — SPAWN Marker Truncation Fix (OB-F102) — 3 tasks

| #   | Task ID | Description                                                                                                                                                                                                                                                                                       | Status    |
| --- | ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------- |
| 14  | OB-1661 | When `cleanedLength === 0` after SPAWN marker removal in `src/master/master-manager.ts`, generate a structured status message from the parsed SPAWN markers: "I'm spawning N workers: 1) {summary1}, 2) {summary2}, ..." Extract worker task summaries from SPAWN marker prompts                  | ◻ Pending |
| 15  | OB-1662 | Update Master system prompt in `src/master/master-system-prompt.ts` to instruct: "Always include a brief human-readable summary explaining your plan BEFORE any SPAWN markers. The user should understand what you're about to do even if SPAWN markers are removed from the displayed response." | ◻ Pending |
| 16  | OB-1663 | Add tests: (1) response with only SPAWN markers generates summary, (2) response with text + SPAWN markers preserves text, (3) summary includes worker task descriptions. At least 3 tests                                                                                                         | ◻ Pending |

---

## Phase 101 — Batch & Shutdown Safety (OB-F108, F109, F112, F114) — 7 tasks

> **Goal:** Fix batch continuation timer leaks and unhandled rejections that can crash the bridge or leak resources during shutdown. Fix sender info persistence and API inconsistency.

| #   | Task ID | Description                                                                                                                                                                                                                                                  | Status    |
| --- | ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------- |
| 1   | OB-1664 | Add `batchTimers: Set<NodeJS.Timeout>` field to MasterManager. Store each `setTimeout` handle from batch continuation (lines ~2518, ~2544, ~2561, ~5328 in `src/master/master-manager.ts`). Remove handle from set when timer fires                          | ◻ Pending |
| 2   | OB-1665 | In `MasterManager.shutdown()`, call `clearTimeout()` on all remaining handles in `batchTimers` set. Add guard in timer callback: `if (this.state === 'shutdown') return;` to prevent firing into destroyed system                                            | ◻ Pending |
| 3   | OB-1666 | Replace all `void router.routeBatchContinuation(...)` calls with `.catch()` handlers — on catch, call `batchManager.pauseBatch()` and notify user "Batch paused due to error: {message}". Lines ~2519, ~2545, ~2562, ~5329 in `src/master/master-manager.ts` | ◻ Pending |
| 4   | OB-1667 | Include `senderInfo: { sender, source }` in persisted batch state JSON (`src/master/batch-manager.ts`). On `initialize()` reload, restore `batchSenderInfo` map from persisted state so batch messages route correctly after restart                         | ◻ Pending |
| 5   | OB-1668 | Rename `getActiveBatchId()` to `getCurrentBatchId()` in `src/master/batch-manager.ts` to signal it includes paused batches. Add JSDoc clarifying difference from `isActive()`. Update all callers                                                            | ◻ Pending |
| 6   | OB-1669 | Add tests: (1) batch timers cleared on shutdown, (2) timer callback no-ops after shutdown, (3) routeBatchContinuation error pauses batch, (4) sender info persisted and restored. At least 4 tests in `tests/master/batch-manager.test.ts`                   | ◻ Pending |
| 7   | OB-1670 | Add test: `getCurrentBatchId()` returns paused batch ID, `isActive()` returns false for same batch. Verify no caller assumes `getCurrentBatchId()` implies running. Test in `tests/master/batch-manager.test.ts`                                             | ◻ Pending |

---

## Phase 102 — Worker & Cost Controls (OB-F101, F104) — 8 tasks

> **Goal:** Add per-worker cost caps and handle max-turns exhaustion properly. Prevent $1+ cost spikes for read-only tasks and distinguish incomplete workers from fully completed ones.

### 102-1 — Per-Worker Cost Caps (OB-F101) — 4 tasks

| #   | Task ID | Description                                                                                                                                                                                                                                                                    | Status    |
| --- | ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------- |
| 1   | OB-1671 | Add per-profile cost caps in `src/core/agent-runner.ts` — `read-only`: $0.50, `code-edit`: $1.00, `code-audit`: $1.00, `full-access`: $2.00. If streaming cost exceeds cap, abort the agent and log WARNING "Worker cost cap exceeded: ${cost} > ${cap} for profile {profile}" | ◻ Pending |
| 2   | OB-1672 | Add `workerCostCaps` config option in `src/types/config.ts` — per-profile overrides: `{ "read-only": 0.50, "code-edit": 1.00 }`. Merge with defaults. Zod validation                                                                                                           | ◻ Pending |
| 3   | OB-1673 | Log WARNING when worker cost exceeds 10x the average for its profile tier — e.g., "Worker cost $1.14 is 114x average $0.01 for read-only profile". Track running average per profile in memory                                                                                 | ◻ Pending |
| 4   | OB-1674 | Add tests: (1) cost cap aborts agent, (2) cost cap configurable, (3) 10x warning logged, (4) average tracking works. At least 3 tests in `tests/core/agent-runner.test.ts`                                                                                                     | ◻ Pending |

### 102-2 — Turns Exhaustion Handling (OB-F104) — 4 tasks

| #   | Task ID | Description                                                                                                                                                                                                                             | Status    |
| --- | ------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------- |
| 5   | OB-1675 | Add `partial` status to worker result metadata in `src/core/agent-runner.ts` — when `turnsExhausted: true`, set `result.status = 'partial'` instead of `'completed'`. Include `turnsUsed` and `maxTurns` in result metadata             | ◻ Pending |
| 6   | OB-1676 | In `worker-result-formatter.ts`, append "[PARTIAL — worker used all {maxTurns} turns, result may be incomplete]" to worker results when `turnsExhausted: true`. Master receives this flag and can decide to spawn a continuation worker | ◻ Pending |
| 7   | OB-1677 | Add adaptive maxTurns in `MasterManager.spawnWorker()` — if task prompt length > 200 chars, add 5 extra turns. If prompt contains "thorough", "comprehensive", "detailed", add 10 extra turns. Cap at profile maximum                   | ◻ Pending |
| 8   | OB-1678 | Add tests: (1) turnsExhausted sets partial status, (2) result formatter appends warning, (3) adaptive maxTurns increases for long prompts, (4) cap respects profile maximum. At least 3 tests                                           | ◻ Pending |

---

## Phase 103 — Docker & Startup Polish (OB-F105, F106, F107, F110, F111) — 9 tasks

> **Goal:** Fix startup logging confusion, whitelist diagnostics, false-positive sensitive file detection, and Docker sandbox bugs (wrong exit code, no crash cleanup).

| #   | Task ID | Description                                                                                                                                                                                                                              | Status    |
| --- | ------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------- |
| 1   | OB-1679 | Consolidate Master tool selection logs in `src/index.ts` — replace 5 sequential log lines with single summary: "Master AI: codex (claude excluded per config.excludeTools)". Add `--verbose` check for full selection trace              | ◻ Pending |
| 2   | OB-1680 | Log reason for each tool exclusion — e.g., "claude excluded: listed in config.excludeTools". Skip redundant override log when config override matches auto-selected fallback                                                             | ◻ Pending |
| 3   | OB-1681 | In `src/core/auth.ts`, log each dropped whitelist entry with reason — e.g., "Dropped whitelist entry '+1-abc': non-numeric characters" or "Duplicate whitelist entry: +212600000000". Don't just log raw vs normalized count             | ◻ Pending |
| 4   | OB-1682 | In `npx openbridge init` (`src/cli/init.ts`), validate whitelist entries at config generation time — warn about non-numeric characters, duplicates. Offer to fix automatically                                                           | ◻ Pending |
| 5   | OB-1683 | In `src/core/bridge.ts`, whitelist `.env.example`, `.env.sample`, `.env.template` from sensitive file detection — these are documentation, not secrets. Only flag `.env`, `.env.local`, `.env.production`, etc.                          | ◻ Pending |
| 6   | OB-1684 | Add `sensitiveFileExceptions` config option in `src/types/config.ts` — array of glob patterns to exclude from sensitive file detection. Default includes `.env.example`, `.env.sample`, `.env.template`                                  | ◻ Pending |
| 7   | OB-1685 | Fix Docker sandbox exit code in `src/core/docker-sandbox.ts` (~line 206) — read `.status` instead of `.code` for process exit code. Type error correctly: `code?: string; status?: number`. Fallback: `execErr.status ?? 1`              | ◻ Pending |
| 8   | OB-1686 | Add Docker container cleanup on process crash — track container IDs in `Set<string>`, register `process.on('exit')` and `process.on('SIGINT')` handlers that call `removeContainer(id, true)`. Wire `cleanup()` into `Bridge.shutdown()` | ◻ Pending |
| 9   | OB-1687 | Add tests: (1) tool selection summary log, (2) whitelist dropped entry logged, (3) .env.example not flagged, (4) Docker exit code reads .status, (5) Docker cleanup on exit. At least 5 tests across relevant test files                 | ◻ Pending |

---

## Phase 104 — Test Suite Fixes / Stale Mocks (OB-F113) — 5 tasks

> **Goal:** Fix 37 test failures caused by stale mocks after Phase 98 batch continuation changes. Add `readBatchState`/`writeBatchState`/`deleteBatchState` to all DotFolderManager mocks, fix Progress Events tests, address pre-existing CLI wizard timeouts.

| #   | Task ID | Description                                                                                                                                                                                                                                    | Status    |
| --- | ------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------- |
| 1   | OB-1688 | Fix DotFolderManager mocks in `tests/integration/memory-wiring.test.ts` (18 failures) — add `readBatchState: vi.fn().mockReturnValue(null)`, `writeBatchState: vi.fn()`, `deleteBatchState: vi.fn()` to all mock objects                       | ◻ Pending |
| 2   | OB-1689 | Fix DotFolderManager mocks in `tests/e2e/graceful-unknown-handling.test.ts` (2 failures) and `tests/integration/master-prefix-stripping.test.ts` (3 failures) — same batch state mock additions                                                | ◻ Pending |
| 3   | OB-1690 | Fix Progress Events tests in `tests/master/master-manager.test.ts` (3 failures) — update mock return values to match new `processMessage()` flow with batch continuation. Ensure progress event assertions match current emit patterns         | ◻ Pending |
| 4   | OB-1691 | Fix `tests/connectors/webchat/webchat-mobile.test.ts` (1 failure) — add missing `homedir` to `node:os` mock. Pre-existing issue since Phase 62                                                                                                 | ◻ Pending |
| 5   | OB-1692 | Run full test suite (`npm run test`) and verify all newly fixed tests pass. Document any remaining pre-existing failures (CLI wizard timeouts in `init-mcp.test.ts` and `init-wizard.test.ts`) as known issues with skip annotations if needed | ◻ Pending |

---
