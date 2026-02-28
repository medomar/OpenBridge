# OpenBridge — Audit Findings

> **Purpose:** Real issues, gaps, and risks discovered during code audits and real-world testing.
> **This is NOT a task list.** Tasks live in [TASKS.md](TASKS.md). Findings document _what's wrong_ and _why it matters_.
> **Open:** 1 | **Fixed:** 46 | **Last Audit:** 2026-02-28
> **Resolved findings:** [V0 archive](archive/v0/FINDINGS-v0.md) | [V2 archive](archive/v2/FINDINGS-v2.md) | [V4 archive](archive/v4/FINDINGS-v4.md) | [V5 archive](archive/v5/FINDINGS-v5.md) | [V6 archive](archive/v6/FINDINGS-v6.md) | [V7 archive](archive/v7/FINDINGS-v7.md) | [V8 archive](archive/v8/FINDINGS-v8.md) | [V15 archive](archive/v15/FINDINGS-v15.md) | [V16 archive](archive/v16/FINDINGS-v16.md)

---

## Priority Order

| #   | Finding                                                         | Severity  | Impact                                                                                 | Status   |
| --- | --------------------------------------------------------------- | --------- | -------------------------------------------------------------------------------------- | -------- |
| 43  | OB-F43 — WhatsApp incoming media ignored (images, docs, videos) | 🟠 High   | Users cannot send images, documents, or videos as task context                         | ✅ Fixed |
| 44  | OB-F44 — Telegram has zero media support (incoming + voice)     | 🟠 High   | Telegram users limited to text-only; voice messages silently dropped                   | ✅ Fixed |
| 45  | OB-F45 — No user-facing MCP management UI                       | 🟡 Medium | Users must edit config.json to manage MCP servers; no browse/connect/toggle at runtime | Open     |

---

## Open Findings

### OB-F43 — WhatsApp incoming media ignored (images, documents, videos) ✅ Fixed

**Discovered:** 2026-02-28 | **Component:** `src/connectors/whatsapp/whatsapp-connector.ts`

**Problem:** The WhatsApp connector handles incoming voice messages (transcription via Whisper CLI) and supports full outbound media (images, docs, audio, video). However, all other **incoming** media types — images, documents, and videos — are silently ignored. When a user sends a photo, PDF, or video alongside a task instruction, only `msg.body` (the text caption) is extracted. The actual media file is never downloaded or passed to the Master AI.

**Root cause:** The `InboundMessage` type in `src/types/message.ts` has no `attachments` or `media` field. The message handler in `handleIncomingMessage()` only branches on voice (`msg.hasMedia && msg.type === 'ptt'`); all other media types fall through to the text-only path.

**Impact:**

- Users cannot send screenshots, error logs, design mockups, or reference documents via WhatsApp
- AI cannot analyze images or process attached files as part of task context
- The `msg.downloadMedia()` capability from whatsapp-web.js is available but unused for non-voice media
- Asymmetric UX: AI can send media back to users, but users can't send media to the AI

**What needs to change:**

1. Add an `attachments` array to `InboundMessage` type (`type`, `filePath`, `mimeType`, `filename`, `size`)
2. Detect incoming media via `msg.hasMedia` for types: `image`, `document`, `video`, `audio` (non-ptt)
3. Download media via `msg.downloadMedia()`, save to a managed temp directory (e.g., `<workspace>/.openbridge/media/`)
4. Attach file metadata to the `InboundMessage` so the Router and Master AI can reference the files
5. Include attachment context in the Master AI prompt so workers can be instructed to process the files
6. Add media eviction/cleanup (TTL-based or size-capped) to prevent disk bloat

**Affected files:**

- `src/types/message.ts` — `InboundMessage` needs `attachments` field
- `src/connectors/whatsapp/whatsapp-connector.ts` — `handleIncomingMessage()` needs media download branches
- `src/connectors/whatsapp/whatsapp-message.ts` — `parseWhatsAppMessage()` needs attachments param
- `src/core/router.ts` — needs to inject `## Attachments` context before passing to Master
- `src/master/master-manager.ts` — `buildPromptForWorker()` needs to inject attachment file paths into worker prompts
- `src/master/master-system-prompt.ts` — system prompt should describe media capabilities
- New: `src/core/media-manager.ts` — managed temp directory for media files
- New: `src/core/voice-transcriber.ts` — shared Whisper CLI integration (extracted from WhatsApp connector)

**Fixed:** Phase 68 (v0.0.6) — All 27 tasks implemented: `attachments` field added to `InboundMessage`, `MediaManager` + `VoiceTranscriber` created, WhatsApp media download handlers added for image/document/video/audio/sticker, Router injects `## Attachments` context, Master system prompt updated, worker prompts include `## Referenced Files`. Full test suite green.

---

### OB-F44 — Telegram connector has zero media support (incoming + voice) ✅ Fixed

**Discovered:** 2026-02-28 | **Component:** `src/connectors/telegram/telegram-connector.ts`

**Problem:** The Telegram connector only listens to `message:text` events via grammY. All other message types — voice notes, photos, documents, videos, audio files — are silently dropped. There is no media download, no voice transcription, and no file handling of any kind. This is a significant gap compared to WhatsApp (which at least transcribes voice).

**Root cause:** The connector was built as a text-only implementation. The grammY `GrammyContext` interface only types `message.text`. No handlers exist for `message:voice`, `message:photo`, `message:document`, `message:video`, or `message:audio` events. The Telegram Bot API's `getFile()` method is never called.

**Impact:**

- Telegram users cannot send voice instructions (common mobile use case)
- Photos, screenshots, and documents sent via Telegram are silently ignored
- No feature parity with WhatsApp connector (which has voice transcription)
- Users get no feedback that their media was dropped — messages just vanish

**What needs to change:**

1. Extend `GrammyContext` interface to include `voice`, `photo`, `document`, `video`, `audio`, `caption` fields
2. Add event handlers for `message:voice`, `message:photo`, `message:document`, `message:video`
3. Implement `downloadTelegramFile(fileId)` using grammY's `bot.api.getFile()` + HTTPS download
4. Voice messages: download `.oga`/`.ogg` file, transcribe via Whisper CLI (same pattern as WhatsApp)
5. Photos/documents/videos: download to managed temp directory, attach metadata to `InboundMessage`
6. Extract captions from media messages as the text content
7. Send user feedback when media is received (e.g., typing indicator + "Processing your image...")
8. Outbound media support: implement `sendMedia()` using grammY's `sendPhoto`, `sendDocument`, `sendVideo`, `sendVoice` methods

**Affected files:**

- `src/connectors/telegram/telegram-connector.ts` — needs media event handlers + file download
- `src/connectors/telegram/telegram-config.ts` — may need media temp path config
- `src/types/message.ts` — shares the `InboundMessage` attachment changes with OB-F43

**Fixed:** Phase 68 (v0.0.6) — `GrammyContext` interface extended with voice/photo/document/video/audio/caption; `downloadTelegramFile()` helper implemented; `message:voice`, `message:photo`, `message:document`, `message:video`, `message:audio` handlers added with MediaManager integration; `transcribeAudio()` from shared VoiceTranscriber used; outbound media via `sendPhoto/sendDocument/sendVideo/sendVoice`; chat action feedback on receipt. Full test suite green.

---

### OB-F45 — No user-facing MCP management UI 🟡 Medium

**Discovered:** 2026-02-28 | **Component:** `src/connectors/webchat/`, `src/core/config.ts`, `src/types/config.ts`

**Problem:** OpenBridge has solid backend MCP support — per-worker isolation, Master-driven assignment, health checks, Claude + Codex adapter support. But users have **zero runtime visibility or control** over MCP servers. Adding, removing, or toggling MCP servers requires manually editing `config.json` and restarting the bridge. There is no way to browse available MCP servers, see which are active/healthy, or connect new ones from the WebChat UI.

By comparison, Claude's web interface (claude.ai) offers a full **Connectors Directory** — a browsable, searchable catalog of 50+ MCP servers with one-click OAuth connection, per-conversation toggles, categories/filters, and real-time status. OpenBridge users get none of this despite having the backend infrastructure ready.

**Root cause:** MCP was built as a config-file-first feature (Phases 60–61). The WebChat connector has an embedded HTML UI with an Agent Status dashboard, but no MCP panel. There are no REST endpoints for MCP CRUD operations. The config-watcher exists for hot-reload but is not wired to MCP changes. The `writeMcpConfig()` function in `src/core/config.ts` exists but is not called during startup.

**Impact:**

- Users must edit JSON by hand to add/remove MCP servers — error-prone and requires restart
- No visibility into which MCP servers are healthy, active, or assigned to workers
- No way to browse or discover available MCP servers from the UI
- No OAuth flow for remote MCP servers — users must manually obtain and paste API keys
- The WebChat UI shows agent status and worker progress but nothing about MCP
- Significant UX gap vs Claude web (which has a full Connectors Directory + one-click OAuth)

**What needs to change:**

1. **MCP Registry API** — REST endpoints on the WebChat server for MCP CRUD:
   - `GET /api/mcp/servers` — list configured servers + health status
   - `POST /api/mcp/servers` — add a new server (command, args, env, or remote URL)
   - `DELETE /api/mcp/servers/:name` — remove a server
   - `PATCH /api/mcp/servers/:name` — toggle enabled/disabled
   - `GET /api/mcp/catalog` — list available MCP servers from the built-in catalog

2. **MCP Catalog** — a curated JSON catalog of popular MCP servers shipped with OpenBridge (filesystem, GitHub, Slack, Gmail, Canva, etc.) with metadata: name, description, category, command template, required env vars, official docs URL. Similar to Claude's Connectors Directory but local-first.

3. **WebChat MCP Dashboard** — new collapsible panel in the embedded HTML UI (alongside Agent Status) showing:
   - Connected servers with health indicators (green/red dot)
   - "Browse & Connect" button that opens the catalog
   - Add custom server form (command + args + env vars, or remote MCP URL)
   - Remove/toggle per server
   - Which workers are currently using which servers

4. **Hot-reload** — adding/removing MCP servers via the API persists to `config.json` (read-merge-write, same pattern as existing `writeMcpConfig()`, no file locking needed in single-process Bridge) and takes effect immediately without restart. `MasterManager` needs a new `reloadMcpServers(servers)` method to update `this.mcpServers` and mark the system prompt as stale, leveraging the existing `config-watcher.ts` handler chain.

5. **OAuth for remote MCP** — future scope (v0.1.0+). For now, users provide API keys via the Connect form env var fields.

6. **Credential security** — env vars containing API keys must be masked in API responses and WebSocket broadcasts (first 4 chars + `****`). Full values stored internally only. Never logged or sent to frontend.

**Affected files:**

- `src/connectors/webchat/webchat-connector.ts` — new REST endpoints + MCP dashboard HTML panel + `broadcastMcpStatus()` WebSocket method
- `src/core/config-watcher.ts` — trigger MCP reload on config changes → call `McpRegistry.reload()` + `MasterManager.reloadMcpServers()`
- `src/core/health.ts` — `checkCommandOnPath()` reused by McpRegistry for health status
- `src/master/master-manager.ts` — new `reloadMcpServers(servers)` method to update MCP list + stale system prompt
- `src/types/config.ts` — new `MCPCatalogEntrySchema` Zod schema
- `src/index.ts` — wire McpRegistry into Bridge startup
- New: `src/core/mcp-catalog.ts` — built-in MCP server catalog (inline TypeScript const)
- New: `src/core/mcp-registry.ts` — runtime MCP server management (CRUD + health + config persistence)

---

Most recent fixes:

- **OB-F41** (Telegram/Discord message too long) — [archived to v16](archive/v16/FINDINGS-v16.md)
- **OB-F42** (No live conversation context) — [archived to v16](archive/v16/FINDINGS-v16.md)
- **OB-F38, OB-F39, OB-F40** — [archived to v15](archive/v15/FINDINGS-v15.md)

---

## Severity Guide

| Severity    | Meaning                                               |
| ----------- | ----------------------------------------------------- |
| 🔴 Critical | System broken, data loss risk, security vulnerability |
| 🟠 High     | Core functionality missing or significantly impaired  |
| 🟡 Medium   | Friction, technical debt, or non-blocking gaps        |
| 🟢 Low      | Polish, minor improvements, nice-to-have              |
