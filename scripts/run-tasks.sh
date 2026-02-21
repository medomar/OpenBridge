#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────
# run-tasks.sh
# Repeatedly launches Claude Code agents to execute pending tasks
# from a configurable task list. Features an AI orchestrator that
# plans task assignments and validates results.
#
# Usage:
#   ./scripts/run-tasks.sh                          # Run all pending tasks
#   ./scripts/run-tasks.sh --phase 1                # Phase 1 only
#   ./scripts/run-tasks.sh --parallel 3             # Up to 3 agents in parallel
#   ./scripts/run-tasks.sh --model opus             # Default model for workers
#   ./scripts/run-tasks.sh --orchestrator           # Enable AI orchestrator
#   ./scripts/run-tasks.sh --caffeinate             # Prevent sleep during run
#   ./scripts/run-tasks.sh --help                   # Show all options
# ─────────────────────────────────────────────────────────────────

set -uo pipefail

# ── Caffeinate (prevent macOS sleep) ─────────────────────────────

if [[ "${1:-}" == "--caffeinate" ]]; then
  shift
  exec caffeinate -s "$0" "$@"
fi

# ── Defaults ─────────────────────────────────────────────────────

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

# Paths (all configurable)
TASKS_FILE="docs/audit/TASKS.md"
FINDINGS_FILE="docs/audit/FINDINGS.md"
HEALTH_FILE="docs/audit/HEALTH.md"
POINTER_FILE="docs/audit/.current_task"
PROMPT_FILE="$SCRIPT_DIR/prompts/execute-task.md"
ORCH_PLAN_PROMPT="$SCRIPT_DIR/prompts/orchestrator-plan.md"
ORCH_VALIDATE_PROMPT="$SCRIPT_DIR/prompts/orchestrator-validate.md"
LOG_DIR="logs/task-runs"

# Execution
MODEL=""                          # Empty = use default model
PARALLEL=1                        # Maximum number of concurrent agents
MAX_TURNS=""                      # Empty = unlimited turns per iteration
MAX_CONSECUTIVE_FAILURES=5        # Stop after N consecutive all-fail iterations
MAX_TASK_FAILURES=3               # Skip a task after N total failures
TASK_TIMEOUT=""                   # Empty = no per-task timeout (seconds)
MAX_BUDGET=""                     # Empty = no per-agent budget cap (dollars)
SLEEP_BETWEEN=5                   # Seconds between iterations
SLEEP_ON_RETRY=10                 # Seconds before retrying a failed task
PHASE_FILTER="none"               # "none" = all phases

# Orchestrator
ORCHESTRATOR_ENABLED=false
ORCHESTRATOR_MODEL="haiku"

# Tool permissions for workers
ALLOWED_TOOLS=(
  "Read Edit Write Glob Grep"
  "Bash(git:*)"
  "Bash(npm:*)"
  "Bash(npx:*)"
)

# Tool permissions for orchestrator (read-only)
ORCH_TOOLS=(
  "Read Glob Grep"
)

# ── Usage ────────────────────────────────────────────────────────

usage() {
  cat <<EOF
Usage: $(basename "$0") [OPTIONS]

Launches Claude Code agents in a loop to execute pending tasks.
Configurable for any project — just point to your task list.

Paths:
  --tasks FILE        Task list file, relative to project root (default: $TASKS_FILE)
  --findings FILE     Findings file (default: $FINDINGS_FILE)
  --health FILE       Health score file (default: $HEALTH_FILE)
  --pointer FILE      Pointer file for tracking progress (default: $POINTER_FILE)
  --prompt FILE       Prompt template, absolute or relative to scripts/ (default: prompts/execute-task.md)
  --log-dir DIR       Log directory, relative to project root (default: $LOG_DIR)
  --project DIR       Project root directory (default: auto-detected from script location)

Execution:
  --phase N           Only execute tasks from Phase N
  --model MODEL       Default Claude model for workers (e.g., opus, sonnet, haiku)
  --parallel N        Maximum concurrent agents (default: $PARALLEL)
  --max-turns N       Default max turns per agent (default: unlimited)
  --max-task-failures N  Skip task after N total failures (default: $MAX_TASK_FAILURES)
  --task-timeout N    Per-task wall-clock timeout in seconds (default: none)
  --max-budget N      Per-agent budget cap in USD (default: none, e.g., 5)
  --retries N         Max consecutive failures before stopping (default: $MAX_CONSECUTIVE_FAILURES)
  --sleep N           Seconds between iterations (default: $SLEEP_BETWEEN)
  --sleep-retry N     Seconds before retrying a failed task (default: $SLEEP_ON_RETRY)

Orchestrator:
  --orchestrator          Enable AI orchestrator (planner + validator using haiku)
  --no-orchestrator       Disable AI orchestrator (default)
  --orchestrator-model M  Model for orchestrator (default: $ORCHESTRATOR_MODEL)

Other:
  --caffeinate        Prevent macOS from sleeping during the run (uses caffeinate -s)
  --help              Show this message

Examples:
  ./scripts/run-tasks.sh                                    # Run all pending
  ./scripts/run-tasks.sh --phase 1 --model sonnet           # Phase 1, Sonnet model
  ./scripts/run-tasks.sh --parallel 3 --orchestrator        # AI-planned, up to 3 agents
  ./scripts/run-tasks.sh --caffeinate --model opus           # Overnight run, no sleep
  ./scripts/run-tasks.sh --orchestrator --parallel 5         # Let AI decide task count (up to 5)
EOF
  exit 0
}

# ── Parse Args ───────────────────────────────────────────────────

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
    --parallel)           PARALLEL="$2"; shift 2 ;;
    --max-turns)          MAX_TURNS="$2"; shift 2 ;;
    --max-task-failures)  MAX_TASK_FAILURES="$2"; shift 2 ;;
    --task-timeout)       TASK_TIMEOUT="$2"; shift 2 ;;
    --max-budget)         MAX_BUDGET="$2"; shift 2 ;;
    --retries)            MAX_CONSECUTIVE_FAILURES="$2"; shift 2 ;;
    --sleep)              SLEEP_BETWEEN="$2"; shift 2 ;;
    --sleep-retry)        SLEEP_ON_RETRY="$2"; shift 2 ;;
    --orchestrator)       ORCHESTRATOR_ENABLED=true; shift ;;
    --no-orchestrator)    ORCHESTRATOR_ENABLED=false; shift ;;
    --orchestrator-model) ORCHESTRATOR_MODEL="$2"; shift 2 ;;
    --help)               usage ;;
    *)                    echo "Unknown option: $1"; echo ""; usage ;;
  esac
done

# Resolve relative paths against project root
TASKS_PATH="$PROJECT_DIR/$TASKS_FILE"
FINDINGS_PATH="$PROJECT_DIR/$FINDINGS_FILE"
HEALTH_PATH="$PROJECT_DIR/$HEALTH_FILE"
POINTER_PATH="$PROJECT_DIR/$POINTER_FILE"
LOG_PATH="$PROJECT_DIR/$LOG_DIR"
COUNTER_FILE="$LOG_PATH/.iteration_counter"
TASK_FAILURES_FILE="$LOG_PATH/.task_failures.json"
SKIPPED_FILE="$LOG_PATH/.skipped_tasks"

# ── Find Claude CLI ──────────────────────────────────────────────

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

# ── Validate ─────────────────────────────────────────────────────

if [ ! -f "$PROMPT_FILE" ]; then
  echo "ERROR: Prompt file not found: $PROMPT_FILE"
  exit 1
fi

if [ ! -f "$TASKS_PATH" ]; then
  echo "ERROR: Tasks file not found: $TASKS_PATH"
  exit 1
fi

if [ "$PARALLEL" -lt 1 ] 2>/dev/null; then
  echo "ERROR: --parallel must be a positive integer."
  exit 1
fi

if [[ "$ORCHESTRATOR_ENABLED" == "true" ]]; then
  if [ ! -f "$ORCH_PLAN_PROMPT" ]; then
    echo "ERROR: Orchestrator plan prompt not found: $ORCH_PLAN_PROMPT"
    exit 1
  fi
  if [ ! -f "$ORCH_VALIDATE_PROMPT" ]; then
    echo "ERROR: Orchestrator validate prompt not found: $ORCH_VALIDATE_PROMPT"
    exit 1
  fi
fi

# ── Setup ────────────────────────────────────────────────────────

mkdir -p "$LOG_PATH"

# Initialize task failures file
if [[ ! -f "$TASK_FAILURES_FILE" ]]; then
  echo '{}' > "$TASK_FAILURES_FILE"
fi

# Extract prompt content between ```` fences (also try ~~~ as fallback)
PROMPT_TEMPLATE_RAW=$(sed -n '/^````$/,/^````$/{ /^````$/d; p; }' "$PROMPT_FILE")
if [[ -z "$PROMPT_TEMPLATE_RAW" ]]; then
  PROMPT_TEMPLATE_RAW=$(sed -n '/^~~~$/,/^~~~$/{ /^~~~$/d; p; }' "$PROMPT_FILE")
fi

if [[ -z "$PROMPT_TEMPLATE_RAW" ]]; then
  echo "ERROR: Could not extract prompt from $PROMPT_FILE"
  echo "  Make sure the prompt is wrapped in \`\`\`\` or ~~~ fences."
  exit 1
fi

# Inject static configuration into prompt using sed (safer than bash substitution)
# This avoids issues with special characters in file paths
inject_var() {
  local var_name="$1"
  local var_value="$2"
  # Escape sed special chars in the value
  local escaped_value
  escaped_value=$(printf '%s' "$var_value" | sed 's/[&/\]/\\&/g')
  PROMPT_TEMPLATE_RAW=$(printf '%s' "$PROMPT_TEMPLATE_RAW" | sed "s|{{${var_name}}}|${escaped_value}|g")
}

inject_var "PHASE" "$PHASE_FILTER"
inject_var "TASKS_FILE" "$TASKS_FILE"
inject_var "FINDINGS_FILE" "$FINDINGS_FILE"
inject_var "HEALTH_FILE" "$HEALTH_FILE"
inject_var "POINTER_FILE" "$POINTER_FILE"

# ── Per-Task Failure Tracking ────────────────────────────────────

record_task_failure() {
  local task_id="$1"
  local reason="$2"
  local timestamp
  timestamp=$(date -u +%Y-%m-%dT%H:%M:%SZ)

  if command -v python3 &>/dev/null; then
    # Use env vars instead of string interpolation to avoid quote/escape issues
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
" 2>/dev/null
  else
    echo "$task_id|$timestamp|$reason" >> "${TASK_FAILURES_FILE}.txt"
    grep -c "^${task_id}|" "${TASK_FAILURES_FILE}.txt" 2>/dev/null || echo "1"
  fi
}

get_task_failure_count() {
  local task_id="$1"
  if command -v python3 &>/dev/null && [[ -f "$TASK_FAILURES_FILE" ]]; then
    TASK_ID="$task_id" FAILURES_FILE="$TASK_FAILURES_FILE" \
    python3 -c "
import json, os
try:
    with open(os.environ['FAILURES_FILE'], 'r') as f:
        data = json.load(f)
    print(data.get(os.environ['TASK_ID'], {}).get('count', 0))
except:
    print(0)
" 2>/dev/null
  else
    echo "0"
  fi
}

get_failure_history_summary() {
  if command -v python3 &>/dev/null && [[ -f "$TASK_FAILURES_FILE" ]]; then
    FAILURES_FILE="$TASK_FAILURES_FILE" \
    python3 -c "
import json, os
try:
    with open(os.environ['FAILURES_FILE'], 'r') as f:
        data = json.load(f)
    if not data:
        print('No failures recorded yet.')
    else:
        for tid, info in sorted(data.items()):
            reasons = ', '.join(set(a.get('reason','unknown') for a in info.get('attempts', [])))
            print(f'{tid}: {info[\"count\"]} failure(s) - {reasons}')
except:
    print('No failure history available.')
" 2>/dev/null
  else
    echo "No failure history available."
  fi
}

# ── Skip Mechanism ───────────────────────────────────────────────

skip_task() {
  local task_id="$1"
  local reason="$2"
  local timestamp
  timestamp=$(date -u +%Y-%m-%dT%H:%M:%SZ)
  echo "$task_id|$timestamp|$reason" >> "$SKIPPED_FILE"
  echo "  SKIPPED: $task_id — $reason"
}

is_task_skipped() {
  local task_id="$1"
  if [[ -f "$SKIPPED_FILE" ]] && grep -q "^${task_id}|" "$SKIPPED_FILE"; then
    return 0
  fi
  return 1
}

get_skipped_summary() {
  if [[ -f "$SKIPPED_FILE" && -s "$SKIPPED_FILE" ]]; then
    cat "$SKIPPED_FILE"
  else
    echo "No tasks skipped."
  fi
}

# ── Output Validation ────────────────────────────────────────────

FAILURE_REASON=""

validate_output() {
  local log_file="$1"
  FAILURE_REASON=""

  # Hard failures: no output at all
  if [[ ! -f "$log_file" ]]; then
    FAILURE_REASON="log file missing"
    return 1
  fi

  if [[ ! -s "$log_file" ]]; then
    FAILURE_REASON="empty output (0 bytes)"
    return 1
  fi

  local size
  size=$(wc -c < "$log_file" | tr -d ' ')

  # Only flag truly tiny output (< 50 bytes = likely a crash, not a short success)
  if [[ "$size" -lt 50 ]]; then
    FAILURE_REASON="tiny output (${size} bytes)"
    return 1
  fi

  # Timeout is a hard failure
  if grep -qi "TIMEOUT: Agent killed" "$log_file"; then
    FAILURE_REASON="task timeout exceeded"
    return 1
  fi

  # CLI error at the very start with no real output = hard failure
  if [[ "$size" -lt 200 ]] && head -1 "$log_file" | grep -qi "^Error:"; then
    FAILURE_REASON="CLI error: $(head -1 "$log_file")"
    return 1
  fi

  # "Reached max turns" is a WARNING, not a failure — the agent may have
  # completed the task before hitting the limit. Only fail if the output
  # is also suspiciously small (< 500 bytes = probably didn't finish).
  if grep -qi "Reached max turns" "$log_file"; then
    if [[ "$size" -lt 500 ]]; then
      FAILURE_REASON="reached max turns with minimal output (${size} bytes)"
      return 1
    else
      echo "  Note: agent reached max turns but produced ${size} bytes — treating as success"
    fi
  fi

  return 0
}

# ── Get Pending Tasks ───────────────────────────────────────────

get_pending_tasks() {
  local tasks_file="$1"
  local phase="$2"
  local max_count="${3:-0}"

  local raw_tasks
  if [[ "$phase" != "none" ]]; then
    # Match pending tasks within a specific phase section
    # Uses case-insensitive grep and tolerates emoji/spacing variants
    raw_tasks=$(sed -n "/^## Phase $phase/,/^## Phase \|^## Status\|^---$/p" "$tasks_file" \
      | grep -i 'Pending' \
      | grep -oE 'OB-[0-9]+' \
      | head -"${max_count:-999}")
  else
    raw_tasks=$(grep -i 'Pending' "$tasks_file" \
      | grep -v '^>' \
      | grep -oE 'OB-[0-9]+' \
      | head -"${max_count:-999}")
  fi

  # Filter out skipped tasks (avoid subshell so output isn't swallowed)
  local result=""
  while IFS= read -r task_id; do
    [[ -z "$task_id" ]] && continue
    if is_task_skipped "$task_id"; then
      continue
    fi
    if [[ -n "$result" ]]; then
      result="${result}"$'\n'"${task_id}"
    else
      result="${task_id}"
    fi
  done <<< "$raw_tasks"

  echo "$result"
}

# Build prompt for a specific task ID
build_prompt() {
  local task_id="$1"
  printf '%s' "$PROMPT_TEMPLATE_RAW" | sed "s|{{TASK_ID}}|${task_id}|g"
}

# Persistent iteration counter
if [ -f "$COUNTER_FILE" ]; then
  ITERATION=$(cat "$COUNTER_FILE")
else
  ITERATION=0
fi

CONSECUTIVE_FAILURES=0
STATE_FILE="$LOG_PATH/.run_state.json"

# ── State Tracking ───────────────────────────────────────────────

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
  "model": "${MODEL:-default}",
  "parallel": $PARALLEL,
  "max_turns": "${MAX_TURNS:-unlimited}",
  "task_timeout": "${TASK_TIMEOUT:-none}",
  "max_budget": "${MAX_BUDGET:-none}",
  "orchestrator": "$ORCHESTRATOR_ENABLED",
  "orchestrator_model": "$ORCHESTRATOR_MODEL",
  "consecutive_failures": $CONSECUTIVE_FAILURES,
  "skipped_tasks": $skipped_count,
  "max_task_failures": $MAX_TASK_FAILURES,
  "project": "$PROJECT_DIR",
  "tasks_file": "$TASKS_FILE",
  "pid": $$
}
STATEEOF
}

RUN_STARTED_AT="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
write_state "running"

trap 'write_state "stopped"; echo ""; echo "Task runner stopped."' EXIT

# ── Process Cleanup ──────────────────────────────────────────────

cleanup_stale_agents() {
  local stale_pids
  stale_pids=$(ps aux | grep "[c]laude.*--print" | awk '{print $2}' || true)
  if [[ -n "$stale_pids" ]]; then
    local stale_count
    stale_count=$(echo "$stale_pids" | grep -c '.' || echo "0")
    if [[ "$stale_count" -gt 0 ]]; then
      echo "  Cleaning up $stale_count lingering agent(s)..."
      echo "$stale_pids" | while read -r pid; do
        kill "$pid" 2>/dev/null || true
      done
      sleep 2
      # Force kill any remaining
      local remaining
      remaining=$(ps aux | grep "[c]laude.*--print" | awk '{print $2}' || true)
      if [[ -n "$remaining" ]]; then
        echo "$remaining" | while read -r pid; do
          kill -9 "$pid" 2>/dev/null || true
        done
      fi
    fi
  fi
}

# ── Run Single Agent ─────────────────────────────────────────────

run_agent() {
  local agent_id="$1"
  local log_file="$2"
  local prompt="$3"
  local worker_model="${4:-$MODEL}"
  local worker_max_turns="${5:-$MAX_TURNS}"

  # Build flags for this specific worker
  local flags=(--print)
  if [[ -n "$worker_model" ]]; then
    flags+=(--model "$worker_model")
  fi
  if [[ -n "$worker_max_turns" ]]; then
    flags+=(--max-turns "$worker_max_turns")
  fi
  if [[ -n "$MAX_BUDGET" ]]; then
    flags+=(--max-budget-usd "$MAX_BUDGET")
  fi
  for tool in "${ALLOWED_TOOLS[@]}"; do
    flags+=(--allowedTools "$tool")
  done

  # Use subshell for cd to avoid affecting parent/sibling processes in parallel mode
  if [[ -n "$TASK_TIMEOUT" ]]; then
    # Run with timeout enforcement
    (cd "$PROJECT_DIR" && claude "${flags[@]}" -p "$prompt") 2>&1 | tee "$log_file" &
    local tee_pid=$!
    local elapsed=0

    while kill -0 "$tee_pid" 2>/dev/null; do
      if [[ "$elapsed" -ge "$TASK_TIMEOUT" ]]; then
        echo "" >> "$log_file"
        echo "TIMEOUT: Agent killed after ${TASK_TIMEOUT}s" >> "$log_file"
        # Kill the pipeline
        kill "$tee_pid" 2>/dev/null || true
        sleep 2
        kill -9 "$tee_pid" 2>/dev/null || true
        pkill -P "$tee_pid" 2>/dev/null || true
        wait "$tee_pid" 2>/dev/null || true
        return 124
      fi
      sleep 5
      elapsed=$((elapsed + 5))
    done

    wait "$tee_pid"
    return $?
  else
    (cd "$PROJECT_DIR" && claude "${flags[@]}" -p "$prompt") 2>&1 | tee "$log_file"
    return ${PIPESTATUS[0]}
  fi
}

# ── Orchestrator Functions ───────────────────────────────────────

extract_prompt_template() {
  local file="$1"
  sed -n '/^````$/,/^````$/{ /^````$/d; p; }' "$file"
}

# Run the orchestrator planner
run_orchestrator_plan() {
  local pending_task_details="$1"

  local orch_prompt
  orch_prompt=$(extract_prompt_template "$ORCH_PLAN_PROMPT")
  orch_prompt="${orch_prompt//\{\{PENDING_TASKS\}\}/$pending_task_details}"
  orch_prompt="${orch_prompt//\{\{FAILURE_HISTORY\}\}/$(get_failure_history_summary)}"
  orch_prompt="${orch_prompt//\{\{SKIPPED_TASKS\}\}/$(get_skipped_summary)}"
  orch_prompt="${orch_prompt//\{\{MAX_PARALLEL\}\}/$PARALLEL}"
  orch_prompt="${orch_prompt//\{\{DEFAULT_MAX_TURNS\}\}/${MAX_TURNS:-80}}"
  orch_prompt="${orch_prompt//\{\{AVAILABLE_MODELS\}\}/haiku, sonnet, opus}"

  echo "  Orchestrator planning..." >&2

  local orch_flags=(--print --model "$ORCHESTRATOR_MODEL" --max-turns 3 --max-budget-usd 1)
  for tool in "${ORCH_TOOLS[@]}"; do
    orch_flags+=(--allowedTools "$tool")
  done

  local orch_output
  orch_output=$(cd "$PROJECT_DIR" && timeout 120 claude "${orch_flags[@]}" -p "$orch_prompt" 2>/dev/null)
  local orch_exit=$?

  if [[ "$orch_exit" -ne 0 || -z "$orch_output" ]]; then
    echo "  Orchestrator failed (exit $orch_exit). Using fallback." >&2
    return 1
  fi

  # Extract JSON from the output (may be wrapped in markdown fences)
  local json_output
  json_output=$(echo "$orch_output" | python3 -c "
import sys, json, re
text = sys.stdin.read()
# Try to find JSON object in the text
match = re.search(r'\{[\s\S]*\}', text)
if match:
    try:
        data = json.loads(match.group())
        print(json.dumps(data))
    except:
        sys.exit(1)
else:
    sys.exit(1)
" 2>/dev/null)

  if [[ $? -ne 0 || -z "$json_output" ]]; then
    echo "  Orchestrator returned no valid JSON. Using fallback." >&2
    return 1
  fi

  # Parse and validate the plan — pipe JSON via stdin to avoid quote escaping issues
  echo "$json_output" | MAX_PARALLEL="$PARALLEL" DEFAULT_MODEL="${MODEL:-sonnet}" \
    DEFAULT_TURNS="${MAX_TURNS:-80}" \
    python3 -c "
import json, sys, os
try:
    data = json.loads(sys.stdin.read())
    tasks = data.get('tasks', [])
    if not tasks:
        print('EMPTY')
        sys.exit(0)
    max_p = int(os.environ.get('MAX_PARALLEL', 1))
    parallel = min(int(data.get('parallel', 1)), max_p)
    notes = data.get('notes', '')
    default_model = os.environ.get('DEFAULT_MODEL', 'sonnet')
    default_turns = os.environ.get('DEFAULT_TURNS', '80')
    for t in tasks[:max_p]:
        tid = t.get('task_id', '')
        model = t.get('model', default_model)
        turns = str(t.get('max_turns', default_turns))
        reason = t.get('reason', '')
        print(f'{tid}|{model}|{turns}|{reason}')
    print(f'PARALLEL|{parallel}')
    if notes:
        print(f'NOTES|{notes}')
except Exception as e:
    print(f'ERROR parsing plan: {e}', file=sys.stderr)
    sys.exit(1)
" 2>/dev/null

  return $?
}

# Run the orchestrator validator
run_orchestrator_validate() {
  local task_id="$1"
  local log_file="$2"
  local exit_code="$3"

  local log_tail=""
  local log_size=0
  if [[ -f "$log_file" ]]; then
    log_size=$(wc -c < "$log_file" | tr -d ' ')
    log_tail=$(tail -200 "$log_file" 2>/dev/null | head -c 8000)
  fi

  local val_prompt
  val_prompt=$(extract_prompt_template "$ORCH_VALIDATE_PROMPT")
  val_prompt="${val_prompt//\{\{TASK_ID\}\}/$task_id}"
  val_prompt="${val_prompt//\{\{EXIT_CODE\}\}/$exit_code}"
  val_prompt="${val_prompt//\{\{LOG_SIZE\}\}/$log_size}"
  val_prompt="${val_prompt//\{\{LOG_TAIL\}\}/$log_tail}"

  echo "  Validating $task_id..." >&2

  local orch_flags=(--print --model "$ORCHESTRATOR_MODEL" --max-turns 2 --max-budget-usd 1)

  local val_output
  val_output=$(cd "$PROJECT_DIR" && timeout 90 claude "${orch_flags[@]}" -p "$val_prompt" 2>/dev/null)
  local val_exit=$?

  if [[ "$val_exit" -ne 0 || -z "$val_output" ]]; then
    echo "  Validator failed. Falling back to basic validation." >&2
    return 1
  fi

  # Extract and parse JSON result
  local result
  result=$(echo "$val_output" | python3 -c "
import sys, json, re
text = sys.stdin.read()
match = re.search(r'\{[\s\S]*\}', text)
if match:
    try:
        data = json.loads(match.group())
        status = data.get('status', 'unknown')
        reason = data.get('reason', '')
        retry = str(data.get('should_retry', False))
        skip = str(data.get('should_skip', False))
        suggestion = data.get('suggestion', '')
        print(f'{status}|{reason}|{retry}|{skip}|{suggestion}')
    except:
        sys.exit(1)
else:
    sys.exit(1)
" 2>/dev/null)

  if [[ $? -ne 0 || -z "$result" ]]; then
    return 1
  fi

  echo "$result"
  return 0
}

# ── Banner ───────────────────────────────────────────────────────

PARALLEL_MODE="sequential"
if [ "$PARALLEL" -gt 1 ]; then
  PARALLEL_MODE="up to $PARALLEL agents"
fi

echo ""
echo "======================================================================"
echo "  Automated Task Runner"
echo "======================================================================"
echo "  Project:       $PROJECT_DIR"
echo "  Tasks:         $TASKS_FILE"
echo "  Phase:         ${PHASE_FILTER}"
echo "  Model:         ${MODEL:-default}"
echo "  Mode:          $PARALLEL_MODE"
echo "  Max turns:     ${MAX_TURNS:-unlimited}"
echo "  Task timeout:  ${TASK_TIMEOUT:-none}"
echo "  Budget cap:    ${MAX_BUDGET:-none} USD/agent"
echo "  Max task fail: $MAX_TASK_FAILURES (then skip)"
echo "  Retries:       $MAX_CONSECUTIVE_FAILURES max consecutive"
if [[ "$ORCHESTRATOR_ENABLED" == "true" ]]; then
echo "  Orchestrator:  ON ($ORCHESTRATOR_MODEL)"
else
echo "  Orchestrator:  OFF"
fi
echo "======================================================================"
echo ""

# Show skipped tasks if any exist from previous runs
if [[ -f "$SKIPPED_FILE" && -s "$SKIPPED_FILE" ]]; then
  echo "  Previously skipped tasks:"
  while IFS='|' read -r tid ts reason; do
    echo "    - $tid: $reason ($ts)"
  done < "$SKIPPED_FILE"
  echo ""
fi

# ── Main Loop ────────────────────────────────────────────────────

while true; do
  # ── Step 0: Clean up stale processes ─────────────────────────────
  cleanup_stale_agents

  ITERATION=$((ITERATION + 1))
  echo "$ITERATION" > "$COUNTER_FILE"
  write_state "running"
  TIMESTAMP=$(date '+%Y%m%d_%H%M%S')

  echo "============================================================"
  echo "  Iteration #$ITERATION — $(date)"
  echo "============================================================"

  # ── Step 1: Check pointer file for DONE signal ───────────────────
  if [ -f "$POINTER_PATH" ]; then
    POINTER_CONTENT=$(cat "$POINTER_PATH")
    if echo "$POINTER_CONTENT" | grep -qi "^DONE$"; then
      write_state "completed"
      echo "All tasks are complete. Exiting loop."
      exit 0
    fi
  fi

  # ── Step 2: Scan for pending tasks ───────────────────────────────
  PENDING_TASKS=$(get_pending_tasks "$TASKS_PATH" "$PHASE_FILTER" 999)
  PENDING_COUNT=$(echo "$PENDING_TASKS" | grep -c 'OB-' || echo "0")

  if [ "$PENDING_COUNT" -eq 0 ]; then
    write_state "completed"
    echo "DONE" > "$POINTER_PATH"
    echo "No pending tasks found (all done or all skipped)."
    if [[ -f "$SKIPPED_FILE" && -s "$SKIPPED_FILE" ]]; then
      echo ""
      echo "Skipped tasks:"
      while IFS='|' read -r tid ts reason; do
        echo "  - $tid: $reason"
      done < "$SKIPPED_FILE"
    fi
    exit 0
  fi

  echo "  Pending: $PENDING_COUNT task(s)"

  # ── Step 3: Plan the iteration ───────────────────────────────────
  BATCH_TASK_IDS=()
  BATCH_MODELS=()
  BATCH_MAX_TURNS=()
  BATCH_PARALLEL=1

  if [[ "$ORCHESTRATOR_ENABLED" == "true" ]]; then
    # Build task details for the orchestrator
    PENDING_DETAILS=""
    while IFS= read -r tid; do
      [[ -z "$tid" ]] && continue
      task_line=$(grep "$tid" "$TASKS_PATH" 2>/dev/null | head -1 | sed 's/|/ /g' | head -c 300)
      PENDING_DETAILS="${PENDING_DETAILS}- ${tid}: ${task_line}"$'\n'
    done <<< "$PENDING_TASKS"

    PLAN_OUTPUT=$(run_orchestrator_plan "$PENDING_DETAILS")
    PLAN_EXIT=$?

    if [[ "$PLAN_EXIT" -eq 0 && -n "$PLAN_OUTPUT" && "$PLAN_OUTPUT" != "EMPTY" ]]; then
      while IFS='|' read -r field1 field2 field3 field4; do
        [[ -z "$field1" ]] && continue
        if [[ "$field1" == "PARALLEL" ]]; then
          BATCH_PARALLEL="$field2"
        elif [[ "$field1" == "NOTES" ]]; then
          echo "  Orchestrator note: $field2"
        elif [[ "$field1" =~ ^OB- ]]; then
          # Only add task if it's still pending and not skipped
          if echo "$PENDING_TASKS" | grep -q "^${field1}$"; then
            BATCH_TASK_IDS+=("$field1")
            BATCH_MODELS+=("$field2")
            BATCH_MAX_TURNS+=("$field3")
            echo "  Plan: $field1 -> model=$field2, turns=$field3 ($field4)"
          fi
        fi
      done <<< "$PLAN_OUTPUT"
    fi

    if [[ "$PLAN_OUTPUT" == "EMPTY" ]]; then
      write_state "completed"
      echo "Orchestrator says no tasks to run. Exiting."
      exit 0
    fi
  fi

  # Fallback: if orchestrator failed or disabled
  if [[ ${#BATCH_TASK_IDS[@]} -eq 0 ]]; then
    while IFS= read -r tid; do
      [[ -z "$tid" ]] && continue
      BATCH_TASK_IDS+=("$tid")
      BATCH_MODELS+=("$MODEL")
      BATCH_MAX_TURNS+=("$MAX_TURNS")
      if [[ ${#BATCH_TASK_IDS[@]} -ge $PARALLEL ]]; then
        break
      fi
    done <<< "$PENDING_TASKS"
    BATCH_PARALLEL=${#BATCH_TASK_IDS[@]}
  fi

  # Cap parallel at max allowed
  if [[ "$BATCH_PARALLEL" -gt "$PARALLEL" ]]; then
    BATCH_PARALLEL="$PARALLEL"
  fi

  ACTUAL_COUNT=${#BATCH_TASK_IDS[@]}
  if [[ "$ACTUAL_COUNT" -eq 0 ]]; then
    echo "  No tasks in batch. Sleeping..."
    sleep "$SLEEP_BETWEEN"
    continue
  fi

  # ── Step 4: Execute the batch ────────────────────────────────────

  # Track results for this iteration
  ITERATION_HAS_FAILURE=false
  ITERATION_HAS_SUCCESS=false

  if [[ "$ACTUAL_COUNT" -eq 1 || "$BATCH_PARALLEL" -le 1 ]]; then
    # ── Sequential mode ─────────────────────────────────────────────
    for i in "${!BATCH_TASK_IDS[@]}"; do
      TASK_ID="${BATCH_TASK_IDS[$i]}"
      TASK_MODEL="${BATCH_MODELS[$i]}"
      TASK_TURNS="${BATCH_MAX_TURNS[$i]}"
      LOG_FILE="$LOG_PATH/run_${ITERATION}_${TASK_ID}_${TIMESTAMP}.log"
      AGENT_PROMPT=$(build_prompt "$TASK_ID")

      echo "Task:   $TASK_ID (model=${TASK_MODEL:-default}, turns=${TASK_TURNS:-unlimited})"
      echo "Log:    $LOG_FILE"
      echo "------------------------------------------------------------"

      run_agent 1 "$LOG_FILE" "$AGENT_PROMPT" "$TASK_MODEL" "$TASK_TURNS"
      EXIT_CODE=$?

      # ── Validate result ──
      TASK_VALID=true

      # Basic validation
      if [[ "$EXIT_CODE" -eq 0 ]]; then
        if ! validate_output "$LOG_FILE"; then
          echo "  Warning: exit 0 but validation failed: $FAILURE_REASON"
          EXIT_CODE=2
          TASK_VALID=false
        fi
      else
        TASK_VALID=false
        FAILURE_REASON="exit code $EXIT_CODE"
      fi

      # Orchestrator validation
      if [[ "$ORCHESTRATOR_ENABLED" == "true" ]]; then
        VAL_RESULT=$(run_orchestrator_validate "$TASK_ID" "$LOG_FILE" "$EXIT_CODE")
        VAL_EXIT=$?
        if [[ "$VAL_EXIT" -eq 0 && -n "$VAL_RESULT" ]]; then
          IFS='|' read -r val_status val_reason val_retry val_skip val_suggestion <<< "$VAL_RESULT"
          echo "  Validator: $val_status — $val_reason"
          if [[ -n "$val_suggestion" && "$val_suggestion" != "" ]]; then
            echo "  Suggestion: $val_suggestion"
          fi

          if [[ "$val_status" == "failed" || "$val_status" == "partial" ]]; then
            TASK_VALID=false
            FAILURE_REASON="${val_reason}"
            if [[ "$val_skip" == "True" || "$val_skip" == "true" ]]; then
              skip_task "$TASK_ID" "orchestrator: $val_reason"
            fi
          elif [[ "$val_status" == "success" && "$TASK_VALID" == "false" ]]; then
            echo "  Orchestrator confirmed success (overriding basic check)"
            TASK_VALID=true
            EXIT_CODE=0
          fi
        fi
      fi

      # Record failure or success
      if [[ "$TASK_VALID" == "false" ]]; then
        ITERATION_HAS_FAILURE=true
        FAIL_COUNT=$(record_task_failure "$TASK_ID" "${FAILURE_REASON:-unknown}")
        echo "  FAILED: $TASK_ID — failure #$FAIL_COUNT/$MAX_TASK_FAILURES — $FAILURE_REASON"

        if [[ "$FAIL_COUNT" -ge "$MAX_TASK_FAILURES" ]] && ! is_task_skipped "$TASK_ID"; then
          skip_task "$TASK_ID" "$FAILURE_REASON ($FAIL_COUNT failures)"
        fi
      else
        ITERATION_HAS_SUCCESS=true
        echo "  SUCCESS: $TASK_ID completed."
      fi

      echo ""
    done

  else
    # ── Parallel mode ───────────────────────────────────────────────
    echo "Distributing $ACTUAL_COUNT task(s) across up to $BATCH_PARALLEL agent(s)..."
    echo ""

    PIDS=()
    LOG_FILES=()
    AGENT_TASKS=()
    AGENT_IDX=1

    for i in "${!BATCH_TASK_IDS[@]}"; do
      if [[ "$AGENT_IDX" -gt "$BATCH_PARALLEL" ]]; then
        break
      fi

      TASK_ID="${BATCH_TASK_IDS[$i]}"
      TASK_MODEL="${BATCH_MODELS[$i]}"
      TASK_TURNS="${BATCH_MAX_TURNS[$i]}"
      LOG_FILE="$LOG_PATH/run_${ITERATION}_agent${AGENT_IDX}_${TASK_ID}_${TIMESTAMP}.log"
      AGENT_PROMPT=$(build_prompt "$TASK_ID")

      LOG_FILES+=("$LOG_FILE")
      AGENT_TASKS+=("$TASK_ID")

      echo "  Agent #$AGENT_IDX -> $TASK_ID (model=${TASK_MODEL:-default}, turns=${TASK_TURNS:-unlimited})"

      run_agent "$AGENT_IDX" "$LOG_FILE" "$AGENT_PROMPT" "$TASK_MODEL" "$TASK_TURNS" &
      PIDS+=($!)

      AGENT_IDX=$((AGENT_IDX + 1))
    done

    echo ""
    echo "------------------------------------------------------------"
    echo "  Waiting for all agents to finish..."

    # Wait for all agents and validate results
    for i in "${!PIDS[@]}"; do
      agent_exit=0
      wait "${PIDS[$i]}" || agent_exit=$?
      echo "  Agent #$((i + 1)) finished — ${AGENT_TASKS[$i]} (PID ${PIDS[$i]}, exit $agent_exit)"

      # Basic validation
      TASK_VALID=true
      if [[ "$agent_exit" -eq 0 ]]; then
        if ! validate_output "${LOG_FILES[$i]}"; then
          echo "    Warning: ${AGENT_TASKS[$i]}: $FAILURE_REASON"
          agent_exit=2
          TASK_VALID=false
        fi
      else
        TASK_VALID=false
        FAILURE_REASON="exit code $agent_exit"
      fi

      # Orchestrator validation
      if [[ "$ORCHESTRATOR_ENABLED" == "true" ]]; then
        VAL_RESULT=$(run_orchestrator_validate "${AGENT_TASKS[$i]}" "${LOG_FILES[$i]}" "$agent_exit")
        VAL_EXIT=$?
        if [[ "$VAL_EXIT" -eq 0 && -n "$VAL_RESULT" ]]; then
          IFS='|' read -r val_status val_reason val_retry val_skip val_suggestion <<< "$VAL_RESULT"
          echo "    Validator (${AGENT_TASKS[$i]}): $val_status — $val_reason"

          if [[ "$val_status" == "failed" || "$val_status" == "partial" ]]; then
            TASK_VALID=false
            FAILURE_REASON="${val_reason}"
            if [[ "$val_skip" == "True" || "$val_skip" == "true" ]]; then
              skip_task "${AGENT_TASKS[$i]}" "orchestrator: $val_reason"
            fi
          elif [[ "$val_status" == "success" && "$TASK_VALID" == "false" ]]; then
            echo "    Orchestrator confirmed success for ${AGENT_TASKS[$i]}"
            TASK_VALID=true
          fi
        fi
      fi

      # Record result
      if [[ "$TASK_VALID" == "false" ]]; then
        ITERATION_HAS_FAILURE=true
        FAIL_COUNT=$(record_task_failure "${AGENT_TASKS[$i]}" "${FAILURE_REASON:-unknown}")
        echo "    FAILED: ${AGENT_TASKS[$i]} — failure #$FAIL_COUNT/$MAX_TASK_FAILURES — $FAILURE_REASON"

        if [[ "$FAIL_COUNT" -ge "$MAX_TASK_FAILURES" ]] && ! is_task_skipped "${AGENT_TASKS[$i]}"; then
          skip_task "${AGENT_TASKS[$i]}" "$FAILURE_REASON ($FAIL_COUNT failures)"
        fi
      else
        ITERATION_HAS_SUCCESS=true
        echo "    SUCCESS: ${AGENT_TASKS[$i]} completed."
      fi
    done
  fi

  echo ""
  echo "------------------------------------------------------------"

  # Determine overall iteration result
  if [[ "$ITERATION_HAS_FAILURE" == "true" && "$ITERATION_HAS_SUCCESS" == "false" ]]; then
    EXIT_CODE=1
    echo "Iteration #$ITERATION: all tasks failed."
  elif [[ "$ITERATION_HAS_FAILURE" == "true" ]]; then
    EXIT_CODE=0  # Partial success — at least one task completed
    echo "Iteration #$ITERATION: partial success (some tasks failed)."
  else
    EXIT_CODE=0
    echo "Iteration #$ITERATION: all tasks succeeded."
  fi

  # ── Step 5: Track consecutive failures ───────────────────────────
  # Key: ANY success (even partial) resets the counter.
  # Only pure all-fail iterations count toward the consecutive limit.
  if [[ "$ITERATION_HAS_SUCCESS" == "true" ]]; then
    CONSECUTIVE_FAILURES=0
  elif [ "$EXIT_CODE" -ne 0 ]; then
    CONSECUTIVE_FAILURES=$((CONSECUTIVE_FAILURES + 1))
    echo "WARNING: All tasks failed. Consecutive all-fail iterations: $CONSECUTIVE_FAILURES/$MAX_CONSECUTIVE_FAILURES."

    if [ "$CONSECUTIVE_FAILURES" -ge "$MAX_CONSECUTIVE_FAILURES" ]; then
      # Check if there are still unskipped pending tasks
      REMAINING=$(get_pending_tasks "$TASKS_PATH" "$PHASE_FILTER" 1)
      if [ -z "$REMAINING" ]; then
        write_state "completed"
        echo "All remaining tasks have been skipped. Exiting."
        exit 0
      fi

      write_state "failed"
      echo "ERROR: $MAX_CONSECUTIVE_FAILURES consecutive all-fail iterations. Stopping."
      echo "Check log files in: $LOG_PATH"
      if [[ -f "$SKIPPED_FILE" && -s "$SKIPPED_FILE" ]]; then
        echo ""
        echo "Skipped tasks:"
        while IFS='|' read -r tid ts reason; do
          echo "  - $tid: $reason"
        done < "$SKIPPED_FILE"
      fi
      exit 1
    fi

    echo "Retrying in ${SLEEP_ON_RETRY}s... (Ctrl+C to stop)"
    sleep "$SLEEP_ON_RETRY"
    continue
  fi

  # ── Step 6: Check if all tasks are now complete ──────────────────
  REMAINING=$(get_pending_tasks "$TASKS_PATH" "$PHASE_FILTER" 1)
  if [ -z "$REMAINING" ]; then
    write_state "completed"
    echo "DONE" > "$POINTER_PATH"
    echo ""
    echo "All tasks complete after iteration #$ITERATION."
    if [[ -f "$SKIPPED_FILE" && -s "$SKIPPED_FILE" ]]; then
      echo ""
      echo "Note: Some tasks were skipped:"
      while IFS='|' read -r tid ts reason; do
        echo "  - $tid: $reason"
      done < "$SKIPPED_FILE"
    fi
    exit 0
  fi

  echo "Next iteration in ${SLEEP_BETWEEN}s... (Ctrl+C to stop)"
  sleep "$SLEEP_BETWEEN"
done
