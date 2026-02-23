# OpenBridge — Task List

> **Pending:** 4 tasks | **In Progress:** 0
> **Last Updated:** 2026-02-23
> **Completed work:** [V0 (Phases 1–5)](archive/v0/TASKS-v0.md) | [V1 (Phases 6–10)](archive/v1/TASKS-v1.md) | [V2 (Phases 11–14)](archive/v2/TASKS-v2.md) | [MVP (Phase 15)](archive/v3/TASKS-v3-mvp.md) | [Self-Governing (Phases 16–21)](archive/v4/TASKS-v4-self-governing.md) | [E2E + Channels (Phases 22–24)](archive/v5/TASKS-v5-e2e-channels.md)

---

## Vision

OpenBridge is a **self-governing autonomous AI bridge**. The Master AI receives user messages, **decides** whether to answer directly or decompose the task into subtasks, spawns workers to execute them, then **synthesizes** the final response. It uses your installed AI tools — zero API keys, zero extra cost.

**Current problem:** The Master has `maxTurns: 3` for messages. This is fine for Q&A but kills any task requiring tool use (file generation, code changes, research). The Master hits the turn limit before it can even output SPAWN markers. We need smart task classification so simple questions stay fast (3 turns) while complex tasks get more room and automatic worker delegation.

---

## Roadmap

| Phase | Focus                                   | Tasks | Status |
| :---: | --------------------------------------- | :---: | :----: |
| 1–24  | Foundation + E2E + Channels             |  153  |   ✅   |
|  25   | Smart Orchestration (task routing)      |   6   |   ✅   |
|  26   | Workspace Mapping Reliability           |   4   |   ✅   |
|  27   | Connector Hardening (WhatsApp + others) |   3   |   ◻    |
|  28   | Production Polish                       |   3   |   ◻    |

---

## Phase 25 — Smart Orchestration

> **Goal:** The Master classifies each incoming message as `quick-answer`, `tool-use`, or `complex-task`. Quick answers stay at 3 turns. Tool-use tasks get 10 turns. Complex tasks are automatically decomposed into SPAWN markers, delegated to workers, and the results synthesized back to the user.
>
> **Why:** Right now `maxTurns: 3` blocks anything beyond Q&A. "Generate me an HTML file" runs out of turns. The Master needs to be smart about when it needs more room vs. when 3 turns is plenty.

| #   | Task                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   | ID     |  Priority   | Status  |
| --- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ | :---------: | :-----: |
| 154 | **Task classifier in processMessage()** — Before spawning the Master, classify the message intent. Add a `classifyTask(content: string): 'quick-answer' \| 'tool-use' \| 'complex-task'` method to `MasterManager`. Use keyword heuristics: messages with "generate", "create", "write", "build", "implement", "fix", "refactor", "update file", "add to", "make a" → `tool-use` or `complex-task`. Questions ("what", "how", "why", "explain", "list", "show me", "can you") → `quick-answer`. Set `maxTurns` accordingly: quick=3, tool-use=10, complex=15. This is a fast local classification — no AI call needed. | OB-400 | 🔴 Critical | ✅ Done |
| 155 | **Auto-delegation for complex tasks** — When `classifyTask()` returns `complex-task`, don't send the raw message to the Master with 15 turns. Instead, send a **planning prompt**: "The user asked: '{message}'. Break this into 1-3 concrete subtasks. For each subtask, output a SPAWN marker with the appropriate profile, model, and instructions. Do NOT execute the tasks yourself — only plan and delegate." This forces the Master to output SPAWN markers within 3-5 turns, then `handleSpawnMarkers()` executes the workers in parallel, and a final Master call synthesizes the response.                   | OB-401 | 🔴 Critical | ✅ Done |
| 156 | **Increase worker turn budget** — Workers spawned via SPAWN markers currently inherit `maxTurns` from the marker body (default 25). For file-generation tasks (HTML, PDF, reports), workers need room to read context + write files. Ensure the default `maxTurns` in `handleSpawnMarkers()` is at least 15 for `code-edit` / `full-access` profiles and 10 for `read-only`. Also add `maxBudgetUsd` support to SpawnOptions so cost can be capped per worker instead of just turns.                                                                                                                                   | OB-402 |   🟠 High   | ✅ Done |
| 157 | **Progress feedback during delegation** — When the Master delegates to workers, the user currently sees nothing until all workers finish. Fix: in `processMessage()`, when SPAWN markers are detected, immediately send "Working on your request — I've broken it into N subtasks..." to the user. Then as each worker completes, send progress updates via the Router: "Subtask 1/3 done...", "Subtask 2/3 done...". This requires threading the Router reference into the message processing flow (the `setRouter()` method already exists).                                                                         | OB-403 |   🟠 High   | ✅ Done |
| 158 | **Synthesis quality — final response formatting** — After workers complete and results are fed back to the Master, the Master's synthesis call also has `maxTurns: 3`. This may not be enough if the worker produced a large result. Increase the synthesis call to `maxTurns: 5` and add instructions in the feedback prompt: "Summarize the worker results into a clear, user-friendly response. If a file was created, tell the user its path and a brief description. Be concise."                                                                                                                                 | OB-404 |   🟡 Med    | ✅ Done |
| 159 | **Tests for task classification + auto-delegation** — Unit tests in `tests/master/master-manager.test.ts`: (1) `classifyTask()` correctly classifies 10+ example messages. (2) `processMessage()` with a complex task triggers SPAWN markers. (3) Worker results are fed back and synthesized. (4) Quick-answer messages still complete in ≤3 turns.                                                                                                                                                                                                                                                                   | OB-405 |   🟠 High   | ✅ Done |

---

## Phase 26 — Workspace Mapping Reliability

> **Goal:** Ensure the workspace map is always fresh and the Master always has accurate context. Fix the remaining mapping issues.
>
> **Prerequisite:** Phase 25 complete (orchestration works for complex tasks).

| #   | Task                                                                                                                                                                                                                                                                                                                                                                                       | ID     | Priority | Status  |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------ | :------: | :-----: |
| 160 | **Verify incremental exploration E2E** — Test the full flow: (1) Start OpenBridge against a workspace → full exploration + marker written. (2) Add a new file to the workspace, restart → incremental update runs, new file appears in map. (3) Restart with no changes → exploration skipped. (4) Delete 250+ files → triggers full re-exploration. Automate this as an integration test. | OB-410 | 🟠 High  | ✅ Done |
| 161 | **Fix tilde (~) in workspacePath** — `~/Desktop/project` doesn't resolve to the full path. In `src/core/config.ts`, expand `~` to `os.homedir()` before validating the path. Add a test.                                                                                                                                                                                                   | OB-411 |  🟡 Med  | ✅ Done |
| 162 | **Workspace map freshness indicator** — Add a `lastVerifiedAt` field to `analysis-marker.json`. On each startup, even if no changes detected, update this timestamp. In the Master's system prompt context, include "Map last updated: 2 hours ago" so the Master knows how fresh its knowledge is and can decide to re-explore if stale.                                                  | OB-412 |  🟢 Low  | ✅ Done |
| 163 | **Handle workspaces without git** — Non-git workspaces (business files, dropbox folders) use timestamp-based change detection. Verify this path works E2E: create a workspace with no .git, run OpenBridge, add files, verify incremental detection picks them up. Currently `timestamp` fallback has a depth limit of 5 — increase to 10 for deep folder structures.                      | OB-413 |  🟡 Med  | ✅ Done |

---

## Phase 27 — Connector Hardening

> **Goal:** Make WhatsApp stable and enable easy testing of other connectors.
>
> **Prerequisite:** Phase 25 complete.

| #   | Task                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          | ID     | Priority |  Status   |
| --- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ | :------: | :-------: |
| 164 | **WhatsApp stability** — The `ProtocolError: Execution context was destroyed` still occurs after removing `--single-process`. Investigate further: (1) Check if the error happens during `initialize()` or after `ready`. (2) If during init, add retry logic around `client.initialize()` with 3 attempts + exponential backoff. (3) If after ready, the `error` event handler + reconnect should handle it — add logging to verify. (4) Consider using `webVersionCache: { type: 'local' }` to avoid remote fetch failures. | OB-420 | 🟠 High  |  ✅ Done  |
| 165 | **Connector testing guide** — Document how to test each connector in `docs/CONNECTORS.md`: Console (just `npm start`), WebChat (enable in config, open `localhost:3000`), Telegram (get bot token from BotFather, add to config), Discord (create app, get token), WhatsApp (QR scan). Include a sample `config.json` for each.                                                                                                                                                                                               | OB-421 |  🟡 Med  |  ✅ Done  |
| 166 | **WebChat as default dev connector** — Add WebChat alongside Console as always-enabled in development. It's more user-friendly than Console for demos. Ensure the HTML chat page is polished: show "Thinking..." while waiting, render markdown responses, show connection status.                                                                                                                                                                                                                                            | OB-422 |  🟢 Low  | ◻ Pending |

---

## Phase 28 — Production Polish

> **Goal:** Clean up remaining tech debt, update docs, prepare for public release.

| #   | Task                                                                                                                                                                                                                                                                                                                                                     | ID     | Priority |  Status   |
| --- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ | :------: | :-------: |
| 167 | **Fix remaining test failures** — Run `npm test`, fix all failures. Currently 7 failures from git race condition (OB-F18). Use unique temp directories per test via `mkdtemp`. Target: 100% pass rate.                                                                                                                                                   | OB-430 |  🟡 Med  | ◻ Pending |
| 168 | **Update README and OVERVIEW for current state** — README still describes MVP-era architecture. Update to reflect: 5 connectors (Console, WhatsApp, Telegram, WebChat, Discord), smart orchestration, incremental exploration, self-governing Master with worker delegation. Update the "Quick Start" to show the simplest path (Console + Claude Code). | OB-431 |  🟡 Med  | ◻ Pending |
| 169 | **HEALTH.md re-baseline** — Re-score all categories to reflect Phases 25-27 work. Update the overall score.                                                                                                                                                                                                                                              | OB-432 |  🟢 Low  | ◻ Pending |

---

## Backlog — Future Phases

| Task                                                                          | ID     | Priority |
| ----------------------------------------------------------------------------- | ------ | :------: |
| Context compaction — progressive summarization when Master context gets large | OB-190 |  🟡 Med  |
| Vector memory — SQLite + embeddings for long-term knowledge retrieval         | OB-191 |  🟢 Low  |
| Skill creator — Master creates reusable skill templates                       | OB-192 |  🟢 Low  |
| Docker sandbox — run workers in containers for untrusted workspaces           | OB-193 |  🟢 Low  |
| Interactive AI views — AI generates reports/dashboards on local HTTP          | OB-124 |  🟢 Low  |
| E2E test: Business files use case (CSV workspace)                             | OB-306 |  🟢 Low  |

---

## Completed Milestones

**Phases 1–14 (98 tasks):** MVP — Connectors, bridge core, AI discovery, Master AI, exploration, delegation.

**Phases 16–21 (34 tasks):** Self-Governing Master — AgentRunner, tool profiles, model selection, worker orchestration, self-improvement.

**Phases 22–24 (17 tasks):** E2E hardening, production polish, 5 connectors (Console, WhatsApp, Telegram, WebChat, Discord), incremental exploration.

**Hotfixes (2026-02-22–23):** Master session ID format, exploration timeout, stdin pipe hang, env var contamination, Zod passthrough, WhatsApp --single-process removal, incremental workspace change detection.

---

## Status Legend

|     Status     | Meaning                   |
| :------------: | ------------------------- |
|   ◻ Pending    | Not started               |
| 🔄 In Progress | Currently being worked on |
|    ✅ Done     | Completed and verified    |
