# OpenBridge — Future Work

> **Purpose:** Deferred finalization items and backlog for future versions.
> **Last Updated:** 2026-03-07 | **Current Release:** v0.0.14 (1239 tasks shipped, 143 findings fixed)
> **0 open findings.** All Sprint 5 + Sprint 6 tasks complete. See [FINDINGS.md](FINDINGS.md) for details.

---

## Completed Development Track (v0.0.1 → v0.0.14)

All planned sprints through v0.0.14 are complete:

| Sprint    | Version  | Tasks    | Phases                    | Status     |
| --------- | -------- | -------- | ------------------------- | ---------- |
| —         | v0.0.1–8 | 652      | 1–73                      | ✅ Shipped |
| 1         | v0.0.9   | 34       | 78a–80                    | ✅ Shipped |
| 2         | v0.0.10  | 43       | 74–77, 85                 | ✅ Shipped |
| 3         | v0.0.11  | 20       | 81, 86                    | ✅ Shipped |
| 4         | v0.0.12  | 281      | RWT, Deep, 82–104, Docker | ✅ Shipped |
| Pre-5     | Phase 97 | 18       | 97                        | ✅ Shipped |
| 5         | v0.0.13  | 126      | 93, 94, 95, 96a-d, 99     | ✅ Shipped |
| 6         | v0.0.14  | 50       | 98, 100, 101              | ✅ Shipped |
| **Total** |          | **1239** |                           |            |

All task archives: [docs/audit/archive/](archive/) (v0–v23).

---

## Completed Phase Summary

### Phase 97 — Data Integrity Fixes (18 tasks, 7 findings) ✅

Archived in [v22](archive/v22/TASKS-v22-phase97-data-integrity.md).

### Sprint 5 — Smarter AI + Business Output (v0.0.13, 126 tasks, 12 findings) ✅

Archived in [v23](archive/v23/TASKS-v23-sprint5-sprint6-phases-93-101.md).

| Phase | Focus                                      | Tasks |
| ----- | ------------------------------------------ | ----- |
| 93    | Structured Observations & Worker Summaries | 27    |
| 95    | Session Compaction & Token Economics       | 18    |
| 96d   | Channel Role Management UX                 | 12    |
| 99    | Document Generation Skills                 | 18    |
| 94    | Vector Search & Hybrid Retrieval           | 21    |
| 96a   | `openbridge doctor`                        | 10    |
| 96b   | Pairing-Based Auth                         | 10    |
| 96c   | Skills Directory                           | 10    |

### Sprint 6 — Skill System, Agent Patterns & Creative Output (v0.0.14, 50 tasks, 6 findings) ✅

Archived in [v23](archive/v23/TASKS-v23-sprint5-sprint6-phases-93-101.md).

| Phase | Focus                        | Tasks |
| ----- | ---------------------------- | ----- |
| 98    | Skill Pack System Extensions | 17    |
| 100   | Design & Creative Output     | 14    |
| 101   | Agent Orchestration Patterns | 19    |

---

## Security Boundary Summary (v0.0.14 — Current State)

| Boundary             | Status                                                                |
| -------------------- | --------------------------------------------------------------------- |
| Workspace boundary   | `cwd` in spawn — AI is workspace-scoped                               |
| Tool restriction     | `--allowedTools` + profiles (read-only, code-edit, code-audit, full)  |
| Runtime escalation   | Users grant/deny tool upgrades via `/allow`/`/deny`                   |
| Phone whitelist      | Exact match + pairing-based auth                                      |
| Daily budget         | Checked at message start + per-worker cost caps                       |
| Batch safety         | Iteration limit + cost budget + time limit                            |
| Env var sanitization | Default deny-list (AWS/GH/TOKEN/SECRET/DB/...)                        |
| File visibility      | Include/exclude rules + auto-detect secrets                           |
| Content redaction    | Optional pattern-based redaction                                      |
| User consent         | Risk classification + confirmation for high-risk                      |
| Audit visibility     | Pino logs + `/audit` command + `.openbridge/audit/`                   |
| OS-level sandbox     | Docker containers for workers                                         |
| WebChat auth         | Token + password auth, sessions, rate limiting                        |
| Deep analysis        | Multi-phase Deep Mode: investigate → report → plan → execute → verify |
| Worker lifecycle     | Watchdog timer + state audit + `/workers` command                     |
| Planning gate        | Read-only analysis before code-edit execution                         |
| Test protection      | Workers cannot modify test files unless explicitly authorized         |
| Iteration caps       | Max 3 fix attempts before escalating to Master                        |

---

## Deferred — Post v0.0.14

### Finalization Required (Phases 72–73 + MCP UI)

These features were scaffolded/built but have bugs and build issues. Not needed for the current development track (Console/WhatsApp/Telegram/WebChat channels work fine). **Desktop apps (Windows/macOS/App Store) remain a separate effort.**

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
