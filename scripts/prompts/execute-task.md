# Execute Next Task — Agent Prompt

> This file contains the prompt sent to Claude Code on each iteration.
> The script extracts content between the backtick fences below.

````
You are an autonomous agent working on the OpenBridge project.
Your job is to execute the next pending task from the audit task list.

## Step 1: Read Project Context

Read the following files to understand the project:
- `CLAUDE.md` — Development guide, architecture, conventions
- `docs/audit/TASKS.md` — The task list (find the next pending task)
- `docs/audit/FINDINGS.md` — Issue details for each finding
- `docs/audit/HEALTH.md` — Current health score

## Step 2: Identify the Task

TASK_OVERRIDE: {{TASK_ID}}
PHASE_FILTER: {{PHASE}}

- If TASK_OVERRIDE is set (not "none"), execute that specific task ID (e.g., OB-003).
- If PHASE_FILTER is set (not "none"), only pick tasks from that phase.
- Otherwise, find the first task with status "◻ Pending" in TASKS.md, starting from Phase 1.
- If no pending tasks remain, write "DONE" to `docs/audit/.current_task` and stop.

Read the matching finding in FINDINGS.md to understand what needs to be fixed.

## Step 3: Implement the Fix

Implement the task. Follow these rules:
- Read existing code before modifying it.
- Follow the project's existing patterns and conventions (see CLAUDE.md).
- Keep changes minimal and focused — only fix what the task describes.
- Do not refactor unrelated code or add features beyond the task scope.
- Do not add unnecessary comments, docstrings, or type annotations to untouched code.

## Step 4: Verify

Run ALL of these commands and ensure they pass:

```bash
npm run lint
npm run typecheck
npm run test
npm run build
```

If any command fails, fix the issue before proceeding. Do not skip verification.

## Step 5: Update Audit Documents

### 5a. Update `docs/audit/TASKS.md`
- Change the task's status from `◻ Pending` to `✅ Done`
- Update the summary counters at the top:
  - Increment "Done" count, decrement "Pending" count
  - Update the phase row in the Task Summary table
  - If all tasks in a phase are done, change phase status from `◻` to `✅`

### 5b. Update `docs/audit/FINDINGS.md`
- Find the matching finding by ID (e.g., OB-003)
- Change its status from `🟠 Open` (or `🟡 Open` or `🟢 Open`) to `✅ Fixed`
- Update the summary tables at the top:
  - Decrement "Open" count for the severity, increment "Fixed" count
  - Decrement "Open" count for the category, increment "Fixed" count

### 5c. Update `docs/audit/HEALTH.md`
- Apply the score impact based on severity:
  - Critical fixed: +0.15
  - High fixed: +0.03
  - Medium fixed: +0.015
  - Low fixed: +0.005
- Update the "Current Score" in the header
- Add a new row to the "Score Change History" table
- Update the "Open Issues Summary" line

## Step 6: Commit

Create a single conventional commit for all changes:
- Format: `feat(scope): short description` or `fix(scope): short description`
- Scopes: core, whatsapp, claude, connector, provider, config, deps, ci, docs
- Include the finding ID in the commit body: `Resolves OB-XXX`
- Stage only the files you changed (not `git add .`)

## Step 7: Update Pointer

Write the NEXT pending task ID to `docs/audit/.current_task`.
- If there are more pending tasks in the current phase, write the next one (e.g., `OB-004`).
- If the current phase is complete but more phases have pending tasks, write the first pending task of the next phase.
- If ALL tasks are complete, write `DONE`.

## Rules

- NEVER modify files outside the OpenBridge project directory.
- NEVER commit secrets, credentials, or config.json.
- NEVER skip the verification step.
- NEVER mark a task as done if verification fails.
- If you get stuck or the task is too complex for a single iteration, leave the task as Pending and write a note in the commit message explaining what was attempted.
````
