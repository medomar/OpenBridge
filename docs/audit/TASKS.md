# OpenBridge — Task List

> **Pending:** 25 | **In Progress:** 0 | **Done:** 0
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

## Phase 68 — Full Media Attachment Support for WhatsApp + Telegram (OB-F43, OB-F44) — 25 tasks

### Phase 68A — Core Infrastructure (shared across connectors)

| #   | Task ID | Description                                                                                                                                                                                                        | Status    |
| --- | ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------- |
| 1   | OB-1144 | Add `attachments` array to `InboundMessage` type in `src/types/message.ts` — fields: `type` (image/document/audio/video), `filePath`, `mimeType`, `filename`, `sizeBytes`                                          | ◻ Pending |
| 2   | OB-1145 | Create `src/core/media-manager.ts` — managed temp directory (`<workspace>/.openbridge/media/`), `saveMedia(data, mimeType, filename)` → returns filePath, TTL-based cleanup (default 1h), size cap (default 100MB) | ◻ Pending |
| 3   | OB-1146 | Add media context injection in `src/core/router.ts` — when `InboundMessage.attachments` is non-empty, append `## Attachments` section to the content sent to Master (file paths, types, sizes)                     | ◻ Pending |
| 4   | OB-1147 | Update `src/master/master-system-prompt.ts` — add media capabilities section so Master knows it can instruct workers to read/analyze attached files at their file paths                                            | ◻ Pending |
| 5   | OB-1148 | Update `src/master/master-manager.ts` — pass attachment file paths as allowed context when spawning workers so workers have access to the media files                                                              | ◻ Pending |

### Phase 68B — WhatsApp Incoming Media (OB-F43)

| #   | Task ID | Description                                                                                                                                                                                | Status    |
| --- | ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------- |
| 6   | OB-1149 | Add media download handler in `whatsapp-connector.ts` — detect `msg.hasMedia` for types `image`, `document`, `video`, `audio` (non-ptt); call `msg.downloadMedia()`; save via MediaManager | ◻ Pending |
| 7   | OB-1150 | Populate `InboundMessage.attachments` in WhatsApp `handleIncomingMessage()` — attach downloaded file metadata; use caption (`msg.body`) as text content                                    | ◻ Pending |
| 8   | OB-1151 | Handle WhatsApp sticker messages — detect `msg.type === 'sticker'`, download as `.webp`, attach as image type                                                                              | ◻ Pending |
| 9   | OB-1152 | Add download error handling — if `downloadMedia()` fails, emit message with text `[Media attachment failed to download — {type}]` + continue with any caption text                         | ◻ Pending |
| 10  | OB-1153 | Send user feedback on media receipt — reply with typing indicator while downloading/processing large media files                                                                           | ◻ Pending |

### Phase 68C — Telegram Full Media Support (OB-F44)

| #   | Task ID | Description                                                                                                                                                                                    | Status    |
| --- | ------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------- |
| 11  | OB-1154 | Extend `GrammyContext` interface — add `voice`, `photo` (array), `document`, `video`, `audio`, `caption` fields to match Telegram Bot API types                                                | ◻ Pending |
| 12  | OB-1155 | Implement `downloadTelegramFile(fileId)` helper — use `bot.api.getFile(fileId)` to get file path, HTTPS download from `https://api.telegram.org/file/bot<token>/<path>`, save via MediaManager | ◻ Pending |
| 13  | OB-1156 | Add `message:voice` handler — download `.oga` voice file, transcribe via Whisper CLI (reuse pattern from WhatsApp `transcribeVoiceMessage()`), emit transcription as `InboundMessage.content`  | ◻ Pending |
| 14  | OB-1157 | Add `message:photo` handler — download largest photo size (last in array), save via MediaManager, attach to `InboundMessage.attachments`, use caption as text                                  | ◻ Pending |
| 15  | OB-1158 | Add `message:document` handler — download document file, save via MediaManager, attach to `InboundMessage.attachments`, use caption as text                                                    | ◻ Pending |
| 16  | OB-1159 | Add `message:video` handler — download video file, save via MediaManager, attach to `InboundMessage.attachments`, use caption as text                                                          | ◻ Pending |
| 17  | OB-1160 | Add `message:audio` handler — download audio file, save via MediaManager, attach to `InboundMessage.attachments`, use caption as text                                                          | ◻ Pending |
| 18  | OB-1161 | Telegram outbound media — implement `sendPhoto`, `sendDocument`, `sendVideo`, `sendVoice` in `send()` when `OutboundMessage.media` is present                                                  | ◻ Pending |
| 19  | OB-1162 | Extract shared voice transcription logic — refactor WhatsApp `transcribeVoiceMessage()` into `src/core/voice-transcriber.ts` so both WhatsApp and Telegram can reuse it                        | ◻ Pending |
| 20  | OB-1163 | Send user feedback on Telegram media receipt — send chat action `upload_photo`/`upload_document` while processing; reply with fallback text if media download fails                            | ◻ Pending |

### Phase 68D — Tests + Validation

| #   | Task ID | Description                                                                                                                                                           | Status    |
| --- | ------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------- |
| 21  | OB-1164 | Unit tests for `MediaManager` — save/retrieve/cleanup/size-cap/TTL eviction — 8+ test cases                                                                           | ◻ Pending |
| 22  | OB-1165 | Unit tests for WhatsApp media handling — image download, document download, video download, sticker, download failure fallback — 6+ test cases                        | ◻ Pending |
| 23  | OB-1166 | Unit tests for Telegram media handling — voice transcription, photo download, document download, video download, caption extraction, download failure — 8+ test cases | ◻ Pending |
| 24  | OB-1167 | Unit tests for shared `VoiceTranscriber` — Whisper available, Whisper missing fallback, OGG vs OGA formats, temp file cleanup — 5+ test cases                         | ◻ Pending |
| 25  | OB-1168 | Build + lint + typecheck + full test suite validation — all existing tests still pass, new tests green                                                                | ◻ Pending |

---

## Status Legend

|  Status   | Description               |
| :-------: | ------------------------- |
|  ✅ Done  | Completed and verified    |
| 🔄 Active | Currently being worked on |
| ◻ Pending | Not started               |
