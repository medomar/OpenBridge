#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────
# run-tasks-codex.sh
# Automated task runner — spawns Codex agents to execute
# pending tasks from a task list, one at a time.
#
# Codex equivalent of run-tasks.sh (which uses Claude Code).
#
# Usage:
#   ./scripts/run-tasks-codex.sh                          # Run all pending tasks
#   ./scripts/run-tasks-codex.sh OB-302                   # Run one specific task
#   ./scripts/run-tasks-codex.sh --phase 22               # Phase 22 only
#   ./scripts/run-tasks-codex.sh --caffeinate             # Prevent macOS sleep
#   ./scripts/run-tasks-codex.sh --help                   # Show all options
# ─────────────────────────────────────────────────────────────────

set -uo pipefail

# ── Caffeinate (must be first arg) ───────────────────────────────
if [[ "${1:-}" == "--caffeinate" ]]; then
  shift
  exec caffeinate -s "$0" "$@"
fi

# ── Defaults ─────────────────────────────────────────────────────

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

# Paths (all relative to project root unless absolute)
TASKS_FILE="docs/audit/TASKS.md"
FINDINGS_FILE="docs/audit/FINDINGS.md"
POINTER_FILE="docs/audit/.current_task"
PROMPT_FILE="$SCRIPT_DIR/prompts/execute-task.md"
LOG_DIR="logs/task-runs"

# Execution
MODEL=""                          # Empty = Codex default (gpt-5.2-codex). ChatGPT accounts only support the default model.
SANDBOX="workspace-write"         # Sandbox policy (read-only, workspace-write, danger-full-access)
MAX_CONSECUTIVE_FAILURES=3        # Stop after N consecutive failures
MAX_TASK_FAILURES=3               # Skip a task after N total failures
SLEEP_BETWEEN=5                   # Seconds between iterations
SLEEP_ON_RETRY=10                 # Seconds before retrying after failure
PHASE_FILTER="none"               # "none" = all phases
TASK_OVERRIDE=""                  # Empty = loop mode, "OB-xxx" = single task

# ── Usage ────────────────────────────────────────────────────────

usage() {
  cat <<EOF
Usage: $(basename "$0") [TASK_ID] [OPTIONS]

Spawns Codex agents to execute pending tasks from a task list.
If TASK_ID is given, runs only that task and exits.
Otherwise, loops through all pending tasks sequentially.

Arguments:
  TASK_ID               Optional. Run a specific task (e.g., OB-302)

Paths:
  --tasks FILE          Task list file (default: $TASKS_FILE)
  --findings FILE       Findings file (default: $FINDINGS_FILE)
  --pointer FILE        Pointer file (default: $POINTER_FILE)
  --prompt FILE         Prompt template (default: prompts/execute-task.md)
  --log-dir DIR         Log directory (default: $LOG_DIR)
  --project DIR         Project root (default: auto-detected)

Execution:
  --phase N             Only run tasks from Phase N
  --model MODEL         Codex model (default: gpt-5.2-codex)
                        ChatGPT accounts only support the default model.
                        API accounts can use: o4-mini, o3, gpt-4.1, etc.
  --sandbox MODE        Sandbox policy: read-only, workspace-write, danger-full-access (default: $SANDBOX)
  --max-task-failures N Skip task after N failures (default: $MAX_TASK_FAILURES)
  --retries N           Stop after N consecutive failures (default: $MAX_CONSECUTIVE_FAILURES)

Other:
  --caffeinate          Prevent macOS sleep (must be first argument)
  --reset-failures      Clear failure tracking and skipped tasks
  --help                Show this message

Examples:
  ./scripts/run-tasks-codex.sh                          # Run all pending
  ./scripts/run-tasks-codex.sh OB-302                   # Run one task
  ./scripts/run-tasks-codex.sh --phase 97               # Phase 97 only
  ./scripts/run-tasks-codex.sh --caffeinate             # Overnight run
  ./scripts/run-tasks-codex.sh --reset-failures         # Clear skip list
EOF
  exit 0
}

# ── Parse Args ───────────────────────────────────────────────────

RESET_FAILURES=false

while [[ $# -gt 0 ]]; do
  case "$1" in
    --tasks)              TASKS_FILE="$2"; shift 2 ;;
    --findings)           FINDINGS_FILE="$2"; shift 2 ;;
    --pointer)            POINTER_FILE="$2"; shift 2 ;;
    --prompt)             PROMPT_FILE="$2"; shift 2 ;;
    --log-dir)            LOG_DIR="$2"; shift 2 ;;
    --project)            PROJECT_DIR="$2"; shift 2 ;;
    --phase)              PHASE_FILTER="$2"; shift 2 ;;
    --model)              MODEL="$2"; shift 2 ;;
    --sandbox)            SANDBOX="$2"; shift 2 ;;
    --max-task-failures)  MAX_TASK_FAILURES="$2"; shift 2 ;;
    --retries)            MAX_CONSECUTIVE_FAILURES="$2"; shift 2 ;;
    --reset-failures)     RESET_FAILURES=true; shift ;;
    --help)               usage ;;
    -*)                   echo "Unknown option: $1"; echo ""; usage ;;
    *)                    TASK_OVERRIDE="$1"; shift ;;
  esac
done

# ── Find Codex CLI ──────────────────────────────────────────────

find_codex_cli() {
  if [ -f "$HOME/.zshrc" ]; then
    source "$HOME/.zshrc" 2>/dev/null || true
  elif [ -f "$HOME/.bashrc" ]; then
    source "$HOME/.bashrc" 2>/dev/null || true
  fi

  if ! command -v codex &>/dev/null; then
    for dir in "$HOME/.local/bin" "$HOME/.npm-global/bin" "/usr/local/bin" "/opt/homebrew/bin"; do
      if [ -x "$dir/codex" ]; then
        export PATH="$dir:$PATH"
        break
      fi
    done
  fi

  if ! command -v codex &>/dev/null; then
    echo "ERROR: 'codex' command not found."
    echo "Install Codex CLI or add it to your PATH."
    exit 1
  fi
}

find_codex_cli

# ── Setup ────────────────────────────────────────────────────────

TASKS_PATH="$PROJECT_DIR/$TASKS_FILE"
LOG_PATH="$PROJECT_DIR/$LOG_DIR"
POINTER_PATH="$PROJECT_DIR/$POINTER_FILE"
STATE_FILE="$LOG_PATH/.run_state.json"
TASK_FAILURES_FILE="$LOG_PATH/.task_failures.json"
SKIPPED_FILE="$LOG_PATH/.skipped_tasks"

# Validate
if [ ! -f "$PROMPT_FILE" ]; then
  echo "ERROR: Prompt file not found: $PROMPT_FILE"
  exit 1
fi
if [ ! -f "$TASKS_PATH" ]; then
  echo "ERROR: Tasks file not found: $TASKS_PATH"
  exit 1
fi

mkdir -p "$LOG_PATH"

if [[ ! -f "$TASK_FAILURES_FILE" ]]; then
  echo '{}' > "$TASK_FAILURES_FILE"
fi

# Handle --reset-failures
if [[ "$RESET_FAILURES" == "true" ]]; then
  rm -f "$TASK_FAILURES_FILE" "$SKIPPED_FILE"
  echo '{}' > "$TASK_FAILURES_FILE"
  echo "Failure tracking and skip list cleared."
fi

# ── Load Prompt Template ─────────────────────────────────────────

# Extract prompt between ```` fences
PROMPT_TEMPLATE=$(sed -n '/^````$/,/^````$/{ /^````$/d; p; }' "$PROMPT_FILE")
if [[ -z "$PROMPT_TEMPLATE" ]]; then
  echo "ERROR: Could not extract prompt from $PROMPT_FILE"
  echo "  Wrap the prompt content in \`\`\`\` fences."
  exit 1
fi

# Inject static template variables (TASK_ID is injected per-iteration)
PROMPT_TEMPLATE=$(echo "$PROMPT_TEMPLATE" | sed \
  -e "s|{{TASKS_FILE}}|$TASKS_FILE|g" \
  -e "s|{{FINDINGS_FILE}}|$FINDINGS_FILE|g" \
  -e "s|{{POINTER_FILE}}|$POINTER_FILE|g" \
  -e "s|{{PHASE}}|$PHASE_FILTER|g")

# Strip Steps 6 & 7 from the prompt for Codex.
# Codex's workspace-write sandbox blocks .git/ writes, so the script
# handles git commit and pointer updates AFTER the agent finishes.
# Replace them with a "skip" instruction. Uses awk for reliable multi-line handling.
PROMPT_TEMPLATE=$(printf '%s' "$PROMPT_TEMPLATE" | awk '
  /^## Step 6: Commit$/ { skip=1; next }
  /^## Step 7: Update Pointer$/ { next }
  /^## Rules$/ && skip {
    skip=0
    print "## Step 6: Skip Commit & Pointer"
    print ""
    print "Do NOT run any git commands (git add, git commit, etc.)."
    print "The runner script handles commits and pointer updates after you finish."
    print ""
    print "## Rules"
    next
  }
  skip { next }
  { print }
')

# ── Output Validation ────────────────────────────────────────────

FAILURE_REASON=""

validate_output() {
  local log_file="$1"
  FAILURE_REASON=""

  if [[ ! -f "$log_file" || ! -s "$log_file" ]]; then
    FAILURE_REASON="empty or missing output"
    return 1
  fi

  local size
  size=$(wc -c < "$log_file" | tr -d ' ')

  if [[ "$size" -lt 50 ]]; then
    FAILURE_REASON="tiny output (${size} bytes — likely a crash)"
    return 1
  fi

  if grep -qi "TIMEOUT: Agent killed" "$log_file"; then
    FAILURE_REASON="timeout exceeded"
    return 1
  fi

  if [[ "$size" -lt 200 ]] && head -1 "$log_file" | grep -qi "^Error:"; then
    FAILURE_REASON="CLI error: $(head -1 "$log_file")"
    return 1
  fi

  return 0
}

# ── Failure Tracking ─────────────────────────────────────────────

record_task_failure() {
  local task_id="$1"
  local reason="$2"
  local timestamp
  timestamp=$(date -u +%Y-%m-%dT%H:%M:%SZ)

  TASK_ID="$task_id" TIMESTAMP="$timestamp" REASON="$reason" \
  FAILURES_FILE="$TASK_FAILURES_FILE" \
  python3 -c "
import json, os
fpath = os.environ['FAILURES_FILE']
task_id = os.environ['TASK_ID']
timestamp = os.environ['TIMESTAMP']
reason = os.environ['REASON']
try:
    with open(fpath, 'r') as f:
        data = json.load(f)
except:
    data = {}
task = data.get(task_id, {'count': 0, 'attempts': []})
task['count'] = task['count'] + 1
task['attempts'].append({'timestamp': timestamp, 'reason': reason})
task['attempts'] = task['attempts'][-10:]
data[task_id] = task
with open(fpath, 'w') as f:
    json.dump(data, f, indent=2)
print(task['count'])
" 2>/dev/null || echo "1"
}

get_task_failure_count() {
  local task_id="$1"
  if [[ -f "$TASK_FAILURES_FILE" ]]; then
    TASK_ID="$task_id" FAILURES_FILE="$TASK_FAILURES_FILE" \
    python3 -c "
import json, os
try:
    with open(os.environ['FAILURES_FILE'], 'r') as f:
        data = json.load(f)
    print(data.get(os.environ['TASK_ID'], {}).get('count', 0))
except:
    print(0)
" 2>/dev/null || echo "0"
  else
    echo "0"
  fi
}

skip_task() {
  local task_id="$1"
  local reason="$2"
  echo "$task_id|$(date -u +%Y-%m-%dT%H:%M:%SZ)|$reason" >> "$SKIPPED_FILE"
  echo "  SKIPPED: $task_id — $reason"
}

is_task_skipped() {
  local task_id="$1"
  [[ -f "$SKIPPED_FILE" ]] && grep -q "^${task_id}|" "$SKIPPED_FILE"
}

# ── State Tracking ───────────────────────────────────────────────

ITERATION=0
CONSECUTIVE_FAILURES=0
RUN_STARTED_AT="$(date -u +%Y-%m-%dT%H:%M:%SZ)"

write_state() {
  local status="$1"
  local skipped_count=0
  if [[ -f "$SKIPPED_FILE" ]]; then
    skipped_count=$(wc -l < "$SKIPPED_FILE" 2>/dev/null | tr -d ' ')
  fi
  cat > "$STATE_FILE" <<STATEEOF
{
  "status": "$status",
  "started_at": "$RUN_STARTED_AT",
  "updated_at": "$(date -u +%Y-%m-%dT%H:%M:%SZ)",
  "iteration": $ITERATION,
  "phase": "$PHASE_FILTER",
  "model": "${MODEL:-gpt-5.2-codex}",
  "sandbox": "$SANDBOX",
  "engine": "codex",
  "consecutive_failures": $CONSECUTIVE_FAILURES,
  "skipped_tasks": $skipped_count,
  "max_task_failures": $MAX_TASK_FAILURES,
  "project": "$PROJECT_DIR",
  "tasks_file": "$TASKS_FILE",
  "pid": $$
}
STATEEOF
}

trap 'write_state "stopped"' EXIT

# ── Task Scanning ────────────────────────────────────────────────

get_pending_tasks() {
  local tasks_file="$1"
  local phase="$2"

  local raw_tasks
  if [[ "$phase" != "none" ]]; then
    raw_tasks=$(sed -nE "/^## Phase $phase/,/^## Phase |^## Status|^---$/p" "$tasks_file" \
      | awk -F'|' 'NF>=5 && tolower($(NF-1)) ~ /pending/' \
      | grep -oE 'OB-[0-9]+')
  else
    raw_tasks=$(awk -F'|' 'NF>=5 && tolower($(NF-1)) ~ /pending/' "$tasks_file" \
      | grep -v '^>' \
      | grep -oE 'OB-[0-9]+')
  fi

  local result=""
  while IFS= read -r task_id; do
    [[ -z "$task_id" ]] && continue
    is_task_skipped "$task_id" && continue
    if [[ -n "$result" ]]; then
      result="${result}"$'\n'"${task_id}"
    else
      result="${task_id}"
    fi
  done <<< "$raw_tasks"

  echo "$result"
}

build_prompt() {
  local task_id="$1"
  printf '%s' "$PROMPT_TEMPLATE" | sed "s|{{TASK_ID}}|${task_id}|g"
}

# ── Post-Agent: Git Commit ───────────────────────────────────
# Codex's workspace-write sandbox cannot write to .git/, so the
# script commits changes after the agent finishes.

post_agent_commit() {
  local task_id="$1"
  local log_file="$2"

  cd "$PROJECT_DIR"

  # Check if there are any changes to commit
  local changed_files
  changed_files=$(git diff --name-only 2>/dev/null; git ls-files --others --exclude-standard 2>/dev/null)
  if [[ -z "$changed_files" ]]; then
    echo "  POST-COMMIT: No changes to commit."
    return 0
  fi

  echo "  POST-COMMIT: Staging changed files..."

  # Stage only changed/new files (not git add .)
  # Exclude the pointer file — the script manages it separately.
  local pointer_rel="${POINTER_FILE}"
  while IFS= read -r file; do
    [[ -z "$file" ]] && continue
    [[ "$file" == "$pointer_rel" ]] && continue
    git add "$file" 2>/dev/null
    echo "    + $file"
  done <<< "$changed_files"

  # Determine commit scope from changed files
  local scope="core"
  if echo "$changed_files" | grep -q "^tests/"; then
    scope="test"
  fi
  if echo "$changed_files" | grep -q "^src/master/"; then
    scope="master"
  fi
  if echo "$changed_files" | grep -q "^src/core/"; then
    scope="core"
  fi
  if echo "$changed_files" | grep -q "^src/connectors/"; then
    scope="connector"
  fi
  if echo "$changed_files" | grep -q "^src/memory/"; then
    scope="memory"
  fi

  # Extract task description from the markdown table (column 4: | # | ID | Description | Status |)
  local task_desc
  task_desc=$(grep -m1 "$task_id" "$TASKS_PATH" 2>/dev/null \
    | awk -F'|' '{ gsub(/^ +| +$/, "", $4); print $4 }' \
    | head -c 72)
  if [[ -z "$task_desc" ]]; then
    task_desc="implement $task_id"
  fi
  # Trim leading/trailing whitespace, take first sentence
  task_desc=$(echo "$task_desc" | sed 's/^ *//;s/ *$//' | sed 's/ —.*//' | head -c 60)
  # Lowercase for conventional commit
  task_desc=$(echo "$task_desc" | awk '{print tolower(substr($0,1,1)) substr($0,2)}')

  local commit_msg
  commit_msg=$(cat <<EOF
feat($scope): $task_desc

Resolves $task_id

Implemented by Codex agent (sandbox: $SANDBOX).
Post-agent commit by run-tasks-codex.sh.
EOF
)

  echo "  POST-COMMIT: Committing..."
  if git commit -m "$commit_msg" 2>/dev/null; then
    echo "  POST-COMMIT: Committed successfully."
    return 0
  else
    echo "  POST-COMMIT: Commit failed (possibly nothing staged or hook error)."
    return 1
  fi
}

# ── Post-Agent: Update Pointer ──────────────────────────────
# Finds the next pending task and writes it to the pointer file.

post_agent_update_pointer() {
  local completed_task_id="$1"

  cd "$PROJECT_DIR"

  # Find pending tasks after the current one
  local next_task
  next_task=$(get_pending_tasks "$TASKS_PATH" "$PHASE_FILTER" | grep -v "^${completed_task_id}$" | head -1)

  if [[ -n "$next_task" ]]; then
    echo "$next_task" > "$POINTER_PATH"
    echo "  POINTER: Next task → $next_task"
  else
    echo "DONE" > "$POINTER_PATH"
    echo "  POINTER: All tasks complete → DONE"
  fi
}

# ── Agent Execution ──────────────────────────────────────────────

run_agent() {
  local task_id="$1"
  local log_file="$2"

  local prompt
  prompt=$(build_prompt "$task_id")

  # Codex exec flags:
  #   -m MODEL          Model selection (omit to use Codex default: gpt-5.2-codex)
  #   --sandbox MODE    Sandbox policy (workspace-write allows file edits + git)
  #   --full-auto       Auto-approve within sandbox
  #   -C DIR            Working directory
  local flags=(exec --full-auto --sandbox "$SANDBOX" -C "$PROJECT_DIR")

  # Only pass --model if explicitly set (ChatGPT accounts only support the default)
  if [[ -n "$MODEL" ]]; then
    flags+=(-m "$MODEL")
  fi

  cd "$PROJECT_DIR"
  codex "${flags[@]}" "$prompt" 2>&1 | tee "$log_file"
  return ${PIPESTATUS[0]}
}

# ══════════════════════════════════════════════════════════════════
#  SINGLE-TASK MODE
# ══════════════════════════════════════════════════════════════════

if [[ -n "$TASK_OVERRIDE" ]]; then
  TIMESTAMP=$(date '+%Y%m%d_%H%M%S')
  LOG_FILE="$LOG_PATH/single_${TASK_OVERRIDE}_${TIMESTAMP}.log"

  echo ""
  echo "════════════════════════════════════════════════════════════"
  echo "  Task Runner (Codex) — Single Task"
  echo "════════════════════════════════════════════════════════════"
  echo "  Task:    $TASK_OVERRIDE"
  echo "  Model:   ${MODEL:-gpt-5.2-codex (default)}"
  echo "  Sandbox: $SANDBOX"
  echo "  Log:     $LOG_FILE"
  echo "════════════════════════════════════════════════════════════"
  echo ""

  write_state "running"
  run_agent "$TASK_OVERRIDE" "$LOG_FILE"
  EXIT_CODE=$?

  echo ""
  echo "────────────────────────────────────────────────────────────"
  if [[ "$EXIT_CODE" -eq 0 ]] && validate_output "$LOG_FILE"; then
    # Post-agent: commit changes and update pointer
    post_agent_commit "$TASK_OVERRIDE" "$LOG_FILE"
    post_agent_update_pointer "$TASK_OVERRIDE"
    write_state "completed"
    echo "  Task $TASK_OVERRIDE completed successfully."
  else
    write_state "failed"
    echo "  Task $TASK_OVERRIDE failed (exit $EXIT_CODE).${FAILURE_REASON:+ Reason: $FAILURE_REASON}"
    echo "  Log: $LOG_FILE"
  fi
  echo "────────────────────────────────────────────────────────────"

  exit "$EXIT_CODE"
fi

# ══════════════════════════════════════════════════════════════════
#  LOOP MODE
# ══════════════════════════════════════════════════════════════════

echo ""
echo "════════════════════════════════════════════════════════════"
echo "  Task Runner (Codex)"
echo "════════════════════════════════════════════════════════════"
echo "  Project:  $PROJECT_DIR"
echo "  Tasks:    $TASKS_FILE"
echo "  Phase:    $PHASE_FILTER"
echo "  Model:    ${MODEL:-gpt-5.2-codex (default)}"
echo "  Sandbox:  $SANDBOX"
echo "  Retries:  $MAX_CONSECUTIVE_FAILURES consecutive"
echo "  Skip at:  $MAX_TASK_FAILURES failures/task"
echo "════════════════════════════════════════════════════════════"
echo ""

# Show previously skipped tasks
if [[ -f "$SKIPPED_FILE" && -s "$SKIPPED_FILE" ]]; then
  echo "  Previously skipped:"
  while IFS='|' read -r tid ts reason; do
    echo "    - $tid: $reason"
  done < "$SKIPPED_FILE"
  echo ""
fi

while true; do
  ITERATION=$((ITERATION + 1))
  write_state "running"
  TIMESTAMP=$(date '+%Y%m%d_%H%M%S')

  echo "═══════════════════════════════════════════════════════════"
  echo "  Iteration #$ITERATION — $(date)"
  echo "═══════════════════════════════════════════════════════════"

  # Check pointer for DONE
  if [ -f "$POINTER_PATH" ] && grep -qi "^DONE$" "$POINTER_PATH"; then
    write_state "completed"
    echo "  All tasks complete."
    exit 0
  fi

  # Scan for pending tasks
  PENDING_TASKS=$(get_pending_tasks "$TASKS_PATH" "$PHASE_FILTER")
  PENDING_COUNT=$(echo "$PENDING_TASKS" | grep -c 'OB-' || echo "0")

  if [ "$PENDING_COUNT" -eq 0 ]; then
    write_state "completed"
    echo "DONE" > "$POINTER_PATH"
    echo "  No pending tasks (all done or skipped)."
    if [[ -f "$SKIPPED_FILE" && -s "$SKIPPED_FILE" ]]; then
      echo ""
      echo "  Skipped tasks:"
      while IFS='|' read -r tid ts reason; do
        echo "    - $tid: $reason"
      done < "$SKIPPED_FILE"
    fi
    exit 0
  fi

  # Pick the first pending task
  TASK_ID=$(echo "$PENDING_TASKS" | head -1)
  echo "  Task:    $TASK_ID"
  echo "  Pending: $PENDING_COUNT total"

  # Show per-task failure history
  TASK_FAIL_COUNT=$(get_task_failure_count "$TASK_ID")
  if [[ "$TASK_FAIL_COUNT" -gt 0 ]]; then
    echo "  History: $TASK_FAIL_COUNT previous failure(s)"
  fi

  LOG_FILE="$LOG_PATH/run_${ITERATION}_${TASK_ID}_${TIMESTAMP}.log"
  echo "  Log:     $LOG_FILE"
  echo "───────────────────────────────────────────────────────────"

  # Run the agent
  run_agent "$TASK_ID" "$LOG_FILE"
  EXIT_CODE=$?

  echo ""
  echo "───────────────────────────────────────────────────────────"
  echo "  Exit code: $EXIT_CODE"

  # Validate result
  if [[ "$EXIT_CODE" -eq 0 ]] && validate_output "$LOG_FILE"; then
    # Success — post-agent: commit and update pointer
    CONSECUTIVE_FAILURES=0
    echo "  SUCCESS: $TASK_ID"
    post_agent_commit "$TASK_ID" "$LOG_FILE"
    post_agent_update_pointer "$TASK_ID"
  else
    # Failure
    CONSECUTIVE_FAILURES=$((CONSECUTIVE_FAILURES + 1))
    REASON="${FAILURE_REASON:-exit code $EXIT_CODE}"
    FAIL_COUNT=$(record_task_failure "$TASK_ID" "$REASON")
    echo "  FAILED: $TASK_ID — $REASON (failure #$FAIL_COUNT)"

    # Skip task if it keeps failing
    if [[ "$FAIL_COUNT" -ge "$MAX_TASK_FAILURES" ]] && ! is_task_skipped "$TASK_ID"; then
      skip_task "$TASK_ID" "$REASON ($FAIL_COUNT failures)"
    fi

    # Bail on consecutive failures
    if [[ "$CONSECUTIVE_FAILURES" -ge "$MAX_CONSECUTIVE_FAILURES" ]]; then
      write_state "failed"
      echo ""
      echo "  ERROR: $MAX_CONSECUTIVE_FAILURES consecutive failures. Stopping."
      echo "  Check logs: $LOG_PATH"
      exit 1
    fi

    echo "  Retrying in ${SLEEP_ON_RETRY}s... (Ctrl+C to stop)"
    sleep "$SLEEP_ON_RETRY"
    continue
  fi

  # Check if done after successful run
  if [ -f "$POINTER_PATH" ] && grep -qi "^DONE$" "$POINTER_PATH"; then
    write_state "completed"
    echo "  All tasks complete after iteration #$ITERATION."
    exit 0
  fi

  echo "  Next iteration in ${SLEEP_BETWEEN}s... (Ctrl+C to stop)"
  sleep "$SLEEP_BETWEEN"
done
