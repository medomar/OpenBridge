# Demo 07: WebChat Dashboard

> **Audience:** Product / Design teams | **Duration:** 10 min | **Difficulty:** Beginner
> Show the browser-based UI with rich features.

---

## Key Message

"A full AI dashboard in your browser. Chat, file uploads, voice input, conversation history, and Deep Mode — all in one interface."

## What This Demo Shows

- WebChat browser UI with modern design (dark mode, syntax highlighting)
- Rich input: file uploads, voice recording, autocomplete
- Conversation sidebar with search
- Deep Mode stepper UI (visual phase tracking)
- Settings panel with live configuration
- Mobile-responsive PWA (works on phones via LAN)

---

## Setup (Before the Demo)

1. Copy the config:
   ```bash
   cp demos/07-webchat-dashboard/config.json config.json
   ```
2. Run `npm run dev`
3. Open `http://localhost:3000` in a browser (or the URL shown in terminal)

## Demo Script

### Step 1: Open the Dashboard (30s)

Navigate to the WebChat URL. Show the clean interface.

**Talking Point:** "This is the WebChat dashboard. No installation — just open a browser. It connects via WebSocket for real-time updates."

### Step 2: Send a Message (60s)

Type a question in the input box:

```
What's in this project?
```

Show the response with markdown rendering and syntax highlighting.

**Talking Point:** "Full markdown support, syntax highlighting for code blocks, and real-time streaming — you see the response as it's generated."

### Step 3: Show Rich Input (90s)

Demonstrate:

- **File upload:** Drag a file into the chat
- **Voice input:** Click the microphone icon, speak a command
- **Autocomplete:** Type `/` to see available commands

**Talking Point:** "Upload files for the AI to analyze. Use voice input for hands-free operation. Command autocomplete so you don't have to memorize anything."

### Step 4: Show Conversation History (60s)

Click the sidebar to show past conversations. Search for a keyword.

**Talking Point:** "Every conversation is searchable. Find that architecture discussion from last week. Export transcripts for documentation."

### Step 5: Show Deep Mode UI (120s)

Trigger Deep Mode:

```
/deep audit this project for code quality
```

Show the stepper component:

- Phase indicators (Investigate, Report, Plan, Execute, Verify)
- Progress bars per phase
- Expandable phase cards with worker details

**Talking Point:** "The Deep Mode stepper gives you visual tracking of each phase. Expand any phase to see worker details, timing, and results. Click to drill into findings."

### Step 6: Show Settings Panel (60s)

Click the gear icon. Show:

- Connected AI tools
- Active MCP servers
- Auth configuration
- Theme toggle (dark/light)

**Talking Point:** "Live configuration. Toggle dark mode, check connected tools, see MCP server health — all without touching config files."

### Step 7: Show Mobile PWA (Optional, 60s)

Open the WebChat URL on a phone (same LAN). Show the responsive layout.

**Talking Point:** "It's a Progressive Web App. Add it to your home screen and it works like a native app. Same functionality, mobile-optimized layout."

---

## Talking Points Summary

| Point                  | Message                                     |
| ---------------------- | ------------------------------------------- |
| **Zero install**       | Browser-based. No extensions, no downloads. |
| **Rich input**         | File upload, voice, autocomplete.           |
| **Deep Mode visual**   | Stepper UI tracks all 5 phases visually.    |
| **Searchable history** | Find any past conversation instantly.       |
| **Mobile-ready**       | PWA works on phones via LAN or tunnel.      |
