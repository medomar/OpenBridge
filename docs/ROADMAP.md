# OpenBridge — Roadmap

> **Last Updated:** 2026-03-01 | **Current Version:** v0.0.8

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

## Future Work

All future features, deferred findings, and finalization items are tracked in [docs/audit/FUTURE.md](docs/audit/FUTURE.md).

### Finalization (highest priority):

| Feature                         | What's Needed                                                      | Est. Tasks |
| ------------------------------- | ------------------------------------------------------------------ | ---------- |
| Binary Packaging (Phase 72)     | Run pkg, test binaries, fix CI (.nvmrc), test native addons        | ~8–12      |
| Electron Desktop App (Phase 73) | Fix TS compile, wire setup wizard, fix Vite paths, test end-to-end | ~10–15     |
| MCP UI (Electron layer)         | Blocked by Electron fix — verify once app runs                     | ~3–5       |

### New features:

| Feature                         | Description                                                                                   | Est. Phases |
| ------------------------------- | --------------------------------------------------------------------------------------------- | ----------- |
| Knowledge-First Retrieval (RAG) | Query existing FTS5 chunks, workspace map, and dir-dive data before spawning workers (OB-F48) | 74–77       |
| Timeout scaling (OB-F52)        | Scale worker timeouts based on task complexity instead of fixed 180s                          | TBD         |
| Classification tuning (OB-F53)  | Per-category success tracking instead of global escalation                                    | TBD         |
| Access Control Dashboard        | Web-based role/permission management UI                                                       | TBD         |
| Server Deployment Mode          | Docker container + headless mode for VPS/cloud                                                | TBD         |
| Agent Orchestration             | Role-based workers (Architect, Coder, Tester, Reviewer) with dependency chains                | TBD         |

---

## Dependency Graph (Shipped)

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
```

---

## Version Milestones

| Version    | Status | Key Features                                                                          | Tasks |
| ---------- | ------ | ------------------------------------------------------------------------------------- | ----- |
| **v0.0.1** | Done   | Foundation — 5 connectors, self-governing Master, AI discovery, memory system         | 310   |
| **v0.0.2** | Done   | Exploration progress, worker resilience, worker control, responsive Master            | 42    |
| **v0.0.3** | Done   | Prompt library, memory.md, history, schema versioning, streaming, checkpointing       | 50    |
| **v0.0.4** | Done   | Codex provider + adapter fixes, MCP integration (config, isolation, health)           | 41    |
| **v0.0.5** | Done   | FTS5 sanitization, memory.md context injection, graceful shutdown                     | 21    |
| **v0.0.6** | Done   | WhatsApp/Telegram media, MCP dashboard fixes                                          | 14    |
| **v0.0.7** | Done   | Telegram/Discord message splitting, live context fixes                                | 18    |
| **v0.0.8** | Done   | Voice transcription API, enhanced CLI wizard, standalone binary, Electron desktop app | 95    |

**Total shipped: 652 tasks across 73 phases.**

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

---

## How to Propose a Feature

1. Open an issue on [GitHub](https://github.com/medomar/OpenBridge/issues) with the `feature-request` label
2. Describe the use case, not just the solution
3. Features that align with the "zero config, zero API keys" philosophy are prioritized
4. All features must work with the existing plugin architecture (Connector + AIProvider interfaces)
