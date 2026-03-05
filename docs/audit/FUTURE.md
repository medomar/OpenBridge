# OpenBridge — Future Work

> **Purpose:** Planned features, deferred findings, finalization items, and backlog for future versions.
> **Last Updated:** 2026-03-05 | **Current Release:** v0.0.12 (Phases 1–104 + Deep, 1045 tasks shipped)
> **10 open findings** — all community-inspired (v0.0.13). See [FINDINGS.md](FINDINGS.md) for details.

---

## Completed Development Track (v0.0.1 → v0.0.12)

All planned sprints through v0.0.12 are complete:

| Sprint    | Version  | Tasks    | Phases                    | Status     |
| --------- | -------- | -------- | ------------------------- | ---------- |
| —         | v0.0.1–8 | 652      | 1–73                      | ✅ Shipped |
| 1         | v0.0.9   | 34       | 78a–80                    | ✅ Shipped |
| 2         | v0.0.10  | 43       | 74–77, 85                 | ✅ Shipped |
| 3         | v0.0.11  | 20       | 81, 86                    | ✅ Shipped |
| 4         | v0.0.12  | 281      | RWT, Deep, 82–104, Docker | ✅ Shipped |
| **Total** |          | **1045** |                           |            |

Sprint 4 delivered: Real-world testing fixes (Codex streaming, RAG, classifier), Deep Mode (5-phase state machine), tunnel + app server + relay, WebChat modernization (extracted UI, auth, PWA, history, settings), runtime permission escalation, batch task continuation, Docker sandbox, and 67 runtime fix tasks from production testing.

All task archives: [docs/audit/archive/](archive/) (v0–v21).

---

## Pre-Sprint: Phase 97 — Data Integrity Fixes (18 tasks)

**Goal:** Fix 7 broken data pipelines discovered by auditing `.openbridge/openbridge.db`. Findings OB-F89 through OB-F95.

**Must complete before Sprint 5** — these are foundational fixes (session lifecycle, turns tracking, QA cache, prompt evolution, memory.md reliability) that Sprint 5 features depend on. See [TASKS.md](TASKS.md) for the full task breakdown.

| Finding | Issue                               | Severity  | Tasks | Effort |
| ------- | ----------------------------------- | --------- | ----- | ------ |
| OB-F89  | Audit log disabled by default       | 🟡 Medium | 2     | Small  |
| OB-F90  | QA cache write path missing         | 🟠 High   | 3     | Medium |
| OB-F91  | Sessions never close                | 🟠 High   | 3     | Small  |
| OB-F92  | Learnings turns always 0            | 🟠 High   | 3     | Small  |
| OB-F93  | Prompt evolution never activates    | 🟡 Medium | 2     | Small  |
| OB-F94  | Sub-master detection never triggers | 🟡 Medium | 2     | Medium |
| OB-F95  | memory.md goes stale                | 🟠 High   | 3     | Medium |

---

## Next: Sprint 5 — Community-Inspired Improvements (v0.0.13) — ~95–110 tasks

**Goal:** Level up OpenBridge's memory system, developer experience, and security by adopting battle-tested patterns from the open-source community. Inspired by analysis of [openclaw/openclaw](https://github.com/openclaw/openclaw) (242K stars, 13+ channels, vector memory, skills platform) and [thedotmack/claude-mem](https://github.com/thedotmack/claude-mem) (32K stars, structured observations, progressive disclosure, token economics).

**Why now (after v0.0.12):** v0.0.9–v0.0.12 makes OpenBridge functional and secure. v0.0.13 makes it _competitive_ — adopting patterns that successful community projects have validated at scale.

### Phase 93 — Structured Observations & Worker Summaries (~20–22 tasks)

**Findings:** OB-F80, OB-F88, OB-F82

**Problem:** Worker outputs are unstructured text. No typed facts, concepts, files_touched, or next_steps. Duplicate chunks accumulate during overlapping reads. The Master loses track of incomplete work.

**Inspired by:** [claude-mem's observation system](https://github.com/thedotmack/claude-mem) — typed observations with title, narrative, facts, concepts, files_read, files_modified. Content-hash deduplication with 30s window. Session summaries with `request/investigated/learned/completed/next_steps`.

| Task | Finding | What                                                                                                                                                                                        | Key File                                       |
| ---- | ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------- |
| 1    | OB-F80  | Add `observations` table to SQLite schema — `id`, `session_id`, `type`, `title`, `narrative`, `facts` (JSON), `concepts` (JSON), `files_read` (JSON), `files_modified` (JSON), `created_at` | `src/memory/database.ts`                       |
| 2    | OB-F80  | Create `observation-store.ts` — CRUD for observations, FTS5 virtual table                                                                                                                   | `src/memory/observation-store.ts` (new)        |
| 3    | OB-F80  | Add FTS5 sync triggers for observations (INSERT, UPDATE, DELETE)                                                                                                                            | `src/memory/database.ts`                       |
| 4    | OB-F80  | Create `observation-extractor.ts` — parse worker results into structured observations using lightweight AI call (haiku-tier, 1-turn, all tools disabled)                                    | `src/master/observation-extractor.ts` (new)    |
| 5    | OB-F80  | Define observation type taxonomy: `bugfix`, `architecture`, `investigation`, `refactor`, `test-result`, `dependency`, `config`, `documentation`                                             | `src/types/agent.ts`                           |
| 6    | OB-F80  | Wire extractor into `worker-result-formatter.ts` — extract observations after every worker completes                                                                                        | `src/master/worker-result-formatter.ts`        |
| 7    | OB-F80  | Expose observations in `retrieval.ts` for RAG queries                                                                                                                                       | `src/memory/retrieval.ts`                      |
| 8    | OB-F88  | Define `WorkerSummary` Zod schema: `{ request, investigated, completed, learned, next_steps, files_modified, files_read }`                                                                  | `src/types/agent.ts`                           |
| 9    | OB-F88  | Update `worker-result-formatter.ts` to extract structured summaries                                                                                                                         | `src/master/worker-result-formatter.ts`        |
| 10   | OB-F88  | Store summaries in `agent_activity` table (extend schema with summary columns)                                                                                                              | `src/memory/activity-store.ts`                 |
| 11   | OB-F88  | Master reads `next_steps` from recent worker summaries for context injection                                                                                                                | `src/master/master-system-prompt.ts`           |
| 12   | OB-F88  | Auto-update `memory.md` with `learned` items from worker summaries                                                                                                                          | `src/master/dotfolder-manager.ts`              |
| 13   | OB-F82  | Add `content_hash` column (SHA-256) to `workspace_chunks` table                                                                                                                             | `src/memory/chunk-store.ts`                    |
| 14   | OB-F82  | Before INSERT, check for existing chunk with same hash — update timestamp if exists                                                                                                         | `src/memory/chunk-store.ts`                    |
| 15   | OB-F82  | Add 30-second deduplication window for rapid successive writes                                                                                                                              | `src/memory/chunk-store.ts`                    |
| 16   | OB-F82  | Migration to backfill content hashes for existing chunks                                                                                                                                    | `src/memory/migration.ts`                      |
| 17   | —       | Wire `observation-store.ts` into `MemoryManager` facade                                                                                                                                     | `src/memory/index.ts`                          |
| 18   | —       | Add migration for observations table + FTS5                                                                                                                                                 | `src/memory/migration.ts`                      |
| 19   | —       | Tests: observation extraction, deduplication, summary parsing                                                                                                                               | `tests/memory/observation-store.test.ts`       |
| 20   | —       | Tests: worker summary schema, next_steps injection                                                                                                                                          | `tests/master/worker-result-formatter.test.ts` |

---

### Phase 94 — Vector Search & Hybrid Retrieval (~18–20 tasks)

**Findings:** OB-F79, OB-F81

**Problem:** FTS5 only returns keyword matches. No semantic search. Full results returned for every query — no token-efficient progressive disclosure.

**Inspired by:** [openclaw's memory system](https://github.com/openclaw/openclaw) — `sqlite-vec` for vector storage, hybrid search (vector + FTS5 + metadata filters), MMR for diversity, temporal decay scoring. [claude-mem's progressive disclosure](https://github.com/thedotmack/claude-mem) — 3-layer retrieval with ~10x token savings.

| Task | Finding | What                                                                                                         | Key File                                 |
| ---- | ------- | ------------------------------------------------------------------------------------------------------------ | ---------------------------------------- |
| 1    | OB-F79  | Add `sqlite-vec` dependency to `package.json`                                                                | `package.json`                           |
| 2    | OB-F79  | Add `embeddings` vector table to SQLite schema — `chunk_id`, `vector` (float32), `model`, `created_at`       | `src/memory/database.ts`                 |
| 3    | OB-F79  | Create `embedding-provider.ts` — abstract interface for embedding generation                                 | `src/memory/embedding-provider.ts` (new) |
| 4    | OB-F79  | Implement OpenAI embedding provider (`text-embedding-3-small`)                                               | `src/memory/embeddings/openai.ts` (new)  |
| 5    | OB-F79  | Implement local embedding provider (Ollama `nomic-embed-text` or similar)                                    | `src/memory/embeddings/local.ts` (new)   |
| 6    | OB-F79  | Add `memory.embedding` config section — provider selection, model, batch size                                | `src/types/config.ts`                    |
| 7    | OB-F79  | Batch embedding during exploration — embed chunks as they're stored                                          | `src/memory/chunk-store.ts`              |
| 8    | OB-F79  | Vector similarity search via `sqlite-vec` — `knn_search()` with cosine distance                              | `src/memory/retrieval.ts`                |
| 9    | OB-F79  | Hybrid search strategy — combine vector score + FTS5 score + metadata filters                                | `src/memory/retrieval.ts`                |
| 10   | OB-F79  | MMR (Maximal Marginal Relevance) — diversify results, prevent 5 chunks from same file                        | `src/memory/retrieval.ts`                |
| 11   | OB-F79  | Temporal decay — recent chunks rank higher (configurable decay rate)                                         | `src/memory/retrieval.ts`                |
| 12   | OB-F79  | Graceful fallback — if no embedding provider configured, use FTS5-only (current behavior)                    | `src/memory/retrieval.ts`                |
| 13   | OB-F81  | Add `searchIndex()` method — returns compact results: `{ id, title, score, snippet(50 chars), source_file }` | `src/memory/retrieval.ts`                |
| 14   | OB-F81  | Add `getDetails(ids: string[])` method — returns full content for selected IDs only                          | `src/memory/retrieval.ts`                |
| 15   | OB-F81  | Wire 2-step retrieval into Master's RAG flow: searchIndex → filter → getDetails                              | `src/core/knowledge-retriever.ts`        |
| 16   | OB-F81  | Update Master system prompt to teach 2-step retrieval pattern                                                | `src/master/master-system-prompt.ts`     |
| 17   | —       | Migration: embeddings table + sqlite-vec initialization                                                      | `src/memory/migration.ts`                |
| 18   | —       | Tests: vector search, hybrid ranking, MMR, progressive disclosure                                            | `tests/memory/retrieval.test.ts`         |

**Note:** This phase enhances the RAG system built in Phases 74–77 (v0.0.10). If embedding providers require API keys, this is opt-in — the "zero API keys" principle is preserved by defaulting to FTS5-only and supporting local Ollama embeddings.

---

### Phase 95 — Session Compaction & Token Economics (~16–18 tasks)

**Findings:** OB-F84, OB-F83

**Problem:** Long Master sessions lose context silently when the window fills. No visibility into exploration cost vs retrieval savings.

**Inspired by:** [openclaw's session compaction](https://github.com/openclaw/openclaw) — auto-summarizes when context window fills, preserves identifiers, retries on failure. [claude-mem's token economics](https://github.com/thedotmack/claude-mem) — tracks discovery vs read tokens, computes compression ROI.

| Task | Finding | What                                                                                                                             | Key File                                 |
| ---- | ------- | -------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------- |
| 1    | OB-F84  | Create `SessionCompactor` class — monitors Master session turn count                                                             | `src/master/session-compactor.ts` (new)  |
| 2    | OB-F84  | Trigger compaction when Master session exceeds 80% of `--max-turns`                                                              | `src/master/session-compactor.ts`        |
| 3    | OB-F84  | Compaction strategy: summarize old turns into structured summary (preserve identifiers: file paths, function names, finding IDs) | `src/master/session-compactor.ts`        |
| 4    | OB-F84  | Write compaction summary to `memory.md` before starting new session segment                                                      | `src/master/session-compactor.ts`        |
| 5    | OB-F84  | Identifier extraction — scan conversation for file paths, function names, finding IDs that must survive compaction               | `src/master/session-compactor.ts`        |
| 6    | OB-F84  | Retry on compaction failure — don't lose the session silently                                                                    | `src/master/session-compactor.ts`        |
| 7    | OB-F84  | Wire compactor into `master-manager.ts` — check after each Master turn                                                           | `src/master/master-manager.ts`           |
| 8    | OB-F84  | Add `compaction_history` table — track when compactions happen, what was summarized                                              | `src/memory/database.ts`                 |
| 9    | OB-F83  | Add `token_economics` table — `chunk_id`, `discovery_tokens`, `retrieval_count`, `total_read_tokens`                             | `src/memory/database.ts`                 |
| 10   | OB-F83  | Track `discovery_tokens` per chunk — estimate from worker turn count × model token rate                                          | `src/memory/chunk-store.ts`              |
| 11   | OB-F83  | Track `read_tokens` per retrieval — count tokens in returned content                                                             | `src/memory/retrieval.ts`                |
| 12   | OB-F83  | Increment `retrieval_count` on each chunk access                                                                                 | `src/memory/retrieval.ts`                |
| 13   | OB-F83  | Add `/stats` chat command — show exploration ROI: "Explored with ~50K tokens, saved ~200K tokens across 15 retrievals (4x ROI)"  | `src/core/router.ts`                     |
| 14   | OB-F83  | Add `openbridge stats` CLI command (same output as `/stats`)                                                                     | `src/cli/index.ts`                       |
| 15   | —       | Migration: compaction_history + token_economics tables                                                                           | `src/memory/migration.ts`                |
| 16   | —       | Tests: compaction trigger, identifier preservation, token tracking, /stats output                                                | `tests/master/session-compactor.test.ts` |

---

### Phase 96 — Developer Experience: Doctor, Pairing, Skills (~28–32 tasks)

**Findings:** OB-F85, OB-F86, OB-F87

**Problem:** No self-diagnostic tool. No self-service auth for non-phone channels. No reusable skills directory.

**Inspired by:** [openclaw's `doctor` command](https://github.com/openclaw/openclaw), [openclaw's DM pairing](https://github.com/openclaw/openclaw), [openclaw's skills platform](https://github.com/openclaw/openclaw) (60+ skills with `SKILL.md` files).

#### Phase 96a — `openbridge doctor` (~8–10 tasks)

| Task | Finding | What                                                                                    | Key File                  |
| ---- | ------- | --------------------------------------------------------------------------------------- | ------------------------- |
| 1    | OB-F85  | Create `doctor.ts` CLI command entry point                                              | `src/cli/doctor.ts` (new) |
| 2    | OB-F85  | Check: Node.js version >= 22                                                            | `src/cli/doctor.ts`       |
| 3    | OB-F85  | Check: AI tools detected (claude, codex, aider) with versions                           | `src/cli/doctor.ts`       |
| 4    | OB-F85  | Check: Config file valid (Zod parse with specific error messages)                       | `src/cli/doctor.ts`       |
| 5    | OB-F85  | Check: SQLite database healthy (integrity_check, schema version, table row counts)      | `src/cli/doctor.ts`       |
| 6    | OB-F85  | Check: `.openbridge/` state (stale memory.md, missing workspace-map, corrupted entries) | `src/cli/doctor.ts`       |
| 7    | OB-F85  | Check: Channel connectivity (bot tokens valid, session files exist)                     | `src/cli/doctor.ts`       |
| 8    | OB-F85  | Check: MCP servers reachable (health endpoints)                                         | `src/cli/doctor.ts`       |
| 9    | OB-F85  | Color-coded summary output with fix suggestions per failing check                       | `src/cli/doctor.ts`       |
| 10   | OB-F85  | Add `/doctor` chat command (runs same checks, sends via channel)                        | `src/core/router.ts`      |

#### Phase 96b — Pairing-Based Auth (~8–10 tasks)

| Task | Finding | What                                                                      | Key File                     |
| ---- | ------- | ------------------------------------------------------------------------- | ---------------------------- |
| 1    | OB-F86  | Generate 6-digit pairing code for unknown senders                         | `src/core/auth.ts`           |
| 2    | OB-F86  | Send pairing message: "To connect, ask the admin to approve code: 482917" | `src/core/auth.ts`           |
| 3    | OB-F86  | Add `openbridge pairing approve <code>` CLI command                       | `src/cli/access.ts`          |
| 4    | OB-F86  | Add `/approve <code>` chat command for owner approval                     | `src/core/router.ts`         |
| 5    | OB-F86  | Store approved pairing in `access-store.ts` with default role             | `src/memory/access-store.ts` |
| 6    | OB-F86  | Pairing code expiry — 5 minutes TTL, auto-cleanup                         | `src/core/auth.ts`           |
| 7    | OB-F86  | Rate limit pairing requests per sender (prevent code spam)                | `src/core/auth.ts`           |
| 8    | OB-F86  | Works alongside phone whitelist (not a replacement)                       | `src/core/auth.ts`           |
| 9    | OB-F86  | Add `auth.pairingEnabled` config option (default: true)                   | `src/types/config.ts`        |
| 10   | OB-F86  | Tests: pairing flow, expiry, rate limiting, CLI approval                  | `tests/core/auth.test.ts`    |

#### Phase 96c — Skills Directory (~10–12 tasks)

| Task | Finding | What                                                                                    | Key File                                         |
| ---- | ------- | --------------------------------------------------------------------------------------- | ------------------------------------------------ |
| 1    | OB-F87  | Create `SkillManager` class — discovers and loads skills from `.openbridge/skills/`     | `src/master/skill-manager.ts` (new)              |
| 2    | OB-F87  | Define `SKILL.md` format: name, description, tools needed, example prompts, constraints | `src/master/skill-manager.ts`                    |
| 3    | OB-F87  | Create built-in skill: `code-review`                                                    | `.openbridge/skills/code-review/SKILL.md`        |
| 4    | OB-F87  | Create built-in skill: `test-runner`                                                    | `.openbridge/skills/test-runner/SKILL.md`        |
| 5    | OB-F87  | Create built-in skill: `dependency-audit`                                               | `.openbridge/skills/dependency-audit/SKILL.md`   |
| 6    | OB-F87  | Create built-in skill: `api-docs-generator`                                             | `.openbridge/skills/api-docs-generator/SKILL.md` |
| 7    | OB-F87  | Master reads available skills on startup, includes in system prompt                     | `src/master/master-system-prompt.ts`             |
| 8    | OB-F87  | Master can create new skills from successful task patterns (extends prompt evolution)   | `src/master/skill-manager.ts`                    |
| 9    | OB-F87  | Add `/skills` chat command — list available skills                                      | `src/core/router.ts`                             |
| 10   | OB-F87  | Wire skill manager into `MemoryManager` facade                                          | `src/memory/index.ts`                            |
| 11   | OB-F87  | Tests: skill discovery, SKILL.md parsing, system prompt injection                       | `tests/master/skill-manager.test.ts`             |

---

### Sprint 5 Summary

| Phase     | Focus                                      | Findings               | Est. Tasks  | Key Community Reference                                                                                   |
| --------- | ------------------------------------------ | ---------------------- | ----------- | --------------------------------------------------------------------------------------------------------- |
| 93        | Structured Observations & Worker Summaries | OB-F80, OB-F82, OB-F88 | ~20–22      | [claude-mem](https://github.com/thedotmack/claude-mem)                                                    |
| 94        | Vector Search & Hybrid Retrieval           | OB-F79, OB-F81         | ~18–20      | [openclaw](https://github.com/openclaw/openclaw) + [claude-mem](https://github.com/thedotmack/claude-mem) |
| 95        | Session Compaction & Token Economics       | OB-F83, OB-F84         | ~16–18      | [openclaw](https://github.com/openclaw/openclaw) + [claude-mem](https://github.com/thedotmack/claude-mem) |
| 96        | Doctor + Pairing + Skills                  | OB-F85, OB-F86, OB-F87 | ~28–32      | [openclaw](https://github.com/openclaw/openclaw)                                                          |
| **Total** |                                            | **10 findings**        | **~95–110** |                                                                                                           |

**Dependencies:**

- **Phase 97 (data integrity) must complete first** — fixes session lifecycle, turns tracking, QA cache, and prompt evolution that Sprint 5 builds on
- Phase 93 (observations) should come after Phase 97 — depends on working learnings + prompt tracking
- Phase 94 (vector search) indexes observations from Phase 93
- Phase 95 (compaction) is independent — can run in parallel with Phase 96
- Phase 96 (doctor/pairing/skills) is independent — can run in any order

---

## Security Boundary Summary (v0.0.12 — Current State)

| Boundary             | Status                                                                |
| -------------------- | --------------------------------------------------------------------- |
| Workspace boundary   | `cwd` in spawn — AI is workspace-scoped                               |
| Tool restriction     | `--allowedTools` + profiles (read-only, code-edit, code-audit, full)  |
| Runtime escalation   | Users grant/deny tool upgrades via `/allow`/`/deny` (Phase 97)        |
| Phone whitelist      | Exact match                                                           |
| Daily budget         | Checked at message start + per-worker cost caps (Phase 102)           |
| Batch safety         | Iteration limit + cost budget + time limit (Phase 98)                 |
| Env var sanitization | Default deny-list (AWS/GH/TOKEN/SECRET/DB/...) (Phase 85)             |
| File visibility      | Include/exclude rules + auto-detect secrets (Phase 87)                |
| Content redaction    | Optional pattern-based redaction (Phase 87)                           |
| User consent         | Risk classification + confirmation for high-risk (Phase 86)           |
| Audit visibility     | Pino logs + `/audit` command + `.openbridge/audit/`                   |
| OS-level sandbox     | Docker containers for workers (Docker phase)                          |
| WebChat auth         | Token + password auth, sessions, rate limiting (Phase 89)             |
| Deep analysis        | Multi-phase Deep Mode: investigate → report → plan → execute → verify |
| Worker lifecycle     | Watchdog timer + state audit + `/workers` command (Phase 99)          |

---

## Deferred — Post v0.0.13

### Finalization Required (Phases 72–73 + MCP UI)

These features were scaffolded/built but have bugs and build issues. Not needed for the current development track (Console/WhatsApp/Telegram/WebChat channels work fine).

#### Standalone Binary Packaging (Phase 72) — Needs Testing & CI Fix

**Current state:** Scripts and config fully scaffolded. Never actually built or tested.

**Known issues:**

1. `release/` directory is empty — no binaries have ever been built
2. `.nvmrc` file missing — all CI workflows reference it and will fail
3. `better-sqlite3` native addon bundling untested
4. DMG script assumes `create-dmg` or `hdiutil` — needs testing on clean macOS
5. Windows NSIS installer not implemented

**Finalization tasks (~8–12 tasks)**

---

#### Electron Desktop App (Phase 73) — Build Broken, Wiring Gaps

**Current state:** Substantially built (main process, preload, React UI, settings, dashboard). Cannot run due to build configuration issues.

**Known issues (build-breaking):**

1. No Electron TS compile step — entry point `electron/main.js` will not exist
2. Setup wizard not wired — stub `<div>` on `/setup` instead of importing `Setup.tsx`
3. Vite output path mismatch — `vite.config.ts` outputs to `dist/ui/` but `electron-builder.yml` expects `ui/dist/`
4. `.nvmrc` missing

**Finalization tasks (~10–15 tasks)**

---

#### MCP Management UI — Removed from WebChat, Electron Layer Blocked

Backend is intact (`mcp-registry.ts`, `mcp-catalog.ts`). WebChat MCP UI was removed. Electron MCP UI (`McpSettings.tsx`, 827 lines) is coded but blocked by Electron build issues.

**Finalization tasks (~8–12 tasks, after Electron is fixed)**

---

## Backlog (Unscoped Ideas)

| Feature                  | Description                                                      | Notes                  |
| ------------------------ | ---------------------------------------------------------------- | ---------------------- |
| E2E test: business files | CSV workspace E2E test                                           | Testing gap            |
| Scheduled tasks          | Cron-like task scheduling ("run tests every morning at 9am")     | New capability         |
| AI tool marketplace      | Browse and install community-built connectors and providers      | Plugin ecosystem       |
| Webhook connector        | HTTP webhook endpoint for CI/CD integration                      | New connector type     |
| PDF generation           | Built-in HTML-to-PDF conversion for generated reports            | Uses Puppeteer         |
| Secrets management       | Encrypted storage for Discord/Telegram tokens                    | Security               |
| WhatsApp session persist | Avoid re-scan when session expires                               | UX improvement         |
| Skill creator            | Master creates reusable skill templates from successful patterns | Self-improvement       |
| Access Control Dashboard | Web-based UI for managing per-user access control                | ~10–15 tasks           |
| Server Deployment Mode   | Docker container + headless mode for VPS/cloud                   | Infrastructure         |
| Agent Orchestration      | Role-based workers with dependency chains                        | Advanced orchestration |

---

## How to Start a Future Feature

1. Create a new finding in [FINDINGS.md](FINDINGS.md) if the feature addresses a gap
2. Design the implementation and estimate tasks
3. Add a new phase section to [TASKS.md](TASKS.md) with task IDs
4. Update [ROADMAP.md](../ROADMAP.md) to reflect the new phase
5. Implement, test, and mark tasks as Done
6. Archive completed tasks when the phase ships
