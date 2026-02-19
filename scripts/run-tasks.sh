#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────
# run-tasks.sh
# Repeatedly launches a fresh Claude Code agent to execute the
# next pending task from docs/audit/TASKS.md.
# Stops when all tasks are complete or on manual interrupt (Ctrl+C).
#
# Usage:
#   ./scripts/run-tasks.sh              # Run all pending tasks
#   ./scripts/run-tasks.sh --phase 1    # Run only Phase 1 tasks
#   ./scripts/run-tasks.sh --help       # Show usage
# ─────────────────────────────────────────────────────────────────

set -uo pipefail

# ── Config ──────────────────────────────────────────────────────

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
POINTER_FILE="$PROJECT_DIR/docs/audit/.current_task"
PROMPT_FILE="$SCRIPT_DIR/prompts/execute-task.md"
LOG_DIR="$PROJECT_DIR/logs/task-runs"
COUNTER_FILE="$LOG_DIR/.iteration_counter"

MAX_BUDGET_USD=5
MAX_CONSECUTIVE_FAILURES=3
SLEEP_BETWEEN=5
SLEEP_ON_RETRY=10
PHASE_FILTER="none"

# ── Usage ───────────────────────────────────────────────────────

usage() {
  cat <<EOF
Usage: $(basename "$0") [OPTIONS]

Runs Claude Code in a loop to execute pending audit tasks.

Options:
  --phase N    Only execute tasks from Phase N (1-4)
  --budget N   Max USD budget per iteration (default: $MAX_BUDGET_USD)
  --retries N  Max consecutive failures before stopping (default: $MAX_CONSECUTIVE_FAILURES)
  --help       Show this message

Examples:
  ./scripts/run-tasks.sh                # Run all pending tasks
  ./scripts/run-tasks.sh --phase 1      # Run Phase 1 only
  ./scripts/run-tasks.sh --budget 10    # Higher budget per task
EOF
  exit 0
}

# ── Parse Args ──────────────────────────────────────────────────

while [[ $# -gt 0 ]]; do
  case "$1" in
    --phase)   PHASE_FILTER="$2"; shift 2 ;;
    --budget)  MAX_BUDGET_USD="$2"; shift 2 ;;
    --retries) MAX_CONSECUTIVE_FAILURES="$2"; shift 2 ;;
    --help)    usage ;;
    *)         echo "Unknown option: $1"; usage ;;
  esac
done

# ── Find Claude CLI ─────────────────────────────────────────────

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

# ── Validate ────────────────────────────────────────────────────

if [ ! -f "$PROMPT_FILE" ]; then
  echo "ERROR: Prompt file not found: $PROMPT_FILE"
  exit 1
fi

# ── Setup ───────────────────────────────────────────────────────

mkdir -p "$LOG_DIR"

# Extract prompt content between ```` fences
PROMPT_TEMPLATE=$(sed -n '/^````$/,/^````$/{ /^````$/d; p; }' "$PROMPT_FILE")

# Inject phase filter
PROMPT_TEMPLATE="${PROMPT_TEMPLATE//\{\{PHASE\}\}/$PHASE_FILTER}"
# No task override in loop mode
PROMPT_TEMPLATE="${PROMPT_TEMPLATE//\{\{TASK_ID\}\}/none}"

# Persistent iteration counter
if [ -f "$COUNTER_FILE" ]; then
  ITERATION=$(cat "$COUNTER_FILE")
else
  ITERATION=0
fi

CONSECUTIVE_FAILURES=0

# ── Main Loop ───────────────────────────────────────────────────

echo ""
echo "╔═══════════════════════════════════════════════════════════╗"
echo "║          OpenBridge — Automated Task Runner              ║"
echo "╠═══════════════════════════════════════════════════════════╣"
echo "║  Project:  $PROJECT_DIR"
echo "║  Phase:    ${PHASE_FILTER:-all}"
echo "║  Budget:   \$$MAX_BUDGET_USD per iteration"
echo "║  Retries:  $MAX_CONSECUTIVE_FAILURES max consecutive"
echo "╚═══════════════════════════════════════════════════════════╝"
echo ""

while true; do
  ITERATION=$((ITERATION + 1))
  echo "$ITERATION" > "$COUNTER_FILE"
  TIMESTAMP=$(date '+%Y%m%d_%H%M%S')
  LOG_FILE="$LOG_DIR/run_${ITERATION}_${TIMESTAMP}.log"

  echo "═══════════════════════════════════════════════════════════"
  echo "  Iteration #$ITERATION — $(date)"
  echo "═══════════════════════════════════════════════════════════"

  # Check pointer file before launching
  if [ -f "$POINTER_FILE" ]; then
    POINTER_CONTENT=$(cat "$POINTER_FILE")
    if echo "$POINTER_CONTENT" | grep -qi "^DONE$"; then
      echo "All tasks are complete. Exiting loop."
      exit 0
    fi
    echo "Next task: $POINTER_CONTENT"
  else
    echo "No .current_task file — agent will scan TASKS.md."
  fi

  echo "Log: $LOG_FILE"
  echo "───────────────────────────────────────────────────────────"

  # Run Claude Code
  cd "$PROJECT_DIR" && \
  claude --print --max-budget-usd "$MAX_BUDGET_USD" \
    --allowedTools "Read Edit Write Glob Grep" \
    --allowedTools "Bash(git:*)" \
    --allowedTools "Bash(npm:*)" \
    --allowedTools "Bash(npx:*)" \
    -p "$PROMPT_TEMPLATE" \
    2>&1 | tee "$LOG_FILE"

  EXIT_CODE=${PIPESTATUS[0]}

  echo ""
  echo "───────────────────────────────────────────────────────────"
  echo "Agent exited with code: $EXIT_CODE"

  # Track consecutive failures
  if [ "$EXIT_CODE" -ne 0 ]; then
    CONSECUTIVE_FAILURES=$((CONSECUTIVE_FAILURES + 1))
    echo "WARNING: Iteration failed (exit code $EXIT_CODE). Retry $CONSECUTIVE_FAILURES/$MAX_CONSECUTIVE_FAILURES."

    if [ ! -s "$LOG_FILE" ]; then
      echo "WARNING: Agent produced no output — possible crash or timeout."
    fi

    if [ "$CONSECUTIVE_FAILURES" -ge "$MAX_CONSECUTIVE_FAILURES" ]; then
      echo "ERROR: $MAX_CONSECUTIVE_FAILURES consecutive failures. Stopping."
      echo "Check the last log files in: $LOG_DIR"
      exit 1
    fi

    echo "Retrying in ${SLEEP_ON_RETRY}s... (Ctrl+C to stop)"
    sleep "$SLEEP_ON_RETRY"
    continue
  else
    CONSECUTIVE_FAILURES=0
  fi

  # Check pointer after the run
  if [ -f "$POINTER_FILE" ]; then
    POINTER_CONTENT=$(cat "$POINTER_FILE")
    if echo "$POINTER_CONTENT" | grep -qi "^DONE$"; then
      echo ""
      echo "All tasks complete after iteration #$ITERATION. Exiting."
      exit 0
    fi
  fi

  echo "Next iteration in ${SLEEP_BETWEEN}s... (Ctrl+C to stop)"
  sleep "$SLEEP_BETWEEN"
done
