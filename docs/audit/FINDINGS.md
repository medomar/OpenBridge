# OpenBridge — Audit Findings

> **Purpose:** Real issues, gaps, and risks discovered during code audits and real-world testing.
> **This is NOT a task list.** Tasks live in [TASKS.md](TASKS.md). Findings document _what's wrong_ and _why it matters_.
> **Open:** 1 | **Fixed:** 4 | **Last Audit:** 2026-02-21
> **Resolved findings:** [V0 archive](archive/v0/FINDINGS-v0.md) | [V2 archive](archive/v2/FINDINGS-v2.md)

---

## Open Findings

### OB-F13 — `--dangerously-skip-permissions` used for all Claude CLI calls ✅ Fixed

**Discovered:** 2026-02-21 (real-world testing)
**Component:** `src/providers/claude-code/claude-code-executor.ts`
**Impact:** Security risk — gives Claude unrestricted access to the entire system (arbitrary bash, file deletion, network access). No tool boundaries.

**Details:**
Every call to `executeClaudeCode()` passes `--dangerously-skip-permissions` when `skipPermissions: true`. This is used by exploration, message processing, re-exploration, and delegation. The flag was a development shortcut that bypasses Claude's safety prompts, but it also removes ALL tool restrictions.

**Evidence:**

```typescript
if (opts.skipPermissions) {
  args.push('--dangerously-skip-permissions');
}
```

**Fix:** Replace with `--allowedTools` flag using appropriate tool profiles per task type. Exploration needs read-only. Task execution needs code-edit. The bash scripts in `scripts/run-tasks.sh` already demonstrate the correct pattern.

**Resolves in:** Phase 16, OB-131

---

### OB-F14 — Exploration times out with exit code 143 (SIGTERM) 🟠 High

**Discovered:** 2026-02-21 (real-world testing against Social-Media-Automation-Platform workspace)
**Component:** `src/master/exploration-coordinator.ts`
**Impact:** Master AI exploration never completes. Bridge runs without workspace context. User messages can't be answered with project knowledge.

**Details:**
Exit code 143 = `128 + 15` = SIGTERM. The child process is killed by Node.js `spawn()` timeout. Phase timeout is 5 minutes (`PHASE_TIMEOUT = 300_000`), but Claude with `--print` mode and no `--max-turns` limit can run indefinitely — reading files, exploring directories, making tool calls — until the timeout kills it.

**Evidence:**

```
Error: Structure scan failed with exit code 143:
    at ExplorationCoordinator.executePhase1StructureScan
```

**Root cause:** No `--max-turns` flag to bound agent execution. Combined with `--dangerously-skip-permissions`, Claude can make unlimited tool calls until timeout.

**Fix:** Add `--max-turns 15` to exploration calls. Add retry logic (3 attempts with 10s delay). Consider using `--model haiku` for exploration (faster, sufficient for file listing).

**Resolves in:** Phase 16, OB-132 + OB-134

---

### OB-F15 — No retry logic in executor — single failure kills exploration ✅ Fixed

**Discovered:** 2026-02-21 (real-world testing)
**Component:** `src/providers/claude-code/claude-code-executor.ts`, `src/master/exploration-coordinator.ts`
**Impact:** A single transient failure (rate limit, timeout, network blip) causes the entire exploration to fail. No recovery.

**Details:**
`executeClaudeCode()` has no retry mechanism. If the call fails, it throws immediately. The ExplorationCoordinator catches this and marks exploration as failed. The bash scripts (`scripts/run-tasks.sh`) have `MAX_CONSECUTIVE_FAILURES=3` and `SLEEP_ON_RETRY=10` — the TypeScript code has neither.

**Fix:** Add retry with backoff to the AgentRunner.

**Resolves in:** Phase 16, OB-134

---

### OB-F16 — No model selection — all calls use default model ✅ Fixed

**Discovered:** 2026-02-21 (code review)
**Component:** `src/providers/claude-code/claude-code-executor.ts`
**Impact:** Exploration phases (mechanical file listing) use the same expensive model as user conversations (complex reasoning). Wastes rate limits and slows down exploration.

**Details:**
The executor never passes `--model`. All Claude CLI calls use whatever model the user's Claude installation defaults to (likely Opus or Sonnet). The bash scripts support `--model opus|sonnet|haiku` as a configurable option.

**Fix:** Add `--model` support to AgentRunner. Use haiku for exploration (fast, cheap). Use sonnet/opus for user tasks (better reasoning).

**Resolves in:** Phase 16, OB-133

---

### OB-F17 — No disk logging for AI calls — debugging is blind ✅ Fixed

**Discovered:** 2026-02-21 (real-world testing)
**Component:** `src/providers/claude-code/claude-code-executor.ts`
**Impact:** When exploration fails, there's no log of what Claude actually tried to do. Error output shows only "exit code 143" with empty stderr. Impossible to debug without logs.

**Details:**
The executor captures stdout/stderr in memory strings but never writes them to disk. The bash scripts pipe all output through `tee "$LOG_FILE"` so every agent run is recorded. The TypeScript code only logs via Pino (structured, no raw output).

**Fix:** Add disk logging to AgentRunner. Write full stdout/stderr to `.openbridge/logs/<taskId>.log`.

**Resolves in:** Phase 16, OB-135

---

## Severity Guide

| Severity    | Meaning                                               |
| ----------- | ----------------------------------------------------- |
| 🔴 Critical | System broken, data loss risk, security vulnerability |
| 🟠 High     | Core functionality missing or significantly impaired  |
| 🟡 Medium   | Friction, technical debt, or non-blocking gaps        |
| 🟢 Low      | Polish, minor improvements, nice-to-have              |
