#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────
# run-single-task.sh
# Launches a single Claude Code agent to execute a specific task.
#
# Usage:
#   ./scripts/run-single-task.sh OB-003
#   ./scripts/run-single-task.sh OB-003 --budget 10
#   ./scripts/run-single-task.sh --help
# ─────────────────────────────────────────────────────────────────

set -uo pipefail

# ── Config ──────────────────────────────────────────────────────

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
PROMPT_FILE="$SCRIPT_DIR/prompts/execute-task.md"
LOG_DIR="$PROJECT_DIR/logs/task-runs"

MAX_BUDGET_USD=5
TASK_ID=""

# ── Usage ───────────────────────────────────────────────────────

usage() {
  cat <<EOF
Usage: $(basename "$0") TASK_ID [OPTIONS]

Runs Claude Code to execute a single audit task.

Arguments:
  TASK_ID      The task to execute (e.g., OB-003, OB-015)

Options:
  --budget N   Max USD budget (default: $MAX_BUDGET_USD)
  --help       Show this message

Examples:
  ./scripts/run-single-task.sh OB-003
  ./scripts/run-single-task.sh OB-015 --budget 10
EOF
  exit 0
}

# ── Parse Args ──────────────────────────────────────────────────

if [[ $# -eq 0 ]]; then
  echo "ERROR: Task ID required."
  echo ""
  usage
fi

while [[ $# -gt 0 ]]; do
  case "$1" in
    --budget)  MAX_BUDGET_USD="$2"; shift 2 ;;
    --help)    usage ;;
    OB-*)      TASK_ID="$1"; shift ;;
    *)         echo "Unknown option: $1"; usage ;;
  esac
done

if [[ -z "$TASK_ID" ]]; then
  echo "ERROR: Task ID required (e.g., OB-003)."
  exit 1
fi

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

TIMESTAMP=$(date '+%Y%m%d_%H%M%S')
LOG_FILE="$LOG_DIR/single_${TASK_ID}_${TIMESTAMP}.log"

# Extract prompt content between ```` fences
PROMPT=$(sed -n '/^````$/,/^````$/{ /^````$/d; p; }' "$PROMPT_FILE")

# Inject task override and no phase filter
PROMPT="${PROMPT//\{\{TASK_ID\}\}/$TASK_ID}"
PROMPT="${PROMPT//\{\{PHASE\}\}/none}"

# ── Execute ─────────────────────────────────────────────────────

echo ""
echo "╔═══════════════════════════════════════════════════════════╗"
echo "║        OpenBridge — Single Task Runner                   ║"
echo "╠═══════════════════════════════════════════════════════════╣"
echo "║  Task:    $TASK_ID"
echo "║  Budget:  \$$MAX_BUDGET_USD"
echo "║  Log:     $LOG_FILE"
echo "╚═══════════════════════════════════════════════════════════╝"
echo ""

cd "$PROJECT_DIR" && \
claude --print --max-budget-usd "$MAX_BUDGET_USD" \
  --allowedTools "Read Edit Write Glob Grep" \
  --allowedTools "Bash(git:*)" \
  --allowedTools "Bash(npm:*)" \
  --allowedTools "Bash(npx:*)" \
  -p "$PROMPT" \
  2>&1 | tee "$LOG_FILE"

EXIT_CODE=${PIPESTATUS[0]}

echo ""
echo "───────────────────────────────────────────────────────────"
if [ "$EXIT_CODE" -eq 0 ]; then
  echo "Task $TASK_ID completed successfully."
else
  echo "Task $TASK_ID failed (exit code: $EXIT_CODE)."
  echo "Check log: $LOG_FILE"
fi
echo "───────────────────────────────────────────────────────────"

exit "$EXIT_CODE"
