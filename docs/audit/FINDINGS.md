# OpenBridge — Audit Findings

> **Purpose:** Real issues, gaps, and risks discovered during code audits and real-world testing.
> **This is NOT a task list.** Tasks live in [TASKS.md](TASKS.md). Findings document _what's wrong_ and _why it matters_.
> **Open:** 1 | **Fixed:** 39 | **Last Audit:** 2026-02-27
> **Resolved findings:** [V0 archive](archive/v0/FINDINGS-v0.md) | [V2 archive](archive/v2/FINDINGS-v2.md) | [V4 archive](archive/v4/FINDINGS-v4.md) | [V5 archive](archive/v5/FINDINGS-v5.md) | [V6 archive](archive/v6/FINDINGS-v6.md) | [V7 archive](archive/v7/FINDINGS-v7.md) | [V8 archive](archive/v8/FINDINGS-v8.md)

---

## Priority Order

| #   | Finding | Severity  | Impact                                       | Status |
| --- | ------- | --------- | -------------------------------------------- | ------ |
| 1   | OB-F39  | ✅ Fixed  | memory.md never updates (--print mode)       | Fixed  |
| 2   | OB-F38  | ✅ Fixed  | FTS5 syntax error on special characters      | Fixed  |
| 3   | OB-F40  | 🟡 Medium | Ungraceful shutdown — Ctrl+C kills instantly | Open   |

---

## Open Findings

### #1 — OB-F39 — memory.md never updates — Master runs in --print mode (stateless)

**Discovered:** 2026-02-27 (user report — "big discussion" not reflected in memory.md + code analysis)
**Component:** `src/master/master-manager.ts:1297-1355` (`buildMasterSpawnOptions()`), `src/core/agent-runner.ts:484-490` (`buildArgs()`)
**Severity:** ✅ Fixed
**Health Impact:** +0.15

**Problem:** The Master AI session is fundamentally stateless. Despite `initMasterSession()` creating a session object with a UUID (`sessionId`), `buildMasterSpawnOptions()` **never sets `sessionId` or `resumeSessionId`** on the `SpawnOptions` it returns. This means `buildArgs()` in `agent-runner.ts` defaults to `--print` mode for every Master invocation.

**Consequence for memory.md updates:**

1. `triggerMemoryUpdate()` (line 860) sends a prompt asking the Master to write `memory.md`
2. The Master runs as a fresh `--print` session — **no context from previous interactions**
3. The AI has no accumulated knowledge of the conversation to write meaningful notes
4. Even if the Write tool is available, the AI produces generic content (or no update at all)
5. Errors are swallowed by `.catch()` (line 881) — user sees no indication of failure

**When updates are triggered:**

| Trigger  | Condition                                                | Likely outcome                                            |
| -------- | -------------------------------------------------------- | --------------------------------------------------------- |
| Periodic | Every 10 completed tasks (`MEMORY_UPDATE_INTERVAL = 10`) | Stateless AI produces generic output                      |
| Shutdown | Before `state = 'shutdown'` (line 4991-4996)             | Same — plus may be interrupted by force-kill (see OB-F40) |

**Root cause:** The `--print` mode design was intentional (to avoid TTY hang issues), but it breaks the memory.md update pattern which requires the AI to have accumulated session context.

**Recommended fix options:**

| Option | Approach                                                                                                                                    | Complexity        |
| ------ | ------------------------------------------------------------------------------------------------------------------------------------------- | ----------------- |
| A      | Pass conversation history summary in the memory-update prompt itself (not just "update memory" — include what happened)                     | Medium (~100 LOC) |
| B      | Use `--session-id` / `--resume` with `--allowedTools` (modern Claude CLI handles no-TTY correctly with `--print` + `--session-id` combined) | Medium (~50 LOC)  |
| C      | Have `triggerMemoryUpdate()` read recent conversation entries from SQLite and include them in the prompt                                    | Small (~60 LOC)   |

Option C is safest — it doesn't change the `--print` mode architecture but gives the stateless AI enough context to write a meaningful memory update.

**Tool-agnostic:** This bug is NOT Claude-specific. The memory update mechanism works through the `CLIAdapter` abstraction. If Codex is the Master, the same stateless `--print` mode problem exists. **Minor sub-issue:** the prompt text says `"Use the Write tool"` — `Write` is a Claude Code tool name. Codex uses different tool naming. The prompt should use generic language or adapter-aware tool names.

**Effort:** Medium (~100 LOC). Touches `master-manager.ts` (triggerMemoryUpdate) and possibly `retrieval.ts` (conversation fetch).

---

### #2 — OB-F38 — FTS5 syntax error on special characters — cross-session context silently fails

**Discovered:** 2026-02-27 (runtime log — `SqliteError: fts5: syntax error near "'"`)
**Component:** `src/memory/retrieval.ts:257`, `src/master/master-manager.ts:771`
**Severity:** ✅ Fixed
**Health Impact:** +0.05

**Problem:** The `searchConversations()` function in `retrieval.ts` passes user-derived query strings directly to the FTS5 `MATCH` clause without escaping special characters. FTS5 has its own query syntax where characters like `'`, `"`, `*`, `AND`, `OR`, `NOT`, `(`, `)` have special meaning. When a user message (or search query derived from it) contains any of these characters, the FTS5 query fails with:

```
SqliteError: fts5: syntax error near "'"
```

**Impact:** Non-critical — the error is caught and logged as WARN. The Master continues processing without cross-session conversation context. But it means **conversation history context injection silently fails** for any message containing FTS5 special characters. This degrades response quality without any user-visible indication.

**Recommended fix:**

Sanitize FTS5 query input in `retrieval.ts` before passing to `MATCH`:

```typescript
function escapeFts5Query(query: string): string {
  // Wrap each term in double quotes to treat as literal, strip existing quotes
  return query
    .replace(/["']/g, '') // Remove quotes (FTS5 syntax chars)
    .split(/\s+/) // Split into terms
    .filter(Boolean)
    .map((term) => `"${term}"`) // Quote each term as literal
    .join(' '); // Implicit AND
}
```

**Effort:** Tiny (~10 LOC). Single file change.

---

### #3 — OB-F40 — Ungraceful shutdown — Ctrl+C force-kills before memory update completes

**Discovered:** 2026-02-27 (runtime log — `tsx` force-kills process on Ctrl+C)
**Component:** `src/index.ts:313-329`, `src/master/master-manager.ts:4982-5029`
**Severity:** 🟡 Medium
**Health Impact:** +0.05

**Problem:** When running via `npm run dev` (which uses `tsx`), pressing Ctrl+C causes `tsx` to force-kill the process before the graceful shutdown handler completes. The log shows:

```
^C7:21:39 AM [tsx] Previous process hasn't exited yet. Force killing...
```

The graceful shutdown flow is:

```
SIGINT → shutdown() → bridge.stop() → MasterManager.shutdown()
  → triggerMemoryUpdate()     ← spawns a new Claude CLI process (~10-30s)
  → saveMasterSessionToStore() ← SQLite write
  → process.exit(0)
```

`triggerMemoryUpdate()` spawns a new Claude CLI process which takes 10-30 seconds to complete. `tsx` doesn't wait that long — it force-kills after a short timeout. This means:

1. **Memory update is aborted** — any session learnings are lost
2. **Session state may not persist** — `saveMasterSessionToStore()` may not run
3. **SQLite WAL checkpoint may not flush** — data in WAL file may be orphaned (though SQLite handles this on next open)

**Recommended fix:**

| #   | Change                                                                                                                  | Impact                   |
| --- | ----------------------------------------------------------------------------------------------------------------------- | ------------------------ |
| 1   | Add "Shutting down gracefully... please wait" console output on SIGINT                                                  | Users know to wait       |
| 2   | Set a shutdown timeout (e.g., 15s) — if exceeded, force exit with warning                                               | Prevents indefinite hang |
| 3   | Skip `triggerMemoryUpdate()` on SIGINT if it would take too long — save session state first, then attempt memory update | Prioritize critical data |
| 4   | Document `tsx` force-kill behavior in README/contributing guide                                                         | Developer awareness      |

**Effort:** Small (~30 LOC). Touches `src/index.ts` (shutdown handler).

---

## Severity Guide

| Severity    | Meaning                                               |
| ----------- | ----------------------------------------------------- |
| 🔴 Critical | System broken, data loss risk, security vulnerability |
| 🟠 High     | Core functionality missing or significantly impaired  |
| 🟡 Medium   | Friction, technical debt, or non-blocking gaps        |
| 🟢 Low      | Polish, minor improvements, nice-to-have              |
