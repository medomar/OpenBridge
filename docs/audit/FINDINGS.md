# OpenBridge — Audit Findings

> **Purpose:** Real issues, gaps, and risks discovered during code audits and real-world testing.
> **This is NOT a task list.** Tasks live in [TASKS.md](TASKS.md). Findings document _what's wrong_ and _why it matters_.
> **Open:** 31 | **Fixed:** 61 | **Last Audit:** 2026-03-02
> **Current focus:** Making OpenBridge effective for finishing the Marketplace projects (frontend, dashboard, backend).
> **Resolved findings:** [V0 archive](archive/v0/FINDINGS-v0.md) | [V2 archive](archive/v2/FINDINGS-v2.md) | [V4 archive](archive/v4/FINDINGS-v4.md) | [V5 archive](archive/v5/FINDINGS-v5.md) | [V6 archive](archive/v6/FINDINGS-v6.md) | [V7 archive](archive/v7/FINDINGS-v7.md) | [V8 archive](archive/v8/FINDINGS-v8.md) | [V15 archive](archive/v15/FINDINGS-v15.md) | [V16 archive](archive/v16/FINDINGS-v16.md) | [V17 archive](archive/v17/FINDINGS-v17.md) | [V18 archive](archive/v18/FINDINGS-v18.md) | [V19 archive](archive/v19/FINDINGS-v19.md)

---

## Priority Order

Ordered by impact on the **Marketplace development workflow** — the immediate goal is using OpenBridge to finish the Marketplace frontend, dashboard, and backend services.

### Tier 1 — Must-Fix for Marketplace Development

| #      | Finding                                                  | Severity    | Marketplace Impact                                                                     | Status   |
| ------ | -------------------------------------------------------- | ----------- | -------------------------------------------------------------------------------------- | -------- |
| OB-F57 | Workers cannot run tests or do deep code analysis        | 🟠 High     | Can't verify Marketplace code — no test/lint/typecheck in workers                      | Open     |
| OB-F58 | `explore()` failure is unrecoverable                     | 🟠 High     | Exploration failure on any Marketplace project = Master stuck, must restart            | Open     |
| OB-F59 | `parseAIResult()` has no runtime Zod validation          | 🟠 High     | Corrupt exploration data = Master misunderstands Marketplace codebase                  | Open     |
| OB-F67 | Secondary workspace .openbridge is corrupted             | 🔴 Critical | Must clean before targeting Marketplace workspace paths                                | Open     |
| OB-F66 | .openbridge data stale from early development            | 🟡 Medium   | Stale memory.md + workspace map misleads Master about project state                    | Open     |
| OB-F70 | Environment variables leak sensitive secrets to workers  | 🔴 Critical | Marketplace backend has DB_URL, API keys, SMTP creds — all exposed to workers          | Open     |
| OB-F76 | Keyword classifier misses execution/delegation keywords  | 🟠 High     | "start execution" classified as tool-use (15 turns) instead of complex-task (25 turns) | Open     |
| OB-F77 | SPAWN marker stripping leaves empty/stub response        | 🟠 High     | Master output with SPAWN markers stripped to 29 chars — user gets no useful response   | ✅ Fixed |
| OB-F78 | No warning when response truncated after SPAWN stripping | 🟡 Medium   | Log shows `responseLength: 29` but no flag that original was 500+ chars pre-strip      | ✅ Fixed |

### Tier 2 — Important for Development Workflow (Sprints 1–3)

| #      | Finding                                                     | Severity  | Development Impact                                                      | Status |
| ------ | ----------------------------------------------------------- | --------- | ----------------------------------------------------------------------- | ------ |
| OB-F68 | Master AI doesn't know how to share generated files         | 🟠 High   | Can't receive test reports, code analysis results, or generated outputs | Open   |
| OB-F71 | No user consent before risky/expensive worker operations    | 🟠 High   | Marketplace is production code — need confirmation before file edits    | Open   |
| OB-F60 | Phase 3 directory dive retry logic is broken                | 🟠 High   | Marketplace has many directories — failed dives = knowledge gaps        | Open   |
| OB-F62 | `reExplore()` doesn't write analysis marker or update cache | 🟡 Medium | Re-exploration loops waste time when switching between projects         | Open   |
| OB-F63 | Prompt rollback stores new content as previousVersion       | 🟡 Medium | Bad prompts for Marketplace tasks can't be reverted                     | Open   |
| OB-F61 | Progress calculation gives negative percentages             | 🟡 Medium | Confusing progress display during Marketplace exploration               | Open   |

### Tier 2b — Platform Completion (Sprint 4 — v0.0.12)

| #      | Finding                                   | Severity    | Sprint 4 Impact                                                           | Status |
| ------ | ----------------------------------------- | ----------- | ------------------------------------------------------------------------- | ------ |
| OB-F56 | No multi-phase "deep mode"                | 🟡 Medium   | Enables thorough analysis: investigate → report → plan → execute → verify | Open   |
| OB-F69 | No delivery path for interactive web apps | 🟠 High     | Tunnel + ephemeral app serving makes outputs accessible from anywhere     | Open   |
| OB-F72 | No document visibility controls           | 🟡 Medium   | Completes security boundary — controls what AI can see in workspace       | Open   |
| OB-F73 | WebChat has no authentication             | 🔴 Critical | Required for exposing WebChat beyond localhost (LAN, tunnel, PWA)         | Open   |
| OB-F74 | WebChat UI is inlined HTML string         | 🟠 High     | Blocks all WebChat improvements — must extract before modernization       | Open   |
| OB-F75 | WebChat not accessible from phone         | 🟠 High     | Phone access via LAN/tunnel + PWA makes WebChat a primary interface       | Open   |

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

### Tier 3 — Deferred (not blocking current work)

| #      | Finding                                           | Severity | Notes                                                  | Status |
| ------ | ------------------------------------------------- | -------- | ------------------------------------------------------ | ------ |
| OB-F64 | `filesScanned` always 0 in exploration summary    | 🟢 Low   | Cosmetic — doesn't affect functionality                | Open   |
| OB-F65 | Exploration prompts have no media/asset awareness | 🟢 Low   | Marketplace projects are code-focused, not media-heavy | Open   |

### Recently Fixed

| #      | Finding                                                  | Severity  | Impact                                                                                  | Status    |
| ------ | -------------------------------------------------------- | --------- | --------------------------------------------------------------------------------------- | --------- |
| OB-F54 | Complex tasks use same 180s timeout as quick answers     | 🟠 High   | Complex tasks (25 turns) get 7.2s/turn, timeout every time, retry 4x → DLQ              | **Fixed** |
| OB-F55 | Classification escalation over-triggers quick-answer     | 🟡 Medium | Global success rate escalates every quick-answer to tool-use, wasting budget            | **Fixed** |
| OB-F77 | SPAWN marker stripping leaves empty/stub response        | 🟠 High   | Status message now generated when cleanedOutput < 80 and SPAWN markers found            | **Fixed** |
| OB-F78 | No warning when response truncated after SPAWN stripping | 🟡 Medium | debug + warn logs added after SPAWN stripping in both streaming and non-streaming paths | **Fixed** |

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

### OB-F57 — Workers cannot run tests or do deep code analysis (High)

**Problem:** OpenBridge has 4 built-in tool profiles: `read-only` (Read/Glob/Grep), `code-edit` (+ Write/Edit/Bash(git/npm)), `full-access` (Bash(\*)), and `master` (Read/Write/Edit without Bash). None is designed for "analyze code deeply and run tests without modifying anything."

When a user asks "deep check this codebase" via WebChat, the Master spawns `read-only` workers that can only list files and read content — they cannot run `npm test`, `npm run typecheck`, or `npm run lint`. The result is surface-level file inspection instead of deep code-level analysis (logic bugs, schema issues, test results).

Compared to direct Claude Code usage (which found 15 issues including broken retry logic, negative progress calculations, and missing Zod validation), WebChat workers missed all code-level bugs and only reported what files exist.

**Impact:** WebChat users get shallow analysis. Workers can't verify code correctness, find logic bugs, or report test/lint/typecheck failures. The gap between "mechanic" (deep code analysis) and "test driver" (surface inspection) persists.

**Proposed solution:**

1. Add `code-audit` built-in profile to `src/types/agent.ts`:
   - Tools: `Read`, `Glob`, `Grep`, `Bash(npm:test)`, `Bash(npm:run:lint)`, `Bash(npm:run:typecheck)`, `Bash(npx:vitest:*)`, `Bash(npx:eslint:*)`, `Bash(npx:tsc:*)`
   - No Edit/Write — audit is read-only + test runners
   - No Bash(\*) — bounded, safe access to verification tools only

2. Add `TASK_CODE_AUDIT` seed prompt in `src/master/seed-prompts.ts`:
   - Instructs workers to trace logic paths, check error handling, verify Zod schemas, run test suite
   - Output format: structured findings table with file:line references

3. Update Master system prompt in `src/master/master-system-prompt.ts`:
   - Add "Deep Analysis Tasks" section
   - Guideline: use `code-audit` + balanced/powerful model for audit tasks
   - Example SPAWN marker for code-audit workers

4. Add `TOOLS_CODE_AUDIT` constant in `src/core/agent-runner.ts`

**Key files:** `src/types/agent.ts`, `src/core/agent-runner.ts`, `src/master/master-system-prompt.ts`, `src/master/seed-prompts.ts`

**See also:** OB-F56 (deep mode), [FUTURE.md — Code Audit Profile](FUTURE.md)

---

### OB-F58 — `explore()` failure is unrecoverable (High)

**Problem:** When `explore()` fails in `master-manager.ts` (line 2954), it sets `this.state = 'error'` and throws. There is no recovery mechanism — the MasterManager stays in `'error'` state permanently. All subsequent `processMessage()` calls reject with "The AI is currently error. Please try again in a moment." The only fix is restarting the process.

**Impact:** A single exploration failure (network timeout, AI rate limit, corrupt workspace) permanently disables the Master AI until process restart. No auto-recovery, no retry, no fallback.

**Proposed solution:** Add a `recover()` method that resets state to `'idle'` and retries exploration, or allow `processMessage()` to trigger re-exploration when state is `'error'`.

**Key file:** `src/master/master-manager.ts` (lines 2876-2960)

---

### OB-F59 — `parseAIResult()` has no runtime Zod validation (High)

**Problem:** `parseAIResult<T>()` in `result-parser.ts` (lines 39, 53, 102) extracts JSON from AI output and casts it with `as T` — a compile-time-only assertion with zero runtime validation. The parsed data is written to SQLite via `upsertStructureScan()`, `upsertClassification()`, etc. before any Zod validation occurs. Validation only happens on the next _read_ from the DB.

This means malformed AI output (missing fields, wrong types) gets persisted silently. The error surfaces later as a confusing "corrupt DB entry" on next startup.

**Impact:** Data integrity risk. AI hallucinations or format changes silently corrupt the exploration state in the database.

**Proposed solution:** Add optional `schema?: ZodSchema<T>` parameter to `parseAIResult()`. When provided, validate with `.parse()` before returning. Update callers in `exploration-coordinator.ts` to pass the appropriate Zod schema (`StructureScanSchema`, `ClassificationSchema`, `DirectoryDiveResultSchema`).

**Key files:** `src/master/result-parser.ts` (lines 36-130), `src/master/exploration-coordinator.ts` (lines 738, 801, 1036)

---

### OB-F60 — Phase 3 directory dive retry logic is broken (High)

**Problem:** In `exploration-coordinator.ts` (line ~904), `pendingDives` is computed once before the batch loop begins. When a directory dive fails, the code sets `attempts++` and `status = 'pending'` (lines 932-958). However, since `pendingDives` was already computed, the retried dive won't be included in subsequent batches. Retries are effectively broken — a dive that fails once will never be retried.

**Impact:** Failed directory dives produce empty results. In large projects with many directories, some directories may silently have no exploration data.

**Proposed solution:** Move `pendingDives` computation inside the batch loop so failed-then-pending dives are picked up in the next iteration.

**Key file:** `src/master/exploration-coordinator.ts` (lines 904, 932-958)

---

### OB-F61 — Progress calculation gives negative percentages (Medium)

**Problem:** In `exploration-coordinator.ts` (line ~1450), the progress formula for in-progress directory dives is:

```
completedWeight += phaseWeights.directory_dives * diveProgressPercent - phaseWeights.directory_dives
```

When `diveProgressPercent = 0` (no dives completed yet), this adds `-50` to `completedWeight`. With structure_scan (15) and classification (15) already complete, total progress becomes `15 + 15 + (50 × 0 - 50) = -20%`.

**Impact:** Progress reporting shows negative percentages during Phase 3, confusing users and any UI that displays exploration progress.

**Proposed solution:** Fix formula to `completedWeight += phaseWeights.directory_dives * diveProgressPercent` (remove the subtraction).

**Key file:** `src/master/exploration-coordinator.ts` (line ~1450)

---

### OB-F62 — `reExplore()` doesn't write analysis marker or update cache (Medium)

**Problem:** After `reExplore()` completes (lines 3596-3679 in `master-manager.ts`), it calls `loadExplorationSummary()` but does NOT:

1. Call `writeAnalysisMarkerToStore()` — so next startup sees the old commit hash and detects the same changes again, triggering unnecessary re-exploration
2. Update `this.workspaceMapSummary` — so `buildMasterSpawnOptions()` injects stale workspace context into subsequent Master calls

Compare with `incrementalExplore()` (line 3151) and `masterDrivenExplore()` (line 3341-3342), which both correctly do both.

**Impact:** Redundant re-exploration on every restart after `reExplore()`. Stale workspace context in Master sessions until process restart.

**Key file:** `src/master/master-manager.ts` (lines 3596-3679)

---

### OB-F63 — Prompt rollback stores new content as previousVersion (Medium)

**Problem:** In `dotfolder-manager.ts` (line 787), `writePromptTemplate()` sets `previousVersion: content` where `content` is the _new_ content being written. It should read the old file content before overwriting and store that as `previousVersion`. As written, the "previous version" is identical to the current version, making rollback impossible.

**Impact:** Prompt evolution rollback feature is non-functional. If a prompt is updated and performs worse, the Master cannot revert to the actual previous version.

**Key file:** `src/master/dotfolder-manager.ts` (line 787)

---

### OB-F64 — `filesScanned` always 0 in exploration summary (Low)

**Problem:** In `exploration-coordinator.ts` (line 1326), `filesScanned` is hardcoded to `0`. The `totalFiles` value from the structure scan is available but never propagated to the summary.

**Impact:** Status reporting shows "0 files scanned" regardless of actual exploration scope. Minor UX issue.

**Key file:** `src/master/exploration-coordinator.ts` (line 1326)

---

### OB-F65 — Exploration prompts have no media/asset awareness (Low)

**Problem:** The 4 exploration prompts in `exploration-prompts.ts` are code-and-config biased. They never mention images, fonts, media files, data files (`.json`, `.csv`, `.sql`), or binary assets. The classification heuristics (lines 127-136) only define "code workspace indicators" and "business workspace indicators" — there's no category for asset-heavy projects (game dev, design portfolios, media libraries).

The directory dive prompt (line 262) says "Focus on files that matter (skip boilerplate)" which may cause the AI to skip asset directories entirely.

**Impact:** Workspace maps may under-report media, image, font, and data file directories. Projects with significant non-code assets get incomplete exploration.

**Key file:** `src/master/exploration-prompts.ts` (lines 28-350)

---

### OB-F66 — .openbridge data stale from early development (Medium)

**Problem:** The primary workspace `.openbridge/` contains stale data from early development phases:

1. `context/memory.md` says "v0.0.6 / Phase 67 / 507 tasks" — actual is v0.0.8 / Phase 73 / 652 tasks
2. Analysis marker points to branch `fix/memory-validation` and commit `b8e48b4` — current branch is `feature/master-ai-platform` at `879fa9f`
3. `workspace-map.json` shows `fileCount: 1` for `src/` (actual: 100+) and `tests/` (actual: 104+)
4. `desktop/` directory is completely absent from the workspace map
5. `exploration/` JSON fallback folder missing (expected — OB-813 moved to DB, but no fallback exists if DB corrupts)
6. `agents.json` missing (legacy file, data now in DB)

**Impact:** Master AI operates with outdated project understanding. memory.md gives wrong version/task count. Workspace map has wrong file counts. `desktop/` is invisible.

**Proposed solution:** Run cleanup script to delete stale data, then trigger fresh full exploration on next startup.

**Key files:** `.openbridge/context/memory.md`, `.openbridge/workspace-map.json`, `.openbridge/analysis-marker.json`

---

### OB-F67 — Secondary workspace .openbridge is corrupted (Critical)

**Problem:** `/Users/sayadimohamedomar/Desktop/Social-Media-Automation-Platform/.openbridge/` was created during early OpenBridge development and has critical corruption:

1. `workspace-map.json` has `"workspacePath": "/Users/sayadimohamedomar/Desktop/AI-Bridge/OpenBridge"` — points to the **wrong project** entirely
2. `openbridge.db` is **missing** — no SQLite database, no persistent memory
3. `context/memory.md` is **missing** — no cross-session continuity
4. `master-session.json` has `maxTurns: 50` (should be 3-5 for messages)
5. `analysis-marker.json` is 7+ days stale (2026-02-23)
6. 32 legacy task JSON files from early testing

**Impact:** If OpenBridge targets the Social Media workspace, it would use workspace metadata from the wrong project, misunderstand the codebase, and have no persistent memory.

**Proposed solution:** Delete the entire `.openbridge/` folder in the secondary workspace. It will be cleanly regenerated with correct data when OpenBridge next targets that workspace.

**Key path:** `/Users/sayadimohamedomar/Desktop/Social-Media-Automation-Platform/.openbridge/`

---

### OB-F68 — Master AI doesn't know how to share generated files (High)

**Problem:** The Router already parses `[SHARE:channel]/path/to/file[/SHARE]` markers and sends media attachments via connectors. The file server on port 3001 already serves `.openbridge/generated/` with UUID-based shareable links. But the Master AI **has no idea any of this exists** — its system prompt (`master-system-prompt.ts`) never teaches it the `[SHARE:*]` marker syntax, the available channels, or that files should be written to `.openbridge/generated/`.

**Discovered during testing:** Master generated an HTML report but couldn't send it to the user's phone. The infrastructure was ready but the AI didn't know how to use it.

**Impact:** Users ask for reports, dashboards, files — Master generates them but they sit on disk. User never receives them. The entire file-sharing pipeline (file-server, GitHub Pages, email sender, connector media) goes unused.

**Proposed solution:**

1. Add `[SHARE:*]` marker documentation to Master system prompt (`master-system-prompt.ts`):

   ```
   When you have generated files the user needs, share them:
   - [SHARE:whatsapp]/path/to/file[/SHARE]  — Send as attachment
   - [SHARE:telegram]/path/to/file[/SHARE]  — Send as attachment
   - [SHARE:discord]/path/to/file[/SHARE]   — Send as attachment
   - [SHARE:email]recipient@example.com|/path/to/file[/SHARE] — Email
   - [SHARE:github-pages]/path/to/file[/SHARE] — Publish to GitHub Pages URL
   Files MUST be written to .openbridge/generated/ directory.
   Use the same channel the user messaged you from by default.
   ```

2. Inject active connector names into system prompt so Master knows which channels are available.

3. Add output routing guidelines:
   - Static files (PDF, CSV, images) → `[SHARE:channel]` attachment
   - HTML reports → `[SHARE:github-pages]` for persistent URL, or connector attachment
   - Large outputs → file server link via `[SHARE:channel]`

**Key files:** `src/master/master-system-prompt.ts`, `src/core/router.ts` (lines 596–684), `src/core/file-server.ts`

**Scope:** Small fix — ~3–5 tasks. Immediate impact.

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

### OB-F70 — Environment variables leak sensitive secrets to workers (Critical)

**Problem:** When `AgentRunner.spawn()` creates a worker process, it inherits the parent environment and only strips `CLAUDECODE*` and `CLAUDE_AGENT_SDK_*` variables (see `cleanEnv()` in `src/core/adapters/claude-adapter.ts`, lines 92–101). All other environment variables are passed through, including:

- `AWS_SECRET_ACCESS_KEY`, `AWS_ACCESS_KEY_ID` — cloud credentials
- `GITHUB_TOKEN`, `GH_TOKEN` — GitHub API access
- `DATABASE_URL`, `DB_PASSWORD` — database credentials
- `OPENAI_API_KEY` — API keys
- `SMTP_PASSWORD` — email credentials
- Any other secrets set in the user's shell profile

A worker with `Bash(*)` access can trivially run `env | grep TOKEN` or `printenv` and exfiltrate all secrets. Even `code-edit` workers with `Bash(npm:*)` could potentially access env vars through `npm run` scripts.

**Impact:** Security vulnerability. Secrets from the user's environment are exposed to AI agents. A prompt injection attack or rogue worker could exfiltrate credentials.

**Proposed solution:**

1. **Configurable env var deny-list** — `config.json` gets a new field:

   ```json
   {
     "security": {
       "envDenyPatterns": [
         "AWS_*",
         "GITHUB_*",
         "GH_*",
         "TOKEN_*",
         "SECRET_*",
         "PASSWORD_*",
         "PRIVATE_*",
         "DB_*",
         "DATABASE_*",
         "SMTP_*",
         "OPENAI_*",
         "ANTHROPIC_*",
         "API_KEY*"
       ]
     }
   }
   ```

2. **Default deny-list** — ship sensible defaults that strip common secret patterns out-of-the-box

3. **Allowlist mode** (opt-in) — instead of denying bad vars, explicitly list the only vars workers receive:

   ```json
   {
     "security": {
       "envAllowPatterns": ["PATH", "HOME", "USER", "LANG", "NODE_*", "npm_*"]
     }
   }
   ```

4. **Apply in all adapters** — update `cleanEnv()` in Claude, Codex, and Aider adapters

5. **Startup warning** — on bridge start, scan env for known secret patterns and log a warning if found and not denied

**Key files:** `src/core/adapters/claude-adapter.ts` (lines 92–101), `src/core/adapters/codex-adapter.ts`, `src/core/adapters/aider-adapter.ts`, `src/core/agent-runner.ts`, `src/types/config.ts`

**Scope:** ~8–10 tasks. Critical security fix.

---

### OB-F71 — No user consent before risky/expensive worker operations (High)

**Problem:** When the Master AI decides to spawn a worker, it does so immediately with no user confirmation. The user has no visibility into:

- What tool profile the worker gets (read-only vs full-access)
- What the worker will do (edit files? run commands? access MCP servers?)
- Estimated cost/time of the operation
- What files will be modified

This is especially risky for `full-access` workers which can execute arbitrary commands, and for operations that modify code or deploy artifacts.

**Impact:** Non-technical users have no understanding of what OpenBridge is doing on their behalf. A user asking "check my code" might trigger a `full-access` worker that modifies files. No way to prevent unintended changes.

**Proposed solution:**

1. **Risk classification per worker spawn:**
   - `low`: read-only profile → auto-proceed
   - `medium`: code-edit profile → notify user, proceed after brief pause
   - `high`: full-access profile → require explicit confirmation
   - `critical`: deploy/publish actions → require explicit "yes" from user

2. **Confirmation flow in Router:**
   - Router intercepts SPAWN markers before executing
   - For high/critical risk: sends user a message "I'm about to [action] using [profile] tools. This will [impact]. Reply 'go' to proceed or 'skip' to cancel."
   - Timeout: if no response in 60s, cancel (fail-safe)
   - Add `/confirm` and `/skip` commands to router

3. **Cost estimation:**
   - Before spawning, estimate turns × model cost
   - Show user: "Estimated: ~15 turns, ~$0.50, ~2 minutes"
   - Track actual vs estimated for learning

4. **Execution summary after completion:**
   - After worker completes, tell user what was done:
   - "Worker completed: read 12 files, edited 3 files (src/index.ts, src/router.ts, src/config.ts), ran npm test (passed)"

**Key files:** `src/core/router.ts`, `src/master/master-manager.ts`, `src/master/spawn-parser.ts`, `src/types/agent.ts`

**Scope:** ~12–15 tasks across 1–2 phases.

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

### OB-F76 — Keyword classifier misses execution/delegation keywords (High)

**Problem:** The keyword fallback classifier in `classifyTaskByKeywords()` does not recognize words like "start", "execute", "proceed", "begin", "launch", "run" as complex-task triggers. These words clearly imply multi-worker delegation (spawning multiple workers), not single-file tool-use.

**Discovered during testing:** User sent "Can you start the execution of group A" via Telegram. The classifier returned `taskClass: "tool-use"` with `taskMaxTurns: 15` and `reason: "keyword fallback: tool-use"`. The message should have been classified as `complex-task` (25 turns) because it requires spawning multiple workers to execute a task group.

**Impact:** Tasks that require worker delegation get only 15 turns instead of 25. The Master doesn't receive the planning prompt that triggers proper delegation behavior. Result: the Master tries to do everything in a single pass, produces SPAWN markers that get stripped (see OB-F77), and the user gets an empty response.

**Proposed solution:**

1. Add execution/delegation keywords to the complex-task keyword list in `classifyTaskByKeywords()`:
   - `"execute"`, `"start"`, `"proceed"`, `"begin"`, `"launch"`, `"run tasks"`, `"start execution"`, `"execute group"`, `"start group"`
2. Add pattern matching for "start the [noun]" / "execute [noun]" as complex-task triggers
3. Add tests for these new keyword patterns

**Key file:** `src/master/master-manager.ts` — `classifyTaskByKeywords()` (around line 2437–2545)

**Scope:** ~3 tasks. Quick fix.

---

### OB-F77 — SPAWN marker stripping leaves empty/stub response (High)

**Problem:** When the Master generates output containing `[SPAWN:...]...[/SPAWN]` markers, `parseSpawnMarkers()` strips the markers from the response. If the Master wrote only a brief intro before the markers (e.g., "I'll start the execution."), the `cleanedOutput` is just that stub — sometimes as short as 29 characters. This stub is what gets sent to the user.

**Discovered during testing:** User asked "Can you start the execution of group A". Master spent 184 seconds generating a response with SPAWN markers. After stripping, only 29 characters remained. The user received a near-empty message after waiting 3 minutes.

**Impact:** Users wait minutes for a response and receive a meaningless stub. The actual work (SPAWN markers) was stripped without replacement. No indication of what's happening or what workers were dispatched.

**Proposed solution:**

1. After SPAWN stripping, check if `cleanedOutput.length < 80`
2. If so, generate a status message: "Working on your request — dispatching {N} worker(s) for: {task summaries}..."
3. Extract task descriptions from the parsed SPAWN markers to build the status message
4. Alternatively: if workers were spawned, wait for results and synthesize them before responding (current synthesis path may be failing — investigate why)

**Key files:**

- `src/master/master-manager.ts` — `processMessage()` around line 3997 (SPAWN stripping logic)
- `src/master/spawn-parser.ts` — `parseSpawnMarkers()` (lines 106–179)

**Scope:** ~4 tasks.

---

### OB-F78 — No warning when response truncated after SPAWN stripping (Medium)

**Problem:** When SPAWN markers are stripped from the Master's response, the log shows `responseLength: 29` but doesn't indicate that the original response was much longer before stripping. There's no log entry comparing pre-strip vs post-strip length, making it hard to diagnose empty-response issues.

**Impact:** Debugging difficulty. When users report empty responses, the only clue is `responseLength: 29` in logs — no way to tell if the Master generated a useful response that was then stripped, or if the Master itself produced nothing.

**Proposed solution:**

1. Log original response length before SPAWN stripping
2. Log cleaned response length after stripping
3. If cleaned length < 80 and original length > 200, log a warning: "Response truncated after SPAWN marker removal (original: {N} chars, cleaned: {M} chars)"
4. Include the number of SPAWN markers found in the log entry

**Key file:** `src/master/master-manager.ts` — `processMessage()` around line 3997

**Scope:** ~2 tasks. Quick observability fix.

---

## Recently Fixed

### OB-F54 — Complex tasks use same 180s timeout as quick answers (Fixed)

**Root cause:** `buildMasterSpawnOptions()` was called with `undefined` timeout at all 4 spawn sites in `processMessage` and `processMessageStream`, falling back to `DEFAULT_MESSAGE_TIMEOUT = 180_000` regardless of task class. Complex tasks with 25 turns got 7.2s/turn — too tight for planning.

**Fix:** Derived timeout from turns: `timeout = maxTurns × PER_TURN_BUDGET_MS (30s)`. Added `timeout` field to `ClassificationResult` interface. Quick-answer gets 150s, tool-use gets 450s, complex-task gets 750s. Bumped `CLASSIFIER_VERSION` to 3 to invalidate stale cache entries.

**Files changed:** `src/master/master-manager.ts`, `src/types/master.ts`, `tests/master/master-manager.test.ts`

### OB-F55 — Classification escalation over-triggers quick-answer → tool-use (Fixed)

**Root cause:** Escalation logic at line 2724 used global aggregate success rate from the learnings table. If tool-use had >50% success rate, every quick-answer was escalated to tool-use (15 turns instead of 5).

**Fix:** Added `currentRank > 0` guard to escalation condition. Quick-answer (rank 0) is never escalated. Tool-use (rank 1) can still escalate to complex-task (rank 2) when learned data supports it.

**Files changed:** `src/master/master-manager.ts`, `tests/master/master-manager.test.ts`

---

---

Most recent archives:

- **OB-F49, OB-F50, OB-F51, OB-F52, OB-F53** (timeout handling, classification, whitelist) — [archived to v19](archive/v19/FINDINGS-v19.md)
- **OB-F46, OB-F47, OB-F48** (voice transcription, desktop installer, stale context) — [archived to v18](archive/v18/FINDINGS-v18.md)
- **OB-F43, OB-F44, OB-F45** (WhatsApp/Telegram media + MCP dashboard) — [archived to v17](archive/v17/FINDINGS-v17.md)
- **OB-F41, OB-F42** (Telegram/Discord message too long + live context) — [archived to v16](archive/v16/FINDINGS-v16.md)
- **OB-F38, OB-F39, OB-F40** — [archived to v15](archive/v15/FINDINGS-v15.md)

---

## Severity Guide

| Severity    | Meaning                                               |
| ----------- | ----------------------------------------------------- |
| 🔴 Critical | System broken, data loss risk, security vulnerability |
| 🟠 High     | Core functionality missing or significantly impaired  |
| 🟡 Medium   | Friction, technical debt, or non-blocking gaps        |
| 🟢 Low      | Polish, minor improvements, nice-to-have              |
