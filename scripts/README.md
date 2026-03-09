# Automated Task Runner Scripts

Generic automation scripts for executing audit tasks with AI coding agents.
Supports both **Claude Code** and **Codex** CLIs — just point to your task list.

---

## Scripts

| Script                    | Purpose                                         |
| ------------------------- | ----------------------------------------------- |
| `run-tasks.sh`            | Execute pending tasks using **Claude Code** CLI |
| `run-tasks-codex.sh`      | Execute pending tasks using **Codex** CLI       |
| `status.sh`               | Live dashboard — agents, progress, failures     |
| `logs.sh`                 | View, tail, search, and manage agent logs       |
| `stop.sh`                 | Gracefully stop running agents                  |
| `prompts/execute-task.md` | Worker prompt template (shared by both runners) |

---

## Prerequisites

You need **at least one** of the following AI CLIs installed:

- [Claude Code CLI](https://docs.anthropic.com/en/docs/claude-code) — for `run-tasks.sh`
- [Codex CLI](https://github.com/openai/codex) — for `run-tasks-codex.sh`

Plus a task list file following the audit format (see `docs/audit/TASKS.md`).

---

## Quick Start

### With Claude Code

```bash
# Run all pending tasks — model auto-selected per task from task-models.json
./scripts/run-tasks.sh

# Run a single specific task (auto model)
./scripts/run-tasks.sh OB-1244

# Overnight run — auto models, prevent macOS sleep
./scripts/run-tasks.sh --caffeinate

# Force opus for all tasks (overrides task-models.json)
./scripts/run-tasks.sh --model opus
```

### With Codex

```bash
# Run all pending tasks sequentially
./scripts/run-tasks-codex.sh

# Run a single specific task
./scripts/run-tasks-codex.sh OB-302

# Run Phase 97 tasks with o3 model
./scripts/run-tasks-codex.sh --phase 97 --model o3

# Overnight run, prevent macOS sleep
./scripts/run-tasks-codex.sh --caffeinate
```

### Monitoring (works with both runners)

```bash
# Monitor progress (in another terminal)
./scripts/status.sh --watch

# Tail logs in real-time
./scripts/logs.sh --tail-all

# Stop all agents
./scripts/stop.sh
```

---

## Failure Tracking & Skip Mechanism

The runner tracks failures per-task and automatically skips persistently failing tasks:

- **Per-task failure count** — stored in `logs/task-runs/.task_failures.json`
- **Auto-skip** — after `--max-task-failures` (default: 3) failures on the same task, it's skipped
- **Skip log** — skipped tasks recorded in `logs/task-runs/.skipped_tasks` with timestamp and reason
- **Reset** — use `--reset-failures` to clear the skip list and start fresh

This prevents the runner from looping forever on a task that keeps failing.

---

## Monitoring & Operations

### Check status

```bash
# Full dashboard (agents, tasks, failures, logs)
./scripts/status.sh

# Auto-refresh every 5 seconds
./scripts/status.sh --watch

# Only show running agents
./scripts/status.sh --agents

# Only show task progress
./scripts/status.sh --tasks
```

### View logs

```bash
# List all log files
./scripts/logs.sh

# Follow the latest log in real-time
./scripts/logs.sh --tail

# Follow the 3 most recent logs
./scripts/logs.sh --tail 3

# Search all logs for a pattern
./scripts/logs.sh --grep "OB-003"

# One-line summary per log
./scripts/logs.sh --summary

# Delete all logs and reset counter
./scripts/logs.sh --clean
```

### Stop agents

```bash
# Graceful shutdown (SIGTERM)
./scripts/stop.sh

# Force kill (SIGKILL)
./scripts/stop.sh --force

# Stop a specific agent by PID
./scripts/stop.sh --pid 12345
```

---

## Configuration Reference

### `run-tasks.sh` (Claude Code)

#### Path options

| Option            | Default                    | Description                               |
| ----------------- | -------------------------- | ----------------------------------------- |
| `--tasks FILE`    | `docs/audit/TASKS.md`      | Task list file (relative to project root) |
| `--findings FILE` | `docs/audit/FINDINGS.md`   | Findings file                             |
| `--health FILE`   | `docs/audit/HEALTH.md`     | Health score file                         |
| `--pointer FILE`  | `docs/audit/.current_task` | Pointer file for progress tracking        |
| `--prompt FILE`   | `prompts/execute-task.md`  | Prompt template file                      |
| `--log-dir DIR`   | `logs/task-runs`           | Log output directory                      |
| `--project DIR`   | auto-detected              | Project root directory                    |

#### Execution options

| Option                  | Default | Description                                                    |
| ----------------------- | ------- | -------------------------------------------------------------- |
| `TASK_ID` (positional)  | —       | Run a specific task (e.g., `OB-302`)                           |
| `--phase N`             | all     | Limit to Phase N                                               |
| `--model MODEL`         | auto    | Force model for ALL tasks (overrides task-models.json)         |
| `--budget N`            | auto    | Force budget for ALL tasks in USD (overrides task-models.json) |
| `--max-task-failures N` | `3`     | Skip a task after N total failures                             |
| `--retries N`           | `3`     | Max consecutive failures before stopping                       |

#### Other options

| Option             | Description                             |
| ------------------ | --------------------------------------- |
| `--caffeinate`     | Prevent macOS sleep (must be first arg) |
| `--reset-failures` | Clear failure tracking and skip list    |
| `--help`           | Show all options                        |

#### Per-task model configuration: `task-models.json`

By default, each task's model and budget is resolved automatically from `scripts/task-models.json`:

```
Priority: CLI --model flag > task_overrides[TASK_ID] > phase_overrides[PHASE] > defaults
```

```json
{
  "defaults": { "model": "sonnet", "budget": 5 },
  "phase_overrides": {
    "110": { "model": "opus", "budget": 10 }
  },
  "task_overrides": {
    "OB-1244": { "model": "opus", "budget": 8, "reason": "Complex new module" }
  }
}
```

- **defaults** — fallback for any task not matched by overrides
- **phase_overrides** — applies to all tasks in a phase (unless task has its own override)
- **task_overrides** — per-task model + budget (highest priority after CLI flag)
- **reason** — optional, for documentation only (ignored by the script)

To override all tasks with a single model, use `--model`:

```bash
./scripts/run-tasks.sh --model opus    # Force opus for every task
```

### `run-tasks-codex.sh` (Codex)

#### Path options

Same as `run-tasks.sh` (except `--health` is not used).

#### Execution options

| Option                  | Default           | Description                                                                                                           |
| ----------------------- | ----------------- | --------------------------------------------------------------------------------------------------------------------- |
| `TASK_ID` (positional)  | —                 | Run a specific task (e.g., `OB-302`)                                                                                  |
| `--phase N`             | all               | Limit to Phase N                                                                                                      |
| `--model MODEL`         | `gpt-5.2-codex`   | Codex default. ChatGPT accounts only support the default model. API accounts can also use `o4-mini`, `o3`, `gpt-4.1`. |
| `--sandbox MODE`        | `workspace-write` | Sandbox policy (`read-only`, `workspace-write`, `danger-full-access`)                                                 |
| `--max-task-failures N` | `3`               | Skip a task after N total failures                                                                                    |
| `--retries N`           | `3`               | Max consecutive failures before stopping                                                                              |

> **Note:** Codex has no `--budget` flag. Monitor usage via your OpenAI dashboard.

#### Other options

| Option             | Description                             |
| ------------------ | --------------------------------------- |
| `--caffeinate`     | Prevent macOS sleep (must be first arg) |
| `--reset-failures` | Clear failure tracking and skip list    |
| `--help`           | Show all options                        |

### Claude vs Codex — comparison

| Aspect           | `run-tasks.sh` (Claude)       | `run-tasks-codex.sh` (Codex)                                              |
| ---------------- | ----------------------------- | ------------------------------------------------------------------------- |
| CLI command      | `claude --print -p "$prompt"` | `codex exec --full-auto "$prompt"`                                        |
| Default model    | `sonnet`                      | `gpt-5.2-codex`                                                           |
| Safety mechanism | `--allowedTools` whitelist    | `--sandbox workspace-write`                                               |
| Budget control   | `--max-budget-usd 5`          | None (monitor via OpenAI dashboard)                                       |
| Git commits      | Agent commits directly        | Script commits after agent (post-agent)                                   |
| Best for         | Complex reasoning, long tasks | Fast implementation, code edits                                           |
| Model options    | `opus`, `sonnet`, `haiku`     | `gpt-5.2-codex` (default), `o4-mini`, `o3`, `gpt-4.1` (API accounts only) |

### `status.sh`

| Option        | Description                               |
| ------------- | ----------------------------------------- |
| `--watch [N]` | Auto-refresh every N seconds (default: 5) |
| `--agents`    | Only show running agents                  |
| `--tasks`     | Only show task progress                   |
| `--logs`      | Only show recent log activity             |

### `logs.sh`

| Option           | Description                            |
| ---------------- | -------------------------------------- |
| `--tail [N]`     | Follow N most recent logs (default: 1) |
| `--tail-all`     | Follow all logs from current iteration |
| `--view FILE`    | View specific log (partial name match) |
| `--grep PATTERN` | Search all logs                        |
| `--summary`      | One-line summary per log               |
| `--clean`        | Delete all logs (asks confirmation)    |

### `stop.sh`

| Option      | Description             |
| ----------- | ----------------------- |
| `--force`   | Force kill with SIGKILL |
| `--pid PID` | Stop specific agent     |

---

## How It Works

Both runners follow the same flow (only the CLI invocation differs):

1. Script reads the prompt template from `prompts/execute-task.md`
2. Injects configuration (file paths, phase filter, task ID) into template variables
3. Launches the AI agent:
   - **Claude:** `claude --print` with `--max-budget-usd` and `--allowedTools`
   - **Codex:** `codex exec --full-auto` with `--sandbox` policy (Steps 6–7 stripped from prompt)
4. The agent reads the task list, finds the next pending task
5. Implements the fix, runs verification (`lint`, `typecheck`, `test`, `build`)
6. Updates audit docs (tasks, findings)
7. Creates a conventional commit:
   - **Claude:** Agent commits directly (has git access via `--allowedTools`)
   - **Codex:** Script commits after agent finishes (post-agent commit — sandbox blocks `.git/` writes)
8. Writes the next task ID to the pointer file:
   - **Claude:** Agent updates pointer
   - **Codex:** Script updates pointer after commit
9. Validates output (checks for empty logs, crashes, tiny output)
10. Loop continues until all tasks are done or failures exceed retry limit

### State tracking

The runner writes a JSON state file at `logs/task-runs/.run_state.json` that tracks:

- Current status (`running`, `completed`, `failed`, `stopped`)
- Start time, iteration count, phase, model, budget
- Process PID for monitoring

This state file is used by `status.sh` and `stop.sh`.

---

## Safety Guards

### Shared (both runners)

- **Retry limit**: 3 consecutive failures stops the loop (configurable)
- **Per-task failure limit**: Tasks auto-skip after 3 failures (configurable)
- **Output validation**: Catches empty logs, crashes, and tiny output
- **Verification required**: Lint, typecheck, test, and build must pass before a task is marked done
- **Scoped access**: Agent works only within the project directory
- **State tracking**: Run state persisted to JSON for monitoring and clean shutdown

### Claude-specific

- **Tool restrictions**: Agent can only Read, Edit, Write, Glob, Grep, and run git/npm/npx via Bash
- **Budget cap**: `$5/agent` default — prevents runaway sessions

### Codex-specific

- **Sandbox**: `workspace-write` by default — agent can read anything but only write within the workspace
- **Full-auto**: Auto-approves commands within sandbox boundaries (no interactive prompts)
- **Post-agent commit**: Since `workspace-write` sandbox blocks `.git/` writes, the script handles git commits after the agent finishes. Steps 6 (Commit) and 7 (Update Pointer) are automatically stripped from the prompt and replaced with a "skip" instruction. The script then stages changed files, builds a conventional commit message from the task description, commits, and updates the pointer file.

---

## Logs & State Files

All runtime files are in `logs/task-runs/` (gitignored):

```
logs/task-runs/
├── .run_state.json                                 # Current run state (used by status/stop)
├── .task_failures.json                             # Per-task failure counts (auto-skip tracking)
├── .skipped_tasks                                  # Skipped task log (task_id|timestamp|reason)
├── run_1_OB-302_20260222_143012.log                # Loop mode: iteration_taskID_timestamp
└── single_OB-302_20260222_150000.log               # Single task mode
```

### Clearing state

```bash
# Clear failure tracking and skipped tasks (works with either runner)
./scripts/run-tasks.sh --reset-failures
./scripts/run-tasks-codex.sh --reset-failures

# Clear everything (logs + state)
./scripts/logs.sh --clean
```

---

## Customizing Prompts

### Worker prompt: `prompts/execute-task.md`

Edit to change what each agent does per task. The prompt is extracted between ```` fences. Template variables injected by the script:

| Variable            | Replaced by                |
| ------------------- | -------------------------- |
| `{{TASK_ID}}`       | Task ID override or "none" |
| `{{PHASE}}`         | Phase filter or "none"     |
| `{{TASKS_FILE}}`    | Path to task list file     |
| `{{FINDINGS_FILE}}` | Path to findings file      |
| `{{HEALTH_FILE}}`   | Path to health score file  |
| `{{POINTER_FILE}}`  | Path to pointer file       |

---

## Using in Another Project

These scripts are project-agnostic. To use in a different project:

1. Copy the `scripts/` directory to your project
2. Create your audit docs (`docs/audit/TASKS.md`, `FINDINGS.md`)
3. Add a `CLAUDE.md` with your project's conventions
4. Run with whichever CLI you have:

```bash
# With Claude Code
./scripts/run-tasks.sh --tasks your/path/TASKS.md \
                       --findings your/path/FINDINGS.md

# With Codex
./scripts/run-tasks-codex.sh --tasks your/path/TASKS.md \
                             --findings your/path/FINDINGS.md
```

Or simply use the default paths and put your task files in `docs/audit/`.
