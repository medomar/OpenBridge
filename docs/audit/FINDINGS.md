# OpenBridge — Audit Findings

> **Purpose:** Real issues, gaps, and risks discovered during code audits and real-world testing.
> **This is NOT a task list.** Tasks live in [TASKS.md](TASKS.md). Findings document _what's wrong_ and _why it matters_.
> **Open:** 4 | **Fixed:** 1 (230 prior findings archived) | **Last Audit:** 2026-03-24
> **History:** 230 findings fixed across v0.0.1–v0.1.0. All prior archived in [archive/](archive/).

---

## Open Findings

### OB-F231 — Keyword classifier misclassifies action requests as quick-answer

- **Severity:** 🟠 High
- **Status:** Open
- **Key Files:** `src/master/classification-engine.ts`
- **Root Cause / Impact:**
  Messages containing action verbs ("add", "create", "update", "modify", "delete") are classified as `quick-answer` by the keyword matcher, resulting in only 3 maxTurns. This causes turn exhaustion on tasks that require file reads/writes. Observed: "From the project docs can you add an item for a supplier?" → `quick-answer` → max turns hit.
- **Fix:** Add action-verb detection to the keyword matcher. If the message contains imperative action verbs, classify as `tool-use` minimum (not `quick-answer`), regardless of other keyword signals.

---

### OB-F232 — Turn exhaustion error leaks to user instead of auto-retrying

- **Severity:** 🔴 Critical
- **Status:** ✅ Fixed (2026-03-24)
- **Key Files:** `src/master/master-manager.ts`
- **Root Cause / Impact:**
  When a task ends with `turnsExhausted: true`, the raw "Error: Reached max turns (3)" message is sent back to the user via the messaging channel. The user then manually resends the message with the error appended, wasting a round trip and degrading UX. Observed on telegram-2650 → telegram-2654.
- **Fix:** Added Master-level turn-escalation retry mirroring the worker pattern (OB-903). On first exhaustion, auto-retries with `ceil(maxTurns × 1.5)` (capped at 50), injecting partial output as continuation context. Only surfaces guidance to the user if the escalated retry also exhausts.

---

### OB-F233 — Length heuristic over-classifies conversational questions as tool-use

- **Severity:** 🟡 Medium
- **Status:** Open
- **Key Files:** `src/master/classification-engine.ts`
- **Root Cause / Impact:**
  The length heuristic promotes long multi-sentence messages to `tool-use` (15 turns) even when the intent is conversational/planning ("I wanna provide you a shopfy store and you extract..."). This wastes model budget on unnecessary tool-use allocations. Length should be a tiebreaker, not a primary classifier signal.
- **Fix:** Check intent before applying length heuristic — interrogative phrasing ("can you", "would it be possible") with no imperative action should remain `quick-answer` or `conversation`. Only promote to `tool-use` when the message contains clear action intent.

---

### OB-F234 — RAG confidence consistently low due to shallow indexing

- **Severity:** 🟡 Medium
- **Status:** Open
- **Key Files:** `src/master/master-manager.ts`, `src/memory/chunk-store.ts`, `src/memory/retrieval.ts`
- **Root Cause / Impact:**
  All RAG queries in the session returned confidence 0.32–0.48 with only 2–3 chunks from FTS5. The chunk store had only 4 indexed chunks at startup. The Master is operating mostly blind about the workspace, reducing answer quality and forcing unnecessary tool-use turns to re-read files.
- **Fix:** Trigger re-indexing when RAG confidence is consistently below a threshold (e.g., < 0.5 over N consecutive queries). Consider deeper initial indexing or incremental chunk ingestion when workers read files.

---

### OB-F235 — Timeout clamping fires on every tool-use task

- **Severity:** 🟢 Low
- **Status:** Open
- **Key Files:** `src/master/master-manager.ts`
- **Root Cause / Impact:**
  Every `tool-use` classification triggers `WARN: Timeout clamped to message timeout boundary` (originalTimeout 390–480s → safeTimeout 300s). The calculated timeout consistently exceeds the safe boundary, making the warning noise rather than a useful signal. Either the timeout formula or the safe boundary needs adjustment.
- **Fix:** Either raise the message timeout boundary to accommodate typical tool-use durations, or adjust the timeout formula so tool-use tasks don't routinely exceed the boundary. Alternatively, lower the log level to DEBUG if clamping is expected behavior.

---

## How to Add a Finding

```markdown
### OB-F### — Description here

- **Severity:** 🔴/🟠/🟡/🟢
- **Status:** Open
- **Key Files:** `file.ts`
- **Root Cause / Impact:**
  Why it matters.
- **Fix:** How to fix it.
```

Severity levels: 🔴 Critical | 🟠 High | 🟡 Medium | 🟢 Low

---

## Archive

230 findings fixed across v0.0.1–v0.1.0:
[V0](archive/v0/FINDINGS-v0.md) | [V2](archive/v2/FINDINGS-v2.md) | [V4](archive/v4/FINDINGS-v4.md) | [V5](archive/v5/FINDINGS-v5.md) | [V6](archive/v6/FINDINGS-v6.md) | [V7](archive/v7/FINDINGS-v7.md) | [V8](archive/v8/FINDINGS-v8.md) | [V15](archive/v15/FINDINGS-v15.md) | [V16](archive/v16/FINDINGS-v16.md) | [V17](archive/v17/FINDINGS-v17.md) | [V18](archive/v18/FINDINGS-v18.md) | [V19](archive/v19/FINDINGS-v19.md) | [V21](archive/v21/FINDINGS-v21.md) | [V24](archive/v24/FINDINGS-v24.md) | [V25](archive/v25/FINDINGS-v25.md) | [V26](archive/v26/FINDINGS-v26.md) | [V27](archive/v27/FINDINGS-v27.md) | [V28](archive/v28/FINDINGS-v28.md) | [V29](archive/v29/FINDINGS-v29.md)

---
