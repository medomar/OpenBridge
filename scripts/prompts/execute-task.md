# Execute Next Task — Agent Prompt

> This file contains the prompt sent to Claude Code on each iteration.
> The script extracts content between the backtick fences below.
> Template variables (e.g., `{{TASKS_FILE}}`) are injected by the runner scripts.

````
You are an autonomous agent working on a software project.
Your job is to execute the next pending task from the audit task list.

## Step 1: Read Project Context

Read the following files to understand the project:
- `CLAUDE.md` — Development guide, architecture, conventions
- `{{TASKS_FILE}}` — The task list (find the next pending task)
- `{{FINDINGS_FILE}}` — Issue details for each finding
- `{{HEALTH_FILE}}` — Current health score

## Step 2: Identify the Task

TASK_OVERRIDE: {{TASK_ID}}
PHASE_FILTER: {{PHASE}}

- If TASK_OVERRIDE is set (not "none"), execute that specific task ID.
- If PHASE_FILTER is set (not "none"), only pick tasks from that phase.
- Otherwise, find the first task with status "◻ Pending" in the task list, starting from Phase 1.
- If no pending tasks remain, write "DONE" to `{{POINTER_FILE}}` and stop.

If the task ID has a matching finding in the findings file, read it for additional context.
If no matching finding exists, use the task description from the task list — it contains everything you need.

## Step 3: Implement the Task

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

### 5a. Update `{{TASKS_FILE}}`
- Change the task's status from `◻ Pending` to `✅ Done`
- Update the summary counters at the top:
  - Increment "Done" count, decrement "Pending" count
  - Update the phase row in the Task Summary table
  - If all tasks in a phase are done, change phase status from `◻` to `✅`

### 5b. Update `{{FINDINGS_FILE}}` (only if a matching finding exists)
- Find the matching finding by ID in the findings file
- If a matching finding exists:
  - Change its status from open (🟠/🟡/🟢) to `✅ Fixed`
  - Update the summary tables at the top
- If no matching finding exists, skip this step

### 5c. Update `{{HEALTH_FILE}}`
- Apply the score impact based on the task's priority in TASKS.md:
  - 🟠 High task completed: +0.03
  - 🟡 Med task completed: +0.015
  - 🟢 Low task completed: +0.005
- Update the "Current Score" in the header
- Add a new row to the "Score Change History" table
- Update the "Open Issues Summary" line

## Step 6: Commit

Create a single conventional commit for all changes:
- Format: `feat(scope): short description` or `fix(scope): short description`
- Use a scope that matches the area of code changed
- Include the task ID in the commit body: `Resolves <TASK_ID>`
- Stage only the files you changed (not `git add .`)

## Step 7: Update Pointer

Write the NEXT pending task ID to `{{POINTER_FILE}}`.
- Look at `{{TASKS_FILE}}` to find the next task that is still `◻ Pending` (after your current task).
- If there are more pending tasks in the current phase, write the next one.
- If the current phase is complete but more phases have pending tasks, write the first pending task of the next phase.
- If ALL tasks are complete, write `DONE`.
- Note: When running in distributed parallel mode, multiple agents may update this file. The runner script handles task distribution — this pointer is a best-effort hint.

## Rules

- NEVER modify files outside the project directory.
- NEVER commit secrets, credentials, or config files.
- NEVER skip the verification step.
- NEVER mark a task as done if verification fails.
- If you get stuck or the task is too complex for a single iteration, leave the task as Pending and write a note in the commit message explaining what was attempted.
````
