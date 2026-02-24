# OpenBridge — Archived Tasks (V0)

> **Archived:** 2026-02-20
> **Covers:** Phases 1–5 (completed) + Old Vision phases (superseded)
> **Total tasks archived:** 57 (37 V0 + 3 Phase 5 + 17 old vision)

---

## Phase 1–4 — V0 Foundation (COMPLETED)

> All 37 V0 tasks are done. See git history OB-001 through OB-037.
> Built: WhatsApp connector, Claude Code provider, bridge core (router, auth, queue, registry, config, health, metrics, audit), plugin architecture, tests, CI.

### Phase 1 — Critical Reliability + Security

| #   | Task                                                                    | ID     | Status  |
| --- | ----------------------------------------------------------------------- | ------ | :-----: |
| 1   | Implement WhatsApp auto-reconnect with exponential backoff              | OB-001 | ✅ Done |
| 2   | Add session persistence — survive restarts without re-scanning QR       | OB-002 | ✅ Done |
| 3   | Sanitize user input before passing to CLI (escape shell metacharacters) | OB-003 | ✅ Done |
| 4   | Add per-user rate limiting (configurable messages/minute)               | OB-004 | ✅ Done |
| 5   | Add retry logic to message queue with configurable max retries          | OB-005 | ✅ Done |
| 6   | Implement Bridge.stop() — shut down connectors and providers properly   | OB-012 | ✅ Done |
| 7   | Drain message queue on shutdown — wait for in-flight messages           | OB-011 | ✅ Done |
| 8   | Write WhatsApp connector unit tests (mock whatsapp-web.js)              | OB-009 | ✅ Done |
| 9   | Write Claude Code provider + executor unit tests                        | OB-010 | ✅ Done |
| 10  | Write integration tests for full message flow                           | OB-008 | ✅ Done |
| 11  | Validate workspacePath exists on disk at startup                        | OB-016 | ✅ Done |
| 12  | Resolve tilde (`~`) in workspacePath config                             | OB-015 | ✅ Done |

### Phase 2 — UX + Robustness

| #   | Task                                                                      | ID     | Status  |
| --- | ------------------------------------------------------------------------- | ------ | :-----: |
| 13  | Add streaming support for long AI responses                               | OB-006 | ✅ Done |
| 14  | Add conversation context / session memory per user                        | OB-007 | ✅ Done |
| 15  | Split long responses into WhatsApp-safe chunks (≤4096 chars)              | OB-013 | ✅ Done |
| 16  | Send typing indicator while AI processes                                  | OB-014 | ✅ Done |
| 17  | Classify provider errors (transient vs permanent) with different handling | OB-018 | ✅ Done |
| 18  | Implement per-user message queues (parallel processing across users)      | OB-019 | ✅ Done |
| 19  | Add progress updates for long-running tasks                               | OB-020 | ✅ Done |
| 20  | Implement dead letter queue for permanently failed messages               | OB-022 | ✅ Done |
| 21  | Add audit logging — persist message history                               | OB-021 | ✅ Done |
| 22  | Add command allow/deny list for AI operations                             | OB-027 | ✅ Done |
| 23  | Add config hot-reload without restart                                     | OB-017 | ✅ Done |

### Phase 3 — Observability + Developer Experience

| #   | Task                                                                  | ID     | Status  |
| --- | --------------------------------------------------------------------- | ------ | :-----: |
| 24  | Add health check endpoint (HTTP)                                      | OB-023 | ✅ Done |
| 25  | Add metrics collection (message count, latency, error rate)           | OB-024 | ✅ Done |
| 26  | Create deployment guide (Docker, PM2, systemd)                        | OB-025 | ✅ Done |
| 27  | Create troubleshooting guide (common errors + solutions)              | OB-026 | ✅ Done |
| 28  | Add plugin auto-discovery (scan directories for connectors/providers) | OB-030 | ✅ Done |
| 29  | Create CLI tool for config generation (`npx openbridge init`)         | OB-031 | ✅ Done |
| 30  | Write E2E test harness with mock WhatsApp server                      | OB-032 | ✅ Done |
| 31  | Add CI badge to README                                                | OB-035 | ✅ Done |

### Phase 4 — Polish + Ecosystem

| #   | Task                                                       | ID     | Status  |
| --- | ---------------------------------------------------------- | ------ | :-----: |
| 32  | Add multi-workspace support (switch projects via command)  | OB-028 | ✅ Done |
| 33  | Convert AI markdown to WhatsApp formatting                 | OB-029 | ✅ Done |
| 34  | Create example connector plugin (reference implementation) | OB-033 | ✅ Done |
| 35  | Create API reference documentation                         | OB-034 | ✅ Done |
| 36  | Add performance benchmarks                                 | OB-036 | ✅ Done |
| 37  | Validate provider name matches defaultProvider in config   | OB-037 | ✅ Done |

---

## Phase 5 — Bug Fix + Executor Hardening (COMPLETED)

> **Focus:** Fix the critical bug where `tsx watch` kills the process during AI execution, so users never receive responses. Generalize the executor to support any CLI tool.

| #   | Task                                                                                                                                           | ID     | Priority |  Status |
| --- | ---------------------------------------------------------------------------------------------------------------------------------------------- | ------ | :------: | ------: |
| 38  | Fix `package.json` dev script — change `tsx watch` to `tsx` (no watch), add `dev:watch` with `--ignore` flags for volatile directories         | OB-068 | 🔴 Crit  | ✅ Done |
| 39  | Add graceful shutdown guard to executor — track active child processes, register SIGTERM/SIGINT handlers that wait for them before exit        | OB-069 | 🟠 High  | ✅ Done |
| 40  | Generalize CLI executor — add `command` option to `ExecutionOptions` (default: `'claude'`) so any AI CLI can be spawned with the same executor | OB-070 | 🟠 High  | ✅ Done |

**Files modified:**

- `package.json` — `dev` script fix, `dev:watch` added
- `src/providers/claude-code/claude-code-executor.ts` — `trackChild()`, `waitForActiveProcesses()`, `command` option

---

## Archived Phases (Old Vision)

> These phases were built under the assumption that users manually define `openbridge.map.json` files. That vision is replaced by autonomous AI exploration. Code will be moved to `src/_archived/`.

### Old Phase 5 — Vision Rewrite + Documentation (superseded)

Docs were rewritten for the "AI workforce platform" vision with user-defined workspace maps. Now being replaced by the autonomous exploration vision in Phase 12.

### Old Phase 6 — Workspace Mapping Engine (ARCHIVED)

Built workspace scanner, map loader, API executor, workspace-map types, openbridge.map.json spec. **All assumed users create map files manually.**

| Old ID | What was built                                    | Why archived                                        |
| ------ | ------------------------------------------------- | --------------------------------------------------- |
| OB-043 | WorkspaceMap types (APIEndpoint, MapSource)       | AI generates its own map, users don't define them   |
| OB-044 | openbridge.map.json spec                          | No longer a user-facing file                        |
| OB-045 | Workspace scanner (OpenAPI/Postman/manual parser) | Master AI explores directly, no spec parsing needed |
| OB-046 | API executor (HTTP requests with auth/retries)    | May be reused later, not in current architecture    |
| OB-047 | Workspace manager (loads maps on startup)         | Replaced by Master AI manager                       |
| OB-048 | Workspace mapping tests                           | Tests for archived code                             |

### Old Phase 7 — Multi-Agent Orchestrator (ARCHIVED)

Built agent orchestrator, task agent runtime, script coordinator. **Code existed but never actually decomposed tasks.** The orchestrator was a pass-through.

| Old ID | What was built                      | Why archived                                         |
| ------ | ----------------------------------- | ---------------------------------------------------- |
| OB-049 | Agent types (Agent, TaskAgent)      | Kept in `src/types/agent.ts` — still useful          |
| OB-050 | Agent Orchestrator class            | Was a pass-through, never decomposed tasks           |
| OB-051 | Task Agent runtime                  | Never executed, dead code                            |
| OB-052 | Script Coordinator (event bus, DAG) | Events emitted but nobody listened                   |
| OB-053 | Router → Orchestrator integration   | Router integration kept, orchestrator logic replaced |
| OB-054 | Bridge lifecycle wiring             | Bridge wiring kept, orchestrator replaced by Master  |
| OB-055 | Orchestrator tests                  | Tests for archived code                              |

### Old Phase 8 — AI Provider Enhancement (PARTIALLY ARCHIVED)

Extended AIProvider interface with ProviderContext and tool-use types. **Provider context was never used.**

| Old ID | What was built                         | Status                                       |
| ------ | -------------------------------------- | -------------------------------------------- |
| OB-056 | AIProvider interface extended          | Kept — ProviderContext still useful          |
| OB-057 | Tool-use protocol types                | Archived — tool.ts moved to `src/_archived/` |
| OB-058 | Claude Code provider context injection | Never done — replaced by Master AI approach  |
| OB-059 | Tool protocol tests                    | Never done — no longer needed                |
