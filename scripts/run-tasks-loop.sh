#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────
# run-tasks-loop.sh
# Simple task runner — picks the next pending task, implements it,
# commits, and moves on. Stops when all tasks are done or on Ctrl+C.
#
# Inspired by Marketplace-backend-services/scripts/run-tasks-loop.sh
#
# Usage:
#   ./scripts/run-tasks-loop.sh                    # Run all pending tasks
#   ./scripts/run-tasks-loop.sh --caffeinate       # Prevent sleep (macOS)
# ─────────────────────────────────────────────────────────────────

set -uo pipefail

# ── Caffeinate (must be first arg) ─────────────────────────────
if [[ "${1:-}" == "--caffeinate" ]]; then
  shift
  exec caffeinate -s "$0" "$@"
fi

# ── Find Claude CLI ────────────────────────────────────────────
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
  exit 1
fi

# ── Config ─────────────────────────────────────────────────────
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

POINTER_FILE="$PROJECT_DIR/docs/audit/.current_task"
PROMPT_FILE="$SCRIPT_DIR/prompts/execute-task.md"
LOG_DIR="$PROJECT_DIR/logs/task-runs"
TASKS_FILE="docs/audit/TASKS.md"

MAX_CONSECUTIVE_FAILURES=3
CONSECUTIVE_FAILURES=0

mkdir -p "$LOG_DIR"

# ── Extract prompt ─────────────────────────────────────────────
PROMPT=$(sed -n '/^````$/,/^````$/{ /^````$/d; p; }' "$PROMPT_FILE")
if [[ -z "$PROMPT" ]]; then
  PROMPT=$(sed -n '/^~~~$/,/^~~~$/{ /^~~~$/d; p; }' "$PROMPT_FILE")
fi

if [[ -z "$PROMPT" ]]; then
  echo "ERROR: Could not extract prompt from $PROMPT_FILE"
  exit 1
fi

# Inject file paths into the prompt
PROMPT=$(echo "$PROMPT" | sed "s|{{TASKS_FILE}}|docs/audit/TASKS.md|g")
PROMPT=$(echo "$PROMPT" | sed "s|{{FINDINGS_FILE}}|docs/audit/FINDINGS.md|g")
PROMPT=$(echo "$PROMPT" | sed "s|{{HEALTH_FILE}}|docs/audit/HEALTH.md|g")
PROMPT=$(echo "$PROMPT" | sed "s|{{POINTER_FILE}}|docs/audit/.current_task|g")
PROMPT=$(echo "$PROMPT" | sed "s|{{TASK_ID}}|none|g")
PROMPT=$(echo "$PROMPT" | sed "s|{{PHASE}}|none|g")

# ── Iteration counter ─────────────────────────────────────────
COUNTER_FILE="$LOG_DIR/.iteration_counter"
if [ -f "$COUNTER_FILE" ]; then
  ITERATION=$(cat "$COUNTER_FILE")
else
  ITERATION=0
fi

# ── Main loop ──────────────────────────────────────────────────

echo ""
echo "════════════════════════════════════════════════════════════"
echo "  Simple Task Runner"
echo "════════════════════════════════════════════════════════════"
echo "  Project:  $PROJECT_DIR"
echo "  Tasks:    $TASKS_FILE"
echo "  Logs:     $LOG_DIR"
echo "════════════════════════════════════════════════════════════"
echo ""

while true; do
  ITERATION=$((ITERATION + 1))
  echo "$ITERATION" > "$COUNTER_FILE"
  TIMESTAMP=$(date '+%Y%m%d_%H%M%S')
  LOG_FILE="$LOG_DIR/run_${ITERATION}_${TIMESTAMP}.log"

  echo "═══════════════════════════════════════════════════════════"
  echo "  Iteration #$ITERATION — $(date)"
  echo "═══════════════════════════════════════════════════════════"

  # Check if all tasks are done
  if [ -f "$POINTER_FILE" ]; then
    POINTER_CONTENT=$(cat "$POINTER_FILE")
    if echo "$POINTER_CONTENT" | grep -qi "^DONE$"; then
      echo "All tasks are complete. Exiting loop."
      exit 0
    fi
    echo "  Next task: $POINTER_CONTENT"
  else
    echo "  No pointer file — agent will scan task list."
  fi

  # Double-check: any pending tasks left?
  PENDING=$(grep -i 'Pending' "$PROJECT_DIR/$TASKS_FILE" | grep -v '^>' | grep -c 'OB-' || echo "0")
  if [ "$PENDING" -eq 0 ]; then
    echo "DONE" > "$POINTER_FILE"
    echo "No pending tasks found. All done."
    exit 0
  fi
  echo "  Pending tasks: $PENDING"

  echo ""
  echo "  Launching agent..."
  echo "  Log: $LOG_FILE"
  echo "───────────────────────────────────────────────────────────"

  # Run the agent — simple, no frills
  cd "$PROJECT_DIR"
  claude --print \
    --model sonnet \
    --max-budget-usd 5 \
    --allowedTools "Read Edit Write Glob Grep" \
    --allowedTools "Bash(git:*)" \
    --allowedTools "Bash(npm:*)" \
    --allowedTools "Bash(npx:*)" \
    -p "$PROMPT" \
    2>&1 | tee "$LOG_FILE"

  EXIT_CODE=${PIPESTATUS[0]}

  echo ""
  echo "───────────────────────────────────────────────────────────"
  echo "  Agent exited with code: $EXIT_CODE"

  # Simple failure tracking — retry same task, bail after N failures
  if [ "$EXIT_CODE" -ne 0 ]; then
    CONSECUTIVE_FAILURES=$((CONSECUTIVE_FAILURES + 1))
    echo "  WARNING: Failed (exit $EXIT_CODE). Retry $CONSECUTIVE_FAILURES/$MAX_CONSECUTIVE_FAILURES."

    if [ ! -s "$LOG_FILE" ]; then
      echo "  WARNING: Agent produced no output — possible crash or timeout."
    fi

    if [ "$CONSECUTIVE_FAILURES" -ge "$MAX_CONSECUTIVE_FAILURES" ]; then
      echo "  ERROR: $MAX_CONSECUTIVE_FAILURES consecutive failures. Stopping."
      echo "  Check logs in: $LOG_DIR"
      exit 1
    fi

    echo "  Retrying in 10s... (Ctrl+C to stop)"
    sleep 10
    continue
  else
    CONSECUTIVE_FAILURES=0
  fi

  # Check if done after the run
  if [ -f "$POINTER_FILE" ]; then
    POINTER_CONTENT=$(cat "$POINTER_FILE")
    if echo "$POINTER_CONTENT" | grep -qi "^DONE$"; then
      echo "All tasks complete after iteration #$ITERATION."
      exit 0
    fi
  fi

  echo "  Next iteration in 5s... (Ctrl+C to stop)"
  sleep 5
done
