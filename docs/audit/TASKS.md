# OpenBridge — Task List

> **Pending:** 7 | **In Progress:** 0 | **Done:** 43
> **Last Updated:** 2026-02-27

<details>
<summary>Archive (385 tasks completed across Phases 1–50)</summary>

- [V0 — Phases 1–5](archive/v0/TASKS-v0.md)
- [V1 — Phases 6–10](archive/v1/TASKS-v1.md)
- [V2 — Phases 11–14](archive/v2/TASKS-v2.md)
- [MVP — Phase 15](archive/v3/TASKS-v3-mvp.md)
- [Self-Governing — Phases 16–21](archive/v4/TASKS-v4-self-governing.md)
- [E2E + Channels — Phases 22–24](archive/v5/TASKS-v5-e2e-channels.md)
- [Smart Orchestration — Phases 25–28](archive/v6/TASKS-v6-smart-orchestration.md)
- [AI Classification — Phase 29](archive/v7/TASKS-v7-ai-classification.md)
- [Production Readiness — Phase 30](archive/v8/TASKS-v8-production-readiness.md)
- [Memory + Scale — Phases 31–38](archive/v9/TASKS-v9-memory-scale.md)
- [Memory Wiring — Phase 40](archive/v10/TASKS-v10-memory-wiring.md)
- [Memory Fixes — Phases 41–44](archive/v11/TASKS-v11-memory-fixes.md)
- [Post-v0.0.2 — Phases 45–50](archive/v12/TASKS-v12-post-v002-phases-45-50.md)

</details>

---

## Phase 51 — Build Fix: Prompt Library + Audit Logger (OB-F32, OB-F33, OB-F34, OB-F27)

> **Priority:** Highest — unblocks CI. Fixes 47 test failures, 20 TS errors, 264 lint errors.

| #   | Task ID | Finding | Description                                                                                                                                                                                                                           | Status  |
| --- | ------- | ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------- |
| 1   | OB-1000 | OB-F32  | Implement `readPromptManifest()` on `DotFolderManager` — read `.openbridge/prompts/manifest.json`, return `PromptManifest \| null`, validate with `PromptManifestSchema`                                                              | ✅ Done |
| 2   | OB-1001 | OB-F32  | Implement `writePromptManifest(manifest)` on `DotFolderManager` — validate with `PromptManifestSchema`, write to `.openbridge/prompts/manifest.json`, create dir if needed                                                            | ✅ Done |
| 3   | OB-1002 | OB-F32  | Implement `writePromptTemplate(filename, content, metadata)` — write `.md` file to `.openbridge/prompts/`, create/update manifest entry, preserve `createdAt` on update, set `previousVersion`/`previousSuccessRate` when overwriting | ✅ Done |
| 4   | OB-1003 | OB-F32  | Implement `getPromptTemplate(id)` — lookup by id in manifest, return `PromptTemplate \| null`                                                                                                                                         | ✅ Done |
| 5   | OB-1004 | OB-F32  | Implement `recordPromptUsage(id, success)` — increment `usageCount`/`successCount`, recalculate `successRate = successCount / usageCount`, update `lastUsedAt`                                                                        | ✅ Done |
| 6   | OB-1005 | OB-F32  | Implement `getLowPerformingPrompts(threshold)` — filter manifest prompts where `usageCount >= 3` AND `successRate < threshold`                                                                                                        | ✅ Done |
| 7   | OB-1006 | OB-F32  | Implement `resetPromptStats(id)` — zero `usageCount`/`successCount`/`successRate`, preserve `previousSuccessRate` from current `successRate`                                                                                          | ✅ Done |
| 8   | OB-1007 | OB-F33  | Verify `npm run typecheck` passes — all 20 TS errors in `master-manager.ts` should auto-resolve once prompt library methods are implemented                                                                                           | ✅ Done |
| 9   | OB-1008 | OB-F34  | Verify `npm run lint` passes — 264 ESLint errors should auto-resolve. Fix any remaining individually.                                                                                                                                 | ✅ Done |
| 10  | OB-1009 | OB-F32  | Run prompt library tests — verify all 39 failures in `prompt-library.test.ts`, `prompt-effectiveness.test.ts`, `prompt-degradation.test.ts` now pass                                                                                  | ✅ Done |
| 11  | OB-1010 | OB-F27  | Implement JSONL flat-file output in `AuditLogger` — store `logPath` in constructor, add `mkdir` + `appendFile` in `write()`, wrap in try-catch                                                                                        | ✅ Done |
| 12  | OB-1011 | OB-F27  | Run audit logger tests — verify all 8 failures in `audit-logger.test.ts` now pass                                                                                                                                                     | ✅ Done |
| 13  | OB-1012 | —       | Run full test suite — confirm 2143/2143 passing (0 failures), `npm run typecheck` clean, `npm run lint` clean                                                                                                                         | ✅ Done |

---

## Phase 52 — Conversation Continuity: `memory.md` Pattern (OB-F29)

> **Priority:** High — core UX gap. Master remembers across sessions.

| #   | Task ID | Finding | Description                                                                                                                                                                                                                                          | Status  |
| --- | ------- | ------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------- |
| 14  | OB-1020 | OB-F29  | Add `readMemoryFile()` to `DotFolderManager` — read `.openbridge/context/memory.md`, return `string \| null`, create `.openbridge/context/` dir on `initialize()`                                                                                    | ✅ Done |
| 15  | OB-1021 | OB-F29  | Add `writeMemoryFile(content)` to `DotFolderManager` — write to `.openbridge/context/memory.md`, validate content length ≤ 200 lines                                                                                                                 | ✅ Done |
| 16  | OB-1022 | OB-F29  | Update `buildConversationContext()` in `MasterManager` — load `memory.md` as primary context. If file exists, inject into system prompt. Fall back to `findRelevantHistory()` FTS5 search only when `memory.md` is empty or missing                  | ✅ Done |
| 17  | OB-1023 | OB-F29  | Add "update memory" prompt on session end — when Master session ends or after N messages, send final prompt: "Update your memory file. Keep under 200 lines. Remove outdated info. Merge related topics." Master writes via worker with `Write` tool | ✅ Done |
| 18  | OB-1024 | OB-F29  | Add `memory.md` instructions to Master system prompt (`master-system-prompt.ts`) — what to remember, what not to remember, 200-line cap, merge topics guidance                                                                                       | ✅ Done |
| 19  | OB-1025 | OB-F29  | Wire `searchConversations()` as explicit fallback — when Master detects current topic not covered by `memory.md`, query FTS5 for cross-session results                                                                                               | ✅ Done |
| 20  | OB-1026 | OB-F29  | Schedule `evictOldData()` on Bridge startup + `setInterval(24h)` — wire existing eviction system in `bridge.ts` or `index.ts`                                                                                                                        | ✅ Done |
| 21  | OB-1027 | OB-F29  | Add unit tests for `readMemoryFile()` / `writeMemoryFile()` + integration test for memory context injection in Master prompt                                                                                                                         | ✅ Done |

---

## Phase 53 — Conversation History Access (OB-F35)

> **Priority:** High — user-facing feature. Pairs with Phase 52 (Master remembers, user browses).

| #   | Task ID | Finding | Description                                                                                                                                                                                            | Status  |
| --- | ------- | ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------- |
| 22  | OB-1030 | OB-F35  | Add `listSessions(limit, offset)` to `conversation-store.ts` — returns `{ session_id, title, first_message_at, last_message_at, message_count, channel, user_id }[]` ordered by `last_message_at DESC` | ✅ Done |
| 23  | OB-1031 | OB-F35  | Add `title` column to `conversations` table via migration — nullable `TEXT`, set to first user message (truncated 50 chars) on session creation                                                        | ✅ Done |
| 24  | OB-1032 | OB-F35  | Add `searchSessions(query, limit)` to `conversation-store.ts` — FTS5 search that returns session-level results (grouped by `session_id`, ranked by relevance)                                          | ✅ Done |
| 25  | OB-1033 | OB-F35  | Add `/history` command to `router.ts` — lists last 10 sessions with title + date + message count. Format per channel (WhatsApp = numbered list, Console = table, WebChat = HTML)                       | ✅ Done |
| 26  | OB-1034 | OB-F35  | Add `/history search <query>` command to `router.ts` — search past conversations by keyword via `searchSessions()`                                                                                     | ✅ Done |
| 27  | OB-1035 | OB-F35  | Add `/history <session-id>` command to `router.ts` — show full conversation transcript for a session via `getSessionHistory()`                                                                         | ✅ Done |
| 28  | OB-1036 | OB-F35  | Add `/api/sessions` REST endpoint to WebChat connector — JSON list of sessions for frontend                                                                                                            | ✅ Done |
| 29  | OB-1037 | OB-F35  | Add `/api/sessions/:id` REST endpoint to WebChat connector — full conversation JSON for one session                                                                                                    | ✅ Done |
| 30  | OB-1038 | OB-F35  | Add unit tests for `listSessions()`, `searchSessions()`, `/history` command parsing, REST endpoints                                                                                                    | ✅ Done |

---

## Phase 54 — Schema Versioning (OB-F28)

> **Priority:** Medium — technical debt. Protects future migrations.

| #   | Task ID | Finding | Description                                                                                                                                                       | Status  |
| --- | ------- | ------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------- |
| 31  | OB-1040 | OB-F28  | Create `schema_versions` table (`version INTEGER PRIMARY KEY, applied_at TEXT, description TEXT`) in `database.ts`                                                | ✅ Done |
| 32  | OB-1041 | OB-F28  | Number all existing migrations in `migration.ts` — assign version 1 through N to current `ALTER TABLE` sequences                                                  | ✅ Done |
| 33  | OB-1042 | OB-F28  | Update migration runner — on startup, query `MAX(version)` from `schema_versions`, only run migrations with version > max. Wrap each in transaction for rollback. | ✅ Done |
| 34  | OB-1043 | OB-F28  | Add migration tests — verify idempotency (running twice is safe), verify version tracking, verify rollback on failure                                             | ✅ Done |

---

## Phase 55 — Polish: Worker Streaming + Session Checkpointing (OB-F30, OB-F31)

> **Priority:** Low — nice-to-have improvements.

| #   | Task ID | Finding | Description                                                                                                                              | Status  |
| --- | ------- | ------- | ---------------------------------------------------------------------------------------------------------------------------------------- | ------- |
| 35  | OB-1050 | OB-F30  | Stream stdout chunks from active workers via `execOnceStreaming()` — parse turn indicators from CLI output                               | ✅ Done |
| 36  | OB-1051 | OB-F30  | Broadcast `worker-progress` events to all connectors with `{ workerId, turnsUsed, turnsMax, lastAction }`                                | ✅ Done |
| 37  | OB-1052 | OB-F30  | Add worker progress tests — verify turn parsing, event broadcasting, WebChat progress display                                            | ✅ Done |
| 38  | OB-1053 | OB-F31  | Implement `checkpointSession()` on `MasterManager` — serialize pending workers, accumulated results, message context to `sessions` table | ✅ Done |
| 39  | OB-1054 | OB-F31  | Implement `resumeSession()` on `MasterManager` — restore state from `sessions` table and continue processing                             | ✅ Done |
| 40  | OB-1055 | OB-F31  | Integrate checkpoint/resume with priority queue — urgent messages trigger checkpoint-handle-resume cycle                                 | ✅ Done |

---

## Phase 56 — Documentation Update (post-implementation)

> **Priority:** Required after all phases above are complete. Update all docs to reflect new state.

| #   | Task ID | Finding | Description                                                                                                                                                                                                                                                                                                           | Status    |
| --- | ------- | ------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------- |
| 41  | OB-1060 | —       | Update `ARCHITECTURE.md` — fix `.openbridge/` folder spec (add `context/memory.md`, `openbridge.db` documentation, correct "v0.1.0 will migrate to SQLite" → "v0.0.2 migrated to SQLite"), add DotFolderManager prompt library methods, conversation history commands                                                 | ✅ Done   |
| 42  | OB-1061 | —       | Update `ROADMAP.md` — mark Phases 51–55 with task counts and status, move implemented backlog items from backlog to shipped, update version milestones table                                                                                                                                                          | ✅ Done   |
| 43  | OB-1062 | —       | Update `CHANGELOG.md` — add [Unreleased] entries for all new features: prompt library (Phase 51), `memory.md` conversation continuity (Phase 52), `/history` command + REST endpoints (Phase 53), schema versioning (Phase 54), worker streaming + checkpointing (Phase 55). Add Fixed entries for all open findings. | ✅ Done   |
| 44  | OB-1063 | —       | Update `CLAUDE.md` (workspace root) — add `.openbridge/context/` to project structure, add new DotFolderManager methods, update LOC counts for modified files, add `/history` to router commands                                                                                                                      | ◻ Pending |
| 45  | OB-1064 | —       | Update `CLAUDE.md` (OpenBridge repo) — sync key files list, update LOC counts, add `memory.md` pattern to Key Architecture section                                                                                                                                                                                    | ◻ Pending |
| 46  | OB-1065 | —       | Update `docs/audit/HEALTH.md` — recalculate health score after all findings resolved, update open findings count to 0, update categories                                                                                                                                                                              | ◻ Pending |
| 47  | OB-1066 | —       | Update `README.md` — add conversation memory + history browsing as feature highlights, update feature list                                                                                                                                                                                                            | ◻ Pending |
| 48  | OB-1067 | —       | Update `API_REFERENCE.md` — add new DotFolderManager methods, `/history` command docs, `/api/sessions` REST endpoints, `listSessions()` / `searchSessions()` method signatures                                                                                                                                        | ◻ Pending |
| 49  | OB-1068 | —       | Update `FINDINGS.md` — mark all 9 findings as fixed, archive to `archive/v6/FINDINGS-v6.md`, reset open count to 0                                                                                                                                                                                                    | ◻ Pending |
| 50  | OB-1069 | —       | Final validation — run `npm run test`, `npm run typecheck`, `npm run lint`, `npm run format:check`. Confirm 0 failures across all checks.                                                                                                                                                                             | ◻ Pending |

---

## Phase Summary

| Phase  | Name                                     | Tasks  | Findings                       | Effort       |
| ------ | ---------------------------------------- | ------ | ------------------------------ | ------------ |
| **51** | Build Fix: Prompt Library + Audit Logger | 13     | OB-F32, OB-F33, OB-F34, OB-F27 | Small–Medium |
| **52** | Conversation Continuity: `memory.md`     | 8      | OB-F29                         | Medium       |
| **53** | Conversation History Access              | 9      | OB-F35                         | Medium       |
| **54** | Schema Versioning                        | 4      | OB-F28                         | Small        |
| **55** | Polish: Streaming + Checkpointing        | 6      | OB-F30, OB-F31                 | Medium       |
| **56** | Documentation Update                     | 10     | —                              | Small        |
|        | **Total**                                | **50** | **9 findings**                 |              |

---

## Dependency Graph

```
Phase 51 (Build Fix)
  ├── OB-1000..1006 → OB-1007 (typecheck) → OB-1008 (lint) → OB-1009 (tests)
  ├── OB-1010 → OB-1011 (audit tests)
  └── OB-1012 (full suite validation)

Phase 52 (memory.md) — depends on Phase 51 (clean build)
  ├── OB-1020..1021 (DotFolderManager methods)
  ├── OB-1022..1024 (Master wiring)
  └── OB-1025..1027 (fallback + eviction + tests)

Phase 53 (History) — depends on Phase 52 (conversation store changes)
  ├── OB-1030..1032 (data layer)
  ├── OB-1033..1035 (command layer)
  └── OB-1036..1038 (WebChat + tests)

Phase 54 (Schema) — independent, can run parallel with 52/53
  └── OB-1040..1043

Phase 55 (Polish) — independent, can run parallel with 52/53/54
  ├── OB-1050..1052 (streaming)
  └── OB-1053..1055 (checkpointing)

Phase 56 (Docs) — depends on ALL above being complete
  └── OB-1060..1069
```

---

## Status Legend

|  Status   | Description               |
| :-------: | ------------------------- |
|  ✅ Done  | Completed and verified    |
| 🔄 Active | Currently being worked on |
| ◻ Pending | Not started               |
