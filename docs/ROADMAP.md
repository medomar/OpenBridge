# OpenBridge — Roadmap

> **Last Updated:** 2026-03-23 | **Current Version:** v0.1.0
> **1672 tasks shipped, 230 findings fixed** across v0.0.1–v0.1.0. Clean slate for next cycle.
> See [docs/audit/FINDINGS.md](docs/audit/FINDINGS.md) | [docs/audit/FUTURE.md](docs/audit/FUTURE.md).

This document outlines what has shipped and the vision for future development. For detailed future feature specs, see [docs/audit/FUTURE.md](docs/audit/FUTURE.md).

---

## Released (v0.0.1 — v0.1.0)

Everything that shipped — 1672 tasks across 169 phases.

| Feature                                                                                                                          | Phase   | Version  | Status  |
| -------------------------------------------------------------------------------------------------------------------------------- | ------- | -------- | ------- |
| Bridge Core (router, auth, queue, config)                                                                                        | 1–5     | v0.0.1   | Shipped |
| WhatsApp + Console connectors                                                                                                    | 1–5     | v0.0.1   | Shipped |
| Claude Code provider                                                                                                             | 1–5     | v0.0.1   | Shipped |
| AI tool auto-discovery                                                                                                           | 6–10    | v0.0.1   | Shipped |
| Incremental workspace exploration (5-pass)                                                                                       | 11–14   | v0.0.1   | Shipped |
| MVP release                                                                                                                      | 15      | v0.0.1   | Shipped |
| Agent Runner (--allowedTools, --max-turns, --model, retries)                                                                     | 16–18   | v0.0.1   | Shipped |
| Self-governing Master AI                                                                                                         | 18–21   | v0.0.1   | Shipped |
| Tool profiles (read-only, code-edit, code-audit, full-access, master)                                                            | 16–17   | v0.0.1   | Shipped |
| Worker orchestration + SPAWN markers                                                                                             | 19–21   | v0.0.1   | Shipped |
| Self-improvement (prompt tracking, model selection learning)                                                                     | 20–21   | v0.0.1   | Shipped |
| WebChat, Telegram, Discord connectors                                                                                            | 22–24   | v0.0.1   | Shipped |
| AI-powered intent classification                                                                                                 | 29      | v0.0.1   | Shipped |
| Live progress events across all connectors                                                                                       | 29      | v0.0.1   | Shipped |
| Production hardening + v0.0.1 tag                                                                                                | 30      | v0.0.1   | Shipped |
| Memory wiring (MemoryManager integration across all modules)                                                                     | 40      | v0.0.1   | Shipped |
| Memory & startup fixes (race condition, prompt guards)                                                                           | 41      | v0.0.1   | Shipped |
| Exploration pipeline fixes (JSON fallbacks, chunk dedup)                                                                         | 42      | v0.0.1   | Shipped |
| Exploration reliability & change detection (throttling, markers)                                                                 | 43      | v0.0.1   | Shipped |
| Schema cleanup & integration tests (WAL checkpoint, legacy cleanup)                                                              | 44      | v0.0.1   | Shipped |
| Exploration progress tracking fix (explorationId wired, all 5 phases tracked)                                                    | 47      | v0.0.2   | Shipped |
| Worker resilience: max-turns detection, adaptive budgets, failure recovery                                                       | 48      | v0.0.2   | Shipped |
| Worker control: stop/stop-all commands, PID capture, WebChat buttons                                                             | 46      | v0.0.2   | Shipped |
| Responsive Master: priority queue, fast-path responder, queue depth visibility                                                   | 49      | v0.0.2   | Shipped |
| Prompt library (7 methods on DotFolderManager) + audit logger JSONL output                                                       | 51      | v0.0.3   | Shipped |
| Conversation continuity — memory.md cross-session pattern (read/write/inject)                                                    | 52      | v0.0.3   | Shipped |
| Conversation history — /history command, listSessions, searchSessions, REST                                                      | 53      | v0.0.3   | Shipped |
| Schema versioning — schema_versions table + transactional migrations                                                             | 54      | v0.0.3   | Shipped |
| Worker streaming progress + session checkpointing/resume + priority queue                                                        | 55      | v0.0.3   | Shipped |
| Documentation update (Phases 51–55)                                                                                              | 56      | v0.0.3   | Shipped |
| Codex adapter fixes: --skip-git-repo-check, sandbox, OPENAI_API_KEY, --json, -o                                                  | 57      | v0.0.4   | Shipped |
| Codex provider: CodexProvider, CodexConfig, session manager, provider registry                                                   | 58      | v0.0.4   | Shipped |
| Codex documentation: ARCHITECTURE, API_REFERENCE, CONFIGURATION, TROUBLESHOOTING, WRITING_A_PROVIDER                             | 59      | v0.0.4   | Shipped |
| MCP core pipeline: MCPServerSchema, SpawnOptions, TaskManifest, per-worker isolation, ClaudeAdapter flags, global config writer  | 60      | v0.0.4   | Shipped |
| MCP UX polish: health checks, config.example.json, CLI init MCP step                                                             | 61      | v0.0.4   | Shipped |
| MCP documentation: ARCHITECTURE, CONFIGURATION, API_REFERENCE, CLAUDE.md, CHANGELOG, ROADMAP                                     | 62      | v0.0.4   | Shipped |
| FTS5 query sanitization (OB-F38)                                                                                                 | 63      | v0.0.5   | Shipped |
| memory.md context injection (OB-F39)                                                                                             | 64      | v0.0.5   | Shipped |
| Graceful shutdown with 10s timeout (OB-F40)                                                                                      | 65      | v0.0.5   | Shipped |
| v0.0.5 documentation                                                                                                             | 66      | v0.0.5   | Shipped |
| WhatsApp/Telegram media handling + MCP dashboard fixes                                                                           | 67      | v0.0.6   | Shipped |
| Telegram/Discord message-too-long + live context fixes                                                                           | 68–69   | v0.0.7   | Shipped |
| Voice transcription API fallback — OpenAI Whisper API + local CLI + prerequisites docs (OB-F46)                                  | 70      | v0.0.8   | Shipped |
| Enhanced Setup Wizard CLI — OS detection, AI tool installer, API key walkthrough, health check (OB-F47 Phase 1)                  | 71      | v0.0.8   | Shipped |
| Classification + SPAWN response fixes, code-audit profile (OB-F57, F76–F78)                                                      | 78a–78b | v0.0.9   | Shipped |
| Exploration bug fixes — 8 bugs (OB-F58–F65)                                                                                      | 79      | v0.0.9   | Shipped |
| .openbridge data cleanup (OB-F66, F67)                                                                                           | 80      | v0.0.9   | Shipped |
| RAG knowledge retrieval — FTS5 queries, workspace map, dir-dive, Q&A cache (OB-F48)                                              | 74–77   | v0.0.10  | Shipped |
| Environment variable protection — deny-list, allow-list, per-adapter sanitization (OB-F70)                                       | 85      | v0.0.10  | Shipped |
| Master output sharing — [SHARE:*] markers, file-server URL, routing guidelines (OB-F68)                                          | 81      | v0.0.11  | Shipped |
| User consent & execution transparency — risk classification, confirmation, cost estimation (OB-F71)                              | 86      | v0.0.11  | Shipped |
| Real-world testing fixes — Codex streaming, RAG zero results, tool compatibility, classifier (OB-F89–F92)                        | RWT     | v0.0.12  | Shipped |
| Deep Mode — 5-phase state machine, interactive commands, phase-aware workers (OB-F56)                                            | Deep    | v0.0.12  | Shipped |
| Tunnel integration — cloudflared/ngrok auto-detect, public URLs (OB-F69)                                                         | 82      | v0.0.12  | Shipped |
| Ephemeral app server — scaffold detection, port allocation, idle timeout (OB-F69)                                                | 83      | v0.0.12  | Shipped |
| Interaction relay — WebSocket bidirectional app↔Master communication (OB-F69)                                                    | 84      | v0.0.12  | Shipped |
| Document visibility controls — include/exclude, secret scanner, content redactor (OB-F72)                                        | 87      | v0.0.12  | Shipped |
| WebChat frontend extraction — modular JS/CSS, dark mode, markdown, syntax highlight (OB-F74)                                     | 88      | v0.0.12  | Shipped |
| WebChat authentication — token/password auth, sessions, rate limiting (OB-F73)                                                   | 89      | v0.0.12  | Shipped |
| Phone access + mobile PWA — LAN/tunnel, QR codes, responsive, service worker (OB-F75)                                            | 90      | v0.0.12  | Shipped |
| Conversation history + rich input — sidebar, file upload, voice, autocomplete (OB-F74)                                           | 91      | v0.0.12  | Shipped |
| Settings panel + Deep Mode UI — gear panel, stepper, phase cards, MCP restore (OB-F74)                                           | 92      | v0.0.12  | Shipped |
| Runtime permission escalation — escalation queue, /allow, /deny, persistent grants (OB-F93)                                      | 97      | v0.0.12  | Shipped |
| Batch task continuation — self-messaging loop, state machine, safety rails (OB-F94)                                              | 98      | v0.0.12  | Shipped |
| Docker sandbox — container isolation, resource limits, cleanup (OB-193)                                                          | Docker  | v0.0.12  | Shipped |
| Escalation queue & orphan fixes — multi-worker queue, watchdog, /workers (OB-F95–F97, F103)                                      | 99      | v0.0.12  | Shipped |
| Classification & RAG fixes — strategic keywords, FTS5 fix, menu-selection, SPAWN summary (OB-F98–F100, F102)                     | 100     | v0.0.12  | Shipped |
| Batch & shutdown safety — timer cleanup, .catch handlers, sender persistence (OB-F108–F114)                                      | 101     | v0.0.12  | Shipped |
| Worker & cost controls — per-profile cost caps, partial status, adaptive maxTurns (OB-F101, F104)                                | 102     | v0.0.12  | Shipped |
| Docker & startup polish — log consolidation, whitelist diagnostics, .env.example fix (OB-F105–F111)                              | 103     | v0.0.12  | Shipped |
| Test suite fixes — stale mock updates for batch continuation (OB-F113)                                                           | 104     | v0.0.12  | Shipped |
| Data integrity fixes — audit log, QA cache, sessions, turns, prompts, sub-masters, memory.md (OB-F89–F95)                        | 97      | pre-0.13 | Shipped |
| Structured observations, worker summaries, content-hash dedup (OB-F80, F82, F88)                                                 | 93      | v0.0.13  | Shipped |
| Session compaction & token economics (OB-F83, F84)                                                                               | 95      | v0.0.13  | Shipped |
| Channel role management UX fix (OB-F103)                                                                                         | 96d     | v0.0.13  | Shipped |
| Document generation skills — DOCX, PPTX, XLSX, PDF (OB-F98)                                                                      | 99      | v0.0.13  | Shipped |
| Vector search & hybrid retrieval — sqlite-vec, MMR, progressive disclosure (OB-F79, F81)                                         | 94      | v0.0.13  | Shipped |
| `openbridge doctor` — self-diagnostic command (OB-F85)                                                                           | 96a     | v0.0.13  | Shipped |
| Pairing-based auth — 6-digit code onboarding (OB-F86)                                                                            | 96b     | v0.0.13  | Shipped |
| Skills directory — SKILL.md pattern, auto-creation (OB-F87)                                                                      | 96c     | v0.0.13  | Shipped |
| Skill pack system extensions — 5 domain packs (OB-F96)                                                                           | 98      | v0.0.14  | Shipped |
| Design & creative output — diagrams, charts, generative art (OB-F99)                                                             | 100     | v0.0.14  | Shipped |
| Agent orchestration patterns — planning gate, swarms, test protection, iteration caps (OB-F97, F100–F102)                        | 101     | v0.0.14  | Shipped |
| Prompt budget & assembly — PromptAssembler, adapter-aware limits, priority sections (OB-F147, F148)                              | 105     | v0.0.15  | Shipped |
| Prompt growth & dedup — size cap, skipWorkspaceContext, seed idempotency (OB-F149, F150, F151)                                   | 106     | v0.0.15  | Shipped |
| Classification fixes — attachment awareness, file-reference keywords (OB-F152, F154)                                             | 107     | v0.0.15  | Shipped |
| Worker & exploration cleanup — orphan timeout, stale rows, memory.md seeding (OB-F153, F155, F156)                               | 108     | v0.0.15  | Shipped |
| Monorepo awareness — sub-project detection, per-project exploration (OB-F157)                                                    | 109     | v0.0.15  | Shipped |
| God-class refactoring — 8 modules extracted from 3 god-class files (OB-F158, F159, F160)                                         | 110     | v0.0.15  | Shipped |
| Documentation sync — LOC references, new module listings (OB-F161)                                                               | 111     | v0.0.15  | Shipped |
| Process & timer safety — kill race, checkpoint resume, eviction guard, timer cleanup (OB-F162, F163, F164, F167, F168, F170)     | 112     | v0.0.15  | Shipped |
| Memory leak fixes — queue recursion, rate limiter cleanup, cache eviction, connector Maps (OB-F165, F166, F169, F171, F176)      | 113     | v0.0.15  | Shipped |
| Data safety & error visibility — JSON.parse safety, drain error handling, I/O logging (OB-F172, F173, F174, F175, F177)          | 114     | v0.0.15  | Shipped |
| Test suite regression fixes — 29 failing tests across 12 files restored to green                                                 | 115     | v0.0.15  | Shipped |
| Document intelligence layer — PDF, Excel, DOCX, CSV, image, email processing (OB-F184)                                           | 116     | v0.1.0   | Shipped |
| DocType engine — schema & storage, dynamic tables, naming series, REST API, forms (OB-F185)                                      | 117     | v0.1.0   | Shipped |
| DocType engine — lifecycle & hooks, state machine, notifications, PDF generation (OB-F185)                                       | 118     | v0.1.0   | Shipped |
| Integration hub — core framework, credential store (AES-256-GCM), webhook router (OB-F186/F189)                                  | 119     | v0.1.0   | Shipped |
| Integration hub — adapters: Stripe, Google Drive, PostgreSQL, OpenAPI auto-adapter (OB-F186/F178)                                | 120     | v0.1.0   | Shipped |
| Workflow engine — schedule triggers, conditions, multi-step pipelines, human approval (OB-F187)                                  | 121     | v0.1.0   | Shipped |
| Business document generation — pdfmake, invoice/quote/receipt templates, QR codes (OB-F188)                                      | 122     | v0.1.0   | Shipped |
| Universal API adapter — Swagger/Postman/cURL parsing, auto skill-pack generation (OB-F190)                                       | 123     | v0.1.0   | Shipped |
| Industry templates — café/restaurant, retail, freelance, real estate (OB-F185)                                                   | 124     | v0.1.0   | Shipped |
| Self-improvement & skill learning — prompt refinement, model selection optimization                                              | 125     | v0.1.0   | Shipped |
| Skill packs — cloud storage, web deploy, spreadsheet handler, file converter (OB-F178/F179/F180/F181)                            | 126     | v0.1.0   | Shipped |
| Worker permissions & Agent SDK integration — canUseTool relay, trust levels (OB-F182/F183)                                       | 127     | v0.1.0   | Shipped |
| WebChat file upload fix — structured attachments + document processing (OB-F191)                                                 | —       | v0.1.0   | Shipped |
| Real-world testing fixes — workspace map persistence, prompt budget 32K, worker cost caps, activity tracking                     | 128–132 | v0.1.0   | Shipped |
| Model budgets, prompt size cap fix, WebChat session isolation, worker file ops, trust level system, workspace boundary hardening | 133–151 | v0.1.0   | Shipped |
| Escalation loop fix, Docker health cleanup, system prompt budget, quick-answer timeout, streaming retry, Codex cost fix          | 152–157 | v0.1.0   | Shipped |
| Channel/role context injection, remote file/app delivery, integration tests for remote deploy                                    | 158–160 | v0.1.0   | Shipped |
| DLQ error response, classifier fix, exploration data integrity, worker boundary protection                                       | 161–163 | v0.1.0   | Shipped |
| Headless worker safety, message queueing during processing, quick-answer timeout regression                                      | 164–166 | v0.1.0   | Shipped |
| First-run log noise cleanup, integration tests for real-world fixes, classification escalation + max-turns UX                    | 167–169 | v0.1.0   | Shipped |

---

## SDK Strategy

OpenBridge is designed as an **SDK / library** — not a standalone desktop application. It exposes clean interfaces (`Connector`, `AIProvider`, `Bridge`) that can be embedded into any native app (macOS, Windows, iOS, Electron, Tauri, etc.) or server environment. Desktop app scaffolding (Phases 72–73) was removed in favor of this SDK-first approach.

Integration points:

- **Programmatic API** — import `openbridge` as a Node.js package and wire it into your app
- **Plugin interfaces** — implement `Connector` for custom channels, `AIProvider` for custom AI backends
- **Config-driven** — pass config programmatically or via `config.json`
- **Headless mode** — runs without any UI, perfect for embedding

## Next (v0.2.0+)

Clean slate — ready for new planning and implementation. See [docs/audit/FUTURE.md](docs/audit/FUTURE.md) for backlog ideas.

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
              └──► ✅ Phases 70–71: Voice API + CLI Wizard (v0.0.8)
                        │
                        │  ── Marketplace Development Track ──
                        │
                        ├──► ✅ Sprint 1 (v0.0.9): Phases 78a–80
                        ├──► ✅ Sprint 2 (v0.0.10): Phases 74–77 + 85
                        ├──► ✅ Sprint 3 (v0.0.11): Phases 81 + 86
                        └──► ✅ Sprint 4 (v0.0.12): Phases RWT, Deep, 82–104, Docker
                                  │
                                  ├──► ✅ Phase 97: Data Integrity Fixes (18 tasks, 7 findings)
                                  │
                                  │  ── Sprint 5: Smarter AI + Business Output ──
                                  │
                                  ├──► ✅ Sprint 5 (v0.0.13): 126 tasks, 12 findings
                                  │    ├── Phase 93: Structured Observations + Worker Summaries + Chunk Dedup
                                  │    ├── Phase 95: Session Compaction + Token Economics
                                  │    ├── Phase 96d: Channel Role Management UX
                                  │    ├── Phase 99: Document Generation Skills
                                  │    ├── Phase 94: Vector Search + Hybrid Retrieval
                                  │    ├── Phase 96a: openbridge doctor
                                  │    ├── Phase 96b: Pairing-Based Auth
                                  │    └── Phase 96c: Skills Directory
                                  │
                                  │  ── Sprint 6: Skill System + Creative + Orchestration ──
                                  │
                                  └──► ✅ Sprint 6 (v0.0.14): 50 tasks, 6 findings
                                       ├── Phase 98: Skill Pack System Extensions
                                       ├── Phase 100: Design & Creative Output Skills
                                       └── Phase 101: Agent Orchestration Patterns
                                             │
                                             │  ── v0.0.15: Deep Stability Audit ──
                                             │
                                             └──► ✅ v0.0.15: 93 tasks, 34 findings (OB-F144–F177)
                                                  ├── Phase 105: Prompt Budget & Assembly
                                                  ├── Phase 106: Prompt Growth & Dedup
                                                  ├── Phase 107: Classification Fixes
                                                  ├── Phase 108: Worker & Exploration Cleanup
                                                  ├── Phase 109: Monorepo Awareness
                                                  ├── Phase 110: God-Class Refactoring
                                                  ├── Phase 111: Documentation Sync
                                                  ├── Phase 112: Process & Timer Safety
                                                  ├── Phase 113: Memory Leak Fixes
                                                  ├── Phase 114: Data Safety & Error Visibility
                                                  └── Phase 115: Test Suite Regression Fixes
                                                        │
                                                        │  ── v0.1.0: Business Platform ──
                                                        │
                                                        └──► ✅ v0.1.0: 173 tasks, 6 findings (OB-F178–F191)
                                                             ├── Phase 116: Document Intelligence Layer
                                                             ├── Phase 117: DocType Engine — Schema & Storage
                                                             ├── Phase 118: DocType Engine — Lifecycle & Hooks
                                                             ├── Phase 119: Integration Hub — Core & Credentials
                                                             ├── Phase 120: Integration Hub — Adapters
                                                             ├── Phase 121: Workflow Engine
                                                             ├── Phase 122: Business Document Generation
                                                             ├── Phase 123: Universal API Adapter
                                                             ├── Phase 124: Industry Templates
                                                             ├── Phase 125: Self-Improvement & Skill Learning
                                                             ├── Phase 126: Skill Packs (Cloud, Deploy, Spreadsheet, Convert)
                                                             └── Phase 127: Worker Permissions & Agent SDK
                                                                   │
                                                                   │  ── v0.1.0: Real-World Hardening ──
                                                                   │
                                                                   └──► ✅ Phases 128–169: 167 tasks, 37 findings
                                                                        ├── Phases 128–132: Workspace map, prompt budget, cost caps, classification
                                                                        ├── Phases 133–151: Model budgets, trust system, workspace boundaries
                                                                        └── Phases 152–169: Escalation, DLQ, message queueing, headless safety
```

---

## Version Milestones

| Version     | Status | Key Features                                                                                                                                   | Tasks |
| ----------- | ------ | ---------------------------------------------------------------------------------------------------------------------------------------------- | ----- |
| **v0.0.1**  | Done   | Foundation — 5 connectors, self-governing Master, AI discovery, memory system                                                                  | 310   |
| **v0.0.2**  | Done   | Exploration progress, worker resilience, worker control, responsive Master                                                                     | 42    |
| **v0.0.3**  | Done   | Prompt library, memory.md, history, schema versioning, streaming, checkpointing                                                                | 50    |
| **v0.0.4**  | Done   | Codex provider + adapter fixes, MCP integration (config, isolation, health)                                                                    | 41    |
| **v0.0.5**  | Done   | FTS5 sanitization, memory.md context injection, graceful shutdown                                                                              | 21    |
| **v0.0.6**  | Done   | WhatsApp/Telegram media, MCP dashboard fixes                                                                                                   | 14    |
| **v0.0.7**  | Done   | Telegram/Discord message splitting, live context fixes                                                                                         | 18    |
| **v0.0.8**  | Done   | Voice transcription API, enhanced CLI wizard                                                                                                   | 95    |
| **v0.0.9**  | Done   | Classification fixes, code-audit profile, exploration bugs, data cleanup                                                                       | 34    |
| **v0.0.10** | Done   | RAG knowledge retrieval, env var protection                                                                                                    | 43    |
| **v0.0.11** | Done   | Master output sharing, user consent                                                                                                            | 20    |
| **v0.0.12** | Done   | Deep Mode, WebChat, tunnel, Docker, escalation, batch, runtime fixes                                                                           | 281   |
| **v0.0.13** | Done   | Structured observations, session compaction, role UX, document gen, vector search                                                              | 126   |
| **v0.0.14** | Done   | Skill pack extensions, design/creative output, agent orchestration patterns                                                                    | 50    |
| **v0.0.15** | Done   | Deep stability audit — prompt budget, classification, god-class refactoring, memory leaks, process safety                                      | 93    |
| **v0.1.0**  | Done   | Business platform — document intelligence, DocType engine, integration hub, workflow engine, model budgets, trust system, real-world hardening | 340   |

**Total shipped: 1672 tasks across 169 phases.**

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
