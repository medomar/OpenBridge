# Automated Task Runner Scripts

Generic automation scripts for executing audit tasks with Claude Code CLI.
Designed to be reusable across any project — just point to your task list.

---

## Scripts

| Script                    | Purpose                                                 |
| ------------------------- | ------------------------------------------------------- |
| `run-tasks.sh`            | Loop through all pending tasks (sequential or parallel) |
| `run-single-task.sh`      | Execute one specific task by ID                         |
| `prompts/execute-task.md` | Agent prompt template (what Claude does each iteration) |

---

## Prerequisites

- [Claude Code CLI](https://docs.anthropic.com/en/docs/claude-code) installed and authenticated
- A task list file following the audit format (see `docs/audit/TASKS.md`)

---

## Quick Start

```bash
# Run all pending tasks sequentially
./scripts/run-tasks.sh

# Run Phase 1 only
./scripts/run-tasks.sh --phase 1

# Run 3 agents in parallel on Phase 2
./scripts/run-tasks.sh --parallel 3 --phase 2

# Use a specific model
./scripts/run-tasks.sh --model sonnet

# Run a single task
./scripts/run-single-task.sh OB-003
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

| Option            | Default   | Description                              |
| ----------------- | --------- | ---------------------------------------- |
| `--phase N`       | all       | Limit to Phase N                         |
| `--model MODEL`   | default   | Claude model (`opus`, `sonnet`, `haiku`) |
| `--parallel N`    | `1`       | Number of concurrent agents              |
| `--max-turns N`   | unlimited | Max turns per agent iteration            |
| `--retries N`     | `3`       | Max consecutive failures before stopping |
| `--sleep N`       | `5`       | Seconds between iterations               |
| `--sleep-retry N` | `10`      | Seconds before retrying a failed task    |

### `run-single-task.sh`

Same path and model options as `run-tasks.sh`, plus:

| Argument  | Description                                    |
| --------- | ---------------------------------------------- |
| `TASK_ID` | Required. The task to execute (e.g., `OB-003`) |

---

## How It Works

1. Script reads the prompt template from `prompts/execute-task.md`
2. Injects configuration (file paths, phase filter, task ID) into template variables
3. Launches `claude --print` with restricted tool access
4. The agent reads the task list, finds the next pending task
5. Implements the fix, runs verification (`lint`, `typecheck`, `test`, `build`)
6. Updates audit docs (tasks, findings, health score)
7. Creates a conventional commit
8. Writes the next task ID to the pointer file
9. Loop continues until all tasks are done or failures exceed retry limit

### Parallel mode

When `--parallel N` is set (N > 1), the runner launches N Claude Code agents simultaneously. Each agent independently picks and executes the next pending task. This is useful for phases where tasks are independent.

**Note:** Parallel mode works best when tasks don't modify the same files. For tasks that touch shared code, use sequential mode (`--parallel 1`).

---

## Safety Guards

- **Tool restrictions**: Agent can only Read, Edit, Write, Glob, Grep, and run git/npm/npx via Bash
- **Retry limit**: 3 consecutive failures stops the loop (configurable)
- **Verification required**: Lint, typecheck, test, and build must pass before a task is marked done
- **Scoped access**: Agent works only within the project directory
- **Max turns**: Optionally limit agent turns per iteration to prevent runaway sessions

---

## Logs

All runs are logged to `logs/task-runs/` (gitignored):

```
logs/task-runs/
├── .iteration_counter                    # Persistent counter (survives restarts)
├── run_1_20260219_143012.log             # Sequential iteration logs
├── run_2_agent1_20260219_143512.log      # Parallel agent logs
├── run_2_agent2_20260219_143512.log
└── single_OB-003_20260219_150000.log     # Single task logs
```

---

## Customizing the Prompt

Edit `prompts/execute-task.md` to change agent behavior. The prompt is extracted between backtick fences. Template variables injected by the scripts:

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
