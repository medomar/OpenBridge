# OpenBridge — Audit Findings

> **Purpose:** Real issues, gaps, and risks discovered during code audits and real-world testing.
> **This is NOT a task list.** Tasks live in [TASKS.md](TASKS.md). Findings document _what's wrong_ and _why it matters_.
> **Open:** 3 (0 critical, 0 medium, 3 low) | **Fixed:** 30 | **Last Audit:** 2026-02-27
> **Resolved findings:** [V0 archive](archive/v0/FINDINGS-v0.md) | [V2 archive](archive/v2/FINDINGS-v2.md) | [V4 archive](archive/v4/FINDINGS-v4.md) | [V5 archive](archive/v5/FINDINGS-v5.md)

---

## Priority Order

| #   | Finding | Severity | Impact                                            | Why this order                                                                                                    |
| --- | ------- | -------- | ------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| 1   | OB-F32  | ✅ Fixed | 39 test failures + 20 TS errors + 264 lint errors | Implemented 7 prompt library methods on `DotFolderManager`.                                                       |
| 2   | OB-F33  | ✅ Fixed | 20 TypeScript errors                              | Auto-resolved by OB-F32 fix + corrected `PromptRecord`→`PromptTemplate` type in master-manager.                   |
| 3   | OB-F27  | ✅ Fixed | 8 test failures                                   | Restored JSONL flat-file output in `AuditLogger` alongside SQLite sink.                                           |
| 4   | OB-F34  | ✅ Fixed | 264 lint errors                                   | Auto-resolved by OB-F32 fix.                                                                                      |
| 5   | OB-F29  | ✅ Fixed | Core UX gap                                       | memory.md pattern implemented: read/write, context injection, session-end update, FTS5 fallback, eviction, tests. |
| 6   | OB-F35  | ✅ Fixed | Missing feature                                   | Full conversation history feature shipped: listSessions, searchSessions, /history command, REST endpoints, tests. |
| 7   | OB-F28  | ✅ Fixed | Technical debt                                    | schema_versions table added, migrations numbered + transactional, idempotency tests added.                        |
| 8   | OB-F30  | 🟢 Low   | Polish                                            | Workers show no progress — users wait blind. Nice-to-have.                                                        |
| 9   | OB-F31  | 🟢 Low   | Polish                                            | Master can't pause/resume — edge case for power users.                                                            |

---

## Open Findings

### #1 — OB-F32 — Prompt library methods missing from DotFolderManager (39 test failures)

**Discovered:** 2026-02-26 (code audit), **Updated:** 2026-02-27 (fixed)
**Component:** `src/master/dotfolder-manager.ts`
**Severity:** ✅ Fixed
**Backlog:** OB-836
**Test failures:** 39 across 3 files (`prompt-library.test.ts`, `prompt-effectiveness.test.ts`, `prompt-degradation.test.ts`)
**Blocks:** OB-F33 (TypeScript errors), OB-F34 (ESLint errors)

**Problem:** Seven prompt library methods are referenced by tests and by `master-manager.ts` (line 4535, 4580) but **do not exist** on `DotFolderManager`: `readPromptManifest()`, `writePromptManifest()`, `writePromptTemplate()`, `getPromptTemplate()`, `recordPromptUsage()`, `getLowPerformingPrompts()`, `resetPromptStats()`. The types (`PromptManifest`, `PromptTemplate`) are fully defined in `src/types/master.ts` with Zod schemas. The manifest file path is `.openbridge/prompts/manifest.json`. `MasterManager.rollbackDegradedPrompts()` calls `this.dotFolder.readPromptManifest()` and `this.dotFolder.writePromptManifest()` — causing 20 TypeScript compilation errors and 264 ESLint errors.

**Recommended fix:** Implement all 7 methods on `DotFolderManager` using the `PromptManifestSchema` and `PromptTemplateSchema` Zod schemas from `src/types/master.ts`. Methods should read/write `.openbridge/prompts/manifest.json` and individual `.md` files in `.openbridge/prompts/`. `recordPromptUsage(id, success)` should increment `usageCount`/`successCount` and recalculate `successRate`. `resetPromptStats(id)` should preserve `previousSuccessRate`. This is the JSON fallback path for when SQLite memory is unavailable — `master-manager.ts` already has the `if (this.memory) { ... } else { this.dotFolder.* }` branching.

---

### #2 — OB-F33 — TypeScript compilation errors in master-manager.ts (20 errors)

**Discovered:** 2026-02-26 (typecheck validation), **Updated:** 2026-02-27 (fixed)
**Component:** `src/master/master-manager.ts` (lines 4538–4585)
**Severity:** ✅ Fixed
**Backlog:** OB-990
**Blocked by:** OB-F32

**Problem:** `rollbackDegradedPrompts()` iterates `Object.values(manifest.prompts)` but TypeScript infers each value as `unknown` because `readPromptManifest()` doesn't exist on `DotFolderManager` (see OB-F32). This cascades into 20 TS18046 errors ("'prompt' is of type 'unknown'") and 1 TS2339 error ("Property 'writePromptManifest' does not exist on type 'DotFolderManager'"). The `typecheck` command fails, meaning CI would also fail.

**Recommended fix:** Implementing OB-F32 (adding the methods to `DotFolderManager`) will resolve all 20 errors. No independent action needed.

---

### #3 — OB-F27 — Audit logger missing JSONL flat-file output (8 test failures)

**Discovered:** 2026-02-26 (health score audit), **Updated:** 2026-02-27 (fixed)
**Component:** `src/core/audit-logger.ts`
**Severity:** ✅ Fixed
**Backlog:** OB-820 | **Health Impact:** +0.05
**Test failures:** 8 in `tests/core/audit-logger.test.ts`

**Problem:** The `AuditLogger` constructor accepts a `logPath` from `AuditConfig` but never stores or uses it. The `write()` method only logs to Pino (console) and SQLite (if memory is attached), but does NOT write JSONL entries to the flat file at `logPath`. Tests expect: JSONL file creation, parent directory creation, multi-entry appending, and ISO timestamp formatting — none of which are implemented. The `AuditConfig` schema defines `logPath: z.string().default('audit.log')` but the constructor ignores it.

**Recommended fix:** Store `logPath` in the constructor as `private readonly logPath: string`. In `write()`, after Pino logging: (1) `await mkdir(dirname(this.logPath), { recursive: true })`, (2) `await appendFile(this.logPath, JSON.stringify(entry) + '\n', 'utf-8')`. Wrap in try-catch to prevent crashes on write errors. Keep Pino and SQLite as secondary sinks.

---

### #4 — OB-F29 — Conversation continuity is shallow (no cross-session memory, no topic merging)

**Discovered:** 2026-02-26 (health score audit), **Updated:** 2026-02-27 (fixed)
**Component:** `src/master/master-manager.ts`, `src/memory/conversation-store.ts`, `src/memory/eviction.ts`
**Severity:** ✅ Fixed
**Backlog:** OB-822 | **Health Impact:** +0.10

**Problem:** The Master AI treats every session as nearly fresh. `buildConversationContext()` retrieves only 5 keyword-matched messages via FTS5 — no full session recall, no cross-session awareness, no topic continuity. Two specific issues:

1. **Weight problem** — As conversations accumulate, injecting raw history into the system prompt will bloat the context window. No compaction, no summarization pipeline is wired (the `evictConversations()` AI summarizer exists in `conversation-store.ts` lines 232–374 but is never called — no scheduled job triggers it).

2. **No topic-aware merging** — When a user revisits a topic discussed in a prior session (e.g., talked about "authentication" last week, now asks about "login flow"), the Master can't merge context from both sessions. Each session's context is isolated. The user has to re-explain everything.

**What exists but is unused:**

- `getSessionHistory()` — full session retrieval, never called
- `searchConversations()` — cross-session FTS5 search, never called
- `evictConversations()` — AI-powered summarization (Zone 2: 30–90 days), never scheduled
- `evictOldData()` — orchestrates all eviction policies, never called

**Recommended fix — `memory.md` pattern (proven, simple, effective):**

Inspired by how Claude Code maintains its own `MEMORY.md` file — a single curated file that the AI reads on every session start and updates itself. No complex pipelines, no separate summarizer workers, no topic clustering. The Master AI is the curator.

**Core mechanism — one file: `.openbridge/context/memory.md`**

```
.openbridge/context/
└── memory.md          ← Master reads on start, updates during/after session
```

**How it works:**

1. **On session start**: `buildConversationContext()` loads `memory.md` into the Master's system prompt (fixed cost, always small, always relevant)
2. **During the session**: Master decides what's worth remembering — decisions, user preferences, project state, active threads
3. **On session end**: Master gets one final prompt: _"Update your memory file with anything worth keeping from this session. Keep it under 200 lines. Remove outdated info. Merge related topics."_
4. **Topic continuity is automatic**: When the user revisits a topic, it's already in `memory.md` because the Master wrote it there last time

**What goes in `memory.md`:**

- User preferences ("always uses TypeScript", "prefers short answers")
- Project state ("authentication implemented with JWT, CORS configured")
- Decisions made ("chose PostgreSQL over MongoDB for user data")
- Active threads ("user is building a REST API, /users done, /orders pending")
- Known issues ("deployment fails on Node 18, need Node 22")

**What does NOT go in `memory.md`:**

- Raw conversation transcripts (too heavy — stay in SQLite)
- Every worker result (noise)
- Timestamps for every interaction (clutter)

**Weight control:** Cap at ~200 lines. The Master's "update memory" prompt enforces this: remove outdated info, merge related topics, keep only what matters. File stays small and high-signal forever.

**Dual-layer architecture — `memory.md` + SQLite (keep both, different roles):**

| Layer                            | Role                                     | What it stores                                              | Who reads it                                              |
| -------------------------------- | ---------------------------------------- | ----------------------------------------------------------- | --------------------------------------------------------- |
| `memory.md` (PRIMARY)            | Master's curated brain — what matters    | Decisions, preferences, project state, active threads       | Master AI on every session start                          |
| SQLite `conversations` (ARCHIVE) | Raw audit trail — what actually happened | Every message verbatim, with timestamps, channels, user IDs | Worker briefing, status commands, FTS5 deep search, audit |

**Why keep both:** `memory.md` is the Master's fast, curated knowledge (like your brain). SQLite is the full email inbox (everything that was said). The Master loads `memory.md` always. SQLite is the backup for when the Master needs to dig deeper, and it also serves worker briefing (`worker-briefing.ts`), the `/status` command, and the audit trail.

**Role changes after implementation:**

| Component                    | Current role                         | New role                                                                      |
| ---------------------------- | ------------------------------------ | ----------------------------------------------------------------------------- |
| `buildConversationContext()` | Primary: FTS5 top-5 keyword match    | Primary: load `memory.md`. Fallback: FTS5 when memory doesn't cover the topic |
| `conversations` table        | Only context source (and inadequate) | Raw storage + worker briefing + audit trail                                   |
| `findRelevantHistory()`      | Called every message                 | Called only as fallback when `memory.md` gaps detected                        |
| `evictOldData()`             | Never called                         | Scheduled on Bridge startup + every 24h (keeps SQLite lean)                   |
| `getSessionHistory()`        | Never called                         | Available for explicit full session replay                                    |
| `worker-briefing.ts`         | Uses FTS5 chunks + task history      | Unchanged — workers still get briefed from SQLite                             |

**Implementation phases (task-ready):**

| Phase        | What                                                                                                         | Files touched                                  | Effort                       |
| ------------ | ------------------------------------------------------------------------------------------------------------ | ---------------------------------------------- | ---------------------------- |
| **Phase 1a** | Add `readMemoryFile()` / `writeMemoryFile()` to `DotFolderManager` for `.openbridge/context/memory.md`       | `dotfolder-manager.ts`                         | Small                        |
| **Phase 1b** | Update `buildConversationContext()` to load `memory.md` as primary context, FTS5 as fallback                 | `master-manager.ts`                            | Small                        |
| **Phase 1c** | Add "update memory" prompt on session end — Master writes its own `memory.md` via a worker with `Write` tool | `master-manager.ts`, `master-system-prompt.ts` | Small                        |
| **Phase 1d** | Add `memory.md` instructions to Master system prompt: what to remember, 200-line cap, merge topics           | `master-system-prompt.ts`                      | Small                        |
| **Phase 2**  | Wire `searchConversations()` as explicit fallback when Master detects topic not in `memory.md`               | `master-manager.ts`                            | Small                        |
| **Phase 3**  | Schedule `evictOldData()` on Bridge startup + `setInterval(24h)` to keep SQLite lean                         | `bridge.ts` or `index.ts`                      | Small                        |
| **Phase 4**  | Add topic file splitting only if `memory.md` exceeds 200 lines for very complex workspaces                   | `dotfolder-manager.ts`                         | Medium (likely never needed) |

**Why this works better than complex alternatives:** Claude Code uses this exact pattern across millions of sessions. One curated file beats raw message search because: (1) always loaded, no search latency, (2) curated by the AI itself so signal-to-noise is high, (3) stays small regardless of conversation volume, (4) no extra AI workers or scheduled jobs for Phase 1. The existing SQLite infrastructure stays intact — it just moves from "only mechanism" to "archive + fallback", which is what it's better suited for.

---

### #5 — OB-F35 — No conversation history access for users (no list, no search, no browse)

**Discovered:** 2026-02-26 (feature gap analysis), **Updated:** 2026-02-27 (fixed)
**Component:** `src/memory/conversation-store.ts`, `src/connectors/webchat/`, `src/core/router.ts`
**Severity:** ✅ Fixed
**Backlog:** OB-992 | **Health Impact:** +0.10
**Related:** OB-F29 (conversation continuity — Master side). This is the **user side**.

**Problem:** Every conversation with OpenBridge is fire-and-forget from the user's perspective. There is no way to:

- **List past sessions** — no `listSessions()` method exists in the conversation store
- **Browse a conversation** — `getSessionHistory()` exists but has no user-facing exposure
- **Search past conversations** — `searchConversations()` exists but isn't wired to any command or UI
- **Resume a topic** — no session titles, no labels, no way to reference "that conversation from Tuesday"

Compare with what users already have:

- **Claude in VS Code**: Full conversation list in sidebar, click to resume, scroll history
- **claude.ai**: Conversation list, search, rename, organize
- **OpenBridge**: Nothing — messages go into SQLite and disappear from the user's view

**What exists but is not exposed to users:**

| Method                                | Location                                    | Status                              |
| ------------------------------------- | ------------------------------------------- | ----------------------------------- |
| `getSessionHistory(sessionId, limit)` | `conversation-store.ts:116`                 | Exists, never exposed to user       |
| `searchConversations(query, limit)`   | `conversation-store.ts:96` / `retrieval.ts` | Exists, never exposed to user       |
| `findRelevantHistory(query, limit)`   | `conversation-store.ts:93`                  | Exists, used only by Master context |
| `DISTINCT session_id` query           | `conversation-store.ts:358`                 | Only used in eviction               |
| **`listSessions()`**                  | —                                           | **Does not exist**                  |
| **Session titles/labels**             | —                                           | **No schema support**               |

**Recommended fix — conversation history feature (all channels):**

**Phase 1 — Data layer (conversation-store.ts):**

- Add `listSessions(limit, offset)` → returns `{ session_id, first_message, last_message, message_count, channel, user_id }[]` ordered by `last_message DESC`
- Add `title` column to `conversations` table (nullable, set on first user message or AI-generated)
- Add `searchSessions(query)` → FTS5 search that returns session-level results (not individual messages)

**Phase 2 — Command layer (router.ts):**

- Add `/history` command → lists last 10 sessions with title + date + preview (works on ALL channels: WhatsApp, Telegram, Discord, Console, WebChat)
- Add `/history search <query>` → search past conversations by keyword
- Add `/history <session-id>` → show full conversation transcript
- Format output per channel (WhatsApp = numbered list, WebChat = HTML, Console = table)

**Phase 3 — WebChat UI (webchat-connector.ts):**

- Add `/api/sessions` REST endpoint → JSON list of sessions
- Add `/api/sessions/:id` REST endpoint → full conversation for one session
- Add sidebar or history page to WebChat frontend (session list, click to view, search bar)
- WebSocket event `session-list-update` for real-time updates

**Phase 4 — Session management:**

- Auto-title sessions using first user message (truncated to 50 chars)
- Optional: spawn haiku worker to generate a smart title after 3+ messages
- Add `/history rename <id> <title>` command
- Add `/history delete <id>` command (with confirmation, like `/stop` uses)

**Why this matters:** Users who interact via WhatsApp or Telegram can't scroll up indefinitely — messages get buried. This gives them the same experience they're used to from Claude's own interfaces. Combined with OB-F29 (`memory.md`), this creates full conversation continuity — the Master remembers (F29), and the user can browse (F35).

---

### #6 — OB-F28 — No DB schema versioning (manual ALTER TABLE sequences)

**Discovered:** 2026-02-26 (health score audit), **Updated:** 2026-02-27 (fixed)
**Component:** `src/memory/migration.ts`
**Severity:** ✅ Fixed
**Backlog:** OB-821 | **Health Impact:** +0.05

**Problem:** Schema migrations use ad-hoc `ALTER TABLE` sequences with no version tracking. The migration runner (`migration.ts`) executes all ALTER statements on every startup, relying on SQLite's `ALTER TABLE ADD COLUMN` being idempotent (it errors on duplicate columns, caught silently). No way to know which migrations have been applied, rollback on failure, or skip already-applied migrations.

**Recommended fix:** Add a `schema_versions` table (`version INTEGER PRIMARY KEY, applied_at TEXT, description TEXT`). Number each migration. On startup, query the max applied version and only run newer migrations. Wrap each migration in a transaction for rollback safety. Prevents data loss on failed upgrades.

---

### #7 — OB-F34 — ESLint reports 264 errors (cascading from OB-F32/F33)

**Discovered:** 2026-02-26 (lint validation)
**Component:** `src/master/master-manager.ts`, `tests/master/prompt-*.test.ts`
**Severity:** 🟢 Low
**Backlog:** OB-991
**Blocked by:** OB-F32

**Problem:** ESLint's `@typescript-eslint/no-unsafe-*` rules flag 264 errors, all cascading from the same root cause as OB-F32 and OB-F33. The `unknown` type propagation triggers `no-unsafe-member-access`, `no-unsafe-call`, `no-unsafe-assignment`, and `no-unsafe-argument` rules. These are not independent issues — they will auto-resolve when OB-F32 is fixed.

**Recommended fix:** Fix OB-F32 first. Remaining lint errors (if any) should be addressed individually. No independent action needed.

---

### #8 — OB-F30 — No real-time worker streaming progress

**Discovered:** 2026-02-26 (health score audit)
**Component:** `src/core/agent-runner.ts`, `src/master/master-manager.ts`
**Severity:** 🟢 Low
**Backlog:** OB-930 | **Health Impact:** +0.05

**Problem:** Active workers appear as "running" in the status command and WebChat dashboard with no granularity. Users can't see how many turns a worker has consumed, what it's currently doing, or how close it is to finishing. The only visibility is start time and elapsed duration.

**Recommended fix:** Stream stdout chunks from active workers via `execOnceStreaming()`. Parse turn indicators from Claude CLI output to extract real-time turn count. Broadcast `worker-progress` events to all connectors with `{ workerId, turnsUsed, turnsMax, lastAction }`. Update the WebChat dashboard to show a progress bar per worker.

---

### #9 — OB-F31 — Session checkpointing not implemented (Master can't pause/resume)

**Discovered:** 2026-02-26 (health score audit)
**Component:** `src/master/master-manager.ts`
**Severity:** 🟢 Low
**Backlog:** OB-931 | **Health Impact:** +0.05

**Problem:** When the Master AI is processing a complex multi-step task (spawning workers, waiting for results), it can't be interrupted. The fast-path responder (Phase 49) handles simple questions, but tool-use and complex messages must wait in the priority queue. There's no way to checkpoint the Master's current state, handle an urgent request, then resume.

**Recommended fix:** Add `checkpointSession()` / `resumeSession()` to MasterManager. On checkpoint: serialize current task state (pending workers, accumulated results, message context) to the `sessions` table. On resume: restore state and continue processing. Integrate with the priority queue so that urgent messages (from owners/admins) can trigger a checkpoint-handle-resume cycle.

---

## Severity Guide

| Severity    | Meaning                                               |
| ----------- | ----------------------------------------------------- |
| 🔴 Critical | System broken, data loss risk, security vulnerability |
| 🟠 High     | Core functionality missing or significantly impaired  |
| 🟡 Medium   | Friction, technical debt, or non-blocking gaps        |
| 🟢 Low      | Polish, minor improvements, nice-to-have              |
