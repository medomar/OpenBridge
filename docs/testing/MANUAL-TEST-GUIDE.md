# OpenBridge — Manual Test Guide

> **Version:** v0.0.12 | **Last Updated:** 2026-03-05
>
> Complete manual test checklist covering all shipped features. Run through this before any release.

---

## Prerequisites

- Node.js >= 22
- Claude Code installed (`which claude` returns a path)
- OpenBridge built: `npm run build`
- A test workspace with representative files

---

## Setup

### 1. Console (fastest — start here)

```json
{
  "workspacePath": "/path/to/test/workspace",
  "channels": [{ "type": "console", "enabled": true }],
  "auth": { "whitelist": ["console-user"], "prefix": "/ai" }
}
```

```bash
CONFIG_PATH=config.test.json npm run dev
```

### 2. WhatsApp

```json
{
  "workspacePath": "/path/to/test/workspace",
  "channels": [{ "type": "whatsapp", "enabled": true }],
  "auth": { "whitelist": ["<your-phone-number>@c.us"], "prefix": "/ai" }
}
```

Scan the QR code from the terminal with your phone.

### 3. WebChat

```json
{
  "workspacePath": "/path/to/test/workspace",
  "channels": [
    { "type": "webchat", "enabled": true, "options": { "port": 3000, "auth": { "type": "token" } } }
  ],
  "auth": { "whitelist": ["webchat-user"], "prefix": "/ai" }
}
```

Open the URL printed in the console (includes auth token).

### 4. Telegram

```json
{
  "workspacePath": "/path/to/test/workspace",
  "channels": [{ "type": "telegram", "enabled": true, "options": { "token": "<BOT_TOKEN>" } }],
  "auth": { "whitelist": ["<your-telegram-id>"], "prefix": "/ai" }
}
```

### 5. Discord

```json
{
  "workspacePath": "/path/to/test/workspace",
  "channels": [
    {
      "type": "discord",
      "enabled": true,
      "options": { "token": "<BOT_TOKEN>", "applicationId": "<APP_ID>" }
    }
  ],
  "auth": { "whitelist": ["<your-discord-id>"], "prefix": "/ai" }
}
```

---

## 1. Startup & Discovery

| #   | Test                    | Steps                             | Expected                                                                                       |
| --- | ----------------------- | --------------------------------- | ---------------------------------------------------------------------------------------------- |
| 1.1 | AI discovery            | Start bridge                      | Logs show detected AI tools (Claude, Codex, etc.)                                              |
| 1.2 | Master AI launch        | Start bridge                      | Logs show "Master AI session started" with session ID                                          |
| 1.3 | Exploration runs        | Start bridge with fresh workspace | 5 phases complete: structure_scan → classification → directory_dives → assembly → finalization |
| 1.4 | Workspace map created   | After exploration                 | `.openbridge/workspace-map.json` exists with project structure                                 |
| 1.5 | Exploration state saved | After exploration                 | `.openbridge/exploration/exploration-state.json` has all phases checkpointed                   |
| 1.6 | Config hot-reload       | Edit `config.json` while running  | Logs show config reloaded, no restart needed                                                   |

---

## 2. Core Message Flow

| #   | Test                    | Steps                                     | Expected                                                                |
| --- | ----------------------- | ----------------------------------------- | ----------------------------------------------------------------------- |
| 2.1 | Basic Q&A               | `/ai what's in this workspace?`           | AI describes workspace contents accurately                              |
| 2.2 | Auth enforcement        | Send message without prefix               | Message ignored (not routed to AI)                                      |
| 2.3 | Whitelist enforcement   | Send from non-whitelisted user            | Message rejected                                                        |
| 2.4 | Multi-turn context      | Ask follow-up referencing previous answer | AI uses `--resume` flag, maintains context                              |
| 2.5 | Long response splitting | Ask for detailed analysis                 | Long responses split into multiple messages (WhatsApp/Telegram/Discord) |
| 2.6 | Graceful unknown        | Ask about data that doesn't exist         | AI explains what's missing, no crash or hallucination                   |
| 2.7 | Fast-path response      | Send a simple greeting                    | Quick response while Master processes (no long wait)                    |

---

## 3. Worker Orchestration

| #   | Test               | Steps                                       | Expected                                                                         |
| --- | ------------------ | ------------------------------------------- | -------------------------------------------------------------------------------- |
| 3.1 | Worker spawning    | `/ai refactor this function` (complex task) | Logs show worker spawned with tool profile and model                             |
| 3.2 | Tool profiles      | Check worker logs                           | Workers get appropriate tools (read-only for exploration, code-edit for changes) |
| 3.3 | Worker streaming   | Watch console during long task              | Partial results stream back as worker produces output                            |
| 3.4 | Worker kill        | `/workers` then `stop <id>`                 | Worker terminated, Master notified                                               |
| 3.5 | `/workers` command | Type `/workers`                             | Shows active workers with PID, status, elapsed time                              |
| 3.6 | Concurrency limits | Trigger multiple tasks rapidly              | Workers respect concurrency limit (no runaway spawning)                          |
| 3.7 | Worker timeout     | Send task that takes too long               | Worker killed after max-turns, Master gets timeout notification                  |

---

## 4. Memory & Persistence

| #   | Test                        | Steps                                   | Expected                                                    |
| --- | --------------------------- | --------------------------------------- | ----------------------------------------------------------- |
| 4.1 | memory.md created           | After first session                     | `.openbridge/context/memory.md` exists with project summary |
| 4.2 | memory.md loaded on restart | Restart bridge, ask about previous work | AI references info from memory.md without re-exploring      |
| 4.3 | Conversation stored         | Send messages, check DB                 | `conversation_messages` table has entries                   |
| 4.4 | FTS5 search                 | `/history search <keyword>`             | Returns matching conversations                              |
| 4.5 | `/history` command          | Type `/history`                         | Lists recent sessions with dates and message counts         |
| 4.6 | Session transcript          | `/history <session-id>`                 | Full conversation transcript shown                          |
| 4.7 | Learnings stored            | Complete a task, check DB               | `learnings` table has entry for the task                    |
| 4.8 | Workspace chunks            | After exploration, check DB             | `context_chunks` table has entries for workspace files      |

---

## 5. Deep Mode

| #   | Test              | Steps                                | Expected                                                                |
| --- | ----------------- | ------------------------------------ | ----------------------------------------------------------------------- |
| 5.1 | Trigger Deep Mode | `/deep <topic>`                      | 5-phase analysis starts: investigate → report → plan → execute → verify |
| 5.2 | Phase status      | `/deep status`                       | Shows current phase and progress                                        |
| 5.3 | Phase navigation  | `/deep next` / `/deep skip`          | Advances or skips current phase                                         |
| 5.4 | Model override    | "use opus for this" during Deep Mode | Model switches mid-session                                              |
| 5.5 | Session saved     | After completion                     | `.openbridge/deep-mode/session-*.json` created                          |
| 5.6 | Deep Mode cancel  | `/deep cancel` mid-session           | Session ends cleanly, no orphaned workers                               |

---

## 6. WebChat Features

| #    | Test                | Steps                                   | Expected                                                |
| ---- | ------------------- | --------------------------------------- | ------------------------------------------------------- |
| 6.1  | Token auth          | Open WebChat URL with token             | Chat UI loads                                           |
| 6.2  | No token rejection  | Open WebChat URL without token          | 401 Unauthorized                                        |
| 6.3  | Password auth       | Configure password auth, login via form | Auth succeeds, chat loads                               |
| 6.4  | Dark mode           | Toggle theme in settings                | Theme switches and persists after refresh               |
| 6.5  | Markdown rendering  | Ask AI to write code                    | Code blocks with syntax highlighting, copy button works |
| 6.6  | History sidebar     | Click history icon                      | Past conversations listed, clickable                    |
| 6.7  | History search      | Search in sidebar                       | Filters conversations by keyword                        |
| 6.8  | File upload         | Drag-and-drop or use upload button      | File attached to conversation                           |
| 6.9  | PWA install         | Open on mobile browser                  | "Add to Home Screen" prompt appears                     |
| 6.10 | WebSocket reconnect | Kill and restart bridge                 | WebChat reconnects automatically                        |

---

## 7. Runtime Controls

| #   | Test                | Steps                                             | Expected                                                               |
| --- | ------------------- | ------------------------------------------------- | ---------------------------------------------------------------------- |
| 7.1 | `/allow` escalation | Worker requests blocked tool, user sends `/allow` | Permission granted, worker continues                                   |
| 7.2 | `/deny` escalation  | Worker requests blocked tool, user sends `/deny`  | Permission denied, worker adapts                                       |
| 7.3 | Persistent grants   | Grant `/allow`, restart bridge                    | Grant persists in `access_control` table                               |
| 7.4 | Batch continuation  | Send multi-step task                              | Self-continues across steps with safety limits (iteration, cost, time) |
| 7.5 | Batch safety rails  | Let batch run                                     | Stops at iteration limit, notifies user                                |

---

## 8. Tunnel & Output Sharing

| #   | Test               | Steps                                          | Expected                                           |
| --- | ------------------ | ---------------------------------------------- | -------------------------------------------------- |
| 8.1 | Tunnel auto-detect | Install `cloudflared` or `ngrok`, start bridge | Tunnel URL generated in logs                       |
| 8.2 | SHARE markers      | Ask AI to create a webpage                     | `[SHARE:webchat]` in output triggers file delivery |
| 8.3 | App server         | AI scaffolds a web app                         | Served on auto-allocated port with idle timeout    |
| 8.4 | File server        | AI generates a file output                     | File accessible via local URL                      |

---

## 9. Docker Sandbox

| #   | Test                | Steps                              | Expected                                |
| --- | ------------------- | ---------------------------------- | --------------------------------------- |
| 9.1 | Docker detection    | Have Docker running, start bridge  | Logs show Docker available              |
| 9.2 | Container isolation | Trigger a task with Docker enabled | Worker runs inside container            |
| 9.3 | Resource limits     | Check container stats              | CPU/memory limits from config respected |
| 9.4 | Cleanup             | After worker completes             | Container removed automatically         |

---

## 10. WhatsApp-Specific

| #    | Test                | Steps                              | Expected                                                     |
| ---- | ------------------- | ---------------------------------- | ------------------------------------------------------------ |
| 10.1 | QR code display     | Start with WhatsApp config         | QR code appears in terminal                                  |
| 10.2 | QR scan auth        | Scan with phone                    | Session authenticated, "WhatsApp ready" logged               |
| 10.3 | Session persistence | Restart bridge                     | No QR rescan needed (session stored in `.wwebjs_auth/`)      |
| 10.4 | Voice message       | Send voice message from phone      | Transcribed and processed as text                            |
| 10.5 | Image/media         | Send image from phone              | Media handled (downloaded, described if applicable)          |
| 10.6 | Message chunking    | Trigger long AI response           | Split into multiple WhatsApp messages at natural breakpoints |
| 10.7 | Reconnection        | Disconnect WiFi briefly, reconnect | WhatsApp reconnects without crash                            |

---

## 11. Telegram-Specific

| #    | Test               | Steps                 | Expected                            |
| ---- | ------------------ | --------------------- | ----------------------------------- |
| 11.1 | Bot responds       | Send message to bot   | AI response received                |
| 11.2 | Long message split | Trigger long response | Split at Telegram's 4096-char limit |
| 11.3 | Media handling     | Send photo to bot     | Media processed                     |

---

## 12. Discord-Specific

| #    | Test          | Steps                  | Expected                           |
| ---- | ------------- | ---------------------- | ---------------------------------- |
| 12.1 | DM support    | Send DM to bot         | AI response received               |
| 12.2 | Guild channel | Mention bot in channel | AI responds in channel             |
| 12.3 | Message split | Trigger long response  | Split at Discord's 2000-char limit |

---

## 13. Error Resilience

| #    | Test                     | Steps                                    | Expected                                                   |
| ---- | ------------------------ | ---------------------------------------- | ---------------------------------------------------------- |
| 13.1 | Master kill recovery     | Kill Master AI process (`kill -9 <PID>`) | Bridge detects, restarts Master, no crash                  |
| 13.2 | Worker kill recovery     | Kill a worker process mid-task           | Bridge detects, notifies Master, no crash                  |
| 13.3 | Queue during exploration | Send messages while exploring            | Messages queued, processed after exploration completes     |
| 13.4 | Graceful shutdown        | Ctrl+C                                   | Sessions closed, workers terminated, no orphaned processes |
| 13.5 | Long message handling    | Send extremely long message (>10k chars) | Handled without crash (truncated if needed)                |
| 13.6 | Invalid config           | Start with malformed config.json         | Clear error message, bridge doesn't crash                  |
| 13.7 | Missing AI tools         | Start with no AI tools installed         | Clear error message listing what's needed                  |

---

## 14. CLI & Config

| #    | Test                  | Steps                      | Expected                                       |
| ---- | --------------------- | -------------------------- | ---------------------------------------------- |
| 14.1 | `npx openbridge init` | Run CLI wizard             | Generates valid `config.json` with 3 questions |
| 14.2 | V2 config             | Use minimal 3-field config | Bridge starts correctly                        |
| 14.3 | V0 fallback           | Use legacy config format   | Bridge starts with deprecation warning         |
| 14.4 | Schema versioning     | Check DB                   | `schema_versions` table shows current version  |

---

## Quick Smoke Test (5 minutes)

For a fast validation pass, run these 10 tests:

1. `npm run build` — compiles without errors
2. `npm run test` — tests pass
3. Start with Console config — bridge starts, exploration runs
4. `/ai what's in this workspace?` — accurate response
5. Follow-up question — context preserved
6. `/history` — shows the session
7. `/workers` — shows worker status
8. Ctrl+C — clean shutdown in logs
9. Restart — memory.md loaded, no re-exploration
10. Check `.openbridge/` folder — workspace-map.json, memory.md, openbridge.db exist

---

## Related Docs

- [Configuration](../CONFIGURATION.md) — All config options
- [Connectors](../CONNECTORS.md) — Channel setup guides
- [Troubleshooting](../TROUBLESHOOTING.md) — Common errors and fixes
- [Testing Guide](../TESTING_GUIDE.md) — Automated testing workflows
