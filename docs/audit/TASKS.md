# OpenBridge — Task List

> **Pending:** 17 tasks in 3 phases | **Next up:** Phase 22
> **Last Updated:** 2026-02-22
> **Completed work:** [V0 archive (Phases 1–5)](archive/v0/TASKS-v0.md) | [V1 archive (Phases 6–10)](archive/v1/TASKS-v1.md) | [V2 archive (Phases 11–14)](archive/v2/TASKS-v2.md) | [MVP archive (Phase 15)](archive/v3/TASKS-v3-mvp.md) | [Self-Governing archive (Phases 16–21)](archive/v4/TASKS-v4-self-governing.md)

---

## Vision

OpenBridge is a **self-governing autonomous AI bridge**. It connects messaging channels to a **Master AI** that explores your workspace, spawns worker agents, and executes tasks — all using the AI tools already installed on your machine (zero API keys, zero extra cost).

**Current state:** All layers are built but the **end-to-end flow is broken**. Exploration never completes, sessions die, user messages get no AI response. The architecture is there — it's just not wired up correctly. Phase 22 fixes this.

---

## Roadmap

| Phase | Focus                              |  Tasks  | Status |
| :---: | ---------------------------------- | :-----: | :----: |
| 1–14  | MVP foundation                     |   98    |   ✅   |
| 16–21 | Self-Governing Master AI           |   34    |   ✅   |
|       | **Total completed**                | **132** |        |
|  22   | Make it work (E2E)                 |    7    |   ◻    |
|  23   | Production hardening + polish      |    5    |   ◻    |
|  24   | New channels (Telegram + Web Chat) |    5    |   ◻    |

---

## Phase 22 — Make It Work (End-to-End)

> **Goal:** User runs `npm start`, exploration completes with visible progress, user sends `/ai hello`, gets an intelligent response back. This is the ONLY thing that matters right now.
>
> **Why this order:** Tasks are ordered by dependency. Each task unblocks the next. Don't skip ahead.

### Step 1: Exploration Must Complete

| #   | Task                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          | ID     |  Priority   |  Status   |
| --- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ | :---------: | :-------: |
| 133 | **Fix exploration session lifecycle** — The Master exploration uses `agentRunner.spawn()` which runs a single `claude --print` call. After exploration, the session is closed/disposed. Then `processMessage()` tries `--resume` on the dead session and crashes. **Fix:** Exploration must use `--session-id <UUID>` (not `--print`) so the session stays alive for future messages. Or: make exploration write `workspace-map.json` and let `processMessage()` inject it as context into a NEW session. Verify: exploration completes and `workspace-map.json` is written to `.openbridge/`. **Key file:** `src/master/master-manager.ts` — `masterDrivenExplore()` (line ~972) and `buildMasterSpawnOptions()` (line ~368) | OB-300 | 🔴 Critical | ◻ Pending |
| 134 | **Add exploration progress logging** — Right now exploration is a black box — no output for 30 minutes. Add real-time progress logs so the user knows what's happening. Log: "Scanning workspace structure...", "Found N files, classifying project...", "Exploring src/ directory...", "Writing workspace map...". Either stream AgentRunner output line-by-line, or have the Master write progress to `.openbridge/exploration.log` and tail it. **Key files:** `src/master/master-manager.ts`, `src/core/agent-runner.ts` (check if `stream()` method exists and use it)                                                                                                                                                   | OB-301 |   🟠 High   | ◻ Pending |
| 135 | **Handle messages during exploration** — When exploration is running and user sends `/ai hello`, they get stuck or an error. **Fix:** Either queue the message and process it after exploration, or let the Master handle messages in parallel (exploration + message are separate sessions). At minimum, respond with "I'm still exploring your workspace, please wait..." with an ETA                                                                                                                                                                                                                                                                                                                                       | OB-302 |   🟠 High   | ◻ Pending |

### Step 2: User Message → AI Response

| #   | Task                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   | ID     |  Priority   |  Status   |
| --- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ | :---------: | :-------: |
| 136 | **Fix message processing after exploration** — After exploration completes, `processMessage()` must work. Verify the full chain: user types `/ai what's in this project?` → Router strips prefix → Master receives "what's in this project?" → Master has workspace context (from exploration or workspace-map.json) → Master responds with accurate project description → response sent back to Console/WhatsApp. Test with Console connector first. **Key file:** `src/master/master-manager.ts` — `processMessage()` (line ~1148), `src/core/router.ts` — `route()` | OB-303 | 🔴 Critical | ◻ Pending |
| 137 | **Verify workspace context is available to Master** — After exploration, the Master should know about the project. Check: does `processMessage()` inject `workspace-map.json` content into the prompt? Does the Master's system prompt include project knowledge? If not, wire it up — the Master MUST have workspace context when answering user questions. Without this, responses are generic and useless                                                                                                                                                           | OB-304 | 🔴 Critical | ◻ Pending |

### Step 3: End-to-End Verification

| #   | Task                                                                                                                                                                                                                                                                                                                                                                               | ID     |  Priority   |  Status   |
| --- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ | :---------: | :-------: |
| 138 | **E2E test: Software Dev use case** — Point OpenBridge at a real codebase (e.g., Social-Media-Automation-Platform). Run `npm start`. Wait for exploration. Send `/ai what's in this project?` via Console. Verify response is accurate and project-specific. Send `/ai what technologies does this project use?`. Verify follow-up uses conversation context. Fix any issues found | OB-305 | 🔴 Critical | ◻ Pending |
| 139 | **E2E test: Business files use case** — Create a folder with CSV/text business files (menu, inventory, schedule). Point OpenBridge at it. Send `/ai what ingredients are running low?`. Verify the Master reads the CSV and gives a correct answer. This validates the USE_CASES.md scenarios (cafe, law firm, etc.)                                                               | OB-306 |   🟠 High   | ◻ Pending |

---

## Phase 23 — Production Hardening + Polish

> **Focus:** Now that E2E works, make it reliable. Error recovery, session durability, worker delegation, and cleanup.
>
> **Prerequisite:** Phase 22 must be complete (exploration works, messages get responses).

| #   | Task                                                                                                                                                                                                                                                                                                                                                | ID     | Priority |  Status   |
| --- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ | :------: | :-------: |
| 140 | **Session recovery on crash** — If the Master session crashes (exit 143, OOM, context overflow), it should automatically restart with a fresh session and re-inject workspace context. Currently `restartMasterSession()` exists but may not trigger correctly. Verify: kill the Master mid-conversation, send another message, confirm it recovers | OB-310 | 🟠 High  | ◻ Pending |
| 141 | **Worker delegation E2E** — Verify SPAWN markers work: Master decides a task needs a worker, spawns `claude --print` with restricted tools, gets result back, synthesizes response. Test with: `/ai run the tests` (should spawn a worker with Bash tool). Fix `handleSpawnMarkers()` and `handleSpawnMarkersWithProgress()` if broken              | OB-311 | 🟠 High  | ◻ Pending |
| 142 | **Fix MaxListenersExceededWarning** — Node warns about 11 exit listeners on startup. Audit all `process.on('exit')` / `process.on('SIGTERM')` handlers across modules and deduplicate. Not critical but noisy                                                                                                                                       | OB-312 |  🟡 Med  | ◻ Pending |
| 143 | **Fix test suite failures** — 4 tests fail in exploration-coordinator.test.ts (git race condition) + 1 unhandled rejection in agent-runner.test.ts. Fix them. Also update any tests broken by Phase 22 changes. Run full suite green                                                                                                                | OB-313 |  🟡 Med  | ◻ Pending |
| 144 | **Health score re-baseline + npm package prep** — Update HEALTH.md scores to reflect reality. Verify `npm pack` works, `npx openbridge init` runs, README is accurate                                                                                                                                                                               | OB-314 |  🟢 Low  | ◻ Pending |

---

## Phase 24 — New Channels (Telegram + Web Chat)

> **Focus:** Add Telegram and Web Chat connectors. Each implements the same `Connector` interface.
>
> **Prerequisite:** Phase 23 complete (system is stable and tested).

| #   | Task                                                                                                                                                                                                                  | ID     | Priority |  Status   |
| --- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ | :------: | :-------: |
| 145 | **Telegram connector** — Create `src/connectors/telegram/` using grammY. Support DM messages, group mentions (`@bot`), inline replies. Register in connector registry. Add Telegram user ID to auth whitelist support | OB-320 | 🟠 High  | ◻ Pending |
| 146 | **Web Chat connector** — Create `src/connectors/webchat/` serving HTML chat on `localhost:3000`. WebSocket for real-time. No auth for localhost                                                                       | OB-321 |  🟡 Med  | ◻ Pending |
| 147 | **Multi-connector startup** — Support multiple connectors running simultaneously (WhatsApp + Telegram + Console). Currently works but verify with 3+ connectors                                                       | OB-322 |  🟡 Med  | ◻ Pending |
| 148 | **Connector integration tests** — Mock-based tests for Telegram and WebChat connectors                                                                                                                                | OB-323 |  🟡 Med  | ◻ Pending |
| 149 | **Discord connector** — discord.js, DM + server channels                                                                                                                                                              | OB-324 |  🟢 Low  | ◻ Pending |

---

## Backlog — Future Phases

| Task                                                                          | ID     | Priority |
| ----------------------------------------------------------------------------- | ------ | :------: |
| Context compaction — progressive summarization when Master context gets large | OB-190 |  🟡 Med  |
| Vector memory — SQLite + embeddings for long-term knowledge retrieval         | OB-191 |  🟢 Low  |
| Skill creator — Master creates reusable skill templates                       | OB-192 |  🟢 Low  |
| Docker sandbox — run workers in containers for untrusted workspaces           | OB-193 |  🟢 Low  |
| Interactive AI views — AI generates reports/dashboards on local HTTP          | OB-124 |  🟢 Low  |

---

## Completed Milestones

**Phases 1–14 (98 tasks):** MVP — WhatsApp + Console connectors, Claude Code provider, bridge core, auth, queue, metrics, AI discovery, Master AI, exploration, delegation, testing, documentation.

**Phases 16–21 (34 tasks):** Self-Governing Master — AgentRunner (retries, logging, --allowedTools, --max-turns, --model), tool profiles (read-only, code-edit, full-access), model selection (haiku/sonnet/opus), self-governing Master session (persistent, spawns workers, self-improving), worker orchestration (parallel, registry, progress, timeouts), self-improvement (prompt library, learnings store, effectiveness tracking), E2E test scripts.

**Hotfix (2026-02-22):** Fixed OB-F21 — Master session ID used invalid UUID format (`master-` prefix rejected by Claude CLI), exploration timeout too short (10min→30min), null safety in buildMasterSpawnOptions. Updated 5 test assertions.

---

## Status Legend

|     Status     | Meaning                   |
| :------------: | ------------------------- |
|   ◻ Pending    | Not started               |
| 🔄 In Progress | Currently being worked on |
|    ✅ Done     | Completed and verified    |
