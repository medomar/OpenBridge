# OpenBridge — Audit Findings

> **Purpose:** Real issues, gaps, and risks discovered during code audits and real-world testing.
> **This is NOT a task list.** Tasks live in [TASKS.md](TASKS.md). Findings document _what's wrong_ and _why it matters_.
> **Open:** 0 | **Fixed:** 9 (192 prior findings archived) | **Last Audit:** 2026-03-15
> **History:** 192 findings fixed across v0.0.1–v0.1.1. All prior archived in [archive/](archive/).

---

## Open Findings

### OB-F203 — Claude model context windows and prompt budgets are outdated (Opus 4.6 = 1M, Sonnet 4.6 = 1M)

- **Severity:** 🟠 High (upgraded — directly limits Master AI capability)
- **Status:** ✅ Fixed
- **Key Files:**
  - `src/core/adapters/claude-adapter.ts:147-163` — `getPromptBudget()` returns identical `32_768` / `180_000` for all models
  - `src/core/adapters/claude-sdk.ts:161-170` — **duplicate** `getPromptBudget()` with same hardcoded values
  - `src/core/model-registry.ts:47-52` — tier mappings use short aliases (`haiku`, `sonnet`, `opus`) without context metadata
  - `src/master/session-compactor.ts:215` — `promptSizeLimit` defaults to `32_768` regardless of model
  - `src/core/agent-runner.ts:38` — `MAX_PROMPT_LENGTH = 32_768` constant used for all prompt truncation
  - `src/core/cost-manager.ts:131-147` — `estimateCostUsd()` pricing predates Opus 4.6 / Sonnet 4.6 rates
- **Root Cause / Impact:**
  OpenBridge treats **all** Claude models identically with a **212K char total budget** (`32K user + 180K system`) based on the old 200k-token context window. Opus 4.6 and Sonnet 4.6 have **1M token context windows** (~3.4M chars) — the code wastes **80% of available context**. This is the **#1 performance bottleneck**:
  1. **Truncated conversation history** — `MAX_PROMPT_LENGTH` at line 38 truncates prompts to 32K chars even when Opus 4.6 can accept 3.4M
  2. **Premature session compaction** — `SessionCompactor` triggers at `32K × 0.8 = 26K` chars when it could handle 640K+
  3. **Limited workspace maps** — large codebases are pruned before embedding into Master context
  4. **Lost RAG context** — workspace chunks are discarded to fit the artificial budget
  5. **Duplicate adapter** — `claude-sdk.ts:161-170` has identical hardcoded values and must be updated in sync

  **Verified code (claude-adapter.ts:147-163):**

  ```typescript
  getPromptBudget(model?: string) {
    const isHaiku = model != null && /haiku/i.test(model);
    const isSonnet = model != null && /sonnet/i.test(model);
    const isOpus = model != null && /opus/i.test(model);
    if (isHaiku || isSonnet || isOpus) {
      return { maxPromptChars: 32_768, maxSystemPromptChars: 180_000 }; // ← ALL SAME
    }
    return { maxPromptChars: 32_768, maxSystemPromptChars: 180_000 };   // ← DEFAULT SAME
  }
  ```

  **Official specs:**

  | Model                                          | Context Window            | Max Output  | Pricing (input/output per MTok) |
  | ---------------------------------------------- | ------------------------- | ----------- | ------------------------------- |
  | Claude Opus 4.6 (`claude-opus-4-6`)            | 1M tokens (~3.4M chars)   | 128k tokens | $5 / $25                        |
  | Claude Sonnet 4.6 (`claude-sonnet-4-6`)        | 1M tokens (~3.4M chars)   | 64k tokens  | $3 / $15                        |
  | Claude Haiku 4.5 (`claude-haiku-4-5-20251001`) | 200k tokens (~680k chars) | 64k tokens  | $1 / $5                         |

- **Fix (7 files, exact locations):**
  1. **`claude-adapter.ts:147-163`** — make `getPromptBudget()` model-aware:
     - Opus 4.6 (`/opus.*4[.-]6/i` or `claude-opus-4-6`): `maxPromptChars: 128_000`, `maxSystemPromptChars: 800_000`
     - Sonnet 4.6 (`/sonnet.*4[.-]6/i` or `claude-sonnet-4-6`): `maxPromptChars: 128_000`, `maxSystemPromptChars: 800_000`
     - Haiku 4.5 / older / unknown: keep `32_768` / `180_000`
  2. **`claude-sdk.ts:161-170`** — apply identical model-aware logic (duplicate code)
  3. **`model-registry.ts:47-52`** — add `contextTokens` and `maxOutputTokens` metadata to `ModelEntry`:
     - `opus` → `contextTokens: 1_000_000, maxOutputTokens: 128_000`
     - `sonnet` → `contextTokens: 1_000_000, maxOutputTokens: 64_000`
     - `haiku` → `contextTokens: 200_000, maxOutputTokens: 64_000`
  4. **`session-compactor.ts:215`** — replace hardcoded `32_768` default with model-aware lookup; accept `modelId` in `CompactorConfig`
  5. **`agent-runner.ts:38`** — replace `MAX_PROMPT_LENGTH = 32_768` constant with a function that accepts model name and returns appropriate limit
  6. **`cost-manager.ts:131-147`** — update `estimateCostUsd()` to use current pricing ($5/$25 Opus, $3/$15 Sonnet, $1/$5 Haiku)
  7. **`tests/core/adapters/prompt-budget.test.ts`** — update expectations to verify model-specific budgets

### OB-F200 — Seeded system prompt exceeds size cap (49K > 45K) — silently rejected

- **Severity:** 🟠 High (upgraded — Master loses evolved prompt every restart)
- **Status:** ✅ Fixed
- **Key Files:**
  - `src/memory/prompt-store.ts:7` — `MAX_PROMPT_VERSION_LENGTH = 45_000` (the cap)
  - `src/memory/prompt-store.ts:66-73` — `createPromptVersion()` silently returns on oversize (no throw, no error to caller)
  - `src/master/master-manager.ts:1868-1896` — `seedSystemPrompt()` calls `createPromptVersion()`, logs "Seeded Master system prompt" even when DB silently rejected it
  - `src/master/master-system-prompt.ts` — `generateMasterSystemPrompt()` produces ~49K+ chars output
- **Root Cause / Impact:**
  The Master system prompt generated by `generateMasterSystemPrompt()` is ~49K chars but the DB size cap in `prompt-store.ts:7` is `45_000`. The rejection flow is **silently broken**:
  1. `seedSystemPrompt()` (master-manager.ts:1868) calls `generateMasterSystemPrompt()` → produces ~49K chars
  2. Calls `memory.createPromptVersion('master-system', promptContent)` (line 1888)
  3. `createPromptVersion()` (prompt-store.ts:67) checks `content.length > 45_000` → **returns early** (line 72) — no DB insert, no error thrown
  4. Back in `seedSystemPrompt()`, the try/catch at line 1893 **never fires** because no error was thrown
  5. Line 1892 logs `"Seeded Master system prompt"` — **a lie**, the prompt was silently discarded

  **Impact**: The Master AI's **self-improvement loop is broken**. Prompt evolution output is lost every restart. The Master falls back to the default prompt, resetting all learned optimizations. The misleading success log hides this from operators.

  **Verified code (prompt-store.ts:66-73):**

  ```typescript
  export function createPromptVersion(db, name, content) {
    if (content.length > MAX_PROMPT_VERSION_LENGTH) {
      logger.warn(
        { name, size: content.length, max: MAX_PROMPT_VERSION_LENGTH },
        'Prompt version rejected: content exceeds size cap',
      );
      return; // ← SILENT EXIT: no insert, no throw, caller never knows
    }
    // ... transaction proceeds only if under cap
  }
  ```

- **Fix (4 files, exact locations):**
  1. **`prompt-store.ts:67-72`** — change silent `return` to `throw new Error(...)` so the caller knows the save failed
  2. **`master-manager.ts:1886-1896`** — add pre-flight size check before calling `createPromptVersion()`:
     - If `promptContent.length > MAX_PROMPT_VERSION_LENGTH`, fall back to file storage via `dotFolder.writeSystemPrompt()` (which has no cap)
     - Move the "Seeded" success log inside the try block after confirmed save
  3. **`master-system-prompt.ts`** — add budget-aware prompt assembly: measure total size and progressively truncate less-critical sections (examples, verbose guidance) if exceeding cap
  4. **`prompt-store.ts:7`** — consider raising cap from `45_000` to `55_000` if 49K is the legitimate baseline after all sections are populated

### OB-F202 — WebChat "New Chat" doesn't reset Master AI session — stays in same conversation

- **Severity:** 🟠 High
- **Status:** ✅ Fixed
- **Key Files:**
  - `src/connectors/webchat/webchat-connector.ts:1167` — `socketSender = 'webchat-user'` (initial per-socket sender)
  - `src/connectors/webchat/webchat-connector.ts:1324-1327` — `new-session` handler rotates `socketSender` to new UUID
  - `src/connectors/webchat/ui/js/app.js:1279-1283` — `startNewConversation()` clears UI + sends `{ type: 'new-session' }`
  - `src/master/master-manager.ts:1801-1814` — `this.masterSession` created once per Bridge, never reset per sender
  - `src/master/prompt-context-builder.ts:605-637` — `buildConversationContext()` filters by `sessionId` only, never by sender/`user_id`
  - `src/memory/conversation-store.ts:113-130` — `getSessionHistory()` SQL: `WHERE session_id = ?` (no sender filter)
  - `src/memory/retrieval.ts:930-950` — `searchConversations()` FTS5 search has no `user_id` filter
- **Root Cause / Impact:**
  The Master session is **per-Bridge, not per-sender**. When "New Chat" is clicked:
  1. UI clears local messages and sends `{ type: 'new-session' }` (app.js:1279)
  2. Backend rotates `socketSender` to `webchat-user-${randomUUID()}` (webchat-connector.ts:1325)
  3. **But** the Master's `this.masterSession.sessionId` is unchanged (master-manager.ts:1801)
  4. Next message is stored as `(session_id: master-uuid-1, user_id: webchat-user-{new-uuid})`
  5. `getSessionHistory(master-uuid-1)` at conversation-store.ts:113 returns **ALL messages** from ALL "chats" — filters only by `session_id`, ignores `user_id`
  6. `buildConversationContext()` at prompt-context-builder.ts:605 passes the **same sessionId** regardless of sender

  **Result**: The UI shows a fresh chat but the Master AI still has full conversation history from the previous "chat". The `user_id` column **is stored in the DB** but **never used to filter** retrieval.

- **Fix (recommended approach: per-sender context filtering):**
  1. **`prompt-context-builder.ts:605`** — add `sender?: string` parameter to `buildConversationContext()`. When provided, filter conversation history by matching `user_id`
  2. **`conversation-store.ts:113-130`** — add `getSessionHistoryForSender(sessionId, sender, limit)` that adds `AND user_id = ?` to the SQL WHERE clause
  3. **`webchat-connector.ts:1324-1327`** — pass `socketSender` through the message pipeline so `buildConversationContext()` receives it
  4. **`retrieval.ts:930-950`** — add optional `userId` filter to `searchConversations()` for cross-session search isolation

### OB-F182 — Workers cannot execute destructive file operations (rm, rmdir) — permission prompts unreachable

- **Severity:** 🟡 Medium
- **Status:** ✅ Fixed
- **Key Files:**
  - `src/core/agent-runner.ts:282-291` — `TOOLS_CODE_EDIT` lacks `Bash(rm:*)`, `Bash(mv:*)`, `Bash(cp:*)`, `Bash(mkdir:*)`
  - `src/core/agent-runner.ts:297-309` — `TOOLS_FILE_MANAGEMENT` **already exists** with `rm`, `mv`, `cp`, `mkdir`, `chmod`
  - `src/core/agent-runner.ts:360-362` — `resolveProfile('file-management')` returns `TOOLS_FILE_MANAGEMENT` (wired up)
  - `src/core/agent-runner.ts:892,1083` — `stdio: ['ignore', 'pipe', 'pipe']` blocks interactive permission prompts
  - `src/types/agent.ts:230-309` — `BUILT_IN_PROFILES` Zod schema mirrors `agent-runner.ts` tool lists
  - `src/master/worker-orchestrator.ts:758-914` — worker profile assignment logic (doesn't auto-escalate to `file-management`)
- **Root Cause / Impact:**
  Two distinct problems:

  **Problem 1 — `code-edit` profile gap (agent-runner.ts:282-291):**

  ```typescript
  export const TOOLS_CODE_EDIT = [
    'Read',
    'Edit',
    'Write',
    'Glob',
    'Grep',
    'Bash(git:*)',
    'Bash(npm:*)',
    'Bash(npx:*)', // ← No rm, mv, cp, mkdir
  ] as const;
  ```

  The `file-management` profile **already exists** at line 297 with `Bash(rm:*)`, `Bash(mv:*)`, `Bash(cp:*)`, `Bash(mkdir:*)`, `Bash(chmod:*)`, `Bash(git:*)`. It's registered in `resolveProfile()` at line 362. **But the Master AI never selects it** — the worker-orchestrator doesn't auto-escalate from `code-edit` to `file-management` when file operations are needed.

  **Problem 2 — stdin isolation (agent-runner.ts:892,1083):**
  Workers run with `stdio: ['ignore', 'pipe', 'pipe']`. Even with `full-access` (`Bash(*)`), if Claude CLI encounters a tool not pre-approved, the interactive permission prompt is lost. The worker hangs or exits.

- **Fix (3 files):**
  1. **`worker-orchestrator.ts`** — add auto-escalation logic: when the spawn marker prompt contains file operation keywords (`delete`, `remove`, `rename`, `move`, `copy`, `mkdir`), escalate profile from `code-edit` → `file-management`
  2. **`agent-runner.ts:282-291`** — add `Bash(rm:*)`, `Bash(mv:*)`, `Bash(cp:*)`, `Bash(mkdir:*)` to `TOOLS_CODE_EDIT` (practical fix — code editing commonly involves file management)
  3. **`types/agent.ts:260`** — update `BUILT_IN_PROFILES` Zod schema to match updated `TOOLS_CODE_EDIT`
  4. **Master system prompt** — add `file-management` profile to worker profile documentation so Master knows to select it for file ops

### OB-F204 — Codex/Aider model context windows are outdated (GPT-5.2-Codex = 400K, GPT-5.3-Codex = 400K)

- **Severity:** 🟡 Medium
- **Status:** ✅ Fixed
- **Key Files:**
  - `src/core/adapters/codex-adapter.ts:380-397` — `getPromptBudget()` returns `100_000` combined; comment claims "~128K token context" (outdated)
  - `src/core/adapters/aider-adapter.ts:123-138` — `getPromptBudget()` returns `100_000` combined; comment references GPT-3.5 16K (outdated)
  - `src/core/model-registry.ts:53-65` — Codex: all tiers pinned to `gpt-5.2-codex`; Aider: `gpt-4o-mini` / `gpt-4o` / `o1`
- **Root Cause / Impact:**
  **Codex adapter (codex-adapter.ts:388-395):**

  ```typescript
  // Comment: "gpt-5.2-codex (default): estimated ~128K token context window (~512K chars)"
  // Actual: GPT-5.2-Codex has 400K tokens (~1.6M chars)
  const combined = 100_000; // ← Wastes 93% of available context
  ```

  **Aider adapter (aider-adapter.ts:130-136):**

  ```typescript
  // Comment: "100K chars (~25K tokens at ~4 chars/token) — safe for... GPT-3.5 has 16K"
  // Actual: Modern models (GPT-4.1, o3, o4-mini) have 200K-1M context
  const combined = 100_000; // ← Same conservative budget for all models
  ```

  **Model registry (model-registry.ts:53-65):**
  - Codex: all 3 tiers map to `gpt-5.2-codex` (GPT-5.3-Codex now available, 25% faster, same price)
  - Aider: maps to `gpt-4o-mini` / `gpt-4o` / `o1` (all outdated; current: GPT-4.1, o3, o4-mini)

- **Fix (3 files):**
  1. **`codex-adapter.ts:395`** — increase `combined` from `100_000` to `400_000` chars; update comment to "400K token context window (~1.6M chars)"
  2. **`aider-adapter.ts:136`** — accept `model` param and return model-specific budgets; update comments to reference current models
  3. **`model-registry.ts:53-65`** — update Codex `powerful` tier to `gpt-5.3-codex`; update Aider tiers: keep `gpt-4o-mini` (fast), `gpt-4o` → `gpt-4.1` (balanced), `o1` → `o3` (powerful)

### OB-F179 — Master AI lacks web deployment skill pack (Vercel, Netlify, Cloudflare Pages)

- **Severity:** 🟡 Medium
- **Status:** ✅ Fixed (already implemented — `src/master/skill-packs/web-deploy.ts` exists + registered in `skill-pack-loader.ts` with keywords)
- **Key Files:**
  - `src/master/skill-pack-loader.ts` — skill pack discovery + `selectSkillPackForTask()` keyword matching
  - `src/master/master-system-prompt.ts` — `formatSkillPacksSection()` injects pack list into Master prompt
  - `src/core/github-publisher.ts` — existing GitHub Pages publisher (single-file only, no directory support)
  - `src/master/skill-packs/` — **directory does not exist yet** (needs creation)
- **Root Cause / Impact:**
  When a user asks "deploy this to Vercel" or "put this live", the Master AI has no domain-specific guidance for web deployment. The existing `github-publisher.ts` only publishes **individual files** to a `gh-pages` branch — no Vercel, Netlify, or Cloudflare Pages support. No `src/master/skill-packs/` directory exists; skill packs are currently defined inline in `skill-pack-loader.ts` or as `DocumentSkill` types.
- **Fix:**
  1. Create `src/master/skill-packs/web-deploy.ts` implementing `SkillPack` interface:
     - Profile: `full-access`
     - Required tools: `['Bash(npx:*)', 'Bash(vercel:*)', 'Bash(netlify:*)', 'Bash(wrangler:*)']`
     - Keywords: `deploy`, `vercel`, `netlify`, `cloudflare`, `wrangler`, `go live`, `publish site`
     - `systemPromptExtension`: CLI detection, auth token handling, framework vs static detection, live URL return format
  2. Register in skill pack loader's built-in packs array
  3. Add keyword entries to `SKILL_PACK_KEYWORDS` in `skill-pack-loader.ts`
  4. Consider integrating `github-publisher.ts` as fallback when no deploy CLI is available

### OB-F180 — Master AI lacks spreadsheet read/write skill pack (Excel, CSV, Google Sheets)

- **Severity:** 🟡 Medium
- **Status:** ✅ Fixed (already implemented — `src/master/skill-packs/spreadsheet-handler.ts` exists + registered in `skill-pack-loader.ts` with keywords)
- **Key Files:**
  - `src/master/skill-pack-loader.ts` — skill pack loading + keyword matching
  - `src/master/skill-packs/` — **directory does not exist yet**
  - Existing `spreadsheet-builder` DocumentSkill (if present) — only generates new XLSX, cannot read/modify
- **Root Cause / Impact:**
  The Master AI cannot read existing spreadsheet contents or modify cells in-place. When users ask "read this Excel file" or "update column B", the AI lacks domain-specific instructions for spreadsheet I/O. Any existing spreadsheet skill only handles **generation** of new files, not reading or modifying existing ones.
- **Fix:**
  1. Create `src/master/skill-packs/spreadsheet-handler.ts` implementing `SkillPack` interface:
     - Profile: `full-access`
     - Required tools: `['Bash(node:*)', 'Bash(npm:*)', 'Bash(npx:*)']`
     - Keywords: `spreadsheet`, `excel`, `xlsx`, `csv`, `read spreadsheet`, `modify`, `pivot`, `aggregate`
     - `systemPromptExtension`: ExcelJS for .xlsx read/write, SheetJS for legacy .xls, CSV parsing, modify-in-place patterns, Google Sheets via MCP, output conventions
  2. Register in skill pack loader's built-in packs array
  3. Add keyword entries to `SKILL_PACK_KEYWORDS`

### OB-F201 — Missing state files warn "expected on first run" on every restart (Nth run)

- **Severity:** 🟢 Low
- **Status:** ✅ Fixed
- **Key Files:**
  - `src/master/dotfolder-manager.ts:1131-1155` — `batch-state.json` read with `batchStateWarned` instance flag
  - `src/master/dotfolder-manager.ts:1796-1820` — `manifest.json` read with `promptManifestWarned` instance flag
  - `src/master/dotfolder-manager.ts:1574-1598` — `learnings.json` read with `learningsWarned` instance flag
  - `src/master/dotfolder-manager.ts:59-62` — per-instance warning flags: `learningsWarned`, `batchStateWarned`, `promptManifestWarned`
- **Root Cause / Impact:**
  All three files use the same pattern:

  ```typescript
  if (!this.learningsWarned) {
    this.learningsWarned = true;
    logger.warn({ path }, 'learnings.json not found — expected on first run');
  }
  ```

  The `learningsWarned`, `batchStateWarned`, `promptManifestWarned` flags are **per-instance** (DotFolderManager class fields at lines 59-62). A new instance is created on each Bridge restart, resetting all flags. The files **do get written** during sessions (verified: `writeBatchState()`, `writePromptManifest()`, `writeLearnings()` all persist to `.openbridge/`), but on subsequent restarts the warning fires again because the instance flag reset.

  **Impact**: Log noise — misleading WARN messages on every restart create false concern for operators. Not a functional bug.

- **Fix (1 file):**
  1. **`dotfolder-manager.ts:59-62`** — delete the per-instance warning flags entirely
  2. **`dotfolder-manager.ts:1138-1140, 1581-1583, 1803-1805`** — change `logger.warn(...)` to `logger.debug(...)` and remove the "expected on first run" text. The `fs.access()` guard already handles missing files cleanly; no need for special warning logic.

### OB-F199 — master-system.md ENOENT logged twice on startup with full stack trace

- **Severity:** 🟢 Low
- **Status:** ✅ Fixed
- **Key Files:**
  - `src/master/dotfolder-manager.ts:507-514` — `readSystemPrompt()` does `fs.readFile()` directly with no `fs.access()` guard
  - `src/master/master-manager.ts:1853` — `seedSystemPrompt()` calls `readSystemPrompt()` (first ENOENT)
  - `src/master/master-manager.ts:1733` — `initMasterSession()` calls `readSystemPrompt()` (second ENOENT)
- **Root Cause / Impact:**
  Unlike `readWorkspaceMap()` (lines 92-120) and `readLearnings()` (lines 574-598) which guard with `fs.access()` before `fs.readFile()`, `readSystemPrompt()` jumps straight to `fs.readFile()`:

  ```typescript
  // dotfolder-manager.ts:507-514
  public async readSystemPrompt(): Promise<string | null> {
    try {
      return await fs.readFile(this.getSystemPromptPath(), 'utf-8');
    } catch (err) {
      logger.warn({ err, path: ... }, 'Failed to read master-system.md');  // ← Full stack trace
      return null;
    }
  }
  ```

  Called twice on startup (from `seedSystemPrompt` then `initMasterSession`), producing two WARN logs with full ENOENT stack traces. After `seedSystemPrompt()` creates the file, the second call succeeds — but the first call always fails on fresh workspaces.

  **Impact**: Log noise — two scary-looking WARN entries with stack traces on every fresh workspace startup. Not a functional bug (the file is created by `seedSystemPrompt` before the second read).

- **Fix (1 file):**
  1. **`dotfolder-manager.ts:507-514`** — add `fs.access()` guard before `fs.readFile()`, matching the pattern already used by `readWorkspaceMap()` and `readLearnings()`:
     ```typescript
     public async readSystemPrompt(): Promise<string | null> {
       const path = this.getSystemPromptPath();
       try { await fs.access(path); } catch { return null; }
       try { return await fs.readFile(path, 'utf-8'); }
       catch (err) { logger.warn({ err, path }, 'Failed to read master-system.md'); return null; }
     }
     ```

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

192 findings fixed across v0.0.1–v0.1.1:
[V0](archive/v0/FINDINGS-v0.md) | [V2](archive/v2/FINDINGS-v2.md) | [V4](archive/v4/FINDINGS-v4.md) | [V5](archive/v5/FINDINGS-v5.md) | [V6](archive/v6/FINDINGS-v6.md) | [V7](archive/v7/FINDINGS-v7.md) | [V8](archive/v8/FINDINGS-v8.md) | [V15](archive/v15/FINDINGS-v15.md) | [V16](archive/v16/FINDINGS-v16.md) | [V17](archive/v17/FINDINGS-v17.md) | [V18](archive/v18/FINDINGS-v18.md) | [V19](archive/v19/FINDINGS-v19.md) | [V21](archive/v21/FINDINGS-v21.md) | [V24](archive/v24/FINDINGS-v24.md) | [V25](archive/v25/FINDINGS-v25.md) | [V26](archive/v26/FINDINGS-v26.md)

---
