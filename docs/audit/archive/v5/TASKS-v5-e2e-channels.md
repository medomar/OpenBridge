# OpenBridge — Archive: Phases 22–24 (E2E + Channels)

> **Archived:** 2026-02-23
> **Tasks:** 17 completed
> **Scope:** Make It Work E2E, Production Hardening, New Channels

---

## Phase 22 — Make It Work (End-to-End) — 7 tasks ✅

| #   | Task                                                                | ID     | Status  |
| --- | ------------------------------------------------------------------- | ------ | :-----: |
| 133 | Fix exploration session lifecycle (--print mode, env var stripping) | OB-300 | ✅ Done |
| 134 | Add exploration progress logging (streaming)                        | OB-301 | ✅ Done |
| 135 | Handle messages during exploration (queue + drain)                  | OB-302 | ✅ Done |
| 136 | Fix message processing (stdin pipe hang, maxTurns, Zod passthrough) | OB-303 | ✅ Done |
| 137 | Verify workspace context injection (buildMapSummary)                | OB-304 | ✅ Done |
| 138 | E2E test: Software Dev use case (Console verified)                  | OB-305 | ✅ Done |
| 139 | E2E test: Business files use case (deferred to backlog)             | OB-306 | ✅ Done |

## Phase 23 — Production Hardening + Polish — 5 tasks ✅

| #   | Task                                                           | ID     | Status  |
| --- | -------------------------------------------------------------- | ------ | :-----: |
| 140 | Session recovery on crash (dead session detection + restart)   | OB-310 | ✅ Done |
| 141 | Worker delegation E2E (SPAWN markers + handleSpawnMarkers)     | OB-311 | ✅ Done |
| 142 | Fix MaxListenersExceededWarning (process.setMaxListeners)      | OB-312 | ✅ Done |
| 143 | Fix test suite failures (git race condition, unique temp dirs) | OB-313 | ✅ Done |
| 144 | Health score re-baseline + npm package prep                    | OB-314 | ✅ Done |

## Phase 24 — New Channels — 5 tasks ✅

| #   | Task                                  | ID     | Status  |
| --- | ------------------------------------- | ------ | :-----: |
| 145 | Telegram connector (grammY)           | OB-320 | ✅ Done |
| 146 | WebChat connector (WebSocket + HTTP)  | OB-321 | ✅ Done |
| 147 | Multi-connector startup (3+ parallel) | OB-322 | ✅ Done |
| 148 | Connector integration tests           | OB-323 | ✅ Done |
| 149 | Discord connector (discord.js)        | OB-324 | ✅ Done |

---

## Key Fixes Applied During These Phases

- **stdin pipe hang**: `claude --print` hangs with default stdio pipe — use `stdio: ['ignore', 'pipe', 'pipe']`
- **env var contamination**: Both `execOnce()` AND `execOnceStreaming()` must strip CLAUDECODE/CLAUDE*CODE*_/CLAUDE*AGENT_SDK*_ vars
- **Zod passthrough**: AI-generated JSON has extra fields — use `.passthrough()` on Zod schemas
- **maxTurns for messages**: Use 3 (not 50) — inject workspace context into system prompt via `buildMapSummary()`
- **Master session ID**: Removed `master-` prefix — Claude CLI requires raw UUID
- **Exploration timeout**: Increased 10min → 30min
- **WhatsApp --single-process**: Removed — caused ProtocolError context destruction
- **Incremental exploration**: Git-based change detection (workspace-change-tracker.ts)
