# OpenBridge — Archived Tasks (V1)

> **Archived:** 2026-02-21
> **Covers:** Phases 6–10 (completed)
> **Total tasks archived:** 24 (4 + 6 + 7 + 3 + 4)

---

## Phase 6 — AI Tool Discovery (COMPLETED)

> **Focus:** On startup, auto-discover AI CLI tools installed on the machine. No API keys needed — use what's already there.

| #   | Task                                                                                                                                                                                         | ID     | Priority | Status  |
| --- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ | :------: | :-----: |
| 41  | Create discovery types (`src/types/discovery.ts`) — Zod schemas for `DiscoveredTool` (name, path, version, capabilities, role, available) and `ScanResult`                                   | OB-071 | 🟠 High  | ✅ Done |
| 42  | Create CLI tool scanner (`src/discovery/tool-scanner.ts`) — scan with `which` for known AI tools (claude, codex, aider, cursor, cody), capture path + version, rank by priority, pick Master | OB-072 | 🟠 High  | ✅ Done |
| 43  | Create VS Code extension scanner (`src/discovery/vscode-scanner.ts`) — scan `~/.vscode/extensions/` for AI extensions (Copilot, Cody, Continue), return metadata                             | OB-073 |  🟡 Med  | ✅ Done |
| 44  | Create discovery module index (`src/discovery/index.ts`) — export `scanForAITools()` combining CLI + VS Code scans                                                                           | OB-074 |  🟡 Med  | ✅ Done |

**New files:** `src/types/discovery.ts`, `src/discovery/tool-scanner.ts`, `src/discovery/vscode-scanner.ts`, `src/discovery/index.ts`

---

## Phase 7 — Master AI + `.openbridge/` Folder (COMPLETED)

> **Focus:** Create the Master AI manager that silently explores the workspace on startup and stores its knowledge in `.openbridge/` inside the target project.

| #   | Task                                                                                                                                                                                                                                                                                                    | ID     | Priority | Status  |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ | :------: | :-----: |
| 45  | Create Master types (`src/types/master.ts`) — Zod schemas for `MasterState`, `ExplorationSummary`, `TaskRecord`                                                                                                                                                                                         | OB-075 | 🟠 High  | ✅ Done |
| 46  | Create `.openbridge/` folder manager (`src/master/dotfolder-manager.ts`) — create folder, init git repo, commit changes, read/write map, write agents.json, append log, record tasks                                                                                                                    | OB-076 | 🟠 High  | ✅ Done |
| 47  | Create exploration prompt (`src/master/exploration-prompt.ts`) — system prompt instructing Master to explore workspace, create `.openbridge/workspace-map.json`, init git, work silently. Include adaptive response style: concise + non-technical for business workspaces, technical for code projects | OB-077 | 🟠 High  | ✅ Done |
| 48  | Create Master AI Manager (`src/master/master-manager.ts`) — lifecycle management (idle → exploring → ready), background exploration, message routing, status queries                                                                                                                                    | OB-078 | 🟠 High  | ✅ Done |
| 49  | Create Master module index (`src/master/index.ts`) — export MasterManager, DotFolderManager                                                                                                                                                                                                             | OB-079 |  🟡 Med  | ✅ Done |
| 50  | Write Master AI tests (`tests/master/`) — dotfolder-manager, master-manager, exploration prompt                                                                                                                                                                                                         | OB-080 |  🟡 Med  | ✅ Done |

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

## Phase 8 — V2 Config + Routing + CLI (COMPLETED)

> **Focus:** Simplify config to 3 fields, wire Master into the routing pipeline, update CLI init.

| #   | Task                                                                                                                                                              | ID     | Priority | Status  |
| --- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ | :------: | :-----: |
| 51  | Add V2 config schema to `src/types/config.ts` — `workspacePath` + `channels` + `auth` only. No providers, no workspaces array. Keep V0 schema for backward compat | OB-081 | 🟠 High  | ✅ Done |
| 52  | Update config loader `src/core/config.ts` — try V2 schema first, fall back to V0. Add `isV2Config()` type guard and `convertV2ToInternal()` helper                | OB-082 | 🟠 High  | ✅ Done |
| 53  | Add Master routing to Router `src/core/router.ts` — add `setMaster()` method, route through Master when set (priority over orchestrator/direct provider)          | OB-083 | 🟠 High  | ✅ Done |
| 54  | Add Master support to Bridge `src/core/bridge.ts` — add `setMaster()`, wire into router, call `master.shutdown()` on stop. Remove dead workspace-manager imports  | OB-084 | 🟠 High  | ✅ Done |
| 55  | Update entry point `src/index.ts` — V2 flow: load config → discover tools → create bridge → start → launch Master → explore. Keep V0 flow for old config          | OB-085 | 🟠 High  | ✅ Done |
| 56  | Simplify CLI init `src/cli/init.ts` — reduce to 3 questions (workspace path, phone whitelist, prefix). Generate V2 config format                                  | OB-086 |  🟡 Med  | ✅ Done |
| 57  | Update `config.example.json` — replace with V2 format                                                                                                             | OB-087 |  🟡 Med  | ✅ Done |

---

## Phase 9 — Archive Dead Code (COMPLETED)

> **Focus:** Move code from the old vision (user-defined maps, manual orchestrator) to `src/_archived/`. Don't delete — preserve git history.

| #   | Task                                                                                                                                             | ID     | Priority | Status  |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------ | ------ | :------: | :-----: |
| 58  | Move old knowledge layer to `src/_archived/knowledge/` — workspace-scanner.ts, api-executor.ts, tool-catalog.ts, tool-executor.ts                | OB-088 |  🟡 Med  | ✅ Done |
| 59  | Move old orchestrator to `src/_archived/orchestrator/` — script-coordinator.ts, task-agent-runtime.ts. Move old types: workspace-map.ts, tool.ts | OB-089 |  🟡 Med  | ✅ Done |
| 60  | Move workspace-manager.ts + map-loader.ts to `src/_archived/core/`. Clean all imports. Archive corresponding tests                               | OB-090 |  🟡 Med  | ✅ Done |

---

## Phase 10 — Multi-AI Delegation (COMPLETED)

> **Focus:** Master can delegate tasks to other discovered AI tools. Each delegation spawns a subprocess using the generalized executor.

| #   | Task                                                                                                                                                      | ID     | Priority | Status  |
| --- | --------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ | :------: | :-----: |
| 61  | Create delegation coordinator (`src/master/delegation.ts`) — manage task delegation to non-master AI tools, track active delegations, handle timeouts     | OB-091 | 🟠 High  | ✅ Done |
| 62  | Integrate delegation into Master Manager — parse delegation markers from Master output, delegate to appropriate tool, feed results back to Master session | OB-092 | 🟠 High  | ✅ Done |
| 63  | Add task tracking to dotfolder-manager — record each task with id, description, delegatedTo, status, result, timestamps. Commit to `.openbridge/.git`     | OB-093 |  🟡 Med  | ✅ Done |
| 64  | Write delegation tests — delegation flow, timeout handling, multi-tool coordination                                                                       | OB-094 |  🟡 Med  | ✅ Done |

**Note:** Task 64 was originally marked as pending but delegation tests were completed as part of the phase wrap-up.
