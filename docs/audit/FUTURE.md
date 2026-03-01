# OpenBridge — Future Work

> **Purpose:** Planned features, deferred findings, finalization items, and backlog for future versions.
> **Last Updated:** 2026-03-01 | **Current Release:** v0.0.8 (Phases 1–73, 652 tasks shipped)
> **23 open findings** — see [FINDINGS.md](FINDINGS.md) for full details
> **Current focus:** Marketplace Development Track — make OpenBridge effective for finishing 3 Marketplace projects (frontend, dashboard, backend services).

---

## Marketplace Development Track

The immediate priority is making OpenBridge capable of helping finish the Marketplace projects:

- **Marketplace** — Next.js 15 customer-facing frontend (early-mid dev, 0 tests)
- **Marketplace-dashboard** — Next.js 15 admin/supplier dashboard (mid dev, needs stabilization)
- **Marketplace-backend-services** — NestJS monorepo with 24 modules (production-ready, 438 tests, needs integration testing)

### What OpenBridge needs to be useful for Marketplace development:

1. Workers that can run `npm test`, `npm run lint`, `npm run typecheck` (OB-F57)
2. Stable exploration that doesn't break on large codebases (OB-F58–F65)
3. Clean `.openbridge/` data — no stale/corrupted state (OB-F66, OB-F67)
4. Knowledge retrieval (RAG) — 3 large codebases need efficient lookup, not re-reading everything (OB-F48)
5. Environment variable protection — Marketplace backend has DB_URL, API keys (OB-F70)
6. Output sharing — Master needs to send test reports and analysis results (OB-F68)
7. User consent — production code needs confirmation before risky edits (OB-F71)

---

## Sprint 1: Foundation Fixes (v0.0.9) — ~34 tasks

**Goal:** Fix the bugs that would cause OpenBridge to fail or produce bad results when exploring and working on Marketplace projects.

### Phase 78a — Classification & Response Fixes (~9 tasks)

**Findings:** OB-F76, OB-F77, OB-F78

**Problem:** Discovered during real-world testing (2026-03-01). When a user asks OpenBridge to "start execution" of a task group, three bugs combine to produce a near-empty response after 3 minutes of processing:

1. The keyword classifier misses execution/delegation keywords → wrong task class (tool-use instead of complex-task)
2. SPAWN markers are stripped from the response, leaving only a brief stub (29 chars)
3. No log warning when response is truncated by SPAWN stripping

**Why critical for Marketplace:** Every Marketplace task that requires worker delegation (running tests, auditing modules, executing task groups) will hit these bugs. The user gets an empty response and has to retry.

| Task | Finding | What                                                                                                                                                                      | Key File                              |
| ---- | ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------- |
| 1    | OB-F76  | Add execution/delegation keywords to complex-task list: `"execute"`, `"start"`, `"proceed"`, `"begin"`, `"launch"`, `"run tasks"`, `"start execution"`, `"execute group"` | `src/master/master-manager.ts`        |
| 2    | OB-F76  | Add pattern matching for "start the [noun]" / "execute [noun]" as complex-task triggers                                                                                   | `src/master/master-manager.ts`        |
| 3    | OB-F76  | Add tests for new execution keyword patterns                                                                                                                              | `tests/master/master-manager.test.ts` |
| 4    | OB-F77  | After SPAWN stripping, check if `cleanedOutput.length < 80`                                                                                                               | `src/master/master-manager.ts`        |
| 5    | OB-F77  | Generate status message when cleaned output is too short: "Dispatching {N} worker(s) for: {summaries}..."                                                                 | `src/master/master-manager.ts`        |
| 6    | OB-F77  | Extract task descriptions from parsed SPAWN markers for the status message                                                                                                | `src/master/spawn-parser.ts`          |
| 7    | OB-F77  | Add tests for empty-response-after-stripping scenario                                                                                                                     | `tests/master/spawn-parser.test.ts`   |
| 8    | OB-F78  | Log original vs cleaned response length after SPAWN stripping                                                                                                             | `src/master/master-manager.ts`        |
| 9    | OB-F78  | Add warning when cleaned length < 80 and original > 200                                                                                                                   | `src/master/master-manager.ts`        |

---

### Phase 78b — Code Audit Profile (~8 tasks)

**Finding:** OB-F57 — Workers cannot run tests or do deep code analysis.

**Problem:** When users ask for codebase audits via WebChat, workers can only read files (surface inspection). They cannot run `npm test`, `npm run typecheck`, or `npm run lint`. They have no instructions on how to find logic bugs, trace error paths, or verify schemas. The result is "test driver" analysis (what's visible) instead of "mechanic" analysis (what's actually broken).

**Why critical for Marketplace:** The Marketplace backend has 438 test files. The frontend and dashboard have 0 tests. Workers need to run tests to verify code, and run lint/typecheck to catch issues before they become bugs.

**Planned Solution:** New `code-audit` built-in profile + deep analysis prompt templates + Master system prompt guidance.

| Task | What                                                                           | Key File                             |
| ---- | ------------------------------------------------------------------------------ | ------------------------------------ |
| 1    | Add `code-audit` to `BuiltInProfileNameSchema` enum                            | `src/types/agent.ts`                 |
| 2    | Add `code-audit` profile to `BUILT_IN_PROFILES` with test/lint/typecheck tools | `src/types/agent.ts`                 |
| 3    | Add `TOOLS_CODE_AUDIT` constant                                                | `src/core/agent-runner.ts`           |
| 4    | Add `code-audit` guideline + SPAWN example to system prompt                    | `src/master/master-system-prompt.ts` |
| 5    | Add "Deep Analysis Tasks" section to system prompt                             | `src/master/master-system-prompt.ts` |
| 6    | Add `TASK_CODE_AUDIT` seed prompt template                                     | `src/master/seed-prompts.ts`         |
| 7    | Add tests for code-audit profile resolution                                    | `tests/core/agent-runner.test.ts`    |
| 8    | Add test for code-audit SPAWN marker parsing                                   | `tests/master/spawn-parser.test.ts`  |

**Profile tools:**

```
Read, Glob, Grep,
Bash(npm:test), Bash(npm:run:lint), Bash(npm:run:typecheck),
Bash(npx:vitest:*), Bash(npx:eslint:*), Bash(npx:tsc:*),
Bash(npm:run:test:*), Bash(pytest:*), Bash(cargo:test)
```

---

### Phase 79 — Exploration Bug Fixes (~10 tasks)

**Findings:** OB-F58, OB-F59, OB-F60, OB-F61, OB-F62, OB-F63, OB-F64, OB-F65

**Problem:** 8 bugs and gaps in the exploration system. These matter for Marketplace because the 3 projects are large codebases — exploration failures, corrupt data, and broken retries mean OpenBridge will misunderstand the projects.

| Task | Finding | What                                                                        | Key File                                |
| ---- | ------- | --------------------------------------------------------------------------- | --------------------------------------- |
| 1    | OB-F58  | Add `recover()` method for error state; allow retry after explore() failure | `src/master/master-manager.ts`          |
| 2    | OB-F59  | Add optional `schema` param to `parseAIResult()`, validate before return    | `src/master/result-parser.ts`           |
| 3    | OB-F59  | Pass Zod schemas from exploration-coordinator callers                       | `src/master/exploration-coordinator.ts` |
| 4    | OB-F60  | Move `pendingDives` inside batch loop so retries work                       | `src/master/exploration-coordinator.ts` |
| 5    | OB-F61  | Fix progress formula (remove `- weight` subtraction)                        | `src/master/exploration-coordinator.ts` |
| 6    | OB-F62  | Add `writeAnalysisMarkerToStore()` + cache update to `reExplore()`          | `src/master/master-manager.ts`          |
| 7    | OB-F63  | Read old content before overwriting in `writePromptTemplate()`              | `src/master/dotfolder-manager.ts`       |
| 8    | OB-F64  | Propagate `totalFiles` from structure scan to `buildSummary()`              | `src/master/exploration-coordinator.ts` |
| 9    | OB-F65  | Add media/asset awareness to exploration prompts                            | `src/master/exploration-prompts.ts`     |
| 10   | —       | Add tests for all fixes                                                     | `tests/master/*.test.ts`                |

---

### Phase 80 — .openbridge Data Cleanup (~7 tasks)

**Findings:** OB-F66, OB-F67

**Problem:** `.openbridge` data in both primary and secondary workspaces is stale/corrupted from early development. memory.md claims wrong version, workspace map has wrong file counts, secondary workspace map points to wrong project entirely. Must be cleaned before pointing OpenBridge at Marketplace projects.

| Task | Finding | What                                                                   |
| ---- | ------- | ---------------------------------------------------------------------- |
| 1    | OB-F66  | Create `scripts/cleanup-openbridge.sh` to reset stale exploration data |
| 2    | OB-F66  | Delete stale memory.md (Master regenerates on next session)            |
| 3    | OB-F66  | Delete stale workspace-map.json (regenerated by re-exploration)        |
| 4    | OB-F66  | Clear stale exploration state from SQLite system_config                |
| 5    | OB-F66  | Clear stale workspace_state table                                      |
| 6    | OB-F67  | Delete entire secondary workspace `.openbridge/` folder                |
| 7    | —       | Trigger fresh full exploration and verify correct data                 |

---

## Sprint 2: Knowledge & Safety (v0.0.10) — ~42 tasks

**Goal:** Enable efficient knowledge retrieval across the 3 Marketplace codebases and protect sensitive credentials.

### Phases 74–77 — Knowledge-First Retrieval (RAG) (~32 tasks)

**Finding:** OB-F48 — Master AI answers codebase questions from stale context. Never queries the chunk store, exploration JSONs, or workspace map key files. Expensive exploration data goes unused after startup.

**Why critical for Marketplace:** Three large codebases (NestJS monorepo with 24 modules, two Next.js apps with dozens of components). Without RAG, the Master re-reads files for every question instead of querying existing knowledge. This wastes time and turns.

**Planned Solution:** Query existing knowledge base first (FTS5 chunks, workspace map, dir-dive JSONs), spawn targeted read workers only for gaps.

| Phase | What                                                                                                                 | Estimated Tasks |
| ----- | -------------------------------------------------------------------------------------------------------------------- | --------------- |
| 74    | Knowledge Retriever — new `knowledge-retriever.ts`, FTS5 + workspace map + dir-dive queries, confidence scoring      | ~10             |
| 75    | Context Injection — wire retriever into `processMessage()`, `codebase-question` task class, format knowledge context | ~8              |
| 76    | Targeted Reader — spawn focused read workers for low-confidence gaps, enrich chunks from reads                       | ~6              |
| 77    | Chunk Enrichment — store worker read results as chunks, Q&A pair caching, entity extraction                          | ~8              |

**Key files to modify:**

- `src/core/knowledge-retriever.ts` (new) — RAG query orchestrator
- `src/master/master-manager.ts` — wire retriever into `processMessage()`
- `src/master/master-system-prompt.ts` — `codebase-question` classifier
- `src/memory/retrieval.ts` — new query helpers for key file matching
- `src/master/dotfolder-manager.ts` — dir-dive JSON loading API
- `src/memory/chunk-store.ts` — chunk enrichment from worker reads + Q&A pairs

**Full design spec:** [V18 findings archive](archive/v18/FINDINGS-v18.md)

---

### Phase 85 — Environment Variable Protection (~8–10 tasks)

**Finding:** OB-F70 — Environment variables leak sensitive secrets to workers.

**Why critical for Marketplace:** The Marketplace backend uses `DATABASE_URL`, `REDIS_URL`, `SMTP_PASSWORD`, `OPENAI_API_KEY`, `GITHUB_TOKEN`, and more. All of these are inherited by workers. A worker with `Bash(*)` can run `env` and see everything.

Strip sensitive environment variables before they reach workers.

| Task | What                                                                                                                                                                                                                         | Key File                              |
| ---- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------- |
| 1    | Define default deny-list patterns: `AWS_*`, `GITHUB_*`, `GH_*`, `TOKEN_*`, `SECRET_*`, `PASSWORD_*`, `PRIVATE_*`, `DB_*`, `DATABASE_*`, `SMTP_*`, `OPENAI_*`, `ANTHROPIC_*`, `API_KEY*`, `*_SECRET`, `*_TOKEN`, `*_PASSWORD` | `src/types/config.ts`                 |
| 2    | Add `security.envDenyPatterns` to config schema (Zod) with defaults                                                                                                                                                          | `src/types/config.ts`                 |
| 3    | Add `security.envAllowPatterns` (opt-in allowlist mode)                                                                                                                                                                      | `src/types/config.ts`                 |
| 4    | Create `sanitizeEnv()` utility — applies deny/allow patterns                                                                                                                                                                 | `src/core/env-sanitizer.ts` (new)     |
| 5    | Wire `sanitizeEnv()` into `ClaudeAdapter.cleanEnv()`                                                                                                                                                                         | `src/core/adapters/claude-adapter.ts` |
| 6    | Wire `sanitizeEnv()` into `CodexAdapter.cleanEnv()`                                                                                                                                                                          | `src/core/adapters/codex-adapter.ts`  |
| 7    | Wire `sanitizeEnv()` into `AiderAdapter.cleanEnv()`                                                                                                                                                                          | `src/core/adapters/aider-adapter.ts`  |
| 8    | Startup warning: scan env for known secret patterns, log warning if found                                                                                                                                                    | `src/core/bridge.ts`                  |
| 9    | Update `config.example.json` with `security` section                                                                                                                                                                         | `config.example.json`                 |
| 10   | Tests for env sanitization (deny patterns, allow patterns, edge cases)                                                                                                                                                       | `tests/core/env-sanitizer.test.ts`    |

---

## Sprint 3: Development Workflow (v0.0.11) — ~20 tasks

**Goal:** Complete the development workflow — Master shares outputs and asks for confirmation before risky operations.

### Phase 81 — Master Output Awareness (~5–8 tasks)

**Finding:** OB-F68 — Master AI doesn't know how to share generated files.

**Why useful for Marketplace:** When OpenBridge generates test reports, code analysis results, or documentation for the Marketplace projects, the Master needs to send them back via WhatsApp/Telegram/WebChat.

Teach the Master AI how to share generated files using existing infrastructure.

| Task | What                                                                                    | Key File                             |
| ---- | --------------------------------------------------------------------------------------- | ------------------------------------ |
| 1    | Add `[SHARE:*]` marker documentation to Master system prompt                            | `src/master/master-system-prompt.ts` |
| 2    | Inject active connector names into system prompt (so Master knows which channels exist) | `src/master/master-system-prompt.ts` |
| 3    | Add output routing guidelines (PDF → attachment, HTML → GitHub Pages, etc.)             | `src/master/master-system-prompt.ts` |
| 4    | Add `TASK_GENERATE_OUTPUT` seed prompt with file-sharing instructions                   | `src/master/seed-prompts.ts`         |
| 5    | Test: Master generates HTML → uses [SHARE:whatsapp] → user receives attachment          | `tests/master/`                      |
| 6    | Test: Master generates report → uses [SHARE:github-pages] → returns URL                 | `tests/master/`                      |
| 7    | Add file-server URL to system prompt context (localhost:3001 base URL)                  | `src/master/master-system-prompt.ts` |

---

### Phase 86 — User Consent & Execution Transparency (~12–15 tasks)

**Finding:** OB-F71 — No user consent before risky/expensive worker operations.

**Why important for Marketplace:** When working on production code (especially the backend with its 24 NestJS modules), you want to know before a worker edits files or runs destructive commands.

Require user confirmation before risky operations, show execution summaries.

| Task | What                                                                                                                                    | Key File                     |
| ---- | --------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------- |
| 1    | Define risk classification per tool profile: `low` (read-only), `medium` (code-edit), `high` (full-access), `critical` (deploy/publish) | `src/types/agent.ts`         |
| 2    | Add `security.confirmHighRisk` config option (default: `true`)                                                                          | `src/types/config.ts`        |
| 3    | Router intercepts SPAWN markers for high/critical risk — sends confirmation prompt                                                      | `src/core/router.ts`         |
| 4    | Confirmation flow: "I'm about to [action] using [profile]. Reply 'go' or 'skip'."                                                       | `src/core/router.ts`         |
| 5    | Confirmation timeout: 60s → auto-cancel (fail-safe)                                                                                     | `src/core/router.ts`         |
| 6    | Add `/confirm` and `/skip` commands                                                                                                     | `src/core/router.ts`         |
| 7    | Cost estimation: estimate turns × model cost before spawn                                                                               | `src/core/agent-runner.ts`   |
| 8    | Show cost estimate in confirmation prompt: "~15 turns, ~$0.50, ~2 min"                                                                  | `src/core/router.ts`         |
| 9    | Execution summary after worker completes: files read, files modified, commands run                                                      | `src/core/router.ts`         |
| 10   | Add `/audit` command: show last N worker spawns with profile, tools, duration, cost                                                     | `src/core/router.ts`         |
| 11   | Audit log persistence: write execution traces to `.openbridge/audit/`                                                                   | `src/core/audit-logger.ts`   |
| 12   | Per-user consent preferences in access-store (always-ask, auto-approve-read, etc.)                                                      | `src/memory/access-store.ts` |
| 13   | Tests for confirmation flow, timeout, audit log                                                                                         | `tests/core/`                |

---

## Sprint 4: Platform Completion (v0.0.12) — ~160 tasks

**Goal:** Complete the platform — Deep Mode for thorough analysis, modernized WebChat, tunnel for remote access, document visibility controls, and Docker sandbox for security.

### Deep Mode (OB-F56) — ~30–40 tasks

**Finding:** OB-F56 — No multi-phase execution for complex analysis tasks.

**Problem:** OpenBridge processes all tasks in a single pass (classify → execute → respond). For complex analysis (codebase audits, refactoring plans, security reviews), a multi-phase approach produces significantly better results: investigate → report → plan → execute → verify.

**Why needed now:** With Sprints 1–3 complete, OpenBridge can explore, audit, and work on the Marketplace projects. Deep Mode adds the ability to do thorough, multi-phase analysis with user steering between phases.

**Planned Solution:**

1. **Execution profiles** — user-configurable per message or per user:
   - `fast`: Current flow (classify → execute → done)
   - `thorough`: Multi-phase (investigate → report → plan → execute → verify)
   - `manual`: Like thorough but pauses at every phase for user approval

2. **Per-phase model selection** — configurable model tier per phase:
   - Investigation: powerful (deep reasoning)
   - Planning: powerful (architecture decisions)
   - Execution: balanced (code writing)
   - Verification: fast (quick checks)

3. **Interactive phase navigation** — chat commands:
   - "proceed" / "go" — advance to next phase
   - "focus N" — dig deeper into finding N
   - "skip N" — skip task N
   - "use opus for task 1" — override model for a specific task

4. **Phase state machine** — tracks current phase, allows back/skip/focus navigation

**Key components:**

- Deep mode classifier in `master-manager.ts`
- Phase state machine in `master-manager.ts`
- Interactive commands (`/deep`, `/proceed`, `/focus`, `/skip`) in `router.ts`
- Phase-aware system prompts per worker role in `master-system-prompt.ts`
- User preferences store in SQLite (model prefs, depth settings)
- Progress reporting per phase (extends existing progress events)

---

### Output Delivery Pipeline — Phases 82–84 (~28–32 tasks)

**Finding:** OB-F69 — No delivery path for interactive web apps.

**Why needed now:** After Sprint 3 teaches the Master to share files via `[SHARE:*]` markers, the next step is enabling public URL delivery and interactive app hosting — making OpenBridge outputs accessible from anywhere, not just localhost.

#### Phase 82 — Tunnel Integration (~8–10 tasks)

Expose the local file-server to the internet so Master can send public URLs to mobile users.

| Task | What                                                                             | Key File                             |
| ---- | -------------------------------------------------------------------------------- | ------------------------------------ |
| 1    | Auto-detect tunnel tools (`cloudflared`, `ngrok`, `localtunnel`) in tool-scanner | `src/discovery/tool-scanner.ts`      |
| 2    | Create `TunnelManager` class — start/stop/status, URL lifecycle                  | `src/core/tunnel-manager.ts` (new)   |
| 3    | Implement `cloudflared` tunnel adapter (preferred — free, no signup)             | `src/core/tunnel-manager.ts`         |
| 4    | Implement `ngrok` tunnel adapter (fallback)                                      | `src/core/tunnel-manager.ts`         |
| 5    | Wire TunnelManager into Bridge startup (auto-start if tunnel tool available)     | `src/core/bridge.ts`                 |
| 6    | File-server returns public tunnel URL when available                             | `src/core/file-server.ts`            |
| 7    | Master system prompt updated with public URL capability                          | `src/master/master-system-prompt.ts` |
| 8    | Auto-cleanup tunnel on process exit                                              | `src/core/tunnel-manager.ts`         |
| 9    | Config option: `tunnel.enabled`, `tunnel.provider`, `tunnel.subdomain`           | `src/types/config.ts`                |
| 10   | Tests for tunnel lifecycle                                                       | `tests/core/tunnel-manager.test.ts`  |

#### Phase 83 — Ephemeral App Server (~10–12 tasks)

Enable workers to scaffold interactive web apps that OpenBridge manages and serves.

| Task | What                                                                                     | Key File                             |
| ---- | ---------------------------------------------------------------------------------------- | ------------------------------------ |
| 1    | Create `AppServer` class — start/stop/monitor ephemeral apps                             | `src/core/app-server.ts` (new)       |
| 2    | App scaffold detection: `package.json` → `npm start`, `index.html` → static serve        | `src/core/app-server.ts`             |
| 3    | App lifecycle: start → health check → idle timeout → stop                                | `src/core/app-server.ts`             |
| 4    | Port allocation: assign unique ports per app (range: 3100–3199)                          | `src/core/app-server.ts`             |
| 5    | Tunnel integration: each app gets its own public URL                                     | `src/core/tunnel-manager.ts`         |
| 6    | Add `[APP:start]` / `[APP:stop]` markers for Router                                      | `src/core/router.ts`                 |
| 7    | Master system prompt: instructions for scaffolding apps in `.openbridge/generated/apps/` | `src/master/master-system-prompt.ts` |
| 8    | Add `TASK_BUILD_APP` seed prompt                                                         | `src/master/seed-prompts.ts`         |
| 9    | App listing: `/apps` command shows running apps with URLs                                | `src/core/router.ts`                 |
| 10   | Graceful cleanup: stop all apps on bridge shutdown                                       | `src/core/bridge.ts`                 |
| 11   | Resource limits: max concurrent apps, max memory per app                                 | `src/types/config.ts`                |
| 12   | Tests for app lifecycle                                                                  | `tests/core/app-server.test.ts`      |

#### Phase 84 — Interaction Relay (~8–10 tasks)

Enable bidirectional communication between served apps and the Master AI.

| Task | What                                                                                   | Key File                               |
| ---- | -------------------------------------------------------------------------------------- | -------------------------------------- |
| 1    | Create `openbridge-client.js` SDK — auto-injected into served apps                     | `src/core/interaction-relay.ts` (new)  |
| 2    | WebSocket relay: app → Bridge → Master (form submissions, button clicks, data queries) | `src/core/interaction-relay.ts`        |
| 3    | Master receives interaction events as special messages                                 | `src/core/router.ts`                   |
| 4    | Master can respond to interactions (update data, push UI changes)                      | `src/master/master-manager.ts`         |
| 5    | Client SDK API: `openbridge.submit(data)`, `openbridge.onUpdate(callback)`             | `src/core/interaction-relay.ts`        |
| 6    | Security: interaction relay only accepts connections from known apps                   | `src/core/interaction-relay.ts`        |
| 7    | Smart Output Router: Master auto-classifies output type → picks best delivery          | `src/master/master-system-prompt.ts`   |
| 8    | Tests for interaction flow                                                             | `tests/core/interaction-relay.test.ts` |

---

### Document Visibility Controls — Phase 87 (~12–15 tasks)

**Finding:** OB-F72 — No document visibility controls.

**Why needed now:** With Docker sandbox (below) and env var protection (Sprint 2), document visibility completes the security boundary — controlling what the AI can see in the workspace.

#### Phase 87 — Document Visibility Controls

Control what the AI can see in the workspace, detect and protect sensitive files.

| Task | What                                                                                                                                                                            | Key File                             |
| ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------ |
| 1    | Add `workspace.include` and `workspace.exclude` to config schema                                                                                                                | `src/types/config.ts`                |
| 2    | Default exclude list: `.env`, `.env.*`, `*.pem`, `*.key`, `*.p12`, `*.pfx`, `credentials.*`, `secrets/`, `id_rsa*`, `id_ed25519*`, `*.sqlite` (non-openbridge), `.git/objects/` | `src/types/config.ts`                |
| 3    | Create `isFileVisible(path, config)` — checks include/exclude rules                                                                                                             | `src/core/workspace-manager.ts`      |
| 4    | Resolve symlinks before visibility check (prevent escape)                                                                                                                       | `src/core/workspace-manager.ts`      |
| 5    | Normalize all paths with `path.resolve()` before scope checks                                                                                                                   | `src/core/workspace-manager.ts`      |
| 6    | Secret file scanner: on startup, detect sensitive files in workspace                                                                                                            | `src/core/secret-scanner.ts` (new)   |
| 7    | Known patterns: `.env`, `*.pem`, `*.key`, `service-account.json`, `*.p12`, SSH keys                                                                                             | `src/core/secret-scanner.ts`         |
| 8    | Startup warning: log detected sensitive files + auto-add to exclude                                                                                                             | `src/core/bridge.ts`                 |
| 9    | Content redaction (optional): scan file content for API key patterns before sending to AI                                                                                       | `src/core/content-redactor.ts` (new) |
| 10   | Redaction patterns: `sk-...`, `AKIA...`, `ghp_...`, `ghs_...`, `-----BEGIN.*PRIVATE KEY-----`, connection strings                                                               | `src/core/content-redactor.ts`       |
| 11   | `/scope` command: show current visibility rules + detected secrets                                                                                                              | `src/core/router.ts`                 |
| 12   | Setup wizard: ask about visibility preferences during `npx openbridge init`                                                                                                     | `src/cli/init.ts`                    |
| 13   | Master system prompt: inform Master about visibility restrictions                                                                                                               | `src/master/master-system-prompt.ts` |
| 14   | Tests for visibility checks, secret scanner, redaction                                                                                                                          | `tests/core/`                        |

---

### WebChat Modernization — Phases 88–92 (~56–69 tasks)

**Findings:** OB-F73 (no authentication), OB-F74 (inlined HTML string blocks improvements), OB-F75 (not accessible from phone)

**Why needed now:** With Deep Mode, tunnel integration, and the full development workflow in place, WebChat becomes the primary interface for power users. Modernization makes it production-ready.

#### Phase 88 — Frontend Extraction + UI Foundation (~12–15 tasks)

Extract the WebChat UI from the inlined HTML string into a proper component-based frontend.

| Task | What                                                                                   | Key File                                      |
| ---- | -------------------------------------------------------------------------------------- | --------------------------------------------- |
| 1    | Create `src/connectors/webchat/ui/` directory structure                                | `src/connectors/webchat/ui/` (new)            |
| 2    | Extract HTML structure into `index.html` template                                      | `src/connectors/webchat/ui/index.html`        |
| 3    | Extract CSS into `styles.css` with CSS custom properties (light theme)                 | `src/connectors/webchat/ui/styles.css`        |
| 4    | Add dark theme CSS variables + toggle button + localStorage persistence                | `src/connectors/webchat/ui/styles.css`        |
| 5    | Extract JS into modular files: `app.js`, `websocket.js`, `markdown.js`, `dashboard.js` | `src/connectors/webchat/ui/*.js`              |
| 6    | Replace 40-line markdown splitter with `marked` (inlined, no CDN)                      | `src/connectors/webchat/ui/markdown.js`       |
| 7    | Add syntax highlighting with `highlight.js` core (inlined) for code blocks             | `src/connectors/webchat/ui/markdown.js`       |
| 8    | Add copy button on code blocks                                                         | `src/connectors/webchat/ui/markdown.js`       |
| 9    | Add collapsible sections for long AI responses (click to expand/collapse)              | `src/connectors/webchat/ui/app.js`            |
| 10   | Build script: esbuild bundles `ui/` → single HTML string injected into connector       | `scripts/build-webchat-ui.js` (new)           |
| 11   | Update `webchat-connector.ts` to load bundled HTML instead of inline string            | `src/connectors/webchat/webchat-connector.ts` |
| 12   | Add ARIA labels, keyboard navigation (Tab/Enter/Escape), focus management              | `src/connectors/webchat/ui/`                  |
| 13   | Add message timestamps (hover to show, option to always show)                          | `src/connectors/webchat/ui/app.js`            |
| 14   | Add user/AI avatars for visual distinction                                             | `src/connectors/webchat/ui/styles.css`        |
| 15   | Tests: verify bundled HTML serves correctly, markdown rendering, dark mode toggle      | `tests/connectors/webchat/`                   |

#### Phase 89 — WebChat Authentication (~10–12 tasks)

Add authentication to the WebChat so it can be safely exposed beyond localhost.

| Task | What                                                                                                 | Key File                                      |
| ---- | ---------------------------------------------------------------------------------------------------- | --------------------------------------------- |
| 1    | Generate random auth token on first startup, persist in `config.json` or `.openbridge/webchat-token` | `src/connectors/webchat/webchat-connector.ts` |
| 2    | Display auth token + URL in console output on startup: `WebChat: http://localhost:3000?token=xxx`    | `src/connectors/webchat/webchat-connector.ts` |
| 3    | Show QR code in console containing the authenticated URL (for phone scanning)                        | `src/connectors/webchat/webchat-connector.ts` |
| 4    | Validate token on HTTP requests — reject with 401 if missing/wrong                                   | `src/connectors/webchat/webchat-connector.ts` |
| 5    | Validate token on WebSocket upgrade — reject connection if token invalid                             | `src/connectors/webchat/webchat-connector.ts` |
| 6    | Add optional `webchat.password` config field — if set, show login screen instead of token auth       | `src/connectors/webchat/webchat-config.ts`    |
| 7    | Login screen UI: password input + submit + error message                                             | `src/connectors/webchat/ui/login.html`        |
| 8    | Session management: set HTTP-only cookie on successful login, validate on subsequent requests        | `src/connectors/webchat/webchat-connector.ts` |
| 9    | Map authenticated WebChat users to access-store entries (roles, scopes, budgets)                     | `src/core/auth.ts`                            |
| 10   | Per-IP rate limiting on login attempts (prevent brute force)                                         | `src/connectors/webchat/webchat-connector.ts` |
| 11   | Add `webchat.auth` section to `config.example.json`                                                  | `config.example.json`                         |
| 12   | Tests: token validation, password auth, rate limiting, WebSocket rejection                           | `tests/connectors/webchat/`                   |

#### Phase 90 — Phone Access + Mobile PWA (~12–15 tasks)

Make the WebChat accessible from the user's phone (LAN + internet) and optimize for mobile.

| Task | What                                                                                 | Key File                                      |
| ---- | ------------------------------------------------------------------------------------ | --------------------------------------------- |
| 1    | Change default `host` from `'localhost'` to `'0.0.0.0'` (bind to all interfaces)     | `src/connectors/webchat/webchat-config.ts`    |
| 2    | Auto-detect local IP addresses on startup, display LAN URL in console                | `src/connectors/webchat/webchat-connector.ts` |
| 3    | Display QR code in console with authenticated LAN URL for phone scanning             | `src/connectors/webchat/webchat-connector.ts` |
| 4    | When tunnel active (Phase 82): display public URL + QR in console and WebChat header | `src/connectors/webchat/webchat-connector.ts` |
| 5    | Add "Share this link" button in WebChat header (copies URL to clipboard)             | `src/connectors/webchat/ui/app.js`            |
| 6    | Add `manifest.json` — app name, icons, theme color, `display: standalone`            | `src/connectors/webchat/ui/manifest.json`     |
| 7    | Add service worker — cache HTML/CSS/JS shell, show "Reconnecting..." offline         | `src/connectors/webchat/ui/sw.js`             |
| 8    | Responsive CSS: full-width on mobile (< 768px), centered card on desktop             | `src/connectors/webchat/ui/styles.css`        |
| 9    | Touch-friendly: 44px minimum tap targets, larger send button, proper spacing         | `src/connectors/webchat/ui/styles.css`        |
| 10   | iOS safe area insets for notch/home indicator                                        | `src/connectors/webchat/ui/styles.css`        |
| 11   | Browser notifications on task completion (`Notification.requestPermission()`)        | `src/connectors/webchat/ui/app.js`            |
| 12   | Tab title updates: `(3) OpenBridge` for unread messages                              | `src/connectors/webchat/ui/app.js`            |
| 13   | Sound notification on response arrival (with mute toggle in header)                  | `src/connectors/webchat/ui/app.js`            |
| 14   | "Add to Home Screen" prompt on first mobile visit                                    | `src/connectors/webchat/ui/app.js`            |
| 15   | Tests: LAN binding, QR generation, manifest serving, notification permissions        | `tests/connectors/webchat/`                   |

#### Phase 91 — Conversation History + Rich Input (~12–15 tasks)

Add conversation history sidebar, file upload, voice input, and slash command autocomplete.

| Task | What                                                                                                                  | Key File                                      |
| ---- | --------------------------------------------------------------------------------------------------------------------- | --------------------------------------------- |
| 1    | Add sidebar component (hidden on mobile, toggleable on desktop)                                                       | `src/connectors/webchat/ui/sidebar.js`        |
| 2    | Fetch past conversations from existing `/api/sessions` REST API                                                       | `src/connectors/webchat/ui/sidebar.js`        |
| 3    | Display session list with title, date, message count                                                                  | `src/connectors/webchat/ui/sidebar.js`        |
| 4    | Click session → load full transcript from `/api/sessions/{id}`                                                        | `src/connectors/webchat/ui/sidebar.js`        |
| 5    | "New conversation" button to start fresh session                                                                      | `src/connectors/webchat/ui/sidebar.js`        |
| 6    | Search across conversations (FTS5 already exists in backend)                                                          | `src/connectors/webchat/ui/sidebar.js`        |
| 7    | Persist current conversation in localStorage (survive page refresh)                                                   | `src/connectors/webchat/ui/app.js`            |
| 8    | Switch `<input>` to `<textarea>` — Shift+Enter for newline, Enter to send                                             | `src/connectors/webchat/ui/app.js`            |
| 9    | File upload button — drag-and-drop or click to attach files/images                                                    | `src/connectors/webchat/ui/app.js`            |
| 10   | File upload backend: accept multipart form data via WebSocket or REST                                                 | `src/connectors/webchat/webchat-connector.ts` |
| 11   | Voice input button — record audio, send to existing voice transcription API (Phase 70)                                | `src/connectors/webchat/ui/app.js`            |
| 12   | Slash command autocomplete — type `/` → dropdown with available commands                                              | `src/connectors/webchat/ui/autocomplete.js`   |
| 13   | Populate autocomplete from Router command list (`/history`, `/stop`, `/status`, `/deep`, `/audit`, `/scope`, `/apps`) | `src/connectors/webchat/webchat-connector.ts` |
| 14   | Feedback buttons on AI responses — thumbs up/down (feeds existing prompt evolution system)                            | `src/connectors/webchat/ui/app.js`            |
| 15   | Tests: history loading, file upload, voice recording, autocomplete, feedback                                          | `tests/connectors/webchat/`                   |

#### Phase 92 — Settings Panel + Deep Mode UI (~10–12 tasks)

In-app settings and Deep Mode phase navigation for non-developer users.

| Task | What                                                                                                | Key File                                      |
| ---- | --------------------------------------------------------------------------------------------------- | --------------------------------------------- |
| 1    | Add settings panel (gear icon in header → slide-out panel)                                          | `src/connectors/webchat/ui/settings.js`       |
| 2    | Settings: toggle between AI tools (Claude vs Codex — read from discovery results)                   | `src/connectors/webchat/ui/settings.js`       |
| 3    | Settings: execution profile selector (fast / thorough / manual)                                     | `src/connectors/webchat/ui/settings.js`       |
| 4    | Settings: notification preferences (sound on/off, browser notifications on/off)                     | `src/connectors/webchat/ui/settings.js`       |
| 5    | Settings: dark/light theme toggle                                                                   | `src/connectors/webchat/ui/settings.js`       |
| 6    | Settings REST API: GET/PUT `/api/webchat/settings` (persist in localStorage + optional server-side) | `src/connectors/webchat/webchat-connector.ts` |
| 7    | Deep Mode phase stepper UI (progress bar: Investigate → Report → Plan → Execute → Verify)           | `src/connectors/webchat/ui/deep-mode.js`      |
| 8    | Phase action buttons: "Proceed", "Focus on #N", "Skip #N" (replace typed commands)                  | `src/connectors/webchat/ui/deep-mode.js`      |
| 9    | Render Deep Mode phase transitions as special message cards (not plain text)                        | `src/connectors/webchat/ui/deep-mode.js`      |
| 10   | Wire phase events from WebSocket `progress` messages (extends existing progress system)             | `src/connectors/webchat/ui/deep-mode.js`      |
| 11   | Restore MCP management UI (re-implement REST routes removed earlier, or restore from git)           | `src/connectors/webchat/webchat-connector.ts` |
| 12   | Tests: settings persistence, Deep Mode stepper, MCP panel                                           | `tests/connectors/webchat/`                   |

---

### Docker Sandbox (OB-193) — ~15–20 tasks

**Why needed now:** Completes the security boundary alongside env var protection (Sprint 2) and document visibility (above). Run workers in containers for untrusted or shared workspaces.

| Task | What                                                                          | Key File                            |
| ---- | ----------------------------------------------------------------------------- | ----------------------------------- |
| 1    | Create `DockerSandbox` class — container lifecycle management                 | `src/core/docker-sandbox.ts` (new)  |
| 2    | Auto-detect Docker availability on startup                                    | `src/discovery/tool-scanner.ts`     |
| 3    | Build lightweight worker container image (Node.js + AI CLI tools)             | `docker/Dockerfile.worker` (new)    |
| 4    | Volume mount workspace as read-only by default                                | `src/core/docker-sandbox.ts`        |
| 5    | Volume mount `.openbridge/` as read-write for worker outputs                  | `src/core/docker-sandbox.ts`        |
| 6    | Network isolation: workers can't access host network by default               | `src/core/docker-sandbox.ts`        |
| 7    | Resource limits: CPU, memory, disk, timeout per container                     | `src/core/docker-sandbox.ts`        |
| 8    | Config option: `security.sandbox` — `none` (default), `docker`, `bubblewrap`  | `src/types/config.ts`               |
| 9    | Wire sandbox into `AgentRunner.spawn()` — spawn inside container when enabled | `src/core/agent-runner.ts`          |
| 10   | Container cleanup on worker completion or timeout                             | `src/core/docker-sandbox.ts`        |
| 11   | Pass env vars through sandbox (respects deny-list from Sprint 2)              | `src/core/docker-sandbox.ts`        |
| 12   | Forward MCP config into container (per-worker isolation maintained)           | `src/core/docker-sandbox.ts`        |
| 13   | Startup health check: verify Docker daemon is running                         | `src/core/docker-sandbox.ts`        |
| 14   | Fallback: if Docker unavailable, log warning and run without sandbox          | `src/core/agent-runner.ts`          |
| 15   | Tests for container lifecycle, resource limits, network isolation             | `tests/core/docker-sandbox.test.ts` |

---

### Security Boundary Summary (Current vs Target)

| Boundary             | Current                   | After Sprints 1–3                                | After Sprint 4                               |
| -------------------- | ------------------------- | ------------------------------------------------ | -------------------------------------------- |
| Workspace boundary   | `cwd` in spawn            | Same (sufficient for Marketplace)                | Same                                         |
| Tool restriction     | `--allowedTools`          | + `code-audit` profile for test runners          | Same                                         |
| Phone whitelist      | Exact match               | Same                                             | Same                                         |
| Daily budget         | Checked at message start  | + per-worker cost estimation (Sprint 3)          | Same                                         |
| Env var sanitization | Strips CLAUDECODE only    | Default deny-list (AWS/GH/TOKEN/SECRET/DB/...)   | + sandbox isolation                          |
| File visibility      | None — AI sees everything | Same                                             | Include/exclude rules + auto-detect secrets  |
| Content redaction    | None                      | Same                                             | Optional pattern-based redaction             |
| User consent         | None — auto-proceed       | Risk classification + confirmation for high-risk | Same                                         |
| Audit visibility     | Internal Pino logs only   | `/audit` command + `.openbridge/audit/` files    | Same                                         |
| OS-level sandbox     | None                      | Same                                             | Docker containers for workers                |
| WebChat auth         | None                      | Same                                             | Token + password auth, rate limiting         |
| Deep analysis        | Single-pass only          | Same                                             | Multi-phase Deep Mode (investigate → verify) |

---

## Deferred — Post v0.0.12

These features are preserved for future development.

### Finalization Required (Phases 72–73 + MCP UI)

These features were scaffolded/built but have bugs and build issues. Not needed for the current development track (Console/WhatsApp/Telegram/WebChat channels work fine).

#### Standalone Binary Packaging (Phase 72) — Needs Testing & CI Fix

**Current state:** Scripts and config fully scaffolded. Never actually built or tested.

**What exists:**

- `@yao-pkg/pkg` in devDependencies
- `pkg` config block in `package.json` (targets: node22-macos-arm64/x64, win-x64, linux-x64)
- `scripts/package.sh` (184 lines) — cross-platform build script
- `scripts/create-dmg.sh` (316 lines) — macOS DMG creator with icon generation
- `scripts/macos-app-template/` — .app bundle template (placeholder icons/binaries)
- `.github/workflows/release-binaries.yml` — 3-OS CI workflow for binary builds

**Known issues:**

1. `release/` directory is empty — no binaries have ever been built
2. `.nvmrc` file missing — all CI workflows reference it and will fail
3. `better-sqlite3` native addon bundling untested — may need prebuilt binaries per platform
4. DMG script assumes `create-dmg` or `hdiutil` — needs testing on clean macOS
5. Windows NSIS installer not implemented (just raw `.exe`)

**Finalization tasks (~8–12 tasks):**

- Add `.nvmrc` with `22`
- Run `npm run package` locally and fix any pkg errors
- Test binary startup on macOS (does it find `better-sqlite3`? does `whatsapp-web.js` work?)
- Test DMG creation flow
- Fix CI workflow issues
- Add Windows installer (NSIS or Inno Setup) if needed
- Smoke test on each platform

---

#### Electron Desktop App (Phase 73) — Build Broken, Wiring Gaps

**Current state:** Substantially built (main process, preload, React UI, settings, dashboard). Cannot run due to build configuration issues.

**What exists:**

- `desktop/electron/main.ts` (518 lines) — full Electron main process with IPC handlers
- `desktop/electron/preload.ts` — contextBridge with all IPC methods
- `desktop/electron/bridge-process.ts` — bridge lifecycle manager (fork/stop)
- `desktop/electron/tray.ts` — system tray with programmatic icons
- `desktop/ui/App.tsx` — React router with pages
- `desktop/ui/pages/Dashboard.tsx` — full live dashboard
- `desktop/ui/pages/Settings.tsx` — 6-tab settings panel
- `desktop/ui/pages/Setup.tsx` + `pages/setup/*.tsx` — 7-step setup wizard (complete)
- `desktop/ui/pages/settings/McpSettings.tsx` (827 lines) — full MCP management UI
- `desktop/ui/pages/settings/AccessSettings.tsx` — access control UI
- `electron-builder.yml` — build config for native installers
- `.github/workflows/release-desktop.yml` — 3-OS CI workflow

**Known issues (build-breaking):**

1. **No Electron TS compile step** — `dev` and `build` scripts don't run `tsc` on `electron/*.ts`. The entry point `electron/main.js` will not exist. The app cannot start.
2. **Setup wizard not wired** — `App.tsx` has a stub `<div>Setup Wizard</div>` on `/setup` instead of importing the real `Setup.tsx` component
3. **Vite output path mismatch** — `vite.config.ts` outputs to `dist/ui/` but `electron-builder.yml` expects `ui/dist/`
4. `.nvmrc` missing (same as binary packaging CI issue)

**Finalization tasks (~10–15 tasks):**

- Add `tsc -p tsconfig.electron.json` step to compile `electron/*.ts` → `electron/*.js`
- Fix `dev` script: compile Electron TS, then run concurrently
- Fix `build` script: compile Electron TS before `electron-builder`
- Wire `Setup.tsx` import in `App.tsx` (replace stub)
- Fix Vite output path to match `electron-builder.yml` expectation
- Add `.nvmrc`
- Test `npm run dev` — does the window open? Does the setup wizard work?
- Test bridge start/stop from dashboard
- Test `electron-builder` — does it produce a working `.dmg`/`.exe`?
- Fix any runtime errors in IPC handlers
- Test auto-updater flow

---

#### MCP Management UI — Removed from WebChat, Electron Layer Blocked

**Current state:** WebChat MCP UI has been **removed** to avoid confusing users with non-functional features. Backend is intact. Electron UI is coded but blocked by Electron build issues above.

**What's preserved (backend — still functional):**

- `src/core/mcp-registry.ts` — backend MCP server registry (add/remove/toggle/health/persist)
- `src/core/mcp-catalog.ts` — catalog of 12 known MCP servers with docs + env vars
- Master AI MCP-aware worker spawning (per-worker `--mcp-config` isolation)

**What was removed (WebChat UI):**

- WebChat REST API routes at `/api/mcp/*` (6 endpoints)
- WebChat browser dashboard panel (server cards, catalog modal, search, env var forms)
- WebSocket `mcp-status` broadcast + polling
- `setMcpRegistry()` connector wiring in `bridge.ts`
- Test files: `webchat-mcp-api.test.ts`, `webchat-mcp-websocket.test.ts`

**What's blocked (Electron):**

- `desktop/ui/pages/settings/McpSettings.tsx` (827 lines) — complete React component but cannot run until Electron build issues are fixed
- `desktop/electron/main.ts` IPC handlers for `mcp:*` — proxy to bridge REST API, functional code but untested

**Finalization tasks (~8–12 tasks, after Electron is fixed):**

- Re-implement WebChat MCP REST API routes (or restore from git history)
- Re-implement WebChat MCP browser dashboard
- Verify MCP settings tab renders correctly in Electron
- Test add/remove/toggle server flow end-to-end
- Test catalog browse + connect flow
- Verify WebSocket status updates propagate to Electron UI

---

## Planned Features (Unscoped)

### Access Control Dashboard

**What:** Web-based UI for managing per-user access control — roles, scopes, action permissions, daily cost budgets.

**Context:** Access control infrastructure already exists (`src/memory/access-store.ts`, `src/cli/access.ts`). This adds the visual layer.

**Estimated effort:** ~10–15 tasks.

---

## Backlog (Unscoped Ideas)

These are captured for future consideration. Not yet designed or estimated.

| Feature                  | ID         | Description                                                        | Notes                                            |
| ------------------------ | ---------- | ------------------------------------------------------------------ | ------------------------------------------------ |
| ~~Docker sandbox~~       | ~~OB-193~~ | ~~Run workers in containers for untrusted workspaces~~             | **Moved to Sprint 4 (v0.0.12)**                  |
| ~~Interactive AI views~~ | ~~OB-124~~ | ~~AI generates live reports/dashboards on local HTTP~~             | **Superseded by OB-F69 Phases 82–84 (Sprint 4)** |
| E2E test: business files | OB-306     | CSV workspace E2E test                                             | Testing gap                                      |
| Scheduled tasks          | —          | Cron-like task scheduling ("run tests every morning at 9am")       | New capability                                   |
| AI tool marketplace      | —          | Browse and install community-built connectors and providers        | Plugin ecosystem                                 |
| Webhook connector        | —          | HTTP webhook endpoint for CI/CD integration (GitHub Actions, etc.) | New connector type                               |
| PDF generation           | —          | Built-in HTML-to-PDF conversion for generated reports              | Uses Puppeteer                                   |
| Secrets management       | —          | Encrypted storage for Discord/Telegram tokens                      | Complements OB-F70 + OB-F72                      |
| WhatsApp session persist | —          | Avoid re-scan when session expires                                 | UX improvement                                   |
| Skill creator            | OB-192     | Master creates reusable skill templates from successful patterns   | Self-improvement                                 |
| Context compaction       | OB-190     | Progressive summarization when context grows large                 | Memory optimization                              |

---

## Legacy Roadmap Phases (Superseded)

The original ROADMAP.md contained planned Phases 31–39 with detailed designs. Most of these features were **already shipped** under different phase numbers during actual development. The remaining unshipped portions are captured above.

| Original Phase | Feature                                 | Status                                                             |
| -------------- | --------------------------------------- | ------------------------------------------------------------------ |
| 31             | Memory Foundation (SQLite)              | Shipped (Phases 31–44 actual)                                      |
| 32             | Intelligent Retrieval + Worker Briefing | Partially shipped; RAG portion deferred (OB-F48)                   |
| 33             | Media & Proactive Messaging             | Shipped (Phases 67–69 actual)                                      |
| 34             | Content Publishing & Sharing            | Shipped (email, file server, GitHub Pages)                         |
| 35             | Conversation Memory + Prompt Evolution  | Shipped (Phases 51–55 actual)                                      |
| 36             | Agent Dashboard + Exploration Progress  | Partially shipped (status commands, WebChat dashboard in Electron) |
| 37             | Access Control + Hierarchical Masters   | Access control shipped; hierarchical masters deferred              |
| 38             | Server Deployment Mode                  | Not started                                                        |
| 39             | Agent Orchestration                     | Not started                                                        |

---

## How to Start a Future Feature

1. Create a new finding in [FINDINGS.md](FINDINGS.md) if the feature addresses a gap
2. Design the implementation and estimate tasks
3. Add a new phase section to [TASKS.md](TASKS.md) with task IDs
4. Update [ROADMAP.md](../ROADMAP.md) to reflect the new phase
5. Implement, test, and mark tasks as Done
6. Archive completed tasks when the phase ships
