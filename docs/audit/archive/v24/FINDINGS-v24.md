# OpenBridge — Findings Archive v24 (v0.0.15)

> **Archived:** 2026-03-09 | **Findings Fixed:** 34 (OB-F144–F177) | **Version:** v0.0.15

---

## OB-F144 — Quick-answer timeout too tight (150s) — ✅ Fixed

## OB-F145 — Self-improvement idle cycle runs every 5 min forever — ✅ Fixed

## OB-F146 — Phase 4 Assembly fails on large workspaces — ✅ Fixed

## OB-F147 — Master prompt assembled without budget — silent truncation — ✅ Fixed

## OB-F148 — Adapter-inconsistent prompt size handling — ✅ Fixed

## OB-F149 — Self-improvement grows system prompt unboundedly — ✅ Fixed

## OB-F150 — Workspace map duplicated in exploration prompts — ✅ Fixed

## OB-F151 — Prompt version table has duplicate seed rows — ✅ Fixed

## OB-F152 — Classifier ignores message attachments — ✅ Fixed

## OB-F153 — Orphaned workers persist in pending state — ✅ Fixed

## OB-F154 — File-reference keywords missing from classifier — ✅ Fixed

## OB-F155 — Stale exploration_progress rows accumulate on retry — ✅ Fixed

## OB-F156 — memory.md stays empty after exploration completes — ✅ Fixed

## OB-F157 — No monorepo/sub-project awareness during exploration — ✅ Fixed

## OB-F158 — master-manager.ts god class — 8,869 LOC, 59+ methods — ✅ Fixed

## OB-F159 — router.ts god class — 5,086 LOC, 37+ methods — ✅ Fixed

## OB-F160 — agent-runner.ts oversized — 2,336 LOC, 39+ functions — ✅ Fixed

## OB-F161 — Stale LOC references in CLAUDE.md files — ✅ Fixed

## OB-F162 — Agent-runner timeout/kill race condition — double SIGKILL — ✅ Fixed

## OB-F163 — Session checkpoint/resume race — checkpoint never resumed on error — ✅ Fixed

## OB-F164 — Memory init failure leaves eviction interval running against null — ✅ Fixed

## OB-F165 — Queue processNextForUser() uses recursion — stack overflow under load — ✅ Fixed

## OB-F166 — Rate limiter windows Map leaks stale entries forever — ✅ Fixed

## OB-F167 — Config watcher reload() — unhandled promise rejection — ✅ Fixed

## OB-F168 — Spawn confirmation timer leak on duplicate requests — ✅ Fixed

## OB-F169 — Master classificationCache unbounded memory growth — ✅ Fixed

## OB-F170 — Master batch timers not cleaned up on shutdown — ✅ Fixed

## OB-F171 — Worker abort handles leak on pre-spawn failure — ✅ Fixed

## OB-F172 — Pending messages silently dropped when exploration drain fails — ✅ Fixed

## OB-F173 — Cancellation notifications re-injected on every session restart — ✅ Fixed

## OB-F174 — DotFolderManager silently swallows all file I/O errors — ✅ Fixed

## OB-F175 — JSON.parse without try-catch in memory stores — crash on corrupt data — ✅ Fixed

## OB-F176 — Connector Maps/Sets grow unbounded — memory leaks in long-running instances — ✅ Fixed

## OB-F177 — WhatsApp reconnect timer not cleared on shutdown — ✅ Fixed

---
