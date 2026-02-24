#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────
# run-tasks.sh
# Automated task runner — spawns Claude Code agents to execute
# pending tasks from a task list, one at a time.
#
# Usage:
#   ./scripts/run-tasks.sh                          # Run all pending tasks
#   ./scripts/run-tasks.sh OB-302                   # Run one specific task
#   ./scripts/run-tasks.sh --phase 22               # Phase 22 only
#   ./scripts/run-tasks.sh --caffeinate             # Prevent macOS sleep
#   ./scripts/run-tasks.sh --help                   # Show all options
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
HEALTH_FILE="docs/audit/HEALTH.md"
POINTER_FILE="docs/audit/.current_task"
PROMPT_FILE="$SCRIPT_DIR/prompts/execute-task.md"
LOG_DIR="logs/task-runs"

# Execution
MODEL="sonnet"
MAX_BUDGET=5                      # USD per agent
MAX_CONSECUTIVE_FAILURES=3        # Stop after N consecutive failures
MAX_TASK_FAILURES=3               # Skip a task after N total failures
SLEEP_BETWEEN=5                   # Seconds between iterations
SLEEP_ON_RETRY=10                 # Seconds before retrying after failure
PHASE_FILTER="none"               # "none" = all phases
TASK_OVERRIDE=""                  # Empty = loop mode, "OB-xxx" = single task

# Tool permissions (defined once)
ALLOWED_TOOLS=(
  "Read Edit Write Glob Grep"
  "Bash(git:*)"
  "Bash(npm:*)"
  "Bash(npx:*)"
)

# ── Usage ────────────────────────────────────────────────────────

usage() {
  cat <<EOF
Usage: $(basename "$0") [TASK_ID] [OPTIONS]

Spawns Claude Code agents to execute pending tasks from a task list.
If TASK_ID is given, runs only that task and exits.
Otherwise, loops through all pending tasks sequentially.

Arguments:
  TASK_ID               Optional. Run a specific task (e.g., OB-302)

Paths:
  --tasks FILE          Task list file (default: $TASKS_FILE)
  --findings FILE       Findings file (default: $FINDINGS_FILE)
  --health FILE         Health score file (default: $HEALTH_FILE)
  --pointer FILE        Pointer file (default: $POINTER_FILE)
  --prompt FILE         Prompt template (default: prompts/execute-task.md)
  --log-dir DIR         Log directory (default: $LOG_DIR)
  --project DIR         Project root (default: auto-detected)

Execution:
  --phase N             Only run tasks from Phase N
  --model MODEL         Claude model (default: $MODEL)
  --budget N            Per-agent budget in USD (default: $MAX_BUDGET)
  --max-task-failures N Skip task after N failures (default: $MAX_TASK_FAILURES)
  --retries N           Stop after N consecutive failures (default: $MAX_CONSECUTIVE_FAILURES)

Other:
  --caffeinate          Prevent macOS sleep (must be first argument)
  --reset-failures      Clear failure tracking and skipped tasks
  --help                Show this message

Examples:
  ./scripts/run-tasks.sh                          # Run all pending
  ./scripts/run-tasks.sh OB-302                   # Run one task
  ./scripts/run-tasks.sh --phase 22 --model opus  # Phase 22, Opus
  ./scripts/run-tasks.sh --caffeinate             # Overnight run
  ./scripts/run-tasks.sh --reset-failures         # Clear skip list
EOF
  exit 0
}

# ── Parse Args ───────────────────────────────────────────────────

RESET_FAILURES=false

while [[ $# -gt 0 ]]; do
  case "$1" in
    --tasks)              TASKS_FILE="$2"; shift 2 ;;
    --findings)           FINDINGS_FILE="$2"; shift 2 ;;
    --health)             HEALTH_FILE="$2"; shift 2 ;;
    --pointer)            POINTER_FILE="$2"; shift 2 ;;
    --prompt)             PROMPT_FILE="$2"; shift 2 ;;
    --log-dir)            LOG_DIR="$2"; shift 2 ;;
    --project)            PROJECT_DIR="$2"; shift 2 ;;
    --phase)              PHASE_FILTER="$2"; shift 2 ;;
    --model)              MODEL="$2"; shift 2 ;;
    --budget)             MAX_BUDGET="$2"; shift 2 ;;
    --max-task-failures)  MAX_TASK_FAILURES="$2"; shift 2 ;;
    --retries)            MAX_CONSECUTIVE_FAILURES="$2"; shift 2 ;;
    --reset-failures)     RESET_FAILURES=true; shift ;;
    --help)               usage ;;
    -*)                   echo "Unknown option: $1"; echo ""; usage ;;
    *)                    TASK_OVERRIDE="$1"; shift ;;
  esac
done

# ── Find Claude CLI ──────────────────────────────────────────────

find_claude_cli() {
  if [ -f "$HOME/.zshrc" ]; then
    source "$HOME/.zshrc" 2>/dev/null || true
  elif [ -f "$HOME/.bashrc" ]; then
    source "$HOME/.bashrc" 2>/dev/null || true
  fi

  if ! command -v claude &>/dev/null; then
    for dir in "$HOME/.local/bin" "$HOME/.npm-global/bin" "/usr/local/bin" "/opt/homebrew/bin"; do
      if [ -x "$dir/claude" ]; then
        export PATH="$dir:$PATH"
        break
      fi
    done
  fi

  if ! command -v claude &>/dev/null; then
    echo "ERROR: 'claude' command not found."
    echo "Install Claude Code CLI or add it to your PATH."
    exit 1
  fi
}

find_claude_cli

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
  -e "s|{{HEALTH_FILE}}|$HEALTH_FILE|g" \
  -e "s|{{POINTER_FILE}}|$POINTER_FILE|g" \
  -e "s|{{PHASE}}|$PHASE_FILTER|g")

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
  "model": "$MODEL",
  "budget": "$MAX_BUDGET",
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
    raw_tasks=$(sed -n "/^## Phase $phase/,/^## Phase \|^## Status\|^---$/p" "$tasks_file" \
      | grep -i 'Pending' \
      | grep -oE 'OB-[0-9]+')
  else
    raw_tasks=$(grep -i 'Pending' "$tasks_file" \
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

# ── Agent Execution ──────────────────────────────────────────────

run_agent() {
  local task_id="$1"
  local log_file="$2"

  local prompt
  prompt=$(build_prompt "$task_id")

  local flags=(--print --model "$MODEL" --max-budget-usd "$MAX_BUDGET")
  for tool in "${ALLOWED_TOOLS[@]}"; do
    flags+=(--allowedTools "$tool")
  done

  cd "$PROJECT_DIR"
  claude "${flags[@]}" -p "$prompt" 2>&1 | tee "$log_file"
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
  echo "  Task Runner — Single Task"
  echo "════════════════════════════════════════════════════════════"
  echo "  Task:    $TASK_OVERRIDE"
  echo "  Model:   $MODEL"
  echo "  Budget:  \$$MAX_BUDGET"
  echo "  Log:     $LOG_FILE"
  echo "════════════════════════════════════════════════════════════"
  echo ""

  write_state "running"
  run_agent "$TASK_OVERRIDE" "$LOG_FILE"
  EXIT_CODE=$?

  echo ""
  echo "────────────────────────────────────────────────────────────"
  if [[ "$EXIT_CODE" -eq 0 ]] && validate_output "$LOG_FILE"; then
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
echo "  Task Runner"
echo "════════════════════════════════════════════════════════════"
echo "  Project:  $PROJECT_DIR"
echo "  Tasks:    $TASKS_FILE"
echo "  Phase:    $PHASE_FILTER"
echo "  Model:    $MODEL"
echo "  Budget:   \$$MAX_BUDGET/agent"
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
    # Success
    CONSECUTIVE_FAILURES=0
    echo "  SUCCESS: $TASK_ID"
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
