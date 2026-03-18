# OpenBridge — Audit Findings

> **Purpose:** Real issues, gaps, and risks discovered during code audits and real-world testing.
> **This is NOT a task list.** Tasks live in [TASKS.md](TASKS.md). Findings document _what's wrong_ and _why it matters_.
> **Open:** 3 | **Fixed:** 14 (213 prior findings archived) | **Last Audit:** 2026-03-17
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
- **Status:** ✅ Fixed
- **Key Files:** `src/master/classification-engine.ts:28-43`, `src/master/master-manager.ts`
- **Root Cause / Impact:**
  Quick-answer tasks (maxTurns=5) compute a timeout of 210s (`60s startup + 5×30s/turn`) but `DEFAULT_MESSAGE_TIMEOUT` is 180s. The worker dies before completing, returning only a 28-character error response after 109–168 seconds. Users get empty or error replies for simple questions.
- **Fix:** Align the timeout math — either reduce `PER_TURN_BUDGET_MS` / `CLI_STARTUP_BUDGET_MS` for quick-answer, or increase `DEFAULT_MESSAGE_TIMEOUT` to exceed the computed worker timeout.
- **Implementation:** Addressed by OB-F230 classification fixes — deployment messages no longer misclassified as quick-answer.

### OB-F230 — Classification engine cannot escalate quick-answer + moderate-confidence AI overrides keyword match

- **Severity:** 🔴 Critical
- **Status:** ✅ Fixed
- **Key Files:** `src/master/classification-engine.ts:479-533`, `src/master/master-manager.ts:3774-3792`
- **Root Cause / Impact:**
  Three compounding classification bugs caused deployment requests to be misclassified as quick-answer with 120s timeout:
  1. **Learning-based escalation blocked for quick-answer (rank 0):** The escalation guard `currentRank > 0` (line 533) prevented quick-answer from ever being escalated by learning data, even when historical data showed 100% success rate for complex-task.
  2. **AI classifier override with moderate confidence:** When AI returns quick-answer with confidence 0.65 (≥ 0.4 threshold), it overrides the keyword classifier which would have correctly detected "deploy" → tool-use/complex-task. Messages like "Can deployed in other channel" were stuck as quick-answer.
  3. **No max-turns exhaustion feedback:** When the Master session itself hit max-turns, the raw 29-character output was returned to the user with no guidance on what happened or how to retry.
- **Fix:** (1) Removed `currentRank > 0` gate so learning data can escalate any class. (2) When AI confidence is 0.4–0.8 and keyword classifier returns a higher class, prefer keyword (prevents under-classification). (3) Added Master max-turns detection with user-friendly guidance message. (4) Improved timeout error message with actionable retry suggestions.

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
- **Status:** ✅ Fixed
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
- **Status:** ✅ Fixed
- **Key Files:** `src/core/output-marker-processor.ts:689-730`, `src/core/app-server.ts:22-30`
- **Root Cause / Impact:**
  When the Master uses `[APP:start]/path/to/app[/APP]`, the output-marker-processor replaces the marker with the app's URL. Without a tunnel configured, this URL is `http://localhost:31xx` — which is useless to a Telegram/WhatsApp user on their phone. The `AppInstance` has a `publicUrl` field (set when `tunnelFactory` is provided), but when no tunnel factory exists, `publicUrl` is null and the localhost URL is returned anyway. The user sees a broken localhost link in their Telegram chat.
  Combined with OB-F221 (Master doesn't know the channel), the Master has no way to know it shouldn't use APP:start for remote users.
- **Fix:** (1) When `publicUrl` is null and the response is going to a remote channel, the output-marker-processor should either auto-start a tunnel or fall back to generating the page as a file and using SHARE:telegram/whatsapp to send it as an attachment. (2) Alternatively, inject channel awareness (OB-F221) so the Master avoids APP:start for remote users and uses SHARE:github-pages instead.
- **Implementation:** OB-1633 (auto-tunnel integration for APP:start), OB-1634 (Master system prompt documentation update). Phase 159 complete.

### OB-F223 — Workers can delete .openbridge/ internal state files (memory.md destroyed)

- **Severity:** 🔴 Critical
- **Status:** ✅ Fixed
- **Key Files:** `src/types/agent.ts:269,285`, `src/master/worker-orchestrator.ts:410,875-883`, `src/types/config.ts:223-238`
- **Root Cause / Impact:**
  Workers spawned with `code-edit` or `file-management` profiles receive `Bash(rm:*)` access and operate inside the full `workspacePath` — which includes `.openbridge/`. No file-level boundary prevents workers from deleting or modifying `.openbridge/context/memory.md`, `.openbridge/workspace-map.json`, or any other internal state file. Observed in production: memory.md was written successfully at 06:05:10 (36 lines) but was gone (ENOENT) by 06:12:01 — ~7 minutes later — after a worker was spawned with `tool-use` profile to "deploy the POS web app". The worker likely ran cleanup commands (`rm`, `mv`) that swept `.openbridge/context/`. The trusted-mode workspace boundary instruction (worker-orchestrator.ts:875-883) only prevents access to files **outside** the workspace — it does not protect `.openbridge/` internal files. The Master system prompt tells the Master not to modify `.openbridge/` files, but **this guidance is never passed to workers**. `.openbridge/` is also not in `DEFAULT_EXCLUDE_PATTERNS` (config.ts:223-238).
  Once memory.md is deleted, all subsequent messages lose cross-session context — the Master operates without workspace knowledge, leading to degraded responses for the rest of the session.
- **Fix:** (1) Add `.openbridge/context/` and `.openbridge/workspace-map.json` to the worker boundary instruction so workers are explicitly told not to modify internal state files. (2) Add `.openbridge/` to `DEFAULT_EXCLUDE_PATTERNS` so it's hidden from worker file discovery. (3) Consider stripping `Bash(rm:*)` from `code-edit` profile and restricting it to `file-management` and `full-access` only. (4) As defense-in-depth, back up memory.md to SQLite after writing so it can be restored if deleted.

### OB-F224 — Legacy cleanup deletes exploration/ directory needed by active exploration

- **Severity:** 🟠 High
- **Status:** ✅ Fixed (OB-1644, OB-1645, OB-1646, OB-1647, OB-1648)
- **Key Files:** `src/core/bridge.ts:1099-1106`, `src/master/dotfolder-manager.ts:64,315-324`, `src/master/exploration-coordinator.ts:248-254,923`, `src/master/exploration-manager.ts:1105`
- **Root Cause / Impact:**
  `cleanLegacyDotFolderArtifacts()` in bridge.ts (line 1099-1106) unconditionally deletes the `.openbridge/exploration/` directory on every startup with `fs.rm(recursive: true, force: true)`. The comment says "exploration state is now in system_config" — but the code still actively uses this directory: Phase 2 writes `classification.json` to `.openbridge/exploration/` (exploration-coordinator.ts:923), and `writeExplorationSummaryToMemory()` reads it post-exploration (exploration-manager.ts:1105) via `dotFolder.readClassification()` (dotfolder-manager.ts:315-324). The cleanup runs during `bridge.start()` (bridge.ts:437), before `masterManager.start()` begins exploration. When exploration runs fresh (not resuming), the directory is re-created — but on resume from a failed exploration, the previously completed Phase 2 data is lost. Additionally, `readClassification()` only reads from the JSON file, not from SQLite, so even if the coordinator wrote to SQLite, the memory-seeding path can't access it. Same issue affects `classifications.json` (dotfolder-manager.ts:757) and `workers.json` (dotfolder-manager.ts:535) — WARN-level logs on every first run for files that are expected to not exist yet.
- **Fix:** (1) Don't delete `exploration/` if exploration state shows incomplete (check `exploration-state.json` before deleting). (2) Make `readClassification()` in dotfolder-manager.ts check SQLite first, falling back to JSON file. (3) Downgrade WARN to DEBUG for expected first-run ENOENT on `classifications.json`, `workers.json`, and `classification.json`.

### OB-F225 — DLQ messages produce no error response to user (silent failure)

- **Severity:** 🔴 Critical
- **Status:** Open
- **Key Files:** `src/core/queue.ts:250-268`, `src/core/bridge.ts:530-555`
- **Root Cause / Impact:**
  When a message exhausts all retries and is moved to the dead letter queue (queue.ts:250-268), no error response is sent back to the user via the connector. The DLQ path only logs `'Message permanently failed — moved to dead letter queue'` and pushes to `this.dlq[]`. The bridge's `queue.onMessage()` handler (bridge.ts:530-555) does not wrap `router.route()` in a try-catch that would send a fallback error message to the user. The queue catches the error internally (queue.ts:197-200) and moves to DLQ, but the connector is never called. Observed in production: telegram-1547, telegram-1550, telegram-1557, telegram-1560 all went to DLQ silently — the user sent 4 follow-up messages saying "I didn't get response" because they received no feedback at all. DLQ size grew to 4 in a single session. This is the worst possible UX — the user has no idea their message failed.
- **Fix:** (1) Add an `onDeadLetter` callback to `MessageQueue` that the bridge wires up during initialization. When a message is moved to DLQ, invoke the callback with the original message and connector reference. (2) In the callback, send a user-friendly error: "Sorry, I wasn't able to complete your request. Please try again or simplify your request." (3) As defense-in-depth, add a catch block in bridge.ts around `router.route()` that sends an error response if the route throws unexpectedly.

### OB-F226 — Workers attempt interactive CLI auth (Netlify OAuth) blocking until timeout

- **Severity:** 🟠 High
- **Status:** ✅ Fixed
- **Key Files:** `src/master/master-system-prompt.ts:462-530`, `src/core/agent-runner.ts:940,988-1003,1012-1026`
- **Root Cause / Impact:**
  The Master system prompt's worker guidelines (master-system-prompt.ts:462-530) contain no warning about interactive CLI tools that require browser-based OAuth or terminal prompts (e.g., `netlify deploy`, `heroku login`, `vercel login`, `gh auth login`). Workers run in a headless environment with `stdio: ['ignore', 'pipe', 'pipe']` — they cannot open browsers or respond to interactive prompts. When the Master spawns a worker to "deploy a public link", the worker runs `netlify deploy`, which attempts OAuth via `https://app.netlify.com/authorize?response_type=ticket&ticket=...`. The process blocks indefinitely waiting for the user to click "Authorize" in a browser that never opens. The worker hangs until the 170s timeout kills it (exit code 143/SIGTERM). The user gets no response (see OB-F225). The Master then retries with the same approach, wasting another 170s. Observed in production: 2 consecutive timeout DLQs from the same Netlify OAuth attempt.
  The agent-runner's timeout mechanism (agent-runner.ts SIGTERM → 5s grace → SIGKILL) correctly kills the hung process, but only after the full timeout elapses. There is no early detection of interactive/OAuth blocking.
- **Fix:** (1) Add a "Headless Environment" section to the Master system prompt's worker guidelines: "Workers run headless — do NOT use CLI tools that require browser authentication (netlify, heroku, vercel, firebase). Use pre-authenticated tokens or API-based deployment instead. For static sites, prefer SHARE:github-pages which requires no auth." (2) Add the `auth` error category to worker failure re-delegation (master-system-prompt.ts:576-580) with guidance: "If a worker fails because it attempted interactive authentication, do not retry — suggest an alternative deployment method." (3) Consider adding output pattern detection in agent-runner.ts to detect OAuth URLs in stderr/stdout and abort early with an `auth-required` error code.
- **Implementation:** OB-1653 (add Headless Environment section), OB-1654 (add auth-required category), OB-1655 (add early OAuth detection in agent-runner). All tasks complete and merged.

### OB-F227 — Classifier maxTurns=1 causes frequent turn exhaustion and misclassification

- **Severity:** 🟠 High
- **Status:** ✅ Fixed
- **Key Files:** `src/master/classification-engine.ts:364-375`
- **Root Cause / Impact:**
  The AI classifier in classification-engine.ts (line 369) hardcodes `maxTurns: 1` with `retries: 0` for the haiku classification agent. The classifier prompt is complex — it must parse the user message, classify into categories, suggest turn budgets, provide reasoning, and estimate confidence — all as structured JSON. With only 1 turn allowed, the haiku model frequently exhausts turns before completing its JSON output (`turnsExhausted: true, status: "partial"`). Observed 4 times in a single session (06:06:29, 06:12:16, 06:15:48, and at least one more). When the classifier returns incomplete JSON, `raw.match(/\{[\s\S]*\}/)` (line 379) fails to extract valid JSON, and the system falls back to keyword heuristics with confidence=0.3 (lines 408-443). This causes misclassification: "improve our pos ui" (clearly a code-edit task) was classified as `quick-answer` via keyword fallback, which gave it only maxTurns=3 and a 120s timeout — far too little for a UI improvement task. The worker then timed out and went to DLQ silently (see OB-F225).
  The chain: classifier exhaustion → keyword fallback → wrong class → wrong turn budget → wrong timeout → timeout → DLQ → silent failure. This compounds with OB-F225 to create the worst user experience.
- **Fix:** (1) Increase `maxTurns` from 1 to 2 in classification-engine.ts:369. The haiku model is fast (~$0.0015/call) so the cost increase is negligible. (2) Alternatively, use `--print` mode (no tool use) for classification since it only needs text output, not tool calls — this avoids the turns concept entirely. (3) Add a fallback: if the first classification attempt returns `status: "partial"`, retry once with maxTurns=2 before falling back to keyword heuristics.

### OB-F228 — Exploration worker prompts exceed 128K limit (10-25% content truncated)

- **Severity:** 🟠 High
- **Status:** ✅ Fixed
- **Key Files:** `src/core/agent-runner.ts`, `src/master/exploration-coordinator.ts`, `src/master/exploration-prompts.ts`
- **Root Cause / Impact:**
  During workspace exploration Phase 1 (Structure Scan), the agent-runner logs two truncation warnings in a single exploration run: `14735 chars lost (10% of content, limit 128000)` and `43615 chars lost (25% of content, limit 128000)`. The exploration prompt combined with workspace structure data exceeds the 128K prompt limit for the default model (Sonnet). The prompt assembler truncates the excess silently — the worker receives 75-90% of its intended context. This means exploration workers may produce incomplete or inaccurate structure scans, missing files or directories that were in the truncated portion. For large workspaces (1000+ files like elgrotte-data), the structure listing alone can exceed 128K when combined with the exploration system prompt and directory metadata. The exploration uses `model: "default"` (Sonnet) which has a 128K prompt budget — but the workspace content is not budget-aware.
- **Fix:** (1) Make exploration prompts budget-aware: measure the workspace structure size before assembling the prompt and truncate the file listing (not the instructions) if it exceeds budget. (2) For large workspaces, split Phase 1 into sub-batches (similar to how Phase 3 splits directories). (3) Consider using the structure-scan prompt's built-in `limit` parameter to cap the number of files listed per directory. (4) Log at WARN level which specific content was truncated so the exploration can compensate in later phases.

### OB-F229 — "Master not ready" drops messages instead of queueing them

- **Severity:** 🟠 High
- **Status:** ✅ Fixed
- **Key Files:** `src/master/master-manager.ts`, `src/core/router.ts`
- **Root Cause / Impact:**
  When the Master is in `currentState: "processing"` (handling an existing message), incoming messages are rejected with "Cannot process message: Master not ready" and a 61-character canned response. Unlike the exploration phase (where messages are queued with "I'm still exploring..." and drained after exploration completes), the "processing" state has **no queue mechanism** — messages are permanently lost. Observed in production: two image messages (telegram-1563, telegram-1564) arrived while the Master was processing a complex task (telegram-1565). Both images were rejected immediately. The user had sent these images as context for their text request — the images contained menu/product data that the text message referenced. By dropping them, the Master processed the text request without the critical image context, producing an incomplete result.
  This is especially harmful for Telegram/WhatsApp where users commonly send multiple messages in rapid succession (images + text, or multi-part messages). The "processing" state can last 30-180+ seconds for complex tasks, during which ALL incoming messages are dropped.
- **Fix:** (1) Add a per-user message queue for messages that arrive during `processing` state, similar to the exploration pending queue. Drain them after the current message completes. (2) Alternatively, concatenate rapid-fire messages from the same user (within a short window, e.g., 5s) into a single compound message before processing. (3) At minimum, change the canned response to inform the user their message was not processed: "I'm currently working on your previous request. Please resend this message when I respond." (4) For image messages specifically, store them in `.openbridge/media/` (which already happens via image-processor) and associate them with the next text message from the same user.

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
