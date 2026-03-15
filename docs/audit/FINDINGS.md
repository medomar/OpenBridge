# OpenBridge — Audit Findings

> **Purpose:** Real issues, gaps, and risks discovered during code audits and real-world testing.
> **This is NOT a task list.** Tasks live in [TASKS.md](TASKS.md). Findings document _what's wrong_ and _why it matters_.
> **Open:** 6 | **Fixed:** 6 (183 prior findings archived) | **Last Audit:** 2026-03-15
> **History:** 183 findings fixed across v0.0.1–v0.1.0. All prior archived in [archive/](archive/).

---

## Open Findings

### OB-F179 — Master AI lacks web deployment skill pack (Vercel, Netlify, Cloudflare Pages)

- **Severity:** 🟡 Medium
- **Status:** Open
- **Key Files:** `src/master/skill-packs/`, `src/master/master-system-prompt.ts`, `src/core/github-publisher.ts`
- **Root Cause / Impact:**
  When a user asks "build a website and deploy it" or "put this live on Vercel", the Master AI has no skill pack for real server deployment. GitHub Pages publishing exists but is limited to static HTML. Users expect the AI to deploy to modern platforms (Vercel, Netlify, Cloudflare Pages) and return a live URL.
- **Fix:** Create a `web-deploy` built-in skill pack that teaches Master AI to:
  1. Use `npx vercel --yes`, `npx netlify deploy --prod`, or `npx wrangler pages deploy` via `full-access` workers
  2. Detect which deploy CLIs are available on the machine (extend AI Discovery or check in worker prompt)
  3. Return the live URL to the user in the response
  4. Handle auth tokens via environment variables (VERCEL_TOKEN, NETLIFY_AUTH_TOKEN, etc.)
  5. Support both static sites and framework apps (Next.js, Vite, etc.)

### OB-F180 — Master AI lacks spreadsheet read/write skill pack (Excel, CSV, Google Sheets)

- **Severity:** 🟡 Medium
- **Status:** Open
- **Key Files:** `src/master/skill-packs/spreadsheet-builder.ts`, `src/master/skill-pack-loader.ts`
- **Root Cause / Impact:**
  The existing `spreadsheet-builder` skill only generates new XLSX files. When a user asks "read this Excel file and summarize the data" or "update column B in my spreadsheet", the Master AI cannot read existing spreadsheet contents or modify cells in-place. This is a common business user request, especially for non-code workspaces.
- **Fix:** Create a `spreadsheet-handler` built-in skill pack (or extend `spreadsheet-builder`) that teaches Master AI to:
  1. Read existing `.xlsx`, `.xls`, `.csv` files using Node.js packages (`exceljs` or `xlsx`/SheetJS) or Python (`openpyxl`, `pandas`) via `full-access` workers
  2. Extract cell data, sheet names, formulas, and formatting
  3. Modify existing cells, add rows/columns, apply formulas
  4. Write back to the same file or create a new output file
  5. Handle Google Sheets via MCP server if configured
  6. Support common operations: filter, sort, pivot, aggregate, chart data extraction

### OB-F182 — Workers cannot execute destructive file operations (rm, rmdir) — permission prompts unreachable

- **Severity:** 🟡 Medium
- **Status:** Open
- **Key Files:** `src/core/agent-runner.ts`, `src/master/worker-orchestrator.ts`
- **Root Cause / Impact:**
  When a user asks Master AI to delete files or directories (e.g., `rm -rf` a folder), the Master spawns a worker with a tool profile (`code-edit` or `full-access`). Two problems prevent this from working:
  1. **`code-edit` profile lacks `rm`**: The `TOOLS_CODE_EDIT` list only includes `Bash(git:*)`, `Bash(npm:*)`, `Bash(npx:*)` — no `Bash(rm:*)` or `Bash(mv:*)`. The worker's Claude CLI process is restricted and cannot run `rm`.
  2. **`stdin: 'ignore'` blocks permission prompts**: Even with `full-access` profile (`Bash(*)`), if Claude CLI encounters a tool not pre-approved by `--allowedTools`, it prompts for interactive permission on stdin. Since workers run with `stdio: ['ignore', 'pipe', 'pipe']`, the permission prompt never reaches the messaging user.
- **Fix:** Several options (pick one or combine):
  1. Add `Bash(rm:*)` and `Bash(mv:*)` to `TOOLS_CODE_EDIT`
  2. Create a `file-management` tool profile
  3. Implement permission relay via Agent SDK `canUseTool` callback
  4. Auto-approve within workspace for operations scoped to `workspacePath`

### OB-F185 — No DocType engine — OpenBridge cannot create or manage structured business data

- **Severity:** 🔴 Critical
- **Status:** Open
- **Key Files:** `src/memory/database.ts`, `src/master/master-system-prompt.ts`, `src/master/classification-engine.ts`
- **Root Cause / Impact:**
  When a user says "I need to track my invoices" or "create a customer record", OpenBridge has no mechanism to create structured business entities. There is no dynamic schema system, no auto-numbering, no state machine for document lifecycle (draft → sent → paid), no computed fields, and no auto-generated REST API or web forms.
- **Fix:** Create a DocType engine (`src/intelligence/`) inspired by Frappe DocType + Twenty CRM + Odoo. Schema & storage (Phase 117) and lifecycle & hooks (Phase 118) are implemented. Remaining: production hardening, edge cases, additional hook types.

### OB-F186 — No integration hub — OpenBridge cannot connect to external business services (Stripe, Google Drive, databases)

- **Severity:** 🟠 High
- **Status:** Open
- **Key Files:** `src/core/file-server.ts`, `src/core/email-sender.ts`, `src/master/master-system-prompt.ts`
- **Root Cause / Impact:**
  Business users need to connect Stripe for payments, Google Drive for file storage, their own databases, and arbitrary REST APIs. Core framework (Phase 119) is implemented. Remaining: additional adapters (Phase 120).

### OB-F192 — Exploration prompt truncated by 66% (97K chars → 32K limit)

- **Severity:** 🟡 Medium
- **Status:** ✅ Fixed
- **Key Files:** `src/core/agent-runner.ts`, `src/master/exploration-prompts.ts`, `src/master/exploration-coordinator.ts`
- **Root Cause / Impact:**
  On every startup with workspace changes, the exploration prompt is 97K chars but the `maxLength` limit in AgentRunner is 32K, causing 66% of content to be silently truncated. The Master's initial exploration works with only ~34% of the context it needs.
- **Fix:** Several options:
  1. Reduce exploration prompt size — break into smaller, focused prompts per scope instead of one monolithic prompt
  2. Increase `maxLength` limit in AgentRunner for exploration-class prompts
  3. Use progressive disclosure — send workspace summary first, then dive into changed areas only

### OB-F193 — .openbridge state files not persisting between restarts (batch-state, manifest, learnings)

- **Severity:** 🟢 Low
- **Status:** ✅ Fixed
- **Key Files:** `src/master/dotfolder-manager.ts`, `src/master/batch-manager.ts`, `src/master/seed-prompts.ts`
- **Root Cause / Impact:**
  On every startup, `batch-state.json`, `prompts/manifest.json`, and `learnings.json` fail to read (ENOENT) and are recreated from scratch. While the code handles this gracefully (first-run behavior), these files should persist between restarts once created.
- **Fix:**
  1. Verify that the write path matches the read path for each file
  2. Check if any cleanup/eviction process is deleting these files
  3. Ensure `mkdir -p` is called before writes to guarantee parent directories exist
  4. Add startup diagnostic logging: "File exists: true/false" instead of failing silently

### OB-F194 — workspace-map.json never created after exploration — ENOENT on every message

- **Severity:** 🟠 High
- **Status:** ✅ Fixed
- **Key Files:** `src/master/dotfolder-manager.ts:90`, `src/master/master-manager.ts:3311`, `src/master/master-manager.ts:3328`, `src/core/knowledge-retriever.ts:667`
- **Root Cause / Impact:**
  Exploration completes all 5 phases successfully (structure, classification, directory dives, assembly, finalization) but `workspace-map.json` is never written to `.openbridge/`. The `readWorkspaceMap()` call in `dotfolder-manager.ts:90` throws ENOENT on **every single message** — logged as WARN each time (15+ times in a single session). This adds noise to logs and means the Master AI never has the workspace map context it needs for routing decisions.
- **Fix:**
  1. In `exploration-coordinator.ts` assembly phase: verify `workspace-map.json` is actually written after assembly completes
  2. In `dotfolder-manager.ts`: check file existence before `readFile()` — return `null` silently if missing, log WARN only once per session
  3. Add a post-exploration assertion that validates all expected output files exist

### OB-F195 — Codex workers lack per-worker cost cap — single worker can cost $0.28 (28x normal)

- **Severity:** 🟡 Medium
- **Status:** Open
- **Key Files:** `src/core/agent-runner.ts`, `src/core/cost-manager.ts`, `src/master/worker-orchestrator.ts`
- **Root Cause / Impact:**
  A single Codex worker (`gpt-5.2-codex`, `read-only` profile, 10 max turns) consumed $0.28 — 28x the cost of a typical Claude worker ($0.01). The worker exhausted all 10 turns without completing (`turnsExhausted: true`). No per-worker cost cap exists, so the Master has no way to stop a runaway worker before it burns the budget. Total session cost was $0.17 but a single Codex worker nearly doubled it.
- **Fix:**
  1. Add a `maxCostUsd` parameter to worker spawn options (default: $0.05 for read-only, $0.10 for full-access)
  2. In `agent-runner.ts` streaming path: monitor cumulative cost and kill the process if it exceeds the cap
  3. Report cost-capped workers back to Master so it can retry with a cheaper model or narrower prompt

### OB-F196 — Stale "running" agent_activity records for completed Codex workers

- **Severity:** 🟡 Medium
- **Status:** ✅ Fixed
- **Key Files:** `src/memory/activity-store.ts`, `src/master/worker-orchestrator.ts`, `src/core/agent-runner.ts`
- **Root Cause / Impact:**
  Two Codex workers (`worker-1773513675012-dmq8c5` and `worker-1773513675012-ziljhs`) completed successfully (exit code 0, costs logged) but their `agent_activity` records still show `status=running` with no `completed_at` timestamp. The completion callback is not updating the DB for Codex streaming workers. This corrupts worker stats, makes `/stats` and worker batch reporting inaccurate, and could cause the worker concurrency limiter to think slots are occupied when they're not.
- **Fix:**
  1. In `worker-orchestrator.ts`: ensure the `finally` block that calls `activityStore.update(workerId, { status: 'done' })` runs for streaming agents (Codex path) — not just the non-streaming Claude path
  2. Add a startup sweep: on bridge start, mark any `running` agents older than 10 minutes as `abandoned`
  3. Add a test: spawn a Codex streaming worker, wait for completion, assert `status=done` in DB

### OB-F197 — Prompt truncation at 84% — Master context destroyed for large conversation sessions

- **Severity:** 🟠 High
- **Status:** ✅ Fixed
- **Key Files:** `src/core/agent-runner.ts`, `src/master/prompt-context-builder.ts`
- **Root Cause / Impact:**
  At `18:13:49`, a Master prompt was built at 202K chars but the `maxLength` limit is 32K, causing **84% of content to be silently truncated** (169K chars lost). This is worse than OB-F192 (66% truncation for exploration prompts) — this affects regular message processing. The Master loses conversation history, workspace context, and RAG results, leading to degraded response quality. Occurs when conversation history grows large (40+ turns before compaction kicks in).
- **Fix:**
  1. In `prompt-context-builder.ts`: implement budget-aware assembly — allocate token budgets per section (system prompt, memory.md, RAG results, conversation history) and trim each section to fit within budget _before_ concatenation
  2. Trigger session compaction earlier — the 40-turn threshold is too late if prompts already exceed 200K chars
  3. Add a prompt-size metric: log prompt size vs. limit ratio so truncation trends are visible

### OB-F198 — Classification engine falls back to "keyword fallback: tool-use (default)" for conversational messages

- **Severity:** 🟢 Low
- **Status:** ✅ Fixed
- **Key Files:** `src/master/classification-engine.ts`, `src/core/agent-runner.ts`
- **Root Cause / Impact:**
  Messages like _"I want to get trained to the data..."_ and _"Not yet i wanna know if..."_ are classified as `tool-use` with 15 max turns via `"keyword fallback: tool-use (default)"`. These are conversational/planning messages that should be `quick-answer` (3–5 turns). The fallback wastes turns and cost on messages that don't need file access. Also, _"normally know about the sub-companies..."_ was classified as `complex-task` via `"keyword match: batch-mode"` — likely a false positive on the word "batch" or "command" in the voice transcription.
- **Fix:**
  1. Add a conversational/planning intent to the classifier — messages asking about configuration, workflow, or clarification should default to `quick-answer`, not `tool-use`
  2. Tighten keyword matching: require keyword + context (e.g., "batch" alone shouldn't trigger `batch-mode` — needs "batch process" or "run batch")
  3. When the AI classifier returns a result, prefer it over keyword fallback even if confidence is moderate

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

183 findings fixed across v0.0.1–v0.1.0:
[V0](archive/v0/FINDINGS-v0.md) | [V2](archive/v2/FINDINGS-v2.md) | [V4](archive/v4/FINDINGS-v4.md) | [V5](archive/v5/FINDINGS-v5.md) | [V6](archive/v6/FINDINGS-v6.md) | [V7](archive/v7/FINDINGS-v7.md) | [V8](archive/v8/FINDINGS-v8.md) | [V15](archive/v15/FINDINGS-v15.md) | [V16](archive/v16/FINDINGS-v16.md) | [V17](archive/v17/FINDINGS-v17.md) | [V18](archive/v18/FINDINGS-v18.md) | [V19](archive/v19/FINDINGS-v19.md) | [V21](archive/v21/FINDINGS-v21.md) | [V24](archive/v24/FINDINGS-v24.md) | [V25](archive/v25/FINDINGS-v25.md)

---
