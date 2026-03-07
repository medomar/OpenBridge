# Demo 03: Multi-AI Orchestration

> **Audience:** Engineering leads | **Duration:** 15 min | **Difficulty:** Intermediate
> Show how OpenBridge coordinates multiple AI tools on a single task.

---

## Key Message

"One AI reads the code. Another writes the fix. A third runs the tests. You send one message."

## What This Demo Shows

- Auto-discovery of multiple AI tools (Claude + Codex)
- Master AI delegates subtasks to specialized workers
- Tool profiles control what each worker can do (read-only, code-edit, full-access)
- Workers run in parallel for independent tasks
- Cost optimization — fast/cheap models for simple tasks, powerful models for complex ones

---

## Prerequisites

- At least 2 AI tools installed (e.g., Claude Code + Codex)
- A project with tests (so we can show test execution)

## Setup (Before the Demo)

1. Copy the config:
   ```bash
   cp demos/03-multi-ai-orchestration/config.json config.json
   ```
2. Edit `workspacePath` to point at a project with a test suite
3. Run `npm run dev` and let exploration complete

## Demo Script

### Step 1: Show AI Discovery (60s)

Point to the startup logs showing discovered tools:

```
Discovered: claude (v2.x) — capabilities: code-generation, reasoning, planning
Discovered: codex (v0.104) — capabilities: code-generation, fast iteration
Master selected: claude (most capable)
```

**Talking Point:** "OpenBridge found two AI tools on this machine. It automatically selected Claude as the Master — the decision-maker — and Codex is available as a worker for fast tasks."

### Step 2: Trigger a Multi-Worker Task (180s)

```
/ai review the authentication module, check for security issues, and run the tests
```

Watch the Master AI:

1. Spawn a `read-only` worker to analyze the auth code
2. Spawn a `code-audit` worker to run tests
3. Spawn another `read-only` worker to check for security patterns
4. Synthesize all results into a single response

**Talking Point:** "I asked for three things. The Master split them into parallel workers — each with its own permissions. The read-only workers can't modify files. The audit worker can run tests but can't edit code. Least-privilege by design."

### Step 3: Show Worker Profiles (60s)

Explain the profiles visible in the logs:

- `read-only`: Read, Glob, Grep
- `code-edit`: Read, Edit, Write, Glob, Grep, Bash(git:_), Bash(npm:_)
- `code-audit`: Read, Glob, Grep, Bash(npm:test), Bash(npx:vitest:\*)
- `full-access`: Everything (used sparingly)

**Talking Point:** "Every worker gets a profile that restricts its tools. A code reviewer can't accidentally delete files. A test runner can't push to git. This is enforced at the CLI level — not just a suggestion."

### Step 4: Show Model Selection (60s)

Point to logs showing different models per worker:

```
Worker 1 (read-only): model=haiku (fast, cheap — just reading files)
Worker 2 (code-audit): model=sonnet (balanced — needs reasoning for test analysis)
```

**Talking Point:** "The Master picks the right model for each task. Simple file reads use the cheapest model. Complex reasoning uses a more capable one. This saves 60-70% on AI costs compared to using the most expensive model for everything."

### Step 5: Show Parallel Execution (60s)

Point to timestamps showing workers running concurrently.

**Talking Point:** "These workers ran in parallel. A human would do this sequentially — read code, then run tests, then check security. The AI does all three at once."

---

## Talking Points Summary

| Point                  | Message                                                    |
| ---------------------- | ---------------------------------------------------------- |
| **Multi-AI**           | Uses whatever tools are installed. Claude + Codex + Aider. |
| **Task decomposition** | Master breaks complex requests into parallel subtasks.     |
| **Least-privilege**    | Each worker gets only the permissions it needs.            |
| **Cost optimization**  | Fast models for simple tasks, powerful for complex.        |
| **Parallel execution** | Independent tasks run simultaneously.                      |

---

## Common Questions

**Q: What if I only have one AI tool?**
A: Works fine. The single tool becomes both Master and worker. Multi-AI is a bonus, not a requirement.

**Q: Can I control which AI handles which task?**
A: The Master AI decides automatically. But you can influence it by specifying in your message (e.g., "use Codex for the refactor").

**Q: How do workers communicate?**
A: They don't communicate directly. Each worker runs independently and returns results to the Master, which synthesizes everything.
