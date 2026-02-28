# OpenBridge — Audit Findings

> **Purpose:** Real issues, gaps, and risks discovered during code audits and real-world testing.
> **This is NOT a task list.** Tasks live in [TASKS.md](TASKS.md). Findings document _what's wrong_ and _why it matters_.
> **Open:** 2 | **Fixed:** 44 | **Last Audit:** 2026-02-28
> **Resolved findings:** [V0 archive](archive/v0/FINDINGS-v0.md) | [V2 archive](archive/v2/FINDINGS-v2.md) | [V4 archive](archive/v4/FINDINGS-v4.md) | [V5 archive](archive/v5/FINDINGS-v5.md) | [V6 archive](archive/v6/FINDINGS-v6.md) | [V7 archive](archive/v7/FINDINGS-v7.md) | [V8 archive](archive/v8/FINDINGS-v8.md) | [V15 archive](archive/v15/FINDINGS-v15.md) | [V16 archive](archive/v16/FINDINGS-v16.md)

---

## Priority Order

| #   | Finding                                                         | Severity | Impact                                                               | Status |
| --- | --------------------------------------------------------------- | -------- | -------------------------------------------------------------------- | ------ |
| 43  | OB-F43 — WhatsApp incoming media ignored (images, docs, videos) | 🟠 High  | Users cannot send images, documents, or videos as task context       | Open   |
| 44  | OB-F44 — Telegram has zero media support (incoming + voice)     | 🟠 High  | Telegram users limited to text-only; voice messages silently dropped | Open   |

---

## Open Findings

### OB-F43 — WhatsApp incoming media ignored (images, documents, videos) 🟠 High

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
- `src/core/router.ts` — needs to pass attachment context to Master
- `src/master/master-manager.ts` — Master prompt needs attachment awareness
- `src/master/master-system-prompt.ts` — system prompt should describe media capabilities

---

### OB-F44 — Telegram connector has zero media support (incoming + voice) 🟠 High

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
