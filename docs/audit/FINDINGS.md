# OpenBridge — Audit Findings

> **Purpose:** Real issues, gaps, and risks discovered during code audits and real-world testing.
> **This is NOT a task list.** Tasks live in [TASKS.md](TASKS.md). Findings document _what's wrong_ and _why it matters_.
> **Open:** 4 | **Fixed:** 34 | **Last Audit:** 2026-02-27
> **Resolved findings:** [V0 archive](archive/v0/FINDINGS-v0.md) | [V2 archive](archive/v2/FINDINGS-v2.md) | [V4 archive](archive/v4/FINDINGS-v4.md) | [V5 archive](archive/v5/FINDINGS-v5.md) | [V6 archive](archive/v6/FINDINGS-v6.md) | [V7 archive](archive/v7/FINDINGS-v7.md)

---

## Priority Order

| #   | Finding | Severity  | Impact                                       | Status                                                                                                 |
| --- | ------- | --------- | -------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| 1   | OB-F37  | ✅ Fixed  | Codex workers broken + no Codex provider     | Fixed in Phases 57–59 (21 tasks, OB-1091–OB-1112). Codex adapter flags corrected, CodexProvider added. |
| 2   | OB-F39  | 🟠 High   | memory.md never updates (--print mode)       | Master runs stateless — triggerMemoryUpdate() can't persist anything                                   |
| 3   | OB-F38  | 🟡 Medium | FTS5 syntax error on special characters      | Cross-session conversation context silently fails                                                      |
| 4   | OB-F40  | 🟡 Medium | Ungraceful shutdown — Ctrl+C kills instantly | Memory update + session persist skipped on force-kill                                                  |
| 5   | OB-F36  | 🟡 Medium | Feature gap — no MCP integration             | Workers can't access external services via MCP. **Tasks:** Phases 60–62 (20 tasks, OB-1070–OB-1090)    |

---

## Open Findings

### #1 — OB-F36 — No MCP (Model Context Protocol) support — workers can't use external services

**Discovered:** 2026-02-27 (WebChat conversation + feasibility analysis)
**Reviewed:** 2026-02-27 (architecture review — lifecycle, security, scope gaps identified)
**Component:** `src/core/agent-runner.ts`, `src/core/adapters/claude-adapter.ts`, `src/types/config.ts`, `src/master/master-system-prompt.ts`, `src/master/master-manager.ts`
**Severity:** 🟡 Medium
**Health Impact:** +0.15

**Problem:** OpenBridge has **zero MCP support**. The Claude CLI adapter (`claude-adapter.ts`) passes `--print`, `--session-id`, `--resume`, `--model`, `--max-turns`, `--allowedTools`, `--append-system-prompt`, and `--max-budget-usd` — but never `--mcp-config` or any MCP-related flags. `SpawnOptions` has no MCP fields. The entire `src/` directory contains no references to "MCP" or "Model Context Protocol".

This means:

- **Workers cannot access external services** (Gmail, Canva, Slack, GitHub, databases, etc.) via the MCP ecosystem
- **Users cannot leverage their existing MCP server configurations** from Claude Desktop or Claude Code
- **OpenBridge is isolated** from the rapidly growing MCP tool ecosystem that Anthropic is building
- **Claude.ai Connectors** (cloud-only, tied to browser sessions) are not accessible via CLI — MCP is the open-source equivalent

**What exists today vs. what's missing:**

| Capability                   | Current State                                | With MCP                                                 |
| ---------------------------- | -------------------------------------------- | -------------------------------------------------------- |
| Worker tool access           | `--allowedTools` (Read, Write, Bash, etc.)   | `--allowedTools` + MCP server tools (Gmail, Canva, etc.) |
| External service integration | None                                         | Any MCP-compatible service                               |
| Config schema                | `config.json` has connectors, provider, auth | Would add `mcp` section                                  |
| Claude CLI flags             | 8 flags passed                               | + `--mcp-config <path>` + `--strict-mcp-config`          |
| SpawnOptions                 | 12 fields                                    | + `mcpConfigPath` + `strictMcpConfig`                    |
| Master awareness             | Knows about AI tools only                    | Also knows which MCP servers are available               |
| Security                     | Per-user whitelist + tool profiles           | + per-role MCP server access control                     |

**Architecture — how MCP would fit:**

```
User (WhatsApp/Console/Telegram)
  → OpenBridge Router
    → Auth check: does this user's role have access to requested MCP servers?
    → Master AI (decides: "this needs Gmail/Canva/etc.")
      → Spawns Worker with MCP tools enabled
        → claude --print --mcp-config /tmp/ob-mcp-xxx.json --strict-mcp-config --allowedTools "mcp__canva__*" ...
          → Claude CLI spawns MCP server process (per-worker lifecycle)
            → MCP server calls external API (Gmail, Canva, etc.)
          → Worker returns result, MCP server process exits
        → Master formats response
      → Router sends back to channel
```

Key insight: OpenBridge doesn't need to know anything about individual services. We pass `--mcp-config <path>` to the Claude CLI, and Claude handles tool discovery and invocation. The MCP servers are external processes that translate tool calls into API requests.

**What the user would configure in `config.json`:**

```json
{
  "mcp": {
    "enabled": true,
    "servers": [
      {
        "name": "canva",
        "command": "npx",
        "args": ["-y", "@anthropic/canva-mcp-server"],
        "env": { "CANVA_API_KEY": "..." }
      },
      {
        "name": "gmail",
        "command": "npx",
        "args": ["-y", "@anthropic/gmail-mcp-server"],
        "env": { "GMAIL_OAUTH_TOKEN": "..." }
      }
    ],
    "configPath": "~/.claude/claude_desktop_config.json"
  }
}
```

Note: users can define servers inline OR point to an existing Claude Desktop/Claude Code MCP config file via `configPath` to avoid duplication.

---

**Key design considerations (from architecture review):**

**1. MCP server lifecycle management**

Claude CLI with `--mcp-config` launches MCP server processes as children of each worker invocation. For short-lived `--print` workers:

- Each worker spawn starts MCP server processes
- Each worker completion kills them
- Frequently-used services (Gmail, Slack) incur startup latency per task

**Current approach (Phase 57):** Accept per-worker lifecycle. Claude CLI manages it transparently. This matches our bounded-worker philosophy — workers are short-lived by design.

**Future consideration:** If latency becomes an issue, OpenBridge could manage long-running MCP servers that workers connect to via SSE transport. This would be a Phase 61+ optimization, not needed for initial launch.

**2. Security — per-role MCP access control**

MCP servers receive API keys via `env` in the config. Security implications:

- Every worker spawned with `--mcp-config` gets access to **all** configured MCP servers in that config file
- `--allowedTools "mcp__canva__*"` restricts which tools the worker can call, but the MCP server processes are still started
- A compromised or misbehaving worker could theoretically invoke tools beyond its `--allowedTools` restriction

**Mitigation (Phase 57):** Generate **per-worker temp MCP config files** containing only the servers that worker needs (not all configured servers). Combined with `--strict-mcp-config` (ignores global MCP configs), this gives true isolation. Ties into existing auth system — the `access-store.ts` already has role-based permissions that can be extended with MCP server allowlists per role.

**3. Master awareness is essential (not optional)**

Without MCP awareness in the Master system prompt, the Master AI:

- Doesn't know which external services are available
- Can't make intelligent decisions about when to use MCP tools
- Forces users to explicitly say "use Canva" in every message

This means change #4 (Master-aware MCP tools) is **required for usable MCP support**, not optional. The Master must see available MCP servers in its system prompt to autonomously decide "this task needs Canva, I'll spawn a worker with that MCP server."

**4. Config source flexibility**

Users may already have MCP configs in:

- `~/.claude/claude_desktop_config.json` (Claude Desktop)
- `.mcp.json` in project roots (Claude Code project scope)
- `.claude/settings.json` in project roots (Claude Code)

Supporting `configPath` in the MCP config section avoids forcing users to duplicate their existing setups.

**5. Scope: Claude-only for now**

MCP support via `--mcp-config` is a Claude CLI feature. Other adapters (Codex, Aider) don't support MCP. The `CLIAdapter` abstraction handles this gracefully — other adapters simply ignore the `mcpConfigPath` field. This should be clearly documented.

---

**Recommended fix — 5 essential changes (~400 LOC):**

| #   | Change                  | File(s)                                                              | What                                                                              |
| --- | ----------------------- | -------------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| 1   | Zod schemas + config    | `src/types/config.ts`                                                | `MCPServerSchema`, `MCPConfigSchema`, add `mcp` to `V2ConfigSchema`               |
| 2   | SpawnOptions + manifest | `src/core/agent-runner.ts`, `src/types/agent.ts`                     | `mcpConfigPath` + `strictMcpConfig` on SpawnOptions, `mcpServers` on TaskManifest |
| 3   | Claude adapter          | `src/core/adapters/claude-adapter.ts`                                | Pass `--mcp-config` + `--strict-mcp-config` flags                                 |
| 4   | Per-worker MCP config   | `src/core/agent-runner.ts`                                           | Generate temp MCP JSON per worker (only requested servers), cleanup after spawn   |
| 5   | Master awareness        | `src/master/master-system-prompt.ts`, `src/master/master-manager.ts` | Inject available MCP servers into Master system prompt, pass from V2Config        |

**Additional work (improves UX, not blocking):**

| #   | Change               | File(s)              | What                                                           |
| --- | -------------------- | -------------------- | -------------------------------------------------------------- |
| 6   | Health checks        | `src/core/health.ts` | Verify MCP server commands exist on PATH                       |
| 7   | CLI init             | `src/cli/init.ts`    | Interactive MCP server configuration step                      |
| 8   | Config source import | `src/core/config.ts` | Read existing Claude Desktop/Code MCP configs via `configPath` |

**Effort:** Medium for essential (changes 1–5, ~400 LOC), Small for UX polish (changes 6–8, ~200 LOC). Four phases, 19 tasks.

**Value:** Unique in the MCP ecosystem — no other project offers "send a WhatsApp message → Master AI decides which MCP tools to use → worker executes via Claude CLI → result sent back to WhatsApp." This bridges messaging channels to the entire MCP tool ecosystem.

**Risk:** Low — all business logic already exists. The MCP layer is protocol plumbing + Master prompt extension. Per-worker config isolation mitigates security concerns.

---

### #2 — OB-F37 — Codex workers always fail + no Codex provider (users without Claude locked out) — ✅ Fixed

**Discovered:** 2026-02-27 (real-world testing + deep pipeline analysis)
**Fixed:** 2026-02-27 (Phases 57–59, OB-1091–OB-1112)
**Component:** `src/core/adapters/codex-adapter.ts`, `src/core/agent-runner.ts`, `src/providers/`, `src/index.ts`
**Severity:** ✅ Fixed (was 🟠 High)
**Health Impact:** +0.20

**Problem:** Users who only have Codex (no Claude) cannot use OpenBridge at all. Multiple issues across the full pipeline:

**Confirmed failure #1 — Missing `--skip-git-repo-check` flag (CRITICAL)**

Codex CLI v0.104.0 requires the workspace to be inside a trusted Git repository. When `codex exec` is run with `cwd` set to a non-git directory, it exits immediately with:

```
Not inside a trusted directory and --skip-git-repo-check was not specified.
EXIT CODE: 1
```

The Codex adapter (`codex-adapter.ts:42-93`) never passes `--skip-git-repo-check`. The `execOnce()` function (`agent-runner.ts:544-549`) sets `cwd: workspacePath`. If the user's workspace is not a Git repo (or hasn't been added to Codex's trust list), **every Codex worker fails instantly**.

Verified on machine: `codex exec --ephemeral --sandbox read-only "say hello" < /dev/null` returns exit code 1 from non-git directories, exit code 0 from git repos.

**Confirmed failure #2 — No Codex provider (no Master capability)**

`src/providers/` contains only `claude-code/`. There is no Codex provider. This means:

- Codex **cannot be used as Master AI** — no `processMessage()`, no session management, no streaming
- If Claude is not installed, `index.ts:151-157` throws: `"No Master AI tool available for V2 flow"`
- Even if Codex is discovered (priority 80), it can never become Master because `registerBuiltInProviders()` only registers `claude-code`

For users with **only Codex installed**, OpenBridge is completely unusable.

**Confirmed failure #3 — Outdated CLI flags in adapter**

The Codex adapter was written for an older version of the Codex CLI. Comparing adapter flags vs actual v0.104.0:

| Adapter Generates        | Actual Codex v0.104.0                                                       |
| ------------------------ | --------------------------------------------------------------------------- |
| `codex exec --model <M>` | Correct (`-m, --model <MODEL>`)                                             |
| `--sandbox <mode>`       | Correct (`-s, --sandbox <MODE>`)                                            |
| `--full-auto`            | Correct (convenience alias)                                                 |
| `--ephemeral`            | Correct (session suppression)                                               |
| _(missing)_              | `--skip-git-repo-check` — required for non-git workspaces                   |
| _(missing)_              | `--json` — outputs JSONL events to stdout (enables structured parsing)      |
| _(missing)_              | `-C, --cd <DIR>` — explicit cwd (alternative to process cwd)                |
| _(missing)_              | `-o, --output-last-message <FILE>` — reliable output capture                |
| _(not needed)_           | `--dangerously-bypass-approvals-and-sandbox` — we use `--full-auto` instead |

**Additional issues found:**

| #   | Issue                                                                                              | Severity | Location                   | Impact                                                                                        |
| --- | -------------------------------------------------------------------------------------------------- | -------- | -------------------------- | --------------------------------------------------------------------------------------------- |
| 4   | `inferSandboxMode()` returns `undefined` when no tools specified — Codex uses default (permissive) | Medium   | `codex-adapter.ts:139-140` | Unexpected access for read-only tasks                                                         |
| 5   | No OPENAI_API_KEY validation — Codex fails silently with auth error                                | Medium   | `codex-adapter.ts:95-108`  | Confusing error message for users                                                             |
| 6   | `MODEL_FALLBACK_CHAIN` is Claude-only — Codex rate limits cause no fallback                        | Medium   | `agent-runner.ts:220-227`  | Codex workers don't recover from rate limits (but `ModelRegistry` handles this if registered) |
| 7   | Codex supports MCP natively (`codex mcp`) — adapter doesn't expose it                              | Low      | `codex-adapter.ts`         | Missed feature parity with Claude MCP                                                         |

**Pipeline failure sequence for Codex-only users:**

```
1. User installs only Codex (no Claude)
2. scanForAITools() discovers Codex (priority 80), selects as Master candidate
3. index.ts tries to create MasterManager with Codex as masterTool
4. registerBuiltInProviders() only has 'claude-code' → no Codex provider
5. BUT: MasterManager doesn't use providers directly — it uses AgentRunner + CLIAdapter
6. MasterManager.startSession() calls AgentRunner.spawn() with CodexAdapter
7. CodexAdapter.buildSpawnConfig() generates args WITHOUT --skip-git-repo-check
8. execOnce() spawns: codex exec --ephemeral ... (in workspacePath)
9. If workspace is not a git repo → immediate exit code 1
10. Error classified as 'crash', retry 3 times, all fail
11. Master session never starts → all user messages fail
```

**Recommended fix — two tracks:**

**Track A: Fix Codex as Worker (critical, unblocks mixed Claude+Codex setups)**

| #   | Change                         | File               | What                                                          |
| --- | ------------------------------ | ------------------ | ------------------------------------------------------------- |
| 1   | Add `--skip-git-repo-check`    | `codex-adapter.ts` | Always pass flag (OpenBridge validates workspace separately)  |
| 2   | Default sandbox to `read-only` | `codex-adapter.ts` | When no tools specified, default to `read-only` not undefined |
| 3   | Validate OPENAI_API_KEY        | `codex-adapter.ts` | Check env var exists before spawn, log clear error if missing |
| 4   | Add `--json` output mode       | `codex-adapter.ts` | Enable structured JSONL parsing for better output capture     |
| 5   | Add `-o` output capture        | `codex-adapter.ts` | Use `--output-last-message` for reliable result extraction    |

**Track B: Add Codex Provider (high, enables Codex-only users)**

| #   | Change                          | File                                     | What                                                              |
| --- | ------------------------------- | ---------------------------------------- | ----------------------------------------------------------------- |
| 6   | Create `CodexProvider`          | `src/providers/codex/`                   | Implement `AIProvider` interface using `codex exec` with sessions |
| 7   | Register Codex provider         | `src/providers/index.ts`                 | Add to `registerBuiltInProviders()`                               |
| 8   | Provider-aware Master selection | `src/index.ts`                           | If Claude not available, use Codex provider as Master             |
| 9   | Session management              | `src/providers/codex/session-manager.ts` | Codex session resume via `codex exec resume --last`               |

**Effort:** Medium for Track A (~200 LOC), Large for Track B (~600 LOC). Two phases.

**Value:** Track A immediately unblocks Claude+Codex setups. Track B makes OpenBridge usable for OpenAI-only users — a significant expansion of the user base.

---

### #3 — OB-F38 — FTS5 syntax error on special characters — cross-session context silently fails

**Discovered:** 2026-02-27 (runtime log — `SqliteError: fts5: syntax error near "'"`)
**Component:** `src/memory/retrieval.ts:257`, `src/master/master-manager.ts:771`
**Severity:** 🟡 Medium
**Health Impact:** +0.05

**Problem:** The `searchConversations()` function in `retrieval.ts` passes user-derived query strings directly to the FTS5 `MATCH` clause without escaping special characters. FTS5 has its own query syntax where characters like `'`, `"`, `*`, `AND`, `OR`, `NOT`, `(`, `)` have special meaning. When a user message (or search query derived from it) contains any of these characters, the FTS5 query fails with:

```
SqliteError: fts5: syntax error near "'"
```

**Call chain:**

```
Router.route() → MasterManager.processMessage()
  → MasterManager.buildConversationContext()
    → MemoryManager.searchConversations()
      → retrieval.searchConversations(db, query, limit)
        → db.prepare(...).all(query, limit)  ← raw query hits FTS5 MATCH
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

### #4 — OB-F39 — memory.md never updates — Master runs in --print mode (stateless)

**Discovered:** 2026-02-27 (user report — "big discussion" not reflected in memory.md + code analysis)
**Component:** `src/master/master-manager.ts:1297-1355` (`buildMasterSpawnOptions()`), `src/core/agent-runner.ts:484-490` (`buildArgs()`)
**Severity:** 🟠 High
**Health Impact:** +0.15

**Problem:** The Master AI session is fundamentally stateless. Despite `initMasterSession()` creating a session object with a UUID (`sessionId`), `buildMasterSpawnOptions()` **never sets `sessionId` or `resumeSessionId`** on the `SpawnOptions` it returns. This means `buildArgs()` in `agent-runner.ts` defaults to `--print` mode for every Master invocation.

**Evidence from code (`master-manager.ts:1320-1322`):**

```typescript
// Use --print mode (non-interactive). Interactive sessions (--session-id)
// hang as headless child processes — no TTY for permission prompts.
// No sessionId/resumeSessionId set → buildArgs() defaults to --print.
```

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

**What's actually in memory.md:**

The existing `memory.md` content (5738 bytes, updated 2026-02-27 07:21) appears to have been written during an **exploration phase** where the system prompt already contains sufficient workspace context. Regular conversation memory (user preferences, decisions, discussion threads) is NOT being captured.

**Root cause:** The `--print` mode design was intentional (to avoid TTY hang issues), but it breaks the memory.md update pattern which requires the AI to have accumulated session context.

**Recommended fix options:**

| Option | Approach                                                                                                                                    | Complexity        |
| ------ | ------------------------------------------------------------------------------------------------------------------------------------------- | ----------------- |
| A      | Pass conversation history summary in the memory-update prompt itself (not just "update memory" — include what happened)                     | Medium (~100 LOC) |
| B      | Use `--session-id` / `--resume` with `--allowedTools` (modern Claude CLI handles no-TTY correctly with `--print` + `--session-id` combined) | Medium (~50 LOC)  |
| C      | Have `triggerMemoryUpdate()` read recent conversation entries from SQLite and include them in the prompt                                    | Small (~60 LOC)   |

Option C is safest — it doesn't change the `--print` mode architecture but gives the stateless AI enough context to write a meaningful memory update.

**Tool-agnostic:** This bug is NOT Claude-specific. The memory update mechanism works through the `CLIAdapter` abstraction — `MasterManager` receives an adapter (Claude, Codex, Aider) at construction and `AgentRunner` uses whichever adapter was passed. If Codex is the Master, the same `triggerMemoryUpdate()` → `agentRunner.spawn()` → `CodexAdapter.buildSpawnConfig()` path runs. The stateless `--print` mode problem exists at the `buildMasterSpawnOptions()` level, before any adapter is involved. **Minor sub-issue:** the prompt text says `"Use the Write tool"` — `Write` is a Claude Code tool name. Codex uses different tool naming. The prompt should use generic language or adapter-aware tool names.

**Effort:** Medium (~100 LOC). Touches `master-manager.ts` (triggerMemoryUpdate) and possibly `retrieval.ts` (conversation fetch).

---

### #5 — OB-F40 — Ungraceful shutdown — Ctrl+C force-kills before memory update completes

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

**Additional issue:** There's no user-facing indication that shutdown is in progress. Users press Ctrl+C, see nothing happening for a few seconds, and press Ctrl+C again (or `tsx` does it automatically), force-killing the process.

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
