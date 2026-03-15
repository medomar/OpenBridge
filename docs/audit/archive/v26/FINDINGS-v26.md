# OpenBridge — Archived Findings v26

> **Version:** v0.1.1
> **Period:** 2026-03-15
> **Findings Fixed:** 9 (OB-F185, F186, F192–F198)
> **Source:** Real-world testing on elgrotte-data workspace

---

### OB-F185 — DocType engine — structured business data management

- **Severity:** 🔴 Critical
- **Status:** ✅ Fixed (v0.1.0 — Phases 117–118)
- **Key Files:** `src/intelligence/doctype-store.ts`, `src/intelligence/doctype-api.ts`, `src/memory/migration.ts` (v18)
- **Fix Applied:** Full DocType engine in `src/intelligence/` with 40+ files. 7 DB tables (doctypes, doctype_fields, doctype_states, doctype_transitions, doctype_hooks, doctype_relations, dt_series). State machines, lifecycle hooks, form generation, business document templates.

### OB-F186 — Integration hub — external business service connections

- **Severity:** 🟠 High
- **Status:** ✅ Fixed (v0.1.0 — Phases 119–120)
- **Key Files:** `src/integrations/hub.ts`, `src/integrations/credential-store.ts`, `src/types/integration.ts`
- **Fix Applied:** IntegrationHub with 8 adapters (Stripe, Google Drive, Google Sheets, Google Calendar, Email, Database, Dropbox, OpenAPI). AES-256-GCM encrypted credential store. Health checks, webhook routing, event bridge.

### OB-F192 — Exploration prompt truncated by 66% (97K chars → 32K limit)

- **Severity:** 🟡 Medium
- **Status:** ✅ Fixed (Phase 129 — OB-1514)
- **Key Files:** `src/core/agent-runner.ts`, `src/master/exploration-prompts.ts`
- **Fix Applied:** Per-phase 16K char budget, `trimPayload()` utility for progressive data reduction, slim workspace map for incremental prompts.

### OB-F193 — .openbridge state files not persisting between restarts

- **Severity:** 🟢 Low
- **Status:** ✅ Fixed (Phase 128 — OB-1509)
- **Key Files:** `src/master/dotfolder-manager.ts`
- **Fix Applied:** `fs.access()` guard before reads, return defaults silently on first run, DEBUG instead of WARN for expected missing files.

### OB-F194 — workspace-map.json never created after exploration — ENOENT on every message

- **Severity:** 🟠 High
- **Status:** ✅ Fixed (Phase 128 — OB-1506–1510)
- **Key Files:** `src/master/dotfolder-manager.ts`, `src/master/exploration-coordinator.ts`
- **Fix Applied:** `readWorkspaceMap()` returns `null` silently, WARN only on first miss. Post-exploration assertion validates file exists. Assembly phase writes workspace-map.json.

### OB-F195 — Codex workers lack per-worker cost cap — single worker can cost $0.28

- **Severity:** 🟡 Medium
- **Status:** ✅ Fixed (Phase 131 — OB-1521–1525)
- **Key Files:** `src/core/agent-runner.ts`, `src/core/cost-manager.ts`, `src/master/worker-orchestrator.ts`
- **Fix Applied:** Per-profile cost caps (read-only $0.05, code-edit $0.10, full-access $0.15). SIGTERM on breach, partial result with `costCapped: true`, metrics tracking.

### OB-F196 — Stale "running" agent_activity records for completed Codex workers

- **Severity:** 🟡 Medium
- **Status:** ✅ Fixed (Phase 130 — OB-1517–1520)
- **Key Files:** `src/memory/activity-store.ts`, `src/master/worker-orchestrator.ts`
- **Fix Applied:** `finally` block safety-net, `sweepStaleRunning()` method, startup sweep for orphaned records, `'abandoned'` status variant.

### OB-F197 — Prompt truncation at 84% — Master context destroyed for large sessions

- **Severity:** 🟠 High
- **Status:** ✅ Fixed (Phase 129 — OB-1511–1516)
- **Key Files:** `src/core/agent-runner.ts`, `src/master/prompt-context-builder.ts`, `src/master/session-compactor.ts`
- **Fix Applied:** Budget-aware assembly (system 8K + memory 4K + workspace 4K + RAG 6K + conversation 10K = 32K). Prompt-size compaction trigger at 80%. Graduated truncation with WARN logging. Prompt-size metrics.

### OB-F198 — Classification engine falls back to "tool-use" for conversational messages

- **Severity:** 🟢 Low
- **Status:** ✅ Fixed (Phase 132 — OB-1526–1530)
- **Key Files:** `src/master/classification-engine.ts`
- **Fix Applied:** Conversational intent patterns added, batch-mode tightened (compound patterns only), AI classifier priority (confidence ≥ 0.4 beats keywords), default fallback changed to `quick-answer` (5 turns).
