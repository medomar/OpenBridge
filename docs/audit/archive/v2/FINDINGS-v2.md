# OpenBridge — Archived Findings (V2)

> **Archived:** 2026-02-21
> **Covers:** Findings F-001 through F-012 (all resolved)
> **Total findings archived:** 12 (4 High, 5 Medium, 1 Low, 2 already fixed in V1)

---

## F-001 — Dead code in compile path ✅ Fixed

| Field    | Value        |
| -------- | ------------ |
| Severity | 🟠 High      |
| Category | Code Quality |
| Found    | 2026-02-20   |
| Fixed    | 2026-02-20   |

**What:** The `src/knowledge/`, `src/orchestrator/`, `src/core/workspace-manager.ts`, and `src/core/map-loader.ts` modules were compiled but never called at runtime.

**Resolution:** Moved to `src/_archived/` (Phase 9, OB-088/089/090).

---

## F-002 — Documentation describes wrong architecture ✅ Fixed

| Field    | Value         |
| -------- | ------------- |
| Severity | 🟠 High       |
| Category | Documentation |
| Found    | 2026-02-20    |
| Fixed    | 2026-02-21    |

**What:** OVERVIEW.md, README.md, and ARCHITECTURE.md described the old "AI workforce platform" vision with user-defined workspace maps.

**Resolution:** Full documentation rewrite (Phase 13, OB-107/108/109/110/111/112).

---

## F-003 — Config requires unnecessary fields ✅ Fixed

| Field    | Value         |
| -------- | ------------- |
| Severity | 🟡 Medium     |
| Category | Configuration |
| Found    | 2026-02-20    |
| Fixed    | 2026-02-20    |

**What:** Config required `providers` array, `defaultProvider`, and `workspaces` — all of which should be auto-discovered.

**Resolution:** V2 config schema (OB-081) + config loader (OB-082).

---

## F-004 — No AI tool discovery capability ✅ Fixed

| Field    | Value           |
| -------- | --------------- |
| Severity | 🟠 High         |
| Category | Missing Feature |
| Found    | 2026-02-20      |
| Fixed    | 2026-02-20      |

**What:** OpenBridge could not detect which AI CLI tools or VS Code extensions were installed.

**Resolution:** Phase 6 (OB-071 through OB-074) — CLI scanner, VS Code scanner, unified module.

---

## F-005 — No autonomous workspace exploration ✅ Fixed

| Field    | Value           |
| -------- | --------------- |
| Severity | 🟠 High         |
| Category | Missing Feature |
| Found    | 2026-02-20      |
| Fixed    | 2026-02-21      |

**What:** No Master AI Manager existed. No `.openbridge/` folder was created. No exploration prompt was defined.

**Resolution:** Phase 7 (OB-075 through OB-080) + Phase 11 (incremental 5-pass exploration).

---

## F-006 — Router has no Master AI path ✅ Fixed

| Field    | Value        |
| -------- | ------------ |
| Severity | 🟡 Medium    |
| Category | Architecture |
| Found    | 2026-02-20   |
| Fixed    | 2026-02-20   |

**What:** The message router sent messages directly to a provider with no Master AI path.

**Resolution:** Phase 8 (OB-083/084/085) — `setMaster()` method, Master routing priority.

---

## F-007 — Test coverage gaps for new modules ✅ Fixed

| Field    | Value      |
| -------- | ---------- |
| Severity | 🟡 Medium  |
| Category | Testing    |
| Found    | 2026-02-20 |
| Fixed    | 2026-02-21 |

**What:** No tests existed for discovery, master AI, delegation, or V2 config modules.

**Resolution:** Phase 14 (OB-113 through OB-120) — comprehensive test suites including E2E tests.

---

## F-008 — `config.example.json` uses V0 format ✅ Fixed

| Field    | Value         |
| -------- | ------------- |
| Severity | 🟢 Low        |
| Category | Documentation |
| Found    | 2026-02-20    |
| Fixed    | 2026-02-20    |

**What:** Example config showed V0 format instead of simplified V2 format.

**Resolution:** Phase 8 (OB-087) — updated to V2 format with only 3 required fields.

---

## F-009 — No validation for non-code workspace use cases ✅ Fixed

| Field    | Value                |
| -------- | -------------------- |
| Severity | 🟠 High              |
| Category | Testing / Validation |
| Found    | 2026-02-20           |
| Fixed    | 2026-02-21           |

**What:** Non-code scenarios (cafes, law firms, accountants) were undescribed in tests.

**Resolution:** Phase 14 (OB-117) — E2E test suite with cafe business scenario.

---

## F-010 — Session continuity underprioritized ✅ Fixed

| Field    | Value        |
| -------- | ------------ |
| Severity | 🟡 Medium    |
| Category | Architecture |
| Found    | 2026-02-20   |
| Fixed    | 2026-02-21   |

**What:** Session continuity was Medium priority but multi-turn conversations are core to every use case.

**Resolution:** Priority bumped to High (OB-104). `--session-id` / `--resume` with 30min TTL.

---

## F-011 — No Console-based preprod test workflow ✅ Fixed

| Field    | Value      |
| -------- | ---------- |
| Severity | 🟡 Medium  |
| Category | Testing    |
| Found    | 2026-02-20 |
| Fixed    | 2026-02-21 |

**What:** No documented workflow for using Console connector as rapid preprod testing path.

**Resolution:** Phase 14 (OB-118) — TESTING_GUIDE.md + 25-test E2E suite.

---

## F-012 — No graceful handling for missing data queries ✅ Fixed

| Field    | Value       |
| -------- | ----------- |
| Severity | 🟢 Low      |
| Category | UX / Safety |
| Found    | 2026-02-20  |
| Fixed    | 2026-02-21  |

**What:** No verification for how system responds when workspace lacks requested data.

**Resolution:** Phase 14 (OB-119) — 7-test E2E suite covering all edge cases.
