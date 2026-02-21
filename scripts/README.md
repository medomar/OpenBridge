# Automated Task Runner Scripts

Generic automation scripts for executing audit tasks with Claude Code CLI.
Designed to be reusable across any project — just point to your task list.

Features an **AI orchestrator** powered by Claude Haiku that intelligently plans task assignments (model, turns, parallelism) and validates results after each iteration.

---

## Scripts

| Script                             | Purpose                                                              |
| ---------------------------------- | -------------------------------------------------------------------- |
| `run-tasks.sh`                     | Loop through all pending tasks (sequential, parallel, or AI-planned) |
| `run-single-task.sh`               | Execute one specific task by ID                                      |
| `status.sh`                        | Live dashboard — agents, task progress, failures, orchestrator       |
| `logs.sh`                          | View, tail, search, and manage agent logs                            |
| `stop.sh`                          | Gracefully stop running agents                                       |
| `prompts/execute-task.md`          | Worker prompt template (what each agent does per task)               |
| `prompts/orchestrator-plan.md`     | Planner prompt — Haiku decides tasks, models, parallelism            |
| `prompts/orchestrator-validate.md` | Validator prompt — Haiku checks if a task truly completed            |

---

## Prerequisites

- [Claude Code CLI](https://docs.anthropic.com/en/docs/claude-code) installed and authenticated
- A task list file following the audit format (see `docs/audit/TASKS.md`)

---

## Quick Start

```bash
# Run all pending tasks sequentially
./scripts/run-tasks.sh

# Run Phase 1 with 3 parallel agents using Sonnet
./scripts/run-tasks.sh --phase 1 --parallel 3 --model sonnet

# AI-orchestrated run (recommended) — Haiku plans tasks + validates results
./scripts/run-tasks.sh --orchestrator --parallel 3 --max-turns 80

# Overnight run with orchestrator, prevent macOS sleep
./scripts/run-tasks.sh --caffeinate --orchestrator --parallel 3 --model opus --max-turns 80

# Run a single task
./scripts/run-single-task.sh OB-003

# Monitor progress (in another terminal)
./scripts/status.sh --watch

# Tail logs in real-time
./scripts/logs.sh --tail-all

# Stop all agents
./scripts/stop.sh
```

---

## AI Orchestrator

The orchestrator adds intelligence to the task runner. When enabled with `--orchestrator`, Claude Haiku runs before and after each batch of workers:

### Pre-iteration: Planner

Before each iteration, Haiku analyzes pending tasks and decides:

1. **Which tasks** to run this iteration (respecting `--parallel` limit)
2. **Which model** each worker should use (haiku for simple, sonnet for moderate, opus for complex)
3. **How many turns** each worker gets (20–120 based on complexity)
4. **Whether tasks can run in parallel** (independent tasks run together, dependent ones run sequentially)

Example orchestrator output:

```
OB-160 → sonnet, 50 turns (moderate: protocol definition)
OB-161 → sonnet, 50 turns (moderate: implements new interface)
OB-164 → haiku, 30 turns  (simple: type definition)
```

### Post-iteration: Validator

After each worker finishes, Haiku reads the agent's log output and determines:

- **success** — task completed all steps (code + verification + commit + TASKS.md update)
- **failed** — agent crashed, timed out, hit max-turns, or verification failed
- **partial** — some progress but not all steps completed

The validator catches silent failures that exit code 0 misses (e.g., Claude CLI exits 0 on max-turns exhaustion).

### Fallback

If the orchestrator itself fails, the runner falls back to default behavior: first pending task, configured model, `--parallel 1`.

---

## Failure Tracking & Skip Mechanism

The runner tracks failures per-task and automatically skips persistently failing tasks:

- **Per-task failure count** — stored in `logs/task-runs/.task_failures.json`
- **Auto-skip** — after `--max-task-failures` (default: 3) failures on the same task, it's skipped
- **Skip log** — skipped tasks recorded in `logs/task-runs/.skipped_tasks` with timestamp and reason
- **Orchestrator skip** — the validator can also recommend skipping a task

This prevents the runner from looping forever on a task that keeps failing.

---

## Monitoring & Operations

### Check status

```bash
# Full dashboard (agents, tasks, failures, logs)
./scripts/status.sh

# Auto-refresh every 5 seconds
./scripts/status.sh --watch

# Auto-refresh every 10 seconds
./scripts/status.sh --watch 10

# Only show running agents
./scripts/status.sh --agents

# Only show task progress
./scripts/status.sh --tasks
```

The dashboard shows:

- Running agents with PIDs and task assignments
- Orchestrator status (enabled/disabled, model)
- Task timeout and max failures settings
- Per-task failure counts
- Skipped tasks list
- Progress bar with done/pending/skipped breakdown

### View logs

```bash
# List all log files
./scripts/logs.sh

# Follow the latest log in real-time
./scripts/logs.sh --tail

# Follow the 3 most recent logs
./scripts/logs.sh --tail 3

# Follow all logs from the current iteration
./scripts/logs.sh --tail-all

# View a specific log (partial name match)
./scripts/logs.sh --view agent2

# Search all logs for a pattern
./scripts/logs.sh --grep "OB-003"
./scripts/logs.sh --grep "error"

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

| Option                  | Default   | Description                                      |
| ----------------------- | --------- | ------------------------------------------------ |
| `--phase N`             | all       | Limit to Phase N                                 |
| `--model MODEL`         | default   | Default Claude model (`opus`, `sonnet`, `haiku`) |
| `--parallel N`          | `1`       | Maximum concurrent agents                        |
| `--max-turns N`         | unlimited | Default max turns per agent iteration            |
| `--max-task-failures N` | `3`       | Skip a task after N total failures               |
| `--task-timeout N`      | none      | Per-task wall-clock timeout in seconds           |
| `--retries N`           | `3`       | Max consecutive failures before stopping         |
| `--sleep N`             | `5`       | Seconds between iterations                       |
| `--sleep-retry N`       | `10`      | Seconds before retrying a failed task            |

#### Orchestrator options

| Option                   | Default | Description                                  |
| ------------------------ | ------- | -------------------------------------------- |
| `--orchestrator`         | off     | Enable AI orchestrator (planner + validator) |
| `--no-orchestrator`      | —       | Explicitly disable orchestrator              |
| `--orchestrator-model M` | `haiku` | Model for the orchestrator                   |

#### Other options

| Option         | Description                                |
| -------------- | ------------------------------------------ |
| `--caffeinate` | Prevent macOS from sleeping during the run |
| `--help`       | Show all options                           |

### `run-single-task.sh`

Same path and model options as `run-tasks.sh`, plus:

| Argument  | Description                                    |
| --------- | ---------------------------------------------- |
| `TASK_ID` | Required. The task to execute (e.g., `OB-003`) |

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

### Basic mode (no orchestrator)

1. Script reads the prompt template from `prompts/execute-task.md`
2. Injects configuration (file paths, phase filter, task ID) into template variables
3. Launches `claude --print` with restricted tool access
4. The agent reads the task list, finds the next pending task
5. Implements the fix, runs verification (`lint`, `typecheck`, `test`, `build`)
6. Updates audit docs (tasks, findings, health score)
7. Creates a conventional commit
8. Writes the next task ID to the pointer file
9. Validates output (checks for empty logs, max-turns, timeouts)
10. Loop continues until all tasks are done or failures exceed retry limit

### Orchestrator mode (`--orchestrator`)

1. **Cleanup** — kill any lingering `claude --print` processes from previous iterations
2. **Scan** — read pending tasks, failure history, and skip list
3. **Plan** — call Haiku orchestrator with pending tasks → get task assignments with per-task model, turns, and parallelism
4. **Execute** — spawn workers per orchestrator plan (each with its own model and max-turns)
5. **Wait** — wait for all workers in the batch to finish
6. **Validate** — for each worker, call Haiku validator → success/failed/partial
7. **Track** — record failures, auto-skip tasks that exceed failure limit
8. **Repeat** — check if all tasks done → exit, otherwise sleep → next iteration

### Parallel mode (distributed)

When `--parallel N` is set (N > 1), the runner uses **true distributed parallelism**:

1. Scans `TASKS.md` for pending tasks (respecting `--phase` filter)
2. Picks the next N pending tasks (e.g., OB-006, OB-007, OB-008)
3. Assigns **each agent a unique task** via the `{{TASK_ID}}` template variable
4. Launches all N agents simultaneously, each working on its own task
5. Waits for all agents to finish, then starts the next batch

With the orchestrator enabled, the planner decides the actual parallelism (up to `--parallel N`). It considers task dependencies — tasks touching the same files run sequentially, independent tasks run in parallel.

```
Iteration #1 (orchestrator decides parallel=2):
  Agent #1 → OB-160 (sonnet, 50 turns)
  Agent #2 → OB-164 (haiku, 30 turns)

Iteration #2 (orchestrator decides parallel=1, dependency on OB-160):
  Agent #1 → OB-161 (sonnet, 50 turns)
```

### State tracking

The runner writes a JSON state file at `logs/task-runs/.run_state.json` that tracks:

- Current status (`running`, `completed`, `failed`, `stopped`)
- Start time, iteration count, phase, model, parallel count
- Orchestrator status and model
- Process PID for monitoring

This state file is used by `status.sh` and `stop.sh` to show run context and cleanly shut down.

---

## Safety Guards

- **Tool restrictions**: Agent can only Read, Edit, Write, Glob, Grep, and run git/npm/npx via Bash
- **Retry limit**: 3 consecutive failures stops the loop (configurable)
- **Per-task failure limit**: Tasks auto-skip after 3 failures (configurable)
- **Output validation**: Catches empty logs, max-turns exhaustion, timeout, and tiny output
- **AI validation**: Orchestrator validator double-checks agent output for silent failures
- **Verification required**: Lint, typecheck, test, and build must pass before a task is marked done
- **Scoped access**: Agent works only within the project directory
- **Max turns**: Optionally limit agent turns per iteration to prevent runaway sessions
- **Task timeout**: Per-task wall-clock timeout kills agents that run too long
- **Process cleanup**: Zombie claude processes are killed between iterations
- **State tracking**: Run state persisted to JSON — resume from last known state after crashes

---

## Logs & State Files

All runtime files are in `logs/task-runs/` (gitignored):

```
logs/task-runs/
├── .iteration_counter                              # Persistent counter (survives restarts)
├── .run_state.json                                 # Current run state (used by status/stop)
├── .task_failures.json                             # Per-task failure counts (auto-skip tracking)
├── .skipped_tasks                                  # Skipped task log (task_id|timestamp|reason)
├── run_1_OB-006_20260219_143012.log                # Sequential: iteration_taskID_timestamp
├── run_2_agent1_OB-007_20260219_143512.log         # Parallel: iteration_agent_taskID_timestamp
├── run_2_agent2_OB-008_20260219_143512.log
└── single_OB-003_20260219_150000.log               # Single task runner logs
```

### Clearing state

```bash
# Clear failure tracking and skipped tasks (keeps logs)
rm -f logs/task-runs/.task_failures.json logs/task-runs/.skipped_tasks

# Clear everything (logs + state)
./scripts/logs.sh --clean
```

---

## Customizing Prompts

### Worker prompt: `prompts/execute-task.md`

Edit to change what each agent does per task. The prompt is extracted between backtick fences. Template variables injected by the scripts:

| Variable            | Replaced by                |
| ------------------- | -------------------------- |
| `{{TASK_ID}}`       | Task ID override or "none" |
| `{{PHASE}}`         | Phase filter or "none"     |
| `{{TASKS_FILE}}`    | Path to task list file     |
| `{{FINDINGS_FILE}}` | Path to findings file      |
| `{{HEALTH_FILE}}`   | Path to health score file  |
| `{{POINTER_FILE}}`  | Path to pointer file       |

### Planner prompt: `prompts/orchestrator-plan.md`

Edit to change how Haiku plans task assignments. Template variables:

| Variable                | Replaced by                                |
| ----------------------- | ------------------------------------------ |
| `{{PENDING_TASKS}}`     | Pending task entries from TASKS.md         |
| `{{FAILURE_HISTORY}}`   | Per-task failure counts and reasons        |
| `{{SKIPPED_TASKS}}`     | Already skipped task list                  |
| `{{MAX_PARALLEL}}`      | Maximum agents allowed (from `--parallel`) |
| `{{DEFAULT_MAX_TURNS}}` | Default max turns (from `--max-turns`)     |

### Validator prompt: `prompts/orchestrator-validate.md`

Edit to change how Haiku validates worker results. Template variables:

| Variable        | Replaced by                       |
| --------------- | --------------------------------- |
| `{{TASK_ID}}`   | The task that was attempted       |
| `{{EXIT_CODE}}` | The agent's exit code             |
| `{{LOG_SIZE}}`  | Log file size in bytes            |
| `{{LOG_TAIL}}`  | Last 200 lines of the agent's log |

---

## Using in Another Project

These scripts are project-agnostic. To use in a different project:

1. Copy the `scripts/` directory to your project
2. Create your audit docs (`docs/audit/TASKS.md`, `FINDINGS.md`, `HEALTH.md`)
3. Add a `CLAUDE.md` with your project's conventions
4. Run:

```bash
# Basic run
./scripts/run-tasks.sh --tasks your/path/TASKS.md \
                       --findings your/path/FINDINGS.md \
                       --health your/path/HEALTH.md

# With AI orchestrator (recommended)
./scripts/run-tasks.sh --tasks your/path/TASKS.md \
                       --findings your/path/FINDINGS.md \
                       --health your/path/HEALTH.md \
                       --orchestrator --parallel 3 --max-turns 80
```

Or simply use the default paths and put your task files in `docs/audit/`.
