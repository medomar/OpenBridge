# OpenBridge — Task List

> **Pending:** 10 | **In Progress:** 0 | **Done:** 40
> **Last Updated:** 2026-02-28

<details>
<summary>Archive (507 tasks completed across Phases 1–67)</summary>

- [V0 — Phases 1–5](archive/v0/TASKS-v0.md)
- [V1 — Phases 6–10](archive/v1/TASKS-v1.md)
- [V2 — Phases 11–14](archive/v2/TASKS-v2.md)
- [MVP — Phase 15](archive/v3/TASKS-v3-mvp.md)
- [Self-Governing — Phases 16–21](archive/v4/TASKS-v4-self-governing.md)
- [E2E + Channels — Phases 22–24](archive/v5/TASKS-v5-e2e-channels.md)
- [Smart Orchestration — Phases 25–28](archive/v6/TASKS-v6-smart-orchestration.md)
- [AI Classification — Phase 29](archive/v7/TASKS-v7-ai-classification.md)
- [Production Readiness — Phase 30](archive/v8/TASKS-v8-production-readiness.md)
- [Memory + Scale — Phases 31–38](archive/v9/TASKS-v9-memory-scale.md)
- [Memory Wiring — Phase 40](archive/v10/TASKS-v10-memory-wiring.md)
- [Memory Fixes — Phases 41–44](archive/v11/TASKS-v11-memory-fixes.md)
- [Post-v0.0.2 — Phases 45–50](archive/v12/TASKS-v12-post-v002-phases-45-50.md)
- [v0.0.3 — Phases 51–56](archive/v13/TASKS-v13-v003-phases-51-56.md)
- [v0.0.4 — Phases 57–62](archive/v14/TASKS-v14-v004-phases-57-62.md)
- [v0.0.5 — Phases 63–66](archive/v15/TASKS-v15-v005-phases-63-66.md)
- [v0.0.6 — Phase 67](archive/v16/TASKS-v16-v006-phase-67.md)

</details>

---

## Phase 68 — Full Media Attachment Support for WhatsApp + Telegram (OB-F43, OB-F44) — 27 tasks

> **Execution order matters.** `run-tasks.sh` picks tasks top-to-bottom. Dependencies are sequenced so each task can build on the previous one.

### Phase 68A — Core Infrastructure (shared across connectors)

| #   | Task ID | Description                                                                                                                                                                                                                                                                                                                                                       | Status  |
| --- | ------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------- |
| 1   | OB-1144 | Add `attachments` array to `InboundMessage` type in `src/types/message.ts` — fields: `type` (image/document/audio/video), `filePath`, `mimeType`, `filename`, `sizeBytes`. Verify no breaking changes in consumers (audit-logger.ts, queue.ts, bridge.ts, conversation-store.ts) — the field is optional so existing code should compile without changes          | ✅ Done |
| 2   | OB-1145 | Create `src/core/media-manager.ts` — managed temp directory (`<workspace>/.openbridge/media/`), `saveMedia(data: Buffer, mimeType: string, filename?: string)` → returns `{filePath, sizeBytes}`, TTL-based cleanup (default 1h), size cap (default 100MB), `cleanExpired()` method. Export `MediaManager` class + `createMediaManager(workspacePath)` factory    | ✅ Done |
| 3   | OB-1191 | Extract shared voice transcription into `src/core/voice-transcriber.ts` — refactor WhatsApp `transcribeVoiceMessage()` + `findWhisper()` into exported `transcribeAudio(audioPath: string): Promise<string \| null>`. Update WhatsApp connector to import and call the shared module instead of its inline implementation. Must run BEFORE Telegram voice handler | ✅ Done |
| 4   | OB-1146 | Add media context injection in `src/core/router.ts` — when `InboundMessage.attachments` is non-empty, append `## Attachments\n` section listing each file (path, type, mimeType, size) to the content string before passing to Master. Insert in `route()` method before the `processMessage()` call                                                              | ✅ Done |
| 5   | OB-1147 | Update `src/master/master-system-prompt.ts` — add `## Media Attachment Processing` section explaining: users may send images/docs/videos, attachment file paths appear in `## Attachments` block, Master should instruct workers to read/analyze files at those paths using the Read tool                                                                         | ✅ Done |
| 6   | OB-1148 | Update `src/master/master-manager.ts` — when building worker prompts via `buildPromptForWorker()`, if the originating message had attachments, prepend a `## Referenced Files` section to the worker prompt listing attachment file paths so the worker knows which files to read. No changes to SpawnOptions needed — paths are injected as prompt text          | ✅ Done |

### Phase 68B — WhatsApp Incoming Media (OB-F43)

| #   | Task ID | Description                                                                                                                                                                                                                                                                      | Status  |
| --- | ------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------- |
| 7   | OB-1192 | Update `parseWhatsAppMessage()` in `src/connectors/whatsapp/whatsapp-message.ts` — add optional `attachments` parameter to the function signature, pass through to `InboundMessage.attachments`. Keep backward-compatible (param defaults to undefined)                          | ✅ Done |
| 8   | OB-1149 | Add media download handler in `whatsapp-connector.ts` `handleIncomingMessage()` — detect `msg.hasMedia` for types `image`, `document`, `video`, `audio` (non-ptt); call `msg.downloadMedia()`; decode base64 to Buffer; save via `MediaManager.saveMedia()`                      | ✅ Done |
| 9   | OB-1150 | Populate `InboundMessage.attachments` in WhatsApp `handleIncomingMessage()` — build attachment metadata from MediaManager result, pass to updated `parseWhatsAppMessage()`; use caption (`msg.body`) as text content, fallback to `[Image]`/`[Document]`/`[Video]` if no caption | ✅ Done |
| 10  | OB-1151 | Handle WhatsApp sticker messages — detect `msg.type === 'sticker'`, download as `.webp`, attach as image type via same media download path                                                                                                                                       | ✅ Done |
| 11  | OB-1152 | Add download error handling — wrap `downloadMedia()` in try-catch; on failure, emit message with text `[Media attachment failed to download — {type}]` + continue with any caption text; log warning via Pino                                                                    | ✅ Done |
| 12  | OB-1153 | Send user feedback on media receipt — call `sendTypingIndicator()` immediately when `msg.hasMedia` is detected, before starting the download/processing                                                                                                                          | ✅ Done |

### Phase 68C — Telegram Full Media Support (OB-F44)

| #   | Task ID | Description                                                                                                                                                                                                                                                                                                                                                     | Status  |
| --- | ------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------- |
| 13  | OB-1154 | Extend `GrammyContext` interface in `telegram-connector.ts` — add `voice?: {file_id: string, duration: number}`, `photo?: Array<{file_id: string, width: number, height: number}>`, `document?: {file_id: string, file_name?: string, mime_type?: string}`, `video?: {file_id: string}`, `audio?: {file_id: string}`, `caption?: string` to the `message` field | ✅ Done |
| 14  | OB-1155 | Implement `downloadTelegramFile(bot, fileId, mediaManager)` helper — use `bot.api.getFile(fileId)` to get file_path, HTTPS GET from `https://api.telegram.org/file/bot<token>/<file_path>`, save Buffer via `MediaManager.saveMedia()`, return `{filePath, sizeBytes, mimeType}`                                                                                | ✅ Done |
| 15  | OB-1156 | Add `message:voice` handler — download `.oga` voice file via `downloadTelegramFile()`, transcribe via shared `transcribeAudio()` from `src/core/voice-transcriber.ts`, emit transcription as `InboundMessage.content`; fallback text if Whisper not installed                                                                                                   | ✅ Done |
| 16  | OB-1157 | Add `message:photo` handler — download largest photo size (last element in `ctx.message.photo` array), save via MediaManager, attach to `InboundMessage.attachments`, use `ctx.message.caption` as text content                                                                                                                                                 | ✅ Done |
| 17  | OB-1158 | Add `message:document` handler — download document file via `downloadTelegramFile()`, save via MediaManager, attach to `InboundMessage.attachments`, use caption as text                                                                                                                                                                                        | ✅ Done |
| 18  | OB-1159 | Add `message:video` handler — download video file via `downloadTelegramFile()`, save via MediaManager, attach to `InboundMessage.attachments`, use caption as text                                                                                                                                                                                              | ✅ Done |
| 19  | OB-1160 | Add `message:audio` handler — download audio file via `downloadTelegramFile()`, save via MediaManager, attach to `InboundMessage.attachments`, use caption as text                                                                                                                                                                                              | ✅ Done |
| 20  | OB-1161 | Telegram outbound media — in `sendMessage()`, when `OutboundMessage.media` is present, use `bot.api.sendPhoto()` / `sendDocument()` / `sendVideo()` / `sendVoice()` based on `media.type`; pass `media.data` as `InputFile`, `content` as caption                                                                                                               | ✅ Done |
| 21  | OB-1163 | Send user feedback on Telegram media receipt — call `bot.api.sendChatAction(chatId, 'upload_photo')` / `'upload_document'` while processing; on download failure reply with fallback text `[Failed to process {type}]`                                                                                                                                          | ✅ Done |

### Phase 68D — Tests + Validation

| #   | Task ID | Description                                                                                                                                                                                          | Status  |
| --- | ------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------- |
| 22  | OB-1164 | Unit tests for `MediaManager` — save/retrieve/cleanup/size-cap/TTL eviction, directory creation, concurrent saves — 8+ test cases                                                                    | ✅ Done |
| 23  | OB-1167 | Unit tests for shared `VoiceTranscriber` — Whisper available, Whisper missing fallback, OGG vs OGA formats, temp file cleanup — 5+ test cases                                                        | ✅ Done |
| 24  | OB-1165 | Unit tests for WhatsApp media handling — image download, document download, video download, sticker, download failure fallback, parseWhatsAppMessage with attachments — 7+ test cases                | ✅ Done |
| 25  | OB-1166 | Unit tests for Telegram media handling — voice transcription, photo download (largest size), document download, video download, caption extraction, download failure, outbound media — 9+ test cases | ✅ Done |
| 26  | OB-1193 | Unit tests for Router media injection — verify `## Attachments` section appended when attachments present, verify no injection when attachments absent — 3+ test cases                               | ✅ Done |
| 27  | OB-1168 | Build + lint + typecheck + full test suite validation — all existing tests still pass, new tests green                                                                                               | ✅ Done |

---

## Phase 69 — MCP Management Dashboard + Browse & Connect UI (OB-F45) — 23 tasks

> **Execution order matters.** `run-tasks.sh` picks tasks top-to-bottom. Dependencies are sequenced so each task can build on the previous one.

### Phase 69A — MCP Registry + Catalog Backend

| #   | Task ID | Description                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       | Status  |
| --- | ------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------- |
| 1   | OB-1170 | Define `MCPCatalogEntrySchema` in `src/types/config.ts` — Zod schema for catalog entries: `name`, `description`, `category` (enum: code/productivity/communication/data/design), `command`, `args: string[]`, `envVars: z.array(z.object({key: string, description: string, required: boolean}))`, `docsUrl: string`. Export type `MCPCatalogEntry`                                                                                                                                                               | ✅ Done |
| 2   | OB-1169 | Create `src/core/mcp-catalog.ts` — export `MCP_CATALOG: MCPCatalogEntry[]` as inline TypeScript const. Include 10+ entries: filesystem, GitHub, Slack, Gmail, Canva, Brave Search, Puppeteer, PostgreSQL, SQLite, Sentry. Each entry has name, description, category, command (e.g. `npx`), args (e.g. `["-y", "@modelcontextprotocol/server-filesystem"]`), envVars list, docsUrl                                                                                                                                | ✅ Done |
| 3   | OB-1171 | Create `src/core/mcp-registry.ts` — `McpRegistry` class with: constructor(configPath, initialServers), `addServer(server: MCPServer)` (reject duplicate names with Error), `removeServer(name: string)` (throw if not found), `toggleServer(name: string, enabled: boolean)`, `listServers(): Array<MCPServer & {enabled: boolean, status: 'healthy'\|'error'\|'unknown'}>` (calls `checkCommandOnPath` from health.ts), `getServer(name: string)`. Internal state: `Map<string, MCPServer & {enabled: boolean}>` | ✅ Done |
| 4   | OB-1173 | Implement config persistence in `McpRegistry` — `persistToConfig()` private method: read `config.json` via `fs.readFileSync`, parse JSON, merge `mcp.servers` array from internal state, write back via `fs.writeFileSync` (same pattern as existing `writeMcpConfig()` — no file locking needed, single-process Bridge). Called by `addServer()`, `removeServer()`, `toggleServer()`                                                                                                                             | ✅ Done |
| 5   | OB-1172 | Wire `McpRegistry` into Bridge startup in `src/index.ts` — create `McpRegistry` instance from `v2Config.mcp.servers`, pass to `Bridge` constructor, expose via `bridge.getMcpRegistry()`. Pass registry reference to WebChat connector via `connector.setMcpRegistry(registry)`                                                                                                                                                                                                                                   | ✅ Done |
| 6   | OB-1174 | Wire hot-reload — add `reloadMcpServers(servers: MCPServer[])` method to `MasterManager` that updates `this.mcpServers` and marks system prompt as stale for next message. In `config-watcher.ts`, when config reloads, call `bridge.getMcpRegistry().reload(newServers)` then `masterManager.reloadMcpServers(newServers)`. When `McpRegistry` modifies config, trigger config-watcher debounce to propagate changes                                                                                             | ✅ Done |

### Phase 69B — REST API Endpoints

| #   | Task ID | Description                                                                                                                                                                                                                                                                                                                                            | Status  |
| --- | ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------- |
| 7   | OB-1175 | Add `GET /api/mcp/servers` endpoint on WebChat HTTP server — returns `McpRegistry.listServers()` as JSON array. Each entry: `{name, command, args, enabled, status}`. Env vars masked (masking task handles this). Response: 200 + JSON, 503 if registry not available                                                                                 | ✅ Done |
| 8   | OB-1176 | Add `POST /api/mcp/servers` endpoint — parse JSON body `{name, command, args?, env?}`, validate via `MCPServerSchema.safeParse()`, call `McpRegistry.addServer()`. Return 201 + created server on success, 400 on validation failure, 409 if server name already exists                                                                                | ✅ Done |
| 9   | OB-1177 | Add `DELETE /api/mcp/servers/:name` endpoint — URL-decode name param, call `McpRegistry.removeServer(name)`. Return 204 on success, 404 if not found                                                                                                                                                                                                   | ✅ Done |
| 10  | OB-1178 | Add `PATCH /api/mcp/servers/:name` endpoint — parse JSON body `{enabled: boolean}`, call `McpRegistry.toggleServer(name, enabled)`. Return 200 + updated server, 404 if not found                                                                                                                                                                      | ✅ Done |
| 11  | OB-1179 | Add `GET /api/mcp/catalog` endpoint — return `MCP_CATALOG` from `mcp-catalog.ts` as JSON array. Support optional `?category=code` query param to filter. Return 200 + JSON                                                                                                                                                                             | ✅ Done |
| 12  | OB-1180 | Add `POST /api/mcp/catalog/:name/connect` endpoint — look up catalog entry by name (404 if not found), parse body `{envVars: {KEY: "value"}}`, validate all required env vars are provided (400 if missing), build `MCPServer` from catalog template + user env vars, call `McpRegistry.addServer()` (409 if name exists). Return 201 + created server | ✅ Done |

### Phase 69C — WebChat MCP Dashboard UI

| #   | Task ID | Description                                                                                                                                                                                                                                                                                                                                                                | Status    |
| --- | ------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------- |
| 13  | OB-1181 | Add MCP Dashboard panel to WebChat embedded HTML — collapsible section (reuse Agent Status `dash-hdr` pattern) with header "MCP Servers", showing connected servers as cards with: name, status dot (green = healthy, red = error, gray = unknown), category badge, toggle switch (calls PATCH), remove button (calls DELETE with confirm). Place after Agent Status panel | ✅ Done   |
| 14  | OB-1182 | Add "Browse Servers" button + catalog modal — button in MCP Dashboard header opens a modal overlay. Modal fetches `GET /api/mcp/catalog` once, renders entries grouped by category with search input for client-side filtering. Each entry shows: name, description, "Connect" button                                                                                      | ◻ Pending |
| 15  | OB-1183 | Add catalog "Connect" flow — clicking Connect on a catalog entry replaces the modal content with a form showing required env var fields (label = envVar.description, placeholder = envVar.key, red asterisk if required). Submit calls `POST /api/mcp/catalog/:name/connect`. On success: close modal, refresh server list. On error: show inline error message            | ◻ Pending |
| 16  | OB-1184 | Add "Add Custom Server" form — expandable form at bottom of MCP panel: server name (text), command (text), args (comma-separated text, split on submit), env vars (dynamic key=value rows with + button). Submit calls `POST /api/mcp/servers`. On success: clear form, refresh server list                                                                                | ◻ Pending |
| 17  | OB-1185 | Real-time MCP status updates — on receiving WebSocket `mcp-status` event, re-render the MCP server list with updated statuses. Fallback: poll `GET /api/mcp/servers` every 30s if WebSocket is disconnected                                                                                                                                                                | ◻ Pending |
| 18  | OB-1186 | Add WebSocket `mcp-status` event — add `broadcastMcpStatus(servers)` method to WebChatConnector (same pattern as `broadcastAgentStatus()`). Wire McpRegistry to call this on every add/remove/toggle. Payload format: `{type: 'mcp-status', servers: [{name, enabled, status}]}`                                                                                           | ◻ Pending |

### Phase 69D — Security + Tests

| #   | Task ID | Description                                                                                                                                                                                                                                        | Status    |
| --- | ------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------- |
| 19  | OB-1187 | Credential masking — in `McpRegistry.listServers()`, mask ALL env var values before returning: show first 4 chars + `****` (or `****` if value < 4 chars). Full values only stored internally, never sent to API responses or WebSocket broadcasts | ◻ Pending |
| 20  | OB-1188 | Unit tests for `McpRegistry` — addServer, removeServer, toggleServer, listServers with health, config persistence (mock fs), duplicate name rejection (409), not-found rejection (404), env var masking — 10+ test cases                           | ◻ Pending |
| 21  | OB-1189 | Unit tests for MCP REST endpoints — GET/POST/DELETE/PATCH servers, GET catalog with category filter, POST catalog connect (success + missing env vars + not found + duplicate), validation errors — 12+ test cases                                 | ◻ Pending |
| 22  | OB-1194 | Unit tests for MCP Dashboard WebSocket — verify `mcp-status` broadcast on add/remove/toggle, verify payload format, verify masking in broadcast — 4+ test cases                                                                                    | ◻ Pending |
| 23  | OB-1190 | Build + lint + typecheck + full test suite validation — all existing tests still pass, new tests green                                                                                                                                             | ◻ Pending |

---

## Status Legend

|  Status   | Description               |
| :-------: | ------------------------- |
|  ✅ Done  | Completed and verified    |
| 🔄 Active | Currently being worked on |
|  ◻ Todo   | Not started               |
