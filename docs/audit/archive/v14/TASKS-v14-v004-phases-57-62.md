# OpenBridge — Task Archive: v0.0.4 Phases 57–62

> **Tasks:** 41 | **All Done** | **Archived:** 2026-02-27

---

## Phase 57 — Fix Codex Worker Failures (OB-F37, Track A)

> **Priority:** HIGH — Codex workers are completely broken. Users with Claude+Codex can't delegate to Codex workers.
> **Finding:** OB-F37

| #   | Task ID | Description                                                                                                                                                                                                                                                                                                                                                                            | Status  |
| --- | ------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------- |
| 1   | OB-1091 | **Add `--skip-git-repo-check` to Codex adapter** in `src/core/adapters/codex-adapter.ts` — always push `'--skip-git-repo-check'` after `'exec'`. OpenBridge already validates workspace path separately (`workspace-manager.ts`). Without this flag, Codex exits immediately with code 1 from non-git or untrusted directories. This is the **#1 cause** of all Codex worker failures. | ✅ Done |
| 2   | OB-1092 | **Default sandbox to `read-only` when no tools specified** in `src/core/adapters/codex-adapter.ts` — change `inferSandboxMode()` to return `'read-only'` instead of `undefined` when `allowedTools` is empty/undefined.                                                                                                                                                                | ✅ Done |
| 3   | OB-1093 | **Validate OPENAI_API_KEY before spawn** in `src/core/adapters/codex-adapter.ts` — in `buildSpawnConfig()`, check `process.env['OPENAI_API_KEY']` exists. If missing, log a clear error and throw `Error` (caught by AgentRunner retry logic, classified as 'auth').                                                                                                                   | ✅ Done |
| 4   | OB-1094 | **Add `--json` flag for structured output** in `src/core/adapters/codex-adapter.ts` — push `'--json'` to args. Update `execOnce()` result parsing to detect JSONL format and extract the final message content.                                                                                                                                                                        | ✅ Done |
| 5   | OB-1095 | **Add `-o` output file for reliable result capture** in `src/core/adapters/codex-adapter.ts` — generate a temp file path, push `'-o', tempFilePath` to args. After spawn completes, read the temp file for the agent's final answer. Falls back to stdout parsing if temp file is missing. Clean up temp file after read.                                                              | ✅ Done |
| 6   | OB-1096 | **Fix stdin to `'ignore'`** in `src/core/adapters/codex-adapter.ts` — remove the `stdin` field entirely (defaults to `'ignore'` in `execOnce()`). `codex exec --ephemeral` is non-interactive; piped stdin is unnecessary and may cause hangs.                                                                                                                                         | ✅ Done |
| 7   | OB-1097 | **Update Codex model list** in `src/core/adapters/codex-adapter.ts` — update `isValidModel()` to include current Codex v0.104.0 models: `gpt-5.2-codex` (the new default), `o3`, `o4-mini`.                                                                                                                                                                                            | ✅ Done |
| 8   | OB-1098 | **Unit tests for Codex adapter fixes** — test all flags, sandbox defaults, API key validation, model validation. Target: `tests/core/adapters/codex-adapter.test.ts`.                                                                                                                                                                                                                  | ✅ Done |

---

## Phase 58 — Codex Provider: Enable Codex-Only Users (OB-F37, Track B)

> **Priority:** HIGH — users without Claude are completely locked out.
> **Depends on:** Phase 57.

| #   | Task ID | Description                                                                                                                                                                                                            | Status  |
| --- | ------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------- |
| 9   | OB-1100 | **Create `CodexProvider`** at `src/providers/codex/codex-provider.ts` — implement `AIProvider` interface (`initialize()`, `processMessage()`, `streamMessage()`, `isAvailable()`). Use `AgentRunner` + `CodexAdapter`. | ✅ Done |
| 10  | OB-1101 | **Create `CodexConfig` schema** at `src/providers/codex/codex-config.ts` — Zod schema with `workspacePath`, `timeout`, `model`, `sandbox`.                                                                             | ✅ Done |
| 11  | OB-1102 | **Register Codex provider** in `src/providers/index.ts` — add alongside `claude-code`.                                                                                                                                 | ✅ Done |
| 12  | OB-1103 | **Provider-aware Master selection** in `src/index.ts` — if `selectedMaster.name === 'codex'`, use `CodexProvider`.                                                                                                     | ✅ Done |
| 13  | OB-1104 | **Add Codex session management** at `src/providers/codex/session-manager.ts` — session resume via `codex exec resume --last`.                                                                                          | ✅ Done |
| 14  | OB-1105 | **Add Codex MCP passthrough** in `src/core/adapters/codex-adapter.ts` — pass MCP servers via `-c` flag.                                                                                                                | ✅ Done |
| 15  | OB-1106 | **Unit tests for Codex provider** — target: `tests/providers/codex/`.                                                                                                                                                  | ✅ Done |

---

## Phase 59 — Codex Documentation + Validation (OB-F37)

> **Priority:** Required — all docs must reflect the Codex fixes and new Codex provider.

| #   | Task ID | Description                                                                                 | Status  |
| --- | ------- | ------------------------------------------------------------------------------------------- | ------- |
| 16  | OB-1107 | **Update `docs/ARCHITECTURE.md`** — add CLIAdapter layer documentation.                     | ✅ Done |
| 17  | OB-1108 | **Update `docs/API_REFERENCE.md`** — add CLIAdapter, CodexAdapter, CodexProvider types.     | ✅ Done |
| 18  | OB-1109 | **Update `docs/CONFIGURATION.md`** — add Codex env vars, sandbox modes.                     | ✅ Done |
| 19  | OB-1110 | **Update `docs/TROUBLESHOOTING.md`** — add Codex-specific troubleshooting section.          | ✅ Done |
| 20  | OB-1111 | **Update `docs/WRITING_A_PROVIDER.md`** — add CLIAdapter pattern with CodexAdapter example. | ✅ Done |
| 21  | OB-1112 | **Final Codex validation** — all checks pass, OB-F37 marked Fixed.                          | ✅ Done |

---

## Phase 60 — MCP Integration: Core Pipeline + Master Awareness (OB-F36)

> **Priority:** Medium — unlocks entire MCP ecosystem for all channels.

| #   | Task ID | Description                                                                                                            | Status  |
| --- | ------- | ---------------------------------------------------------------------------------------------------------------------- | ------- |
| 22  | OB-1070 | **Add `MCPServerSchema` + `MCPConfigSchema`** to `src/types/config.ts`. Add `mcp` to `V2ConfigSchema`.                 | ✅ Done |
| 23  | OB-1071 | **Add `mcpConfigPath` + `strictMcpConfig`** to `SpawnOptions` in `src/core/agent-runner.ts`.                           | ✅ Done |
| 24  | OB-1072 | **Add `mcpServers`** to `TaskManifestSchema` in `src/types/agent.ts`.                                                  | ✅ Done |
| 25  | OB-1073 | **Update `manifestToSpawnOptions()`** with per-worker MCP isolation — temp config + `--strict-mcp-config`.             | ✅ Done |
| 26  | OB-1074 | **Pass `--mcp-config` + `--strict-mcp-config`** in `ClaudeAdapter.buildSpawnConfig()`.                                 | ✅ Done |
| 27  | OB-1075 | **Write global MCP config on Bridge startup** in `src/core/config.ts` — `getMcpConfigPath()` helper.                   | ✅ Done |
| 28  | OB-1077 | **Extend Master system prompt with MCP awareness** in `src/master/master-system-prompt.ts`.                            | ✅ Done |
| 29  | OB-1078 | **Pass MCP config to Master context** in `src/master/master-manager.ts`.                                               | ✅ Done |
| 30  | OB-1076 | **Unit tests for MCP core pipeline** — target: `tests/core/mcp-config.test.ts` + `tests/master/mcp-awareness.test.ts`. | ✅ Done |

---

## Phase 61 — MCP Integration: UX Polish (OB-F36)

> **Priority:** Medium — improves setup experience and operational visibility.

| #   | Task ID | Description                                                                                            | Status  |
| --- | ------- | ------------------------------------------------------------------------------------------------------ | ------- |
| 31  | OB-1079 | **Add MCP server health checks** in `src/core/health.ts` — verify commands exist on PATH via `which`.  | ✅ Done |
| 32  | OB-1081 | **Update `config.example.json`** — add `mcp` section with example servers.                             | ✅ Done |
| 33  | OB-1082 | **Update `npx openbridge init`** in `src/cli/init.ts` — add optional MCP configuration step.           | ✅ Done |
| 34  | OB-1080 | **Unit tests for UX polish** — target: `tests/core/mcp-health.test.ts` + `tests/cli/init-mcp.test.ts`. | ✅ Done |

---

## Phase 62 — MCP Integration: Documentation + Validation (OB-F36)

> **Priority:** Required — all docs must reflect the new MCP capability.

| #   | Task ID | Description                                                                              | Status  |
| --- | ------- | ---------------------------------------------------------------------------------------- | ------- |
| 35  | OB-1084 | **Update `docs/ARCHITECTURE.md`** — add MCP as layer 6.                                  | ✅ Done |
| 36  | OB-1085 | **Update `docs/CONFIGURATION.md`** — add full `mcp` config section.                      | ✅ Done |
| 37  | OB-1086 | **Update `docs/API_REFERENCE.md`** — add MCP schemas and updated SpawnOptions.           | ✅ Done |
| 38  | OB-1087 | **Update `CLAUDE.md` (both workspace root + OpenBridge repo)** — add MCP throughout.     | ✅ Done |
| 39  | OB-1088 | **Update `CHANGELOG.md` + `ROADMAP.md`** — add MCP entries.                              | ✅ Done |
| 40  | OB-1089 | **Final MCP validation** — all checks pass, OB-F36 marked Fixed.                         | ✅ Done |
| 41  | OB-1090 | **Update `docs/USE_CASES.md`** — add MCP use case section with end-to-end Canva example. | ✅ Done |

---

## Phase Summary

| Phase  | Name                                        | Tasks   | Finding | Priority | Effort       |
| ------ | ------------------------------------------- | ------- | ------- | -------- | ------------ |
| **57** | Fix Codex Worker Failures (Track A)         | 8 (8✅) | OB-F37  | HIGH     | Medium       |
| **58** | Codex Provider (Track B)                    | 7 (7✅) | OB-F37  | HIGH     | Large        |
| **59** | Codex Documentation + Validation            | 6 (6✅) | OB-F37  | HIGH     | Small–Medium |
| **60** | MCP Core Pipeline + Master Awareness        | 9 (9✅) | OB-F36  | Medium   | Medium       |
| **61** | MCP UX Polish (health, CLI, example config) | 4 (4✅) | OB-F36  | Medium   | Small        |
| **62** | MCP Documentation + Validation              | 7 (7✅) | OB-F36  | Medium   | Small–Medium |
|        | **Total**                                   | **41**  |         |          |              |
