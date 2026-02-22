# Automated Task Runner Scripts

Generic automation scripts for executing audit tasks with Claude Code CLI.
Designed to be reusable across any project — just point to your task list.

---

## Scripts

| Script                    | Purpose                                          |
| ------------------------- | ------------------------------------------------ |
| `run-tasks.sh`            | Execute pending tasks (loop or single-task mode) |
| `status.sh`               | Live dashboard — agents, progress, failures      |
| `logs.sh`                 | View, tail, search, and manage agent logs        |
| `stop.sh`                 | Gracefully stop running agents                   |
| `prompts/execute-task.md` | Worker prompt template (what each agent does)    |

---

## Prerequisites

- [Claude Code CLI](https://docs.anthropic.com/en/docs/claude-code) installed and authenticated
- A task list file following the audit format (see `docs/audit/TASKS.md`)

---

## Quick Start

```bash
# Run all pending tasks sequentially
./scripts/run-tasks.sh

# Run a single specific task
./scripts/run-tasks.sh OB-302

# Run Phase 22 tasks with Opus model
./scripts/run-tasks.sh --phase 22 --model opus

# Overnight run, prevent macOS sleep
./scripts/run-tasks.sh --caffeinate

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

### `run-tasks.sh`

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

| Option                  | Default  | Description                              |
| ----------------------- | -------- | ---------------------------------------- |
| `TASK_ID` (positional)  | —        | Run a specific task (e.g., `OB-302`)     |
| `--phase N`             | all      | Limit to Phase N                         |
| `--model MODEL`         | `sonnet` | Claude model (`opus`, `sonnet`, `haiku`) |
| `--budget N`            | `5`      | Per-agent budget in USD                  |
| `--max-task-failures N` | `3`      | Skip a task after N total failures       |
| `--retries N`           | `3`      | Max consecutive failures before stopping |

#### Other options

| Option             | Description                             |
| ------------------ | --------------------------------------- |
| `--caffeinate`     | Prevent macOS sleep (must be first arg) |
| `--reset-failures` | Clear failure tracking and skip list    |
| `--help`           | Show all options                        |

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

1. Script reads the prompt template from `prompts/execute-task.md`
2. Injects configuration (file paths, phase filter, task ID) into template variables
3. Launches `claude --print` with `--max-budget-usd` and restricted tool access
4. The agent reads the task list, finds the next pending task
5. Implements the fix, runs verification (`lint`, `typecheck`, `test`, `build`)
6. Updates audit docs (tasks, findings, health score)
7. Creates a conventional commit
8. Writes the next task ID to the pointer file
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

- **Tool restrictions**: Agent can only Read, Edit, Write, Glob, Grep, and run git/npm/npx via Bash
- **Budget cap**: `$5/agent` default — prevents runaway sessions
- **Retry limit**: 3 consecutive failures stops the loop (configurable)
- **Per-task failure limit**: Tasks auto-skip after 3 failures (configurable)
- **Output validation**: Catches empty logs, crashes, and tiny output
- **Verification required**: Lint, typecheck, test, and build must pass before a task is marked done
- **Scoped access**: Agent works only within the project directory
- **State tracking**: Run state persisted to JSON for monitoring and clean shutdown

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
# Clear failure tracking and skipped tasks
./scripts/run-tasks.sh --reset-failures

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
2. Create your audit docs (`docs/audit/TASKS.md`, `FINDINGS.md`, `HEALTH.md`)
3. Add a `CLAUDE.md` with your project's conventions
4. Run:

```bash
./scripts/run-tasks.sh --tasks your/path/TASKS.md \
                       --findings your/path/FINDINGS.md \
                       --health your/path/HEALTH.md
```

Or simply use the default paths and put your task files in `docs/audit/`.
