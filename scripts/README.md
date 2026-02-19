# OpenBridge — Scripts

Automation scripts for running audit tasks with Claude Code CLI.

---

## Scripts

| Script                    | Purpose                                                 |
| ------------------------- | ------------------------------------------------------- |
| `run-tasks.sh`            | Loop through all pending tasks automatically            |
| `run-single-task.sh`      | Execute one specific task by ID                         |
| `prompts/execute-task.md` | Agent prompt template (what Claude does each iteration) |

---

## Prerequisites

- [Claude Code CLI](https://docs.anthropic.com/en/docs/claude-code) installed and authenticated
- Node.js >= 22 (see `.nvmrc`)
- `npm install` completed

---

## Usage

### Run all pending tasks

```bash
./scripts/run-tasks.sh
```

### Run a specific phase

```bash
./scripts/run-tasks.sh --phase 1
```

### Run a single task

```bash
./scripts/run-single-task.sh OB-003
```

### Options

| Option        | Default | Description                              |
| ------------- | ------- | ---------------------------------------- |
| `--phase N`   | all     | Limit to Phase N (1-4)                   |
| `--budget N`  | 5       | Max USD per iteration                    |
| `--retries N` | 3       | Max consecutive failures before stopping |

---

## How It Works

1. Script reads the prompt template from `prompts/execute-task.md`
2. Launches `claude --print` with restricted tool access and budget cap
3. The agent reads `docs/audit/TASKS.md`, finds the next pending task
4. Implements the fix, runs verification (`lint`, `typecheck`, `test`, `build`)
5. Updates audit docs (TASKS.md, FINDINGS.md, HEALTH.md)
6. Creates a conventional commit
7. Writes the next task ID to `docs/audit/.current_task`
8. Loop continues until all tasks are done or failures exceed retry limit

---

## Safety Guards

- **Tool restrictions**: Agent can only Read, Edit, Write, Glob, Grep, and run git/npm/npx via Bash
- **Budget cap**: $5 USD per iteration (configurable with `--budget`)
- **Retry limit**: 3 consecutive failures stops the loop
- **Verification required**: Lint, typecheck, test, and build must pass before a task is marked done
- **Scoped access**: Agent works only within the OpenBridge project directory

---

## Logs

All runs are logged to `logs/task-runs/`:

```
logs/task-runs/
├── .iteration_counter          # Persistent counter (survives restarts)
├── run_1_20260219_143012.log   # Loop iteration logs
├── run_2_20260219_143512.log
└── single_OB-003_20260219_150000.log  # Single task logs
```

---

## Customizing the Prompt

Edit `prompts/execute-task.md` to change agent behavior. The prompt is extracted between `~~~` fences. Template variables:

| Variable      | Replaced by                |
| ------------- | -------------------------- |
| `{{TASK_ID}}` | Task ID override or "none" |
| `{{PHASE}}`   | Phase filter or "none"     |
