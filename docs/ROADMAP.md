# OpenBridge — Roadmap

> **Last Updated:** 2026-03-03 | **Current Version:** v0.0.8
> **Current Focus:** Marketplace Development Track (v0.0.9–v0.0.12) + Community-Inspired Improvements (v0.0.13).
> **20 open findings** — 12 original + 10 community-inspired (from [openclaw](https://github.com/openclaw/openclaw) + [claude-mem](https://github.com/thedotmack/claude-mem) analysis) + 2 autonomy findings (OB-F93, OB-F94).

This document outlines what has shipped and the vision for future development. For detailed future feature specs, see [docs/audit/FUTURE.md](docs/audit/FUTURE.md).

---

## Released (v0.0.1 — v0.0.8)

Everything that shipped — 652 tasks across 73 phases.

| Feature                                                                                                                         | Phase | Version | Status       |
| ------------------------------------------------------------------------------------------------------------------------------- | ----- | ------- | ------------ |
| Bridge Core (router, auth, queue, config)                                                                                       | 1–5   | v0.0.1  | Shipped      |
| WhatsApp + Console connectors                                                                                                   | 1–5   | v0.0.1  | Shipped      |
| Claude Code provider                                                                                                            | 1–5   | v0.0.1  | Shipped      |
| AI tool auto-discovery                                                                                                          | 6–10  | v0.0.1  | Shipped      |
| Incremental workspace exploration (5-pass)                                                                                      | 11–14 | v0.0.1  | Shipped      |
| MVP release                                                                                                                     | 15    | v0.0.1  | Shipped      |
| Agent Runner (--allowedTools, --max-turns, --model, retries)                                                                    | 16–18 | v0.0.1  | Shipped      |
| Self-governing Master AI                                                                                                        | 18–21 | v0.0.1  | Shipped      |
| Tool profiles (read-only, code-edit, full-access, master)                                                                       | 16–17 | v0.0.1  | Shipped      |
| Worker orchestration + SPAWN markers                                                                                            | 19–21 | v0.0.1  | Shipped      |
| Self-improvement (prompt tracking, model selection learning)                                                                    | 20–21 | v0.0.1  | Shipped      |
| WebChat, Telegram, Discord connectors                                                                                           | 22–24 | v0.0.1  | Shipped      |
| AI-powered intent classification                                                                                                | 29    | v0.0.1  | Shipped      |
| Live progress events across all connectors                                                                                      | 29    | v0.0.1  | Shipped      |
| Production hardening + v0.0.1 tag                                                                                               | 30    | v0.0.1  | Shipped      |
| Memory wiring (MemoryManager integration across all modules)                                                                    | 40    | v0.0.1  | Shipped      |
| Memory & startup fixes (race condition, prompt guards)                                                                          | 41    | v0.0.1  | Shipped      |
| Exploration pipeline fixes (JSON fallbacks, chunk dedup)                                                                        | 42    | v0.0.1  | Shipped      |
| Exploration reliability & change detection (throttling, markers)                                                                | 43    | v0.0.1  | Shipped      |
| Schema cleanup & integration tests (WAL checkpoint, legacy cleanup)                                                             | 44    | v0.0.1  | Shipped      |
| Exploration progress tracking fix (explorationId wired, all 5 phases tracked)                                                   | 47    | v0.0.2  | Shipped      |
| Worker resilience: max-turns detection, adaptive budgets, failure recovery                                                      | 48    | v0.0.2  | Shipped      |
| Worker control: stop/stop-all commands, PID capture, WebChat buttons                                                            | 46    | v0.0.2  | Shipped      |
| Responsive Master: priority queue, fast-path responder, queue depth visibility                                                  | 49    | v0.0.2  | Shipped      |
| Prompt library (7 methods on DotFolderManager) + audit logger JSONL output                                                      | 51    | v0.0.3  | Shipped      |
| Conversation continuity — memory.md cross-session pattern (read/write/inject)                                                   | 52    | v0.0.3  | Shipped      |
| Conversation history — /history command, listSessions, searchSessions, REST                                                     | 53    | v0.0.3  | Shipped      |
| Schema versioning — schema_versions table + transactional migrations                                                            | 54    | v0.0.3  | Shipped      |
| Worker streaming progress + session checkpointing/resume + priority queue                                                       | 55    | v0.0.3  | Shipped      |
| Documentation update (Phases 51–55)                                                                                             | 56    | v0.0.3  | Shipped      |
| Codex adapter fixes: --skip-git-repo-check, sandbox, OPENAI_API_KEY, --json, -o                                                 | 57    | v0.0.4  | Shipped      |
| Codex provider: CodexProvider, CodexConfig, session manager, provider registry                                                  | 58    | v0.0.4  | Shipped      |
| Codex documentation: ARCHITECTURE, API_REFERENCE, CONFIGURATION, TROUBLESHOOTING, WRITING_A_PROVIDER                            | 59    | v0.0.4  | Shipped      |
| MCP core pipeline: MCPServerSchema, SpawnOptions, TaskManifest, per-worker isolation, ClaudeAdapter flags, global config writer | 60    | v0.0.4  | Shipped      |
| MCP UX polish: health checks, config.example.json, CLI init MCP step                                                            | 61    | v0.0.4  | Shipped      |
| MCP documentation: ARCHITECTURE, CONFIGURATION, API_REFERENCE, CLAUDE.md, CHANGELOG, ROADMAP                                    | 62    | v0.0.4  | Shipped      |
| FTS5 query sanitization (OB-F38)                                                                                                | 63    | v0.0.5  | Shipped      |
| memory.md context injection (OB-F39)                                                                                            | 64    | v0.0.5  | Shipped      |
| Graceful shutdown with 10s timeout (OB-F40)                                                                                     | 65    | v0.0.5  | Shipped      |
| v0.0.5 documentation                                                                                                            | 66    | v0.0.5  | Shipped      |
| WhatsApp/Telegram media handling + MCP dashboard fixes                                                                          | 67    | v0.0.6  | Shipped      |
| Telegram/Discord message-too-long + live context fixes                                                                          | 68–69 | v0.0.7  | Shipped      |
| Voice transcription API fallback — OpenAI Whisper API + local CLI + prerequisites docs (OB-F46)                                 | 70    | v0.0.8  | Shipped      |
| Enhanced Setup Wizard CLI — OS detection, AI tool installer, API key walkthrough, health check (OB-F47 Phase 1)                 | 71    | v0.0.8  | Shipped      |
| Standalone Binary Packaging — pkg cross-platform binaries, NSIS/create-dmg installers, auto-update (OB-F47 Phase 2)             | 72    | v0.0.8  | Scaffolded\* |
| Electron Desktop App — React GUI, setup wizard, live dashboard, settings, system tray, native installers (OB-F47 Phase 3)       | 73    | v0.0.8  | Scaffolded\* |

> \* **Phases 72–73 are scaffolded but not yet functional.** Binary packaging scripts exist but have never been run. The Electron app has build configuration issues (missing TS compile step, path mismatches, setup wizard not wired). See [FUTURE.md — Finalization Required](docs/audit/FUTURE.md) for detailed issue list and fix plan.

---

## Next: Marketplace Development Track (v0.0.9 — v0.0.12)

**Priority:** Make OpenBridge effective for finishing 3 Marketplace projects, then make it a complete platform.

- **Marketplace** — Next.js 15 customer-facing frontend (early-mid dev, 0 tests)
- **Marketplace-dashboard** — Next.js 15 admin/supplier dashboard (mid dev, needs stabilization)
- **Marketplace-backend-services** — NestJS monorepo, 24 modules, 438 tests (needs integration testing + fixes)

| Version     | Phases                              | Key Features                                                                                   | Est. Tasks |
| ----------- | ----------------------------------- | ---------------------------------------------------------------------------------------------- | ---------- |
| **v0.0.9**  | 78a–80                              | Classification + SPAWN response fixes, code audit profile, exploration bug fixes, data cleanup | ~34        |
| **v0.0.10** | 74–77, 85                           | RAG knowledge retrieval (FTS5 queries before spawning workers), env var secret protection      | ~42        |
| **v0.0.11** | 81, 86                              | Master output sharing ([SHARE:*] markers), user consent for risky operations                   | ~20        |
| **v0.0.12** | 97–98, 82–84, 87–92, OB-F56, OB-193 | **Runtime escalation, batch continuation**, Deep Mode, WebChat, tunnel, Docker sandbox         | ~202       |
| **v0.0.13** | 93–96                               | Structured observations, vector search, session compaction, doctor/pairing/skills              | ~95–110    |

**Sprint 1 (v0.0.9)** — Foundation Fixes:

- Classification fixes — execution/delegation keywords trigger complex-task, not tool-use (OB-F76)
- SPAWN response fix — generate status message instead of empty stub after marker stripping (OB-F77, OB-F78)
- Workers can run `npm test`, `npm run lint`, `npm run typecheck` via new `code-audit` profile (OB-F57)
- 8 exploration bugs fixed — stable exploration of large codebases (OB-F58–F65)
- Clean `.openbridge/` data — no stale/corrupted state from old sessions (OB-F66, OB-F67)

**Sprint 2 (v0.0.10)** — Knowledge & Safety:

- Knowledge-First Retrieval (RAG) — query existing FTS5 chunks before spawning workers (OB-F48)
- Environment variable protection — strip DB_URL, API keys, SMTP creds from workers (OB-F70)

**Sprint 3 (v0.0.11)** — Development Workflow:

- Master knows how to share generated test reports and analysis via [SHARE:*] markers (OB-F68)
- User consent before risky operations — confirmation for code-edit and full-access workers (OB-F71)

**Sprint 4 (v0.0.12)** — Autonomy + Platform Completion:

- **Runtime permission escalation** — workers request elevated tool access, users grant/deny via `/allow`/`/deny`, grants persist (OB-F93, Phase 97)
- **Batch task continuation** — "implement all tasks one by one" loops autonomously with progress updates, commit-after-each, safety rails (OB-F94, Phase 98)
- Deep Mode — multi-phase execution: investigate → report → plan → execute → verify (OB-F56)
- WebChat modernization — extract UI, auth, phone/LAN/PWA, history, rich input, Deep Mode UI (OB-F73+F74+F75, Phases 88–92)
- Output delivery pipeline — tunnel integration, ephemeral app server, interaction relay (OB-F69, Phases 82–84)
- Docker sandbox — run workers in containers for untrusted workspaces (OB-193)
- Document visibility controls — include/exclude file lists, sensitive file detection (OB-F72, Phase 87)

See [docs/audit/FUTURE.md](docs/audit/FUTURE.md) for detailed task breakdowns.

---

## Community-Inspired Improvements (v0.0.13)

**After the Marketplace track is complete**, OpenBridge levels up by adopting battle-tested patterns from the open-source community. These improvements were identified by analyzing two major projects:

- **[openclaw/openclaw](https://github.com/openclaw/openclaw)** (242K stars) — Personal AI assistant with vector memory, 13+ channels, 60+ skills, session compaction, DM pairing, doctor command
- **[thedotmack/claude-mem](https://github.com/thedotmack/claude-mem)** (32K stars) — Memory compression plugin with structured observations, progressive disclosure, token economics, content-hash dedup

**Sprint 5 (v0.0.13)** — Community-Inspired:

- Structured observations from worker outputs — typed records with facts, concepts, files_touched (OB-F80, [claude-mem](https://github.com/thedotmack/claude-mem))
- Worker summaries with `completed/learned/next_steps` format (OB-F88, [claude-mem](https://github.com/thedotmack/claude-mem))
- Content-hash deduplication for workspace chunks (OB-F82, [claude-mem](https://github.com/thedotmack/claude-mem))
- Vector search via `sqlite-vec` + hybrid retrieval (vector + FTS5 + metadata) (OB-F79, [openclaw](https://github.com/openclaw/openclaw))
- Progressive disclosure — 2-step retrieval with ~10x token savings (OB-F81, [claude-mem](https://github.com/thedotmack/claude-mem))
- Session compaction — auto-summarize Master context when window fills (OB-F84, [openclaw](https://github.com/openclaw/openclaw))
- Token economics — track exploration cost vs retrieval savings (OB-F83, [claude-mem](https://github.com/thedotmack/claude-mem))
- `openbridge doctor` — self-diagnostic CLI command (OB-F85, [openclaw](https://github.com/openclaw/openclaw))
- Pairing-based auth — self-service approval for Discord/Telegram users (OB-F86, [openclaw](https://github.com/openclaw/openclaw))
- Skills directory — reusable `SKILL.md` capabilities the Master discovers (OB-F87, [openclaw](https://github.com/openclaw/openclaw))

---

## Future Work (Post v0.0.13)

All future features beyond the community-inspired track are tracked in [docs/audit/FUTURE.md](docs/audit/FUTURE.md).

### Deferred finalization:

| Feature                         | What's Needed                                                      | Est. Tasks |
| ------------------------------- | ------------------------------------------------------------------ | ---------- |
| Binary Packaging (Phase 72)     | Run pkg, test binaries, fix CI (.nvmrc), test native addons        | ~8–12      |
| Electron Desktop App (Phase 73) | Fix TS compile, wire setup wizard, fix Vite paths, test end-to-end | ~10–15     |
| MCP UI (Electron layer)         | Blocked by Electron fix — verify once app runs                     | ~3–5       |

### Deferred features:

| Feature                            | Description                                                                                   | Est. Phases |
| ---------------------------------- | --------------------------------------------------------------------------------------------- | ----------- |
| ~~Timeout scaling (OB-F52)~~       | ~~Scale worker timeouts based on task complexity instead of fixed 180s~~ — **Fixed (OB-F54)** | Done        |
| ~~Classification tuning (OB-F53)~~ | ~~Per-category success tracking instead of global escalation~~ — **Fixed (OB-F55)**           | Done        |
| Access Control Dashboard           | Web-based role/permission management UI                                                       | TBD         |
| Server Deployment Mode             | Docker container + headless mode for VPS/cloud                                                | TBD         |
| Agent Orchestration                | Role-based workers (Architect, Coder, Tester, Reviewer) with dependency chains                | TBD         |

---

## Dependency Graph

```
✅ Phases 1–5: Bridge Core + WhatsApp + Console + Claude Code
    │
    ├──► ✅ Phases 6–10: AI Discovery
    ├──► ✅ Phases 11–14: Workspace Exploration
    ├──► ✅ Phase 15: MVP Release
    ├──► ✅ Phases 16–21: Agent Runner + Self-Governing Master + Workers
    ├──► ✅ Phases 22–24: WebChat + Telegram + Discord
    ├──► ✅ Phase 29: Intent Classification
    └──► ✅ Phase 30: Production Hardening
              │
              ├──► ✅ Phases 31–44: SQLite Memory System (9 phases)
              ├──► ✅ Phases 46–49: Worker Control + Resilience + Responsive Master
              ├──► ✅ Phases 51–56: Prompt Library + History + Schema + Streaming + Docs
              ├──► ✅ Phases 57–62: Codex Provider + MCP Integration
              ├──► ✅ Phases 63–66: FTS5 Fix + Context Injection + Shutdown (v0.0.5)
              ├──► ✅ Phases 67–69: Media + Message Fixes (v0.0.6–v0.0.7)
              └──► ✅ Phases 70–73: Voice API + CLI Wizard + Binary + Desktop App (v0.0.8)
                        │
                        │  ── Marketplace Development Track ──
                        │
                        ├──► ⬜ Sprint 1 (v0.0.9): Phases 78a–80
                        │    ├── Phase 78a: Classification + SPAWN Response Fixes
                        │    ├── Phase 78b: Code Audit Profile (test/lint workers)
                        │    ├── Phase 79: Exploration Bug Fixes (8 bugs)
                        │    └── Phase 80: .openbridge Data Cleanup
                        │
                        ├──► ⬜ Sprint 2 (v0.0.10): Phases 74–77 + 85
                        │    ├── Phases 74–77: RAG Knowledge Retrieval
                        │    └── Phase 85: Env Var Protection
                        │
                        ├──► ⬜ Sprint 3 (v0.0.11): Phases 81 + 86
                        │    ├── Phase 81: Master Output Awareness
                        │    └── Phase 86: User Consent
                        │
                        ├──► ⬜ Sprint 4 (v0.0.12): Phases 97–98, 82–84, 87–92, OB-F56, OB-193
                        │    ├── Phase 97: Runtime Permission Escalation (OB-F93) ← HIGH PRIORITY
                        │    ├── Phase 98: Batch Task Continuation (OB-F94) ← HIGH PRIORITY
                        │    ├── Deep Mode (OB-F56): Multi-phase execution
                        │    ├── Phases 88–92: WebChat Modernization (UI, auth, PWA, history, Deep Mode UI)
                        │    ├── Phases 82–84: Tunnel + Ephemeral Apps + Interaction Relay
                        │    ├── Phase 87: Document Visibility Controls
                        │    └── OB-193: Docker Sandbox
                        │
                        │  ── Community-Inspired Improvements ──
                        │  (openclaw + claude-mem patterns)
                        │
                        └──► ⬜ Sprint 5 (v0.0.13): Phases 93–96
                             ├── Phase 93: Structured Observations + Worker Summaries + Chunk Dedup
                             │   (claude-mem: typed observations, next_steps, content-hash dedup)
                             │
                             ├── Phase 94: Vector Search + Hybrid Retrieval
                             │   (openclaw: sqlite-vec, MMR, temporal decay)
                             │   (claude-mem: progressive disclosure, 2-step retrieval)
                             │
                             ├── Phase 95: Session Compaction + Token Economics
                             │   (openclaw: auto-compaction with identifier preservation)
                             │   (claude-mem: discovery vs read token tracking, ROI)
                             │
                             └── Phase 96: Doctor + Pairing + Skills
                                  ├── 96a: openbridge doctor (openclaw: self-diagnostics)
                                  ├── 96b: Pairing-based auth (openclaw: DM pairing codes)
                                  └── 96c: Skills directory (openclaw: SKILL.md, 60+ skills)
```

---

## Version Milestones

| Version     | Status  | Key Features                                                                          | Tasks   |
| ----------- | ------- | ------------------------------------------------------------------------------------- | ------- |
| **v0.0.1**  | Done    | Foundation — 5 connectors, self-governing Master, AI discovery, memory system         | 310     |
| **v0.0.2**  | Done    | Exploration progress, worker resilience, worker control, responsive Master            | 42      |
| **v0.0.3**  | Done    | Prompt library, memory.md, history, schema versioning, streaming, checkpointing       | 50      |
| **v0.0.4**  | Done    | Codex provider + adapter fixes, MCP integration (config, isolation, health)           | 41      |
| **v0.0.5**  | Done    | FTS5 sanitization, memory.md context injection, graceful shutdown                     | 21      |
| **v0.0.6**  | Done    | WhatsApp/Telegram media, MCP dashboard fixes                                          | 14      |
| **v0.0.7**  | Done    | Telegram/Discord message splitting, live context fixes                                | 18      |
| **v0.0.8**  | Done    | Voice transcription API, enhanced CLI wizard, standalone binary, Electron desktop app | 95      |
| **v0.0.9**  | Planned | Classification fixes, code-audit profile, exploration bugs, data cleanup              | ~34     |
| **v0.0.10** | Planned | RAG knowledge retrieval, env var protection                                           | ~42     |
| **v0.0.11** | Planned | Master output sharing, user consent                                                   | ~20     |
| **v0.0.12** | Planned | Runtime escalation, batch continuation, Deep Mode, WebChat, tunnel, Docker sandbox    | ~202    |
| **v0.0.13** | Planned | Structured observations, vector search, session compaction, doctor/pairing/skills     | ~95–110 |

**Total shipped: 652 tasks across 73 phases. Planned: ~393–408 tasks across Phases 74–98.**

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
9. **Community-informed, independently built** — we study what works at scale ([openclaw](https://github.com/openclaw/openclaw), [claude-mem](https://github.com/thedotmack/claude-mem)) and adapt the best patterns to OpenBridge's architecture, keeping full control of our codebase

---

## How to Propose a Feature

1. Open an issue on [GitHub](https://github.com/medomar/OpenBridge/issues) with the `feature-request` label
2. Describe the use case, not just the solution
3. Features that align with the "zero config, zero API keys" philosophy are prioritized
4. All features must work with the existing plugin architecture (Connector + AIProvider interfaces)
