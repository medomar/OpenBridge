# OpenBridge — Audit Findings

> **Purpose:** Real issues, gaps, and risks discovered during code audits and real-world testing.
> **This is NOT a task list.** Tasks live in [TASKS.md](TASKS.md). Findings document _what's wrong_ and _why it matters_.
> **Open:** 11 | **Fixed:** 1 (201 prior findings archived) | **Last Audit:** 2026-03-16
> **History:** 201 findings fixed across v0.0.1–v0.1.2. All prior archived in [archive/](archive/).

---

## Open Findings

### OB-F205 — Worker prompts truncated 76–85% despite model-aware budgets (planning gate oversized)

- **Severity:** 🔴 Critical (workers operate blind — user had to retry multiple times)
- **Status:** ✅ Fixed
- **Key Files:**
  - `src/core/agent-runner.ts:44-46` — `getMaxPromptLength()` returns 128K for Opus/Sonnet, 32K for others
  - `src/core/agent-runner.ts:573-612` — `truncatePrompt()` — core truncation with logging
  - `src/master/worker-orchestrator.ts:802-811` — worker prompt assembly (reads `body.prompt` + prepends referenced files)
  - `src/master/worker-orchestrator.ts:865-879` — skill prompt injection appended after file section
- **Root Cause / Impact:**
  Phase 133 (OB-F203) raised the Master prompt budget to 128K for Opus/Sonnet 4.6, but **workers** are still being sent through `truncatePrompt()` with a 32K limit. The planning gate assembles worker prompts by concatenating the full task context + referenced files + skill prompts + RAG context, producing 137K–224K char prompts. These get truncated to 32K, losing 76–85% of the worker's instructions.

  **From today's log (2026-03-16):**

  ```
  [worker] Prompt truncated: 104315 chars lost (76% of content, limit 32768)
  [worker] Prompt truncated: 191503 chars lost (85% of content, limit 32768)
  [worker] Prompt truncated: 125787 chars lost (79% of content, limit 32768)
  ```

  The planning gate is dumping everything into worker prompts and relying on post-hoc truncation as a safety net. Workers receive the first 32K chars (mostly boilerplate context) and lose the actual task instructions at the end.

  **Impact**: Workers execute blindly. User asked "Chnoua akthar supplier nechri men 3andou" (which supplier do we buy most from) and got incomplete answers, requiring 3 retries. The supplier analysis task spawned workers that couldn't see the data query instructions.

- **Fix (2 approaches, both needed):**
  1. **`worker-orchestrator.ts:802-879`** — Pre-budget worker prompts. The planning gate must assemble worker prompts within the target model's budget BEFORE spawning. Structure: task instruction first (max 60% of budget), then referenced files (max 30%), then skill/RAG context (max 10%). Never exceed the worker model's `getMaxPromptLength()`.
  2. **`agent-runner.ts:573`** — `truncatePrompt()` should use the worker's model to determine the limit, not assume 32K. Workers spawned with `model: "sonnet"` should get 128K budget. Currently `getMaxPromptLength()` exists but `truncatePrompt()` may not be passing the worker's model through.

---

### OB-F206 — Worker timeout too low for balanced/powerful model workers (60s vs 90–130s actual)

- **Severity:** 🟠 High (tasks killed mid-execution, wasted compute)
- **Status:** Open
- **Key Files:**
  - `src/core/agent-runner.ts:890` — `SIGTERM_GRACE_PERIOD_MS = 5000`
  - `src/core/agent-runner.ts:922-952` — manual timeout handler (SIGTERM → 5s grace → SIGKILL)
  - `src/core/agent-runner.ts:1294` — effective timeout calculation: explicit timeout OR `maxTurns * SECS_PER_TURN * 1000`
  - `src/core/agent-runner.ts:1104-1128` — streaming timeout handler (same pattern)
- **Root Cause / Impact:**
  The worker timeout is 60s, but `balanced` model workers (Sonnet, GPT-4.1) average 90–104s and `read-only` workers average 120s. Three workers were killed mid-execution today:

  ```
  Worker timeout exceeded — sending SIGTERM (5s grace period)
  exitCode: 143 — Timeout: process terminated after 60000ms
  ```

  All three were image-processing or data-analysis workers using balanced/powerful models. The timeout is derived from `maxTurns * SECS_PER_TURN` but doesn't account for model speed differences. Fast models (Haiku) finish in 10–17s; balanced models need 90–130s.

  **Impact**: Workers are killed before completing, then retried (1 retry max), often failing again. The image processing tasks (bon de commande analysis) failed on first attempt due to timeout, requiring retry cycles that doubled latency and cost.

- **Fix (1 file):**
  1. **`agent-runner.ts:1294`** — Make timeout model-aware. `fast` tier: 60s default. `balanced` tier: 180s. `powerful` tier: 300s. Use the model registry's tier classification to determine the multiplier. Alternatively, increase `SECS_PER_TURN` for balanced/powerful models so the derived timeout scales with model speed.

---

### OB-F207 — RAG returns zero results for Darija/Arabizi queries (transliterated Arabic)

- **Severity:** 🟠 High (user's primary language gets no context)
- **Status:** Open
- **Key Files:**
  - `src/memory/retrieval.ts:767-772` — `sanitizeFts5Query()` strips special chars, wraps tokens in quotes
  - `src/memory/retrieval.ts:938` — `searchConversations()` sanitizes queries before FTS5 MATCH
  - `src/memory/retrieval.ts:663-671` — fallback to recent chunks when sanitized query is empty
  - `src/master/prompt-context-builder.ts:56` — `SECTION_BUDGET_RAG = 6_000`
  - `src/master/prompt-context-builder.ts:344-351` — RAG section assembly
- **Root Cause / Impact:**
  The user communicates in Tunisian Darija using Arabizi (Latin-script transliteration of Arabic). FTS5 tokenizes these as individual words but they never match workspace chunks stored in French/English:

  ```
  "Ta3tini tatal m3ahom b9adech 5demna" → confidence: 0, chunkCount: 0
  "cant telegram" → confidence: 0, chunkCount: 0
  ```

  The RAG keyword fallback (`retrieval.ts:663-671`) retries with individual keywords but Arabizi tokens like "ta3tini", "b9adech", "m3ahom" don't exist in the FTS5 index. The query falls through to the Master with zero RAG context.

  **The Master AI handles Darija fine** — the classification engine correctly identified "Data analysis query requiring supplier/product aggregation" from the Arabizi input. The problem is only in the RAG retrieval layer.

  **Impact**: Complex data queries that need workspace context (supplier data, invoice records) arrive at the Master without any RAG-retrieved context. The Master must explore from scratch every time, adding 30–60s of unnecessary worker spawning.

- **Fix (2 approaches):**
  1. **`prompt-context-builder.ts:344`** — When RAG returns 0 results AND the classifier identified the task as `tool-use` or `complex-task`, skip RAG and inject the full workspace-map summary instead (already available from `.openbridge/workspace-map.json`). This gives workers enough context without needing FTS5 matches.
  2. **`classification-engine.ts`** — After AI classification, extract the English task description from the classification reason (e.g., "supplier/product aggregation") and use THAT as the RAG query instead of the raw Arabizi input. The classifier already translates intent — reuse its output for retrieval.

---

### OB-F208 — Classification over-escalation: tool-use always escalated to complex-task (100% success feedback loop)

- **Severity:** 🟡 Medium (wastes compute/cost, not functionally broken)
- **Status:** Open
- **Key Files:**
  - `src/master/classification-engine.ts:505-550` — learning-based escalation logic
  - `src/master/classification-engine.ts:522` — success rate threshold: `learned.success_rate > 0.5`
  - `src/master/classification-engine.ts:525-531` — class remapping + maxTurns increase
- **Root Cause / Impact:**
  The classification engine escalates task classes based on historical success rates from the learnings DB. Every `tool-use` classification gets escalated to `complex-task` because the learning data shows 100% success rate for `complex-task`:

  ```
  Classification escalated based on learning data
      original: "tool-use" → escalated: "complex-task"
      successRate: 1, totalTasks: 12
  ```

  This is a **positive feedback loop**: tasks escalated to `complex-task` get more resources (maxTurns 25 vs 10, planning gate, multi-worker spawning), so they succeed → success rate stays at 100% → everything keeps getting escalated. Simple image saves that need 1 worker with 3 turns are getting the full complex-task treatment (planning gate + 2 workers + 25 maxTurns).

  **Impact**: Every task after the first few gets treated as complex-task regardless of actual complexity. Cost per simple task increases 3-5x (planning agent + extra workers). Latency increases 2-3x (planning phase adds 30s).

- **Fix (1 file):**
  1. **`classification-engine.ts:505-550`** — Add **efficiency tracking** alongside success rate. After each task completes, record `actualTurnsUsed` and `workerCount`. For escalation decisions, check: if `complex-task` tasks consistently use <5 turns and 1 worker, the escalation is wasteful — reduce the escalation threshold or add a "was escalation necessary?" metric. Only escalate when `avgTurnsUsed > 5` OR `avgWorkerCount > 1` for the escalated class.

---

### OB-F209 — "Trust all" natural language not recognized as /trust command

- **Severity:** 🟡 Medium (bad UX — user must know exact command syntax)
- **Status:** Open
- **Key Files:**
  - `src/core/router.ts:1610-1614` — `/trust` command detection: regex `/^\/trust(\s+.*)?$/i`
  - `src/core/command-handlers.ts` — `handleTrustCommand()` implementation
  - `src/master/classification-engine.ts` — keyword fallback routes "Trust all" as `quick-answer`
- **Root Cause / Impact:**
  The `/trust` command requires the literal `/trust` prefix (router.ts:1610). When the user sent "Trust all" (without slash prefix), it was routed to the Master as a regular message and classified as `quick-answer` via keyword fallback:

  ```
  content: "Trust all"
  taskClass: "quick-answer"
  reason: "keyword fallback: quick-answer (default)"
  ```

  The Master AI responded with a generic answer instead of changing the trust level. The user had to discover and use `/trust auto` explicitly. This is a common pattern — users expect natural language to work for system commands.

  **Impact**: Friction for non-technical users. The trust command is critical for enabling the AI to work autonomously (auto-approve file operations, tool use). Users who don't know the exact slash command syntax get stuck.

- **Fix (1 file):**
  1. **`router.ts:1610`** — Expand command detection to match natural language variants. Before routing to Master, check for trust-intent patterns: `/^(trust\s+(all|everything|auto)|auto[- ]?approve|approve\s+all)/i`. Route matches to `handleTrustCommand()` with mode `auto-approve-all`. Keep the existing `/trust` prefix detection as primary.

---

### OB-F210 — Self-improvement cycles are no-ops after first cycle (11 consecutive empty cycles)

- **Severity:** 🟢 Low (log noise, minor CPU waste)
- **Status:** Open
- **Key Files:**
  - `src/master/master-manager.ts:126-131` — idle thresholds: 5min initial, 2h max, 1min check interval
  - `src/master/master-manager.ts:4466-4482` — `startIdleDetection()` — periodic check setup
  - `src/master/master-manager.ts:4503-4544` — `checkIdleAndImprove()` — exponential backoff logic
  - `src/master/master-manager.ts:4537` — `runSelfImprovementCycle()` invocation
- **Root Cause / Impact:**
  The self-improvement system uses exponential backoff (5min → 10min → 20min → 40min → 80min → 2h cap) but doesn't track whether cycles actually produced changes. Today's log shows 11 self-improvement cycles across two idle periods — all but cycle 1 were no-ops:

  ```
  Checking if workspace has changed significantly
  Self-improvement cycle completed successfully    ← did nothing
  ```

  Cycle 1 created an `auto-feature` profile. Cycles 2–11 checked for workspace changes, found none, and exited. The exponential backoff helps (later cycles are less frequent) but cycles at 2h+ intervals are pointless when the workspace hasn't changed.

  **Impact**: Minor — each cycle is cheap (no agent spawn, just a workspace check). But 11 log entries of "Self-improvement cycle completed successfully" with no actual improvement is misleading and adds noise.

- **Fix (1 file):**
  1. **`master-manager.ts:4503-4544`** — Track consecutive no-op cycles with a counter. After 2 consecutive no-op cycles (no profile created, no prompt refined, no workspace change detected), stop scheduling self-improvement until the next user message arrives (reset counter in `processMessage()`). Log `"Self-improvement paused: no changes detected in 2 consecutive cycles"` at DEBUG level.

---

### OB-F211 — No workspace-scoped trust level system (all agents restricted by default, no opt-in full access)

- **Severity:** 🟠 High (blocks product vision — Cursor-for-business needs configurable autonomy)
- **Status:** Open
- **Key Files:**
  - `src/types/config.ts:306-331` — `SecurityConfigSchema` has `confirmHighRisk` (line 317) but no unified trust level
  - `src/types/config.ts:183-197` — `V2MasterSchema` has `workerCostCaps` and `workerWatchdogMinutes` but no trust level
  - `src/types/agent.ts:197-322` — `BUILT_IN_PROFILES` with 7 profiles including `master` (line 298: Read, Glob, Grep, Write, Edit — no Bash)
  - `src/types/agent.ts:330-338` — `PROFILE_RISK_MAP` (master = 'critical', full-access = 'high')
  - `src/core/agent-runner.ts:344-354` — `resolveProfile()` maps profile name → tool list (no trust override)
  - `src/core/agent-runner.ts:269-337` — tool constants (`TOOLS_READ_ONLY`, `TOOLS_FULL`, etc.)
  - `src/master/master-manager.ts:321` — `MASTER_TOOLS = BUILT_IN_PROFILES.master.tools` (hardcoded, no Bash)
  - `config.example.json` — no trust level config option
- **Root Cause / Impact:**
  OpenBridge has distributed trust/permission mechanisms — role-based auth (`owner`/`admin`/`developer`/`viewer` in `auth.ts`), profile risk levels (`PROFILE_RISK_MAP`), high-risk confirmation gates (`confirmHighRisk` in `SecurityConfigSchema`), and per-profile cost caps (`WorkerCostCapsSchema`). But there is **no unified trust level** that controls all of these together.

  A user who wants full AI autonomy must: (1) set `confirmHighRisk: false` in security config, (2) manually increase `workerCostCaps`, (3) still deal with a Master that can't run Bash, and (4) use `/allow` commands for tool escalation. There's no single "I trust the AI" switch.

  For the product vision (Cursor-for-business), enterprise customers need a **single config field** that maps to a coherent autonomy posture:
  - **Sandbox**: Read-only agents, no tool escalation, no Bash — safe for demos/onboarding
  - **Standard**: Current behavior — profile-based tools, `confirmHighRisk: true`, escalation prompts
  - **Trusted**: Full access within workspace, `confirmHighRisk: false`, auto-approve escalations, Master gets Bash

  The existing pieces (`confirmHighRisk`, `workerCostCaps`, `PROFILE_RISK_MAP`) become **derived values** from the trust level — not independent knobs.

- **Fix (multi-file, 3 parts):**
  1. **Config schema (`src/types/config.ts`)** — Add `trustLevel: z.enum(['sandbox', 'standard', 'trusted']).default('standard')` to the `SecurityConfigSchema` (alongside `confirmHighRisk`). When `trustLevel` is set, it overrides `confirmHighRisk`: sandbox forces `true`, trusted forces `false`, standard keeps the explicit value. Update `config.example.json`.
  2. **Profile resolution (`src/core/agent-runner.ts:344-354`)** — Update `resolveProfile()` to accept a trust level parameter. In `trusted` mode: all profiles resolve to `TOOLS_FULL` (line 306). In `sandbox` mode: all profiles resolve to `TOOLS_READ_ONLY` (line 269). In `standard` mode: current behavior (unchanged).
  3. **Master tools (`src/master/master-manager.ts:321`)** — Make `MASTER_TOOLS` dynamic based on trust level. `trusted` → `[...BUILT_IN_PROFILES['full-access'].tools]` (includes `Bash(*)`). `sandbox` → `['Read', 'Glob', 'Grep']` (no Write/Edit). `standard` → current value `BUILT_IN_PROFILES.master.tools`.

---

### OB-F212 — Workspace boundary enforcement incomplete for Bash commands (file operations guarded, Bash unrestricted)

- **Severity:** 🟠 High (privacy/security gap — critical when trusted mode grants Bash access)
- **Status:** Open
- **Key Files:**
  - `src/core/workspace-manager.ts:312-375` — `isFileVisible()` with symlink escape guards, path traversal detection, include/exclude patterns
  - `src/core/agent-runner.ts:395-405` — `isPathWithinWorkspace()` validates destructive operations (rm, mv) stay in bounds
  - `src/core/agent-runner.ts:407+` — destructive command pattern detection in worker stdout
  - `src/core/adapters/claude-adapter.ts:90-94` — passes `--allowedTools` but no workspace boundary flags
  - `src/master/master-system-prompt.ts` — system prompt scopes Master to `.openbridge/` folder
  - `src/types/config.ts:282-302` — `SandboxConfigSchema` (Docker/bubblewrap isolation, but mode defaults to `none`)
- **Root Cause / Impact:**
  OpenBridge already has **two layers** of workspace boundary enforcement:
  1. **File-level** (`workspace-manager.ts:312-375`): `isFileVisible()` resolves symlinks, rejects paths outside workspace, applies exclude/include patterns. This guards Read/Write/Edit operations.
  2. **Destructive command detection** (`agent-runner.ts:395-405`): `isPathWithinWorkspace()` validates that `rm`/`mv` targets stay within the workspace by parsing worker stdout.

  However, **Bash commands are not boundary-enforced**. An AI agent with `Bash(*)` can run `cat ~/.ssh/id_rsa`, `curl` data out, `cd /` and operate anywhere, or `env` to dump all environment variables. The destructive command parser only catches `rm` and `mv` patterns — not `cat`, `cp`, `curl`, `scp`, or arbitrary scripts.

  This gap is acceptable today because `full-access` workers are rare and require `confirmHighRisk` approval. But when `trustLevel: "trusted"` (OB-F211) grants `Bash(*)` to all agents by default, this becomes a **critical privacy hole** — especially for the desktop app where multiple projects must be isolated from each other.

  The existing `SandboxConfigSchema` (Docker/bubblewrap, line 282-302) provides OS-level isolation but defaults to `none` and is complex to configure. Most users won't enable it.

- **Fix (3 layers of defense, incremental):**
  1. **System prompt (soft — already exists)** — Master system prompt already scopes to `.openbridge/`. For `trusted` mode workers, inject workspace boundary instruction into worker prompts: "You may only read, write, and execute within `<workspacePath>`. Do not access files outside this directory."
  2. **Expanded stdout monitoring (`src/core/agent-runner.ts:407+`)** — Extend destructive command detection to also flag `cat`, `cp`, `scp`, `curl` commands that reference paths outside `workspacePath` (using `isPathWithinWorkspace()`). Log a warning (don't kill the worker — the AI may reference system paths legitimately for reads like `node --version`).
  3. **Sandbox auto-enable (`src/types/config.ts:282-302`)** — When `trustLevel: "trusted"`, default `sandbox.mode` to `docker` (if Docker is available) or `bubblewrap` (if Linux). This gives OS-level containment without manual configuration. Fall back to `none` with a startup warning if neither is available.
  4. **Future (desktop app)** — macOS App Sandbox or Linux namespaces at the app level. OpenBridge core provides the config plumbing; the app provides the enforcement.

---

### OB-F213 — Cost caps need trust-level-aware scaling

- **Severity:** 🟡 Medium (functional blocker when trusted mode is enabled)
- **Status:** Open
- **Key Files:**
  - `src/core/cost-manager.ts:17-22` — `PROFILE_COST_CAPS`: read-only $0.50, code-edit $1.00, code-audit $1.00, full-access $2.00
  - `src/core/cost-manager.ts:29-38` — `getProfileCostCap()` supports per-profile overrides from config
  - `src/types/config.ts:172-180` — `WorkerCostCapsSchema` (user-configurable per-profile overrides in `master.workerCostCaps`)
  - `src/types/config.ts:192-196` — V2MasterSchema documents built-in defaults
- **Root Cause / Impact:**
  Current cost caps (read-only $0.50, code-edit $1.00, full-access $2.00) are tuned for `standard` mode where workers do scoped, bounded tasks. Users can already override these via `master.workerCostCaps` in config.json, but this requires manual per-profile configuration.

  In `trusted` mode (OB-F211), all workers get `full-access` by default and may run longer, more complex tasks. The $2.00 cap for full-access is reasonable for individual tasks, but users in trusted mode expect higher autonomy and may want workers to run longer without intervention.

  In `sandbox` mode, workers should be tighter — read-only tasks shouldn't need $0.50.

  Rather than requiring users to manually set `workerCostCaps` per profile, the trust level should provide sensible defaults that the user can still override.

- **Fix (1 file):**
  1. **`src/core/cost-manager.ts:29-38`** — Update `getProfileCostCap()` to accept an optional `trustLevel` parameter. Apply a multiplier to the base cap before checking overrides: `sandbox` = 0.5x, `standard` = 1x, `trusted` = 3x. User-configured `workerCostCaps` overrides still take priority (existing behavior). This means trusted mode defaults: read-only $1.50, code-edit $3.00, full-access $6.00 — generous enough for autonomous operation while still providing a safety net.

---

### OB-F214 — CLI wizard does not ask trust level (no guided setup for new config option)

- **Severity:** 🟡 Medium (UX gap — users won't discover the feature)
- **Status:** Open
- **Key Files:**
  - `src/cli/init.ts` — CLI config generator with 13 steps (workspace, connector, whitelist, default role, MCP, visibility, etc.)
  - `src/cli/init.ts:387-413` — `promptDefaultRole()` already asks for role (owner/developer/viewer) — trust level is a related but distinct concept
  - `src/cli/init.ts:634` — default role step position in the flow
  - `config.example.json` — example config (no trust level field)
- **Root Cause / Impact:**
  The CLI wizard (`npx openbridge init`) already asks 13 questions including default role assignment (line 634). When `trustLevel` is added to the config schema (OB-F211), users won't be asked about it during setup. They'll get `standard` by default and may never discover that `trusted` or `sandbox` modes exist.

  Trust level is conceptually related to the existing role question (line 387-413) but distinct: roles control **who can send messages** (auth), while trust level controls **what agents can do** (permissions). Both should be asked during onboarding.

- **Fix (2 files):**
  1. **`src/cli/init.ts`** — Add a trust level question after the default role step (after line 634). Present three choices with clear descriptions:
     - `sandbox` — "Read-only agents — safe for demos and evaluation"
     - `standard` — "AI asks before risky actions (recommended)"
     - `trusted` — "Full AI autonomy within your workspace — no permission prompts"
       Place the result in `security.trustLevel` in the generated config.
  2. **`config.example.json`** — Add `"trustLevel": "standard"` inside the `security` block with a comment explaining the three options.

---

### OB-F215 — No startup warning for elevated trust levels

- **Severity:** 🟡 Medium (user may not realize agents have full access)
- **Status:** Open
- **Key Files:**
  - `src/index.ts:34+` — entry point startup logs
  - `src/core/bridge.ts:84` — `SecurityConfig` field available on bridge instance
  - `src/master/master-manager.ts` — Master session startup (where trust level affects behavior)
- **Root Cause / Impact:**
  When `trustLevel: "trusted"` is configured (OB-F211), all agents get full access and confirmation gates are disabled. There should be a clear, prominent warning at startup so the user knows the bridge is running in elevated mode. Without this:
  - A user might set `trusted` mode once and forget it's active
  - An admin reviewing server logs wouldn't notice the elevated permissions
  - In a team setting, one member could change the trust level without others knowing

  For `sandbox` mode, an informational notice is also useful so the user knows agents are restricted.

- **Fix (1 file):**
  1. **`src/index.ts`** — After config load (where other startup logs are emitted), check `security.trustLevel` and log:
     - `sandbox`: `logger.info('Running in SANDBOX mode — agents are read-only')`
     - `standard`: no extra log (it's the default)
     - `trusted`: `logger.warn('Running in TRUSTED mode — all agents have full access within workspace')` — use `warn` level so it stands out in production logs

---

### OB-F216 — Confirmation gates and escalation prompts not trust-level-aware

- **Severity:** 🟡 Medium (UX friction — trusted mode users get interrupted, sandbox mode users can escalate)
- **Status:** Open
- **Key Files:**
  - `src/types/config.ts:312-317` — `confirmHighRisk: z.boolean().default(true)` in SecurityConfigSchema
  - `src/core/router.ts:362-370` — `pendingEscalations` map for tracking escalation requests
  - `src/core/router.ts:690-770` — `requestSpawnConfirmation()` intercepts high/critical risk SPAWN markers
  - `src/core/router.ts:705` — checks `confirmHighRisk` from security config to decide whether to prompt
  - `src/master/worker-orchestrator.ts:633-664` — `respawnWorkerAfterGrant()` handles `/allow` tool escalation
  - `src/core/permission-relay.ts:144-250` — permission relay for Agent SDK `canUseTool` callbacks
- **Root Cause / Impact:**
  The existing `confirmHighRisk` flag (line 317) controls whether high-risk worker spawns require user confirmation. The `/allow` command enables tool escalation. The permission relay handles SDK-level tool approval. These three mechanisms operate independently.

  When `trustLevel` is implemented (OB-F211):
  - **Trusted mode**: `confirmHighRisk` should be forced `false`, `/allow` escalation prompts should be auto-approved, and permission relay should auto-grant. Currently, a user must configure all three separately.
  - **Sandbox mode**: `confirmHighRisk` should be forced `true`, `/allow` should be disabled (no tool upgrades), and permission relay should auto-deny non-read tools. Currently, nothing prevents escalation in a restricted environment.
  - **Standard mode**: Current behavior — all three mechanisms work as configured.

  The trust level should be the **single control** that derives the behavior of all three permission gates.

- **Fix (3 files):**
  1. **`src/core/router.ts:690-770`** — In `requestSpawnConfirmation()`, before checking `confirmHighRisk`, check `trustLevel`. If `trusted`: skip confirmation, auto-approve (log at debug level). If `sandbox`: auto-deny and respond "Sandbox mode — high-risk operations are not available." If `standard`: use existing `confirmHighRisk` logic.
  2. **`src/master/worker-orchestrator.ts:633-664`** — In `trusted` mode, spawn all workers with `full-access` profile from the start (no escalation needed). In `sandbox` mode, ignore `/allow` commands — respond with "Sandbox mode — tool upgrades are disabled."
  3. **`src/core/permission-relay.ts:144-250`** — In `relayPermission()`, check `trustLevel`. If `trusted`: auto-approve without relaying to user. If `sandbox`: auto-deny read/write/bash tools, only allow read tools.

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

201 findings fixed across v0.0.1–v0.1.2:
[V0](archive/v0/FINDINGS-v0.md) | [V2](archive/v2/FINDINGS-v2.md) | [V4](archive/v4/FINDINGS-v4.md) | [V5](archive/v5/FINDINGS-v5.md) | [V6](archive/v6/FINDINGS-v6.md) | [V7](archive/v7/FINDINGS-v7.md) | [V8](archive/v8/FINDINGS-v8.md) | [V15](archive/v15/FINDINGS-v15.md) | [V16](archive/v16/FINDINGS-v16.md) | [V17](archive/v17/FINDINGS-v17.md) | [V18](archive/v18/FINDINGS-v18.md) | [V19](archive/v19/FINDINGS-v19.md) | [V21](archive/v21/FINDINGS-v21.md) | [V24](archive/v24/FINDINGS-v24.md) | [V25](archive/v25/FINDINGS-v25.md) | [V26](archive/v26/FINDINGS-v26.md) | [V27](archive/v27/FINDINGS-v27.md)

---
