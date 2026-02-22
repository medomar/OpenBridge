# OpenBridge — Task List

> **Pending:** 0 tasks | **Status:** ALL PHASES COMPLETE ✅
> **Last Updated:** 2026-02-22
> **Completed work:** [V0 archive (Phases 1–5)](archive/v0/TASKS-v0.md) | [V1 archive (Phases 6–10)](archive/v1/TASKS-v1.md) | [V2 archive (Phases 11–14)](archive/v2/TASKS-v2.md) | [MVP archive (Phase 15)](archive/v3/TASKS-v3-mvp.md)

---

## Vision

OpenBridge is a **self-governing autonomous AI bridge**. It connects messaging channels to a **Master AI** that explores your workspace, delegates tasks to worker agents, and continuously improves its own capabilities — all using the AI tools already installed on your machine (zero API keys, zero extra cost).

The Master AI is the brain. It decides:

- **Which model** each worker uses (haiku for mechanical tasks, opus for reasoning)
- **Which tools** each worker gets (read-only for exploration, code-edit for implementation)
- **How to break down** complex user requests into worker subtasks
- **How to improve** its own prompts, scripts, and strategies over time

**Key principles:**

- **Zero config AI** — auto-discovers Claude Code, Codex, Aider, etc. on the machine
- **Master AI is self-governing** — chooses models, tools, and strategies for workers
- **Agent Runner** — unified TypeScript executor inspired by our bash scripts (retries, logging, tool restrictions, model selection)
- **Workers are short-lived** — spawned per-task with bounded turns and restricted tools
- **Master is long-lived** — maintains session continuity, accumulates knowledge
- **`.openbridge/` is the AI's brain** — everything it learns lives in the target project
- **Self-improvement** — Master can refine its own prompts and learn from task outcomes

---

## Roadmap

| Phase | Focus                                  | Tasks  | Status |
| :---: | -------------------------------------- | :----: | :----: |
|  1–5  | V0 foundation + bug fixes              |   40   |   ✅   |
| 6–10  | Discovery, Master, V2, Delegation      |   24   |   ✅   |
|  11   | Incremental exploration                |   8    |   ✅   |
|  12   | Status + interaction                   |   4    |   ✅   |
|  13   | Documentation rewrite                  |   6    |   ✅   |
|  14   | Testing + verification                 |   8    |   ✅   |
|       | **Total completed**                    | **98** |        |
|  16   | Agent Runner — core executor           |   8    |   ✅   |
|  17   | Tool profiles + model selection        |   5    |   ✅   |
|  18   | Master AI rewrite — self-governing     |   7    |   ✅   |
|  19   | Worker orchestration + task manifests  |   6    |   ✅   |
|  20   | Self-improvement + learnings           |   4    |   ✅   |
|  21   | End-to-end hardening + production test |   4    |   ✅   |

> Phase 15 (Telegram, Discord, Web Chat) moved to backlog. The Master AI must work reliably before adding more channels.

---

## Phase 16 — Agent Runner: Core Executor

> **Focus:** Replace `executeClaudeCode()` with a production-grade agent runner inspired by our bash scripts. This is the foundation everything else builds on.
>
> **Why this first:** The current executor uses `--dangerously-skip-permissions` (security risk), has no retry logic (one failure kills exploration), no model selection, no turn limits, and no logging to disk. Our bash scripts already solved all of these problems — this phase ports those patterns into TypeScript.

| #   | Task                                                                                                                                                                                                                                                                                                                                                                                                                                                         | ID     |  Priority   | Status  |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------ | :---------: | :-----: |
| 91  | **AgentRunner class** — create `src/core/agent-runner.ts` with `spawn()` method. Accepts: prompt, workspacePath, model, allowedTools[], maxTurns, timeout, retries, retryDelay, logFile. Internally builds `claude` CLI args and spawns child process. Returns `AgentResult { stdout, stderr, exitCode, durationMs, retryCount }`. Replaces raw `spawn('claude', ...)` calls                                                                                 | OB-130 | 🔴 Critical | ✅ Done |
| 92  | **--allowedTools support** — AgentRunner builds `--allowedTools` flags from the tools array instead of using `--dangerously-skip-permissions`. Define tool group constants: `TOOLS_READ_ONLY = ['Read', 'Glob', 'Grep']`, `TOOLS_CODE_EDIT = ['Read', 'Edit', 'Write', 'Glob', 'Grep', 'Bash(git:*)', 'Bash(npm:*)', 'Bash(npx:*)']`, `TOOLS_FULL = ['Read', 'Edit', 'Write', 'Glob', 'Grep', 'Bash(*)']`. Remove all `--dangerously-skip-permissions` usage | OB-131 | 🔴 Critical | ✅ Done |
| 93  | **--max-turns support** — AgentRunner passes `--max-turns N` to prevent runaway agents. Default: 15 for exploration, 25 for user tasks. Configurable per spawn call                                                                                                                                                                                                                                                                                          | OB-132 |   🟠 High   | ✅ Done |
| 94  | **--model support** — AgentRunner passes `--model <name>` to select the model. Accepts: 'haiku', 'sonnet', 'opus' or full model IDs. Default: inherits from config or uses the discovered tool's default                                                                                                                                                                                                                                                     | OB-133 |   🟠 High   | ✅ Done |
| 95  | **Retry logic with backoff** — AgentRunner retries on non-zero exit codes up to `retries` times (default: 3). Waits `retryDelay` ms between attempts (default: 10000). Logs each attempt. Throws after all retries exhausted with aggregated error. Mirrors bash scripts' `MAX_CONSECUTIVE_FAILURES` + `SLEEP_ON_RETRY` pattern                                                                                                                              | OB-134 |   🟠 High   | ✅ Done |
| 96  | **Disk logging** — AgentRunner writes full stdout/stderr to `logFile` path (default: `.openbridge/logs/<taskId>.log`). Creates log directory if missing. Includes timestamp, model, tools, prompt length in log header. Mirrors bash scripts' `tee "$LOG_FILE"` pattern                                                                                                                                                                                      | OB-135 |   🟡 Med    | ✅ Done |
| 97  | **Streaming support** — Add `AgentRunner.stream()` method that yields chunks as they arrive (same as current `streamClaudeCode` but with all the new features: allowedTools, maxTurns, model, retries). Returns `AsyncGenerator<string, AgentResult>`                                                                                                                                                                                                        | OB-136 |   🟡 Med    | ✅ Done |
| 98  | **Migrate all callers** — Update `exploration-coordinator.ts`, `master-manager.ts` (processMessage, streamMessage, reExplore), and `delegation.ts` to use `AgentRunner.spawn()` / `AgentRunner.stream()` instead of `executeClaudeCode()` / `streamClaudeCode()`. Delete `claude-code-executor.ts` after migration is verified                                                                                                                               | OB-137 |   🟠 High   | ✅ Done |

---

## Phase 17 — Tool Profiles + Model Selection

> **Focus:** Give the Master AI a vocabulary for describing worker capabilities. Tool profiles define what a worker can do. Model selection defines how smart it needs to be.
>
> **Why this second:** Once the AgentRunner exists, the Master needs a way to express "this worker should only read files" or "this worker needs to edit code". Profiles are the interface between Master decisions and AgentRunner execution.

| #   | Task                                                                                                                                                                                                                                                                                                                                                                                                  | ID     | Priority | Status  |
| --- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ | :------: | :-----: |
| 99  | **Tool profile schema** — create `src/types/agent.ts` with Zod schemas: `ToolProfile` (name + tools[]), `TaskManifest` (prompt, workspacePath, model, profile, maxTurns, timeout, retries). Define built-in profiles: `read-only` (Read, Glob, Grep), `code-edit` (Read, Edit, Write, Glob, Grep, Bash(git:\*), Bash(npm:\*), Bash(npx:\*)), `full-access` (all tools). Export as `BUILT_IN_PROFILES` | OB-140 | 🟠 High  | ✅ Done |
| 100 | **Model selection strategy** — create `src/core/model-selector.ts`. Given a task description and profile, recommend a model. Rules: read-only tasks → haiku (fast, cheap), code-edit tasks → sonnet (balanced), complex reasoning → opus (best). Allow override via TaskManifest. Master can call this or ignore it                                                                                   | OB-141 |  🟡 Med  | ✅ Done |
| 101 | **AgentRunner integration** — AgentRunner resolves `profile` field from TaskManifest into `--allowedTools` flags. If both `profile` and explicit `allowedTools` are provided, explicit wins. Add `TaskManifest` as an alternative input to `AgentRunner.spawn()`                                                                                                                                      | OB-142 | 🟠 High  | ✅ Done |
| 102 | **Profile registry in .openbridge/** — Master can create custom profiles beyond built-in ones. Stored in `.openbridge/profiles.json`. AgentRunner reads built-in + custom profiles. Master can add profiles like `test-runner` (Read, Glob, Grep, Bash(npm:test))                                                                                                                                     | OB-143 |  🟡 Med  | ✅ Done |
| 103 | **Model fallback chain** — if preferred model is unavailable or rate-limited (exit code indicating rate limit), fall back to next model. Chain: opus → sonnet → haiku. Log fallback decisions. Mirrors OpenClaw's model-fallback.ts pattern                                                                                                                                                           | OB-144 |  🟢 Low  | ✅ Done |

---

## Phase 18 — Master AI Rewrite: Self-Governing Agent

> **Focus:** Rewrite MasterManager so the Master AI is a long-lived session that makes its own decisions about how to handle tasks. Instead of hardcoded exploration phases, the Master reads its context and decides what to do.
>
> **Why this third:** With AgentRunner + profiles in place, the Master can now express "spawn a worker with read-only profile using haiku" as a concrete action. This phase rewires the Master from a passive executor to an active decision-maker.

| #   | Task                                                                                                                                                                                                                                                                                                                                                                                                                           | ID     |  Priority   | Status  |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------ | :---------: | :-----: |
| 104 | **Master session lifecycle** — Master AI runs as a persistent `claude` session (not `--print`). On startup: `claude --session-id master-{uuid} --allowedTools "Read Glob Grep Write Edit" --max-turns 50`. Master session stays alive across user messages. Session ID persists in `.openbridge/master-session.json` for resume across restarts                                                                                | OB-150 | 🔴 Critical | ✅ Done |
| 105 | **Master system prompt** — create `.openbridge/prompts/master-system.md`. Contains: who the Master is, what tools it can spawn, available profiles, how to delegate tasks, how to respond to users. Seeded on first startup, editable by the Master itself. Injected via `--system-prompt` flag or prepended to first message                                                                                                  | OB-151 | 🔴 Critical | ✅ Done |
| 106 | **Master-driven exploration** — remove hardcoded 5-phase exploration from ExplorationCoordinator. Instead, Master's system prompt instructs it to explore the workspace using worker agents. Master decides how many passes, which directories to dive into, what model to use. Master writes results to `.openbridge/` directly. Keep ExplorationCoordinator as a utility library the Master can reference, not as the driver | OB-152 |   🟠 High   | ✅ Done |
| 107 | **Task decomposition protocol** — define how Master breaks user requests into worker subtasks. Master outputs structured JSON task manifests in its response. OpenBridge parses them, spawns workers via AgentRunner, returns results to Master session. Format: `[SPAWN:profile]{"prompt":"...","model":"haiku","maxTurns":10}[/SPAWN]` — similar to current `[DELEGATE]` markers but richer                                  | OB-153 |   🟠 High   | ✅ Done |
| 108 | **Worker result injection** — when workers complete, their results are fed back into the Master session as a follow-up message: "Worker result (haiku, read-only): {output}". Master synthesizes and responds to user. Mirrors OpenClaw's auto-announcement pattern (no polling)                                                                                                                                               | OB-154 |   🟠 High   | ✅ Done |
| 109 | **Master tool access control** — Master itself gets a `master` profile: Read, Write, Edit, Glob, Grep (for .openbridge/ management) but NOT Bash. Master cannot execute commands directly — it delegates to workers. This keeps the Master safe and forces delegation                                                                                                                                                          | OB-155 |   🟡 Med    | ✅ Done |
| 110 | **Graceful Master restart** — if Master session dies (crash, timeout, context overflow), detect it, save state, create new session with context summary. Load `.openbridge/workspace-map.json` + recent task history into new session. User sees no interruption                                                                                                                                                               | OB-156 |   🟡 Med    | ✅ Done |

---

## Phase 19 — Worker Orchestration + Task Manifests

> **Focus:** Build the infrastructure for Master to spawn, monitor, and collect results from multiple concurrent workers. This is the multi-agent coordination layer.
>
> **Why this fourth:** The Master can now make decisions (Phase 18) and has the AgentRunner to execute them (Phase 16). This phase adds the orchestration — parallel workers, result collection, progress tracking.

| #   | Task                                                                                                                                                                                                                                                                                                       | ID     | Priority | Status  |
| --- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ | :------: | :-----: |
| 111 | **Worker registry** — create `src/master/worker-registry.ts`. Tracks active workers: { id, taskManifest, pid, startedAt, status, result }. Enforces max concurrent workers (default: 5). Persists to `.openbridge/workers.json` for cross-restart visibility. Mirrors OpenClaw's SubagentRunRecord pattern | OB-160 | 🟠 High  | ✅ Done |
| 112 | **Parallel worker spawning** — Master can spawn multiple workers concurrently. AgentRunner returns promises. Worker registry tracks all active. Results collected via Promise.allSettled(). Failed workers logged but don't crash the Master                                                               | OB-161 | 🟠 High  | ✅ Done |
| 113 | **Worker progress streaming** — for long-running workers, stream progress chunks back to Master and optionally to user (via WhatsApp). User sees "Working on it... (3/5 subtasks done)" style updates                                                                                                      | OB-162 |  🟡 Med  | ✅ Done |
| 114 | **Worker timeout + cleanup** — if a worker exceeds its timeout, SIGTERM it gracefully (5s grace), then SIGKILL. Update registry. Log the timeout. Master gets notified of the failure and can retry or skip                                                                                                | OB-163 |  🟡 Med  | ✅ Done |
| 115 | **Depth limiting** — workers cannot spawn other workers. Only the Master can spawn. Enforce via: workers get `--print` mode (single-turn, no session), Master gets `--session-id` (multi-turn). This is OpenClaw's `maxSpawnDepth=1` pattern                                                               | OB-164 |  🟡 Med  | ✅ Done |
| 116 | **Task history + audit trail** — every worker execution is logged to `.openbridge/tasks/` with full manifest, result, duration, model used, tools used, retry count. Master can read this history to learn from past executions                                                                            | OB-165 |  🟢 Low  | ✅ Done |

---

## Phase 20 — Self-Improvement + Learnings

> **Focus:** Give the Master the ability to learn from its own experience and improve over time. The Master can edit its prompts, create new profiles, and track what works.
>
> **Why this fifth:** With everything working (runner, profiles, Master, workers), this phase makes it all get better over time. The Master accumulates knowledge and refines its strategies.

| #   | Task                                                                                                                                                                                                                                                                                                                                           | ID     | Priority | Status  |
| --- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ | :------: | :-----: |
| 117 | **Prompt library in .openbridge/** — seed `.openbridge/prompts/` with initial prompt templates (exploration-scan.md, exploration-classify.md, task-execute.md, task-verify.md). Master can read and edit these. Each prompt has a version + success_rate field tracked in `.openbridge/prompts/manifest.json`                                  | OB-170 |  🟡 Med  | ✅ Done |
| 118 | **Learnings store** — create `.openbridge/learnings.json`. After each task, Master appends: { task_type, model_used, profile_used, success, duration, notes }. On startup, Master reads learnings to inform future decisions (e.g., "haiku failed on refactoring tasks 3 times, use sonnet instead")                                           | OB-171 |  🟡 Med  | ✅ Done |
| 119 | **Prompt effectiveness tracking** — after each worker task, record whether the prompt produced valid output (parseable JSON, correct format). Prompts with <50% success rate get flagged. Master can rewrite flagged prompts on idle                                                                                                           | OB-172 |  🟢 Low  | ✅ Done |
| 120 | **Master self-improvement cycle** — when Master is idle (no pending user messages for >5 min), it reviews its learnings and can: (1) update prompts that have low success rates, (2) create new custom profiles for recurring task patterns, (3) update workspace-map.json if project has changed. This runs as a low-priority background task | OB-173 |  🟢 Low  | ✅ Done |

---

## Phase 21 — End-to-End Hardening + Production Test

> **Focus:** Run the complete system on real workspaces. Fix everything that breaks. Verify the full flow: install → init → WhatsApp QR → send message → Master delegates → worker executes → response arrives on phone.
>
> **Why this last:** Everything else must be built first. This phase is about making it actually work in the real world, not just in tests.

| #   | Task                                                                                                                                                                                                                                                                                      | ID     | Priority | Status  |
| --- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ | :------: | :-----: |
| 121 | **E2E smoke test script** — create `scripts/e2e-smoke.sh` that starts OpenBridge, sends a Console message, verifies Master responds via worker delegation (not direct claude --print). Validates: AgentRunner used, --allowedTools passed, --max-turns passed, worker log written to disk | OB-180 | 🟠 High  | ✅ Done |
| 122 | **Real workspace test** — run OpenBridge against the Social-Media-Automation-Platform workspace (the one that was failing). Master must: explore successfully, respond to "what's in this project?", handle "run the tests", handle multi-turn follow-ups. Document results and fixes     | OB-181 | 🟠 High  | ✅ Done |
| 123 | **WhatsApp full flow test** — complete end-to-end: QR scan → send "/ai what's in my project?" from phone → receive response on phone within 2 minutes. Document the flow, any error handling needed, message chunking for long responses                                                  | OB-182 | 🟠 High  | ✅ Done |
| 124 | **Error resilience test** — deliberately trigger failure scenarios: kill Master mid-task (verify restart), send message during exploration (verify queuing), send very long message (verify truncation), disconnect WhatsApp mid-response (verify no crash)                               | OB-183 |  🟡 Med  | ✅ Done |

---

## Backlog — Future Phases (Not Blocking)

> These tasks are valuable but not required for the self-governing Master to work.

| #   | Task                                                                                             | ID     | Priority |  Status   |
| --- | ------------------------------------------------------------------------------------------------ | ------ | :------: | :-------: |
| —   | Telegram connector — Bot API via grammY, supports DM + group                                     | OB-121 |  🟡 Med  | ◻ Backlog |
| —   | Discord connector — discord.js, supports DM + server channels                                    | OB-122 |  🟢 Low  | ◻ Backlog |
| —   | Web chat connector — browser-based chat widget                                                   | OB-123 |  🟢 Low  | ◻ Backlog |
| —   | Interactive AI views — AI generates reports/dashboards served on local HTTP                      | OB-124 |  🟢 Low  | ◻ Backlog |
| —   | Context compaction — progressive summarization when Master context gets large (OpenClaw pattern) | OB-190 |  🟡 Med  | ◻ Backlog |
| —   | Vector memory — SQLite + embeddings for long-term knowledge retrieval (beyond JSON learnings)    | OB-191 |  🟢 Low  | ◻ Backlog |
| —   | Skill creator — Master can create new reusable skill templates for common task patterns          | OB-192 |  🟢 Low  | ◻ Backlog |
| —   | Docker sandbox — run workers in containers for untrusted workspaces                              | OB-193 |  🟢 Low  | ◻ Backlog |

---

## MVP Milestone — COMPLETE (Phases 1–14)

**Phases 1–14** (90 tasks) delivered the initial MVP:

- V0 foundation: WhatsApp connector, Claude Code provider, bridge core, auth, queue, metrics
- AI tool auto-discovery (zero API keys) — CLI + VS Code scanner
- Master AI with autonomous workspace exploration (incremental 5-pass, never times out)
- `.openbridge/` folder with git tracking and exploration state
- V2 config (3 fields only) with V0 backward compatibility
- Session continuity (multi-turn conversations with 30min TTL)
- Multi-AI delegation (Master assigns tasks to other discovered tools)
- Dead code archived cleanly to `src/_archived/`
- Documentation fully rewritten for autonomous AI vision
- Comprehensive test suite: unit, integration, E2E (code + non-code workspaces)

**Now:** Phases 16–21 evolve the MVP from a passive executor to a **self-governing autonomous AI**.

---

## Status Legend

|     Status     | Meaning                   |
| :------------: | ------------------------- |
|   ◻ Pending    | Not started               |
| 🔄 In Progress | Currently being worked on |
|    ✅ Done     | Completed and verified    |
|   ◻ Backlog    | Planned but not scheduled |
