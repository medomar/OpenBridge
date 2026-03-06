# OpenBridge — Task List

> **Pending:** 92 | **In Progress:** 0 | **Done:** 84 (1063 archived)
> **Last Updated:** 2026-03-06

<details>
<summary>Archive (1063 tasks completed across Phases 1–104 + Deep + Phase 97)</summary>

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
- [v0.0.3 — Phases 51–56](archive/v13/TASKS-v13-v003-phases-51-56.md)
- [v0.0.4 — Phases 57–62](archive/v14/TASKS-v14-v004-phases-57-62.md)
- [v0.0.5 — Phases 63–66](archive/v15/TASKS-v15-v005-phases-63-66.md)
- [v0.0.6 — Phase 67](archive/v16/TASKS-v16-v006-phase-67.md)
- [v0.0.7 — Phases 68–69](archive/v17/TASKS-v17-v007-phases-68-69.md)
- [v0.0.8 — Phases 70–73](archive/v18/TASKS-v18-v008-phases-70-73.md)
- [v0.0.9–v0.0.11 + Deep-1 — Phases 74–86](archive/v20/TASKS-v20-v009-v011-phases-74-86-deep1.md)
- [v0.0.12 Sprint 4 — Phases RWT, Deep, 82–104](archive/v21/TASKS-v21-v012-sprint4-phases-rwt-deep-82-104.md)
- [Phase 97 — Data Integrity Fixes](archive/v22/TASKS-v22-phase97-data-integrity.md)

</details>

---

## Sprint 5 — Smarter AI + Business Output (v0.0.13)

**Goal:** Make OpenBridge smarter (structured memory, session compaction) and useful for business users (document generation), while fixing the critical role management UX bug.

**Strategy:** Smarter AI first (Phase 93 foundation), then session compaction (Phase 95) + role fix (Phase 96d) in parallel, then document generation (Phase 99). Followed by stretch goals: vector search (Phase 94) and developer experience (Phase 96a-c).

**Dependencies:** Phase 97 (data integrity) ✅ complete. Phase 93 → 99 (observations feed document quality). Phases 95, 96d are independent. Phase 94 requires Phase 93.

---

### Phase 93 — Structured Observations & Worker Summaries (OB-F80, OB-F88, OB-F82)

**Priority:** 1st — Foundation for everything else. No external deps.

**Problem:** Worker outputs are unstructured text. No typed facts, concepts, files_touched. Duplicate chunks accumulate. Master loses track of incomplete work.

#### 93a — Observations Schema & Store (OB-F80)

| Task    | What                                                                                                                                                                                              | Key File                                | Status  |
| ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------- | ------- |
| OB-1618 | Add `observations` table to SQLite — `id`, `session_id`, `worker_id`, `type`, `title`, `narrative`, `facts` (JSON), `concepts` (JSON), `files_read` (JSON), `files_modified` (JSON), `created_at` | `src/memory/database.ts`                | ✅ Done |
| OB-1619 | Add migration (version 9) for `observations` table with idempotent guard check                                                                                                                    | `src/memory/migration.ts`               | ✅ Done |
| OB-1620 | Add `observations_fts` FTS5 virtual table on `title`, `narrative` columns with sync triggers (INSERT, UPDATE, DELETE)                                                                             | `src/memory/database.ts`                | ✅ Done |
| OB-1621 | Create `observation-store.ts` — CRUD: `insertObservation()`, `getBySession()`, `getByWorker()`, `searchObservations()` (FTS5), `getRecentByType()`                                                | `src/memory/observation-store.ts` (new) | ✅ Done |
| OB-1622 | Define observation type taxonomy enum: `bugfix`, `architecture`, `investigation`, `refactor`, `test-result`, `dependency`, `config`, `documentation`, `performance`, `security`                   | `src/types/agent.ts`                    | ✅ Done |
| OB-1623 | Define `Observation` Zod schema with all fields + type validation                                                                                                                                 | `src/types/agent.ts`                    | ✅ Done |
| OB-1624 | Wire `observation-store.ts` into `MemoryManager` facade — add `insertObservation()`, `searchObservations()`, `getRecentObservations()` public methods                                             | `src/memory/index.ts`                   | ✅ Done |

#### 93b — Observation Extraction Pipeline (OB-F80)

| Task    | What                                                                                                                                                             | Key File                                    | Status  |
| ------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------- | ------- |
| OB-1625 | Create `observation-extractor.ts` — parse worker text output into structured `Observation` objects using regex + heuristics (file paths, function names, errors) | `src/master/observation-extractor.ts` (new) | ✅ Done |
| OB-1626 | Extract `files_read` from worker output (scan for file path patterns like `src/...`, `./...`, absolute paths)                                                    | `src/master/observation-extractor.ts`       | ✅ Done |
| OB-1627 | Extract `files_modified` from worker output (scan for Edit/Write/Create indicators in output)                                                                    | `src/master/observation-extractor.ts`       | ✅ Done |
| OB-1628 | Auto-classify observation `type` from worker task profile + output content (code-edit → `refactor`/`bugfix`, read-only → `investigation`, etc.)                  | `src/master/observation-extractor.ts`       | ✅ Done |
| OB-1629 | Wire extractor into `worker-result-formatter.ts` — call `extractObservation()` after every worker completes, store via MemoryManager                             | `src/master/worker-result-formatter.ts`     | ✅ Done |
| OB-1630 | Expose observations in `retrieval.ts` — add `searchObservations()` that combines FTS5 observations + chunk results                                               | `src/memory/retrieval.ts`                   | ✅ Done |

#### 93c — Structured Worker Summaries (OB-F88)

| Task    | What                                                                                                                                       | Key File                                | Status  |
| ------- | ------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------- | ------- |
| OB-1631 | Define `WorkerSummary` Zod schema: `{ request, investigated, completed, learned, next_steps, files_modified, files_read, error_summary? }` | `src/types/agent.ts`                    | ✅ Done |
| OB-1632 | Update `worker-result-formatter.ts` — extract `WorkerSummary` from worker output text using structured parsing                             | `src/master/worker-result-formatter.ts` | ✅ Done |
| OB-1633 | Extend `agent_activity` schema — add `summary_json` TEXT column (nullable) for storing serialized `WorkerSummary`                          | `src/memory/activity-store.ts`          | ✅ Done |
| OB-1634 | Add migration (version 10) to ALTER TABLE `agent_activity` ADD COLUMN `summary_json`                                                       | `src/memory/migration.ts`               | ✅ Done |
| OB-1635 | Master reads `next_steps` from 5 most recent worker summaries and injects into system prompt context                                       | `src/master/master-system-prompt.ts`    | ✅ Done |
| OB-1636 | Auto-update `memory.md` with `learned` items from worker summaries (append to knowledge section, dedup by content similarity)              | `src/master/dotfolder-manager.ts`       | ✅ Done |

#### 93d — Content-Hash Deduplication (OB-F82)

| Task    | What                                                                                                                               | Key File                    | Status  |
| ------- | ---------------------------------------------------------------------------------------------------------------------------------- | --------------------------- | ------- |
| OB-1637 | Add `content_hash` TEXT column to `context_chunks` table (SHA-256 of normalized content)                                           | `src/memory/chunk-store.ts` | ✅ Done |
| OB-1638 | Add migration (version 11) to ALTER TABLE `context_chunks` ADD COLUMN `content_hash`, backfill existing rows                       | `src/memory/migration.ts`   | ✅ Done |
| OB-1639 | Before INSERT in `storeChunks()`, check for existing chunk with same hash — UPDATE `updated_at` timestamp if duplicate found       | `src/memory/chunk-store.ts` | ✅ Done |
| OB-1640 | Add 30-second deduplication window — skip hash check for chunks written within last 30s from same scope (performance optimization) | `src/memory/chunk-store.ts` | ✅ Done |

#### 93e — Tests

| Task    | What                                                                                 | Key File                                           | Status  |
| ------- | ------------------------------------------------------------------------------------ | -------------------------------------------------- | ------- |
| OB-1641 | Tests: observation CRUD — insert, getBySession, getByWorker, FTS5 search             | `tests/memory/observation-store.test.ts` (new)     | ✅ Done |
| OB-1642 | Tests: observation extraction — file path detection, type classification, edge cases | `tests/master/observation-extractor.test.ts` (new) | ✅ Done |
| OB-1643 | Tests: worker summary parsing — valid/invalid output, next_steps injection           | `tests/master/worker-result-formatter.test.ts`     | ✅ Done |
| OB-1644 | Tests: content-hash dedup — duplicate detection, 30s window, hash backfill migration | `tests/memory/chunk-store.test.ts`                 | ✅ Done |

**Phase 93 Total:** 27 tasks

---

### Phase 95 — Session Compaction & Token Economics (OB-F84, OB-F83)

**Priority:** 2nd — Parallel-safe after Phase 93. Prevents context loss in long sessions.

#### 95a — Session Compaction (OB-F84)

| Task    | What                                                                                                                                                      | Key File                                | Status  |
| ------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------- | ------- |
| OB-1666 | Create `SessionCompactor` class — monitors Master session turn count via `agent_activity` tracking                                                        | `src/master/session-compactor.ts` (new) | ✅ Done |
| OB-1667 | Trigger compaction when Master session exceeds configurable threshold (default 80% of `--max-turns`)                                                      | `src/master/session-compactor.ts`       | ✅ Done |
| OB-1668 | Compaction strategy: summarize old turns into structured summary preserving identifiers (file paths, function names, finding IDs, task IDs)               | `src/master/session-compactor.ts`       | ✅ Done |
| OB-1669 | Identifier extraction — regex scan conversation for file paths (`src/...`), function names (`functionName()`), IDs (`OB-F*`, `OB-*`)                      | `src/master/session-compactor.ts`       | ✅ Done |
| OB-1670 | Write compaction summary to `memory.md` before starting new session segment (ensures cross-session continuity)                                            | `src/master/session-compactor.ts`       | ✅ Done |
| OB-1671 | Retry on compaction failure (max 2 retries) — log warning but don't crash the session                                                                     | `src/master/session-compactor.ts`       | ✅ Done |
| OB-1672 | Wire compactor into `master-manager.ts` — check after each Master turn, trigger compaction if threshold exceeded                                          | `src/master/master-manager.ts`          | ✅ Done |
| OB-1673 | Add `compaction_history` table — `id`, `session_id`, `trigger_reason`, `turns_summarized`, `identifiers_preserved` (JSON), `summary_length`, `created_at` | `src/memory/database.ts`                | ✅ Done |
| OB-1674 | Add migration (version 13) for `compaction_history` table                                                                                                 | `src/memory/migration.ts`               | ✅ Done |

#### 95b — Token Economics (OB-F83)

| Task    | What                                                                                                                                                      | Key File                    | Status  |
| ------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------- | ------- |
| OB-1675 | Add `token_economics` table — `id`, `chunk_id` (FK), `discovery_tokens` (estimated), `retrieval_count`, `total_read_tokens`, `created_at`, `last_read_at` | `src/memory/database.ts`    | ✅ Done |
| OB-1676 | Add migration (version 14) for `token_economics` table                                                                                                    | `src/memory/migration.ts`   | ✅ Done |
| OB-1677 | Track `discovery_tokens` per chunk — estimate from worker turn count × avg tokens/turn (configurable, default 4000 tokens/turn)                           | `src/memory/chunk-store.ts` | ✅ Done |
| OB-1678 | Track `read_tokens` per retrieval — estimate from returned content length × chars-to-tokens ratio (÷4)                                                    | `src/memory/retrieval.ts`   | ✅ Done |
| OB-1679 | Increment `retrieval_count` on each chunk access in `hybridSearch()` and `getDetails()`                                                                   | `src/memory/retrieval.ts`   | ✅ Done |
| OB-1680 | Add `/stats` chat command — show exploration ROI: "Explored with ~50K tokens, saved ~200K tokens across 15 retrievals (4x ROI)"                           | `src/core/router.ts`        | ✅ Done |
| OB-1681 | Add `openbridge stats` CLI command (same output as `/stats`, formatted for terminal)                                                                      | `src/cli/index.ts`          | ✅ Done |

#### 95c — Tests

| Task    | What                                                                                                   | Key File                                       | Status  |
| ------- | ------------------------------------------------------------------------------------------------------ | ---------------------------------------------- | ------- |
| OB-1682 | Tests: compaction trigger threshold, identifier extraction, summary generation, retry on failure       | `tests/master/session-compactor.test.ts` (new) | ✅ Done |
| OB-1683 | Tests: token economics tracking — discovery tokens, read tokens, retrieval count, /stats output format | `tests/memory/token-economics.test.ts` (new)   | ✅ Done |

**Phase 95 Total:** 18 tasks

---

### Phase 96d — Channel Role Management UX (OB-F103)

**Priority:** 2nd — Independent, high priority bug fix. Can run in parallel with Phase 95.

| Task    | What                                                                                                                                                                 | Key File                     | Status  |
| ------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------- | ------- |
| OB-1714 | Change default role in `addApprovedEscalation()` from `viewer` to `owner` for users already in `auth.whitelist`                                                      | `src/memory/access-store.ts` | ✅ Done |
| OB-1715 | Add `auth.defaultRole` config field (default: `owner`) — controls what role new whitelisted users get when auto-created in `access_control`                          | `src/types/config.ts`        | ✅ Done |
| OB-1716 | Add per-channel role config in `config.json` — `auth.channelRoles: { webchat: "owner", telegram: "developer" }` — applied when creating new `access_control` entries | `src/types/config.ts`        | ✅ Done |
| OB-1717 | Wire `auth.defaultRole` and `auth.channelRoles` into `AuthService` — use when creating entries for whitelisted users with no existing `access_control` row           | `src/core/auth.ts`           | ✅ Done |
| OB-1718 | Auto-create `access_control` entry with correct role on first authorized message (if no entry exists) — prevents the "no entry = owner fallback" ambiguity           | `src/core/bridge.ts`         | ✅ Done |
| OB-1719 | Improve denied message — include user's current role, the classified action, and what actions their role allows                                                      | `src/core/auth.ts`           | ✅ Done |
| OB-1720 | Add `/whoami` chat command — shows user their role, channel, allowed actions, daily cost usage, and consent mode                                                     | `src/core/router.ts`         | ✅ Done |
| OB-1721 | Add `/role <user_id> <role>` chat command — owner/admin only, sets role for another user on the same channel                                                         | `src/core/router.ts`         | ✅ Done |
| OB-1722 | Add role step to init wizard — after whitelist setup, ask "Default role for whitelisted users: owner / developer / viewer" with explanation of each                  | `src/cli/init.ts`            | ✅ Done |
| OB-1723 | Update `config.example.json` — add `auth.defaultRole` and `auth.channelRoles` examples with comments                                                                 | `config.example.json`        | ✅ Done |
| OB-1724 | Soften action classification — add `chat` action (default for messages without strong edit/deploy/stop keywords), allowed for all roles including `viewer`           | `src/core/auth.ts`           | ✅ Done |
| OB-1725 | Tests: default role assignment, channelRoles config, /whoami output, /role command, improved denial messages, softened classification                                | `tests/core/auth.test.ts`    | ✅ Done |

**Phase 96d Total:** 12 tasks

---

### Phase 99 — Document Generation Skills (OB-F98)

**Priority:** 3rd — After Phase 93. Makes OpenBridge useful for business users.

#### 99a — Document Skill Packs

| Task    | What                                                                                                                                | Key File                                              | Status  |
| ------- | ----------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------- | ------- |
| OB-1726 | Define `DocumentSkill` type extending skill system — `name`, `description`, `fileFormat`, `toolProfile`, `npmDependency`, `prompts` | `src/types/agent.ts`                                  | ✅ Done |
| OB-1727 | Create `document-writer` skill pack — Word/DOCX generation prompts, structure templates, formatting rules                           | `src/master/skill-packs/document-writer.ts` (new)     | ✅ Done |
| OB-1728 | Create `presentation-maker` skill pack — PPTX generation prompts, slide layouts, design principles                                  | `src/master/skill-packs/presentation-maker.ts` (new)  | ✅ Done |
| OB-1729 | Create `spreadsheet-builder` skill pack — XLSX generation prompts, formula patterns, chart generation                               | `src/master/skill-packs/spreadsheet-builder.ts` (new) | ✅ Done |
| OB-1730 | Create `report-generator` skill pack — PDF/HTML report generation, data formatting, executive summary style                         | `src/master/skill-packs/report-generator.ts` (new)    | ✅ Done |

#### 99b — Document Generation Pipeline

| Task    | What                                                                                                                          | Key File                                        | Status  |
| ------- | ----------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------- | ------- |
| OB-1731 | Add `docx` worker tooling — npm dependency selection (`docx` package), worker prompt with formatting instructions             | `src/master/skill-packs/document-writer.ts`     | ✅ Done |
| OB-1732 | Add `pptx` worker tooling — npm dependency (`pptxgenjs`), slide template system with layout options                           | `src/master/skill-packs/presentation-maker.ts`  | ✅ Done |
| OB-1733 | Add `xlsx` worker tooling — npm dependency (`exceljs`), formula + chart support                                               | `src/master/skill-packs/spreadsheet-builder.ts` | ✅ Done |
| OB-1734 | Add `pdf` worker tooling — HTML-to-PDF via Puppeteer or wkhtmltopdf, styled templates                                         | `src/master/skill-packs/report-generator.ts`    | ✅ Done |
| OB-1735 | Create `skill-pack-loader.ts` — discovers and loads skill packs from built-in defaults + `.openbridge/skill-packs/` directory | `src/master/skill-pack-loader.ts` (new)         | ✅ Done |
| OB-1736 | Master auto-detects document tasks — intent classification extended with document/report/presentation/spreadsheet intents     | `src/core/router.ts`                            | ✅ Done |
| OB-1737 | Master selects skill pack per worker based on task type — inject prompt extension into worker system prompt                   | `src/master/master-manager.ts`                  | ✅ Done |

#### 99c — Output Delivery

| Task    | What                                                                                                               | Key File                                                  | Status  |
| ------- | ------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------- | ------- |
| OB-1738 | Output delivery integration — generated files served via file-server (existing), shared via `[SHARE:FILE]` markers | `src/core/file-server.ts`, `src/master/master-manager.ts` | ✅ Done |
| OB-1739 | WhatsApp/Telegram file attachment — send generated documents as attachments via connector                          | `src/connectors/whatsapp/`, `src/connectors/telegram/`    | ✅ Done |
| OB-1740 | WebChat file download — generated documents available as download links in chat UI                                 | `src/connectors/webchat/`                                 | ✅ Done |

#### 99d — Configuration & Tests

| Task    | What                                                                                                              | Key File                               | Status  |
| ------- | ----------------------------------------------------------------------------------------------------------------- | -------------------------------------- | ------- |
| OB-1741 | Add optional dependencies to `package.json` — `docx`, `pptxgenjs`, `exceljs` (opt-in, zero by default)            | `package.json`                         | ✅ Done |
| OB-1742 | `openbridge doctor` checks for document generation prerequisites (Puppeteer, LibreOffice, npm packages installed) | `src/cli/doctor.ts`                    | ✅ Done |
| OB-1743 | Tests: document skill pack selection, file generation mocks, output delivery, attachment sending                  | `tests/master/document-skills.test.ts` | ✅ Done |

**Phase 99 Total:** 18 tasks

---

### Phase 94 — Vector Search & Hybrid Retrieval (OB-F79, OB-F81)

**Prerequisite:** Phase 93 must complete first.

#### 94a — Embedding Infrastructure (OB-F79)

| Task    | What                                                                                                                                               | Key File                                 | Status  |
| ------- | -------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------- | ------- |
| OB-1645 | Add `sqlite-vec` dependency to `package.json` (native addon, like `better-sqlite3`)                                                                | `package.json`                           | ✅ Done |
| OB-1646 | Add `embeddings` table — `id`, `chunk_id` (FK → context_chunks), `vector` (BLOB, float32), `model`, `dimensions`, `created_at`                     | `src/memory/database.ts`                 | ✅ Done |
| OB-1647 | Add migration (version 12) for `embeddings` table + `sqlite-vec` initialization via `db.loadExtension()`                                           | `src/memory/migration.ts`                | ✅ Done |
| OB-1648 | Create `embedding-provider.ts` — abstract `EmbeddingProvider` interface: `embed(text): Promise<Float32Array>`, `embedBatch(texts[]): Promise<...>` | `src/memory/embedding-provider.ts` (new) | ✅ Done |
| OB-1649 | Implement local Ollama provider (`nomic-embed-text`, 768 dims) — HTTP call to `localhost:11434/api/embeddings`                                     | `src/memory/embeddings/local.ts` (new)   | ✅ Done |
| OB-1650 | Implement OpenAI provider (`text-embedding-3-small`, 1536 dims) — optional, requires OPENAI_API_KEY                                                | `src/memory/embeddings/openai.ts` (new)  | ✅ Done |
| OB-1651 | Add `memory.embedding` config section to Zod schema — `provider` ('local'\|'openai'\|'none'), `model`, `batchSize` (default 50), `dimensions`      | `src/types/config.ts`                    | ✅ Done |
| OB-1652 | Batch embedding during chunk storage — embed new chunks as they're inserted via `storeChunks()`                                                    | `src/memory/chunk-store.ts`              | ✅ Done |

#### 94b — Hybrid Search & Ranking (OB-F79)

| Task    | What                                                                                                                                 | Key File                  | Status  |
| ------- | ------------------------------------------------------------------------------------------------------------------------------------ | ------------------------- | ------- |
| OB-1653 | Vector similarity search via `sqlite-vec` — `knn_search()` with cosine distance, returns top-K chunk IDs + scores                    | `src/memory/retrieval.ts` | ✅ Done |
| OB-1654 | Hybrid scoring function — weighted combination: `0.4 * vectorScore + 0.4 * fts5Score + 0.2 * temporalScore`                          | `src/memory/retrieval.ts` | Pending |
| OB-1655 | MMR (Maximal Marginal Relevance) — diversify results, prevent 5 chunks from same file, configurable `lambda` (default 0.7)           | `src/memory/retrieval.ts` | Pending |
| OB-1656 | Temporal decay scoring — recent chunks rank higher: `score * exp(-decay * daysSinceUpdate)`, configurable `decayRate` (default 0.01) | `src/memory/retrieval.ts` | Pending |
| OB-1657 | Graceful fallback — if no embedding provider configured (`provider: 'none'`), use FTS5-only (current behavior, zero degradation)     | `src/memory/retrieval.ts` | Pending |

#### 94c — Progressive Disclosure (OB-F81)

| Task    | What                                                                                                                                       | Key File                             | Status  |
| ------- | ------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------ | ------- |
| OB-1658 | Add `searchIndex()` method — returns compact results: `{ id, title, score, snippet(80 chars), source_file, category }` — ~10x fewer tokens | `src/memory/retrieval.ts`            | Pending |
| OB-1659 | Add `getDetails(ids: string[])` method — returns full content for selected chunk IDs only                                                  | `src/memory/retrieval.ts`            | Pending |
| OB-1660 | Wire 2-step retrieval into RAG flow: `searchIndex(query)` → filter by score > 0.3 → `getDetails(topIds)` → return to Master                | `src/core/knowledge-retriever.ts`    | Pending |
| OB-1661 | Update Master system prompt to teach 2-step retrieval pattern: "Use searchIndex first, then getDetails for relevant results only"          | `src/master/master-system-prompt.ts` | Pending |

#### 94d — Tests

| Task    | What                                                                                                  | Key File                                        | Status  |
| ------- | ----------------------------------------------------------------------------------------------------- | ----------------------------------------------- | ------- |
| OB-1662 | Tests: Ollama embedding provider — mock HTTP, embed single, batch embed, connection failure fallback  | `tests/memory/embedding-provider.test.ts` (new) | Pending |
| OB-1663 | Tests: vector search — knn query, hybrid ranking, MMR diversity, temporal decay                       | `tests/memory/retrieval.test.ts`                | Pending |
| OB-1664 | Tests: progressive disclosure — searchIndex compact results, getDetails full content, 2-step RAG flow | `tests/memory/retrieval.test.ts`                | Pending |
| OB-1665 | Tests: graceful fallback — FTS5-only when provider='none', no sqlite-vec calls                        | `tests/memory/retrieval.test.ts`                | Pending |

**Phase 94 Total:** 21 tasks

---

### Phase 96a — `openbridge doctor` (OB-F85)

| Task    | What                                                                                                                            | Key File                  | Status  |
| ------- | ------------------------------------------------------------------------------------------------------------------------------- | ------------------------- | ------- |
| OB-1684 | Create `doctor.ts` CLI command entry point with check registry pattern (each check is a function returning `{ pass, message }`) | `src/cli/doctor.ts` (new) | Pending |
| OB-1685 | Check: Node.js version >= 22 (parse `process.version`)                                                                          | `src/cli/doctor.ts`       | Pending |
| OB-1686 | Check: AI tools detected (`which claude`, `which codex`, `which aider`) with version output                                     | `src/cli/doctor.ts`       | Pending |
| OB-1687 | Check: Config file exists + valid (Zod parse with specific error messages per field)                                            | `src/cli/doctor.ts`       | Pending |
| OB-1688 | Check: SQLite database healthy (`PRAGMA integrity_check`, schema version, table row counts summary)                             | `src/cli/doctor.ts`       | Pending |
| OB-1689 | Check: `.openbridge/` state — memory.md freshness, workspace-map existence, no corrupted JSON                                   | `src/cli/doctor.ts`       | Pending |
| OB-1690 | Check: Channel prerequisites — WhatsApp session dir, Telegram BOT_TOKEN, Discord BOT_TOKEN, WebChat port                        | `src/cli/doctor.ts`       | Pending |
| OB-1691 | Color-coded summary output (green ✓ / red ✗ / yellow ⚠) with fix suggestions per failing check                                  | `src/cli/doctor.ts`       | Pending |
| OB-1692 | Wire `doctor` command into CLI entry point (`src/cli/index.ts`)                                                                 | `src/cli/index.ts`        | Pending |
| OB-1693 | Add `/doctor` chat command (runs same checks, sends summary via messaging channel)                                              | `src/core/router.ts`      | Pending |

**Phase 96a Total:** 10 tasks

---

### Phase 96b — Pairing-Based Auth (OB-F86)

| Task    | What                                                                                                                  | Key File                     | Status  |
| ------- | --------------------------------------------------------------------------------------------------------------------- | ---------------------------- | ------- |
| OB-1694 | Generate cryptographically secure 6-digit pairing code for unknown senders (use `crypto.randomInt(100000, 999999)`)   | `src/core/auth.ts`           | Pending |
| OB-1695 | Store pending pairings in-memory Map: `code → { senderId, channel, requestedAt, attempts }`                           | `src/core/auth.ts`           | Pending |
| OB-1696 | Send pairing message to unknown sender: "To connect, ask the admin to approve code: XXXXXX (expires in 5 minutes)"    | `src/core/auth.ts`           | Pending |
| OB-1697 | Add `openbridge pairing approve <code>` CLI command — validates code, adds user to access_control with `viewer` role  | `src/cli/access.ts`          | Pending |
| OB-1698 | Add `/approve <code>` chat command for owner-role users — same approval flow via messaging                            | `src/core/router.ts`         | Pending |
| OB-1699 | Store approved pairing in `access_control` table via `AccessStore.setAccess()` with configurable default role         | `src/memory/access-store.ts` | Pending |
| OB-1700 | Pairing code expiry — 5-minute TTL, cleanup timer every 60s removes expired entries                                   | `src/core/auth.ts`           | Pending |
| OB-1701 | Rate limit pairing requests — max 3 requests per sender per hour (prevent code spam / brute force)                    | `src/core/auth.ts`           | Pending |
| OB-1702 | Coexist with phone whitelist — pairing is additive, not a replacement. Config `auth.pairingEnabled` (default: `true`) | `src/types/config.ts`        | Pending |
| OB-1703 | Tests: pairing flow (generate → approve → access granted), expiry, rate limiting, CLI approval, /approve command      | `tests/core/auth.test.ts`    | Pending |

**Phase 96b Total:** 10 tasks

---

### Phase 96c — Skills Directory (OB-F87)

| Task    | What                                                                                                                  | Key File                                        | Status  |
| ------- | --------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------- | ------- |
| OB-1704 | Create `SkillManager` class — discovers and loads skill definitions from `.openbridge/skills/` directory              | `src/master/skill-manager.ts` (new)             | Pending |
| OB-1705 | Define `Skill` type + `SKILL.md` format: name, description, tools needed, tool profile, example prompts, constraints  | `src/types/agent.ts`                            | Pending |
| OB-1706 | Create built-in skill definition: `code-review` — diff analysis, review checklist, tool profile: read-only            | `src/master/skills/code-review.ts` (new)        | Pending |
| OB-1707 | Create built-in skill definition: `test-runner` — test execution, coverage, failure analysis, tool profile: code-edit | `src/master/skills/test-runner.ts` (new)        | Pending |
| OB-1708 | Create built-in skill definition: `dependency-audit` — outdated packages, vulnerability scan, tool profile: read-only | `src/master/skills/dependency-audit.ts` (new)   | Pending |
| OB-1709 | Create built-in skill definition: `api-docs-generator` — endpoint extraction, OpenAPI gen, tool profile: code-edit    | `src/master/skills/api-docs-generator.ts` (new) | Pending |
| OB-1710 | Master reads available skills on startup, includes skill directory summary in system prompt                           | `src/master/master-system-prompt.ts`            | Pending |
| OB-1711 | Master auto-creates new skills from successful task patterns — track success rate, extract reusable prompt patterns   | `src/master/skill-manager.ts`                   | Pending |
| OB-1712 | Add `/skills` chat command — list available skills with descriptions and usage counts                                 | `src/core/router.ts`                            | Pending |
| OB-1713 | Tests: skill discovery from filesystem, SKILL.md parsing, system prompt injection, auto-creation from patterns        | `tests/master/skill-manager.test.ts` (new)      | Pending |

**Phase 96c Total:** 10 tasks

---

## Sprint 6 — Skill System, Agent Patterns & Creative Output (v0.0.14)

**Goal:** Extend skill pack system, add creative/visual output, and adopt battle-tested agent orchestration patterns from Devin, Manus, and Cursor.

---

### Phase 98 — Skill Pack System Extensions (OB-F96)

**Problem:** Workers receive generic prompts regardless of task type. No reusable domain-specific instruction sets beyond document packs from Phase 99.

| Task    | What                                                                                                             | Key File                                         | Status  |
| ------- | ---------------------------------------------------------------------------------------------------------------- | ------------------------------------------------ | ------- |
| OB-1744 | Define `SkillPack` type — `name`, `description`, `toolProfile`, `systemPromptExtension`, `requiredTools`, `tags` | `src/types/agent.ts`                             | Pending |
| OB-1745 | Define `SKILLPACK.md` format — name, when to use, tools needed, prompt extension, example tasks, constraints     | `src/master/skill-pack-loader.ts`                | Pending |
| OB-1746 | Built-in skill pack: `security-audit` — CodeQL/Semgrep patterns, vulnerability detection prompts                 | `src/master/skill-packs/security-audit.ts` (new) | Pending |
| OB-1747 | Built-in skill pack: `code-review` — diff analysis, best practices, review checklist prompts                     | `src/master/skill-packs/code-review.ts` (new)    | Pending |
| OB-1748 | Built-in skill pack: `test-writer` — TDD patterns, coverage analysis, edge case generation prompts               | `src/master/skill-packs/test-writer.ts` (new)    | Pending |
| OB-1749 | Built-in skill pack: `data-analysis` — CSV/JSON processing, statistics, visualization generation prompts         | `src/master/skill-packs/data-analysis.ts` (new)  | Pending |
| OB-1750 | Built-in skill pack: `documentation` — API docs, README generation, CHANGELOG prompts                            | `src/master/skill-packs/documentation.ts` (new)  | Pending |
| OB-1751 | Master reads available skill packs on startup, includes summary in system prompt                                 | `src/master/master-system-prompt.ts`             | Pending |
| OB-1752 | Master selects skill pack per worker based on task type — inject prompt extension into worker system prompt      | `src/master/master-manager.ts`                   | Pending |
| OB-1753 | Skill pack selection influences tool profile — `security-audit` pack defaults to `code-audit` profile            | `src/master/master-manager.ts`                   | Pending |
| OB-1754 | User-defined skill packs in `.openbridge/skill-packs/` override built-in defaults                                | `src/master/skill-pack-loader.ts`                | Pending |
| OB-1755 | Master can create new skill packs from successful task patterns (extends prompt evolution)                       | `src/master/skill-pack-loader.ts`                | Pending |
| OB-1756 | Add `/skill-packs` chat command — list available packs with descriptions                                         | `src/core/router.ts`                             | Pending |
| OB-1757 | Add `openbridge skill-packs` CLI command                                                                         | `src/cli/index.ts`                               | Pending |
| OB-1758 | Wire skill pack loader into MemoryManager facade                                                                 | `src/memory/index.ts`                            | Pending |
| OB-1759 | Tests: skill pack discovery, SKILLPACK.md parsing, prompt injection, tool profile override                       | `tests/master/skill-pack-loader.test.ts`         | Pending |
| OB-1760 | Tests: Master skill selection logic, user override precedence                                                    | `tests/master/master-manager.test.ts`            | Pending |

**Phase 98 Total:** 17 tasks

---

### Phase 100 — Design & Creative Output Skills (OB-F99)

**Problem:** No support for visual output — diagrams, charts, generative art, marketing materials.

| Task    | What                                                                                                         | Key File                                               | Status  |
| ------- | ------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------ | ------- |
| OB-1761 | Built-in skill pack: `diagram-maker` — Mermaid/PlantUML/D2 diagram generation, architecture diagrams, flows  | `src/master/skill-packs/diagram-maker.ts` (new)        | Pending |
| OB-1762 | Built-in skill pack: `chart-generator` — D3.js/Chart.js data visualization, bar/line/pie/scatter charts      | `src/master/skill-packs/chart-generator.ts` (new)      | Pending |
| OB-1763 | Built-in skill pack: `web-designer` — HTML/CSS/React landing pages, marketing materials, email templates     | `src/master/skill-packs/web-designer.ts` (new)         | Pending |
| OB-1764 | Built-in skill pack: `slide-designer` — HTML-based presentation slides with animations, exportable to PDF    | `src/master/skill-packs/slide-designer.ts` (new)       | Pending |
| OB-1765 | Built-in skill pack: `generative-art` — p5.js algorithmic art, SVG patterns, creative coding prompts         | `src/master/skill-packs/generative-art.ts` (new)       | Pending |
| OB-1766 | Built-in skill pack: `brand-assets` — logo concepts (SVG), social media images, favicon generation           | `src/master/skill-packs/brand-assets.ts` (new)         | Pending |
| OB-1767 | HTML-to-image pipeline — render HTML outputs to PNG/JPG using Puppeteer for sending via messaging channels   | `src/core/html-renderer.ts` (new)                      | Pending |
| OB-1768 | SVG output support — workers generate SVG, file-server serves, channels send as image                        | `src/core/file-server.ts`                              | Pending |
| OB-1769 | Mermaid rendering support — mermaid-cli or mermaid.ink API for diagram-to-image conversion                   | `src/core/html-renderer.ts`                            | Pending |
| OB-1770 | Output preview via app server — HTML outputs served as interactive previews                                  | `src/core/tunnel-manager.ts`                           | Pending |
| OB-1771 | Master auto-detects creative tasks — intent classification extended with design/visual/chart/diagram intents | `src/core/router.ts`                                   | Pending |
| OB-1772 | Image delivery via WhatsApp/Telegram — send rendered PNG/SVG as media messages                               | `src/connectors/whatsapp/`, `src/connectors/telegram/` | Pending |
| OB-1773 | Tests: diagram generation, chart rendering, HTML-to-image pipeline, creative skill selection                 | `tests/master/creative-skills.test.ts`                 | Pending |
| OB-1774 | Documentation: creative output guide, supported formats, rendering prerequisites                             | `docs/CREATIVE_OUTPUT.md` (new)                        | Pending |

**Phase 100 Total:** 14 tasks

---

### Phase 101 — Agent Orchestration Patterns (OB-F97, OB-F100, OB-F101, OB-F102)

**Problem:** Master has no planning phase, workers aren't grouped, no test protection, fix loops run forever.

| Task    | What                                                                                                                   | Key File                                      | Status  |
| ------- | ---------------------------------------------------------------------------------------------------------------------- | --------------------------------------------- | ------- |
| OB-1775 | Add `PlanningGate` class — Master enters analysis phase (read-only workers) before execution phase (code-edit workers) | `src/master/planning-gate.ts` (new)           | Pending |
| OB-1776 | Planning phase: spawn 1–2 read-only workers to investigate before committing to a strategy                             | `src/master/planning-gate.ts`                 | Pending |
| OB-1777 | Execution phase: only starts after planning workers return and Master confirms approach                                | `src/master/planning-gate.ts`                 | Pending |
| OB-1778 | Skip planning for simple tasks — Master auto-detects complexity (single-file edits, FAQ answers bypass planning)       | `src/master/planning-gate.ts`                 | Pending |
| OB-1779 | Wire planning gate into Master session flow — before SPAWN, check if planning phase completed                          | `src/master/master-manager.ts`                | Pending |
| OB-1780 | Add reasoning checkpoint before full-access workers — Master self-checks: "What could go wrong?"                       | `src/master/master-manager.ts`                | Pending |
| OB-1781 | Add `WorkerSwarm` type — named group of workers with shared context and handoff protocol                               | `src/types/agent.ts`                          | Pending |
| OB-1782 | Create `swarm-coordinator.ts` — groups workers into swarms (research, implement, review, test)                         | `src/master/swarm-coordinator.ts` (new)       | Pending |
| OB-1783 | Swarm handoff — research swarm results feed into implement swarm context, implement into review                        | `src/master/swarm-coordinator.ts`             | Pending |
| OB-1784 | Master decides swarm composition per task — simple tasks skip swarms, complex tasks use full pipeline                  | `src/master/swarm-coordinator.ts`             | Pending |
| OB-1785 | Parallel spawning within swarms — independent workers in same swarm run concurrently (Cursor pattern)                  | `src/master/swarm-coordinator.ts`             | Pending |
| OB-1786 | Add test protection to worker system prompts — "Do not modify test files unless explicitly authorized"                 | `src/master/master-system-prompt.ts`          | Pending |
| OB-1787 | Master can grant test modification permission per-worker when task requires it                                         | `src/master/master-manager.ts`                | Pending |
| OB-1788 | Detect test file modification in worker results — flag for Master review if unauthorized                               | `src/master/worker-result-formatter.ts`       | Pending |
| OB-1789 | Add iteration cap to worker fix loops — max 3 attempts at lint/test fixes before escalating to Master                  | `src/core/agent-runner.ts`                    | Pending |
| OB-1790 | On cap hit: worker reports partial fix + error details to Master, Master decides next action                           | `src/core/agent-runner.ts`                    | Pending |
| OB-1791 | Configurable cap via `worker.maxFixIterations` config option (default: 3)                                              | `src/types/config.ts`                         | Pending |
| OB-1792 | Tests: planning gate flow, swarm coordination, test protection, iteration caps                                         | `tests/master/orchestration-patterns.test.ts` | Pending |
| OB-1793 | Tests: parallel spawning within swarms, handoff data integrity                                                         | `tests/master/swarm-coordinator.test.ts`      | Pending |

**Phase 101 Total:** 19 tasks

---

### Full Summary

| Phase     | Focus                                      | Findings               | Tasks   | Sprint    |
| --------- | ------------------------------------------ | ---------------------- | ------- | --------- |
| **93**    | Structured Observations & Worker Summaries | OB-F80, OB-F82, OB-F88 | 27      | 5 Core    |
| **95**    | Session Compaction & Token Economics       | OB-F83, OB-F84         | 18      | 5 Core    |
| **96d**   | Channel Role Management UX                 | OB-F103                | 12      | 5 Core    |
| **99**    | Document Generation Skills                 | OB-F98                 | 18      | 5 Core    |
| **94**    | Vector Search & Hybrid Retrieval           | OB-F79, OB-F81         | 21      | 5 Stretch |
| **96a**   | `openbridge doctor`                        | OB-F85                 | 10      | 5 Stretch |
| **96b**   | Pairing-Based Auth                         | OB-F86                 | 10      | 5 Stretch |
| **96c**   | Skills Directory                           | OB-F87                 | 10      | 5 Stretch |
| **98**    | Skill Pack System Extensions               | OB-F96                 | 17      | 6         |
| **100**   | Design & Creative Output                   | OB-F99                 | 14      | 6         |
| **101**   | Agent Orchestration Patterns               | OB-F97, OB-F100–F102   | 19      | 6         |
| **Total** |                                            | **18 findings**        | **177** |           |

**Sprint 5:** 126 tasks (75 core + 51 stretch) — v0.0.13
**Sprint 6:** 50 tasks — v0.0.14
**Grand total:** 176 tasks (OB-1618 through OB-1793)

**Implementation Order:**

1. Phase 93 (observations) — foundational
2. Phase 95 (compaction) + Phase 96d (role UX) — parallel
3. Phase 99 (document generation) — after Phase 93
4. Phase 94 (vector search) — after Phase 93
5. Phases 96a, 96b, 96c — independent
6. Phase 98 (skill packs) — after Phase 99
7. Phases 100, 101 — independent, after Phase 98

---
