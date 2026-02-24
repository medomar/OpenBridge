# OpenBridge — Archived Findings (V0)

> **Archived:** 2026-02-20
> **Covers:** 39 fixed issues + 20 archived issues from old vision
> **Total findings archived:** 59

---

## Fixed Issues (39)

### 🔴 Critical (Fixed)

| ID     | Description                                                                | Category    |  Status  | File           | Date       |
| ------ | -------------------------------------------------------------------------- | ----------- | :------: | -------------- | ---------- |
| OB-068 | `tsx watch` kills process during AI execution — responses never reach user | Core Engine | ✅ Fixed | `package.json` | 2026-02-20 |

### 🟠 High (Fixed)

| ID     | Description                                           | Category              |  Status  | File                      | Date       |
| ------ | ----------------------------------------------------- | --------------------- | :------: | ------------------------- | ---------- |
| OB-001 | No auto-reconnect on WhatsApp disconnect              | Connector Reliability | ✅ Fixed | `whatsapp-connector.ts`   | 2026-02-19 |
| OB-002 | No session recovery after crash                       | Connector Reliability | ✅ Fixed | `whatsapp-connector.ts`   | 2026-02-19 |
| OB-003 | No input sanitization                                 | Security              | ✅ Fixed | `claude-code-executor.ts` | 2026-02-19 |
| OB-004 | No rate limiting                                      | Security              | ✅ Fixed | `rate-limiter.ts`         | 2026-02-19 |
| OB-005 | No error retry in message queue                       | Core Engine           | ✅ Fixed | `queue.ts`                | 2026-02-19 |
| OB-006 | No streaming support                                  | Provider Robustness   | ✅ Fixed | `claude-code-executor.ts` | 2026-02-19 |
| OB-007 | No conversation context                               | Provider Robustness   | ✅ Fixed | `claude-code-provider.ts` | 2026-02-19 |
| OB-008 | No integration tests                                  | Testing               | ✅ Fixed | `tests/`                  | 2026-02-19 |
| OB-009 | WhatsApp connector tests missing                      | Testing               | ✅ Fixed | `tests/connectors/`       | 2026-02-19 |
| OB-010 | Claude Code provider tests missing                    | Testing               | ✅ Fixed | `tests/providers/`        | 2026-02-19 |
| OB-011 | No graceful message handling during shutdown          | Core Engine           | ✅ Fixed | `bridge.ts`, `queue.ts`   | 2026-02-19 |
| OB-012 | Bridge.stop() is a no-op stub                         | Core Engine           | ✅ Fixed | `bridge.ts`               | 2026-02-19 |
| OB-069 | No graceful shutdown guard for active child processes | Core Engine           | ✅ Fixed | `claude-code-executor.ts` | 2026-02-20 |
| OB-070 | CLI executor hardcoded to `claude` command            | Master AI             | ✅ Fixed | `claude-code-executor.ts` | 2026-02-20 |

### 🟡 Medium (Fixed)

| ID     | Description                         | Category              |  Status  | File                      | Date       |
| ------ | ----------------------------------- | --------------------- | :------: | ------------------------- | ---------- |
| OB-013 | No message chunking                 | Connector Reliability | ✅ Fixed | `whatsapp-connector.ts`   | 2026-02-19 |
| OB-014 | No typing indicator                 | Connector Reliability | ✅ Fixed | `whatsapp-connector.ts`   | 2026-02-19 |
| OB-015 | Tilde not resolved in workspacePath | Configuration         | ✅ Fixed | `claude-code-config.ts`   | 2026-02-19 |
| OB-016 | No validation workspacePath exists  | Configuration         | ✅ Fixed | `config.ts`               | 2026-02-19 |
| OB-017 | No config hot-reload                | Configuration         | ✅ Fixed | `config-watcher.ts`       | 2026-02-19 |
| OB-018 | No error classification             | Provider Robustness   | ✅ Fixed | `claude-code-provider.ts` | 2026-02-19 |
| OB-019 | No per-user message queue           | Core Engine           | ✅ Fixed | `queue.ts`                | 2026-02-19 |
| OB-020 | No progress updates                 | Core Engine           | ✅ Fixed | `router.ts`               | 2026-02-19 |
| OB-021 | No audit logging                    | Security              | ✅ Fixed | `audit-logger.ts`         | 2026-02-19 |
| OB-022 | No dead letter queue                | Core Engine           | ✅ Fixed | `queue.ts`                | 2026-02-19 |
| OB-023 | No health check endpoint            | Provider Robustness   | ✅ Fixed | `health.ts`               | 2026-02-19 |
| OB-024 | No metrics                          | Provider Robustness   | ✅ Fixed | `metrics.ts`              | 2026-02-19 |
| OB-025 | No deployment docs                  | Documentation         | ✅ Fixed | `docs/`                   | 2026-02-19 |
| OB-026 | No troubleshooting guide            | Documentation         | ✅ Fixed | `docs/`                   | 2026-02-19 |
| OB-027 | No command allow/deny list          | Security              | ✅ Fixed | `auth.ts`                 | 2026-02-19 |

### 🟢 Low (Fixed)

| ID     | Description                 | Category              |  Status  | File                    | Date       |
| ------ | --------------------------- | --------------------- | :------: | ----------------------- | ---------- |
| OB-028 | No multi-workspace support  | Configuration         | ✅ Fixed | `config.ts`             | 2026-02-19 |
| OB-029 | No message formatting       | Connector Reliability | ✅ Fixed | `whatsapp-formatter.ts` | 2026-02-19 |
| OB-030 | No plugin discovery         | Developer Experience  | ✅ Fixed | `registry.ts`           | 2026-02-19 |
| OB-031 | No CLI config generation    | Developer Experience  | ✅ Fixed | `src/cli/init.ts`       | 2026-02-19 |
| OB-032 | No E2E test harness         | Testing               | ✅ Fixed | `tests/`                | 2026-02-19 |
| OB-033 | No example plugins          | Documentation         | ✅ Fixed | `connectors/console/`   | 2026-02-19 |
| OB-034 | No API reference docs       | Documentation         | ✅ Fixed | `docs/API_REFERENCE.md` | 2026-02-20 |
| OB-035 | No CI badge                 | Developer Experience  | ✅ Fixed | `README.md`             | 2026-02-19 |
| OB-036 | No benchmarks               | Testing               | ✅ Fixed | `benchmarks/`           | 2026-02-20 |
| OB-037 | No provider name validation | Security              | ✅ Fixed | `config.ts`             | 2026-02-20 |

---

## Archived Issues — Old Vision (20)

These issues were from the old vision where users manually define `openbridge.map.json` files. That approach is replaced by autonomous AI exploration.

| ID     | Description                         | Old Phase |   Status    |
| ------ | ----------------------------------- | :-------: | :---------: |
| OB-038 | OVERVIEW.md wrong vision            |     5     | 📦 Archived |
| OB-039 | README.md wrong positioning         |     5     | 📦 Archived |
| OB-040 | ARCHITECTURE.md missing layers      |     5     | 📦 Archived |
| OB-041 | CLAUDE.md files outdated            |     5     | 📦 Archived |
| OB-042 | CONFIGURATION.md missing schemas    |     5     | 📦 Archived |
| OB-043 | No workspace map types              |     6     | 📦 Archived |
| OB-044 | No openbridge.map.json spec         |     6     | 📦 Archived |
| OB-045 | No workspace scanner                |     6     | 📦 Archived |
| OB-046 | No API executor                     |     6     | 📦 Archived |
| OB-047 | Workspace manager doesn't load maps |     6     | 📦 Archived |
| OB-048 | No workspace mapping tests          |     6     | 📦 Archived |
| OB-049 | No agent types                      |     7     | 📦 Archived |
| OB-050 | No Agent Orchestrator               |     7     | 📦 Archived |
| OB-051 | No Task Agent runtime               |     7     | 📦 Archived |
| OB-052 | No Script Coordinator               |     7     | 📦 Archived |
| OB-053 | Router doesn't use orchestrator     |     7     | 📦 Archived |
| OB-054 | Bridge doesn't wire orchestrator    |     7     | 📦 Archived |
| OB-055 | No orchestrator tests               |     7     | 📦 Archived |
| OB-056 | AIProvider interface no context     |     8     | 📦 Archived |
| OB-057 | No tool-use protocol                |     8     | 📦 Archived |
