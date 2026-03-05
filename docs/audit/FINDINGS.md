# OpenBridge — Audit Findings

> **Purpose:** Real issues, gaps, and risks discovered during code audits and real-world testing.
> **This is NOT a task list.** Tasks live in [TASKS.md](TASKS.md). Findings document _what's wrong_ and _why it matters_.
> **Open:** 17 | **Fixed:** 118 | **Last Audit:** 2026-03-05
> **Current focus:** Data integrity fixes (Phase 97) + community-inspired improvements (v0.0.13).
> **Resolved findings:** [V0 archive](archive/v0/FINDINGS-v0.md) | [V2 archive](archive/v2/FINDINGS-v2.md) | [V4 archive](archive/v4/FINDINGS-v4.md) | [V5 archive](archive/v5/FINDINGS-v5.md) | [V6 archive](archive/v6/FINDINGS-v6.md) | [V7 archive](archive/v7/FINDINGS-v7.md) | [V8 archive](archive/v8/FINDINGS-v8.md) | [V15 archive](archive/v15/FINDINGS-v15.md) | [V16 archive](archive/v16/FINDINGS-v16.md) | [V17 archive](archive/v17/FINDINGS-v17.md) | [V18 archive](archive/v18/FINDINGS-v18.md) | [V19 archive](archive/v19/FINDINGS-v19.md) | [V20 archive](archive/v20/TASKS-v20-v009-v011-phases-74-86-deep1.md) | [V21 archive](archive/v21/FINDINGS-v21.md)

---

## Priority Order

All Tier 1, Tier 1b, Tier 1c, Tier 2, and Tier 2b findings have been resolved (118 fixed across v0.0.1–v0.0.12). 7 new data integrity findings discovered via `.openbridge/` DB audit. 10 community-inspired improvements planned for v0.0.13.

### Open Findings — Data Integrity (Phase 97, pre-v0.0.13)

Issues discovered by auditing the `.openbridge/openbridge.db` runtime data. Features are implemented but not wired correctly — data pipelines have gaps.

| #      | Finding                                                        | Severity  | Root Cause                                                                                   | Key File(s)                                                       | Status |
| ------ | -------------------------------------------------------------- | --------- | -------------------------------------------------------------------------------------------- | ----------------------------------------------------------------- | ------ |
| OB-F89 | Audit log table always empty (0 rows)                          | 🟡 Medium | `config.audit.enabled` defaults to `false` — `AuditLogger.write()` returns early             | `src/types/config.ts`, `src/core/audit-logger.ts`                 | Open   |
| OB-F90 | QA cache table always empty (0 rows)                           | 🟠 High   | `qaCache.store()` is never called — read path wired, write path missing                      | `src/core/router.ts`, `src/core/knowledge-retriever.ts`           | Open   |
| OB-F91 | All sessions stuck in `active` status forever                  | 🟠 High   | `closeActiveSessions()` exists in `migration.ts` but is dead code — never called on shutdown | `src/master/master-manager.ts`, `src/core/bridge.ts`              | Open   |
| OB-F92 | Learnings `total_turns` always 0 — model efficiency data blind | 🟠 High   | `recordLearning()` hardcodes `0` for turns; `masterTaskToMemoryTask()` skips `turns_used`    | `src/master/master-manager.ts` (lines 2987, 3193, 403–428)        | Open   |
| OB-F93 | Prompt evolution never activates (usage_count=0)               | 🟡 Medium | `seedPromptLibrary()` exists but is never called — only `master-system` prompt seeded        | `src/master/master-manager.ts`, `src/master/seed-prompts.ts`      | Open   |
| OB-F94 | Sub-master detection never triggered (0 rows)                  | 🟡 Medium | `detectSubProjects()` / `spawnSubMaster()` exist but are never called anywhere               | `src/master/master-manager.ts`                                    | Open   |
| OB-F95 | memory.md goes stale — fire-and-forget with no verification    | 🟠 High   | `triggerMemoryUpdate()` relies on Master AI writing — no verification, no retry, no fallback | `src/master/master-manager.ts`, `src/master/dotfolder-manager.ts` | Open   |

### Open Findings — Community-Inspired Improvements (v0.0.13)

Improvements identified by analyzing [openclaw/openclaw](https://github.com/openclaw/openclaw) (242K stars) and [thedotmack/claude-mem](https://github.com/thedotmack/claude-mem) (32K stars).

| #      | Finding                                                           | Severity  | Improvement Impact                                                               | Inspired By | Status |
| ------ | ----------------------------------------------------------------- | --------- | -------------------------------------------------------------------------------- | ----------- | ------ |
| OB-F79 | Memory has no vector search — FTS5 only                           | 🟠 High   | RAG returns keyword matches only, misses semantically similar content            | openclaw    | Open   |
| OB-F80 | No structured observations from worker outputs                    | 🟠 High   | Worker results are free-form text — no typed facts, concepts, or files_touched   | claude-mem  | Open   |
| OB-F81 | Memory retrieval returns full results — no progressive disclosure | 🟡 Medium | Every search loads full content, wastes tokens; no index → filter → detail flow  | claude-mem  | Open   |
| OB-F82 | No content-hash deduplication for workspace chunks                | 🟡 Medium | Duplicate chunks stored during overlapping worker reads and re-exploration       | claude-mem  | Open   |
| OB-F83 | No token economics tracking for exploration ROI                   | 🟡 Medium | Can't measure if exploration cost is worth the retrieval savings                 | claude-mem  | Open   |
| OB-F84 | Master context window has no auto-compaction                      | 🟠 High   | Long Master sessions hit context limits; memory.md is manual, not auto-compacted | openclaw    | Open   |
| OB-F85 | No self-diagnostic command (`openbridge doctor`)                  | 🟡 Medium | Users can't verify their setup — no health check for dependencies, configs, DB   | openclaw    | Open   |
| OB-F86 | No pairing-based auth for messaging channels                      | 🟡 Medium | Adding users requires config edits — no self-service approval flow via DM        | openclaw    | Open   |
| OB-F87 | No skills directory or SKILL.md pattern                           | 🟡 Medium | Master can't discover and use reusable capabilities — no plugin skill system     | openclaw    | Open   |
| OB-F88 | Worker summaries are unstructured free-form text                  | 🟡 Medium | No typed completed/learned/next_steps — can't auto-index or track learnings      | claude-mem  | Open   |

---

## Finding History

| Version | Findings Fixed | Cumulative |
| ------- | -------------- | ---------- |
| v0.0.1  | 30             | 30         |
| v0.0.2  | 8              | 38         |
| v0.0.3  | 6              | 44         |
| v0.0.4  | 5              | 49         |
| v0.0.5  | 3              | 52         |
| v0.0.6  | 2              | 54         |
| v0.0.7  | 2              | 56         |
| v0.0.8  | 1              | 57         |
| v0.0.9  | 11             | 68         |
| v0.0.10 | 10             | 78         |
| v0.0.11 | 10             | 88         |
| v0.0.12 | 30             | 118        |

---
