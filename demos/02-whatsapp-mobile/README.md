# Demo 02: WhatsApp Mobile Control

> **Audience:** Mobile-first teams | **Duration:** 10 min | **Difficulty:** Beginner
> Control your AI development team from your phone.

---

## Key Message

"Send a WhatsApp message. An AI team gets to work on your project."

## What This Demo Shows

- QR code pairing with WhatsApp
- Sending commands from your phone to your codebase
- AI responses delivered as WhatsApp messages
- Worker orchestration visible in real-time
- Voice messages transcribed and executed as commands

---

## Setup (Before the Demo)

1. Copy the config:
   ```bash
   cp demos/02-whatsapp-mobile/config.json config.json
   ```
2. Edit `workspacePath` and add your phone number to `whitelist`
3. Have your phone ready with WhatsApp open
4. Run `npm run dev` — a QR code appears in the terminal
5. Scan the QR code from WhatsApp (Settings > Linked Devices)

**Pre-demo tip:** Do the QR pairing 5 minutes before the presentation. The session persists.

## Demo Script

### Step 1: Show the QR Pairing (60s)

Show terminal with QR code. Scan from phone.

**Talking Point:** "One QR scan. That's the entire mobile setup. No app to install, no account to create. It uses WhatsApp — the app your team already has."

### Step 2: Send a Command From Your Phone (90s)

From WhatsApp, send:

```
/ai describe this project
```

Show the response arriving on your phone. Project the phone screen if possible.

**Talking Point:** "I just asked the AI about the project from my phone. It explored the codebase on startup, so it already knows the answer. No laptop needed."

### Step 3: Request a Code Change (120s)

From WhatsApp, send:

```
/ai add a health check endpoint that returns the Node.js version
```

Show the terminal — the Master AI spawns a worker, the worker edits files, the result comes back to your phone.

**Talking Point:** "The Master AI broke this into subtasks, spawned a worker with code-edit permissions, and the worker made the change. All from a WhatsApp message."

### Step 4: Show Worker Activity (60s)

From WhatsApp, send:

```
/ai /workers
```

Show the worker status response.

**Talking Point:** "You can monitor active workers, stop them, check their progress — all from your phone."

### Step 5: Voice Command (Optional, 60s)

Send a voice message from WhatsApp saying: "What tests are in this project?"

Show the transcription and AI response.

**Talking Point:** "Voice messages are automatically transcribed and executed as commands. Talk to your codebase while walking to a meeting."

---

## Talking Points Summary

| Point              | Message                                                     |
| ------------------ | ----------------------------------------------------------- |
| **No app install** | Uses WhatsApp — already on every phone.                     |
| **QR pairing**     | One scan, persistent session.                               |
| **Full control**   | Code changes, worker management, history — all from mobile. |
| **Voice support**  | Speak your commands. Transcription is automatic.            |
| **Security**       | Phone whitelist. Only authorized numbers can send commands. |

---

## Common Questions

**Q: Is the WhatsApp connection secure?**
A: Messages are end-to-end encrypted by WhatsApp. The bridge runs locally on your machine — nothing goes through our servers.

**Q: Can multiple people use it?**
A: Yes. Add multiple phone numbers to the whitelist. Each user gets their own message queue and session.

**Q: What about WhatsApp Business API?**
A: We use whatsapp-web.js (personal WhatsApp). Business API support is on the roadmap for enterprise deployments.
