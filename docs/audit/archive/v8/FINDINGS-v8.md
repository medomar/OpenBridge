# OpenBridge — Findings Archive v8 (Phases 57–62)

> **Findings archived:** 2 (OB-F36, OB-F37)
> **All fixed in:** v0.0.4 (Phases 57–62)
> **Archived:** 2026-02-27

---

### OB-F36 — No MCP (Model Context Protocol) support — workers can't use external services

**Discovered:** 2026-02-27 (WebChat conversation + feasibility analysis)
**Fixed:** 2026-02-27 (Phases 60–62: 20 tasks, OB-1070–OB-1090)
**Component:** `src/core/agent-runner.ts`, `src/core/adapters/claude-adapter.ts`, `src/types/config.ts`, `src/master/master-system-prompt.ts`, `src/master/master-manager.ts`

**Problem:** OpenBridge had zero MCP support. Workers could not access external services (Gmail, Canva, Slack, GitHub, etc.) via the MCP ecosystem. Users could not leverage existing MCP server configurations from Claude Desktop or Claude Code.

**Fix:** Full MCP integration across 3 phases:

- **Phase 60 (Core):** `MCPServerSchema`/`MCPConfigSchema` Zod schemas, `mcpConfigPath`/`strictMcpConfig` on SpawnOptions, `mcpServers` on TaskManifest, per-worker temp MCP config isolation with `--strict-mcp-config`, `--mcp-config` in ClaudeAdapter, global MCP config writer, Master system prompt MCP awareness, MCP context wired to MasterManager.
- **Phase 61 (UX):** MCP server health checks (`which`-based command validation), `config.example.json` MCP section, `npx openbridge init` MCP step.
- **Phase 62 (Docs):** ARCHITECTURE.md (layer 6), CONFIGURATION.md (full MCP section), API_REFERENCE.md (all MCP types), CLAUDE.md (both files), CHANGELOG.md, ROADMAP.md, USE_CASES.md (Canva end-to-end example).

---

### OB-F37 — Codex workers always fail + no Codex provider (users without Claude locked out)

**Discovered:** 2026-02-27 (real-world testing + deep pipeline analysis)
**Fixed:** 2026-02-27 (Phases 57–59: 21 tasks, OB-1091–OB-1112)
**Component:** `src/core/adapters/codex-adapter.ts`, `src/core/agent-runner.ts`, `src/providers/`, `src/index.ts`

**Problem:** Multiple issues: (1) Missing `--skip-git-repo-check` caused all Codex workers to fail from non-git directories. (2) No Codex provider meant users without Claude were completely locked out. (3) Outdated CLI flags, no OPENAI_API_KEY validation, permissive default sandbox, no structured output.

**Fix:** Full Codex support across 3 phases:

- **Phase 57 (Adapter):** `--skip-git-repo-check` always present, default sandbox `read-only`, OPENAI_API_KEY validation, `--json` structured output, `-o` temp file output capture, stdin fixed to ignore, updated model list (gpt-5.2-codex, o3, o4-mini).
- **Phase 58 (Provider):** CodexProvider implementing AIProvider, CodexConfig Zod schema, provider registration, provider-aware Master selection, CodexSessionManager (TTL-based), Codex MCP passthrough via `-c` flag. 119 tests.
- **Phase 59 (Docs):** ARCHITECTURE.md (CLIAdapter layer), API_REFERENCE.md (CodexAdapter, CodexProvider, CodexConfig), CONFIGURATION.md (OPENAI_API_KEY, sandbox modes), TROUBLESHOOTING.md (Codex errors), WRITING_A_PROVIDER.md (CLIAdapter pattern).
