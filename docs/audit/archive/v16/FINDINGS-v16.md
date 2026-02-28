# OpenBridge — Findings Archive: v0.0.6 (Phase 67)

> **2 findings resolved** | **Archived:** 2026-02-28

## OB-F41 — Telegram/Discord "message too long" (✅ Fixed in Phase 67)

Master AI generated 5000–7000+ char responses. Telegram (4096 limit) and Discord (2000 limit) connectors sent as-is, causing `GrammyError 400`. The queue retry loop re-processed the entire AI pipeline on each retry, wasting tokens and timing out. Fixed by creating shared `splitMessage(content, maxLength)` utility applied to all three connectors (Telegram, Discord, WhatsApp).

## OB-F42 — No live conversation history in Master context (✅ Fixed in Phase 67)

Master uses `--print` mode (stateless). `buildConversationContext()` only loaded `memory.md` (project-level notes) and FTS5 keyword search (random cross-session hits), never the actual recent messages from the current session. Users saying "continue from last question" got no context. Fixed by adding Layer 1 to `buildConversationContext(userMessage, sessionId?)` that loads last 10 session messages via `getSessionHistory()` and injects as `## Recent conversation (this session):` section.
