# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- **AI Tool Discovery** — auto-detects AI CLI tools (Claude Code, Codex, Aider, Cursor, Cody) and VS Code extensions (Copilot, Cody, Continue) installed on the machine. Zero API keys needed
- **Master AI Manager** — autonomous agent lifecycle (idle → exploring → ready), background workspace exploration, message routing, status queries
- **Incremental 5-pass exploration** — structure scan, classification, directory dives, assembly, finalization. Each pass checkpointed to disk, resumable on restart. Never times out
- **`.openbridge/` folder** — the AI's brain inside the target project. Git-tracked knowledge including workspace-map.json, agents.json, exploration state, and task history
- **Session continuity** — multi-turn conversations via `--session-id`/`--resume` with 30-minute TTL per sender
- **Multi-AI delegation** — Master can assign subtasks to other discovered AI tools, with task tracking and git commits
- **V2 config format** — simplified to 3 fields: `workspacePath`, `channels`, `auth`. V0 format auto-detected and supported for backward compatibility
- **Console connector** — reference implementation for rapid testing without WhatsApp QR dependency
- **Exploration result parser** — robust JSON extraction from AI output with progressive fallbacks (direct parse → markdown fence → regex → retry)
- **Exploration prompts** — focused prompt generators for each of the 5 exploration passes
- **Status command** — shows per-phase exploration progress, directory dive counts, AI call metrics, estimated completion
- **Resilient startup** — reuses valid `.openbridge/` state, resumes incomplete exploration, re-explores if workspace-map.json is missing or corrupted
- **CLI init** — simplified to 3 questions (workspace path, phone whitelist, prefix)
- **Config watcher** — hot-reload config changes without restart
- **Health check endpoint** — system health monitoring
- **Metrics collection** — operational metrics tracking
- **Audit logger** — audit trail for message processing
- **Rate limiter** — per-user rate limiting
- **Testing guide** — comprehensive documentation for Console-based preprod testing workflow
- **E2E test suites** — full V2 flow, non-code workspaces (cafe business scenario), graceful unknown handling, console preprod, prefix stripping

### Changed

- **Documentation rewrite** — README, OVERVIEW, ARCHITECTURE, CONFIGURATION, and CLAUDE.md files rewritten for autonomous AI vision
- **Router** — added Master AI routing path with priority over direct provider
- **Bridge** — integrated Master AI lifecycle (discovery → exploration → ready)
- **CLI executor** — generalized from Claude-only to support any AI tool CLI
- **Config loader** — auto-detects V2 vs V0 format, converts internally

### Removed

- **Old knowledge layer** — workspace-scanner, api-executor, tool-catalog, tool-executor (archived to `src/_archived/knowledge/`)
- **Old orchestrator** — script-coordinator, task-agent-runtime (archived to `src/_archived/orchestrator/`)
- **Old core modules** — workspace-manager, map-loader (archived to `src/_archived/core/`)
- **WORKSPACE_MAP_SPEC.md** — no longer relevant (AI generates its own maps)

### Fixed

- `tsx watch` killing process on file changes — switched to `tsx` without watch for AI execution safety
- No graceful shutdown guard — added process tracking
- CLI executor hardcoded to `claude` — generalized for any AI tool

## [0.1.0] — 2026-02-19

### Added

- Initial project scaffolding
- Plugin architecture with Connector and AIProvider interfaces
- Bridge core: router, auth (whitelist), message queue, config loader, plugin registry
- WhatsApp connector (V0) via whatsapp-web.js
- Claude Code AI provider (V0) via CLI
- Zod-based configuration validation
- ESLint + Prettier + Husky + commitlint tooling
- CI workflow with GitHub Actions
- Community docs (README, CONTRIBUTING, CODE_OF_CONDUCT, SECURITY)
