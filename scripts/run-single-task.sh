#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────
# run-single-task.sh
# Launches a single Claude Code agent to execute a specific task.
#
# Usage:
#   ./scripts/run-single-task.sh OB-003
#   ./scripts/run-single-task.sh OB-003 --model sonnet
#   ./scripts/run-single-task.sh OB-003 --tasks my/TASKS.md
#   ./scripts/run-single-task.sh --help
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
MODEL=""
MAX_TURNS=""
TASK_ID=""

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
Usage: $(basename "$0") TASK_ID [OPTIONS]

Launches a single Claude Code agent to execute one specific task.

Arguments:
  TASK_ID             The task to execute (e.g., OB-003, OB-015)

Paths:
  --tasks FILE        Task list file, relative to project root (default: $TASKS_FILE)
  --findings FILE     Findings file (default: $FINDINGS_FILE)
  --health FILE       Health score file (default: $HEALTH_FILE)
  --pointer FILE      Pointer file (default: $POINTER_FILE)
  --prompt FILE       Prompt template (default: prompts/execute-task.md)
  --log-dir DIR       Log directory (default: $LOG_DIR)
  --project DIR       Project root directory (default: auto-detected)

Execution:
  --model MODEL       Claude model to use (e.g., opus, sonnet, haiku)
  --max-turns N       Max turns for the agent (default: unlimited)

Other:
  --help              Show this message

Examples:
  ./scripts/run-single-task.sh OB-003
  ./scripts/run-single-task.sh OB-003 --model sonnet
  ./scripts/run-single-task.sh OB-015 --tasks my-project/TASKS.md
EOF
  exit 0
}

# ── Parse Args ───────────────────────────────────────────────────

if [[ $# -eq 0 ]]; then
  echo "ERROR: Task ID required."
  echo ""
  usage
fi

while [[ $# -gt 0 ]]; do
  case "$1" in
    --tasks)      TASKS_FILE="$2"; shift 2 ;;
    --findings)   FINDINGS_FILE="$2"; shift 2 ;;
    --health)     HEALTH_FILE="$2"; shift 2 ;;
    --pointer)    POINTER_FILE="$2"; shift 2 ;;
    --prompt)     PROMPT_FILE="$2"; shift 2 ;;
    --log-dir)    LOG_DIR="$2"; shift 2 ;;
    --project)    PROJECT_DIR="$2"; shift 2 ;;
    --model)      MODEL="$2"; shift 2 ;;
    --max-turns)  MAX_TURNS="$2"; shift 2 ;;
    --help)       usage ;;
    -*)           echo "Unknown option: $1"; echo ""; usage ;;
    *)            TASK_ID="$1"; shift ;;
  esac
done

if [[ -z "$TASK_ID" ]]; then
  echo "ERROR: Task ID required (e.g., OB-003)."
  exit 1
fi

# Resolve relative paths
LOG_PATH="$PROJECT_DIR/$LOG_DIR"

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

# ── Setup ────────────────────────────────────────────────────────

mkdir -p "$LOG_PATH"

TIMESTAMP=$(date '+%Y%m%d_%H%M%S')
LOG_FILE="$LOG_PATH/single_${TASK_ID}_${TIMESTAMP}.log"

# Extract prompt content between ```` fences
PROMPT=$(sed -n '/^````$/,/^````$/{ /^````$/d; p; }' "$PROMPT_FILE")

# Inject configuration into prompt
PROMPT="${PROMPT//\{\{TASK_ID\}\}/$TASK_ID}"
PROMPT="${PROMPT//\{\{PHASE\}\}/none}"
PROMPT="${PROMPT//\{\{TASKS_FILE\}\}/$TASKS_FILE}"
PROMPT="${PROMPT//\{\{FINDINGS_FILE\}\}/$FINDINGS_FILE}"
PROMPT="${PROMPT//\{\{HEALTH_FILE\}\}/$HEALTH_FILE}"
PROMPT="${PROMPT//\{\{POINTER_FILE\}\}/$POINTER_FILE}"

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

# ── Execute ──────────────────────────────────────────────────────

echo ""
echo "╔═════════════════════════════════════════════════════════════╗"
echo "║            Single Task Runner                              ║"
echo "╠═════════════════════════════════════════════════════════════╣"
echo "║  Task:      $TASK_ID"
echo "║  Tasks:     $TASKS_FILE"
echo "║  Model:     ${MODEL:-default}"
echo "║  Max turns: ${MAX_TURNS:-unlimited}"
echo "║  Log:       $LOG_FILE"
echo "╚═════════════════════════════════════════════════════════════╝"
echo ""

cd "$PROJECT_DIR" && \
claude "${CLAUDE_FLAGS[@]}" \
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
