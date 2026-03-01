# OpenBridge — Archived Findings (V19)

> **Archived:** 2026-03-01 | **Contains:** OB-F49, OB-F50, OB-F51, OB-F52, OB-F53

---

## OB-F49 — Timeout errors misclassified and retried wastefully ✅ Fixed

**Discovered:** 2026-03-01 | **Fixed:** 2026-03-01 | **Component:** `src/core/queue.ts`

**Problem:** `AgentExhaustedError` is not a `ProviderError`, so the queue classified all timeout errors as `errorKind: 'unknown'` and retried 3 times. Each retry produced another 180s timeout.

**Resolution:** Queue now imports `AgentExhaustedError` + `classifyError` from agent-runner, inspects exit code/stderr, and circuit-breaks on timeout (no retries).

---

## OB-F50 — maxTurns bumped on timeout (wrong knob) ✅ Fixed

**Discovered:** 2026-03-01 | **Fixed:** 2026-03-01 | **Component:** `src/master/master-manager.ts`

**Problem:** `recordClassificationFeedback()` bumped maxTurns by 1.5x on repeated timeouts, but the bottleneck was wall-clock timeout (180s), not turns.

**Resolution:** Replaced maxTurns bump with a warning log flagging the real issue (wall-clock timeout).

---

## OB-F51 — Whitelist count mismatch after normalization ✅ Fixed

**Discovered:** 2026-03-01 | **Fixed:** 2026-03-01 | **Component:** `src/core/auth.ts`

**Problem:** Config reported 7 whitelist entries but auth logged 6 — `normalizeNumber()` deduplicates silently after stripping non-digits.

**Resolution:** Auth constructor now logs both `rawEntries` and `whitelistedNumbers`, emits a warning when counts differ.

---

## OB-F52 — Complex tasks use same 180s timeout as quick answers ✅ Fixed

**Discovered:** 2026-03-01 | **Fixed:** 2026-03-01 | **Component:** `src/master/master-manager.ts`

**Problem:** All message types (quick-answer, tool-use, complex-task) used `DEFAULT_MESSAGE_TIMEOUT = 180_000` (3 minutes). Complex tasks got 25 turns but only 180s — 7.2s per turn, too tight for planning tasks.

**Resolution:** Added `turnsToTimeout()` helper (30s × maxTurns) giving per-class timeouts: quick-answer=150s, tool-use=450s, complex-task=750s. `processMessage()` now uses `turnsToTimeout(MESSAGE_MAX_TURNS_PLANNING)` for complex tasks instead of the flat 180s default.

---

## OB-F53 — Classification escalation over-triggers ✅ Fixed

**Discovered:** 2026-03-01 | **Fixed:** 2026-03-01 | **Component:** `src/master/master-manager.ts`

**Problem:** Global aggregate success rate could escalate every `quick-answer` to `tool-use` (5→15 turns), wasting budget on trivial questions.

**Resolution:** Added `currentRank > 0` guard that prevents `quick-answer` (rank 0) from ever being escalated. Only `tool-use → complex-task` escalation remains, which is appropriate behavior for tasks that genuinely need more turns.
