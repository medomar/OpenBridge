# OpenBridge — Task List

> **Pending:** 68 tasks | **In Progress:** 0
> **Last Updated:** 2026-02-25
> **Completed work:** [V0 (Phases 1–5)](archive/v0/TASKS-v0.md) | [V1 (Phases 6–10)](archive/v1/TASKS-v1.md) | [V2 (Phases 11–14)](archive/v2/TASKS-v2.md) | [MVP (Phase 15)](archive/v3/TASKS-v3-mvp.md) | [Self-Governing (Phases 16–21)](archive/v4/TASKS-v4-self-governing.md) | [E2E + Channels (Phases 22–24)](archive/v5/TASKS-v5-e2e-channels.md) | [Smart Orchestration (Phases 25–28)](archive/v6/TASKS-v6-smart-orchestration.md) | [AI Classification (Phase 29)](archive/v7/TASKS-v7-ai-classification.md) | [Production Readiness (Phase 30)](archive/v8/TASKS-v8-production-readiness.md)

---

## Planned — Track A: Memory & Intelligence

> Full roadmap with design notes: [docs/ROADMAP.md](../ROADMAP.md)
> Milestone details: [milestones/](milestones/)

### Phase 31: Memory Foundation — [v0.1.0](milestones/v0.1.0-memory-system.md)

| #   | Task                                                           | ID     | Priority |  Status   |
| --- | -------------------------------------------------------------- | ------ | :------: | :-------: |
| 208 | Add `better-sqlite3` dependency + TypeScript types             | OB-700 | 🔴 High  | ◻ Pending |
| 209 | Create `src/memory/database.ts` — DB init, WAL mode, PRAGMA    | OB-701 | 🔴 High  | ◻ Pending |
| 210 | Create full schema (9 tables + 2 FTS virtual tables + indexes) | OB-702 | 🔴 High  | ◻ Pending |
| 211 | Create `src/memory/index.ts` — MemoryManager public API        | OB-703 | 🔴 High  | ◻ Pending |
| 212 | Create `src/memory/chunk-store.ts` — context chunks CRUD       | OB-704 | 🔴 High  | ◻ Pending |
| 213 | Create `src/memory/task-store.ts` — tasks + learnings CRUD     | OB-705 | 🔴 High  | ◻ Pending |
| 214 | Create `src/memory/conversation-store.ts` — message CRUD       | OB-706 | 🔴 High  | ◻ Pending |
| 215 | Create `src/memory/prompt-store.ts` — versioned prompts        | OB-707 | 🔴 High  | ◻ Pending |
| 216 | Create `src/memory/migration.ts` — JSON → SQLite migration     | OB-708 | 🔴 High  | ◻ Pending |
| 217 | Create `src/memory/eviction.ts` — data lifecycle + cleanup     | OB-709 |  🟡 Med  | ◻ Pending |
| 218 | Integrate MemoryManager into Bridge startup                    | OB-710 | 🔴 High  | ◻ Pending |
| 219 | Replace DotFolderManager reads/writes with MemoryManager       | OB-711 | 🔴 High  | ◻ Pending |
| 220 | Remove `.openbridge/.git` — DB transactions replace git safety | OB-712 |  🟡 Med  | ◻ Pending |
| 221 | Tests for all memory modules                                   | OB-713 | 🔴 High  | ◻ Pending |

### Phase 32: Intelligent Retrieval + Worker Briefing — [v0.1.0](milestones/v0.1.0-memory-system.md)

| #   | Task                                                               | ID     | Priority |  Status   |
| --- | ------------------------------------------------------------------ | ------ | :------: | :-------: |
| 222 | Create `src/memory/retrieval.ts` — hybrid FTS5 search engine       | OB-720 | 🔴 High  | ◻ Pending |
| 223 | AI-powered reranking — use device AI for semantic result reranking | OB-721 | 🔴 High  | ◻ Pending |
| 224 | Create `src/memory/worker-briefing.ts` — context package builder   | OB-722 | 🔴 High  | ◻ Pending |
| 225 | Integrate briefing into MasterManager.spawnWorker() flow           | OB-723 | 🔴 High  | ◻ Pending |
| 226 | Adaptive model selection — query learnings for best model per task | OB-724 | 🔴 High  | ◻ Pending |
| 227 | Exploration chunking — store results as granular ~500-token chunks | OB-725 | 🔴 High  | ◻ Pending |
| 228 | Incremental chunk refresh — only re-explore stale scopes           | OB-726 |  🟡 Med  | ◻ Pending |
| 229 | Tests for retrieval and briefing                                   | OB-727 | 🔴 High  | ◻ Pending |

### Phase 35: Conversation Memory + Prompt Evolution — [v0.2.0](milestones/v0.2.0-smart-system.md)

| #   | Task                                                                         | ID     | Priority |  Status   |
| --- | ---------------------------------------------------------------------------- | ------ | :------: | :-------: |
| 241 | Record all user↔Master messages to conversations table                       | OB-730 | 🔴 High  | ◻ Pending |
| 242 | Context retrieval — inject relevant past conversations into Master prompt    | OB-731 | 🔴 High  | ◻ Pending |
| 243 | Classification learning loop — feedback improves future classification       | OB-732 |  🟡 Med  | ◻ Pending |
| 244 | Prompt effectiveness tracking — measure success rate per prompt version      | OB-733 |  🟡 Med  | ◻ Pending |
| 245 | Prompt evolution — auto-generate improved prompt variations                  | OB-734 |  🟡 Med  | ◻ Pending |
| 246 | System prompt enrichment — inject learned patterns into Master system prompt | OB-735 | 🔴 High  | ◻ Pending |
| 247 | Conversation eviction — 30/90 day policy with auto-summarization             | OB-736 |  🟡 Med  | ◻ Pending |
| 248 | Tests for conversation memory and prompt evolution                           | OB-737 | 🔴 High  | ◻ Pending |

### Phase 36: Agent Dashboard + Exploration Progress — [v0.3.0](milestones/v0.3.0-visibility.md)

| #   | Task                                                                         | ID     | Priority |  Status   |
| --- | ---------------------------------------------------------------------------- | ------ | :------: | :-------: |
| 249 | `agent_activity` table — real-time agent/worker status tracking              | OB-740 | 🔴 High  | ◻ Pending |
| 250 | `exploration_progress` table — per-phase, per-directory progress             | OB-741 | 🔴 High  | ◻ Pending |
| 251 | Wire agent lifecycle events — INSERT on spawn, UPDATE on progress/completion | OB-742 | 🔴 High  | ◻ Pending |
| 252 | "status" command — user queries active agents via any channel                | OB-743 | 🔴 High  | ◻ Pending |
| 253 | WebChat dashboard — live agent activity view with progress bars              | OB-744 |  🟡 Med  | ◻ Pending |
| 254 | Exploration progress tracking — parallel directory dives with percentages    | OB-745 | 🔴 High  | ◻ Pending |
| 255 | Cost tracking — per-agent and per-day cost accumulation                      | OB-746 |  🟡 Med  | ◻ Pending |
| 256 | Tests for dashboard and exploration progress                                 | OB-747 | 🔴 High  | ◻ Pending |

---

## Planned — Track B: User-Facing Features

### Phase 33: Media & Proactive Messaging — [v0.2.0](milestones/v0.2.0-smart-system.md)

| #   | Task                                                 | ID     | Priority |  Status   |
| --- | ---------------------------------------------------- | ------ | :------: | :-------: |
| 230 | Extend OutboundMessage with media/attachment support | OB-600 | 🔴 High  | ◻ Pending |
| 231 | WhatsApp: send to specific number (proactive)        | OB-601 | 🔴 High  | ◻ Pending |
| 232 | WhatsApp: send file/document attachments             | OB-602 | 🔴 High  | ◻ Pending |
| 233 | WhatsApp: receive and transcribe voice messages      | OB-605 |  🟡 Med  | ◻ Pending |
| 234 | WhatsApp: send voice replies (TTS)                   | OB-606 |  🟢 Low  | ◻ Pending |
| 235 | WebChat: file download support                       | OB-607 |  🟡 Med  | ◻ Pending |

### Phase 34: Content Publishing & Sharing — [v0.2.0](milestones/v0.2.0-smart-system.md)

| #   | Task                                                          | ID     | Priority |  Status   |
| --- | ------------------------------------------------------------- | ------ | :------: | :-------: |
| 236 | Local file server — serve generated content via HTTP          | OB-610 | 🔴 High  | ◻ Pending |
| 237 | Share via WhatsApp — send generated files as attachments      | OB-611 | 🔴 High  | ◻ Pending |
| 238 | Share via email — SMTP integration for sending files          | OB-612 |  🟡 Med  | ◻ Pending |
| 239 | GitHub Pages publish — push HTML to gh-pages branch           | OB-613 |  🟡 Med  | ◻ Pending |
| 240 | Shareable link generation — unique URLs for generated content | OB-614 |  🟡 Med  | ◻ Pending |

---

## Planned — Scale & Team

### Phase 37: Access Control + Hierarchical Masters — [v0.4.0](milestones/v0.4.0-scale.md)

| #   | Task                                                                             | ID     | Priority |  Status   |
| --- | -------------------------------------------------------------------------------- | ------ | :------: | :-------: |
| 257 | Access control DB table + role definitions (owner/admin/developer/viewer/custom) | OB-750 | 🔴 High  | ◻ Pending |
| 258 | Access control enforcement in auth layer — scopes, actions, daily budget         | OB-751 | 🔴 High  | ◻ Pending |
| 259 | Access control CLI — `npx openbridge access add +1234567890 --role developer`    | OB-752 |  🟡 Med  | ◻ Pending |
| 260 | Sub-master detection — auto-detect large sub-projects by size/complexity         | OB-753 | 🔴 High  | ◻ Pending |
| 261 | Sub-master lifecycle — spawn/manage independent sub-master DBs                   | OB-754 | 🔴 High  | ◻ Pending |
| 262 | Root-to-sub-master delegation — cross-cutting task routing                       | OB-755 | 🔴 High  | ◻ Pending |
| 263 | `sub_masters` registry table in root DB                                          | OB-756 | 🔴 High  | ◻ Pending |
| 264 | Tests for access control and hierarchical masters                                | OB-757 | 🔴 High  | ◻ Pending |

### Phase 38: Server Deployment Mode — [v0.4.0](milestones/v0.4.0-scale.md)

| #   | Task                                                          | ID     | Priority |  Status   |
| --- | ------------------------------------------------------------- | ------ | :------: | :-------: |
| 265 | Headless startup mode — no QR code display dependency         | OB-760 | 🔴 High  | ◻ Pending |
| 266 | Remote workspace via git clone + auto-pull on changes         | OB-761 | 🔴 High  | ◻ Pending |
| 267 | Docker container image (Dockerfile + docker-compose)          | OB-762 | 🔴 High  | ◻ Pending |
| 268 | Environment-based configuration — all config via ENV vars     | OB-763 |  🟡 Med  | ◻ Pending |
| 269 | Health check + monitoring endpoints for server operation      | OB-764 |  🟡 Med  | ◻ Pending |
| 270 | Deployment documentation — VPS, Docker, cloud provider guides | OB-765 |  🟡 Med  | ◻ Pending |

### Phase 39: Agent Orchestration — [v1.0.0](milestones/v1.0.0-team.md)

| #   | Task                                                                    | ID     | Priority |  Status   |
| --- | ----------------------------------------------------------------------- | ------ | :------: | :-------: |
| 271 | Role-based worker types (Architect, Coder, Tester, Reviewer)            | OB-770 | 🔴 High  | ◻ Pending |
| 272 | Task dependency chains — Architect → Coder → Tester → Reviewer pipeline | OB-771 | 🔴 High  | ◻ Pending |
| 273 | Worker synchronization via DB — shared state coordination               | OB-772 | 🔴 High  | ◻ Pending |
| 274 | Parallel worker conflict detection — same-file edit resolution          | OB-773 |  🟡 Med  | ◻ Pending |
| 275 | Worker result validation — auto-verify output (tests/typecheck)         | OB-774 |  🟡 Med  | ◻ Pending |

---

## Backlog — Unscheduled

| Task                                                                 | ID     | Priority |
| -------------------------------------------------------------------- | ------ | :------: |
| Docker sandbox — run workers in containers for untrusted workspaces  | OB-193 |  🟢 Low  |
| Interactive AI views — AI generates reports/dashboards on local HTTP | OB-124 |  🟢 Low  |
| E2E test: Business files use case (CSV workspace)                    | OB-306 |  🟢 Low  |
| Skill creator — Master creates reusable skill templates              | OB-192 |  🟢 Low  |
| Context compaction — progressive summarization                       | OB-190 |  🟡 Med  |
| Scheduled tasks — cron-like task scheduling                          | —      |  🟢 Low  |
| AI tool marketplace — community connectors and providers             | —      |  🟢 Low  |
| Webhook connector — HTTP endpoint for CI/CD integration              | —      |  🟢 Low  |
| PDF generation — HTML-to-PDF conversion                              | —      |  🟢 Low  |
| Secrets management — encrypted token storage                         | —      |  🟢 Low  |
| WhatsApp session persistence — avoid re-scan                         | —      |  🟢 Low  |

---

## Completed Milestones

**Phases 1–14 (98 tasks):** MVP — Connectors, bridge core, AI discovery, Master AI, exploration, delegation.

**Phases 16–21 (34 tasks):** Self-Governing Master — AgentRunner, tool profiles, model selection, worker orchestration, self-improvement.

**Phases 22–24 (17 tasks):** E2E hardening, production polish, 5 connectors (Console, WhatsApp, Telegram, WebChat, Discord), incremental exploration.

**Phases 25–28 (16 tasks):** Smart Orchestration — keyword task classifier, auto-delegation via SPAWN markers, worker turn budgets, progress feedback, workspace mapping reliability, connector hardening, test fixes, docs update.

**Phase 29 (8 tasks):** AI Classification + Live Progress — replaced keyword classifier with AI-powered intent classification, added live progress events across all 5 connectors.

**Phase 30 (30 tasks):** Production Readiness v0.0.1 — npm packaging, process resilience, logging, security hardening, documentation accuracy, CI/CD pipeline, test coverage, CLI polish, API surface cleanup, final verification + tag.

**Hotfixes (2026-02-22–23):** Master session ID format, exploration timeout, stdin pipe hang, env var contamination, Zod passthrough, WhatsApp --single-process removal, incremental workspace change detection.

**Total completed: 207 tasks across 30 phases.**

---

## Status Legend

|     Status     | Meaning                   |
| :------------: | ------------------------- |
|   ◻ Pending    | Not started               |
| 🔄 In Progress | Currently being worked on |
|    ✅ Done     | Completed and verified    |
