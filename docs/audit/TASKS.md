# OpenBridge — Task List

> **Pending:** 22 tasks across 9 phases | **Next up:** Phase 6
> **Last Updated:** 2026-02-20
> **Completed work:** [V0 archive (Phases 1–5)](archive/v0/TASKS-v0.md)

---

## Vision

OpenBridge is an **autonomous AI bridge**. It connects messaging channels to AI agents that **explore your workspace, discover your project structure, and execute tasks** — all using the AI tools already installed on your machine (zero API keys, zero extra cost).

The user configures three things: **workspace path**, **messaging channel**, **phone whitelist**. OpenBridge does the rest — discovers available AI tools, picks a Master, explores the workspace silently, and waits for instructions.

**Key principles:**

- **Zero config AI** — auto-discovers Claude Code, Codex, Aider, etc. on the machine
- **Master AI explores autonomously** — no user-defined map files, the AI figures it out
- **Silent worker** — only speaks when spoken to
- **`.openbridge/` is the AI's brain** — everything it learns lives in the target project
- **Multi-AI delegation** — Master can assign tasks to other discovered AI tools

---

## Roadmap

| Phase | Focus                             | Tasks | Status |
| :---: | --------------------------------- | :---: | :----: |
|   6   | AI tool discovery                 |   4   |   ◻    |
|   7   | Master AI + `.openbridge/` folder |   6   |   ◻    |
|   8   | V2 config + routing + CLI         |   7   |   ◻    |
|   9   | Archive dead code + clean up      |   3   |   ◻    |
|  10   | Multi-AI delegation               |   4   |   ◻    |
|  11   | Status + interaction              |   3   |   ◻    |
|  12   | Documentation rewrite             |   6   |   ◻    |
|  13   | Testing + verification            |   4   |   ◻    |
|  14   | Future: channels + views          |   4   |   ◻    |

---

## Phase 6 — AI Tool Discovery

> **Focus:** On startup, auto-discover AI CLI tools installed on the machine. No API keys needed — use what's already there.

| #   | Task                                                                                                                                                                                         | ID     | Priority |  Status   |
| --- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ | :------: | :-------: |
| 41  | Create discovery types (`src/types/discovery.ts`) — Zod schemas for `DiscoveredTool` (name, path, version, capabilities, role, available) and `ScanResult`                                   | OB-071 | 🟠 High  | ◻ Pending |
| 42  | Create CLI tool scanner (`src/discovery/tool-scanner.ts`) — scan with `which` for known AI tools (claude, codex, aider, cursor, cody), capture path + version, rank by priority, pick Master | OB-072 | 🟠 High  | ◻ Pending |
| 43  | Create VS Code extension scanner (`src/discovery/vscode-scanner.ts`) — scan `~/.vscode/extensions/` for AI extensions (Copilot, Cody, Continue), return metadata                             | OB-073 |  🟡 Med  | ◻ Pending |
| 44  | Create discovery module index (`src/discovery/index.ts`) — export `scanForAITools()` combining CLI + VS Code scans                                                                           | OB-074 |  🟡 Med  | ◻ Pending |

**New files:** `src/types/discovery.ts`, `src/discovery/tool-scanner.ts`, `src/discovery/vscode-scanner.ts`, `src/discovery/index.ts`

---

## Phase 7 — Master AI + `.openbridge/` Folder

> **Focus:** Create the Master AI manager that silently explores the workspace on startup and stores its knowledge in `.openbridge/` inside the target project.

| #   | Task                                                                                                                                                                                     | ID     | Priority |  Status   |
| --- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ | :------: | :-------: |
| 45  | Create Master types (`src/types/master.ts`) — Zod schemas for `MasterState`, `ExplorationSummary`, `TaskRecord`                                                                          | OB-075 | 🟠 High  | ◻ Pending |
| 46  | Create `.openbridge/` folder manager (`src/master/dotfolder-manager.ts`) — create folder, init git repo, commit changes, read/write map, write agents.json, append log, record tasks     | OB-076 | 🟠 High  | ◻ Pending |
| 47  | Create exploration prompt (`src/master/exploration-prompt.ts`) — system prompt instructing Master to explore workspace, create `.openbridge/workspace-map.json`, init git, work silently | OB-077 | 🟠 High  | ◻ Pending |
| 48  | Create Master AI Manager (`src/master/master-manager.ts`) — lifecycle management (idle → exploring → ready), background exploration, message routing, status queries                     | OB-078 | 🟠 High  | ◻ Pending |
| 49  | Create Master module index (`src/master/index.ts`) — export MasterManager, DotFolderManager                                                                                              | OB-079 |  🟡 Med  | ◻ Pending |
| 50  | Write Master AI tests (`tests/master/`) — dotfolder-manager, master-manager, exploration prompt                                                                                          | OB-080 |  🟡 Med  | ◻ Pending |

**Key design:** The Master AI IS the explorer. We send it a prompt ("explore this workspace silently") and let it do the work. We don't write framework detectors — the AI figures it out.

**`.openbridge/` folder structure:**

```
.openbridge/
├── .git/                ← local tracking repo (Master's changes)
├── workspace-map.json   ← auto-generated project understanding
├── exploration.log      ← timestamped scan history
├── agents.json          ← discovered AI tools + roles
└── tasks/               ← task history (one JSON per task)
```

---

## Phase 8 — V2 Config + Routing + CLI

> **Focus:** Simplify config to 3 fields, wire Master into the routing pipeline, update CLI init.

| #   | Task                                                                                                                                                              | ID     | Priority |  Status   |
| --- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ | :------: | :-------: |
| 51  | Add V2 config schema to `src/types/config.ts` — `workspacePath` + `channels` + `auth` only. No providers, no workspaces array. Keep V0 schema for backward compat | OB-081 | 🟠 High  | ◻ Pending |
| 52  | Update config loader `src/core/config.ts` — try V2 schema first, fall back to V0. Add `isV2Config()` type guard and `convertV2ToInternal()` helper                | OB-082 | 🟠 High  | ◻ Pending |
| 53  | Add Master routing to Router `src/core/router.ts` — add `setMaster()` method, route through Master when set (priority over orchestrator/direct provider)          | OB-083 | 🟠 High  | ◻ Pending |
| 54  | Add Master support to Bridge `src/core/bridge.ts` — add `setMaster()`, wire into router, call `master.shutdown()` on stop. Remove dead workspace-manager imports  | OB-084 | 🟠 High  | ◻ Pending |
| 55  | Update entry point `src/index.ts` — V2 flow: load config → discover tools → create bridge → start → launch Master → explore. Keep V0 flow for old config          | OB-085 | 🟠 High  | ◻ Pending |
| 56  | Simplify CLI init `src/cli/init.ts` — reduce to 3 questions (workspace path, phone whitelist, prefix). Generate V2 config format                                  | OB-086 |  🟡 Med  | ◻ Pending |
| 57  | Update `config.example.json` — replace with V2 format                                                                                                             | OB-087 |  🟡 Med  | ◻ Pending |

---

## Phase 9 — Archive Dead Code

> **Focus:** Move code from the old vision (user-defined maps, manual orchestrator) to `src/_archived/`. Don't delete — preserve git history.

| #   | Task                                                                                                                                             | ID     | Priority |  Status   |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------ | ------ | :------: | :-------: |
| 58  | Move old knowledge layer to `src/_archived/knowledge/` — workspace-scanner.ts, api-executor.ts, tool-catalog.ts, tool-executor.ts                | OB-088 |  🟡 Med  | ◻ Pending |
| 59  | Move old orchestrator to `src/_archived/orchestrator/` — script-coordinator.ts, task-agent-runtime.ts. Move old types: workspace-map.ts, tool.ts | OB-089 |  🟡 Med  | ◻ Pending |
| 60  | Move workspace-manager.ts + map-loader.ts to `src/_archived/core/`. Clean all imports. Archive corresponding tests                               | OB-090 |  🟡 Med  | ◻ Pending |

---

## Phase 10 — Multi-AI Delegation

> **Focus:** Master can delegate tasks to other discovered AI tools. Each delegation spawns a subprocess using the generalized executor.

| #   | Task                                                                                                                                                      | ID     | Priority |  Status   |
| --- | --------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ | :------: | :-------: |
| 61  | Create delegation coordinator (`src/master/delegation.ts`) — manage task delegation to non-master AI tools, track active delegations, handle timeouts     | OB-091 | 🟠 High  | ◻ Pending |
| 62  | Integrate delegation into Master Manager — parse delegation markers from Master output, delegate to appropriate tool, feed results back to Master session | OB-092 | 🟠 High  | ◻ Pending |
| 63  | Add task tracking to dotfolder-manager — record each task with id, description, delegatedTo, status, result, timestamps. Commit to `.openbridge/.git`     | OB-093 |  🟡 Med  | ◻ Pending |
| 64  | Write delegation tests — delegation flow, timeout handling, multi-tool coordination                                                                       | OB-094 |  🟡 Med  | ◻ Pending |

---

## Phase 11 — Status + Interaction

> **Focus:** User can ask about exploration progress and system status via WhatsApp.

| #   | Task                                                                                                                                              | ID     | Priority |  Status   |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------- | ------ | :------: | :-------: |
| 65  | Add status command handler to Master Manager — intercept "status"/"progress" keywords, return exploration state + active tasks from local state   | OB-095 |  🟡 Med  | ◻ Pending |
| 66  | Add exploration progress tracking — track milestones (started → scanning → analyzing → map generated → git initialized → complete), report on ask | OB-096 |  🟡 Med  | ◻ Pending |
| 67  | Session continuity — Master uses `--resume` flag for conversation context across messages, multi-turn conversations about the project             | OB-097 |  🟡 Med  | ◻ Pending |

---

## Phase 12 — Documentation Rewrite

> **Focus:** Rewrite all docs to reflect the new autonomous AI vision. Remove all references to user-defined map files and old architecture.

| #   | Task                                                                                                                                                   | ID     | Priority |  Status   |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------ | ------ | :------: | :-------: |
| 68  | Rewrite OVERVIEW.md — new vision (autonomous AI bridge), use cases (project exploration, task execution, multi-AI delegation), new architecture layers | OB-098 | 🟠 High  | ◻ Pending |
| 69  | Rewrite README.md — new positioning, updated quick start (3-step setup), real examples showing AI discovery + exploration                              | OB-099 | 🟠 High  | ◻ Pending |
| 70  | Rewrite ARCHITECTURE.md — new layers (channels, core, discovery, master AI, delegation), message flow with Master, `.openbridge/` folder spec          | OB-100 | 🟠 High  | ◻ Pending |
| 71  | Simplify CONFIGURATION.md — V2 config (3 fields), remove workspace maps section, remove provider config, add discovery overrides                       | OB-101 |  🟡 Med  | ◻ Pending |
| 72  | Update both CLAUDE.md files — reflect new architecture, new module list, new file structure                                                            | OB-102 |  🟡 Med  | ◻ Pending |
| 73  | Delete WORKSPACE_MAP_SPEC.md — no longer relevant (AI generates its own maps)                                                                          | OB-103 |  🟢 Low  | ◻ Pending |

---

## Phase 13 — Testing + Verification

> **Focus:** Ensure everything compiles, passes tests, and works end-to-end.

| #   | Task                                                                                                                                 | ID     | Priority |  Status   |
| --- | ------------------------------------------------------------------------------------------------------------------------------------ | ------ | :------: | :-------: |
| 74  | Run `npm run typecheck` — ensure no TypeScript errors after all changes                                                              | OB-104 | 🟠 High  | ◻ Pending |
| 75  | Run `npm run lint` — fix any ESLint issues                                                                                           | OB-105 | 🟠 High  | ◻ Pending |
| 76  | Run `npm run test` — update broken tests, add new tests for discovery + master modules                                               | OB-106 | 🟠 High  | ◻ Pending |
| 77  | Full E2E verification — start OpenBridge, discover tools, explore workspace, send WhatsApp message, get response, check .openbridge/ | OB-107 | 🟠 High  | ◻ Pending |

---

## Phase 14 — Future: Channels + Views (Post-MVP)

> **Focus:** More messaging platforms and rich output capabilities. Not blocking MVP.

| #   | Task                                                                                             | ID     | Priority |  Status   |
| --- | ------------------------------------------------------------------------------------------------ | ------ | :------: | :-------: |
| 78  | Telegram connector — Bot API via grammY, supports DM + group                                     | OB-108 |  🟡 Med  | ◻ Pending |
| 79  | Discord connector — discord.js, supports DM + server channels                                    | OB-109 |  🟢 Low  | ◻ Pending |
| 80  | Web chat connector — browser-based chat widget                                                   | OB-110 |  🟢 Low  | ◻ Pending |
| 81  | Interactive AI views — AI generates reports/dashboards served on local HTTP, links sent via chat | OB-111 |  🟢 Low  | ◻ Pending |

---

## MVP Milestone

**Phases 6–9** = shippable MVP:

- AI tool auto-discovery (zero API keys)
- Master AI autonomous workspace exploration
- `.openbridge/` folder with git tracking
- V2 config (3 fields only)
- Master routing through WhatsApp
- Dead code archived cleanly

**Phases 10–11** = post-MVP. **Phase 12** = docs. **Phase 13** = testing. **Phase 14** = future.

---

## Implementation Order

```
Phase 6  → Discovery module (foundation for everything)
Phase 7  → Master AI + .openbridge/ (core new feature)
Phase 8  → V2 config + routing + CLI (wire it all together)
Phase 9  → Archive dead code (clean house)
Phase 10 → Multi-AI delegation (power feature)
Phase 11 → Status + interaction (UX polish)
Phase 12 → Documentation rewrite (tell the story)
Phase 13 → Testing + verification (ship it)
Phase 14 → Future channels + views (growth)
```

---

## Status Legend

|     Status     | Meaning                   |
| :------------: | ------------------------- |
|   ◻ Pending    | Not started               |
| 🔄 In Progress | Currently being worked on |
|    ✅ Done     | Completed and verified    |
