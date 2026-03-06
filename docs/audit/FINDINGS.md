# OpenBridge — Audit Findings

> **Purpose:** Real issues, gaps, and risks discovered during code audits and real-world testing.
> **This is NOT a task list.** Tasks live in [TASKS.md](TASKS.md). Findings document _what's wrong_ and _why it matters_.
> **Open:** 17 | **Fixed:** 126 | **Last Audit:** 2026-03-06
> **Current focus:** Sprint 5 + Sprint 6 — 176 tasks loaded in TASKS.md for automated execution (OB-1618 through OB-1793). Phase 97 data integrity fixes complete (7/7 findings fixed).
> **Resolved findings:** [V0 archive](archive/v0/FINDINGS-v0.md) | [V2 archive](archive/v2/FINDINGS-v2.md) | [V4 archive](archive/v4/FINDINGS-v4.md) | [V5 archive](archive/v5/FINDINGS-v5.md) | [V6 archive](archive/v6/FINDINGS-v6.md) | [V7 archive](archive/v7/FINDINGS-v7.md) | [V8 archive](archive/v8/FINDINGS-v8.md) | [V15 archive](archive/v15/FINDINGS-v15.md) | [V16 archive](archive/v16/FINDINGS-v16.md) | [V17 archive](archive/v17/FINDINGS-v17.md) | [V18 archive](archive/v18/FINDINGS-v18.md) | [V19 archive](archive/v19/FINDINGS-v19.md) | [V20 archive](archive/v20/TASKS-v20-v009-v011-phases-74-86-deep1.md) | [V21 archive](archive/v21/FINDINGS-v21.md)

---

## Priority Order

All Tier 1, Tier 1b, Tier 1c, Tier 2, and Tier 2b findings have been resolved (125 fixed across v0.0.1–v0.0.12 + Phase 97). Sprint 5 targets 12 findings across 4 core phases (smarter AI + business output + role UX fix) + 4 stretch phases (vector search, doctor, pairing, skills). 6 remaining findings planned for v0.0.14 (Sprint 6).

### Fixed Findings — Data Integrity (Phase 97, pre-v0.0.13) — All 7 Fixed ✅

Issues discovered by auditing the `.openbridge/openbridge.db` runtime data. All wiring gaps have been fixed. Archived in [v22](archive/v22/TASKS-v22-phase97-data-integrity.md).

| #      | Finding                                                        | Severity  | Root Cause                                                                                   | Key File(s)                                                       | Status   |
| ------ | -------------------------------------------------------------- | --------- | -------------------------------------------------------------------------------------------- | ----------------------------------------------------------------- | -------- |
| OB-F89 | Audit log table always empty (0 rows)                          | 🟡 Medium | `config.audit.enabled` defaults to `false` — `AuditLogger.write()` returns early             | `src/types/config.ts`, `src/core/audit-logger.ts`                 | ✅ Fixed |
| OB-F90 | QA cache table always empty (0 rows)                           | 🟠 High   | `qaCache.store()` is never called — read path wired, write path missing                      | `src/core/router.ts`, `src/core/knowledge-retriever.ts`           | ✅ Fixed |
| OB-F91 | All sessions stuck in `active` status forever                  | 🟠 High   | `closeActiveSessions()` exists in `migration.ts` but is dead code — never called on shutdown | `src/master/master-manager.ts`, `src/core/bridge.ts`              | ✅ Fixed |
| OB-F92 | Learnings `total_turns` always 0 — model efficiency data blind | 🟠 High   | `recordLearning()` hardcodes `0` for turns; `masterTaskToMemoryTask()` skips `turns_used`    | `src/master/master-manager.ts` (lines 2987, 3193, 403–428)        | ✅ Fixed |
| OB-F93 | Prompt evolution never activates (usage_count=0)               | 🟡 Medium | `seedPromptLibrary()` exists but is never called — only `master-system` prompt seeded        | `src/master/master-manager.ts`, `src/master/seed-prompts.ts`      | ✅ Fixed |
| OB-F94 | Sub-master detection never triggered (0 rows)                  | 🟡 Medium | `detectSubProjects()` / `spawnSubMaster()` exist but are never called anywhere               | `src/master/master-manager.ts`                                    | ✅ Fixed |
| OB-F95 | memory.md goes stale — fire-and-forget with no verification    | 🟠 High   | `triggerMemoryUpdate()` relies on Master AI writing — no verification, no retry, no fallback | `src/master/master-manager.ts`, `src/master/dotfolder-manager.ts` | ✅ Fixed |

### Open Findings — Sprint 5 Core (v0.0.13)

Smarter AI memory system, session management, role UX fix, and business document generation.

| #       | Finding                                                                    | Severity  | Improvement Impact                                                                                                                                               | Phase | Status   |
| ------- | -------------------------------------------------------------------------- | --------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----- | -------- |
| OB-F80  | No structured observations from worker outputs                             | 🟠 High   | Worker results are free-form text — no typed facts, concepts, or files_touched                                                                                   | 93    | Open     |
| OB-F82  | No content-hash deduplication for workspace chunks                         | 🟡 Medium | Duplicate chunks stored during overlapping worker reads and re-exploration                                                                                       | 93    | ✅ Fixed |
| OB-F88  | Worker summaries are unstructured free-form text                           | 🟡 Medium | No typed completed/learned/next_steps — can't auto-index or track learnings                                                                                      | 93    | Open     |
| OB-F83  | No token economics tracking for exploration ROI                            | 🟡 Medium | Can't measure if exploration cost is worth the retrieval savings                                                                                                 | 95    | Open     |
| OB-F84  | Master context window has no auto-compaction                               | 🟠 High   | Long Master sessions hit context limits; memory.md is manual, not auto-compacted                                                                                 | 95    | Open     |
| OB-F103 | Channel role management UX is broken — bad defaults, cryptic errors, no UI | 🟠 High   | WebChat users auto-created as `viewer` (read-only), any task message blocked as "edit". No way to set/view roles from config or channel. Error gives no guidance | 96d   | Open     |
| OB-F98  | No document generation skills — can't create DOCX/PDF/PPTX/XLSX            | 🟠 High   | Business users can't generate reports, presentations, or spreadsheets. Missing entire use case category                                                          | 99    | Open     |

### Open Findings — Sprint 5 Stretch (v0.0.13, if time allows)

| #      | Finding                                                           | Severity  | Improvement Impact                                                              | Phase | Status |
| ------ | ----------------------------------------------------------------- | --------- | ------------------------------------------------------------------------------- | ----- | ------ |
| OB-F79 | Memory has no vector search — FTS5 only                           | 🟠 High   | RAG returns keyword matches only, misses semantically similar content           | 94    | Open   |
| OB-F81 | Memory retrieval returns full results — no progressive disclosure | 🟡 Medium | Every search loads full content, wastes tokens; no index → filter → detail flow | 94    | Open   |
| OB-F85 | No self-diagnostic command (`openbridge doctor`)                  | 🟡 Medium | Users can't verify their setup — no health check for dependencies, configs, DB  | 96a   | Open   |
| OB-F86 | No pairing-based auth for messaging channels                      | 🟡 Medium | Adding users requires config edits — no self-service approval flow via DM       | 96b   | Open   |
| OB-F87 | No skills directory or SKILL.md pattern                           | 🟡 Medium | Master can't discover and use reusable capabilities — no plugin skill system    | 96c   | Open   |

### Open Findings — Sprint 6 (v0.0.14)

Skill system, agent orchestration, and creative output patterns. These build on Sprint 5 foundations.

| #       | Finding                                                               | Severity  | Improvement Impact                                                                                                           | Inspired By             | Status |
| ------- | --------------------------------------------------------------------- | --------- | ---------------------------------------------------------------------------------------------------------------------------- | ----------------------- | ------ |
| OB-F96  | No skill pack system — workers have no domain-specific knowledge      | 🟠 High   | Workers get generic prompts for all tasks. No reusable instruction sets for security, design, docs, data analysis, etc.      | awesome-claude-skills   | Open   |
| OB-F97  | No planning gate — Master jumps to execution without analysis phase   | 🟠 High   | Master spawns code-edit workers immediately instead of read-only analysis first. Devin's plan→execute pattern reduces errors | system-prompts (Devin)  | Open   |
| OB-F99  | No design/creative output — can't generate visual assets              | 🟡 Medium | No support for diagrams, charts, generative art, or visual design. Business owners need marketing/presentation visuals       | awesome-claude-skills   | Open   |
| OB-F100 | No worker swarm grouping — flat worker spawning only                  | 🟡 Medium | Independent workers can't be grouped into coordinated phases (research→implement→review). No handoff between groups          | system-prompts (Manus)  | Open   |
| OB-F101 | No test protection rule — workers can modify test files freely        | 🟡 Medium | Workers may weaken test assertions to make tests pass instead of fixing actual code. Devin explicitly prevents this          | system-prompts (Devin)  | Open   |
| OB-F102 | No iteration cap on fix loops — workers retry lint/test fixes forever | 🟡 Medium | Worker stuck in fix→fail→fix cycle wastes turns and budget. Cursor caps at 3 iterations before escalating                    | system-prompts (Cursor) | Open   |

---

## Finding History

| Version  | Findings Fixed | Cumulative |
| -------- | -------------- | ---------- |
| v0.0.1   | 30             | 30         |
| v0.0.2   | 8              | 38         |
| v0.0.3   | 6              | 44         |
| v0.0.4   | 5              | 49         |
| v0.0.5   | 3              | 52         |
| v0.0.6   | 2              | 54         |
| v0.0.7   | 2              | 56         |
| v0.0.8   | 1              | 57         |
| v0.0.9   | 11             | 68         |
| v0.0.10  | 10             | 78         |
| v0.0.11  | 10             | 88         |
| v0.0.12  | 30             | 118        |
| Phase 97 | 7              | 125        |

---
