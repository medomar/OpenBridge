# OpenBridge — Findings Archive v21

> **Sprint 4: Platform Completion (v0.0.12)**
> **Archived:** 2026-03-05
> **Findings resolved:** 30 (OB-F56, F69, F72–F75, F89, F91, F93–F114, OB-193)
> **Previous archive:** [V20 archive](../v20/TASKS-v20-v009-v011-phases-74-86-deep1.md)

---

## Resolved Findings in Sprint 4

### Tier 1b — Real-World Testing (2026-03-02)

| #      | Finding                                                        | Severity    | Resolution                                                |
| ------ | -------------------------------------------------------------- | ----------- | --------------------------------------------------------- |
| OB-F89 | Codex worker streaming output is raw JSON — not parsed         | 🔴 Critical | RWT-1: Codex JSONL parser + streaming transform (6 tasks) |
| OB-F91 | Codex workers waste turns on shell gymnastics instead of tools | 🟠 High     | RWT-3: Tool profile validation + system prompt (5 tasks)  |

### Tier 1c — Runtime Issues (2026-03-05 Telegram session)

| #       | Finding                                                    | Severity    | Resolution                                                        |
| ------- | ---------------------------------------------------------- | ----------- | ----------------------------------------------------------------- |
| OB-F95  | Worker re-spawn crash after escalation grant               | 🔴 Critical | Phase 99: Register worker before spawn, error handling (5 tasks)  |
| OB-F96  | Escalation state cleared before all workers granted        | 🟠 High     | Phase 99: Escalation queue, /allow all, /deny all (7 tasks)       |
| OB-F97  | Escalation timeout too short for multi-worker spawns       | 🟡 Medium   | Phase 99: Scaled timeout + reminder at 50% (4 tasks)              |
| OB-F98  | Misclassification of strategic/brainstorming messages      | 🟠 High     | Phase 100: Complex-task keywords + length heuristic (5 tasks)     |
| OB-F99  | RAG returns zero results for real user questions           | 🟡 Medium   | Phase 100: FTS5 query fix + fallback + short msg skip (5 tasks)   |
| OB-F100 | Single-character messages trigger full agent invocations   | 🟢 Low      | Phase 100: Menu-selection task class (3 tasks)                    |
| OB-F101 | Codex worker cost spike ($1.14 for read-only task)         | 🟡 Medium   | Phase 102: Per-profile cost caps + warnings (4 tasks)             |
| OB-F102 | Master response truncated to empty after SPAWN removal     | 🟡 Medium   | Phase 100: Generate summary from SPAWN markers (3 tasks)          |
| OB-F103 | Orphaned workers never reach terminal state                | 🔴 Critical | Phase 99: Watchdog timer + /workers command (6 tasks)             |
| OB-F104 | Workers exhaust max-turns without completing               | 🟡 Medium   | Phase 102: Partial status + adaptive maxTurns (4 tasks)           |
| OB-F105 | Master tool selection flow redundant and confusing         | 🟡 Medium   | Phase 103: Consolidated log + verbose flag (2 tasks)              |
| OB-F106 | Whitelist normalization drops entries without details      | 🟡 Medium   | Phase 103: Per-entry drop reason logging (2 tasks)                |
| OB-F107 | `.env.example` incorrectly flagged as sensitive file       | 🟢 Low      | Phase 103: Whitelist template files + config exceptions (2 tasks) |
| OB-F108 | Batch continuation timers not cancelled on shutdown        | 🟡 Medium   | Phase 101: Timer tracking set + shutdown cleanup (2 tasks)        |
| OB-F109 | Unhandled rejections in batch continuation fire-and-forget | 🟡 Medium   | Phase 101: .catch() handlers + pause-on-error (1 task)            |
| OB-F110 | Docker sandbox `exec()` reads wrong exit code property     | 🟡 Medium   | Phase 103: Read .status instead of .code (1 task)                 |
| OB-F111 | Docker sandbox has no container cleanup on process crash   | 🟡 Medium   | Phase 103: Container ID tracking + exit handlers (1 task)         |
| OB-F112 | Batch sender info not persisted across process restarts    | 🟢 Low      | Phase 101: Persist senderInfo in batch state JSON (1 task)        |
| OB-F113 | 37 test failures from stale mocks after Phase 98           | 🟠 High     | Phase 104: Fix mocks in 5 test files (5 tasks)                    |
| OB-F114 | `getActiveBatchId()` inconsistent with `isActive()`        | 🟢 Low      | Phase 101: Rename to getCurrentBatchId + JSDoc (1 task)           |

### Tier 2b — Platform Completion

| #      | Finding                                   | Severity    | Resolution                                                     |
| ------ | ----------------------------------------- | ----------- | -------------------------------------------------------------- |
| OB-F56 | No multi-phase "deep mode"                | 🟡 Medium   | Phase Deep: Full 5-phase state machine + commands (35 tasks)   |
| OB-F69 | No delivery path for interactive web apps | 🟠 High     | Phases 82–84: Tunnel + app server + relay (30 tasks)           |
| OB-F72 | No document visibility controls           | 🟡 Medium   | Phase 87: Include/exclude rules + secret scanner (14 tasks)    |
| OB-F73 | WebChat has no authentication             | 🔴 Critical | Phase 89: Token/password auth + sessions (12 tasks)            |
| OB-F74 | WebChat UI is inlined HTML string         | 🟠 High     | Phases 88, 91–92: Extracted UI + history + settings (42 tasks) |
| OB-F75 | WebChat not accessible from phone         | 🟠 High     | Phase 90: LAN/tunnel + PWA + responsive (15 tasks)             |
| OB-F93 | No runtime permission escalation          | 🟠 High     | Phase 97: Escalation queue + grants + persistence (20 tasks)   |
| OB-F94 | No batch task continuation                | 🟠 High     | Phase 98: Self-messaging loop + state machine (22 tasks)       |
| OB-193 | No Docker sandbox for workers             | 🟡 Medium   | Phase Docker: Container isolation + cleanup (16 tasks)         |

---

**Total findings resolved in v21 archive: 30**
**Cumulative findings resolved (all archives): 118**
