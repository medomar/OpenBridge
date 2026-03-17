# OpenBridge — Audit Findings

> **Purpose:** Real issues, gaps, and risks discovered during code audits and real-world testing.
> **This is NOT a task list.** Tasks live in [TASKS.md](TASKS.md). Findings document _what's wrong_ and _why it matters_.
> **Open:** 4 | **Fixed:** 5 (213 prior findings archived) | **Last Audit:** 2026-03-17
> **History:** 213 findings fixed across v0.0.1–v0.1.2. All prior archived in [archive/](archive/).

---

## Open Findings

### OB-F214 — Escalation loop appends "-escalated" indefinitely to profile names

- **Severity:** 🔴 Critical
- **Status:** ✅ Fixed
- **Key Files:** `src/master/worker-orchestrator.ts:702`
- **Root Cause / Impact:**
  `respawnWorkerAfterGrant()` appends `-escalated` to `originalProfile` without checking if the suffix already exists. Each re-grant compounds the name: `code-edit-escalated-escalated-escalated-...` (100+ repetitions observed in production). Causes failed workers and corrupted batch stats.
- **Fix:** Strip any existing `-escalated` suffix before appending, or use a counter (`code-edit-escalated-1`, `code-edit-escalated-2`).
- **Implementation:** OB-1607 (strip logic), OB-1608 (call site defense-in-depth), OB-1609 (unit tests). All tasks complete and merged.

### OB-F215 — Docker health monitor logs WARN every 5 minutes when Docker is unavailable

- **Severity:** 🟡 Medium
- **Status:** ✅ Fixed
- **Key Files:** `src/core/docker-sandbox.ts:221-235`
- **Root Cause / Impact:**
  `_check()` logs a WARN-level message on every 5-minute interval when Docker is unavailable, not just on state transitions. Produces 30+ identical warnings overnight, flooding logs with noise.
- **Fix:** Only log WARN on `available→unavailable` transitions. Use `debug` level for repeated checks when state hasn't changed.
- **Implementation:** OB-1610 implemented the fix by refactoring `_check()` to check both current and previous state (`!this.available && wasAvailable` for WARN, `!this.available && !wasAvailable` for DEBUG).

### OB-F216 — System prompt truncated from 49K to 8K (84% loss)

- **Severity:** 🔴 Critical
- **Status:** ✅ Fixed
- **Key Files:** `src/master/prompt-context-builder.ts:53`, `src/master/prompt-context-builder.ts:236-241`
- **Root Cause / Impact:**
  `SECTION_BUDGET_SYSTEM_PROMPT` is hardcoded to `8_000` characters. The Master's system prompt (~49K) is brutally truncated to 8K, losing 84% of its context — including output routing rules, SHARE marker instructions, APP server docs, and workflow automation docs. This directly causes downstream issues (e.g., OB-F220: Master doesn't know how to deliver files to remote users because those instructions are truncated away).
- **Fix:** Increase the budget to match the adapter's actual capacity. Opus/Sonnet 4.6 support 800K system prompt. A reasonable cap would be 100K–200K for the system prompt section.

### OB-F217 — Quick-answer timeout mismatch produces empty responses

- **Severity:** 🟠 High
- **Status:** Open
- **Key Files:** `src/master/classification-engine.ts:28-43`, `src/master/master-manager.ts`
- **Root Cause / Impact:**
  Quick-answer tasks (maxTurns=5) compute a timeout of 210s (`60s startup + 5×30s/turn`) but `DEFAULT_MESSAGE_TIMEOUT` is 180s. The worker dies before completing, returning only a 28-character error response after 109–168 seconds. Users get empty or error replies for simple questions.
- **Fix:** Align the timeout math — either reduce `PER_TURN_BUDGET_MS` / `CLI_STARTUP_BUDGET_MS` for quick-answer, or increase `DEFAULT_MESSAGE_TIMEOUT` to exceed the computed worker timeout.

### OB-F218 — Streaming worker timeout retries waste 20 minutes

- **Severity:** 🟠 High
- **Status:** ✅ Fixed
- **Key Files:** `src/core/agent-runner.ts`, `src/master/worker-orchestrator.ts`
- **Root Cause / Impact:**
  A read-only sonnet streaming worker timed out at 300s and was retried 4 times (total ~20 minutes wasted). Timeout errors (exit code 143 from SIGTERM) are retried identically — if the task timed out once, it will time out again on every retry. The queue module already skips retries for timeout errors on non-streaming workers, but this logic doesn't apply to streaming workers.
- **Fix:** Skip retries for timeout exits (exit code 143) in the streaming agent path, matching the existing queue behavior. Alternatively, apply exponential backoff with increased timeout on each retry.

### OB-F219 — Codex cost estimation underprices workers, causing late cap enforcement

- **Severity:** 🟡 Medium
- **Status:** ✅ Fixed
- **Key Files:** `src/core/cost-manager.ts:159-173`, `src/master/worker-orchestrator.ts:162-169`
- **Root Cause / Impact:**
  Cost caps ARE enforced during streaming (agent-runner.ts lines 1948-1965 check on every chunk). However, `estimateCostUsd()` in cost-manager.ts has no Codex/OpenAI pricing — Codex models (gpt-5.2, gpt-5.3) fall through to the Sonnet 4.6 default ($0.003 + outputKb × $0.00384), underestimating actual Codex costs by 2–3x. A read-only Codex worker (gpt-5.2) reported $0.123 — the cap ($0.05) triggered but only after the real cost had already exceeded it because the estimate was too low. The Codex adapter also drops `--max-budget-usd` (not supported by Codex CLI), so there's no server-side safety net.
- **Fix:** (1) Add Codex/OpenAI pricing tiers to `estimateCostUsd()` so cap triggers at the correct threshold. (2) Increase read-only cost cap for Codex workers to $0.10 to reflect higher per-token costs. (3) Consider adapter-specific cost multipliers in `PROFILE_DEFAULT_COST_CAPS`.
- **Implementation:** OB-1622 (add Codex pricing), OB-1623 (scale cost cap 2.5x for Codex workers), OB-1624 (unit tests). All tasks complete and merged.

### OB-F220 — Remote channel users can't access generated files/apps (owner blocked)

- **Severity:** 🔴 Critical
- **Status:** Open
- **Key Files:** `src/master/master-system-prompt.ts:1248`, `src/master/master-system-prompt.ts:1216-1253`, `src/master/prompt-context-builder.ts`
- **Root Cause / Impact:**
  When no tunnel is configured, the Master's system prompt explicitly states: _"These URLs are only accessible on localhost. Files are not reachable from the internet or other devices unless a tunnel is configured."_ The Master correctly follows this and tells remote users (Telegram/WhatsApp) they must be on the Mac. Three sub-issues:
  1. **Prompt truncation (OB-F216) hides the output routing table** — the SHARE instructions that tell the Master to use `SHARE:telegram` / `SHARE:whatsapp` for file delivery are in the truncated 84%, so the Master never sees them.
  2. **No auto-tunnel on demand** — the system supports Cloudflare tunnels but requires manual config. When an owner on a remote channel requests a generated page, no tunnel auto-starts.
  3. **User role not injected into Master context** — the Master doesn't know the user is an owner with full access. The auth layer grants it, but the system prompt doesn't communicate it.
- **Fix:** (1) Fix OB-F216 first — restoring the full system prompt will surface the SHARE:telegram/whatsapp routing rules. (2) Inject user role into the Master's per-message context so it knows the user is an owner. (3) Auto-start a tunnel when a remote-channel owner requests file/app access. (4) Update the system prompt to instruct the Master to prefer SHARE:channel attachments over localhost URLs when the user is on a remote channel.

### OB-F221 — Master AI does not know the user's channel or role per message

- **Severity:** 🟠 High
- **Status:** Open
- **Key Files:** `src/master/master-manager.ts:3180-3440`, `src/master/prompt-context-builder.ts`
- **Root Cause / Impact:**
  `message.source` (e.g., "telegram", "whatsapp", "console") and the user's role (e.g., "owner") are available in the code path but are **never injected into the Master's per-message prompt**. The Master receives only `message.content` (or a planning wrapper around it). Without knowing the channel, the Master cannot:
  1. Choose the right output delivery method (SHARE:telegram vs localhost URL vs SHARE:whatsapp)
  2. Adapt response formatting (Telegram supports Markdown, WhatsApp has different limits)
  3. Know whether the user can access localhost URLs or needs a public URL / attachment
     Without knowing the role, the Master cannot distinguish an owner (who should get full capability) from a viewer (who should only get read results).
- **Fix:** Inject a per-message context header into the prompt sent to the Master: `"User: {sender} | Channel: {source} | Role: {role}"`. This is a small addition to the `processMessage()` flow in `master-manager.ts` — prepend it to `promptToSend` before sending to the Master session.

### OB-F222 — APP:start returns localhost URLs to remote channel users with no tunnel fallback

- **Severity:** 🟠 High
- **Status:** Open
- **Key Files:** `src/core/output-marker-processor.ts:689-730`, `src/core/app-server.ts:22-30`
- **Root Cause / Impact:**
  When the Master uses `[APP:start]/path/to/app[/APP]`, the output-marker-processor replaces the marker with the app's URL. Without a tunnel configured, this URL is `http://localhost:31xx` — which is useless to a Telegram/WhatsApp user on their phone. The `AppInstance` has a `publicUrl` field (set when `tunnelFactory` is provided), but when no tunnel factory exists, `publicUrl` is null and the localhost URL is returned anyway. The user sees a broken localhost link in their Telegram chat.
  Combined with OB-F221 (Master doesn't know the channel), the Master has no way to know it shouldn't use APP:start for remote users.
- **Fix:** (1) When `publicUrl` is null and the response is going to a remote channel, the output-marker-processor should either auto-start a tunnel or fall back to generating the page as a file and using SHARE:telegram/whatsapp to send it as an attachment. (2) Alternatively, inject channel awareness (OB-F221) so the Master avoids APP:start for remote users and uses SHARE:github-pages instead.

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

213 findings fixed across v0.0.1–v0.1.2:
[V0](archive/v0/FINDINGS-v0.md) | [V2](archive/v2/FINDINGS-v2.md) | [V4](archive/v4/FINDINGS-v4.md) | [V5](archive/v5/FINDINGS-v5.md) | [V6](archive/v6/FINDINGS-v6.md) | [V7](archive/v7/FINDINGS-v7.md) | [V8](archive/v8/FINDINGS-v8.md) | [V15](archive/v15/FINDINGS-v15.md) | [V16](archive/v16/FINDINGS-v16.md) | [V17](archive/v17/FINDINGS-v17.md) | [V18](archive/v18/FINDINGS-v18.md) | [V19](archive/v19/FINDINGS-v19.md) | [V21](archive/v21/FINDINGS-v21.md) | [V24](archive/v24/FINDINGS-v24.md) | [V25](archive/v25/FINDINGS-v25.md) | [V26](archive/v26/FINDINGS-v26.md) | [V27](archive/v27/FINDINGS-v27.md) | [V28](archive/v28/FINDINGS-v28.md)

---
