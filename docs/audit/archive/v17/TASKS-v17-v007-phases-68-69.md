# OpenBridge — Task Archive: v0.0.7 (Phases 68–69)

> **50 tasks completed** | **Findings resolved:** OB-F43, OB-F44, OB-F45
> **Archived:** 2026-02-28

## Phase 68 — Full Media Attachment Support for WhatsApp + Telegram (OB-F43, OB-F44) — 27 tasks

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

| #   | Task ID | Description                                                                                                                                         | Status  |
| --- | ------- | --------------------------------------------------------------------------------------------------------------------------------------------------- | ------- |
| 13  | OB-1154 | Extend `GrammyContext` interface in `telegram-connector.ts` — add `voice`, `photo`, `document`, `video`, `audio`, `caption` fields                  | ✅ Done |
| 14  | OB-1155 | Implement `downloadTelegramFile(bot, fileId, mediaManager)` helper                                                                                  | ✅ Done |
| 15  | OB-1156 | Add `message:voice` handler — download `.oga` voice file, transcribe via shared `transcribeAudio()`, emit transcription as `InboundMessage.content` | ✅ Done |
| 16  | OB-1157 | Add `message:photo` handler — download largest photo size, save via MediaManager, attach to `InboundMessage.attachments`                            | ✅ Done |
| 17  | OB-1158 | Add `message:document` handler — download document file, save via MediaManager, attach to `InboundMessage.attachments`                              | ✅ Done |
| 18  | OB-1159 | Add `message:video` handler — download video file, save via MediaManager, attach to `InboundMessage.attachments`                                    | ✅ Done |
| 19  | OB-1160 | Add `message:audio` handler — download audio file, save via MediaManager, attach to `InboundMessage.attachments`                                    | ✅ Done |
| 20  | OB-1161 | Telegram outbound media — in `sendMessage()`, use `sendPhoto()` / `sendDocument()` / `sendVideo()` / `sendVoice()` based on `media.type`            | ✅ Done |
| 21  | OB-1163 | Send user feedback on Telegram media receipt — `sendChatAction()` while processing; fallback text on download failure                               | ✅ Done |

### Phase 68D — Tests + Validation

| #   | Task ID | Description                                              | Status  |
| --- | ------- | -------------------------------------------------------- | ------- |
| 22  | OB-1164 | Unit tests for `MediaManager` — 8+ test cases            | ✅ Done |
| 23  | OB-1167 | Unit tests for shared `VoiceTranscriber` — 5+ test cases | ✅ Done |
| 24  | OB-1165 | Unit tests for WhatsApp media handling — 7+ test cases   | ✅ Done |
| 25  | OB-1166 | Unit tests for Telegram media handling — 9+ test cases   | ✅ Done |
| 26  | OB-1193 | Unit tests for Router media injection — 3+ test cases    | ✅ Done |
| 27  | OB-1168 | Build + lint + typecheck + full test suite validation    | ✅ Done |

## Phase 69 — MCP Management Dashboard + Browse & Connect UI (OB-F45) — 23 tasks

### Phase 69A — MCP Registry + Catalog Backend

| #   | Task ID | Description                                                                       | Status  |
| --- | ------- | --------------------------------------------------------------------------------- | ------- |
| 1   | OB-1170 | Define `MCPCatalogEntrySchema` in `src/types/config.ts`                           | ✅ Done |
| 2   | OB-1169 | Create `src/core/mcp-catalog.ts` — 10+ catalog entries                            | ✅ Done |
| 3   | OB-1171 | Create `src/core/mcp-registry.ts` — `McpRegistry` class with CRUD + health checks | ✅ Done |
| 4   | OB-1173 | Implement config persistence in `McpRegistry`                                     | ✅ Done |
| 5   | OB-1172 | Wire `McpRegistry` into Bridge startup in `src/index.ts`                          | ✅ Done |
| 6   | OB-1174 | Wire hot-reload — `reloadMcpServers()` + config-watcher integration               | ✅ Done |

### Phase 69B — REST API Endpoints

| #   | Task ID | Description                                    | Status  |
| --- | ------- | ---------------------------------------------- | ------- |
| 7   | OB-1175 | `GET /api/mcp/servers` endpoint                | ✅ Done |
| 8   | OB-1176 | `POST /api/mcp/servers` endpoint               | ✅ Done |
| 9   | OB-1177 | `DELETE /api/mcp/servers/:name` endpoint       | ✅ Done |
| 10  | OB-1178 | `PATCH /api/mcp/servers/:name` endpoint        | ✅ Done |
| 11  | OB-1179 | `GET /api/mcp/catalog` endpoint                | ✅ Done |
| 12  | OB-1180 | `POST /api/mcp/catalog/:name/connect` endpoint | ✅ Done |

### Phase 69C — WebChat MCP Dashboard UI

| #   | Task ID | Description                                  | Status  |
| --- | ------- | -------------------------------------------- | ------- |
| 13  | OB-1181 | MCP Dashboard panel in WebChat embedded HTML | ✅ Done |
| 14  | OB-1182 | "Browse Servers" button + catalog modal      | ✅ Done |
| 15  | OB-1183 | Catalog "Connect" flow with env var form     | ✅ Done |
| 16  | OB-1184 | "Add Custom Server" form                     | ✅ Done |
| 17  | OB-1185 | Real-time MCP status updates via WebSocket   | ✅ Done |
| 18  | OB-1186 | WebSocket `mcp-status` event broadcast       | ✅ Done |

### Phase 69D — Security + Tests

| #   | Task ID | Description                                            | Status  |
| --- | ------- | ------------------------------------------------------ | ------- |
| 19  | OB-1187 | Credential masking in `McpRegistry.listServers()`      | ✅ Done |
| 20  | OB-1188 | Unit tests for `McpRegistry` — 10+ test cases          | ✅ Done |
| 21  | OB-1189 | Unit tests for MCP REST endpoints — 12+ test cases     | ✅ Done |
| 22  | OB-1194 | Unit tests for MCP Dashboard WebSocket — 4+ test cases | ✅ Done |
| 23  | OB-1190 | Build + lint + typecheck + full test suite validation  | ✅ Done |
