# OpenBridge — Audit Findings

> **Purpose:** Real issues, gaps, and risks discovered during code audits and real-world testing.
> **This is NOT a task list.** Tasks live in [TASKS.md](TASKS.md). Findings document _what's wrong_ and _why it matters_.
> **Open:** 39 | **Fixed:** 87 | **Last Audit:** 2026-03-05
> **Current focus:** Making OpenBridge effective for finishing the Marketplace projects (frontend, dashboard, backend).
> **Resolved findings:** [V0 archive](archive/v0/FINDINGS-v0.md) | [V2 archive](archive/v2/FINDINGS-v2.md) | [V4 archive](archive/v4/FINDINGS-v4.md) | [V5 archive](archive/v5/FINDINGS-v5.md) | [V6 archive](archive/v6/FINDINGS-v6.md) | [V7 archive](archive/v7/FINDINGS-v7.md) | [V8 archive](archive/v8/FINDINGS-v8.md) | [V15 archive](archive/v15/FINDINGS-v15.md) | [V16 archive](archive/v16/FINDINGS-v16.md) | [V17 archive](archive/v17/FINDINGS-v17.md) | [V18 archive](archive/v18/FINDINGS-v18.md) | [V19 archive](archive/v19/FINDINGS-v19.md) | [V20 archive](archive/v20/TASKS-v20-v009-v011-phases-74-86-deep1.md)

---

## Priority Order

Ordered by impact on the **Marketplace development workflow** — the immediate goal is using OpenBridge to finish the Marketplace frontend, dashboard, and backend services.

### Tier 1 — Must-Fix for Marketplace Development

| #      | Finding                                                  | Severity    | Marketplace Impact                                                                     | Status   |
| ------ | -------------------------------------------------------- | ----------- | -------------------------------------------------------------------------------------- | -------- |
| OB-F57 | Workers cannot run tests or do deep code analysis        | 🟠 High     | Can't verify Marketplace code — no test/lint/typecheck in workers                      | ✅ Fixed |
| OB-F58 | `explore()` failure is unrecoverable                     | 🟠 High     | Exploration failure on any Marketplace project = Master stuck, must restart            | ✅ Fixed |
| OB-F59 | `parseAIResult()` has no runtime Zod validation          | 🟠 High     | Corrupt exploration data = Master misunderstands Marketplace codebase                  | ✅ Fixed |
| OB-F67 | Secondary workspace .openbridge is corrupted             | 🔴 Critical | Must clean before targeting Marketplace workspace paths                                | ✅ Fixed |
| OB-F66 | .openbridge data stale from early development            | 🟡 Medium   | Stale memory.md + workspace map misleads Master about project state                    | ✅ Fixed |
| OB-F70 | Environment variables leak sensitive secrets to workers  | 🔴 Critical | Marketplace backend has DB_URL, API keys, SMTP creds — all exposed to workers          | ✅ Fixed |
| OB-F76 | Keyword classifier misses execution/delegation keywords  | 🟠 High     | "start execution" classified as tool-use (15 turns) instead of complex-task (25 turns) | ✅ Fixed |
| OB-F77 | SPAWN marker stripping leaves empty/stub response        | 🟠 High     | Master output with SPAWN markers stripped to 29 chars — user gets no useful response   | ✅ Fixed |
| OB-F78 | No warning when response truncated after SPAWN stripping | 🟡 Medium   | Log shows `responseLength: 29` but no flag that original was 500+ chars pre-strip      | ✅ Fixed |

### Tier 1b — Real-World Testing Issues (discovered 2026-03-02)

| #      | Finding                                                        | Severity    | Impact                                                                                 | Status   |
| ------ | -------------------------------------------------------------- | ----------- | -------------------------------------------------------------------------------------- | -------- |
| OB-F89 | Codex worker streaming output is raw JSON — not parsed         | 🔴 Critical | Users see raw `{"type":"item.completed",...}` JSONL instead of readable text           | Open     |
| OB-F90 | RAG always returns confidence 0, chunkCount 0                  | 🟠 High     | Master AI has no workspace context — every query returns empty, RAG system is dead     | ✅ Fixed |
| OB-F91 | Codex workers waste turns on shell gymnastics instead of tools | 🟠 High     | Workers do `0 files read` — spend all turns running inline Python via bash escaping    | Open     |
| OB-F92 | Task classifier over-triggers tool-use and complex-task        | 🟡 Medium   | Text-generation tasks (write tweet, write post) classified as tool-use or complex-task | ✅ Fixed |

### Tier 2 — Important for Development Workflow (Sprints 1–3)

| #      | Finding                                                     | Severity  | Development Impact                                                      | Status   |
| ------ | ----------------------------------------------------------- | --------- | ----------------------------------------------------------------------- | -------- |
| OB-F68 | Master AI doesn't know how to share generated files         | 🟠 High   | Can't receive test reports, code analysis results, or generated outputs | ✅ Fixed |
| OB-F71 | No user consent before risky/expensive worker operations    | 🟠 High   | Marketplace is production code — need confirmation before file edits    | ✅ Fixed |
| OB-F60 | Phase 3 directory dive retry logic is broken                | 🟠 High   | Marketplace has many directories — failed dives = knowledge gaps        | ✅ Fixed |
| OB-F62 | `reExplore()` doesn't write analysis marker or update cache | 🟡 Medium | Re-exploration loops waste time when switching between projects         | ✅ Fixed |
| OB-F63 | Prompt rollback stores new content as previousVersion       | 🟡 Medium | Bad prompts for Marketplace tasks can't be reverted                     | ✅ Fixed |
| OB-F61 | Progress calculation gives negative percentages             | 🟡 Medium | Confusing progress display during Marketplace exploration               | ✅ Fixed |

### Tier 1c — Runtime Issues (discovered 2026-03-05 Telegram session)

| #       | Finding                                                    | Severity    | Impact                                                                                     | Status   |
| ------- | ---------------------------------------------------------- | ----------- | ------------------------------------------------------------------------------------------ | -------- |
| OB-F95  | Worker re-spawn crash after escalation grant               | 🔴 Critical | Escalation grants silently fail — user approves but worker never runs                      | Open     |
| OB-F96  | Escalation state cleared before all workers granted        | 🟠 High     | Multi-worker escalation queue handles only one — remaining workers stuck                   | Open     |
| OB-F97  | Escalation timeout too short for multi-worker spawns       | 🟡 Medium   | 60s auto-deny before user can respond to multiple escalation prompts                       | Open     |
| OB-F98  | Misclassification of strategic/brainstorming messages      | 🟠 High     | Strategic questions get 5 turns instead of 25 — shallow answers                            | ✅ Fixed |
| OB-F99  | RAG returns zero results for real user questions           | 🟡 Medium   | Real queries return 0 chunks, single-char queries return 10 — RAG is inverted              | Open     |
| OB-F100 | Single-character messages trigger full agent invocations   | 🟢 Low      | "1", "3" go through full pipeline: classification → RAG → agent spawn — 60s and $0.02 each | Open     |
| OB-F101 | Codex worker cost spike ($1.14 for read-only task)         | 🟡 Medium   | Unpredictable cost spikes — read-only task should not cost $1.14                           | Open     |
| OB-F102 | Master response truncated to empty after SPAWN removal     | 🟡 Medium   | User gets "I'm working on it" instead of Master's plan when response is all SPAWN markers  | ✅ Fixed |
| OB-F103 | Orphaned workers never reach terminal state                | 🔴 Critical | 7/61 workers unaccounted for — stuck processes, resource leaks, one ran 6.4 hours          | Open     |
| OB-F104 | Workers exhaust max-turns without completing               | 🟡 Medium   | Workers counted as "completed" with partial results — Master gets incomplete data          | Open     |
| OB-F105 | Master tool selection flow redundant and confusing         | 🟡 Medium   | 5 contradictory log lines during startup — debugging confusion                             | Open     |
| OB-F106 | Whitelist normalization drops entries without details      | 🟡 Medium   | Dropped phone number silently locks out user with no diagnostic path                       | Open     |
| OB-F107 | `.env.example` incorrectly flagged as sensitive file       | 🟢 Low      | Template documentation file auto-excluded — false positive erodes trust                    | Open     |
| OB-F108 | Batch continuation timers not cancelled on shutdown        | 🟡 Medium   | Pending timers fire into destroyed system on shutdown — unhandled errors                   | Open     |
| OB-F109 | Unhandled rejections in batch continuation fire-and-forget | 🟡 Medium   | `void` discards Promise — rejection crashes process with --unhandled-rejections=throw      | Open     |
| OB-F110 | Docker sandbox `exec()` reads wrong exit code property     | 🟡 Medium   | All non-zero exits default to 1 — can't distinguish OOM-kill from general error            | Open     |
| OB-F111 | Docker sandbox has no container cleanup on process crash   | 🟡 Medium   | Orphaned Docker containers run indefinitely after bridge crash                             | Open     |
| OB-F112 | Batch sender info not persisted across process restarts    | 🟢 Low      | Resumed batches can't route messages to original user after restart                        | Open     |
| OB-F113 | 37 test failures from stale mocks after Phase 98           | 🟠 High     | CI is red — test failures mask real regressions                                            | Open     |
| OB-F114 | `getActiveBatchId()` inconsistent with `isActive()`        | 🟢 Low      | Returns paused batches — semantic trap for future callers                                  | Open     |

### Tier 2b — Platform Completion (Sprint 4 — v0.0.12)

| #      | Finding                                   | Severity    | Sprint 4 Impact                                                           | Status                                               |
| ------ | ----------------------------------------- | ----------- | ------------------------------------------------------------------------- | ---------------------------------------------------- |
| OB-F56 | No multi-phase "deep mode"                | 🟡 Medium   | Enables thorough analysis: investigate → report → plan → execute → verify | Partial (Core + 5 commands done, 20 tasks remaining) |
| OB-F69 | No delivery path for interactive web apps | 🟠 High     | Tunnel + ephemeral app serving makes outputs accessible from anywhere     | Open                                                 |
| OB-F72 | No document visibility controls           | 🟡 Medium   | Completes security boundary — controls what AI can see in workspace       | Open                                                 |
| OB-F73 | WebChat has no authentication             | 🔴 Critical | Required for exposing WebChat beyond localhost (LAN, tunnel, PWA)         | Open                                                 |
| OB-F74 | WebChat UI is inlined HTML string         | 🟠 High     | Blocks all WebChat improvements — must extract before modernization       | Open                                                 |
| OB-F75 | WebChat not accessible from phone         | 🟠 High     | Phone access via LAN/tunnel + PWA makes WebChat a primary interface       | Open                                                 |

### Tier 2c — Community-Inspired Improvements (v0.0.13)

Improvements identified by analyzing [openclaw/openclaw](https://github.com/openclaw/openclaw) (242K stars) and [thedotmack/claude-mem](https://github.com/thedotmack/claude-mem) (32K stars).

| #      | Finding                                                           | Severity  | Improvement Impact                                                                | Inspired By | Status |
| ------ | ----------------------------------------------------------------- | --------- | --------------------------------------------------------------------------------- | ----------- | ------ |
| OB-F79 | Memory has no vector search — FTS5 only                           | 🟠 High   | RAG returns keyword matches only, misses semantically similar content             | openclaw    | Open   |
| OB-F80 | No structured observations from worker outputs                    | 🟠 High   | Worker results are free-form text — no typed facts, concepts, or files_touched    | claude-mem  | Open   |
| OB-F81 | Memory retrieval returns full results — no progressive disclosure | 🟡 Medium | Every search loads full content, wastes tokens; no index → filter → detail flow   | claude-mem  | Open   |
| OB-F82 | No content-hash deduplication for workspace chunks                | 🟡 Medium | Duplicate chunks stored during overlapping worker reads and re-exploration        | claude-mem  | Open   |
| OB-F83 | No token economics tracking for exploration ROI                   | 🟡 Medium | Can't measure if exploration cost is worth the retrieval savings                  | claude-mem  | Open   |
| OB-F84 | Master context window has no auto-compaction                      | 🟠 High   | Long Master sessions hit context limits; memory.md is manual, not auto-compacted  | openclaw    | Open   |
| OB-F85 | No self-diagnostic command (`openbridge doctor`)                  | 🟡 Medium | No way to validate config, check AI tools, verify SQLite, test channel health     | openclaw    | Open   |
| OB-F86 | No pairing-based auth for non-phone channels                      | 🟡 Medium | Discord/Telegram users need manual whitelist; no self-service pairing flow        | openclaw    | Open   |
| OB-F87 | No skills directory for reusable capabilities                     | 🟡 Medium | Master rediscovers capabilities each session; no SKILL.md pattern for persistence | openclaw    | Open   |
| OB-F88 | Worker results lack structured summary format                     | 🟡 Medium | No `completed/learned/next_steps` — Master can't track incomplete work            | claude-mem  | Open   |

### OB-F89 — Codex worker streaming output is raw JSON — not parsed (Critical)

**Problem:** When the Master spawns Codex workers via `spawnWithStreamingHandle()`, the worker output sent to users is raw JSONL streaming protocol:

```json
{"type":"thread.started","thread_id":"019caf0c-47d5-..."}
{"type":"item.completed","item":{"id":"item_0","type":"reasoning","text":"Planning..."}}
{"type":"item.started","item":{"id":"item_1","type":"command_execution","command":"/bin/zsh -lc ls",...}}
```

The non-streaming path (`execOnce()`) correctly applies `parseCodexJsonlOutput()` to convert JSONL → readable text. But `execOnceStreaming()` (used by workers via `spawnWithStreamingHandle()`) accumulates raw stdout without calling `parseOutput()`. The Claude adapter doesn't have this issue because `--print` outputs human-readable text directly.

**Impact:** Any Codex worker result is unreadable to users. Multi-AI delegation (a core feature) is broken for Codex workers.

**Root cause in code:**

- `src/core/agent-runner.ts` `execOnce()` (line ~803): Calls `config.parseOutput()` ✅
- `src/core/agent-runner.ts` `execOnceStreaming()`: NO `parseOutput()` call ❌
- `src/core/agent-runner.ts` `spawnWithStreamingHandle()`: Uses `execOnceStreaming()`, no workaround ❌
- `src/master/master-manager.ts` `spawnWorker()`: Passes raw `result.stdout` to user ❌

**Proposed solution:**

1. Apply `parseOutput()` to the final accumulated `stdout` in `execOnceStreaming()` before returning the result
2. OR: apply `parseCodexJsonlOutput()` in `spawnWithStreamingHandle()` after generator completes
3. Also consider parsing incrementally during streaming (extract `type: "message"` events in real-time)
4. Add test: spawn Codex adapter in streaming mode → verify output is human-readable text

**Key files:** `src/core/agent-runner.ts`, `src/core/adapters/codex-adapter.ts`, `src/master/master-manager.ts`

**Scope:** ~5–6 tasks. Critical — blocks multi-AI delegation.

---

### OB-F90 — RAG always returns confidence 0, chunkCount 0 (High)

**Problem:** In real-world testing (16 messages via Telegram + WebChat), every single RAG query returned `confidence: 0, chunkCount: 0, sources: []`. The Knowledge Retriever is returning nothing — the Master AI operates without any workspace context from the RAG system.

**Root causes identified:**

1. **buildSearchQuery() too aggressive** — `src/core/knowledge-retriever.ts` strips all stop words (80+ words) and tokens ≤2 chars. Questions like "What can you tell about our project?" are reduced to almost nothing after filtering.

2. **Exploration skipped → no chunks indexed** — logs show "Valid workspace map found, no workspace changes detected — skipping exploration". If the workspace map exists but chunks were never stored in FTS5 tables, there's nothing to search.

3. **No fallback when query is empty** — if `buildSearchQuery()` produces an empty string, `hybridSearch()` returns `[]` silently with no error logged.

4. **Worker results not stored** — `storeWorkerResult()` in knowledge-retriever is only called explicitly, not automatically after every worker completes.

**Impact:** The RAG system (Phases 74–77, 43 tasks) is effectively dead at runtime. The Master compensates via its session context and system prompt, but wastes the entire RAG infrastructure.

**Proposed solution:**

1. Relax `buildSearchQuery()` — reduce minimum token length from 3 to 2, reduce stop word list, add fallback to raw query when all tokens filtered
2. Ensure exploration stores chunks in FTS5 even when workspace map is reused from cache
3. Log a WARN when `buildSearchQuery()` produces empty query string
4. Auto-store worker results in chunk store after every worker completion
5. Add startup diagnostic: count chunks in FTS5, log warning if zero

**Key files:** `src/core/knowledge-retriever.ts`, `src/memory/retrieval.ts`, `src/master/master-manager.ts`, `src/memory/chunk-store.ts`

**Scope:** ~8–10 tasks. High priority — makes RAG system actually work.

---

### OB-F91 — Codex workers waste turns on shell gymnastics instead of using tools (High)

**Problem:** In real-world testing, Codex workers with `read-only` profile spent all their turns running complex inline Python scripts via `/bin/zsh -lc "python -c ..."` with deeply nested shell escaping. Result: `0 files read, 0 files modified`, turns exhausted (89s, 135s), wasted ~$0.08.

The workers tried to run `git blame --line-porcelain` parsed by Python, regex-based export counters, etc. — all achievable with simple `Read`/`Glob`/`Grep` tool calls. The `read-only` profile restricts tools to `Read, Glob, Grep` but Codex CLI may interpret `--allowedTools` differently than Claude CLI, causing workers to fall back to arbitrary shell commands.

**Impact:** Codex workers produce no useful output for read-only tasks. Wasted cost and time. The Master then assembles results from a blank worker.

**Proposed solution:**

1. Verify how Codex CLI handles `--allowedTools` — does it support the same tool names as Claude?
2. If Codex doesn't support tool restrictions, consider: (a) not passing `--allowedTools` and relying on system prompt instructions, (b) using a wrapper that enforces restrictions
3. Add stronger system prompt guidance for Codex workers: "Use Read to read files. Do NOT use bash/shell commands for file reading."
4. Consider defaulting Codex workers to non-read-only tasks where shell access is expected
5. Add integration test: spawn Codex read-only worker → verify it uses Read tool, not bash

**Key files:** `src/core/adapters/codex-adapter.ts`, `src/core/agent-runner.ts`, `src/master/master-manager.ts`, `src/master/seed-prompts.ts`

**Scope:** ~5–7 tasks.

---

### OB-F92 — Task classifier over-triggers tool-use and complex-task for text-generation (Medium)

**Problem:** In real-world testing, the keyword classifier consistently misclassified pure text-generation tasks:

| User message                      | Classified as      | Correct class     |
| --------------------------------- | ------------------ | ----------------- |
| "generate a LinkedIn post"        | tool-use (15t)     | quick-answer (5t) |
| "shorter version more attractive" | tool-use (15t)     | quick-answer (5t) |
| "tweet for non-developers"        | complex-task (25t) | quick-answer (5t) |
| "mix of tweet 4 and 1"            | tool-use (15t)     | quick-answer (5t) |
| "add no api key no extra cost"    | complex-task (25t) | quick-answer (5t) |

Most were classified via `"keyword fallback: tool-use"` — the default when no keyword matches, which means the fallback itself is wrong for conversational/creative messages.

**Impact:** 2x–5x more turns and tokens than necessary. `complex-task` triggers planning prompts and potentially worker spawning for tasks that just need a text response.

**Proposed solution:**

1. Add `text-generation` keywords: generate, write, draft, compose, create post, tweet, LinkedIn, rewrite, rephrase, reformulate, shorter, longer, more attractive
2. Change keyword fallback from `tool-use` to `quick-answer` — most unrecognized messages are conversational
3. Add context-awareness: if previous messages were text-generation, classify follow-ups (shorter, better, mix of) as same class
4. Add test cases for creative/writing tasks in classifier tests

**Key files:** `src/master/master-manager.ts` (classifyTaskByKeywords), `tests/master/master-manager.test.ts`

**Scope:** ~4–5 tasks.

---

### Tier 3 — Deferred (not blocking current work)

| #      | Finding                                           | Severity | Notes                                                  | Status   |
| ------ | ------------------------------------------------- | -------- | ------------------------------------------------------ | -------- |
| OB-F64 | `filesScanned` always 0 in exploration summary    | 🟢 Low   | Cosmetic — doesn't affect functionality                | ✅ Fixed |
| OB-F65 | Exploration prompts have no media/asset awareness | 🟢 Low   | Marketplace projects are code-focused, not media-heavy | ✅ Fixed |

### Recently Fixed

| #      | Finding                                                     | Severity    | Impact                                                                                   | Status    |
| ------ | ----------------------------------------------------------- | ----------- | ---------------------------------------------------------------------------------------- | --------- |
| OB-F54 | Complex tasks use same 180s timeout as quick answers        | 🟠 High     | Complex tasks (25 turns) get 7.2s/turn, timeout every time, retry 4x → DLQ               | **Fixed** |
| OB-F55 | Classification escalation over-triggers quick-answer        | 🟡 Medium   | Global success rate escalates every quick-answer to tool-use, wasting budget             | **Fixed** |
| OB-F77 | SPAWN marker stripping leaves empty/stub response           | 🟠 High     | Status message now generated when cleanedOutput < 80 and SPAWN markers found             | **Fixed** |
| OB-F78 | No warning when response truncated after SPAWN stripping    | 🟡 Medium   | debug + warn logs added after SPAWN stripping in both streaming and non-streaming paths  | **Fixed** |
| OB-F61 | Progress calculation gives negative percentages             | 🟡 Medium   | Removed erroneous subtraction — diveProgressPercent \* weight now produces 0%–50% range  | **Fixed** |
| OB-F62 | `reExplore()` doesn't write analysis marker or update cache | 🟡 Medium   | Added `writeAnalysisMarkerToStore()` + `workspaceMapSummary` update after re-exploration | **Fixed** |
| OB-F63 | Prompt rollback stores new content as previousVersion       | 🟡 Medium   | Read old file content before write; store as `previousVersion` — rollback now functional | **Fixed** |
| OB-F57 | Workers cannot run tests or do deep code analysis           | 🟠 High     | Added `code-audit` profile with npm:test, lint, typecheck tool access                    | **Fixed** |
| OB-F58 | `explore()` failure is unrecoverable                        | 🟠 High     | Added `recover()` method to reset state from error to idle + retry exploration           | **Fixed** |
| OB-F59 | `parseAIResult()` has no runtime Zod validation             | 🟠 High     | Added optional `schema` parameter — callers now pass Zod schemas for validation          | **Fixed** |
| OB-F60 | Phase 3 directory dive retry logic is broken                | 🟠 High     | Moved pendingDives computation inside batch loop — failed dives now retried              | **Fixed** |
| OB-F64 | `filesScanned` always 0 in exploration summary              | 🟢 Low      | Propagated totalFiles from structure scan to buildSummary()                              | **Fixed** |
| OB-F65 | Exploration prompts have no media/asset awareness           | 🟢 Low      | Added media/asset categories to all 4 exploration prompts                                | **Fixed** |
| OB-F66 | .openbridge data stale from early development               | 🟡 Medium   | Cleanup script + fresh exploration on primary workspace                                  | **Fixed** |
| OB-F67 | Secondary workspace .openbridge is corrupted                | 🔴 Critical | Deleted corrupted .openbridge/ folder — will regenerate on next use                      | **Fixed** |
| OB-F68 | Master AI doesn't know how to share generated files         | 🟠 High     | SHARE marker docs, connector injection, output routing added to system prompt            | **Fixed** |
| OB-F70 | Environment variables leak sensitive secrets to workers     | 🔴 Critical | ENV_DENY_PATTERNS + sanitizeEnv() wired into all 3 adapters + startup scan               | **Fixed** |
| OB-F71 | No user consent before risky/expensive worker operations    | 🟠 High     | Risk classification, confirmation flow, /confirm, /skip, /audit, cost estimation         | **Fixed** |
| OB-F76 | Keyword classifier misses execution/delegation keywords     | 🟠 High     | Added 9 keywords + regex patterns for delegation phrases                                 | **Fixed** |

---

## Open Findings

### OB-F56 — No multi-phase "deep mode" for complex analysis tasks (Medium)

**Problem:** OpenBridge currently processes all tasks in a single pass: classify → execute → respond. For complex analysis tasks (codebase audits, refactoring plans, security reviews), this produces shallow results compared to a multi-phase approach: investigate → report findings → plan tasks → execute → verify.

Non-developer business users have no way to access the deeper workflow that developers use when working directly with Claude Code (investigate, document findings, brainstorm, create task list, execute, verify).

**Impact:** Users who need thorough analysis get single-pass answers. The system can't pause for user steering between phases ("focus on finding #2", "skip task 3", "use opus for this one").

**Proposed solution — "Deep Mode" execution profiles:**

1. **Execution profiles** — user-configurable per message or per user:
   - `fast`: Current flow (classify → execute → done)
   - `thorough`: Multi-phase (investigate → report → plan → execute → verify)
   - `manual`: Like thorough but pauses at every phase for user approval

2. **Per-phase model selection** — users configure which model tier to use per phase:
   - Investigation: powerful (deep reasoning)
   - Planning: powerful (architecture decisions)
   - Execution: balanced (code writing)
   - Verification: fast (quick checks)

3. **Interactive phase navigation** — users can steer via chat commands:
   - "proceed" / "go" — advance to next phase
   - "focus N" — dig deeper into finding N
   - "skip N" — skip task N
   - "use opus for task 1" — override model for a specific task

4. **Phase state machine** — tracks current phase, allows back/skip/focus navigation

**Scope:** Major feature (v0.6.0+), estimated 30–40 tasks across 3–4 phases.

**Key components needed:**

- Deep mode classifier (detect when task needs multi-phase)
- Phase state machine in `master-manager.ts`
- Interactive commands in `router.ts`
- Phase-aware system prompts per worker role
- User preferences store in SQLite (model prefs, depth settings)
- Progress reporting per phase (extends existing progress events)

**See also:** [ROADMAP.md — Deep Mode](../ROADMAP.md)

---

> **Status:** Partially fixed — core state machine, phase transitions, and 5 interactive commands (/deep, /proceed, /focus, /skip, /phase) are implemented. Remaining: 20 tasks (phase-aware worker prompts, parallel execution, result aggregation, session history, user preferences).

---

### OB-F69 — No delivery path for interactive web apps (High)

**Problem:** When a user asks "create me an interactive website with a database," OpenBridge has no way to:

1. **Serve the app** — file-server only serves static files from `.openbridge/generated/`, no dynamic backend
2. **Expose it to the user's phone** — file-server runs on localhost:3001, unreachable from mobile
3. **Handle user interactions** — no mechanism to receive form submissions, clicks, or data back from the served app
4. **Manage the app lifecycle** — no way to start/stop/monitor ephemeral apps

This is a fundamental capability gap: OpenBridge can generate code but cannot deploy it in a way the user can actually interact with.

**Impact:** Users who want interactive outputs (dashboards, forms, databases, tools) get dead files instead of live apps. Limits OpenBridge to text-only and static-file responses.

**Proposed solution — phased approach:**

**Phase A: Tunnel Integration (~8–10 tasks)**

- Integrate `cloudflared tunnel` or `localtunnel` for exposing local servers
- Auto-detect installed tunnel tools (extend `tool-scanner.ts`)
- New `TunnelManager` in `src/core/tunnel-manager.ts`:
  - `startTunnel(port)` → returns public URL
  - `stopTunnel()`
  - Auto-cleanup on process exit
- Master sends public URL to user via `[SHARE:channel]` or inline message
- File-server gets a public URL → Master can share generated HTML via link

**Phase B: Ephemeral App Server (~10–12 tasks)**

- New `AppServer` in `src/core/app-server.ts`:
  - Worker generates app (HTML + JS + SQLite/JSON backend)
  - Worker writes app to `.openbridge/generated/apps/{app-id}/`
  - AppServer auto-detects `package.json` or `index.html` and starts it
  - Lifecycle: start → monitor → idle timeout → stop
  - Tunnel exposes it → URL sent to user
- Master system prompt updated with `[APP:start]/path/to/app[/APP]` marker
- Router parses `[APP:*]` markers and manages lifecycle

**Phase C: Interaction Relay (~8–10 tasks)**

- WebSocket bridge between served app and OpenBridge
- App includes a client-side SDK (`openbridge-client.js`) injected by AppServer
- User interactions (form submit, button click) relayed back to Master
- Master can respond to interactions (update data, generate new content)
- Enables conversational web apps: user fills form → Master processes → updates page

**Phase D: Smart Output Router (~5–8 tasks)**

- Master auto-classifies output type:
  - Text → direct message
  - Static file → `[SHARE:channel]` attachment
  - Static page → file-server + tunnel → URL
  - Interactive app → ephemeral server + tunnel → URL + lifecycle
- No user intervention needed — Master picks best delivery autonomously

**Key files to create:** `src/core/tunnel-manager.ts`, `src/core/app-server.ts`, `src/core/interaction-relay.ts`
**Key files to modify:** `src/master/master-system-prompt.ts`, `src/core/router.ts`, `src/discovery/tool-scanner.ts`

**Dependencies:** OB-F68 (Master must first learn `[SHARE:*]` markers)

**Scope:** Major feature — ~30–40 tasks across 3–4 phases. Aligns with backlog item OB-124 (Interactive AI views).

---

---

### OB-F72 — No document visibility controls — AI can read entire workspace (Medium)

**Problem:** When OpenBridge targets a workspace, the Master AI and all workers can read every file in that directory tree. There are no controls for:

- Which files/directories are visible to the AI
- Which files are explicitly hidden (secrets, personal docs, credentials)
- Automatic detection of sensitive files (`.env`, `*.pem`, `*.key`, `credentials.json`)
- Redaction of secret patterns before content reaches the AI

The existing `scopes` field in `access-store.ts` checks file paths mentioned in _user messages_ (regex-based), but does NOT restrict what files the AI can actually read via `Read`/`Glob`/`Grep` tools.

**Impact:** Users may have sensitive files in their workspace (API keys in `.env`, SSH keys, personal documents, database dumps) that get read by the AI during exploration or task execution. No warning, no prevention.

**Proposed solution:**

1. **Config-based visibility controls:**

   ```json
   {
     "workspace": {
       "include": ["src/", "docs/", "tests/", "package.json", "tsconfig.json"],
       "exclude": [
         ".env",
         ".env.*",
         "*.pem",
         "*.key",
         "*.p12",
         "*.pfx",
         "credentials.*",
         "secrets/",
         "*.sqlite",
         "*.db",
         "node_modules/",
         ".git/objects/"
       ],
       "autoDetectSecrets": true
     }
   }
   ```

2. **Secret file scanner** — on startup, scan workspace for known sensitive file patterns:
   - `.env`, `.env.local`, `.env.production`
   - `*.pem`, `*.key`, `*.p12`, `id_rsa`, `id_ed25519`
   - `credentials.json`, `service-account.json`
   - `*.sqlite`, `*.db` (non-openbridge databases)
   - Log warning + add to auto-exclude list

3. **Content redaction layer** (optional, advanced):
   - Before sending file content to AI, scan for patterns:
     - API keys: `sk-...`, `AKIA...`, `ghp_...`, `ghs_...`
     - Connection strings: `postgres://`, `mongodb://`, `redis://`
     - Private keys: `-----BEGIN (RSA |EC |)PRIVATE KEY-----`
   - Replace with `[REDACTED:api_key]` placeholder
   - Log redaction events for transparency

4. **Workspace boundary enforcement** — extend `workspace-manager.ts`:
   - `isFileVisible(path)` → checks include/exclude rules
   - Called before all file read operations
   - Workers receive filtered glob results (excluded files removed)

5. **User-facing transparency:**
   - `/scope` command shows current visibility rules
   - `/secrets` command shows detected sensitive files and their status (excluded/allowed)
   - Setup wizard asks about visibility preferences

**Key files:** `src/core/workspace-manager.ts`, `src/types/config.ts`, `src/core/agent-runner.ts`, `src/master/master-system-prompt.ts`, `src/cli/init.ts`

**Scope:** ~15–20 tasks across 2 phases. Medium priority but high user trust impact.

---

### OB-F73 — WebChat has no authentication (Critical)

**Problem:** The WebChat connector serves its HTML UI on `localhost:3000` with zero authentication. There is no login page, no password, no API token, no session cookie. Once the WebChat is exposed beyond localhost (via LAN binding `0.0.0.0` or tunnel integration from OB-F69 Phase 82), **anyone with the URL can send messages to the Master AI**, which can then spawn workers that read/write files, run commands, and access MCP servers.

The phone whitelist in `auth.ts` only applies to WhatsApp, Telegram, and Discord connectors — WebChat bypasses it entirely. The WebChat connector's `parseMessage()` always sets `sender: 'webchat-user'` with no identity verification.

**Impact:** Security vulnerability. Exposing WebChat to LAN or internet without auth gives any network user full control over the Master AI and workspace. A malicious user could exfiltrate code, modify files, or abuse API quotas. This is the #1 blocker for making WebChat accessible from a phone.

**Proposed solution:**

1. **Token-based auth** (simplest) — generate a random token on first startup, display it in console output. WebChat requires `?token=xxx` in the URL or sends token in WebSocket handshake. No token = connection rejected.

2. **Password auth** — `config.json` gets `webchat.password` field. WebChat shows a login screen before the chat UI. Password checked server-side, session stored in a cookie/localStorage.

3. **QR code auth** (mobile-friendly) — similar to WhatsApp Web. When user opens WebChat on phone, show a QR code on the console/Electron app. Scan → authenticated session.

4. **Rate limiting** — even with auth, add per-IP rate limiting to prevent abuse from compromised tokens.

5. **Integration with existing access-store** — authenticated WebChat users get mapped to access control entries (roles, scopes, daily budgets).

**Key files:** `src/connectors/webchat/webchat-connector.ts`, `src/connectors/webchat/webchat-config.ts`, `src/core/auth.ts`

**Scope:** ~10–12 tasks. Critical — must ship before any LAN/tunnel exposure.

**Dependencies:** Must be completed BEFORE OB-F75 (phone access) and OB-F69 Phase 82 (tunnel).

---

### OB-F74 — WebChat UI is an inlined HTML string — blocks all frontend improvements (High)

**Problem:** The entire WebChat frontend — HTML, CSS, and JavaScript — is a single 350-line template string (`CHAT_HTML`) inside `webchat-connector.ts` (lines 38–384). This means:

1. **No component architecture** — everything is in one monolithic string. Adding a sidebar, settings panel, or history view means growing this string to 1000+ lines.
2. **No framework** — vanilla JS with `document.getElementById()` and manual DOM manipulation. State management is scattered global variables.
3. **No build tooling** — no TypeScript, no linting, no formatting on the frontend code. String-embedded JS doesn't get checked by `tsc` or ESLint.
4. **Painful to edit** — template strings require escaping backticks, no IDE support (no syntax highlighting, no autocomplete inside the string).
5. **No theming** — colors are hardcoded hex values. Adding dark mode means duplicating all CSS.
6. **No testing** — frontend logic (markdown parser, WebSocket handler, dashboard updates) cannot be unit tested.
7. **No accessibility** — zero ARIA labels, no keyboard navigation, no screen reader support.

The current markdown renderer is ~40 lines of `string.split()` calls that only handle bold, italic, code blocks, and newlines — no headers, lists, tables, links, or blockquotes.

**Impact:** Every planned WebChat improvement (conversation history, Deep Mode UI, RAG panel, settings, MCP management, slash commands, notifications) is dramatically harder to build inside this architecture. This is the fundamental blocker for WebChat modernization.

**Proposed solution:**

1. **Extract to separate files** — move HTML/CSS/JS out of the TS string into `src/connectors/webchat/ui/` directory
2. **Lightweight framework** — adopt Preact (3KB gzipped) or Alpine.js for reactivity without a full build pipeline
3. **Component structure** — split into components: ChatMessages, InputBar, AgentDashboard, StatusBar, Sidebar (history), Settings
4. **CSS variables** — replace hardcoded colors with CSS custom properties for theming (light/dark)
5. **Proper markdown** — replace the 40-line string splitter with `marked` or `snarkdown` (inlined, no CDN dependency)
6. **Syntax highlighting** — add `highlight.js` core (11KB) for code blocks with copy button
7. **Build step** — simple esbuild/Vite script that bundles `ui/` → single string injected into connector at build time
8. **Keep self-contained** — final output is still a single HTML string served by the connector, but developed as proper files

**Key files:** `src/connectors/webchat/webchat-connector.ts` (lines 38–384), `src/connectors/webchat/ui/` (new directory)

**Scope:** ~12–15 tasks. High priority — unblocks all subsequent WebChat features.

---

### OB-F75 — WebChat not accessible from user's phone (High)

**Problem:** When a user runs OpenBridge on their laptop, the WebChat is only accessible at `http://localhost:3000` — meaning only that same machine can use it. The user cannot open the WebChat from their phone, even on the same WiFi network. This creates a gap where WhatsApp/Telegram/Discord users can message OpenBridge from their phones, but WebChat users cannot.

Three layers of the problem:

1. **Localhost binding** — `webchat-config.ts` defaults to `host: 'localhost'`. This rejects connections from any other device. Changing to `0.0.0.0` allows LAN access but the user must know their machine's IP address.
2. **No internet exposure** — for access outside the local network, a tunnel is needed (covered by OB-F69 Phase 82), but the WebChat itself has no awareness of public URLs and doesn't display them.
3. **No mobile optimization** — the UI works on mobile (max-width 720px) but has small tap targets, no PWA manifest (can't "Add to Home Screen"), no service worker (no offline shell), no touch gestures (swipe for sidebar).

**Impact:** The WebChat is limited to desktop-only use on the machine running OpenBridge. Users who want a phone-based experience must use WhatsApp/Telegram/Discord instead. This undermines the vision of WebChat as a self-hosted, zero-dependency chat interface.

**Proposed solution:**

1. **LAN access** (~3 tasks):
   - Add `host` option to `webchat-config.ts` with `'0.0.0.0'` as recommended value
   - Display LAN URL in console output on startup: `WebChat available at http://192.168.x.x:3000`
   - Auto-detect local IP addresses and show them to the user
   - Show QR code in console with the LAN URL for easy phone scanning

2. **Tunnel-aware WebChat** (~4 tasks, extends OB-F69 Phase 82):
   - When tunnel is active, display public URL in WebChat header
   - Show public URL + QR code in console output
   - Auto-copy tunnel URL to clipboard on startup
   - WebChat UI shows "Share this link" button with the public URL

3. **Mobile PWA** (~8–10 tasks):
   - Add `manifest.json` (app name, icons, theme color, start URL, display: standalone)
   - Add service worker for offline shell (cache HTML/CSS/JS, show "Reconnecting..." when offline)
   - Responsive CSS breakpoints: full-width on mobile, centered on desktop
   - Touch-friendly: 44px minimum tap targets, larger send button, swipe gestures
   - iOS safe area insets (`env(safe-area-inset-bottom)`)
   - "Add to Home Screen" prompt on first mobile visit
   - Viewport meta tag optimization for mobile keyboards

4. **Mobile-specific features** (~5 tasks):
   - Haptic feedback on message send (Vibration API)
   - Pull-to-refresh for reconnection
   - Browser notifications for completed tasks (`Notification.requestPermission()`)
   - Tab title updates: `(3) OpenBridge` for unread messages
   - Sound notification on response arrival (optional, with mute toggle)

**Key files:** `src/connectors/webchat/webchat-connector.ts`, `src/connectors/webchat/webchat-config.ts`, `src/connectors/webchat/ui/` (new, after OB-F74)

**Scope:** ~20–25 tasks across 2 phases. Depends on OB-F73 (auth) and OB-F74 (frontend extraction).

**Dependencies chain:** OB-F74 (extract UI) → OB-F73 (add auth) → OB-F75 (expose + mobile)

**See also:** OB-F69 Phase 82 (tunnel integration), [FUTURE.md — WebChat Modernization](FUTURE.md)

### Tier 2d — Autonomy & Continuity Improvements (v0.0.14)

Improvements identified from real-world testing — the Master AI lacks runtime flexibility and batch execution capability.

| #      | Finding                                                | Severity | Improvement Impact                                                                         | Status |
| ------ | ------------------------------------------------------ | -------- | ------------------------------------------------------------------------------------------ | ------ |
| OB-F93 | Workers cannot request elevated tool access at runtime | 🟠 High  | Workers fail silently when they need tools beyond their profile — no way to ask the user   | Open   |
| OB-F94 | Master cannot loop through batch tasks autonomously    | 🟠 High  | "Implement all tasks one by one" spawns 1-2 workers then stops — no continuation mechanism | Open   |

### OB-F93 — Workers cannot request elevated tool access at runtime (High)

**Problem:** Workers are spawned with a fixed tool profile (e.g., `read-only`, `code-edit`). If a worker encounters a situation where it needs a tool outside its assigned profile — for example, a `read-only` worker discovering it needs to run `npm test` to verify a finding — it simply fails. There is no mechanism for the worker to request elevated access, for the Master to detect this need, or for the user to grant additional permissions mid-execution.

The existing `requestSpawnConfirmation()` flow in the Router only applies **before** worker dispatch (pre-spawn), not during execution. The `consentMode` in `access_control` controls whether to ask before spawning high-risk workers, but doesn't handle runtime escalation.

**Impact:** Workers waste turns trying to work around tool restrictions (especially Codex workers doing shell gymnastics per OB-F91). Users must manually re-request with a different instruction to get the Master to spawn a worker with a higher-privilege profile. This breaks the "zero config, AI does the work" principle.

**Observed in logs:**

```
Worker spawned with read-only profile → discovers it needs Bash(npm:test)
→ fails or wastes turns on workarounds → user gets incomplete result
→ user must re-ask → Master spawns new worker with code-audit profile
```

**Proposed solution — Escalation Queue + Persistent Tool Grants:**

1. **Escalation Queue** — new `pendingEscalations` map in the Router (mirrors `pendingSpawnConfirmations`):
   - Worker fails with "tool not allowed" → Master detects failure reason
   - Master creates an escalation request → Router sends to user via connector
   - User replies `/allow Bash(npm:test)` or `/allow code-edit` (upgrade whole profile)
   - Escalation has 60s TTL, auto-deny if no response
   - Grant scope: `once` (this worker), `session` (all workers this session), `permanent` (stored in DB)

2. **Persistent Tool Grants** — extend `access_control` table:
   - New column `approved_tool_escalations` (JSON array of granted tools/profiles)
   - When a user permanently grants a tool, it's added to their access entry
   - Future workers auto-receive these grants without re-asking

3. **Tiered Auto-Approval** — extend existing `consentMode`:
   - `auto-approve-read` → also auto-approve `code-audit` escalations (low risk)
   - New mode: `auto-approve-up-to-edit` → auto-approve up to `code-edit`, ask for `full-access`
   - Follows existing risk hierarchy: `low → medium → high → critical`

4. **Pre-flight Tool Analysis** — before spawning, Master predicts needed tools from task prompt:
   - If predicted tools exceed assigned profile, ask upfront instead of failing mid-execution
   - Reduces the "fail, ask, retry" cycle

**Key files:** `src/core/router.ts`, `src/core/auth.ts`, `src/memory/access-store.ts`, `src/master/master-manager.ts`, `src/types/agent.ts`, `src/core/agent-runner.ts`

**Scope:** ~18–22 tasks across Phase 97.

---

### OB-F94 — Master cannot loop through batch tasks autonomously (High)

**Problem:** When a user sends a batch instruction like "implement all pending tasks one by one and commit after each," the Master AI treats it as a single message → single response cycle. It spawns 1-2 workers for the first task(s), sends a response, and stops. There is no mechanism for the Master to automatically continue to the next task after the current batch completes.

The Master's `processMessage()` in `master-manager.ts` is purely request-response: receive message → classify → spawn workers → collect results → respond → done. There's no loop, no continuation trigger, no batch state tracking.

**Impact:** Users who want automated multi-task execution must manually send "continue" or "next task" after every response. This defeats the purpose of autonomous task execution. The logs show exactly this pattern:

```
User: "implement pending tasks one by one, commit after each"
Master: spawns 2 workers → completes → sends response → STOPS
User must manually say: "continue with the next task"
```

**Proposed solution — Self-Messaging Loop + Batch State:**

1. **Batch Mode Detection** — Master classifies batch requests:
   - Keywords: "one by one", "all tasks", "each one", "implement all", "go through all"
   - Sets `batchMode: true` with task source (TASKS.md, finding list, etc.)
   - Stores batch plan: total items, current index, completed list

2. **Self-Messaging Continuation** — after workers complete and response is sent:
   - Master checks: is this a batch request? Are there remaining items?
   - If yes, injects a synthetic `[CONTINUE:batch-{id}]` message into the Router
   - Router recognizes `[CONTINUE:*]` as an internal continuation, re-invokes Master
   - Master picks up next task from batch state, spawns workers, continues

3. **Batch State Persistence** — stored in `.openbridge/batch-state.json`:
   - `batchId`, `totalItems`, `currentIndex`, `completedItems[]`, `failedItems[]`
   - Survives crashes and restarts — Master can resume interrupted batches
   - User sees progress: "Task 3/15 done. Starting task 4..."

4. **Progress Messages** — after each task:
   - Send progress update: "Task OB-1412 done. Starting OB-1413... (3/149)"
   - Include brief summary of what was done and what's next

5. **Safety Rails:**
   - `maxBatchIterations` config (default: 20) — prevents infinite loops
   - `batchBudgetUsd` cap (default: $5.00) — stops when cumulative cost exceeds budget
   - User can `/stop` or `/pause` at any time
   - Auto-pause on worker failure (ask user whether to skip or retry)
   - Batch timeout: max 2 hours total

6. **Batch Commands:**
   - `/pause` — pause batch execution (resume with `/continue`)
   - `/continue` — resume paused batch
   - `/batch` — show batch status (current task, progress, cost so far)
   - `/batch abort` — cancel remaining tasks

**Key files:** `src/master/master-manager.ts`, `src/core/router.ts`, `src/master/dotfolder-manager.ts`, `src/types/config.ts`, `src/types/agent.ts`

**Scope:** ~20–24 tasks across Phase 98.

---

### OB-F95 — Worker re-spawn crash after escalation grant (Critical)

**Source:** Production Telegram session logs (2026-03-05, PID 11034)

**Problem:** When a user grants `/allow` for a worker, `respawnWorkerAfterGrant()` creates an escalated worker ID (`-escalated` suffix) but does NOT register it in `WorkerRegistry` before spawning. When the spawn fails or completes, `markFailed()` throws because the worker doesn't exist.

**Impact:** Tool escalation grants silently fail — the user approves elevated permissions, but the worker never actually runs.

**Key files:** `src/master/master-manager.ts` (lines ~6782, ~6972, ~7490), `src/master/worker-registry.ts` (line ~205)

**Scope:** ~3–5 tasks (Phase 99)

---

### OB-F96 — Escalation state cleared before all workers granted (High)

**Source:** Production Telegram session logs (2026-03-05)

**Problem:** When multiple workers request tool escalation simultaneously, the user's `/allow` response consumes the escalation for one worker, but subsequent `/allow` attempts get "no pending escalation". The escalation queue doesn't handle batched escalation requests properly.

**Impact:** When Master spawns 3 workers needing escalation, the user can only grant one. The other 2 are stuck.

**Key files:** `src/core/router.ts`, `src/master/master-manager.ts`

**Scope:** ~6–8 tasks (Phase 99)

---

### OB-F97 — Escalation timeout too short for multi-worker spawns (Medium)

**Source:** Production Telegram session logs (2026-03-05)

**Problem:** Escalation requests auto-deny after 60 seconds. When 3 workers are spawned simultaneously, the user needs time to understand the prompts, decide, and respond. 60 seconds is insufficient — especially on mobile (Telegram).

**Impact:** Workers are auto-denied before the user can respond, especially for multi-worker batches.

**Key files:** `src/core/router.ts`, `src/types/config.ts`

**Scope:** ~3–4 tasks (Phase 99)

---

### OB-F98 — Misclassification of strategic/brainstorming messages (High) ✅ Fixed

**Source:** Production Telegram session logs (2026-03-05)

**Problem:** The keyword-based classifier assigns wrong task classes: "Can you brainstorm with me?" → `quick-answer` (5 turns), "create a strategy to commercialise" → `text-generation` (5 turns). Both should be `complex-task` (25 turns). The keyword fallback to `quick-answer` is too aggressive.

**Impact:** Strategic questions get only 5 turns, producing shallow answers. The Master can't do justice to complex planning requests.

**Key files:** `src/master/master-manager.ts` (classification logic)

**Scope:** ~4–6 tasks (Phase 100)

**Fixed in:** OB-1648 (strategic keywords), OB-1649 (text-gen maxTurns 5→10), OB-1650 (long multi-sentence → tool-use), OB-1651 (length heuristic → complex-task), OB-1652 (tests)

---

### OB-F99 — RAG returns zero results for real user questions (Medium)

**Source:** Production Telegram session logs (2026-03-05)

**Problem:** Substantive user questions return `confidence: 0, chunkCount: 0` from the RAG system, while trivial single-character queries like "1" return `confidence: 0.8, chunkCount: 10`. Likely a FTS5 tokenization or query construction issue in `buildSearchQuery`.

**Impact:** RAG system fails to provide relevant workspace context for real questions, making Master responses less informed.

**Key files:** `src/core/knowledge-retriever.ts`, `src/memory/chunk-store.ts`, `src/memory/retrieval.ts`

**Scope:** ~4–5 tasks (Phase 100)

---

### OB-F100 — Single-character messages trigger full agent invocations (Low)

**Source:** Production Telegram session logs (2026-03-05)

**Problem:** Messages like "1", "3", "4" (likely menu/option selections) go through the full pipeline: classification → RAG query → agent spawn. The message "1" took 64 seconds and cost $0.022.

**Impact:** Wasted compute and user wait time for what are likely simple follow-up selections.

**Key files:** `src/master/master-manager.ts`, `src/core/knowledge-retriever.ts`

**Scope:** ~3–4 tasks (Phase 100)

---

### OB-F101 — Codex worker cost spike ($1.14 for single read-only task) (Medium)

**Source:** Production Telegram session logs (2026-03-05)

**Problem:** One Codex worker (`gpt-5.2-codex`, read-only profile) cost $1.14 for a single invocation — roughly 100x the typical agent cost of ~$0.01. No per-worker cost caps exist.

**Impact:** Unpredictable cost spikes. A read-only research task should not cost $1.14.

**Key files:** `src/core/agent-runner.ts`, `src/master/master-manager.ts`

**Scope:** ~3–4 tasks (Phase 102)

---

### OB-F102 — Master response truncated to empty after SPAWN marker removal (Medium)

**Source:** Production Telegram session logs (2026-03-05, 3 occurrences)

**Problem:** When the Master's entire response consists of SPAWN markers with no surrounding text, removing the markers leaves `cleanedLength: 0`. The user gets a generic status message instead of the Master's analysis.

**Impact:** The user receives a vague "I'm working on it" message instead of the Master's actual plan.

**Key files:** `src/master/master-manager.ts`, `src/master/master-system-prompt.ts`

**Scope:** ~3–4 tasks (Phase 100)

---

### OB-F103 — Orphaned workers never reach terminal state (Critical)

**Source:** Production Telegram session logs (2026-03-05)

**Problem:** 7 of 61 workers in a session were unaccounted for — never reached completed/failed/cancelled. Root causes: escalation timeout doesn't mark as cancelled, re-spawn crash leaves both workers in limbo, escalation queue consumed by first grant. One worker ran for 23,174 seconds (6.4 hours).

**Impact:** Orphaned workers consume system resources, hold API connections open, and count against concurrency limits.

**Key files:** `src/master/worker-registry.ts`, `src/master/master-manager.ts`, `src/core/agent-runner.ts`

**Scope:** ~6–8 tasks (Phase 99)

---

### OB-F104 — Workers exhaust max-turns without completing (Medium)

**Source:** Production Telegram session logs (2026-03-05)

**Problem:** Multiple workers exit with code 0 but `turnsExhausted: true` — they hit the max-turns limit before finishing. Results are marked "completed" but work is incomplete.

**Impact:** Workers counted as "completed" in batch stats even though their output is partial. Master receives incomplete results.

**Key files:** `src/core/agent-runner.ts`, `src/master/master-manager.ts`, `src/master/worker-result-formatter.ts`

**Scope:** ~4–5 tasks (Phase 102)

---

### OB-F105 — Master tool selection flow redundant and confusing (Medium)

**Source:** Production Telegram session logs (2026-03-05)

**Problem:** During startup, three separate mechanisms determine the Master AI tool, producing 5 contradictory log lines. The reason for exclusion is never logged, making troubleshooting difficult.

**Key files:** `src/index.ts`, `src/discovery/tool-scanner.ts`

**Scope:** ~2–3 tasks (Phase 103)

---

### OB-F106 — Whitelist normalization drops entries without identifying which (Medium)

**Source:** Production Telegram session logs (2026-03-05)

**Problem:** Auth initialization normalizes 7 whitelist entries to 6, logging a warning but not identifying which entry was dropped or why.

**Impact:** If the dropped entry is a real phone number, that user is silently locked out.

**Key files:** `src/core/auth.ts`, `src/cli/init.ts`

**Scope:** ~2–3 tasks (Phase 103)

---

### OB-F107 — `.env.example` incorrectly flagged as sensitive file (Low)

**Source:** Production Telegram session logs (2026-03-05)

**Problem:** The sensitive file detector auto-excludes `.env.example` from AI visibility, but it's a template with placeholder values, not real secrets.

**Key files:** `src/core/bridge.ts`

**Scope:** ~2 tasks (Phase 103)

---

### OB-F108 — Batch continuation timers not cancelled on shutdown (Medium)

**Source:** Code review of Phase 98 batch continuation implementation

**Problem:** Batch continuation uses `setTimeout()` at 4 locations in `master-manager.ts` to schedule the next batch item. These timer handles are never stored or cleared during `shutdown()`.

**Impact:** If `shutdown()` is called while a batch timer is pending, it fires into a partially destroyed system.

**Key files:** `src/master/master-manager.ts` (lines ~2518, ~2544, ~2561, ~5328, ~6426)

**Scope:** ~2 tasks (Phase 101)

---

### OB-F109 — Unhandled rejections in batch continuation fire-and-forget (Medium)

**Source:** Code review of Phase 98 batch continuation implementation

**Problem:** All batch continuation timers use `void router.routeBatchContinuation(...)` — the `void` operator discards the Promise. Any rejection is an unhandled promise rejection that can crash the process.

**Key files:** `src/master/master-manager.ts` (lines ~2519, ~2545, ~2562, ~5329)

**Scope:** ~1 task (Phase 101)

---

### OB-F110 — Docker sandbox `exec()` reads wrong property for exit code (Medium)

**Source:** Code review of Docker sandbox implementation (OB-1545)

**Problem:** Error handler reads `execErr.code` (a string like `'ENOENT'`) instead of `.status` (the numeric exit code). All non-zero exits default to 1.

**Key files:** `src/core/docker-sandbox.ts` (line ~201–206)

**Scope:** ~1 task (Phase 103)

---

### OB-F111 — Docker sandbox has no container cleanup on process crash (Medium)

**Source:** Code review of Docker sandbox implementation (OB-1545)

**Problem:** `DockerSandbox` has no process exit handler to clean up running containers. If the bridge crashes, orphaned Docker containers continue running indefinitely.

**Key files:** `src/core/docker-sandbox.ts`, `src/core/bridge.ts`

**Scope:** ~2 tasks (Phase 103)

---

### OB-F112 — Batch sender info not persisted across process restarts (Low)

**Source:** Code review of Phase 98 batch continuation implementation

**Problem:** `batchSenderInfo` is an in-memory `Map`. Batch state is persisted to `.openbridge/batch-state.json` but sender routing info is lost on restart.

**Key files:** `src/master/master-manager.ts` (line ~600), `src/master/batch-manager.ts`

**Scope:** ~2 tasks (Phase 101)

---

### OB-F113 — 37 test failures from stale mocks after Phase 98 (High)

**Source:** Test suite analysis after Phase 98 automated task runner session

**Problem:** Phase 98 added new `DotFolderManager` methods (`readBatchState`, `writeBatchState`, `deleteBatchState`) and new `MasterManager.start()` behavior. 7 test files with incomplete mocks produce 37 failures.

**Impact:** CI is red. Test failures mask real regressions.

**Key files:** 7 test files (see RUNTIME-ISSUES-2026-03-05.md for full list)

**Scope:** ~4–6 tasks (Phase 104)

---

### OB-F114 — `getActiveBatchId()` returns paused batches, inconsistent with `isActive()` (Low)

**Source:** Code review of Phase 98 batch continuation implementation

**Problem:** `isActive()` excludes paused batches, but `getActiveBatchId()` includes them. Undocumented asymmetry — semantic trap for future callers.

**Key files:** `src/master/batch-manager.ts` (lines ~472, ~493)

**Scope:** ~1 task (Phase 101)

---

### OB-F79 — Memory has no vector search — FTS5 only (High)

**Inspired by:** [openclaw/openclaw](https://github.com/openclaw/openclaw) — uses `sqlite-vec` for vector embeddings with hybrid search (vector + FTS5 + SQLite filters), MMR (Maximal Marginal Relevance) for result diversity, and temporal decay scoring.

**Problem:** OpenBridge's memory system (`src/memory/retrieval.ts`) uses FTS5 full-text search only. This works for keyword matches but misses semantically related content. When a user asks "how does authentication work?", FTS5 won't find chunks about "login flow", "JWT tokens", or "session management" unless those exact words are stored.

**Impact:** RAG quality is limited to keyword matching. Large codebases with varied terminology produce poor retrieval results. Workers waste turns re-reading files that are already in the chunk store under different words.

**Proposed solution:**

1. Add `sqlite-vec` dependency for vector storage alongside existing FTS5
2. Add embedding provider abstraction — support OpenAI `text-embedding-3-small`, local llama embeddings, or Voyage (user's choice via config)
3. Hybrid search strategy: vector similarity + FTS5 text match + SQLite metadata filters
4. MMR for result diversity — prevent returning 5 chunks from the same file
5. Temporal decay — recent chunks rank higher than stale exploration data
6. Batch embedding operations for efficient chunk processing during exploration
7. Graceful fallback — if no embedding provider configured, fall back to FTS5-only (current behavior)

**Key files:** `src/memory/retrieval.ts`, `src/memory/chunk-store.ts`, `src/memory/database.ts`, `src/types/config.ts`

**Scope:** ~15–18 tasks across 2 phases. Integrates with planned RAG work (OB-F48, Phases 74–77).

---

### OB-F80 — No structured observations from worker outputs (High)

**Inspired by:** [thedotmack/claude-mem](https://github.com/thedotmack/claude-mem) — runs a dedicated observer agent that creates typed observations with title, subtitle, narrative, facts, concepts, and files_touched from every tool invocation.

**Problem:** When workers complete tasks, their output is free-form text stored in `conversation_messages`. There's no structured extraction of what was learned — no typed records with facts, concepts, files read/modified, or knowledge gained. The Master reads the raw output and manually curates `memory.md`, but this is lossy and inconsistent.

**Impact:** Valuable knowledge from worker sessions is lost or under-utilized. The same questions trigger new workers instead of querying past observations. `memory.md` is the only cross-session continuity mechanism, limited to 200 lines.

**Proposed solution:**

1. Add `observations` table to SQLite schema — columns: `id`, `session_id`, `type` (bugfix, architecture, investigation, etc.), `title`, `narrative`, `facts` (JSON array), `concepts` (JSON array), `files_read` (JSON array), `files_modified` (JSON array), `created_at`
2. Add `observation-extractor.ts` — parses worker results into structured observations using a lightweight AI call (haiku-tier, 1-turn, all tools disabled)
3. Wire extractor into `worker-result-formatter.ts` — extract observations after every worker completes
4. Add FTS5 virtual table for observations with sync triggers
5. Content-hash deduplication (SHA-256 of session_id + title + narrative) with 30s window to prevent duplicates
6. Expose observations in retrieval.ts for RAG queries

**Key files:** `src/memory/observation-store.ts` (new), `src/master/worker-result-formatter.ts`, `src/memory/database.ts`, `src/memory/retrieval.ts`

**Scope:** ~12–15 tasks across 1–2 phases.

---

### OB-F81 — Memory retrieval returns full results — no progressive disclosure (Medium)

**Inspired by:** [thedotmack/claude-mem](https://github.com/thedotmack/claude-mem) — uses a 3-layer retrieval pattern: `search()` returns compact index (~50-100 tokens/result), `timeline()` provides chronological context, `get_observations()` fetches full details only for filtered IDs. Claims ~10x token savings.

**Problem:** OpenBridge's `retrieval.ts` returns full chunk content for every search result. When the Master queries memory, it gets all matching content upfront — wasteful when only 2 of 20 results are relevant.

**Impact:** Token waste during RAG queries. Master's context window fills with irrelevant retrieved content, reducing space for actual work.

**Proposed solution:**

1. Add `searchIndex()` — returns compact results: `{ id, title, score, snippet(50 chars), source_file }` (~50 tokens each)
2. Add `getDetails(ids: string[])` — returns full content only for selected IDs
3. Wire into Master's retrieval flow: search → filter → fetch details
4. Master system prompt teaches the 2-step retrieval pattern

**Key files:** `src/memory/retrieval.ts`, `src/master/master-system-prompt.ts`

**Scope:** ~6–8 tasks.

---

### OB-F82 — No content-hash deduplication for workspace chunks (Medium)

**Inspired by:** [thedotmack/claude-mem](https://github.com/thedotmack/claude-mem) — uses SHA-256 content hash with 30-second deduplication window to prevent storing duplicate observations.

**Problem:** When multiple workers read overlapping files, or when re-exploration runs, the same chunk content can be stored multiple times in `workspace_chunks`. There's no deduplication mechanism.

**Impact:** Database bloat. FTS5 search returns duplicate results. Memory retrieval wastes tokens on repeated content.

**Proposed solution:**

1. Add `content_hash` column to `workspace_chunks` table (SHA-256 of `chunk_path + content`)
2. Before INSERT, check for existing chunk with same hash — update timestamp if found, skip insert
3. Add 30-second deduplication window for rapid successive writes
4. Add migration to backfill hashes for existing chunks

**Key files:** `src/memory/chunk-store.ts`, `src/memory/database.ts`, `src/memory/migration.ts`

**Scope:** ~5–6 tasks.

---

### OB-F83 — No token economics tracking for exploration ROI (Medium)

**Inspired by:** [thedotmack/claude-mem](https://github.com/thedotmack/claude-mem) — tracks `discovery_tokens` (cost of creating each observation) vs `read_tokens` (cost of retrieving it), computing compression ROI.

**Problem:** OpenBridge has no visibility into whether exploration is cost-effective. How many tokens does exploration consume? How many tokens does retrieval save compared to re-reading? Is the Master's exploration strategy efficient?

**Impact:** No data to optimize exploration strategy or justify exploration cost. Can't tell if the Master is over-exploring or under-exploring.

**Proposed solution:**

1. Track `discovery_tokens` per chunk/observation — estimated from worker turn count and model
2. Track `read_tokens` per retrieval — count tokens in returned content
3. Add `token_economics` table: `chunk_id`, `discovery_tokens`, `retrieval_count`, `total_read_tokens`
4. Add `/stats` command showing exploration ROI: "Explored with ~50K tokens, saved ~200K tokens across 15 retrievals (4x ROI)"

**Key files:** `src/memory/chunk-store.ts`, `src/core/router.ts`, `src/memory/database.ts`

**Scope:** ~6–8 tasks.

---

### OB-F84 — Master context window has no auto-compaction (High)

**Inspired by:** [openclaw/openclaw](https://github.com/openclaw/openclaw) — implements session compaction that auto-summarizes conversation history when context window fills, with identifier preservation and retry logic.

**Problem:** The Master AI runs long-lived sessions via `--session-id`. As conversations grow, the context window fills up. Currently, `memory.md` (200 lines, manually curated) is the only continuity mechanism. There's no automatic compaction of the Master's session history — old turns are simply dropped by the model when the window fills.

**Impact:** Long Master sessions lose important context silently. Critical decisions from early in the session are forgotten. The Master may contradict earlier analysis or redo work.

**Proposed solution:**

1. Add `SessionCompactor` in `src/master/session-compactor.ts`
2. Monitor Master session turn count — trigger compaction when approaching limit (e.g., >80% of `--max-turns`)
3. Compaction strategy: summarize old turns into structured summary (identifiers preserved, key decisions kept)
4. Write compaction summary to `memory.md` before starting new session segment
5. Retry on compaction failure — don't lose the session silently
6. Track which identifiers (file paths, function names, finding IDs) must be preserved across compaction

**Key files:** `src/master/session-compactor.ts` (new), `src/master/master-manager.ts`, `src/master/dotfolder-manager.ts`

**Scope:** ~10–12 tasks.

---

### OB-F85 — No self-diagnostic command (`openbridge doctor`) (Medium)

**Inspired by:** [openclaw/openclaw](https://github.com/openclaw/openclaw) — has `openclaw doctor` command that validates DM policies, runs migration checks, and flags misconfigurations.

**Problem:** When OpenBridge has issues (AI tool not found, SQLite corrupt, config invalid, channel not connecting), users have no diagnostic tool. They must read logs manually or ask for help.

**Impact:** Poor DX and user experience. Common issues (missing `claude` binary, wrong Node version, corrupt `openbridge.db`, stale `.openbridge/`) take too long to diagnose.

**Proposed solution:**

1. Add `openbridge doctor` CLI command in `src/cli/doctor.ts`
2. Checks to run:
   - Node.js version >= 22 ✓/✗
   - AI tools detected (claude, codex, aider) ✓/✗ with versions
   - Config file valid (Zod parse) ✓/✗ with specific errors
   - SQLite database healthy (integrity check, schema version, table counts) ✓/✗
   - `.openbridge/` state (stale data, missing files, corrupted entries) ✓/✗
   - Channel connectivity (WhatsApp session, Telegram bot token, Discord bot token) ✓/✗
   - MCP servers reachable ✓/✗
   - Disk space for logs/DB ✓/✗
3. Output: color-coded summary with fix suggestions for each failing check
4. Add `/doctor` chat command that runs the same checks and sends results via the channel

**Key files:** `src/cli/doctor.ts` (new), `src/cli/index.ts`, `src/core/router.ts`

**Scope:** ~8–10 tasks.

---

### OB-F86 — No pairing-based auth for non-phone channels (Medium)

**Inspired by:** [openclaw/openclaw](https://github.com/openclaw/openclaw) — uses DM pairing codes for unknown senders. Unknown user gets a short code, owner approves via CLI, sender is added to local allowlist.

**Problem:** OpenBridge uses phone number whitelisting for auth. This works for WhatsApp but is awkward for Discord (usernames, not phone numbers), Telegram (optional phone), and WebChat (no phone at all). Adding a new user requires editing `config.json` and restarting.

**Impact:** Onboarding new users is manual and requires config file editing. No self-service approval flow for Discord/Telegram users.

**Proposed solution:**

1. When unknown sender messages OpenBridge, generate a 6-digit pairing code
2. Send pairing code back to the unknown sender: "To connect, ask the admin to approve code: 482917"
3. Owner approves via CLI: `openbridge pairing approve 482917` or via chat command: `/approve 482917`
4. Approved sender is added to `access-store.ts` with appropriate role
5. Pairing codes expire after 5 minutes
6. Works alongside existing phone whitelist (not a replacement)

**Key files:** `src/core/auth.ts`, `src/memory/access-store.ts`, `src/cli/access.ts`, `src/core/router.ts`

**Scope:** ~8–10 tasks.

---

### OB-F87 — No skills directory for reusable capabilities (Medium)

**Inspired by:** [openclaw/openclaw](https://github.com/openclaw/openclaw) — has 60+ bundled skills in `skills/` directory with `SKILL.md` files. Master discovers and uses skills autonomously. ClawHub registry for community sharing.

**Problem:** OpenBridge discovers AI tools on the machine (Claude, Codex, etc.) but has no concept of reusable "skills" — structured capability descriptions that the Master can discover, learn, and apply. Every session starts from scratch, relying on exploration and system prompts.

**Impact:** The Master rediscovers how to do common tasks each session. No way for users to share custom capabilities or for the Master to learn and package successful patterns.

**Proposed solution:**

1. Add `.openbridge/skills/` directory with `SKILL.md` pattern
2. Each skill is a directory with `SKILL.md` (description, tools needed, example prompts, constraints)
3. Master reads available skills on startup and includes them in its system prompt
4. Master can create new skills from successful task patterns (extends existing prompt evolution)
5. Built-in skills: `code-review`, `test-runner`, `dependency-audit`, `api-docs-generator`
6. Future: community skill registry (like OpenClaw's ClawHub)

**Key files:** `src/master/skill-manager.ts` (new), `src/master/master-system-prompt.ts`, `src/master/dotfolder-manager.ts`

**Scope:** ~10–12 tasks.

---

### OB-F88 — Worker results lack structured summary format (Medium)

**Inspired by:** [thedotmack/claude-mem](https://github.com/thedotmack/claude-mem) — session summaries are structured as: `request`, `investigated`, `learned`, `completed`, `next_steps`, `notes`.

**Problem:** Worker results are formatted as free-text by `worker-result-formatter.ts`. The Master receives unstructured text and must parse it manually. There's no standard format for what was completed, what was learned, or what remains unfinished.

**Impact:** Master can't reliably track incomplete work across workers. No `next_steps` field means the Master doesn't know what a worker left undone. Cross-session continuity depends entirely on manual `memory.md` curation.

**Proposed solution:**

1. Define `WorkerSummary` schema in `src/types/agent.ts`: `{ request, investigated, completed, learned, next_steps, files_modified, files_read }`
2. Update `worker-result-formatter.ts` to extract structured summaries from worker output
3. Store summaries in `agent_activity` table (extend existing schema)
4. Master reads summaries for context injection — particularly `next_steps` for incomplete work
5. `memory.md` auto-updates with `learned` items from worker summaries

**Key files:** `src/master/worker-result-formatter.ts`, `src/types/agent.ts`, `src/memory/activity-store.ts`, `src/master/dotfolder-manager.ts`

**Scope:** ~8–10 tasks.

---
