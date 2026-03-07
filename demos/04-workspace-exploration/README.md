# Demo 04: Workspace Exploration

> **Audience:** DevOps / Platform teams | **Duration:** 10 min | **Difficulty:** Beginner
> Show how OpenBridge automatically understands any project.

---

## Key Message

"Point it at any project. In under a minute, it knows the framework, the entry points, the test commands, and the architecture."

## What This Demo Shows

- 5-pass incremental exploration (structure, classify, dive, assemble, finalize)
- Auto-detection of project type, frameworks, dependencies
- Knowledge base stored as JSON (inspectable, portable)
- Incremental re-exploration on git changes
- RAG-powered codebase Q&A

---

## Setup (Before the Demo)

1. Pick a well-known open-source project the audience recognizes (e.g., Express, Next.js, a popular CLI tool)
2. Clone it locally
3. Configure OpenBridge to point at it:
   ```bash
   cp demos/04-workspace-exploration/config.json config.json
   # Edit workspacePath to point at the cloned project
   ```
4. **Important:** Delete `.openbridge/` in the target project so the audience sees exploration from scratch

## Demo Script

### Step 1: Start with a Fresh Project (30s)

Show that the target project has no `.openbridge/` folder:

```bash
ls -la /path/to/target-project/.openbridge 2>/dev/null || echo "No .openbridge/ — fresh start"
```

**Talking Point:** "This is a project the AI has never seen. No configuration, no hints. Let's see what happens."

### Step 2: Start OpenBridge (120s)

```bash
npm run dev
```

Narrate each exploration phase as it appears in the logs:

1. **Structure Scan** — "It's listing the top-level files and counting what's in each directory"
2. **Classification** — "Now it's reading package.json to identify the framework and commands"
3. **Directory Dives** — "Deep-diving into src/, tests/, and other significant directories"
4. **Assembly** — "Merging everything into a single workspace map"
5. **Finalization** — "Writing the knowledge base and committing to the .openbridge/ git repo"

**Talking Point:** "Five passes, fully automatic. It just read the project the way a new developer would — but in seconds instead of hours."

### Step 3: Show the Workspace Map (90s)

```bash
cat /path/to/target-project/.openbridge/workspace-map.json | head -50
```

Highlight:

- `projectType` correctly identified
- `frameworks` detected
- `commands` (dev, test, build) found automatically
- `keyFiles` listing entry points

**Talking Point:** "This is what the AI knows. Project type, frameworks, commands, key files — all auto-detected. And it's JSON — you can integrate this into your own tools."

### Step 4: Ask About the Project (90s)

```
/ai what's the architecture of this project? what patterns does it use?
```

Show the AI answering from its exploration knowledge — not re-scanning.

**Talking Point:** "The AI answers from its knowledge base. It already explored, so this is instant. And it's using RAG — semantic search over the codebase chunks it indexed."

### Step 5: Show Incremental Re-exploration (60s)

Make a small change to the target project (add a file), then show OpenBridge detecting the change.

**Talking Point:** "When the codebase changes, the AI detects it via git and re-explores only what changed. No full re-scan needed."

---

## Talking Points Summary

| Point           | Message                                                           |
| --------------- | ----------------------------------------------------------------- |
| **Any project** | Works with Node, Python, Rust, Go, mixed — any project structure. |
| **5-pass scan** | Structure, classify, dive, assemble, finalize.                    |
| **Inspectable** | All knowledge stored as JSON in `.openbridge/`.                   |
| **Incremental** | Only re-scans what changed (git-based detection).                 |
| **RAG search**  | Semantic search over indexed codebase chunks.                     |
