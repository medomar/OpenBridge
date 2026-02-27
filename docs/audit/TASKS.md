# OpenBridge — Task List

> **Pending:** 12 | **In Progress:** 0 | **Done:** 29
> **Last Updated:** 2026-02-27

<details>
<summary>Archive (435 tasks completed across Phases 1–56)</summary>

- [V0 — Phases 1–5](archive/v0/TASKS-v0.md)
- [V1 — Phases 6–10](archive/v1/TASKS-v1.md)
- [V2 — Phases 11–14](archive/v2/TASKS-v2.md)
- [MVP — Phase 15](archive/v3/TASKS-v3-mvp.md)
- [Self-Governing — Phases 16–21](archive/v4/TASKS-v4-self-governing.md)
- [E2E + Channels — Phases 22–24](archive/v5/TASKS-v5-e2e-channels.md)
- [Smart Orchestration — Phases 25–28](archive/v6/TASKS-v6-smart-orchestration.md)
- [AI Classification — Phase 29](archive/v7/TASKS-v7-ai-classification.md)
- [Production Readiness — Phase 30](archive/v8/TASKS-v8-production-readiness.md)
- [Memory + Scale — Phases 31–38](archive/v9/TASKS-v9-memory-scale.md)
- [Memory Wiring — Phase 40](archive/v10/TASKS-v10-memory-wiring.md)
- [Memory Fixes — Phases 41–44](archive/v11/TASKS-v11-memory-fixes.md)
- [Post-v0.0.2 — Phases 45–50](archive/v12/TASKS-v12-post-v002-phases-45-50.md)
- [v0.0.3 — Phases 51–56](archive/v13/TASKS-v13-v003-phases-51-56.md)

</details>

---

## Phase 57 — Fix Codex Worker Failures (OB-F37, Track A)

> **Priority:** HIGH — Codex workers are completely broken. Users with Claude+Codex can't delegate to Codex workers.
> **Finding:** [OB-F37](FINDINGS.md#2--ob-f37--codex-workers-always-fail--no-codex-provider-users-without-claude-locked-out)
> **Verified:** `codex exec` fails with exit code 1 from non-git directories. Missing `--skip-git-repo-check`, no OPENAI_API_KEY validation, default sandbox undefined.

| #   | Task ID | Description                                                                                                                                                                                                                                                                                                                                                                                                              | Status  |
| --- | ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------- |
| 1   | OB-1091 | **Add `--skip-git-repo-check` to Codex adapter** in `src/core/adapters/codex-adapter.ts` (line 44) — always push `'--skip-git-repo-check'` after `'exec'`. OpenBridge already validates workspace path separately (`workspace-manager.ts`). Without this flag, Codex exits immediately with code 1 from non-git or untrusted directories. This is the **#1 cause** of all Codex worker failures.                         | ✅ Done |
| 2   | OB-1092 | **Default sandbox to `read-only` when no tools specified** in `src/core/adapters/codex-adapter.ts` (line 139-140) — change `inferSandboxMode()` to return `'read-only'` instead of `undefined` when `allowedTools` is empty/undefined. Currently, no `--sandbox` flag is passed, letting Codex use its default (permissive). Workers with no explicit tool profile should be restricted, not unrestricted.               | ✅ Done |
| 3   | OB-1093 | **Validate OPENAI_API_KEY before spawn** in `src/core/adapters/codex-adapter.ts` — in `buildSpawnConfig()`, check `process.env['OPENAI_API_KEY']` exists. If missing, log a clear error: `"Codex requires OPENAI_API_KEY environment variable. Set it in your shell or .env file."` and throw `Error` (caught by AgentRunner retry logic, classified as 'auth'). Prevents confusing timeout/crash errors.                | ✅ Done |
| 4   | OB-1094 | **Add `--json` flag for structured output** in `src/core/adapters/codex-adapter.ts` — push `'--json'` to args. This makes Codex output JSONL events to stdout (like `{"type":"message","content":"..."}`) instead of mixed terminal output. Update `execOnce()` result parsing in `agent-runner.ts` to detect JSONL format and extract the final message content. Enables reliable output capture vs. scraping raw text. | ✅ Done |
| 5   | OB-1095 | **Add `-o` output file for reliable result capture** in `src/core/adapters/codex-adapter.ts` — generate a temp file path, push `'-o', tempFilePath` to args. After spawn completes, read the temp file for the agent's final answer. Falls back to stdout parsing if temp file is missing. Clean up temp file after read. This is Codex's recommended way to capture output reliably.                                    | ✅ Done |
| 6   | OB-1096 | **Fix stdin to `'ignore'`** in `src/core/adapters/codex-adapter.ts` (line 91) — change `stdin: 'pipe'` to remove the `stdin` field entirely (defaults to `'ignore'` in `execOnce()`). `codex exec --ephemeral` is non-interactive; piped stdin is unnecessary and may cause hangs on some Codex versions. Matches Claude and Aider adapter behavior.                                                                     | ✅ Done |
| 7   | OB-1097 | **Update Codex model list** in `src/core/adapters/codex-adapter.ts` (line 117-129) — update `isValidModel()` to include current Codex v0.104.0 models: `gpt-5.2-codex` (the new default), `o3`, `o4-mini`. Remove stale entries. Verify with `codex exec --help` output.                                                                                                                                                 | ✅ Done |
| 8   | OB-1098 | **Unit tests for Codex adapter fixes** — test: (a) `--skip-git-repo-check` always present in args, (b) default sandbox is `read-only` when no tools, (c) OPENAI_API_KEY validation throws on missing key, (d) `--json` flag present, (e) `-o` temp file arg present, (f) no `stdin` field in config (defaults to ignore), (g) updated model validation. Target: `tests/core/adapters/codex-adapter.test.ts`.             | ✅ Done |

---

## Phase 58 — Codex Provider: Enable Codex-Only Users (OB-F37, Track B)

> **Priority:** HIGH — users without Claude are completely locked out. This phase makes OpenBridge usable for OpenAI-only users.
> **Depends on:** Phase 57 (Codex worker fixes must land first).

| #   | Task ID | Description                                                                                                                                                                                                                                                                                                                                                                                                                                                   | Status  |
| --- | ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------- |
| 9   | OB-1100 | **Create `CodexProvider`** at `src/providers/codex/codex-provider.ts` — implement `AIProvider` interface (`initialize()`, `processMessage()`, `streamMessage()`, `isAvailable()`). Use `AgentRunner` + `CodexAdapter` internally (same pattern as `ClaudeCodeProvider`). `processMessage()` runs `codex exec` with the user's message. Parse output via `--json` JSONL or `-o` output file. No session management initially (every message is `--ephemeral`). | ✅ Done |
| 10  | OB-1101 | **Create `CodexConfig` schema** at `src/providers/codex/codex-config.ts` — Zod schema with: `workspacePath` (string), `timeout` (number, default 120000), `model` (string, optional — default to Codex's own default), `sandbox` (string, optional). Mirror `ClaudeCodeConfig` pattern.                                                                                                                                                                       | ✅ Done |
| 11  | OB-1102 | **Register Codex provider** in `src/providers/index.ts` — add `registry.registerProvider('codex', (options) => new CodexProvider(options))` alongside `claude-code`. Both providers are now available.                                                                                                                                                                                                                                                        | ✅ Done |
| 12  | OB-1103 | **Provider-aware Master selection** in `src/index.ts` (lines 151-157) — if `selectedMaster.name === 'codex'`, use `CodexProvider` instead of `ClaudeCodeProvider`. Update the provider lookup to match the discovered master tool name to the correct provider factory. If neither provider matches, throw with a clear error naming available options.                                                                                                       | ✅ Done |
| 13  | OB-1104 | **Add Codex session management** at `src/providers/codex/session-manager.ts` — Codex v0.104.0 supports `codex exec resume --last` and session IDs. Implement `getOrCreate(key)` that returns session state. For first message: use `--ephemeral`. For follow-ups: use `codex exec resume --last` or session ID from prior output. Enables multi-turn conversations like Claude's `--session-id`.                                                              | ✅ Done |
| 14  | OB-1105 | **Add Codex MCP passthrough** in `src/core/adapters/codex-adapter.ts` — Codex supports MCP natively via `codex mcp add`. When `opts.mcpConfigPath` is set, pass MCP servers via Codex's config system (`-c` flag or pre-configured servers). This enables MCP support for Codex workers alongside Claude workers.                                                                                                                                             | ✅ Done |
| 15  | OB-1106 | **Unit tests for Codex provider** — test: (a) `CodexProvider.processMessage()` returns result, (b) `isAvailable()` checks for codex binary, (c) session management creates/resumes sessions, (d) error classification for Codex-specific errors (rate limit, auth, timeout), (e) config validation. Target: `tests/providers/codex/`.                                                                                                                         | ✅ Done |

---

## Phase 59 — Codex Documentation + Validation (OB-F37)

> **Priority:** Required — all docs must reflect the Codex fixes and new Codex provider. Depends on Phases 57 + 58.
> **Docs affected:** ARCHITECTURE.md, API_REFERENCE.md, CONFIGURATION.md, TROUBLESHOOTING.md, WRITING_A_PROVIDER.md

| #   | Task ID | Description                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             | Status  |
| --- | ------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------- |
| 16  | OB-1107 | **Update `docs/ARCHITECTURE.md`** — add CLIAdapter layer documentation: (a) explain the `CLIAdapter` interface (`buildSpawnConfig`, `cleanEnv`, `mapCapabilityLevel`, `isValidModel`) from `src/core/cli-adapter.ts`, (b) document `AdapterRegistry` and how it maps tool names to adapters, (c) update the "Layer 3: AI Discovery" section to explain that discovered tools are resolved to CLIAdapters, (d) add `CodexAdapter` alongside `ClaudeAdapter` in the adapter listing, (e) update the startup flow diagram to show adapter resolution.                                                                      | ✅ Done |
| 17  | OB-1108 | **Update `docs/API_REFERENCE.md`** — add: (a) `CLIAdapter` interface with all methods documented, (b) `CLISpawnConfig` type, (c) `CodexAdapter` class with its specific flags (`--skip-git-repo-check`, `--json`, `-o`, `--sandbox`), (d) `CodexProvider` class and `CodexConfig` schema, (e) updated `SpawnOptions` showing all fields, (f) `AdapterRegistry` API. Currently only mentions `DiscoveredTool` with `name: 'codex'` but doesn't document any Codex-specific types.                                                                                                                                        | ✅ Done |
| 18  | OB-1109 | **Update `docs/CONFIGURATION.md`** — add: (a) Codex environment variables section (`OPENAI_API_KEY` required, how to set in `.env` or shell), (b) `master.tool: "codex"` override example, (c) explain that Codex requires `OPENAI_API_KEY` while Claude uses local auth, (d) document sandbox modes for Codex (`read-only`, `read-write`, `full-auto`). Currently mentions `codex` in `master.tool` override but doesn't explain Codex-specific requirements.                                                                                                                                                          | ✅ Done |
| 19  | OB-1110 | **Update `docs/TROUBLESHOOTING.md`** — add Codex-specific troubleshooting section: (a) "Codex worker exits with code 1" → `--skip-git-repo-check` fix, (b) "Codex auth error" → `OPENAI_API_KEY` not set, (c) "Codex output garbled" → enable `--json` mode, (d) "Codex model not found" → list valid models for v0.104.0, (e) "Codex-only setup fails" → need CodexProvider registered. Currently mentions Codex in "No AI CLI found" section only.                                                                                                                                                                    | ✅ Done |
| 20  | OB-1111 | **Update `docs/WRITING_A_PROVIDER.md`** — add CLIAdapter section: (a) explain the difference between `AIProvider` (Master capability) and `CLIAdapter` (worker capability), (b) document the `CLIAdapter` interface with a step-by-step guide for adding a new adapter, (c) explain `AdapterRegistry` registration, (d) show `CodexAdapter` as a real-world example alongside `ClaudeAdapter`, (e) update the "When you DON'T need a provider" section to reference CLIAdapter pattern. Currently says "add it to discovery" but doesn't explain how to write the CLI adapter that translates SpawnOptions to CLI args. | ✅ Done |
| 21  | OB-1112 | **Final Codex validation** — run `npm run test`, `npm run typecheck`, `npm run lint`, `npm run format:check`. Confirm 0 failures across all checks. Update `CLAUDE.md` (both workspace root + OpenBridge repo) with Codex provider in project structure. Mark OB-F37 as Fixed in `FINDINGS.md`. Update open/fixed counters.                                                                                                                                                                                                                                                                                             | ✅ Done |

---

## Phase 60 — MCP Integration: Core Pipeline + Master Awareness (OB-F36)

> **Priority:** Medium — unlocks entire MCP ecosystem for all channels. Master awareness is essential (not optional) — without it the Master can't autonomously decide when to use external services.
> **Finding:** [OB-F36](FINDINGS.md#1--ob-f36--no-mcp-model-context-protocol-support--workers-cant-use-external-services)
> **CLI flags:** `claude --mcp-config <configs...>` + `--strict-mcp-config`
> **Scope:** Claude CLI only. Codex/Aider adapters ignore MCP fields (no `--mcp-config` equivalent). Codex MCP passthrough wired in Phase 58 (OB-1105).

| #   | Task ID | Description                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       | Status  |
| --- | ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------- |
| 22  | OB-1070 | **Add `MCPServerSchema` + `MCPConfigSchema` to `src/types/config.ts`** — `MCPServerSchema`: `name` (string), `command` (string), `args` (string[], optional), `env` (Record<string, string>, optional). `MCPConfigSchema`: `enabled` (boolean, default true), `servers` (MCPServerSchema[], default []), `configPath` (string, optional — path to existing Claude Desktop/Code MCP config to import). Add `mcp: MCPConfigSchema.optional()` to `V2ConfigSchema`. Export `MCPServer`, `MCPConfig` types.                                                                                                                                                                                           | ✅ Done |
| 23  | OB-1071 | **Add `mcpConfigPath` + `strictMcpConfig` to `SpawnOptions`** in `src/core/agent-runner.ts` (line 349) — `mcpConfigPath?: string` (path to MCP config JSON for `--mcp-config`), `strictMcpConfig?: boolean` (enables `--strict-mcp-config` to isolate from global MCP configs). Add JSDoc for both fields.                                                                                                                                                                                                                                                                                                                                                                                        | ✅ Done |
| 24  | OB-1072 | **Add `mcpServers` to `TaskManifestSchema`** in `src/types/agent.ts` (line 265) — `mcpServers: z.array(MCPServerSchema).optional()`. Import `MCPServerSchema` from `config.ts`. Master AI specifies per-worker MCP servers in TaskManifests.                                                                                                                                                                                                                                                                                                                                                                                                                                                      | ✅ Done |
| 25  | OB-1073 | **Update `manifestToSpawnOptions()` with per-worker MCP isolation** in `src/core/agent-runner.ts` (line 294) — when `manifest.mcpServers` is non-empty: (a) generate a **per-worker temp JSON file** containing ONLY the requested servers (not all configured servers) in `{mcpServers: {[name]: {command, args, env}}}` format, (b) set `spawnOpts.mcpConfigPath` to temp file, (c) set `strictMcpConfig: true`. Register cleanup callback to delete temp file after spawn completes. **Security:** each worker only sees the MCP servers it needs.                                                                                                                                             | ✅ Done |
| 26  | OB-1074 | **Pass `--mcp-config` + `--strict-mcp-config` in `ClaudeAdapter.buildSpawnConfig()`** in `src/core/adapters/claude-adapter.ts` (line 29) — when `opts.mcpConfigPath` is set, push `'--mcp-config', opts.mcpConfigPath` after `--max-budget-usd` and before the prompt. When `opts.strictMcpConfig` is true, also push `'--strict-mcp-config'`. Update file header comment with new flags. No changes to Aider adapter (it ignores unknown SpawnOptions fields).                                                                                                                                                                                                                                   | ✅ Done |
| 27  | OB-1075 | **Write global MCP config on Bridge startup** in `src/core/config.ts` — when `V2Config.mcp` exists and has servers or `configPath`: (a) if `configPath` is set, validate file exists and is valid JSON, (b) if inline `servers` are defined, transform to Claude CLI format and write `.openbridge/mcp-config.json`, (c) if both, merge (inline servers override same-name imports). Export `getMcpConfigPath(): string \| null` helper for other modules.                                                                                                                                                                                                                                        | ✅ Done |
| 28  | OB-1077 | **Extend Master system prompt with MCP awareness** in `src/master/master-system-prompt.ts` — add `mcpServers?: MCPServer[]` to `MasterSystemPromptContext`. In `generateMasterSystemPrompt()`, add "Available MCP Servers" section listing each server name + description of what it provides. Instruct Master: "To use an external service, include `mcpServers` in the worker TaskManifest with only the servers that worker needs." Only render section when servers are configured.                                                                                                                                                                                                           | ✅ Done |
| 29  | OB-1078 | **Pass MCP config to Master context** in `src/master/master-manager.ts` — when building Master system prompt context, read MCP servers from loaded `V2Config.mcp.servers` (merged with any `configPath` imports from the config writer task) and pass into `MasterSystemPromptContext.mcpServers`. Master now autonomously knows which external services are available and can decide when workers need them.                                                                                                                                                                                                                                                                                     | ✅ Done |
| 30  | OB-1076 | **Unit tests for MCP core pipeline** — (a) `MCPServerSchema`/`MCPConfigSchema` validation: valid configs, missing required fields, extra fields passthrough, `configPath` validation; (b) `manifestToSpawnOptions()`: temp file generation with only requested servers, cleanup after spawn, empty mcpServers produces no config; (c) `ClaudeAdapter.buildSpawnConfig()`: correct `--mcp-config`/`--strict-mcp-config` flag positions, no MCP flags when field is absent; (d) Master system prompt: includes MCP section when servers present, omits when not; (e) Master context receives servers from V2Config. Target: `tests/core/mcp-config.test.ts` + `tests/master/mcp-awareness.test.ts`. | ✅ Done |

---

## Phase 61 — MCP Integration: UX Polish (OB-F36)

> **Priority:** Medium — improves setup experience and operational visibility. Can run after Phase 60.

| #   | Task ID | Description                                                                                                                                                                                                                                                                                                                                                                                                                 | Status    |
| --- | ------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------- |
| 31  | OB-1079 | **Add MCP server health checks** in `src/core/health.ts` — extend `HealthStatus` with `mcp: { enabled: boolean, servers: Array<{ name: string, status: 'configured' \| 'error', command: string }> }`. On health check, verify each configured MCP server's command exists on PATH via `which`. Report in `/health` endpoint. Gracefully handle case where `mcp` is not configured (omit section or show `enabled: false`). | ◻ Pending |
| 32  | OB-1081 | **Update `config.example.json`** — add `mcp` section with two example servers: one inline (filesystem) and one showing `env` vars (generic external service). Add `configPath` example (commented out) pointing to Claude Desktop config. Keep minimal — users should understand it in 10 seconds.                                                                                                                          | ◻ Pending |
| 33  | OB-1082 | **Update `npx openbridge init`** in `src/cli/init.ts` — add optional step after auth config: "Enable MCP servers for external service access? (y/N)". If yes: ask for server name + command (loop until 'done'). Also ask: "Import existing MCP config from Claude Desktop? (path or skip)". Generate `mcp` section in output. Keep simple — advanced users edit JSON directly.                                             | ◻ Pending |
| 34  | OB-1080 | **Unit tests for UX polish** — (a) health endpoint includes MCP status when configured, omits when not, correctly reports `which` results; (b) CLI init generates valid MCP config, skipping produces no `mcp` field, multiple servers work, `configPath` import works. Target: `tests/core/mcp-health.test.ts` + `tests/cli/init-mcp.test.ts`.                                                                             | ◻ Pending |

---

## Phase 62 — MCP Integration: Documentation + Validation (OB-F36)

> **Priority:** Required — all docs must reflect the new MCP capability. Depends on Phases 60 + 61.

| #   | Task ID | Description                                                                                                                                                                                                                                                                                                                                                                                                                                                         | Status    |
| --- | ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------- |
| 35  | OB-1084 | **Update `docs/ARCHITECTURE.md`** — add MCP as layer 6 in the architecture overview. Diagram: Channel -> Router -> Master -> Worker + MCP -> External Service. Explain: (a) MCP servers are external processes spawned by Claude CLI per worker invocation, (b) per-worker isolation via temp config + `--strict-mcp-config`, (c) Master decides which workers get which MCP servers, (d) Claude-only scope initially, Codex MCP via native `codex mcp` (Phase 58). | ◻ Pending |
| 36  | OB-1085 | **Update `docs/CONFIGURATION.md`** — add full `mcp` config section: schema reference, all fields explained, examples for popular MCP servers (filesystem, git, Gmail, Slack), `configPath` import from Claude Desktop/Code, `--strict-mcp-config` isolation, security model (per-worker temp configs), link to MCP ecosystem. Note: MCP is Claude-only (Codex has native MCP support wired separately).                                                             | ◻ Pending |
| 37  | OB-1086 | **Update `docs/API_REFERENCE.md`** — add `MCPServerSchema`, `MCPConfigSchema` types, `getMcpConfigPath()` helper, updated `SpawnOptions` with `mcpConfigPath` + `strictMcpConfig`, updated `TaskManifestSchema` with `mcpServers`, updated `HealthStatus` with `mcp` field, updated `MasterSystemPromptContext` with `mcpServers`.                                                                                                                                  | ◻ Pending |
| 38  | OB-1087 | **Update `CLAUDE.md` (both workspace root + OpenBridge repo)** — add MCP to project structure, add MCP to "Key Architecture" and "Important Design Decisions" sections (per-worker isolation, Master-driven assignment, Claude-only scope), update `config.example.json` description, add v0.0.4 milestone. Update `README.md` feature list with MCP support.                                                                                                       | ◻ Pending |
| 39  | OB-1088 | **Update `CHANGELOG.md` + `ROADMAP.md`** — add `[Unreleased]` entries for MCP support: config schema, Claude adapter `--mcp-config`, Master MCP awareness, per-worker isolation, health checks, CLI init. Update roadmap to mark MCP as shipped, update version milestones.                                                                                                                                                                                         | ◻ Pending |
| 40  | OB-1089 | **Final MCP validation** — run `npm run test`, `npm run typecheck`, `npm run lint`, `npm run format:check`. Confirm 0 failures across all checks. Mark OB-F36 as Fixed in `FINDINGS.md`. Update open/fixed counters.                                                                                                                                                                                                                                                | ◻ Pending |
| 41  | OB-1090 | **Update `docs/USE_CASES.md`** — add MCP use case section: "Connecting OpenBridge to External Services" with end-to-end examples (send WhatsApp -> Master -> Worker + Canva MCP -> banner created -> result back to WhatsApp). Include setup steps for one real MCP server.                                                                                                                                                                                         | ◻ Pending |

---

## Phase Summary

| Phase  | Name                                        | Tasks   | Finding        | Priority | Effort       |
| ------ | ------------------------------------------- | ------- | -------------- | -------- | ------------ |
| **57** | Fix Codex Worker Failures (Track A)         | 8 (8✅) | OB-F37         | HIGH     | Medium       |
| **58** | Codex Provider (Track B)                    | 7 (7✅) | OB-F37         | HIGH     | Large        |
| **59** | Codex Documentation + Validation            | 6 (6✅) | OB-F37         | HIGH     | Small–Medium |
| **60** | MCP Core Pipeline + Master Awareness        | 9 (3✅) | OB-F36         | Medium   | Medium       |
| **61** | MCP UX Polish (health, CLI, example config) | 4       | OB-F36         | Medium   | Small        |
| **62** | MCP Documentation + Validation              | 7       | OB-F36         | Medium   | Small–Medium |
|        | **Total**                                   | **41**  | **2 findings** |          |              |

---

## Dependency Graph

```
Phase 57 (Fix Codex Workers — HIGH, runs first) ────────────────────────────
  ├── OB-1091 (--skip-git-repo-check) ← CRITICAL, fixes #1 failure cause
  ├── OB-1092 (default sandbox read-only)
  ├── OB-1093 (OPENAI_API_KEY validation)
  ├── OB-1094 (--json output)     ─┐
  ├── OB-1095 (-o output capture)  ├── OB-1098 (tests)
  ├── OB-1096 (fix stdin)         ─┘
  └── OB-1097 (update model list)

Phase 58 (Codex Provider — HIGH) — depends on Phase 57
  ├── OB-1100 (CodexProvider) ─────────┐
  ├── OB-1101 (CodexConfig schema)     ├── OB-1103 (Master selection)
  ├── OB-1102 (register provider)  ────┘
  ├── OB-1104 (session management)
  ├── OB-1105 (Codex MCP passthrough)
  └── OB-1106 (tests)

Phase 59 (Codex Documentation — HIGH) — depends on Phases 57 + 58
  ├── OB-1107 (ARCHITECTURE.md — CLIAdapter layer)
  ├── OB-1108 (API_REFERENCE.md — CodexAdapter, CodexProvider)
  ├── OB-1109 (CONFIGURATION.md — OPENAI_API_KEY, sandbox modes)
  ├── OB-1110 (TROUBLESHOOTING.md — Codex errors)
  ├── OB-1111 (WRITING_A_PROVIDER.md — CLIAdapter pattern)
  └── OB-1112 (final Codex validation + close OB-F37)

Phase 60 (MCP Core + Master Awareness — Medium) ───────────────────────────
  ├── OB-1070 (Zod schemas) ──────────────┐
  ├── OB-1071 (SpawnOptions)              ├── OB-1073 (manifestToSpawnOptions + isolation)
  ├── OB-1072 (TaskManifest + mcpServers) ┘       │
  │                                                ├── OB-1076 (tests)
  ├── OB-1074 (Claude adapter --mcp-config) ──────┘
  ├── OB-1075 (config file writer + configPath import)
  ├── OB-1077 (Master system prompt MCP section) ─┐
  └── OB-1078 (Master context MCP passthrough) ───┘

Phase 61 (MCP UX Polish — Medium) — depends on Phase 60
  ├── OB-1079 (health checks)
  ├── OB-1081 (config.example.json)
  ├── OB-1082 (CLI init MCP step)
  └── OB-1080 (tests for health + CLI)

Phase 62 (MCP Documentation — Medium) — depends on Phases 60 + 61
  ├── OB-1084–1088 (docs)
  ├── OB-1090 (USE_CASES.md)
  └── OB-1089 (final MCP validation + close OB-F36)
```

---

## Key Design Decisions

### Codex (Phases 57–59)

**1. `--skip-git-repo-check` Is Mandatory:** Codex v0.104.0 refuses to run outside trusted git repos. OpenBridge validates workspace paths separately, so the flag is always safe.

**2. OPENAI_API_KEY Must Be Validated Early:** Failing at spawn time with a cryptic error wastes 3 retries. Check the env var in `buildSpawnConfig()` and throw a clear error.

**3. `--json` + `-o` for Reliable Output:** Scraping raw terminal output is fragile. Codex's JSONL mode and `--output-last-message` give structured, reliable results.

**4. Codex Provider Mirrors Claude Provider:** Same `AIProvider` interface, same `AgentRunner` + adapter pattern. Reuse existing patterns, don't invent new ones.

**5. Codex MCP via Native `codex mcp`:** Codex has its own MCP system. Phase 58 bridges it so both Claude and Codex workers can use MCP servers.

### MCP (Phases 60–62)

**6. Per-Worker MCP Isolation (Security):** Each worker gets a temp MCP config containing ONLY the servers it needs. Combined with `--strict-mcp-config`, no cross-contamination of API keys.

**7. Master Awareness Is Essential:** Master must see available MCP servers in its system prompt to autonomously decide when to use external services.

**8. MCP Server Lifecycle — Per-Worker:** Claude CLI spawns MCP servers per invocation. Matches bounded-worker philosophy.

**9. Config Source Flexibility:** Inline servers, import from Claude Desktop/Code config via `configPath`, or both.

**10. MCP Scope:** `--mcp-config` is Claude-specific. Codex has its own MCP system via `codex mcp` (wired in Phase 58, OB-1105). Both paths converge: users configure MCP once, workers use their tool's native MCP support.

---

## Claude CLI MCP Flag Reference

```bash
# --mcp-config takes JSON file paths or inline JSON strings
claude --print --mcp-config ./mcp-servers.json "your prompt here"

# With --strict-mcp-config to ignore global/project MCP configs
claude --print --mcp-config ./mcp-servers.json --strict-mcp-config "your prompt here"
```

### MCP Config JSON Format (what Claude CLI expects)

```json
{
  "mcpServers": {
    "canva": {
      "command": "npx",
      "args": ["-y", "@anthropic/canva-mcp-server"],
      "env": { "CANVA_API_KEY": "sk-..." }
    }
  }
}
```

### OpenBridge Config Format (what users write in config.json)

```json
{
  "workspacePath": "/path/to/project",
  "channels": [{ "type": "console" }],
  "auth": { "whitelist": ["+1234567890"] },
  "mcp": {
    "enabled": true,
    "servers": [
      {
        "name": "canva",
        "command": "npx",
        "args": ["-y", "@anthropic/canva-mcp-server"],
        "env": { "CANVA_API_KEY": "sk-..." }
      }
    ],
    "configPath": "~/.claude/claude_desktop_config.json"
  }
}
```

### End-to-End Flow

```
User: "Create a banner in Canva" (via WhatsApp)
  -> Router -> Master AI
  -> Master sees MCP servers in system prompt: [canva, gmail]
  -> Master spawns worker with TaskManifest:
      { prompt: "Create a banner...", mcpServers: [{name: "canva", ...}] }
  -> manifestToSpawnOptions():
      writes /tmp/ob-mcp-abc123.json (canva ONLY, not gmail)
      sets strictMcpConfig: true
  -> ClaudeAdapter adds: --mcp-config /tmp/ob-mcp-abc123.json --strict-mcp-config
  -> Claude CLI spawns Canva MCP server, calls canva tools
  -> Worker returns result, temp file cleaned up
  -> Master -> Router -> WhatsApp
```

---

## Status Legend

|  Status   | Description               |
| :-------: | ------------------------- |
|  ✅ Done  | Completed and verified    |
| 🔄 Active | Currently being worked on |
| ◻ Pending | Not started               |
