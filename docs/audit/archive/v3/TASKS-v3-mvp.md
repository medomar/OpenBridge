# OpenBridge — Task List

> **Pending:** 4 tasks in 1 phase | **Next up:** Phase 15
> **Last Updated:** 2026-02-21
> **Completed work:** [V0 archive (Phases 1–5)](archive/v0/TASKS-v0.md) | [V1 archive (Phases 6–10)](archive/v1/TASKS-v1.md) | [V2 archive (Phases 11–14)](archive/v2/TASKS-v2.md)

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

| Phase | Focus                             | Tasks  | Status |
| :---: | --------------------------------- | :----: | :----: |
|  1–5  | V0 foundation + bug fixes         |   40   |   ✅   |
| 6–10  | Discovery, Master, V2, Delegation |   24   |   ✅   |
|  11   | Incremental exploration           |   8    |   ✅   |
|  12   | Status + interaction              |   4    |   ✅   |
|  13   | Documentation rewrite             |   6    |   ✅   |
|  14   | Testing + verification            |   8    |   ✅   |
|       | **Total completed**               | **90** |        |
|  15   | Future: channels + views          |   4    |   ◻    |

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

## MVP Milestone — COMPLETE

**Phases 1–14** (90 tasks) delivered the full MVP:

- V0 foundation: WhatsApp connector, Claude Code provider, bridge core, auth, queue, metrics
- AI tool auto-discovery (zero API keys) — CLI + VS Code scanner
- Master AI with autonomous workspace exploration (incremental 5-pass, never times out)
- `.openbridge/` folder with git tracking and exploration state
- V2 config (3 fields only) with V0 backward compatibility
- Session continuity (multi-turn conversations with 30min TTL)
- Multi-AI delegation (Master assigns tasks to other discovered tools)
- Dead code archived cleanly to `src/_archived/`
- Documentation fully rewritten for autonomous AI vision
- Comprehensive test suite: unit, integration, E2E (code + non-code workspaces)

**Phase 15** = future growth (additional channels, interactive views).

---

## Status Legend

|     Status     | Meaning                   |
| :------------: | ------------------------- |
|   ◻ Pending    | Not started               |
| 🔄 In Progress | Currently being worked on |
|    ✅ Done     | Completed and verified    |
