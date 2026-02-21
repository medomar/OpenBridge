# OpenBridge — Task List

> **Pending:** 15 tasks across 5 phases | **Next up:** Phase 13
> **Last Updated:** 2026-02-21
> **Completed work:** [V0 archive (Phases 1–5)](archive/v0/TASKS-v0.md) | [V1 archive (Phases 6–10)](archive/v1/TASKS-v1.md)

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
- **Incremental exploration** — workspace is explored in short passes with checkpointing (never timeout)

---

## Roadmap

| Phase | Focus                             | Done | Pending | Status |
| :---: | --------------------------------- | :--: | :-----: | :----: |
| 6–10  | Discovery, Master, V2, Delegation |  24  |    0    |   ✅   |
|  11   | Incremental exploration           |  8   |    0    |   ✅   |
|  12   | Status + interaction              |  4   |    0    |   ✅   |
|  13   | Documentation rewrite             |  3   |    3    |   ◻    |
|  14   | Testing + verification            |  0   |    8    |   ◻    |
|  15   | Future: channels + views          |  0   |    4    |   ◻    |

---

## Phase 11 — Incremental Multi-Pass Exploration

> **Focus:** Replace the monolithic single-call exploration (which times out on real projects) with a 5-pass incremental strategy. Each pass is short (30-90s), checkpointed to disk, and resumable on restart.

### Problem

The current exploration sends one giant prompt asking Claude to scan the entire workspace, classify it, generate workspace-map.json, init git, and commit — all in a single AI call. Real projects consistently **timeout** (exit code 143) because the AI can't finish everything in 10 minutes. If it gets 80% done then times out, all work is lost.

### Solution

Split exploration into **5 short passes**, checkpoint after each pass, and assemble the final `workspace-map.json` from partial results. If interrupted at any point, resume from the last checkpoint.

### The 5 Passes

| Pass | Name            | Timeout | AI? | Description                                                                                                             |
| ---- | --------------- | ------- | --- | ----------------------------------------------------------------------------------------------------------------------- |
| 1    | Structure Scan  | 90s     | Yes | List top-level files/dirs, count files per directory, detect config files. Skip node_modules/.git/dist                  |
| 2    | Classification  | 90s     | Yes | Read config files from Pass 1 → detect project type, frameworks, commands, dependencies                                 |
| 3    | Directory Dives | 90s/dir | Yes | For each significant directory, explore contents (purpose, key files, subdirs). Batches of 3 via `Promise.allSettled()` |
| 4    | Assembly        | 60s     | Yes | Merge partial results into `workspace-map.json`, one AI call for human-readable `summary` field                         |
| 5    | Finalization    | —       | No  | Create `agents.json`, git commit, write log entry (pure code, no AI call)                                               |

### New `.openbridge/` Layout

```
.openbridge/
  exploration/              ← NEW: intermediate state
    exploration-state.json  ← tracks which passes are done (single source of truth for resumability)
    structure-scan.json     ← Pass 1 output
    classification.json     ← Pass 2 output
    dirs/                   ← Pass 3 outputs (one per directory)
      src.json
      tests.json
      docs.json
  workspace-map.json        ← Final assembled map (Pass 4)
  agents.json               ← Pass 5
  exploration.log
  tasks/
  .git/
```

### Tasks

| #   | Task                                                                                                                                                                                                                                                                                                                                                                                   | ID     | Priority | Status  |
| --- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ | :------: | :-----: |
| 65  | Add Zod schemas to `src/types/master.ts` — `ExplorationPhaseSchema`, `ExplorationStateSchema`, `StructureScanSchema`, `ClassificationSchema`, `DirectoryDiveStatusSchema`, `DirectoryDiveResultSchema`                                                                                                                                                                                 | OB-095 | 🟠 High  | ✅ Done |
| 66  | Extend `DotFolderManager` (`src/master/dotfolder-manager.ts`) with exploration state CRUD — `createExplorationDir()`, `readExplorationState()`/`writeExplorationState()`, `readStructureScan()`/`writeStructureScan()`, `readClassification()`/`writeClassification()`, `readDirectoryDive()`/`writeDirectoryDive()`                                                                   | OB-096 | 🟠 High  | ✅ Done |
| 67  | Create `src/master/result-parser.ts` — robust JSON extraction from AI output with progressive fallbacks: direct `JSON.parse()` → markdown fence extraction → regex for first `{...}` block → parse error (retry up to 3 times)                                                                                                                                                         | OB-097 | 🟠 High  | ✅ Done |
| 68  | Create `src/master/exploration-prompts.ts` — 4 focused prompt generators: `generateStructureScanPrompt(workspacePath)`, `generateClassificationPrompt(workspacePath, structureScan)`, `generateDirectoryDivePrompt(workspacePath, dirPath, context)`, `generateSummaryPrompt(workspacePath, partialMap)`. Each prompt ~25-40 lines, returns JSON matching the corresponding Zod schema | OB-098 | 🟠 High  | ✅ Done |
| 69  | Create `src/master/exploration-coordinator.ts` — main orchestrator: sequential 5-phase flow with `explore()` entry point that loads/creates `exploration-state.json`, skips completed phases, runs each pass via `executeClaudeCode()`, parses results with `result-parser.ts`, checkpoints after each pass via `DotFolderManager`                                                     | OB-099 | 🟠 High  | ✅ Done |
| 70  | Refactor `MasterManager.explore()` (`src/master/master-manager.ts`) — replace monolithic `executeClaudeCode()` call with delegation to `ExplorationCoordinator.explore()`, remove old exploration prompt import, update state transitions to track incremental progress                                                                                                                | OB-100 | 🟠 High  | ✅ Done |
| 71  | Update exports in `src/master/index.ts` — export `ExplorationCoordinator`, `parseAIResult` from result-parser, exploration prompt generators                                                                                                                                                                                                                                           | OB-101 |  🟡 Med  | ✅ Done |
| 72  | Write tests — `ExplorationCoordinator` (phase flow, checkpointing, resume from partial state), `result-parser` (clean JSON, markdown fences, malformed output), prompt generators (output structure), `DotFolderManager` exploration CRUD                                                                                                                                              | OB-102 |  🟡 Med  | ✅ Done |

### Key Design Details

**Resumability:** `exploration-state.json` is the single source of truth. On restart, `ExplorationCoordinator.explore()` loads this file and skips completed phases.

```json
{
  "currentPhase": "directory_dives",
  "status": "in_progress",
  "startedAt": "2026-02-21T...",
  "phases": {
    "structure_scan": "completed",
    "classification": "completed",
    "directory_dives": "in_progress",
    "assembly": "pending",
    "finalization": "pending"
  },
  "directoryDives": [
    { "path": "src", "status": "completed", "outputFile": "dirs/src.json" },
    { "path": "tests", "status": "pending" },
    { "path": "docs", "status": "failed", "attempts": 1 }
  ],
  "totalCalls": 5,
  "totalAITimeMs": 45000
}
```

**Result parser:** AI output isn't always clean JSON. Progressive fallbacks:

1. `JSON.parse(stdout)` directly
2. Extract from markdown code fences (` ```json ... ``` `)
3. Regex for first `{...}` block
4. Return parse error → retry up to 3 times

**Parallel directory dives:** Process in batches of 3 using `Promise.allSettled()`. Checkpoint after each batch. Failed dives get retried up to 3 times with exponential backoff.

**Old exploration prompt:** `src/master/exploration-prompt.ts` is kept for backward compatibility but no longer used by the coordinator. May be removed in Phase 13.

---

## Phase 12 — Status + Interaction

> **Focus:** User can ask about exploration progress and system status via WhatsApp. Session continuity is critical for multi-turn business conversations (e.g. "which invoices are overdue?" → "send reminders to those clients").

| #   | Task                                                                                                                                                                                                                                                                                                           | ID     | Priority | Status  |
| --- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ | :------: | :-----: |
| 73  | Add exploration progress tracking — track milestones per-phase (structure_scan → classification → directory_dives → assembly → finalization), report current phase + completion % on status query                                                                                                              | OB-103 |  🟡 Med  | ✅ Done |
| 74  | Session continuity — Master uses `--resume` flag for conversation context across messages, multi-turn conversations about the project                                                                                                                                                                          | OB-104 | 🟠 High  | ✅ Done |
| 75  | Resilient startup — on restart: reuse valid `.openbridge/` state, resume incomplete exploration from `exploration-state.json`, re-explore if workspace-map.json is missing/corrupted, skip when map is valid. Handle: folder exists but map missing, map exists but schema outdated, clean restart after crash | OB-105 | 🟠 High  | ✅ Done |
| 76  | Status command enhancement — show per-phase progress, active directory dives, total AI calls/time, estimated completion                                                                                                                                                                                        | OB-106 |  🟡 Med  | ✅ Done |

**Note:** Task 65 (status command handler) from the old Phase 11 is already done. These tasks build on top of the existing status infrastructure.

---

## Phase 13 — Documentation Rewrite

> **Focus:** Rewrite all docs to reflect the new autonomous AI vision. Remove all references to user-defined map files and old architecture.

| #   | Task                                                                                                                                                                                | ID     | Priority |  Status   |
| --- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ | :------: | :-------: |
| 77  | Rewrite OVERVIEW.md — new vision (autonomous AI bridge), use cases (project exploration, task execution, multi-AI delegation), new architecture layers                              | OB-107 | 🟠 High  |  ✅ Done  |
| 78  | Rewrite README.md — new positioning, updated quick start (3-step setup), real examples showing AI discovery + exploration                                                           | OB-108 | 🟠 High  |  ✅ Done  |
| 79  | Rewrite ARCHITECTURE.md — new layers (channels, core, discovery, master AI, delegation), message flow with Master, `.openbridge/` folder spec, incremental exploration architecture | OB-109 | 🟠 High  |  ✅ Done  |
| 80  | Simplify CONFIGURATION.md — V2 config (3 fields), remove workspace maps section, remove provider config, add discovery overrides                                                    | OB-110 |  🟡 Med  | ◻ Pending |
| 81  | Update both CLAUDE.md files — reflect new architecture, new module list, new file structure                                                                                         | OB-111 |  🟡 Med  | ◻ Pending |
| 82  | Delete WORKSPACE_MAP_SPEC.md — no longer relevant (AI generates its own maps)                                                                                                       | OB-112 |  🟢 Low  | ◻ Pending |

---

## Phase 14 — Testing + Verification

> **Focus:** Ensure everything compiles, passes tests, and works end-to-end. Includes use-case validation: non-code workspaces (cafes, law firms, accounting), Console-based rapid testing, graceful error handling, and prefix stripping verification.

| #   | Task                                                                                                                                                                                                  | ID     | Priority |  Status   |
| --- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ | :------: | :-------: |
| 83  | Run `npm run typecheck` — ensure no TypeScript errors after all changes                                                                                                                               | OB-113 | 🟠 High  | ◻ Pending |
| 84  | Run `npm run lint` — fix any ESLint issues                                                                                                                                                            | OB-114 | 🟠 High  | ◻ Pending |
| 85  | Run `npm run test` — update broken tests, add new tests for discovery + master modules                                                                                                                | OB-115 | 🟠 High  | ◻ Pending |
| 86  | Full E2E verification — start OpenBridge, discover tools, explore workspace (incremental), send WhatsApp message, get response, check .openbridge/ (including exploration/ subfolder)                 | OB-116 | 🟠 High  | ◻ Pending |
| 87  | Non-code workspace E2E test — point at a folder with CSVs/text/markdown business files, ask business-style questions (inventory, revenue, schedules), verify responses are accurate and non-technical | OB-117 | 🟠 High  | ◻ Pending |
| 88  | Console-based preprod test workflow — document and verify Console connector as primary rapid testing path (no WhatsApp QR dependency), test all use case categories through Console                   | OB-118 | 🟠 High  | ◻ Pending |
| 89  | Graceful "unknown" handling — verify AI responds helpfully when workspace lacks data for a query (e.g. "what's today's revenue?" with no sales file), no crashes or empty responses                   | OB-119 |  🟡 Med  | ◻ Pending |
| 90  | Command prefix stripping in Master flow — verify `/ai` prefix is cleanly stripped before reaching Master AI, Master receives natural language only                                                    | OB-120 |  🟡 Med  | ◻ Pending |

---

## Phase 15 — Future: Channels + Views (Post-MVP)

> **Focus:** More messaging platforms and rich output capabilities. Not blocking MVP.

| #   | Task                                                                                             | ID     | Priority |  Status   |
| --- | ------------------------------------------------------------------------------------------------ | ------ | :------: | :-------: |
| 91  | Telegram connector — Bot API via grammY, supports DM + group                                     | OB-121 |  🟡 Med  | ◻ Pending |
| 92  | Discord connector — discord.js, supports DM + server channels                                    | OB-122 |  🟢 Low  | ◻ Pending |
| 93  | Web chat connector — browser-based chat widget                                                   | OB-123 |  🟢 Low  | ◻ Pending |
| 94  | Interactive AI views — AI generates reports/dashboards served on local HTTP, links sent via chat | OB-124 |  🟢 Low  | ◻ Pending |

---

## MVP Milestone

**Phases 6–10** (done) = foundation:

- AI tool auto-discovery (zero API keys)
- Master AI autonomous workspace exploration (monolithic)
- `.openbridge/` folder with git tracking
- V2 config (3 fields only)
- Master routing through WhatsApp
- Dead code archived cleanly
- Multi-AI delegation

**Phase 11** = critical fix (incremental exploration that doesn't timeout). **Phase 12** = UX polish. **Phase 13** = docs. **Phase 14** = testing. **Phase 15** = future.

---

## Implementation Order

```
Phase 11 → Incremental exploration (fix timeout, enable real-world use)
Phase 12 → Status + interaction (UX polish, session continuity)
Phase 13 → Documentation rewrite (tell the story)
Phase 14 → Testing + verification (ship it)
Phase 15 → Future channels + views (growth)
```

---

## Status Legend

|     Status     | Meaning                   |
| :------------: | ------------------------- |
|   ◻ Pending    | Not started               |
| 🔄 In Progress | Currently being worked on |
|    ✅ Done     | Completed and verified    |
