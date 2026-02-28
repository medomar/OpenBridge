# OpenBridge — Findings Archive: v0.0.7 (Phases 68–69)

> **3 findings resolved** | **Archived:** 2026-02-28

## OB-F43 — WhatsApp incoming media ignored (images, documents, videos) (✅ Fixed in Phase 68)

Master AI generated 5000–7000+ char responses. The WhatsApp connector handled incoming voice messages (transcription via Whisper CLI) and supported full outbound media, but all other incoming media types — images, documents, and videos — were silently ignored. Only `msg.body` (text caption) was extracted; actual media files were never downloaded or passed to the Master AI. Fixed by adding `attachments` field to `InboundMessage`, creating `MediaManager` + `VoiceTranscriber` shared modules, adding WhatsApp media download handlers for image/document/video/audio/sticker, Router `## Attachments` context injection, and Master/worker prompt updates with `## Referenced Files`.

## OB-F44 — Telegram connector has zero media support (incoming + voice) (✅ Fixed in Phase 68)

The Telegram connector only listened to `message:text` events via grammY. All other message types — voice notes, photos, documents, videos, audio files — were silently dropped. No media download, no voice transcription, no file handling of any kind. Fixed by extending `GrammyContext` interface, implementing `downloadTelegramFile()` helper, adding handlers for `message:voice`, `message:photo`, `message:document`, `message:video`, `message:audio` with MediaManager integration, shared VoiceTranscriber for voice, and outbound media via `sendPhoto/sendDocument/sendVideo/sendVoice`.

## OB-F45 — No user-facing MCP management UI (✅ Fixed in Phase 69)

OpenBridge had solid backend MCP support — per-worker isolation, Master-driven assignment, health checks — but users had zero runtime visibility or control over MCP servers. Adding, removing, or toggling servers required manually editing `config.json` and restarting. Fixed by creating `McpRegistry` (runtime CRUD + health + config persistence), `MCP_CATALOG` (10+ built-in server entries), REST API endpoints (GET/POST/DELETE/PATCH servers, catalog browse + connect), WebChat MCP Dashboard UI (server cards with status dots, toggle switches, catalog modal with search + connect flow, custom server form), real-time WebSocket `mcp-status` broadcasts, credential masking, and hot-reload wiring via config-watcher + MasterManager.
