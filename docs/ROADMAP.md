# OpenBridge — Roadmap

> **Last Updated:** 2026-03-05 | **Current Version:** v0.0.12
> **Current Focus:** Phase 97 data integrity fixes (18 tasks), then Sprint 5 community-inspired improvements (v0.0.13).
> **17 open findings** — 7 data integrity (OB-F89–F95) + 10 community-inspired. See [docs/audit/FINDINGS.md](docs/audit/FINDINGS.md).

This document outlines what has shipped and the vision for future development. For detailed future feature specs, see [docs/audit/FUTURE.md](docs/audit/FUTURE.md).

---

## Released (v0.0.1 — v0.0.12)

Everything that shipped — 1045 tasks across 104+ phases.

| Feature                                                                                                                         | Phase   | Version | Status       |
| ------------------------------------------------------------------------------------------------------------------------------- | ------- | ------- | ------------ |
| Bridge Core (router, auth, queue, config)                                                                                       | 1–5     | v0.0.1  | Shipped      |
| WhatsApp + Console connectors                                                                                                   | 1–5     | v0.0.1  | Shipped      |
| Claude Code provider                                                                                                            | 1–5     | v0.0.1  | Shipped      |
| AI tool auto-discovery                                                                                                          | 6–10    | v0.0.1  | Shipped      |
| Incremental workspace exploration (5-pass)                                                                                      | 11–14   | v0.0.1  | Shipped      |
| MVP release                                                                                                                     | 15      | v0.0.1  | Shipped      |
| Agent Runner (--allowedTools, --max-turns, --model, retries)                                                                    | 16–18   | v0.0.1  | Shipped      |
| Self-governing Master AI                                                                                                        | 18–21   | v0.0.1  | Shipped      |
| Tool profiles (read-only, code-edit, code-audit, full-access, master)                                                           | 16–17   | v0.0.1  | Shipped      |
| Worker orchestration + SPAWN markers                                                                                            | 19–21   | v0.0.1  | Shipped      |
| Self-improvement (prompt tracking, model selection learning)                                                                    | 20–21   | v0.0.1  | Shipped      |
| WebChat, Telegram, Discord connectors                                                                                           | 22–24   | v0.0.1  | Shipped      |
| AI-powered intent classification                                                                                                | 29      | v0.0.1  | Shipped      |
| Live progress events across all connectors                                                                                      | 29      | v0.0.1  | Shipped      |
| Production hardening + v0.0.1 tag                                                                                               | 30      | v0.0.1  | Shipped      |
| Memory wiring (MemoryManager integration across all modules)                                                                    | 40      | v0.0.1  | Shipped      |
| Memory & startup fixes (race condition, prompt guards)                                                                          | 41      | v0.0.1  | Shipped      |
| Exploration pipeline fixes (JSON fallbacks, chunk dedup)                                                                        | 42      | v0.0.1  | Shipped      |
| Exploration reliability & change detection (throttling, markers)                                                                | 43      | v0.0.1  | Shipped      |
| Schema cleanup & integration tests (WAL checkpoint, legacy cleanup)                                                             | 44      | v0.0.1  | Shipped      |
| Exploration progress tracking fix (explorationId wired, all 5 phases tracked)                                                   | 47      | v0.0.2  | Shipped      |
| Worker resilience: max-turns detection, adaptive budgets, failure recovery                                                      | 48      | v0.0.2  | Shipped      |
| Worker control: stop/stop-all commands, PID capture, WebChat buttons                                                            | 46      | v0.0.2  | Shipped      |
| Responsive Master: priority queue, fast-path responder, queue depth visibility                                                  | 49      | v0.0.2  | Shipped      |
| Prompt library (7 methods on DotFolderManager) + audit logger JSONL output                                                      | 51      | v0.0.3  | Shipped      |
| Conversation continuity — memory.md cross-session pattern (read/write/inject)                                                   | 52      | v0.0.3  | Shipped      |
| Conversation history — /history command, listSessions, searchSessions, REST                                                     | 53      | v0.0.3  | Shipped      |
| Schema versioning — schema_versions table + transactional migrations                                                            | 54      | v0.0.3  | Shipped      |
| Worker streaming progress + session checkpointing/resume + priority queue                                                       | 55      | v0.0.3  | Shipped      |
| Documentation update (Phases 51–55)                                                                                             | 56      | v0.0.3  | Shipped      |
| Codex adapter fixes: --skip-git-repo-check, sandbox, OPENAI_API_KEY, --json, -o                                                 | 57      | v0.0.4  | Shipped      |
| Codex provider: CodexProvider, CodexConfig, session manager, provider registry                                                  | 58      | v0.0.4  | Shipped      |
| Codex documentation: ARCHITECTURE, API_REFERENCE, CONFIGURATION, TROUBLESHOOTING, WRITING_A_PROVIDER                            | 59      | v0.0.4  | Shipped      |
| MCP core pipeline: MCPServerSchema, SpawnOptions, TaskManifest, per-worker isolation, ClaudeAdapter flags, global config writer | 60      | v0.0.4  | Shipped      |
| MCP UX polish: health checks, config.example.json, CLI init MCP step                                                            | 61      | v0.0.4  | Shipped      |
| MCP documentation: ARCHITECTURE, CONFIGURATION, API_REFERENCE, CLAUDE.md, CHANGELOG, ROADMAP                                    | 62      | v0.0.4  | Shipped      |
| FTS5 query sanitization (OB-F38)                                                                                                | 63      | v0.0.5  | Shipped      |
| memory.md context injection (OB-F39)                                                                                            | 64      | v0.0.5  | Shipped      |
| Graceful shutdown with 10s timeout (OB-F40)                                                                                     | 65      | v0.0.5  | Shipped      |
| v0.0.5 documentation                                                                                                            | 66      | v0.0.5  | Shipped      |
| WhatsApp/Telegram media handling + MCP dashboard fixes                                                                          | 67      | v0.0.6  | Shipped      |
| Telegram/Discord message-too-long + live context fixes                                                                          | 68–69   | v0.0.7  | Shipped      |
| Voice transcription API fallback — OpenAI Whisper API + local CLI + prerequisites docs (OB-F46)                                 | 70      | v0.0.8  | Shipped      |
| Enhanced Setup Wizard CLI — OS detection, AI tool installer, API key walkthrough, health check (OB-F47 Phase 1)                 | 71      | v0.0.8  | Shipped      |
| Standalone Binary Packaging — pkg cross-platform binaries, NSIS/create-dmg installers, auto-update (OB-F47 Phase 2)             | 72      | v0.0.8  | Scaffolded\* |
| Electron Desktop App — React GUI, setup wizard, live dashboard, settings, system tray, native installers (OB-F47 Phase 3)       | 73      | v0.0.8  | Scaffolded\* |
| Classification + SPAWN response fixes, code-audit profile (OB-F57, F76–F78)                                                     | 78a–78b | v0.0.9  | Shipped      |
| Exploration bug fixes — 8 bugs (OB-F58–F65)                                                                                     | 79      | v0.0.9  | Shipped      |
| .openbridge data cleanup (OB-F66, F67)                                                                                          | 80      | v0.0.9  | Shipped      |
| RAG knowledge retrieval — FTS5 queries, workspace map, dir-dive, Q&A cache (OB-F48)                                             | 74–77   | v0.0.10 | Shipped      |
| Environment variable protection — deny-list, allow-list, per-adapter sanitization (OB-F70)                                      | 85      | v0.0.10 | Shipped      |
| Master output sharing — [SHARE:*] markers, file-server URL, routing guidelines (OB-F68)                                         | 81      | v0.0.11 | Shipped      |
| User consent & execution transparency — risk classification, confirmation, cost estimation (OB-F71)                             | 86      | v0.0.11 | Shipped      |
| Real-world testing fixes — Codex streaming, RAG zero results, tool compatibility, classifier (OB-F89–F92)                       | RWT     | v0.0.12 | Shipped      |
| Deep Mode — 5-phase state machine, interactive commands, phase-aware workers (OB-F56)                                           | Deep    | v0.0.12 | Shipped      |
| Tunnel integration — cloudflared/ngrok auto-detect, public URLs (OB-F69)                                                        | 82      | v0.0.12 | Shipped      |
| Ephemeral app server — scaffold detection, port allocation, idle timeout (OB-F69)                                               | 83      | v0.0.12 | Shipped      |
| Interaction relay — WebSocket bidirectional app↔Master communication (OB-F69)                                                   | 84      | v0.0.12 | Shipped      |
| Document visibility controls — include/exclude, secret scanner, content redactor (OB-F72)                                       | 87      | v0.0.12 | Shipped      |
| WebChat frontend extraction — modular JS/CSS, dark mode, markdown, syntax highlight (OB-F74)                                    | 88      | v0.0.12 | Shipped      |
| WebChat authentication — token/password auth, sessions, rate limiting (OB-F73)                                                  | 89      | v0.0.12 | Shipped      |
| Phone access + mobile PWA — LAN/tunnel, QR codes, responsive, service worker (OB-F75)                                           | 90      | v0.0.12 | Shipped      |
| Conversation history + rich input — sidebar, file upload, voice, autocomplete (OB-F74)                                          | 91      | v0.0.12 | Shipped      |
| Settings panel + Deep Mode UI — gear panel, stepper, phase cards, MCP restore (OB-F74)                                          | 92      | v0.0.12 | Shipped      |
| Runtime permission escalation — escalation queue, /allow, /deny, persistent grants (OB-F93)                                     | 97      | v0.0.12 | Shipped      |
| Batch task continuation — self-messaging loop, state machine, safety rails (OB-F94)                                             | 98      | v0.0.12 | Shipped      |
| Docker sandbox — container isolation, resource limits, cleanup (OB-193)                                                         | Docker  | v0.0.12 | Shipped      |
| Escalation queue & orphan fixes — multi-worker queue, watchdog, /workers (OB-F95–F97, F103)                                     | 99      | v0.0.12 | Shipped      |
| Classification & RAG fixes — strategic keywords, FTS5 fix, menu-selection, SPAWN summary (OB-F98–F100, F102)                    | 100     | v0.0.12 | Shipped      |
| Batch & shutdown safety — timer cleanup, .catch handlers, sender persistence (OB-F108–F114)                                     | 101     | v0.0.12 | Shipped      |
| Worker & cost controls — per-profile cost caps, partial status, adaptive maxTurns (OB-F101, F104)                               | 102     | v0.0.12 | Shipped      |
| Docker & startup polish — log consolidation, whitelist diagnostics, .env.example fix (OB-F105–F111)                             | 103     | v0.0.12 | Shipped      |
| Test suite fixes — stale mock updates for batch continuation (OB-F113)                                                          | 104     | v0.0.12 | Shipped      |

> \* **Phases 72–73 are scaffolded but not yet functional.** See [FUTURE.md — Deferred](docs/audit/FUTURE.md) for details.

---

## Next: Phase 97 — Data Integrity Fixes (pre-v0.0.13)

7 broken data pipelines discovered by auditing `.openbridge/openbridge.db`. Features are built but have wiring gaps.

| Finding | Issue                               | Severity  | Tasks |
| ------- | ----------------------------------- | --------- | ----- |
| OB-F91  | Sessions never close                | 🟠 High   | 3     |
| OB-F92  | Learnings turns always 0            | 🟠 High   | 3     |
| OB-F90  | QA cache write path missing         | 🟠 High   | 3     |
| OB-F95  | memory.md goes stale                | 🟠 High   | 3     |
| OB-F93  | Prompt evolution never activates    | 🟡 Medium | 2     |
| OB-F89  | Audit log disabled by default       | 🟡 Medium | 2     |
| OB-F94  | Sub-master detection never triggers | 🟡 Medium | 2     |

**18 tasks total.** All surgical fixes to existing code. See [docs/audit/TASKS.md](docs/audit/TASKS.md) for details.

---

## After Phase 97: Community-Inspired Improvements (v0.0.13)

**With data pipelines fixed**, OpenBridge levels up by adopting battle-tested patterns from the open-source community:

- **[openclaw/openclaw](https://github.com/openclaw/openclaw)** (242K stars) — Personal AI assistant with vector memory, 13+ channels, 60+ skills, session compaction, DM pairing, doctor command
- **[thedotmack/claude-mem](https://github.com/thedotmack/claude-mem)** (32K stars) — Memory compression plugin with structured observations, progressive disclosure, token economics, content-hash dedup

| Phase     | Focus                                      | Findings               | Est. Tasks  |
| --------- | ------------------------------------------ | ---------------------- | ----------- |
| 93        | Structured Observations & Worker Summaries | OB-F80, OB-F82, OB-F88 | ~20–22      |
| 94        | Vector Search & Hybrid Retrieval           | OB-F79, OB-F81         | ~18–20      |
| 95        | Session Compaction & Token Economics       | OB-F83, OB-F84         | ~16–18      |
| 96        | Doctor + Pairing + Skills                  | OB-F85, OB-F86, OB-F87 | ~28–32      |
| **Total** |                                            | **10 findings**        | **~95–110** |

See [docs/audit/FUTURE.md](docs/audit/FUTURE.md) for detailed task breakdowns.

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

| Feature                  | Description                                                                    | Est. Phases |
| ------------------------ | ------------------------------------------------------------------------------ | ----------- |
| Access Control Dashboard | Web-based role/permission management UI                                        | TBD         |
| Server Deployment Mode   | Docker container + headless mode for VPS/cloud                                 | TBD         |
| Agent Orchestration      | Role-based workers (Architect, Coder, Tester, Reviewer) with dependency chains | TBD         |

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
                        ├──► ✅ Sprint 1 (v0.0.9): Phases 78a–80
                        ├──► ✅ Sprint 2 (v0.0.10): Phases 74–77 + 85
                        ├──► ✅ Sprint 3 (v0.0.11): Phases 81 + 86
                        └──► ✅ Sprint 4 (v0.0.12): Phases RWT, Deep, 82–104, Docker
                                  │
                                  │  ── Community-Inspired Improvements ──
                                  │  (openclaw + claude-mem patterns)
                                  │
                                  ├──► ⬜ Phase 97: Data Integrity Fixes (18 tasks)
                                  │    ├── OB-F91: Session lifecycle
                                  │    ├── OB-F92: Turns tracking
                                  │    ├── OB-F90: QA cache writes
                                  │    ├── OB-F95: memory.md reliability
                                  │    ├── OB-F93: Prompt evolution
                                  │    ├── OB-F89: Audit logging
                                  │    └── OB-F94: Sub-master detection
                                  │
                                  └──► ⬜ Sprint 5 (v0.0.13): Phases 93–96
                                       ├── Phase 93: Structured Observations + Worker Summaries + Chunk Dedup
                                       ├── Phase 94: Vector Search + Hybrid Retrieval + Progressive Disclosure
                                       ├── Phase 95: Session Compaction + Token Economics
                                       └── Phase 96: Doctor + Pairing + Skills
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
| **v0.0.9**  | Done    | Classification fixes, code-audit profile, exploration bugs, data cleanup              | 34      |
| **v0.0.10** | Done    | RAG knowledge retrieval, env var protection                                           | 43      |
| **v0.0.11** | Done    | Master output sharing, user consent                                                   | 20      |
| **v0.0.12** | Done    | Deep Mode, WebChat, tunnel, Docker, escalation, batch, runtime fixes                  | 281     |
| **v0.0.13** | Planned | Structured observations, vector search, session compaction, doctor/pairing/skills     | ~95–110 |

**Total shipped: 1045 tasks across 104+ phases. Planned: 18 tasks (Phase 97) + ~95–110 tasks (Phases 93–96).**

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
