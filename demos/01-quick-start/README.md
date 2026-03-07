# Demo 01: Quick Start (Console Mode)

> **Audience:** All | **Duration:** 5 min | **Difficulty:** Beginner
> Show OpenBridge running in 60 seconds with zero external accounts.

---

## Key Message

"Three lines of config. One command. Your AI is ready."

## What This Demo Shows

- Zero-config AI discovery (Claude, Codex, Aider detected automatically)
- Instant project exploration (5-pass scan)
- Natural language interaction via Console
- Session memory (AI remembers context across messages)

---

## Setup (Before the Demo)

1. Copy the included config:
   ```bash
   cp demos/01-quick-start/config.json config.json
   ```
2. Edit `workspacePath` to point at a sample project (or use OpenBridge itself)
3. Run `npm install` if not already done

## Demo Script

### Step 1: Show the Config (30s)

Open `config.json` and highlight:

- Only 3 fields needed: `workspacePath`, `channels`, `auth`
- No API keys anywhere
- Console mode = no WhatsApp setup needed

**Talking Point:** "This is the entire configuration. We point it at a project folder, pick a channel, and whitelist who can use it. That's it."

### Step 2: Start OpenBridge (60s)

```bash
npm run dev
```

**What happens on screen:**

1. AI tools discovered (show the log output: `Discovered: claude (v2.x)`)
2. Master AI selected (best tool picked automatically)
3. Workspace exploration starts (5 passes — structure, classify, dive, assemble, finalize)
4. Console prompt appears: `>`

**Talking Point:** "OpenBridge found Claude Code on this machine, made it the Master AI, and it's already exploring the project. No setup, no registration."

### Step 3: Ask a Question (60s)

```
> /ai what's in this project?
```

Show the AI's response — it will describe the project structure, frameworks, key files.

**Talking Point:** "The AI already knows the project. It explored on startup and built a knowledge base. This isn't ChatGPT — it has full context of your codebase."

### Step 4: Follow-up Question (60s)

```
> /ai what testing framework does this project use?
```

Show that the AI answers from its exploration, not by re-scanning.

**Talking Point:** "Multi-turn conversation. It remembers what we discussed. And this context persists across sessions — restart the bridge, ask a follow-up, it still knows."

### Step 5: Show the Knowledge Base (30s)

```bash
ls .openbridge/
cat .openbridge/workspace-map.json | head -30
```

**Talking Point:** "Everything the AI learned is stored here. Exploration state, memory, task history. It's all local, all transparent, all yours."

---

## Talking Points Summary

| Point                     | Message                                                     |
| ------------------------- | ----------------------------------------------------------- |
| **Zero config**           | 3 fields. No API keys. Uses your existing AI subscriptions. |
| **Auto-discovery**        | Finds Claude, Codex, Aider — whatever's installed.          |
| **Project understanding** | 5-pass exploration builds a full knowledge base on startup. |
| **Memory**                | Remembers across messages AND across sessions.              |
| **Transparency**          | All knowledge stored in `.openbridge/` — inspect anytime.   |

---

## Common Questions

**Q: What if I don't have Claude Code installed?**
A: OpenBridge discovers whatever AI tools are on the machine. If only Codex is installed, it uses Codex. If multiple are installed, it picks the best one as Master and uses others as workers.

**Q: Does it need internet access?**
A: It needs whatever your AI tool needs. Claude Code uses Anthropic's API. Codex uses OpenAI's API. But OpenBridge itself is 100% local.

**Q: How big a project can it handle?**
A: We've tested with projects up to 100K+ files. The exploration is incremental and only deep-dives into significant directories.
