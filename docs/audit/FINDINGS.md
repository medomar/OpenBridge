# OpenBridge — Audit Findings

> **Purpose:** Real issues, gaps, and risks discovered during code audits.
> **This is NOT a task list.** Tasks live in [TASKS.md](TASKS.md). Findings document _what's wrong_ and _why it matters_.
> **Open:** 8 | **Last Audit:** 2026-02-20
> **Resolved findings:** [V0 archive](archive/v0/FINDINGS-v0.md)

---

## Open Findings

### F-001 — Dead code in compile path

| Field    | Value        |
| -------- | ------------ |
| Severity | 🟠 High      |
| Category | Code Quality |
| Found    | 2026-02-20   |

**What:** The `src/knowledge/`, `src/orchestrator/`, `src/core/workspace-manager.ts`, and `src/core/map-loader.ts` modules are compiled but never called at runtime. The orchestrator was a pass-through that never decomposed tasks. The knowledge layer assumed user-defined `openbridge.map.json` files which no longer exist in the new vision.

**Impact:** Inflates bundle size, confuses new contributors, TypeScript errors in dead code block builds, and creates false impressions of functionality that doesn't work.

**Resolution:** Move to `src/_archived/` (Phase 9, OB-088/089/090).

---

### F-002 — Documentation describes wrong architecture

| Field    | Value         |
| -------- | ------------- |
| Severity | 🟠 High       |
| Category | Documentation |
| Found    | 2026-02-20    |

**What:** OVERVIEW.md, README.md, and ARCHITECTURE.md describe the old "AI workforce platform" vision with user-defined workspace maps, manual `openbridge.map.json` files, and a 5-layer architecture. The actual direction is autonomous AI exploration with zero-config discovery.

**Impact:** New users/contributors get a completely wrong picture of what OpenBridge does and how it works. Onboarding friction.

**Resolution:** Full documentation rewrite (Phase 12, OB-098/099/100).

---

### F-003 — Config requires unnecessary fields

| Field    | Value         |
| -------- | ------------- |
| Severity | 🟡 Medium     |
| Category | Configuration |
| Found    | 2026-02-20    |

**What:** Current config requires `providers` array, `defaultProvider`, and `workspaces` — all of which should be auto-discovered in the new vision. Users should only need 3 fields: `workspacePath`, `channels`, `auth`.

**Impact:** Unnecessarily complex setup. Users must manually specify things the system should figure out on its own.

**Resolution:** V2 config schema (Phase 8, OB-081/082).

---

### F-004 — No AI tool discovery capability

| Field    | Value           |
| -------- | --------------- |
| Severity | 🟠 High         |
| Category | Missing Feature |
| Found    | 2026-02-20      |

**What:** OpenBridge cannot detect which AI CLI tools (claude, codex, aider, cursor, cody) or VS Code extensions (Copilot, Cody, Continue) are installed on the user's machine. The entire autonomous vision depends on this.

**Impact:** Blocks the core value proposition. Without discovery, the system can't auto-select a Master AI or know what delegation targets exist.

**Resolution:** Phase 6 (OB-071 through OB-074).

---

### F-005 — No autonomous workspace exploration

| Field    | Value           |
| -------- | --------------- |
| Severity | 🟠 High         |
| Category | Missing Feature |
| Found    | 2026-02-20      |

**What:** No Master AI Manager exists. No `.openbridge/` folder is created. No exploration prompt is defined. The AI cannot autonomously explore a workspace, build understanding, or store knowledge.

**Impact:** The core differentiator of OpenBridge doesn't exist yet. Without this, the system is just a WhatsApp-to-CLI bridge with no intelligence.

**Resolution:** Phase 7 (OB-075 through OB-080).

---

### F-006 — Router has no Master AI path

| Field    | Value        |
| -------- | ------------ |
| Severity | 🟡 Medium    |
| Category | Architecture |
| Found    | 2026-02-20   |

**What:** The message router sends messages directly to a provider. There's no path for routing through a Master AI that maintains session state, explores autonomously, and delegates to other tools.

**Impact:** Even after building the Master AI module, it can't receive messages until the router is updated.

**Resolution:** Phase 8 (OB-083/084/085).

---

### F-007 — Test coverage gaps for new modules

| Field    | Value      |
| -------- | ---------- |
| Severity | 🟡 Medium  |
| Category | Testing    |
| Found    | 2026-02-20 |

**What:** V0 tests are comprehensive, but no tests exist for discovery, master AI, delegation, or V2 config modules (because those modules don't exist yet). Some existing tests may also break when dead code is archived.

**Impact:** Risk of regressions during Phase 9 archive. New modules will ship untested if not addressed.

**Resolution:** Phase 13 (OB-104 through OB-107), plus tests in Phases 6-7 (OB-080).

---

### F-008 — `config.example.json` uses V0 format

| Field    | Value         |
| -------- | ------------- |
| Severity | 🟢 Low        |
| Category | Documentation |
| Found    | 2026-02-20    |

**What:** The example config still shows the V0 format with providers array, defaultProvider, and full connector config. Should show the simplified V2 format.

**Impact:** Minor — confusing for new users trying to set up, but functional with V0 format.

**Resolution:** Phase 8 (OB-087).

---

## Severity Guide

| Severity    | Meaning                                               |
| ----------- | ----------------------------------------------------- |
| 🔴 Critical | System broken, data loss risk, security vulnerability |
| 🟠 High     | Core functionality missing or significantly impaired  |
| 🟡 Medium   | Friction, technical debt, or non-blocking gaps        |
| 🟢 Low      | Polish, minor improvements, nice-to-have              |
