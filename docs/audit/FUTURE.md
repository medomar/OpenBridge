# OpenBridge — Future Work

> **Purpose:** Planned features, deferred findings, finalization items, and backlog for future versions.
> **Last Updated:** 2026-03-06 | **Current Release:** v0.0.12 (Phases 1–104 + Deep + Phase 97, 1063 tasks shipped)
> **18 open findings** — all 18 findings have tasks in [TASKS.md](TASKS.md) (176 tasks, OB-1618–OB-1793) for automated execution via `run-tasks.sh`. Sprint 5 (126 tasks) + Sprint 6 (50 tasks). See [FINDINGS.md](FINDINGS.md) for details.

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
| Pre-5     | Phase 97 | 18       | 97                        | ✅ Shipped |
| **Total** |          | **1063** |                           |            |

Sprint 4 delivered: Real-world testing fixes (Codex streaming, RAG, classifier), Deep Mode (5-phase state machine), tunnel + app server + relay, WebChat modernization (extracted UI, auth, PWA, history, settings), runtime permission escalation, batch task continuation, Docker sandbox, and 67 runtime fix tasks from production testing.

All task archives: [docs/audit/archive/](archive/) (v0–v21).

---

## ✅ Completed: Phase 97 — Data Integrity Fixes (18 tasks)

**Status:** All 18 tasks done, 7 findings fixed. Archived in [v22](archive/v22/TASKS-v22-phase97-data-integrity.md).

| Finding | Issue                               | Severity  | Tasks | Status   |
| ------- | ----------------------------------- | --------- | ----- | -------- |
| OB-F89  | Audit log disabled by default       | 🟡 Medium | 2     | ✅ Fixed |
| OB-F90  | QA cache write path missing         | 🟠 High   | 3     | ✅ Fixed |
| OB-F91  | Sessions never close                | 🟠 High   | 3     | ✅ Fixed |
| OB-F92  | Learnings turns always 0            | 🟠 High   | 3     | ✅ Fixed |
| OB-F93  | Prompt evolution never activates    | 🟡 Medium | 2     | ✅ Fixed |
| OB-F94  | Sub-master detection never triggers | 🟡 Medium | 2     | ✅ Fixed |
| OB-F95  | memory.md goes stale                | 🟠 High   | 3     | ✅ Fixed |

---

## Next: Sprint 5 — Smarter AI + Business Output (v0.0.13) — 126 tasks

**Goal:** Make OpenBridge smarter (structured memory, session compaction) and useful for business users (document generation), while fixing the critical role management UX bug. Stretch goals add vector search and developer experience tools.

**Strategy:** Smarter AI first (Phase 93 foundation), then session compaction (Phase 95) + role fix (Phase 96d) in parallel, then document generation (Phase 99) which builds on structured observations. Stretch goals: vector search (Phase 94), doctor (96a), pairing (96b), skills directory (96c).

**Inspired by:** [openclaw/openclaw](https://github.com/openclaw/openclaw) (242K stars, vector memory, 60+ skills), [thedotmack/claude-mem](https://github.com/thedotmack/claude-mem) (32K stars, structured observations, token economics), [awesome-claude-skills](https://github.com/travisvn/awesome-claude-skills) (document generation skills).

**Why now (after v0.0.12):** v0.0.9–v0.0.12 makes OpenBridge functional and secure. v0.0.13 makes it _smarter_ and opens it to _business users_ — two gaps that limit adoption.

---

### Core Phases (75 tasks — guaranteed delivery)

#### Phase 93 — Structured Observations & Worker Summaries (~27 tasks)

**Findings:** OB-F80, OB-F88, OB-F82 | **Priority:** 1st — Foundation for everything else

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
| 19   | —       | Define `Observation` Zod schema with all fields + type validation                                                                                                                           | `src/types/agent.ts`                           |
| 20   | —       | Tests: observation extraction, deduplication, summary parsing                                                                                                                               | `tests/memory/observation-store.test.ts`       |
| 21   | —       | Tests: worker summary schema, next_steps injection                                                                                                                                          | `tests/master/worker-result-formatter.test.ts` |

---

#### Phase 95 — Session Compaction & Token Economics (~18 tasks)

**Findings:** OB-F84, OB-F83 | **Priority:** 2nd — Parallel with Phase 96d

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

#### Phase 96d — Channel Role Management UX (~12 tasks)

**Finding:** OB-F103 | **Priority:** 2nd — Parallel with Phase 95. High priority bug fix.

**Problem:** Users get auto-created as `viewer` (read-only). Any message with action words ("fix", "add", "create") is classified as `edit` and blocked with a cryptic _"That action is not permitted for your role."_ No way to set roles from config, no `/whoami` command, no in-chat role management.

**Root causes:**

1. `addApprovedEscalation()` defaults new entries to `viewer` instead of respecting config
2. `classifyMessageAction()` is too aggressive — common words trigger `edit` for viewer-blocked users
3. Denial message gives zero context (role, classified action, allowed actions)
4. No `auth.defaultRole` or `auth.channelRoles` in config — roles only in SQLite via CLI
5. No `/whoami` or `/role` chat commands
6. Init wizard skips role configuration entirely

| Task | Finding | What                                                                                                              | Key File                     |
| ---- | ------- | ----------------------------------------------------------------------------------------------------------------- | ---------------------------- |
| 1    | OB-F103 | Change default role in `addApprovedEscalation()` from `viewer` to `owner` for whitelisted users                   | `src/memory/access-store.ts` |
| 2    | OB-F103 | Add `auth.defaultRole` config field (default: `owner`)                                                            | `src/types/config.ts`        |
| 3    | OB-F103 | Add `auth.channelRoles` config — per-channel role overrides (e.g., `{ webchat: "owner", telegram: "developer" }`) | `src/types/config.ts`        |
| 4    | OB-F103 | Wire `defaultRole` + `channelRoles` into `AuthService` for auto-creating `access_control` entries                 | `src/core/auth.ts`           |
| 5    | OB-F103 | Auto-create `access_control` entry on first authorized message with correct role                                  | `src/core/bridge.ts`         |
| 6    | OB-F103 | Improve denial message — show role, classified action, and allowed actions                                        | `src/core/auth.ts`           |
| 7    | OB-F103 | Add `/whoami` chat command — show user their role, allowed actions, cost usage                                    | `src/core/router.ts`         |
| 8    | OB-F103 | Add `/role <user_id> <role>` chat command — owner/admin only                                                      | `src/core/router.ts`         |
| 9    | OB-F103 | Add role step to init wizard — "Default role for whitelisted users: owner / developer / viewer"                   | `src/cli/init.ts`            |
| 10   | OB-F103 | Update `config.example.json` with `auth.defaultRole` + `auth.channelRoles` examples                               | `config.example.json`        |
| 11   | OB-F103 | Add `chat` action classification — default for conversational messages, allowed for all roles                     | `src/core/auth.ts`           |
| 12   | OB-F103 | Tests: role assignment, channelRoles, /whoami, /role, improved denial messages, softened classification           | `tests/core/auth.test.ts`    |

---

#### Phase 99 — Document Generation Skills (~18 tasks)

**Finding:** OB-F98 | **Priority:** 3rd — After Phase 93. Opens OpenBridge to business users.

**Problem:** Business users can't generate documents, reports, presentations, or spreadsheets. OpenBridge is code-only — missing an entire use case category for non-developer users.

**Inspired by:** [awesome-claude-skills official skills](https://github.com/travisvn/awesome-claude-skills) — `docx` (Word creation/editing), `pdf` (manipulation/extraction), `pptx` (PowerPoint generation), `xlsx` (Excel with formulas/charts).

| Task | Finding | What                                                                                                          | Key File                                                  |
| ---- | ------- | ------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------- |
| 1    | OB-F98  | Define `DocumentSkill` type — `name`, `fileFormat`, `toolProfile`, `npmDependency`, `prompts`                 | `src/types/agent.ts`                                      |
| 2    | OB-F98  | Create `document-writer` skill pack — Word/DOCX generation prompts, structure templates, formatting rules     | `src/master/skill-packs/document-writer.ts` (new)         |
| 3    | OB-F98  | Create `presentation-maker` skill pack — PPTX generation prompts, slide layouts, design principles            | `src/master/skill-packs/presentation-maker.ts` (new)      |
| 4    | OB-F98  | Create `spreadsheet-builder` skill pack — XLSX generation prompts, formula patterns, chart generation         | `src/master/skill-packs/spreadsheet-builder.ts` (new)     |
| 5    | OB-F98  | Create `report-generator` skill pack — PDF/HTML report generation, data formatting, executive summary style   | `src/master/skill-packs/report-generator.ts` (new)        |
| 6    | OB-F98  | Add `docx` worker tooling — npm dependency (`docx` package), worker prompt with formatting instructions       | `src/master/skill-packs/document-writer.ts`               |
| 7    | OB-F98  | Add `pptx` worker tooling — npm dependency (`pptxgenjs`), slide template system                               | `src/master/skill-packs/presentation-maker.ts`            |
| 8    | OB-F98  | Add `xlsx` worker tooling — npm dependency (`exceljs`), formula + chart support                               | `src/master/skill-packs/spreadsheet-builder.ts`           |
| 9    | OB-F98  | Add `pdf` worker tooling — HTML-to-PDF via Puppeteer or wkhtmltopdf, styled templates                         | `src/master/skill-packs/report-generator.ts`              |
| 10   | OB-F98  | Create `skill-pack-loader.ts` — discovers and loads skill packs from built-in + `.openbridge/skill-packs/`    | `src/master/skill-pack-loader.ts` (new)                   |
| 11   | OB-F98  | Master auto-detects document tasks — intent classification extended with document/report/presentation intents | `src/core/router.ts`                                      |
| 12   | OB-F98  | Master selects skill pack per worker — inject prompt extension into worker system prompt                      | `src/master/master-manager.ts`                            |
| 13   | OB-F98  | Output delivery — generated files served via file-server, shared via `[SHARE:FILE]` markers                   | `src/core/file-server.ts`, `src/master/master-manager.ts` |
| 14   | OB-F98  | WhatsApp/Telegram file attachment — send generated documents as attachments                                   | `src/connectors/whatsapp/`, `src/connectors/telegram/`    |
| 15   | OB-F98  | WebChat file download — generated documents available as download links                                       | `src/connectors/webchat/`                                 |
| 16   | OB-F98  | Add optional dependencies to `package.json` — `docx`, `pptxgenjs`, `exceljs` (opt-in, zero by default)        | `package.json`                                            |
| 17   | OB-F98  | `openbridge doctor` checks for document generation prerequisites                                              | `src/cli/doctor.ts`                                       |
| 18   | —       | Tests: document skill pack selection, file generation mocks, output delivery, attachment sending              | `tests/master/document-skills.test.ts`                    |

---

### Stretch Phases (51 tasks — if time allows)

#### Phase 94 — Vector Search & Hybrid Retrieval (~21 tasks)

**Findings:** OB-F79, OB-F81 | **Prerequisite:** Phase 93

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

#### Phase 96a — `openbridge doctor` (~10 tasks)

**Finding:** OB-F85 | **Independent — can run anytime**

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

---

#### Phase 96b — Pairing-Based Auth (~10 tasks)

**Finding:** OB-F86 | **Independent — can run anytime**

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

---

#### Phase 96c — Skills Directory (~10 tasks)

**Finding:** OB-F87 | **Independent — can run anytime**

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

| Phase     | Focus                                      | Findings               | Tasks   | Priority   |
| --------- | ------------------------------------------ | ---------------------- | ------- | ---------- |
| **93**    | Structured Observations & Worker Summaries | OB-F80, OB-F82, OB-F88 | 27      | Core — 1st |
| **95**    | Session Compaction & Token Economics       | OB-F83, OB-F84         | 18      | Core — 2nd |
| **96d**   | Channel Role Management UX                 | OB-F103                | 12      | Core — 2nd |
| **99**    | Document Generation Skills                 | OB-F98                 | 18      | Core — 3rd |
| 94        | Vector Search & Hybrid Retrieval           | OB-F79, OB-F81         | 21      | Stretch    |
| 96a       | `openbridge doctor`                        | OB-F85                 | 10      | Stretch    |
| 96b       | Pairing-Based Auth                         | OB-F86                 | 10      | Stretch    |
| 96c       | Skills Directory                           | OB-F87                 | 10      | Stretch    |
| **Total** |                                            | **12 findings**        | **126** |            |

**Core: 75 tasks | Stretch: 51 tasks**

**Dependencies:**

- **Phase 97 (data integrity) ✅ complete** — session lifecycle, turns tracking, QA cache, and prompt evolution all fixed
- Phase 93 (observations) is ready to start — Phase 97 prerequisites satisfied
- Phase 95 (compaction) is independent — can run in parallel with Phase 96d
- **Phase 96d (role UX) is independent** — can run in parallel with any phase, high priority (fixes real user-facing bug)
- Phase 99 (document generation) — after Phase 93, benefits from structured worker outputs
- Phase 94 (vector search) — stretch, requires Phase 93 completion
- Phases 96a-c (doctor/pairing/skills) — stretch, independent

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

## Sprint 6 — Skill System, Agent Patterns & Creative Output (v0.0.14) — ~70–85 tasks

**Goal:** Extend the skill pack system from Phase 99, add creative/visual output, and adopt battle-tested agent orchestration patterns from leading AI tools (Manus, Devin, Cursor).

**Inspired by:** [travisvn/awesome-claude-skills](https://github.com/travisvn/awesome-claude-skills) (Claude Skills ecosystem — design, security, testing skills) and [x1xhlol/system-prompts-and-models-of-ai-tools](https://github.com/x1xhlol/system-prompts-and-models-of-ai-tools) (30+ AI tool architectures).

**Why now (after v0.0.13):** v0.0.13 builds the skill pack loader and document generation foundation. v0.0.14 extends it with more skill packs, creative output, and smarter agent orchestration.

### Phase 98 — Skill Pack System Extensions (~18–22 tasks)

**Finding:** OB-F96

**Problem:** Workers receive generic prompts regardless of task type. A security audit worker gets the same instructions as a document generation worker. No reusable domain-specific instruction sets beyond the document packs from Phase 99.

**Inspired by:** [awesome-claude-skills](https://github.com/travisvn/awesome-claude-skills) — progressive disclosure architecture, structured skill folders. [obra/superpowers](https://github.com/obra/superpowers) — 20+ battle-tested skills including TDD, debugging, collaboration.

| Task | Finding | What                                                                                                     | Key File                                         |
| ---- | ------- | -------------------------------------------------------------------------------------------------------- | ------------------------------------------------ |
| 1    | OB-F96  | Built-in skill pack: `security-audit` — CodeQL/Semgrep patterns, vulnerability detection prompts         | `src/master/skill-packs/security-audit.ts` (new) |
| 2    | OB-F96  | Built-in skill pack: `code-review` — diff analysis, best practices, review checklist prompts             | `src/master/skill-packs/code-review.ts` (new)    |
| 3    | OB-F96  | Built-in skill pack: `test-writer` — TDD patterns, coverage analysis, edge case generation prompts       | `src/master/skill-packs/test-writer.ts` (new)    |
| 4    | OB-F96  | Built-in skill pack: `data-analysis` — CSV/JSON processing, statistics, visualization generation prompts | `src/master/skill-packs/data-analysis.ts` (new)  |
| 5    | OB-F96  | Built-in skill pack: `documentation` — API docs, README generation, CHANGELOG prompts                    | `src/master/skill-packs/documentation.ts` (new)  |
| 6    | OB-F96  | Master reads available skill packs on startup, includes summary in system prompt                         | `src/master/master-system-prompt.ts`             |
| 7    | OB-F96  | Skill pack selection influences tool profile — `security-audit` pack defaults to `code-audit` profile    | `src/master/master-manager.ts`                   |
| 8    | OB-F96  | User-defined skill packs in `.openbridge/skill-packs/` override built-in defaults                        | `src/master/skill-pack-loader.ts`                |
| 9    | OB-F96  | Master can create new skill packs from successful task patterns                                          | `src/master/skill-pack-loader.ts`                |
| 10   | OB-F96  | Add `/skill-packs` chat command — list available packs with descriptions                                 | `src/core/router.ts`                             |
| 11   | OB-F96  | Add `openbridge skill-packs` CLI command                                                                 | `src/cli/index.ts`                               |
| 12   | —       | Tests: skill pack discovery, SKILLPACK.md parsing, prompt injection, tool profile override               | `tests/master/skill-pack-loader.test.ts`         |

---

### Phase 100 — Design & Creative Output Skills (~14–18 tasks)

**Finding:** OB-F99

**Problem:** No support for visual output — diagrams, charts, generative art, marketing materials, or presentation visuals. Business owners, marketers, and content creators need visual assets from their AI assistant.

**Inspired by:** [awesome-claude-skills](https://github.com/travisvn/awesome-claude-skills) — `algorithmic-art` (p5.js generative art), `canvas-design` (PNG/PDF visual art), `frontend-design` (React/Tailwind UI), `web-artifacts-builder` (HTML artifacts), `claude-d3js-skill` (D3.js data visualization), `frontend-slides` (animation-rich HTML presentations).

| Task | Finding | What                                                                                                           | Key File                                               |
| ---- | ------- | -------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------ |
| 1    | OB-F99  | Built-in skill pack: `diagram-maker` — Mermaid/PlantUML/D2 diagram generation, architecture diagrams, flows    | `src/master/skill-packs/diagram-maker.ts` (new)        |
| 2    | OB-F99  | Built-in skill pack: `chart-generator` — D3.js/Chart.js data visualization, bar/line/pie/scatter charts        | `src/master/skill-packs/chart-generator.ts` (new)      |
| 3    | OB-F99  | Built-in skill pack: `web-designer` — HTML/CSS/React landing pages, marketing materials, email templates       | `src/master/skill-packs/web-designer.ts` (new)         |
| 4    | OB-F99  | Built-in skill pack: `slide-designer` — HTML-based presentation slides with animations, exportable to PDF      | `src/master/skill-packs/slide-designer.ts` (new)       |
| 5    | OB-F99  | Built-in skill pack: `generative-art` — p5.js algorithmic art, SVG patterns, creative coding prompts           | `src/master/skill-packs/generative-art.ts` (new)       |
| 6    | OB-F99  | Built-in skill pack: `brand-assets` — logo concepts (SVG), social media images, favicon generation             | `src/master/skill-packs/brand-assets.ts` (new)         |
| 7    | OB-F99  | HTML-to-image pipeline — render HTML outputs to PNG/JPG using Puppeteer for sending via messaging channels     | `src/core/html-renderer.ts` (new)                      |
| 8    | OB-F99  | SVG output support — workers generate SVG, file-server serves, channels send as image                          | `src/core/file-server.ts`                              |
| 9    | OB-F99  | Mermaid rendering support — mermaid-cli or mermaid.ink API for diagram-to-image conversion                     | `src/core/html-renderer.ts`                            |
| 10   | OB-F99  | Output preview via app server — HTML outputs served as interactive previews (builds on Phase 83 ephemeral app) | `src/core/tunnel-manager.ts`                           |
| 11   | OB-F99  | Master auto-detects creative tasks — intent classification extended with design/visual/chart/diagram intents   | `src/core/router.ts`                                   |
| 12   | OB-F99  | Image delivery via WhatsApp/Telegram — send rendered PNG/SVG as media messages                                 | `src/connectors/whatsapp/`, `src/connectors/telegram/` |
| 13   | —       | Tests: diagram generation, chart rendering, HTML-to-image pipeline, creative skill selection                   | `tests/master/creative-skills.test.ts`                 |
| 14   | —       | Documentation: creative output guide, supported formats, rendering prerequisites                               | `docs/CREATIVE_OUTPUT.md` (new)                        |

---

### Phase 101 — Agent Orchestration Patterns (~18–22 tasks)

**Findings:** OB-F97, OB-F100, OB-F101, OB-F102

**Problem:** Master has no formal planning phase, workers aren't grouped, no test protection, and fix loops can run forever. These patterns are standard in production AI tools (Devin, Manus, Cursor) but missing from OpenBridge.

**Inspired by:** [Devin AI](https://github.com/x1xhlol/system-prompts-and-models-of-ai-tools/tree/main/Devin%20AI) — planning mode vs standard mode, think-before-critical-decisions, no-test-modification rule. [Manus](https://github.com/x1xhlol/system-prompts-and-models-of-ai-tools/tree/main/Manus%20Agent%20Tools%20%26%20Prompt) — single-tool-per-iteration, swarm coordination. [Cursor](https://github.com/x1xhlol/system-prompts-and-models-of-ai-tools/tree/main/Cursor%20Prompts) — parallel-by-default, 3-iteration fix cap, atomic task decomposition.

| Task | Finding | What                                                                                                                   | Key File                                      |
| ---- | ------- | ---------------------------------------------------------------------------------------------------------------------- | --------------------------------------------- |
| 1    | OB-F97  | Add `PlanningGate` class — Master enters analysis phase (read-only workers) before execution phase (code-edit workers) | `src/master/planning-gate.ts` (new)           |
| 2    | OB-F97  | Planning phase: spawn 1–2 read-only workers to investigate before committing to a strategy                             | `src/master/planning-gate.ts`                 |
| 3    | OB-F97  | Execution phase: only starts after planning workers return and Master confirms approach                                | `src/master/planning-gate.ts`                 |
| 4    | OB-F97  | Skip planning for simple tasks — Master auto-detects complexity (single-file edits, FAQ answers bypass planning)       | `src/master/planning-gate.ts`                 |
| 5    | OB-F97  | Wire planning gate into Master session flow — before SPAWN, check if planning phase completed                          | `src/master/master-manager.ts`                |
| 6    | OB-F97  | Add reasoning checkpoint before full-access workers — Master self-checks: "What could go wrong?"                       | `src/master/master-manager.ts`                |
| 7    | OB-F100 | Add `WorkerSwarm` type — named group of workers with shared context and handoff protocol                               | `src/types/agent.ts`                          |
| 8    | OB-F100 | Create `swarm-coordinator.ts` — groups workers into swarms (research, implement, review, test)                         | `src/master/swarm-coordinator.ts` (new)       |
| 9    | OB-F100 | Swarm handoff — research swarm results feed into implement swarm context, implement into review                        | `src/master/swarm-coordinator.ts`             |
| 10   | OB-F100 | Master decides swarm composition per task — simple tasks skip swarms, complex tasks use full pipeline                  | `src/master/swarm-coordinator.ts`             |
| 11   | OB-F100 | Parallel spawning within swarms — independent workers in same swarm run concurrently (Cursor pattern)                  | `src/master/swarm-coordinator.ts`             |
| 12   | OB-F101 | Add test protection to worker system prompts — "Do not modify test files unless explicitly authorized"                 | `src/master/master-system-prompt.ts`          |
| 13   | OB-F101 | Master can grant test modification permission per-worker when task requires it (e.g., "update tests for new API")      | `src/master/master-manager.ts`                |
| 14   | OB-F101 | Detect test file modification in worker results — flag for Master review if unauthorized                               | `src/master/worker-result-formatter.ts`       |
| 15   | OB-F102 | Add iteration cap to worker fix loops — max 3 attempts at lint/test fixes before escalating to Master                  | `src/core/agent-runner.ts`                    |
| 16   | OB-F102 | On cap hit: worker reports partial fix + error details to Master, Master decides next action                           | `src/core/agent-runner.ts`                    |
| 17   | OB-F102 | Configurable cap via `worker.maxFixIterations` config option (default: 3)                                              | `src/types/config.ts`                         |
| 18   | —       | Tests: planning gate flow, swarm coordination, test protection, iteration caps                                         | `tests/master/orchestration-patterns.test.ts` |
| 19   | —       | Tests: parallel spawning within swarms, handoff data integrity                                                         | `tests/master/swarm-coordinator.test.ts`      |

---

### Sprint 6 Summary

| Phase     | Focus                           | Findings                          | Est. Tasks |
| --------- | ------------------------------- | --------------------------------- | ---------- |
| 98        | Skill Pack System Extensions    | OB-F96                            | ~18–22     |
| 100       | Design & Creative Output Skills | OB-F99                            | ~14–18     |
| 101       | Agent Orchestration Patterns    | OB-F97, OB-F100, OB-F101, OB-F102 | ~18–22     |
| **Total** |                                 | **6 findings**                    | **~70–85** |

**Dependencies:**

- **Sprint 5 (v0.0.13) should complete first** — Phase 98 extends the skill pack loader from Phase 99
- Phase 100 (design/creative) is independent — can run in parallel with Phase 101
- Phase 101 (orchestration) is independent — can run in parallel with Phase 100

---

## Deferred — Post v0.0.14

### Finalization Required (Phases 72–73 + MCP UI)

These features were scaffolded/built but have bugs and build issues. Not needed for the current development track (Console/WhatsApp/Telegram/WebChat channels work fine). **Desktop apps (Windows/macOS/App Store) remain a separate effort** and are NOT part of Sprint 5 or Sprint 6.

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

| Feature                      | Description                                                                                                    | Notes                     | Inspired By                         |
| ---------------------------- | -------------------------------------------------------------------------------------------------------------- | ------------------------- | ----------------------------------- |
| E2E test: business files     | CSV workspace E2E test                                                                                         | Testing gap               | —                                   |
| Scheduled tasks              | Cron-like task scheduling ("run tests every morning at 9am")                                                   | New capability            | —                                   |
| AI tool marketplace          | Browse and install community-built connectors and providers                                                    | Plugin ecosystem          | —                                   |
| Webhook connector            | HTTP webhook endpoint for CI/CD integration                                                                    | New connector type        | —                                   |
| Secrets management           | Encrypted storage for Discord/Telegram tokens                                                                  | Security                  | —                                   |
| WhatsApp session persist     | Avoid re-scan when session expires                                                                             | UX improvement            | —                                   |
| Access Control Dashboard     | Web-based UI for managing per-user access control                                                              | ~10–15 tasks              | —                                   |
| Server Deployment Mode       | Docker container + headless mode for VPS/cloud                                                                 | Infrastructure            | —                                   |
| MCP server builder skill     | Master auto-generates MCP server stubs for custom integrations ("connect my Notion")                           | Extends MCP ecosystem     | awesome-claude-skills (mcp-builder) |
| Browser automation skill     | Playwright-based web scraping, form filling, and UI testing via workers                                        | Extends worker capability | awesome-claude-skills (playwright)  |
| iOS/Android testing skill    | Mobile app build + simulator testing via workers                                                               | Mobile development        | awesome-claude-skills (ios-sim)     |
| Email template generator     | HTML email design + send via SMTP — marketing, newsletters, notifications                                      | Business use case         | awesome-claude-skills               |
| Scientific computing skill   | Data science libraries (pandas, numpy, scipy) integration for analysis workers                                 | Research use case         | awesome-claude-skills (scientific)  |
| Multi-agent startup mode     | Loki-mode inspired — orchestrate 30+ agents across functional swarms for large projects                        | Advanced orchestration    | awesome-claude-skills (loki-mode)   |
| Sandbox-first deployments    | Workers deploy preview apps in sandboxed containers with temp public URLs (extends tunnel + Docker)            | Manus pattern             | system-prompts (Manus)              |
| Atomic task decomposition    | Master breaks tasks into verb-led, single-outcome, ≤14-word items for clearer worker instructions              | Cursor pattern            | system-prompts (Cursor)             |
| Parallel-by-default spawning | Master spawns independent workers simultaneously by default, with explicit dependency detection for sequencing | Cursor pattern            | system-prompts (Cursor)             |
| Worker reasoning checkpoints | Workers run self-check ("Am I sure?") before destructive operations (git push, file delete, deploy)            | Devin pattern             | system-prompts (Devin)              |

---

## How to Start a Future Feature

1. Create a new finding in [FINDINGS.md](FINDINGS.md) if the feature addresses a gap
2. Design the implementation and estimate tasks
3. Add a new phase section to [TASKS.md](TASKS.md) with task IDs
4. Update [ROADMAP.md](../ROADMAP.md) to reflect the new phase
5. Implement, test, and mark tasks as Done
6. Archive completed tasks when the phase ships
