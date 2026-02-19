#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────
# run-tasks.sh
# Repeatedly launches Claude Code agents to execute pending tasks
# from a configurable task list. Generic enough to use in any project.
#
# Usage:
#   ./scripts/run-tasks.sh                          # Run all pending tasks
#   ./scripts/run-tasks.sh --phase 1                # Phase 1 only
#   ./scripts/run-tasks.sh --parallel 3             # 3 agents in parallel
#   ./scripts/run-tasks.sh --model opus             # Use a specific model
#   ./scripts/run-tasks.sh --tasks path/TASKS.md    # Custom task file
#   ./scripts/run-tasks.sh --help                   # Show all options
# ─────────────────────────────────────────────────────────────────

set -uo pipefail

# ── Defaults ─────────────────────────────────────────────────────

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

# Paths (all configurable)
TASKS_FILE="docs/audit/TASKS.md"
FINDINGS_FILE="docs/audit/FINDINGS.md"
HEALTH_FILE="docs/audit/HEALTH.md"
POINTER_FILE="docs/audit/.current_task"
PROMPT_FILE="$SCRIPT_DIR/prompts/execute-task.md"
LOG_DIR="logs/task-runs"

# Execution
MODEL=""                          # Empty = use default model
PARALLEL=1                        # Number of concurrent agents
MAX_TURNS=""                      # Empty = unlimited turns per iteration
MAX_CONSECUTIVE_FAILURES=3        # Stop after N consecutive failures
SLEEP_BETWEEN=5                   # Seconds between iterations
SLEEP_ON_RETRY=10                 # Seconds before retrying a failed task
PHASE_FILTER="none"               # "none" = all phases

# Tool permissions
ALLOWED_TOOLS=(
  "Read Edit Write Glob Grep"
  "Bash(git:*)"
  "Bash(npm:*)"
  "Bash(npx:*)"
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
  --model MODEL       Claude model to use (e.g., opus, sonnet, haiku)
  --parallel N        Number of concurrent agents (default: $PARALLEL)
  --max-turns N       Max turns per agent iteration (default: unlimited)
  --retries N         Max consecutive failures before stopping (default: $MAX_CONSECUTIVE_FAILURES)
  --sleep N           Seconds between iterations (default: $SLEEP_BETWEEN)
  --sleep-retry N     Seconds before retrying a failed task (default: $SLEEP_ON_RETRY)

Other:
  --help              Show this message

Examples:
  ./scripts/run-tasks.sh                                    # Run all pending
  ./scripts/run-tasks.sh --phase 1 --model sonnet           # Phase 1, Sonnet model
  ./scripts/run-tasks.sh --parallel 3 --phase 2             # 3 agents on Phase 2
  ./scripts/run-tasks.sh --tasks my-project/TASKS.md        # Custom task file
EOF
  exit 0
}

# ── Parse Args ───────────────────────────────────────────────────

while [[ $# -gt 0 ]]; do
  case "$1" in
    --tasks)        TASKS_FILE="$2"; shift 2 ;;
    --findings)     FINDINGS_FILE="$2"; shift 2 ;;
    --health)       HEALTH_FILE="$2"; shift 2 ;;
    --pointer)      POINTER_FILE="$2"; shift 2 ;;
    --prompt)       PROMPT_FILE="$2"; shift 2 ;;
    --log-dir)      LOG_DIR="$2"; shift 2 ;;
    --project)      PROJECT_DIR="$2"; shift 2 ;;
    --phase)        PHASE_FILTER="$2"; shift 2 ;;
    --model)        MODEL="$2"; shift 2 ;;
    --parallel)     PARALLEL="$2"; shift 2 ;;
    --max-turns)    MAX_TURNS="$2"; shift 2 ;;
    --retries)      MAX_CONSECUTIVE_FAILURES="$2"; shift 2 ;;
    --sleep)        SLEEP_BETWEEN="$2"; shift 2 ;;
    --sleep-retry)  SLEEP_ON_RETRY="$2"; shift 2 ;;
    --help)         usage ;;
    *)              echo "Unknown option: $1"; echo ""; usage ;;
  esac
done

# Resolve relative paths against project root
TASKS_PATH="$PROJECT_DIR/$TASKS_FILE"
FINDINGS_PATH="$PROJECT_DIR/$FINDINGS_FILE"
HEALTH_PATH="$PROJECT_DIR/$HEALTH_FILE"
POINTER_PATH="$PROJECT_DIR/$POINTER_FILE"
LOG_PATH="$PROJECT_DIR/$LOG_DIR"
COUNTER_FILE="$LOG_PATH/.iteration_counter"

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

# ── Setup ────────────────────────────────────────────────────────

mkdir -p "$LOG_PATH"

# Extract prompt content between ```` fences
PROMPT_TEMPLATE=$(sed -n '/^````$/,/^````$/{ /^````$/d; p; }' "$PROMPT_FILE")

# Inject configuration into prompt
PROMPT_TEMPLATE="${PROMPT_TEMPLATE//\{\{PHASE\}\}/$PHASE_FILTER}"
PROMPT_TEMPLATE="${PROMPT_TEMPLATE//\{\{TASK_ID\}\}/none}"
PROMPT_TEMPLATE="${PROMPT_TEMPLATE//\{\{TASKS_FILE\}\}/$TASKS_FILE}"
PROMPT_TEMPLATE="${PROMPT_TEMPLATE//\{\{FINDINGS_FILE\}\}/$FINDINGS_FILE}"
PROMPT_TEMPLATE="${PROMPT_TEMPLATE//\{\{HEALTH_FILE\}\}/$HEALTH_FILE}"
PROMPT_TEMPLATE="${PROMPT_TEMPLATE//\{\{POINTER_FILE\}\}/$POINTER_FILE}"

# Build claude command flags
CLAUDE_FLAGS=(--print)
if [[ -n "$MODEL" ]]; then
  CLAUDE_FLAGS+=(--model "$MODEL")
fi
if [[ -n "$MAX_TURNS" ]]; then
  CLAUDE_FLAGS+=(--max-turns "$MAX_TURNS")
fi
for tool in "${ALLOWED_TOOLS[@]}"; do
  CLAUDE_FLAGS+=(--allowedTools "$tool")
done

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
  "consecutive_failures": $CONSECUTIVE_FAILURES,
  "project": "$PROJECT_DIR",
  "tasks_file": "$TASKS_FILE",
  "pid": $$
}
STATEEOF
}

RUN_STARTED_AT="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
write_state "running"

# Clean up state on exit
trap 'write_state "stopped"; echo ""; echo "Task runner stopped."' EXIT

# ── Run Single Agent ─────────────────────────────────────────────

run_agent() {
  local agent_id="$1"
  local log_file="$2"

  cd "$PROJECT_DIR" && \
  claude "${CLAUDE_FLAGS[@]}" \
    -p "$PROMPT_TEMPLATE" \
    2>&1 | tee "$log_file"

  return ${PIPESTATUS[0]}
}

# ── Banner ───────────────────────────────────────────────────────

echo ""
echo "╔═════════════════════════════════════════════════════════════╗"
echo "║            Automated Task Runner                           ║"
echo "╠═════════════════════════════════════════════════════════════╣"
echo "║  Project:   $PROJECT_DIR"
echo "║  Tasks:     $TASKS_FILE"
echo "║  Phase:     ${PHASE_FILTER}"
echo "║  Model:     ${MODEL:-default}"
echo "║  Parallel:  $PARALLEL agent(s)"
echo "║  Max turns: ${MAX_TURNS:-unlimited}"
echo "║  Retries:   $MAX_CONSECUTIVE_FAILURES max consecutive"
echo "╚═════════════════════════════════════════════════════════════╝"
echo ""

# ── Main Loop ────────────────────────────────────────────────────

while true; do
  ITERATION=$((ITERATION + 1))
  echo "$ITERATION" > "$COUNTER_FILE"
  write_state "running"
  TIMESTAMP=$(date '+%Y%m%d_%H%M%S')

  echo "═══════════════════════════════════════════════════════════"
  echo "  Iteration #$ITERATION — $(date)"
  echo "═══════════════════════════════════════════════════════════"

  # Check pointer file before launching
  if [ -f "$POINTER_PATH" ]; then
    POINTER_CONTENT=$(cat "$POINTER_PATH")
    if echo "$POINTER_CONTENT" | grep -qi "^DONE$"; then
      write_state "completed"
      echo "All tasks are complete. Exiting loop."
      exit 0
    fi
    echo "Next task: $POINTER_CONTENT"
  else
    echo "No pointer file — agent will scan $TASKS_FILE."
  fi

  if [ "$PARALLEL" -eq 1 ]; then
    # ── Sequential mode ──────────────────────────────────────────
    LOG_FILE="$LOG_PATH/run_${ITERATION}_${TIMESTAMP}.log"
    echo "Log: $LOG_FILE"
    echo "───────────────────────────────────────────────────────────"

    run_agent 1 "$LOG_FILE"
    EXIT_CODE=$?

  else
    # ── Parallel mode ────────────────────────────────────────────
    echo "Launching $PARALLEL agents in parallel..."
    echo "───────────────────────────────────────────────────────────"

    PIDS=()
    LOG_FILES=()
    for i in $(seq 1 "$PARALLEL"); do
      LOG_FILE="$LOG_PATH/run_${ITERATION}_agent${i}_${TIMESTAMP}.log"
      LOG_FILES+=("$LOG_FILE")
      echo "  Agent #$i → $LOG_FILE"

      run_agent "$i" "$LOG_FILE" &
      PIDS+=($!)
    done

    # Wait for all agents and collect exit codes
    EXIT_CODE=0
    for i in "${!PIDS[@]}"; do
      wait "${PIDS[$i]}" || EXIT_CODE=1
      echo "  Agent #$((i + 1)) finished (PID ${PIDS[$i]})"
    done
  fi

  echo ""
  echo "───────────────────────────────────────────────────────────"
  echo "Iteration #$ITERATION exited with code: $EXIT_CODE"

  # Track consecutive failures
  if [ "$EXIT_CODE" -ne 0 ]; then
    CONSECUTIVE_FAILURES=$((CONSECUTIVE_FAILURES + 1))
    echo "WARNING: Iteration failed. Retry $CONSECUTIVE_FAILURES/$MAX_CONSECUTIVE_FAILURES."

    if [ "$CONSECUTIVE_FAILURES" -ge "$MAX_CONSECUTIVE_FAILURES" ]; then
      write_state "failed"
      echo "ERROR: $MAX_CONSECUTIVE_FAILURES consecutive failures. Stopping."
      echo "Check log files in: $LOG_PATH"
      exit 1
    fi

    echo "Retrying in ${SLEEP_ON_RETRY}s... (Ctrl+C to stop)"
    sleep "$SLEEP_ON_RETRY"
    continue
  else
    CONSECUTIVE_FAILURES=0
  fi

  # Check pointer after the run
  if [ -f "$POINTER_PATH" ]; then
    POINTER_CONTENT=$(cat "$POINTER_PATH")
    if echo "$POINTER_CONTENT" | grep -qi "^DONE$"; then
      echo ""
      echo "All tasks complete after iteration #$ITERATION."
      exit 0
    fi
  fi

  echo "Next iteration in ${SLEEP_BETWEEN}s... (Ctrl+C to stop)"
  sleep "$SLEEP_BETWEEN"
done
