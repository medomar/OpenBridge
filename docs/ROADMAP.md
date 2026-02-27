# OpenBridge — Roadmap

> **Last Updated:** 2026-02-27 | **Current Version:** v0.0.4

This document outlines the vision and planned features for OpenBridge. Features move from **Backlog** to **Planned** to **In Progress** to **Released** as they mature.

Two parallel development tracks exist: **Track A (Memory & Intelligence)** builds the core infrastructure that makes everything smarter. **Track B (Features)** adds user-facing capabilities. Track A is prioritized because it improves every other feature.

---

## Released (v0.0.1 — v0.0.2)

Everything that shipped — 392 tasks across 53 phases.

| Feature                                                                                                                         | Phase | Version     | Status  |
| ------------------------------------------------------------------------------------------------------------------------------- | ----- | ----------- | ------- |
| Bridge Core (router, auth, queue, config)                                                                                       | 1–5   | v0.0.1      | Shipped |
| WhatsApp + Console connectors                                                                                                   | 1–5   | v0.0.1      | Shipped |
| Claude Code provider                                                                                                            | 1–5   | v0.0.1      | Shipped |
| AI tool auto-discovery                                                                                                          | 6–10  | v0.0.1      | Shipped |
| Incremental workspace exploration (5-pass)                                                                                      | 11–14 | v0.0.1      | Shipped |
| MVP release                                                                                                                     | 15    | v0.0.1      | Shipped |
| Agent Runner (--allowedTools, --max-turns, --model, retries)                                                                    | 16–18 | v0.0.1      | Shipped |
| Self-governing Master AI                                                                                                        | 18–21 | v0.0.1      | Shipped |
| Tool profiles (read-only, code-edit, full-access, master)                                                                       | 16–17 | v0.0.1      | Shipped |
| Worker orchestration + SPAWN markers                                                                                            | 19–21 | v0.0.1      | Shipped |
| Self-improvement (prompt tracking, model selection learning)                                                                    | 20–21 | v0.0.1      | Shipped |
| WebChat, Telegram, Discord connectors                                                                                           | 22–24 | v0.0.1      | Shipped |
| AI-powered intent classification                                                                                                | 29    | v0.0.1      | Shipped |
| Live progress events across all connectors                                                                                      | 29    | v0.0.1      | Shipped |
| Production hardening + v0.0.1 tag                                                                                               | 30    | v0.0.1      | Shipped |
| Memory wiring (MemoryManager integration across all modules)                                                                    | 40    | v0.0.1      | Shipped |
| Memory & startup fixes (race condition, prompt guards)                                                                          | 41    | v0.0.1      | Shipped |
| Exploration pipeline fixes (JSON fallbacks, chunk dedup)                                                                        | 42    | v0.0.1      | Shipped |
| Exploration reliability & change detection (throttling, markers)                                                                | 43    | v0.0.1      | Shipped |
| Schema cleanup & integration tests (WAL checkpoint, legacy cleanup)                                                             | 44    | v0.0.1      | Shipped |
| Exploration progress tracking fix (explorationId wired, all 5 phases tracked)                                                   | 47    | v0.0.2      | Shipped |
| Worker resilience: max-turns detection, adaptive budgets, failure recovery                                                      | 48    | v0.0.2      | Shipped |
| Worker control: stop/stop-all commands, PID capture, WebChat buttons                                                            | 46    | v0.1.1      | Shipped |
| Responsive Master: priority queue, fast-path responder, queue depth visibility                                                  | 49    | v0.2.0      | Shipped |
| Prompt library (7 methods on DotFolderManager) + audit logger JSONL output                                                      | 51    | post-v0.0.2 | Shipped |
| Conversation continuity — memory.md cross-session pattern (read/write/inject)                                                   | 52    | post-v0.0.2 | Shipped |
| Conversation history — /history command, listSessions, searchSessions, REST                                                     | 53    | post-v0.0.2 | Shipped |
| Schema versioning — schema_versions table + transactional migrations                                                            | 54    | post-v0.0.2 | Shipped |
| Worker streaming progress + session checkpointing/resume + priority queue                                                       | 55    | post-v0.0.2 | Shipped |
| Codex adapter fixes: --skip-git-repo-check, sandbox, OPENAI_API_KEY, --json, -o                                                 | 57    | v0.0.4      | Shipped |
| Codex provider: CodexProvider, CodexConfig, session manager, provider registry                                                  | 58    | v0.0.4      | Shipped |
| Codex documentation: ARCHITECTURE, API_REFERENCE, CONFIGURATION, TROUBLESHOOTING, WRITING_A_PROVIDER                            | 59    | v0.0.4      | Shipped |
| MCP core pipeline: MCPServerSchema, SpawnOptions, TaskManifest, per-worker isolation, ClaudeAdapter flags, global config writer | 60    | v0.0.4      | Shipped |
| MCP UX polish: health checks, config.example.json, CLI init MCP step                                                            | 61    | v0.0.4      | Shipped |
| MCP documentation: ARCHITECTURE, CONFIGURATION, API_REFERENCE, CLAUDE.md, CHANGELOG, ROADMAP                                    | 62    | v0.0.4      | Shipped |

---

## Track A: Memory & Intelligence

### Phase 31: Memory Foundation

> **Goal:** Replace all `.openbridge/` flat JSON files with a single SQLite database. This is the foundation — every future feature depends on it.
>
> **Milestone:** [v0.1.0](docs/audit/milestones/v0.1.0-memory-system.md)

**Why first:** Workers currently run blind (no project context). Learnings are written but never read. Classification cache is unbounded. All of these problems trace back to the storage layer. Fix the foundation, everything above it improves.

| Task                                                                | ID     | Priority | Complexity |
| ------------------------------------------------------------------- | ------ | :------: | :--------: |
| Add `better-sqlite3` dependency + TypeScript types                  | OB-700 | 🔴 High  |    Low     |
| Create `src/memory/database.ts` — DB init, WAL mode, PRAGMA         | OB-701 | 🔴 High  |   Medium   |
| Create full schema (9 tables + 2 FTS virtual tables + indexes)      | OB-702 | 🔴 High  |   Medium   |
| Create `src/memory/index.ts` — MemoryManager public API             | OB-703 | 🔴 High  |   Medium   |
| Create `src/memory/chunk-store.ts` — context chunks CRUD            | OB-704 | 🔴 High  |   Medium   |
| Create `src/memory/task-store.ts` — tasks + learnings CRUD          | OB-705 | 🔴 High  |   Medium   |
| Create `src/memory/conversation-store.ts` — message CRUD            | OB-706 | 🔴 High  |   Medium   |
| Create `src/memory/prompt-store.ts` — versioned prompts             | OB-707 | 🔴 High  |   Medium   |
| Create `src/memory/migration.ts` — JSON → SQLite one-time migration | OB-708 | 🔴 High  |    High    |
| Create `src/memory/eviction.ts` — data lifecycle + cleanup          | OB-709 |  🟡 Med  |   Medium   |
| Integrate MemoryManager into Bridge startup                         | OB-710 | 🔴 High  |   Medium   |
| Replace DotFolderManager reads/writes with MemoryManager            | OB-711 | 🔴 High  |    High    |
| Remove `.openbridge/.git` — DB transactions replace git safety      | OB-712 |  🟡 Med  |    Low     |
| Tests for all memory modules                                        | OB-713 | 🔴 High  |   Medium   |

#### Design Notes — Database Schema

Single file: `.openbridge/openbridge.db` (SQLite, WAL mode)

```sql
-- 9 tables replace all JSON files:
context_chunks          -- Workspace knowledge (chunked, ~500 tokens each)
context_chunks_fts      -- FTS5 virtual table for full-text search
conversations           -- Every user↔Master message exchange
conversations_fts       -- FTS5 virtual table for conversation search
tasks                   -- Execution records (replaces tasks/*.json)
learnings               -- Aggregated model/task-type performance stats
prompts                 -- Versioned prompts with effectiveness tracking
sessions                -- Master session state (replaces master-session.json)
workspace_state         -- Git change detection (replaces analysis-marker.json)
exploration_state       -- Exploration resumability (replaces exploration-state.json)
system_config           -- Key-value store (replaces agents.json, profiles.json)
```

**What dies (replaced by DB):**

```
❌ workspace-map.json      → context_chunks table
❌ agents.json              → system_config table
❌ exploration.log          → tasks table (type='exploration')
❌ master-session.json      → sessions table
❌ exploration-state.json   → exploration_state table
❌ analysis-marker.json     → workspace_state table
❌ classifications.json     → learnings table
❌ learnings.json           → learnings table
❌ profiles.json            → system_config table
❌ workers.json             → tasks table (type='worker', status='running')
❌ prompts/manifest.json    → prompts table
❌ tasks/*.json             → tasks table
❌ .openbridge/.git/        → SQLite WAL + transactions
```

**Eviction policy (configurable):**

```
memory:
  retentionDays: 30        # Full conversation history
  summaryDays: 90          # Summaries only
  archiveDays: 365         # Delete after this
  maxDbSizeMb: 500         # Hard cap, triggers aggressive eviction
```

#### Design Notes — Module Structure

```
src/memory/
├── index.ts               ← MemoryManager (public API)
├── database.ts            ← SQLite init, migrations, WAL mode, PRAGMA
├── chunk-store.ts         ← context_chunks CRUD + chunking logic
├── conversation-store.ts  ← conversations CRUD + eviction policy
├── task-store.ts          ← tasks + learnings CRUD + analytics
├── prompt-store.ts        ← prompts versioning + effectiveness
├── retrieval.ts           ← Hybrid search (FTS5 + AI rerank)
├── worker-briefing.ts     ← Build context packages for workers
├── migration.ts           ← One-time JSON → SQLite migration
└── eviction.ts            ← Cleanup old data (30/90 day policy)
```

---

### Phase 32: Intelligent Retrieval + Worker Briefing

> **Goal:** Make workers smart. Use FTS5 search + AI reranking to give every worker relevant project context, past task history, and learned patterns before it starts.
>
> **Milestone:** [v0.1.0](docs/audit/milestones/v0.1.0-memory-system.md)

**Why second:** This is the single biggest quality improvement. Workers currently waste 5-10 turns re-discovering project structure. With briefings, they start with full context.

| Task                                                               | ID     | Priority | Complexity |
| ------------------------------------------------------------------ | ------ | :------: | :--------: |
| Create `src/memory/retrieval.ts` — hybrid FTS5 search engine       | OB-720 | 🔴 High  |    High    |
| AI-powered reranking — use device AI for semantic result reranking | OB-721 | 🔴 High  |   Medium   |
| Create `src/memory/worker-briefing.ts` — context package builder   | OB-722 | 🔴 High  |   Medium   |
| Integrate briefing into MasterManager.spawnWorker() flow           | OB-723 | 🔴 High  |   Medium   |
| Adaptive model selection — query learnings for best model per task | OB-724 | 🔴 High  |   Medium   |
| Exploration chunking — store results as granular ~500-token chunks | OB-725 | 🔴 High  |    High    |
| Incremental chunk refresh — only re-explore stale scopes           | OB-726 |  🟡 Med  |   Medium   |
| Tests for retrieval and briefing                                   | OB-727 | 🔴 High  |   Medium   |

#### Design Notes — Hybrid Search (No Embeddings)

```
Search Strategy (zero new dependencies):

Layer 1: FTS5 (Full-Text Search)
  → Built into SQLite, sub-millisecond
  → Handles "auth bug" → finds auth-related chunks

Layer 2: AI-Powered Semantic Reranking (optional)
  → Take top 20 FTS5 results
  → 1 quick haiku call: "Rank these by relevance to: '{query}'"
  → Returns top 5 most relevant
  → Only triggers for ambiguous queries (>10 results)

Layer 3: Metadata Filtering
  → Filter by scope (file path), category, recency, success rate
  → Pure SQL, instant
```

This approach uses the AI tools already on the machine — no embedding models, no new dependencies, stays true to the project philosophy.

#### Design Notes — Worker Briefing

```
Before (current):                     After (with briefing):
Worker gets:                          Worker gets:
  "Fix the auth bug"                    TASK: Fix the auth bug
  (knows NOTHING about project)
                                        ## Project Context
                                        [3 relevant chunks from DB]

                                        ## What Worked Before
                                        [2 similar past tasks + outcomes]

                                        ## Guidelines
                                        - This project uses Vitest, not Jest
                                        - Zod schemas need .passthrough()
                                        - Always run typecheck after changes
```

---

### Phase 35: Conversation Memory + Prompt Evolution

> **Goal:** Give the Master long-term conversation memory and self-improving prompts. Users can reference past conversations. Prompts automatically improve based on measured effectiveness.
>
> **Milestone:** [v0.2.0](docs/audit/milestones/v0.2.0-smart-system.md)

| Task                                                                         | ID     | Priority | Complexity |
| ---------------------------------------------------------------------------- | ------ | :------: | :--------: |
| Record all user↔Master messages to conversations table                       | OB-730 | 🔴 High  |   Medium   |
| Context retrieval — inject relevant past conversations into Master prompt    | OB-731 | 🔴 High  |   Medium   |
| Classification learning loop — feedback improves future classification       | OB-732 |  🟡 Med  |   Medium   |
| Prompt effectiveness tracking — measure success rate per prompt version      | OB-733 |  🟡 Med  |    Low     |
| Prompt evolution — auto-generate improved prompt variations                  | OB-734 |  🟡 Med  |    High    |
| System prompt enrichment — inject learned patterns into Master system prompt | OB-735 | 🔴 High  |   Medium   |
| Conversation eviction — 30/90 day policy with auto-summarization             | OB-736 |  🟡 Med  |   Medium   |
| Tests for conversation memory and prompt evolution                           | OB-737 | 🔴 High  |   Medium   |

#### Design Notes — Conversation Flow

```
User sends: "do the same thing for payments"
    ↓
[Store message] → INSERT INTO conversations
    ↓
[FTS5 search history] → find related past conversations
    ↓
[Inject context]
    "Previous relevant context:
     [Feb 20] You asked to fix auth validation.
     I modified src/core/auth.ts and added Zod schema...

     Current message: do the same thing for payments"
    ↓
[Master responds with full context]
```

#### Design Notes — Prompt Evolution

```
Every task completion:
  → Update prompt usage_count + success_count
  → Track effectiveness = success_rate weighted by avg_turns

Every 50 tasks:
  → Query underperforming prompts (effectiveness < 0.7)
  → Master proposes improved variation
  → New version starts at 0.5 (neutral), earns its way up
  → After 20 uses: keep if better, rollback if worse
```

---

### Phase 36: Agent Dashboard + Exploration Progress

> **Goal:** Give users real-time visibility into every agent, worker, and exploration phase — including which model is running, what it's doing, and how far along it is.
>
> **Milestone:** [v0.3.0](docs/audit/milestones/v0.3.0-visibility.md)

| Task                                                                         | ID     | Priority | Complexity |
| ---------------------------------------------------------------------------- | ------ | :------: | :--------: |
| `agent_activity` table — real-time agent/worker status tracking              | OB-740 | 🔴 High  |   Medium   |
| `exploration_progress` table — per-phase, per-directory progress             | OB-741 | 🔴 High  |   Medium   |
| Wire agent lifecycle events — INSERT on spawn, UPDATE on progress/completion | OB-742 | 🔴 High  |   Medium   |
| "status" command — user queries active agents via any channel                | OB-743 | 🔴 High  |    Low     |
| WebChat dashboard — live agent activity view with progress bars              | OB-744 |  🟡 Med  |    High    |
| Exploration progress tracking — parallel directory dives with percentages    | OB-745 | 🔴 High  |   Medium   |
| Cost tracking — per-agent and per-day cost accumulation                      | OB-746 |  🟡 Med  |   Medium   |
| Tests for dashboard and exploration progress                                 | OB-747 | 🔴 High  |   Medium   |

#### Design Notes — Agent Activity Monitor

```
User (WhatsApp): "status"
    ↓
Master AI: ACTIVE (claude, opus)
├── Session: abc-123 | Uptime: 2h 14m
├── Messages processed: 47
└── Current: Processing user request

Active Workers:
┌────────┬────────┬──────────┬────────────┬────────┬───────┐
│ ID     │ Model  │ Profile  │ Task       │ Status │ Time  │
├────────┼────────┼──────────┼────────────┼────────┼───────┤
│ w-001  │ sonnet │ code-edit│ Fix auth   │ ██░░░  │ 45s   │
│ w-002  │ haiku  │ read-only│ Scan tests │ ████░  │ 30s   │
│ w-003  │ opus   │ full     │ Write API  │ █░░░░  │ 5s    │
└────────┴────────┴──────────┴────────────┴────────┴───────┘

Exploration: Phase 3/5 — Directory Dives
┌──────────────────────────────────────────┐
│ Overall: [████████████░░░░░░░░] 60%      │
│ src/core:       [████████████████] DONE  │
│ src/master:     [████████████████] DONE  │
│ src/connectors: [████████░░░░░░░░] 40%  │
│ tests/:         [░░░░░░░░░░░░░░░░] WAIT │
└──────────────────────────────────────────┘

Cost: $0.42 today | 12 workers spawned | 3 retries
```

---

## Track B: User-Facing Features

### Phase 33: Media & Proactive Messaging

> **Goal:** Extend OpenBridge from text-only to media-capable, and enable the AI to send messages proactively (not just reply).
>
> **Milestone:** [v0.2.0](docs/audit/milestones/v0.2.0-smart-system.md)
>
> **Note:** This track is independent from Track A. Can be developed in parallel after Phase 31.

| Task                                                 | ID     | Priority | Complexity |
| ---------------------------------------------------- | ------ | :------: | :--------: |
| Extend OutboundMessage with media/attachment support | OB-600 | 🔴 High  |   Medium   |
| WhatsApp: send to specific number                    | OB-601 | 🔴 High  |    Low     |
| WhatsApp: send file/document attachments             | OB-602 | 🔴 High  |   Medium   |
| WhatsApp: receive and transcribe voice messages      | OB-605 |  🟡 Med  |    High    |
| WhatsApp: send voice replies (TTS)                   | OB-606 |  🟢 Low  |    High    |
| WebChat: file download support                       | OB-607 |  🟡 Med  |    Low     |

#### Design Notes — Media Architecture

```
OutboundMessage (extended)
{
  target: string;
  recipient: string;
  content: string;                     // text content (always present)
  media?: {                            // NEW — optional attachment
    type: "document" | "image" | "audio" | "video";
    data: Buffer;
    mimeType: string;
    filename?: string;
  };
  replyTo?: string;
  metadata?: Record<string, unknown>;
}
```

#### Design Notes — Proactive Messaging

The Master AI will be able to send messages to specific numbers using a new marker format:

```
[SEND:whatsapp]+1234567890|Your report is ready.[/SEND]
```

Only whitelisted numbers can be contacted. The router will parse SEND markers and route them to the appropriate connector.

---

### Phase 34: Content Publishing & Sharing

> **Goal:** When the AI generates content (HTML, PDF, reports), give it ways to share that content with users — locally, via messaging, or on the web.
>
> **Milestone:** [v0.2.0](docs/audit/milestones/v0.2.0-smart-system.md)
>
> **Depends on:** Phase 33 (media support needed for file attachments)

| Task                                                          | ID     | Priority | Complexity |
| ------------------------------------------------------------- | ------ | :------: | :--------: |
| Local file server — serve generated content via HTTP          | OB-610 | 🔴 High  |    Low     |
| Share via WhatsApp — send generated files as attachments      | OB-611 | 🔴 High  |   Medium   |
| Share via email — SMTP integration for sending files          | OB-612 |  🟡 Med  |   Medium   |
| GitHub Pages publish — push HTML to gh-pages branch           | OB-613 |  🟡 Med  |   Medium   |
| Shareable link generation — unique URLs for generated content | OB-614 |  🟡 Med  |    High    |

#### Design Notes — Content Pipeline

```
User: "Generate an investor report for our project"
  ↓
Master AI → Worker (code-edit profile)
  ↓ generates report.html
Worker saves to: .openbridge/generated/report-2026-02-25.html
  ↓
Master detects generated file → asks user how to share:
  ↓
Options:
  1. Local: http://localhost:3000/shared/report-2026-02-25.html
  2. WhatsApp: send as document to requesting user
  3. Email: send to configured address
  4. GitHub Pages: https://username.github.io/project/reports/report.html
```

| Approach                | Pros                           | Cons                 | Requires          |
| ----------------------- | ------------------------------ | -------------------- | ----------------- |
| Local HTTP (`/shared/`) | Instant, zero config           | LAN only             | Nothing extra     |
| GitHub Pages            | Free, permanent, custom domain | ~1min deploy, public | Git push access   |
| Ngrok/Cloudflare Tunnel | Internet-accessible, instant   | Temporary URLs       | External CLI tool |
| Cloud storage (S3, R2)  | Permanent, fast, CDN           | Requires API keys    | Cloud account     |

**Recommended first implementation:** Local HTTP + WhatsApp file send (zero external deps).

---

## Scale & Team

### Phase 37: Access Control + Hierarchical Masters

> **Goal:** Role-based access control per user per channel, and automatic sub-master creation for large workspaces with multiple sub-projects.
>
> **Milestone:** [v0.4.0](docs/audit/milestones/v0.4.0-scale.md)
>
> **Depends on:** Phase 31 (needs DB tables), Phase 36 (needs dashboard to monitor sub-masters)

| Task                                                                             | ID     | Priority | Complexity |
| -------------------------------------------------------------------------------- | ------ | :------: | :--------: |
| Access control DB table + role definitions (owner/admin/developer/viewer/custom) | OB-750 | 🔴 High  |   Medium   |
| Access control enforcement in auth layer — scopes, actions, daily budget         | OB-751 | 🔴 High  |   Medium   |
| Access control CLI — `npx openbridge access add +1234567890 --role developer`    | OB-752 |  🟡 Med  |   Medium   |
| Sub-master detection — auto-detect large sub-projects by size/complexity         | OB-753 | 🔴 High  |   Medium   |
| Sub-master lifecycle — spawn/manage independent sub-master DBs                   | OB-754 | 🔴 High  |    High    |
| Root-to-sub-master delegation — cross-cutting task routing                       | OB-755 | 🔴 High  |    High    |
| `sub_masters` registry table in root DB                                          | OB-756 | 🔴 High  |    Low     |
| Tests for access control and hierarchical masters                                | OB-757 | 🔴 High  |    High    |

#### Design Notes — Access Control

```
Per-user config:
{
  "users": [
    {
      "id": "+1234567890",
      "channel": "whatsapp",
      "role": "developer",
      "scopes": ["src/", "tests/"],
      "actions": ["read", "edit", "test"],
      "blocked_actions": ["deploy", "delete"],
      "max_cost_per_day_usd": 5
    },
    {
      "id": "+0987654321",
      "channel": "whatsapp",
      "role": "viewer",
      "scopes": ["*"],
      "actions": ["read", "status"]
    }
  ]
}

Role hierarchy:
  owner       → everything
  admin       → all tasks, config, access management
  developer   → code tasks, read config
  viewer      → read-only, status queries
  custom      → user-defined scopes + actions
```

#### Design Notes — Hierarchical Masters

```
/company-workspace/                    ← Root workspace
├── .openbridge/
│   └── openbridge.db                 ← ROOT Master DB
├── backend/                           ← Large sub-project
│   ├── .openbridge/
│   │   └── openbridge.db             ← SUB-MASTER DB (backend specialist)
│   └── src/
├── frontend/                          ← Large sub-project
│   ├── .openbridge/
│   │   └── openbridge.db             ← SUB-MASTER DB (frontend specialist)
│   └── src/
└── mobile/                            ← Smaller folder, no sub-master
    └── src/

User: "Deploy the new auth feature across backend and frontend"
  ↓
Root Master delegates to:
  → backend sub-master: "Implement auth backend logic"
  → frontend sub-master: "Add auth UI components"
  ↓
Sub-masters spawn their own workers
  ↓
Results flow up: Workers → Sub-Masters → Root Master → User
```

**Key rules:**

- Sub-master creation is automatic based on folder size/complexity
- Root Master owns all user communication
- Sub-Masters are specialists with deep domain context
- Sub-Master DBs are independent (own chunks, learnings, tasks)
- Cross-cutting tasks get coordinated by Root Master

---

### Phase 38: Server Deployment Mode

> **Goal:** Allow OpenBridge to run on a VPS or cloud server, enabling users to manage projects remotely without keeping their local machine running.
>
> **Milestone:** [v0.4.0](docs/audit/milestones/v0.4.0-scale.md)
>
> **Depends on:** Phase 37 (needs ACL for multi-user), Phase 36 (needs dashboard for headless monitoring)

| Task                                                          | ID     | Priority | Complexity |
| ------------------------------------------------------------- | ------ | :------: | :--------: |
| Headless startup mode — no QR code display dependency         | OB-760 | 🔴 High  |   Medium   |
| Remote workspace via git clone + auto-pull on changes         | OB-761 | 🔴 High  |   Medium   |
| Docker container image (Dockerfile + docker-compose)          | OB-762 | 🔴 High  |   Medium   |
| Environment-based configuration — all config via ENV vars     | OB-763 |  🟡 Med  |    Low     |
| Health check + monitoring endpoints for server operation      | OB-764 |  🟡 Med  |    Low     |
| Deployment documentation — VPS, Docker, cloud provider guides | OB-765 |  🟡 Med  |    Low     |

#### Design Notes — Deployment Modes

```
Mode 1: LOCAL (current)
  User's machine → Channels → AI tools installed locally

Mode 2: SERVER
  VPS/Cloud → Channels → AI tools installed on server
  Workspace via git clone + auto-pull

Mode 3: HYBRID
  Server runs bridge + channels
  AI tools on server, pointed at cloned repo
```

---

### Phase 39: Agent Orchestration

> **Goal:** Role-based worker types with dependency chains, synchronization, and conflict resolution. Led by co-founder.
>
> **Milestone:** [v1.0.0](docs/audit/milestones/v1.0.0-team.md)
>
> **Depends on:** Phase 31 (DB for shared state), Phase 36 (dashboard for agent visibility)

| Task                                                                    | ID     | Priority | Complexity |
| ----------------------------------------------------------------------- | ------ | :------: | :--------: |
| Role-based worker types (Architect, Coder, Tester, Reviewer)            | OB-770 | 🔴 High  |   Medium   |
| Task dependency chains — Architect → Coder → Tester → Reviewer pipeline | OB-771 | 🔴 High  |    High    |
| Worker synchronization via DB — shared state coordination               | OB-772 | 🔴 High  |   Medium   |
| Parallel worker conflict detection — same-file edit resolution          | OB-773 |  🟡 Med  |    High    |
| Worker result validation — auto-verify output (tests/typecheck)         | OB-774 |  🟡 Med  |   Medium   |

#### Design Notes — Role-Based Workers

```
Role hierarchy:
  Architect  → Design decisions, file structure planning
  Coder      → Write/edit code based on Architect's plan
  Tester     → Write and run tests for Coder's output
  Reviewer   → Code review, find bugs, validate quality

Pipeline:
  User: "Add JWT authentication"
    ↓
  Master spawns Architect: "Design the JWT auth approach"
    ↓ plan produced
  Master spawns Coder: "Implement the plan" (receives Architect output)
    ↓ code written
  Master spawns Tester: "Write tests" (receives Coder output)
    ↓ tests written + run
  Master spawns Reviewer: "Review everything" (receives all outputs)
    ↓ approval or revision requests

Sync via DB:
  All workers read agent_activity table to see what others are doing.
  Conflict detection: two workers editing the same file → queue or merge.
```

---

## Current Work

> **Status:** Phases 46–49, 51–55, 57–62 complete. v0.0.4 shipped (Codex provider + MCP integration). Next: memory system (Phase 31) and sub-master pools.

### ✅ Phase 47: Exploration Progress Tracking Fix _(v0.0.2 — complete)_

> **Goal:** Fixed the `exploration_progress` table being permanently empty. `explorationId` is now wired from `agent_activity` rows through to `ExplorationCoordinator` for all 5 phases. `/status` command now shows live exploration progress. See [OB-F23](docs/audit/FINDINGS.md).
>
> **Milestone:** v0.0.2 | 7 tasks — all shipped

| Task                                                                     | ID     | Priority | Status  |
| ------------------------------------------------------------------------ | ------ | :------: | :-----: |
| Create `agent_activity` row (type `explorer`) in `masterDrivenExplore()` | OB-890 | 🔴 High  | Shipped |
| Create `agent_activity` row in `incrementalExplore()` stale dir path     | OB-891 | 🔴 High  | Shipped |
| Verify phase rows created for all 5 exploration phases                   | OB-892 | 🔴 High  | Shipped |
| Verify directory-level progress rows created for each dive               | OB-893 | 🔴 High  | Shipped |
| Verify `/status` command shows exploration progress                      | OB-894 | 🔴 High  | Shipped |
| Integration test: exploration_progress populated after explore()         | OB-895 | 🔴 High  | Shipped |
| Regression guard in existing exploration tests                           | OB-896 |  🟡 Med  | Shipped |

---

### ✅ Phase 48: Worker Resilience — Max-Turns + Failure Recovery _(v0.0.2 — complete)_

> **Goal:** Fixed two worker failure modes: (1) workers that silently exhaust max-turns now detected, auto-retried with adaptive turn budget, and context-injected on retry. (2) Worker failures now classified (rate-limit/auth/timeout/crash/context-overflow), default retries set to 2, and Master re-delegates on persistent failure. See [OB-F24](docs/audit/FINDINGS.md) and [OB-F25](docs/audit/FINDINGS.md).
>
> **Milestone:** v0.0.2 | 12 tasks — all shipped

| Task                                                                 | ID     | Priority | Status  |
| -------------------------------------------------------------------- | ------ | :------: | :-----: |
| Detect max-turns exhaustion in worker output                         | OB-900 | 🔴 High  | Shipped |
| Add turn-budget warning to worker prompt injection                   | OB-901 | 🔴 High  | Shipped |
| Adaptive max-turns based on prompt length (capped at 50)             | OB-902 |  🟡 Med  | Shipped |
| Auto-retry on max-turns exhaustion with higher budget                | OB-903 | 🔴 High  | Shipped |
| Classify worker exit errors (rate-limit, auth, timeout, crash, etc.) | OB-904 | 🔴 High  | Shipped |
| Change default worker retries from 0 to 2                            | OB-905 | 🔴 High  | Shipped |
| Master-driven worker re-delegation on persistent failure             | OB-906 |  🟡 Med  | Shipped |
| Record worker failure patterns in learnings table                    | OB-907 |  🟡 Med  | Shipped |
| Unit tests for error classification                                  | OB-908 | 🔴 High  | Shipped |
| Unit tests for adaptive max-turns                                    | OB-909 | 🔴 High  | Shipped |
| Integration test for worker retry on failure                         | OB-910 | 🔴 High  | Shipped |
| Verify all tests pass                                                | OB-911 | 🔴 High  | Shipped |

---

### ✅ Phase 46: Worker Control Commands _(v0.1.1 — complete)_

> **Goal:** Users can now stop individual workers by ID or all workers at once from any channel. Real PIDs captured from spawned processes, abort function stored per worker, `killWorker()` / `killAllWorkers()` wired to Router stop commands, WebChat stop buttons added, cross-channel broadcast on kill, and Master AI notified to prevent re-spawning.
>
> **Milestone:** v0.1.1 | 17 tasks — all shipped

#### Phase 46a: Worker Kill Infrastructure

| Task                                                             | ID     | Priority | Status  |
| ---------------------------------------------------------------- | ------ | :------: | :-----: |
| Expose ChildProcess handle from `execOnce()` — return PID + kill | OB-871 | 🔴 High  | Shipped |
| Add `spawnWithHandle()` to AgentRunner — PID + abort function    | OB-872 | 🔴 High  | Shipped |
| Capture real PID in `MasterManager.spawnWorker()`                | OB-873 | 🔴 High  | Shipped |
| Add `killWorker()` + `killAllWorkers()` to MasterManager         | OB-874 | 🔴 High  | Shipped |
| Add PID column to `agent_activity` table                         | OB-875 |  🟡 Med  | Shipped |
| Unit tests for worker kill infrastructure                        | OB-876 | 🔴 High  | Shipped |

#### Phase 46b: Stop Command Handling

| Task                                                              | ID     | Priority | Status  |
| ----------------------------------------------------------------- | ------ | :------: | :-----: |
| Add `handleStopCommand()` to Router — stop / stop all / stop <id> | OB-877 | 🔴 High  | Shipped |
| Add access control for stop — owner/admin only                    | OB-878 | 🔴 High  | Shipped |
| Add confirmation flow for `stop all` — 30s timeout                | OB-879 |  🟡 Med  | Shipped |
| Format stop command responses                                     | OB-880 |  🟡 Med  | Shipped |
| Unit tests for stop command handling                              | OB-881 | 🔴 High  | Shipped |

#### Phase 46c: UI, Broadcast & Integration

| Task                                                  | ID     | Priority | Status  |
| ----------------------------------------------------- | ------ | :------: | :-----: |
| Add stop buttons to WebChat dashboard                 | OB-882 |  🟡 Med  | Shipped |
| Broadcast worker stop events to all channels          | OB-883 |  🟡 Med  | Shipped |
| Notify Master AI on worker kill — prevent re-spawning | OB-884 | 🔴 High  | Shipped |
| Integration test for stop command flow                | OB-885 | 🔴 High  | Shipped |
| E2E test for stop all with confirmation               | OB-886 | 🔴 High  | Shipped |
| Verify all tests pass                                 | OB-887 | 🔴 High  | Shipped |

---

### ✅ Phase 49: Responsive Master — Message Handling During Processing _(v0.2.0 — complete)_

> **Goal:** Master is no longer silent while busy. Queued messages show queue position and estimated wait time. Quick-answer messages are classified and jump ahead in queue. Fast-path responder handles simple questions immediately via a lightweight `claude --print` call without blocking the Master session. `FastPathResponder` class manages a pool of up to 2 concurrent fast-path agents.
>
> **Milestone:** v0.2.0 (partial) | 6 tasks — all shipped

| Task                                                                       | ID     | Priority | Status  |
| -------------------------------------------------------------------------- | ------ | :------: | :-----: |
| Add queue depth + estimated wait time to queued message acknowledgment     | OB-920 | 🔴 High  | Shipped |
| Implement message priority classification (quick/tool-use/complex)         | OB-921 | 🔴 High  | Shipped |
| Add fast-path responder for quick-answer messages during Master processing | OB-922 | 🔴 High  | Shipped |
| Expose processing state + queue depth in `status` command                  | OB-923 |  🟡 Med  | Shipped |
| Sub-master delegation for concurrent queries (FastPathResponder class)     | OB-924 |  🟡 Med  | Shipped |
| Tests for responsive Master (priority queue, fast-path, queue depth)       | OB-925 | 🔴 High  | Shipped |

---

### ✅ Phase 56: Documentation Update _(v0.0.2-post — complete)_

> **Goal:** Align every documentation file with the final codebase state after Phases 51–55. Covers prompt library, memory.md pattern, conversation history, schema versioning, worker streaming, and session checkpointing.
>
> **Milestone:** v0.0.2-post (housekeeping) | 10 tasks

| Task                                                             | ID      | Priority | Status  |
| ---------------------------------------------------------------- | ------- | :------: | :-----: |
| Update ARCHITECTURE.md — reflect v0.0.2 final state              | OB-1060 | 🔴 High  | Shipped |
| Update ROADMAP.md — mark Phases 51–55 shipped, update milestones | OB-1061 | 🔴 High  | Shipped |
| Update CHANGELOG.md — add all new features across Phases 51–55   | OB-1062 | 🔴 High  | Shipped |
| Update CLAUDE.md (workspace root) — new modules, LOC counts      | OB-1063 | 🔴 High  | Shipped |
| Update CLAUDE.md (OpenBridge repo) — sync key files list         | OB-1064 | 🔴 High  | Shipped |
| Update HEALTH.md — recalculate score, set open findings to 0     | OB-1065 | 🔴 High  | Shipped |
| Update README.md — add memory + history as feature highlights    | OB-1066 |  🟡 Med  | Shipped |
| Update API_REFERENCE.md — new DotFolderManager methods + REST    | OB-1067 |  🟡 Med  | Shipped |
| Update FINDINGS.md — mark all 9 findings fixed, archive          | OB-1068 |  🟡 Med  | Shipped |
| Final validation — test, typecheck, lint, format                 | OB-1069 | 🔴 High  | Shipped |

---

### ✅ Phase 57: Fix Codex Worker Failures _(v0.0.4 — complete)_

> **Goal:** Fixed all Codex adapter failures: `--skip-git-repo-check` resolves exit code 1 from non-git dirs, default sandbox set to `read-only`, `OPENAI_API_KEY` validated before spawn, `--json` and `-o` flags added for reliable output capture.
>
> **Milestone:** v0.0.4 | 8 tasks — all shipped

---

### ✅ Phase 58: Codex Provider _(v0.0.4 — complete)_

> **Goal:** OpenBridge now supports Codex-only users. `CodexProvider` implements `AIProvider`, `CodexConfig` schema added, session manager for multi-turn conversations, provider registered and wired to Master selection in `src/index.ts`.
>
> **Milestone:** v0.0.4 | 7 tasks — all shipped

---

### ✅ Phase 59: Codex Documentation + Validation _(v0.0.4 — complete)_

> **Goal:** All docs updated to reflect Codex fixes and new Codex provider. ARCHITECTURE.md, API_REFERENCE.md, CONFIGURATION.md, TROUBLESHOOTING.md, WRITING_A_PROVIDER.md updated. OB-F37 closed.
>
> **Milestone:** v0.0.4 | 6 tasks — all shipped

---

### ✅ Phase 60: MCP Core Pipeline + Master Awareness _(v0.0.4 — complete)_

> **Goal:** Full MCP integration into the core pipeline. Workers can now access external services (Gmail, Canva, Slack, etc.) via Claude's `--mcp-config`. Each worker receives only the MCP servers it needs via per-worker temp configs. Master AI knows which servers are available and autonomously assigns them via TaskManifests.
>
> **Milestone:** v0.0.4 | 9 tasks — all shipped

---

### ✅ Phase 61: MCP UX Polish _(v0.0.4 — complete)_

> **Goal:** MCP server health checks in `/health` endpoint, `config.example.json` updated with MCP section, `npx openbridge init` now guides users through MCP server setup.
>
> **Milestone:** v0.0.4 | 4 tasks — all shipped

---

### ✅ Phase 62: MCP Documentation + Validation _(v0.0.4 — complete)_

> **Goal:** All docs updated to reflect MCP integration. ARCHITECTURE.md, CONFIGURATION.md, API_REFERENCE.md, CLAUDE.md, CHANGELOG.md, ROADMAP.md, USE_CASES.md updated. OB-F36 closed.
>
> **Milestone:** v0.0.4 | 7 tasks — 5 shipped, 2 pending (OB-1089 final validation, OB-1090 USE_CASES.md)

---

## Backlog — Future Phases

These are ideas captured for future consideration. Not yet scoped or scheduled.

| Feature                  | ID     | Description                                                        | Notes                |
| ------------------------ | ------ | ------------------------------------------------------------------ | -------------------- |
| Docker sandbox           | OB-193 | Run workers in containers for untrusted workspaces                 | Security isolation   |
| Interactive AI views     | OB-124 | AI generates live reports/dashboards on local HTTP                 | Needs Phase 34 first |
| E2E test: business files | OB-306 | CSV workspace E2E test                                             | Testing gap          |
| Scheduled tasks          | —      | Cron-like task scheduling ("run tests every morning at 9am")       | New capability       |
| AI tool marketplace      | —      | Browse and install community-built connectors and providers        | Plugin ecosystem     |
| Webhook connector        | —      | HTTP webhook endpoint for CI/CD integration (GitHub Actions, etc.) | New connector type   |
| PDF generation           | —      | Built-in HTML-to-PDF conversion for generated reports              | Uses Puppeteer       |
| Secrets management       | —      | Encrypted storage for Discord/Telegram tokens                      | Security improvement |
| WhatsApp session persist | —      | Avoid re-scan when session expires                                 | UX improvement       |
| Skill creator            | OB-192 | Master creates reusable skill templates from successful patterns   | Self-improvement     |
| Context compaction       | OB-190 | Progressive summarization when context grows large                 | Memory optimization  |

---

## Dependency Graph

```
✅ Phase 47: Exploration Progress Fix (shipped v0.0.2)
    │
✅ Phase 48: Worker Resilience (shipped v0.0.2)
    │
    └──► ✅ Phase 49: Responsive Master (shipped, partial v0.2.0 feature)
              │
              ├──► ✅ Phase 51: Prompt Library + Audit Logger Fix (shipped post-v0.0.2)
              ├──► ✅ Phase 52: Conversation Continuity — memory.md (shipped post-v0.0.2)
              ├──► ✅ Phase 53: Conversation History Access (shipped post-v0.0.2)
              ├──► ✅ Phase 54: Schema Versioning (shipped post-v0.0.2)
              └──► ✅ Phase 55: Worker Streaming + Checkpointing (shipped post-v0.0.2)

✅ Phase 46: Worker Control Commands (shipped v0.1.1)

✅ Phase 56: Documentation Update (shipped — aligns docs with all shipped phases above)

✅ Phases 57–59: Codex adapter fixes + CodexProvider + Codex docs (shipped v0.0.4)
✅ Phases 60–62: MCP integration — core pipeline, UX polish, documentation (shipped v0.0.4)

Phase 31: Memory Foundation
    │
    ├──► Phase 32: Retrieval + Worker Briefing
    │        │
    │        ├──► Phase 35: Conversation Memory + Prompts
    │        │
    │        └──► Phase 36: Agent Dashboard + Exploration Progress
    │                 │
    │                 ├──► Phase 37: Access Control + Hierarchical Masters
    │                 │        │
    │                 │        └──► Phase 38: Server Deployment
    │                 │
    │                 └──► Phase 39: Agent Orchestration (co-founder)
    │
    ├──► Phase 33: Media (independent track, can start after Phase 31)
    │        │
    │        └──► Phase 34: Content Publishing
    │
    └──► Phase 49: Responsive Master (also depends on 48)
```

---

## Version Milestones

| Version    | Target | Key Features                                                                                                                                                                   | Milestone Doc                                           |
| ---------- | ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------- |
| **v0.0.1** | Done   | Foundation — 5 connectors, self-governing Master, 310 tasks                                                                                                                    | [release notes](docs/releases/release-notes-v0.0.1.md)  |
| **v0.0.2** | Done   | Bug fixes — exploration progress tracking (Phase 47) + worker resilience: max-turns detection, adaptive budgets, failure recovery (Phase 48)                                   | —                                                       |
| **v0.1.1** | Done   | Worker control — stop/stop-all commands, PID capture, WebChat stop buttons, cross-channel broadcast (Phase 46)                                                                 | —                                                       |
| **v0.0.3** | Done   | Prompt library, memory.md continuity, history access, schema versioning, worker streaming, checkpointing (Phases 51–55); docs (Phase 56)                                       | —                                                       |
| **v0.0.4** | Done   | Codex provider + adapter fixes (Phases 57–59) + MCP integration: config schema, Claude adapter flags, per-worker isolation, Master MCP awareness, health checks (Phases 60–62) | —                                                       |
| **v0.1.0** | TBD    | Memory System — SQLite DB, FTS5 search, worker briefing                                                                                                                        | [v0.1.0](docs/audit/milestones/v0.1.0-memory-system.md) |
| **v0.2.0** | TBD    | Smart System — media, publishing, conversation memory, responsive Master (Phases 33, 34, 35, 49 shipped portion)                                                               | [v0.2.0](docs/audit/milestones/v0.2.0-smart-system.md)  |
| **v0.3.0** | TBD    | Visibility — agent dashboard, exploration progress, cost tracking                                                                                                              | [v0.3.0](docs/audit/milestones/v0.3.0-visibility.md)    |
| **v0.4.0** | TBD    | Scale — access control, hierarchical masters, server deployment                                                                                                                | [v0.4.0](docs/audit/milestones/v0.4.0-scale.md)         |
| **v1.0.0** | TBD    | Team — agent orchestration, role-based workers, stable API                                                                                                                     | [v1.0.0](docs/audit/milestones/v1.0.0-team.md)          |

---

## How to Propose a Feature

1. Open an issue on [GitHub](https://github.com/medomar/OpenBridge/issues) with the `feature-request` label
2. Describe the use case, not just the solution
3. Features that align with the "zero config, zero API keys" philosophy are prioritized
4. All features must work with the existing plugin architecture (Connector + AIProvider interfaces)

---

## Principles

These guide what we build and how:

1. **Zero config** — features should work out of the box with no API keys or complex setup
2. **Your tools, your cost** — OpenBridge uses AI tools already on your machine
3. **AI does the work** — we don't hardcode business logic; we let the AI figure it out
4. **Bounded workers** — workers always have restricted permissions and finite turns
5. **Single source of truth** — `openbridge.db` stores all knowledge in one reliable place
6. **Plugin architecture** — new channels and AI tools are added via interfaces, not forks
7. **Workers are briefed** — every worker receives relevant project context, past task history, and learned patterns
8. **Memory improves with use** — learnings, prompt effectiveness, and model selection automatically improve over time
