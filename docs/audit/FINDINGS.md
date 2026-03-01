# OpenBridge — Audit Findings

> **Purpose:** Real issues, gaps, and risks discovered during code audits and real-world testing.
> **This is NOT a task list.** Tasks live in [TASKS.md](TASKS.md). Findings document _what's wrong_ and _why it matters_.
> **Open:** 2 | **Fixed:** 55 | **Last Audit:** 2026-03-01
> **Resolved findings:** [V0 archive](archive/v0/FINDINGS-v0.md) | [V2 archive](archive/v2/FINDINGS-v2.md) | [V4 archive](archive/v4/FINDINGS-v4.md) | [V5 archive](archive/v5/FINDINGS-v5.md) | [V6 archive](archive/v6/FINDINGS-v6.md) | [V7 archive](archive/v7/FINDINGS-v7.md) | [V8 archive](archive/v8/FINDINGS-v8.md) | [V15 archive](archive/v15/FINDINGS-v15.md) | [V16 archive](archive/v16/FINDINGS-v16.md) | [V17 archive](archive/v17/FINDINGS-v17.md) | [V18 archive](archive/v18/FINDINGS-v18.md)

---

## Priority Order

| #   | Finding                                                           | Severity    | Impact                                                                                   | Status     |
| --- | ----------------------------------------------------------------- | ----------- | ---------------------------------------------------------------------------------------- | ---------- |
| 49  | OB-F49 — Timeout errors misclassified and retried wastefully      | 🔴 Critical | Timeout errors classified as 'unknown', retried 4x (wasting ~12 min), no circuit-breaker | ✅ Fixed   |
| 50  | OB-F50 — maxTurns bumped on timeout (wrong knob)                  | 🟡 Medium   | Feedback loop bumps turns on timeout but bottleneck is wall-clock; misleading adaptation | ✅ Fixed   |
| 51  | OB-F51 — Whitelist count mismatch after normalization             | 🟢 Low      | Config logs 7 entries but auth logs 6 — normalization drops/deduplicates silently        | ✅ Fixed   |
| 52  | OB-F52 — Complex tasks use same 180s timeout as quick answers     | 🔴 Critical | Complex tasks (25 turns) get 180s timeout, always timeout, retry to DLQ                  | 🔵 Open    |
| 53  | OB-F53 — Classification escalation over-triggers                  | 🟡 Medium   | Global success rate escalates all quick-answers to tool-use (5→15 turns), wastes budget  | 🔵 Open    |
| 46  | OB-F46 — Voice transcription requires local Whisper install       | 🟡 Medium   | Users must install external binary (whisper CLI) for voice messages; no API fallback     | ✅ Fixed   |
| 47  | OB-F47 — No desktop installer or guided setup for non-developers  | 🟠 High     | Non-dev users cannot install/run OpenBridge; no .exe/.dmg, no dependency wizard          | 🟡 Partial |
| 48  | OB-F48 — Master AI answers from stale context, not live knowledge | 🟠 High     | Exploration data (chunks, dir dives, workspace map) underutilized after startup; no RAG  | ✅ Fixed   |

> **Note:** OB-F47 Phase 1 (CLI wizard) shipped. Phases 2–3 (binary packaging, Electron app) are scaffolded but have build issues — need finalization. See [FUTURE.md](FUTURE.md). OB-F48 deferred to future version — see [FUTURE.md](FUTURE.md) for planned RAG implementation (Phases 74–77).

---

## Open Findings

### OB-F52 — Complex tasks use same 180s timeout as quick answers 🔴 Critical

**Discovered:** 2026-03-01 | **Component:** `src/master/master-manager.ts`

**Problem:** All message types (quick-answer, tool-use, complex-task) use `DEFAULT_MESSAGE_TIMEOUT = 180_000` (3 minutes). Complex tasks get 25 turns but only 180s — 7.2s per turn, too tight for planning tasks that involve git operations, multi-file refactors, or branch management. Before the OB-F49 fix, this caused telegram-593 to retry 4x and waste ~12 minutes.

**Root cause:** `buildMasterSpawnOptions()` defaults timeout to `this.messageTimeout` (180s) for all task classes. The caller passes `undefined` for timeout.

**Fix needed:** Per-class timeout map or proportional timeout. Requires design discussion.

---

### OB-F53 — Classification escalation over-triggers 🟡 Medium

**Discovered:** 2026-03-01 | **Component:** `src/master/master-manager.ts` (lines 2706–2751)

**Problem:** The escalation logic checks **global aggregate** success rate. If `tool-use` has 90% success across ALL tasks, it escalates **every** `quick-answer` to `tool-use` (5→15 turns), wasting budget on trivial questions.

**Root cause:** `getLearnedParams('classification')` returns a single best-performing class. The escalation check (`success_rate > 0.5 && learnedRank > currentRank`) is too aggressive.

**Fix needed:** Disable quick-answer→tool-use escalation, or add per-class tracking. Requires design discussion.

---

### OB-F49 — Timeout errors misclassified and retried wastefully ✅ Fixed

**Discovered:** 2026-03-01 | **Fixed:** 2026-03-01 | **Component:** `src/core/queue.ts`

**Problem:** `AgentExhaustedError` is not a `ProviderError`, so the queue classified all timeout errors as `errorKind: 'unknown'` and retried 3 times. Each retry produced another 180s timeout.

**Fix:** Queue now imports `AgentExhaustedError` + `classifyError` from agent-runner, inspects exit code/stderr, and circuit-breaks on timeout (no retries).

---

### OB-F50 — maxTurns bumped on timeout (wrong knob) ✅ Fixed

**Discovered:** 2026-03-01 | **Fixed:** 2026-03-01 | **Component:** `src/master/master-manager.ts`

**Problem:** `recordClassificationFeedback()` bumped maxTurns by 1.5x on repeated timeouts, but the bottleneck was wall-clock timeout (180s), not turns.

**Fix:** Replaced maxTurns bump with a warning log flagging the real issue (wall-clock timeout).

---

### OB-F51 — Whitelist count mismatch after normalization ✅ Fixed

**Discovered:** 2026-03-01 | **Fixed:** 2026-03-01 | **Component:** `src/core/auth.ts`

**Problem:** Config reported 7 whitelist entries but auth logged 6 — `normalizeNumber()` deduplicates silently after stripping non-digits.

**Fix:** Auth constructor now logs both `rawEntries` and `whitelistedNumbers`, emits a warning when counts differ.

---

Most recent fixes:

- **OB-F49, OB-F50, OB-F51** (timeout misclassification, maxTurns bump, whitelist mismatch) — fixed in this session
- **OB-F43, OB-F44, OB-F45** (WhatsApp/Telegram media + MCP dashboard) — [archived to v17](archive/v17/FINDINGS-v17.md)
- **OB-F41, OB-F42** (Telegram/Discord message too long + live context) — [archived to v16](archive/v16/FINDINGS-v16.md)
- **OB-F38, OB-F39, OB-F40** — [archived to v15](archive/v15/FINDINGS-v15.md)

---

## Severity Guide

| Severity    | Meaning                                               |
| ----------- | ----------------------------------------------------- |
| 🔴 Critical | System broken, data loss risk, security vulnerability |
| 🟠 High     | Core functionality missing or significantly impaired  |
| 🟡 Medium   | Friction, technical debt, or non-blocking gaps        |
| 🟢 Low      | Polish, minor improvements, nice-to-have              |
