# OpenBridge — Findings Archive: v0.0.5 (Phases 63–66)

> **3 findings resolved** | **Archived:** 2026-02-28

## OB-F38 — FTS5 syntax error on special characters (✅ Fixed in Phase 63)

FTS5 MATCH queries crashed on special characters (`'`, `"`, `*`, `()`). Fixed by adding `sanitizeFts5Query()` shared sanitizer that strips special chars and quotes each token.

## OB-F39 — memory.md never updates (✅ Fixed in Phase 64)

Master runs in `--print` mode (stateless), so `triggerMemoryUpdate()` had no conversation context. Fixed by injecting last 20 conversation messages from SQLite into the memory-update prompt.

## OB-F40 — Ungraceful shutdown (✅ Fixed in Phase 65)

Ctrl+C caused `tsx` to force-kill before memory update completed. Fixed with 10s shutdown timeout, critical-first ordering (session state saved before memory update), and user-facing shutdown message.
