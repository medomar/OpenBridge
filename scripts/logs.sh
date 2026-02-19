#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────
# logs.sh
# View and tail task runner agent logs.
#
# Usage:
#   ./scripts/logs.sh                 # List all logs
#   ./scripts/logs.sh --tail          # Tail the latest log
#   ./scripts/logs.sh --tail 3        # Tail the 3 latest logs
#   ./scripts/logs.sh --tail-all      # Tail all logs from last run
#   ./scripts/logs.sh --view FILE     # View a specific log
#   ./scripts/logs.sh --grep "error"  # Search all logs
#   ./scripts/logs.sh --clean         # Delete all log files
# ─────────────────────────────────────────────────────────────────

set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
LOG_DIR="logs/task-runs"

ACTION="list"
TAIL_COUNT=1
SEARCH_PATTERN=""
VIEW_FILE=""

# ── Usage ────────────────────────────────────────────────────────

usage() {
  cat <<EOF
Usage: $(basename "$0") [OPTIONS]

View and manage task runner logs.

Actions:
  (default)           List all log files with sizes and status
  --tail [N]          Follow the N most recent logs in real-time (default: 1)
  --tail-all          Follow all logs from the most recent iteration
  --view FILE         View a specific log file (full name or partial match)
  --grep PATTERN      Search all logs for a pattern
  --summary           Show one-line summary per log (last line of each)
  --clean             Delete all log files (asks for confirmation)

Paths:
  --log-dir DIR       Log directory (default: $LOG_DIR)
  --project DIR       Project root (default: auto-detected)

Other:
  --help              Show this message

Examples:
  ./scripts/logs.sh                     # List all logs
  ./scripts/logs.sh --tail              # Follow latest log
  ./scripts/logs.sh --tail 5            # Follow 5 latest logs
  ./scripts/logs.sh --tail-all          # Follow all logs from last run
  ./scripts/logs.sh --grep "OB-003"     # Find OB-003 across all logs
  ./scripts/logs.sh --view agent2       # View log matching "agent2"
  ./scripts/logs.sh --summary           # One-line summary per log
EOF
  exit 0
}

# ── Parse Args ───────────────────────────────────────────────────

while [[ $# -gt 0 ]]; do
  case "$1" in
    --tail)
      ACTION="tail"; shift
      if [[ $# -gt 0 && "$1" =~ ^[0-9]+$ ]]; then
        TAIL_COUNT="$1"; shift
      fi
      ;;
    --tail-all)    ACTION="tail-all"; shift ;;
    --view)        ACTION="view"; VIEW_FILE="$2"; shift 2 ;;
    --grep)        ACTION="grep"; SEARCH_PATTERN="$2"; shift 2 ;;
    --summary)     ACTION="summary"; shift ;;
    --clean)       ACTION="clean"; shift ;;
    --log-dir)     LOG_DIR="$2"; shift 2 ;;
    --project)     PROJECT_DIR="$2"; shift 2 ;;
    --help)        usage ;;
    *)             echo "Unknown option: $1"; usage ;;
  esac
done

LOG_PATH="$PROJECT_DIR/$LOG_DIR"

if [[ ! -d "$LOG_PATH" ]]; then
  echo "No log directory found at: $LOG_PATH"
  exit 1
fi

# ── Actions ──────────────────────────────────────────────────────

case "$ACTION" in
  list)
    echo ""
    echo "── Log Files ──────────────────────────────────────────────"

    if [[ -f "$LOG_PATH/.iteration_counter" ]]; then
      echo "  Iterations completed: $(cat "$LOG_PATH/.iteration_counter")"
    fi
    echo ""

    local_logs=$(ls -t "$LOG_PATH"/*.log 2>/dev/null)
    if [[ -z "$local_logs" ]]; then
      echo "  No log files found."
      exit 0
    fi

    echo "  #   FILE                                        SIZE     MODIFIED"
    echo "  ──  ──────────────────────────────────────────  ──────   ────────────────────"

    idx=1
    echo "$local_logs" | while read -r log_file; do
      fname=$(basename "$log_file")
      size=$(wc -c < "$log_file" | tr -d ' ')
      modified=$(stat -f "%Sm" -t "%Y-%m-%d %H:%M" "$log_file" 2>/dev/null || stat -c "%y" "$log_file" 2>/dev/null | cut -d. -f1)

      if [[ "$size" -gt 1048576 ]]; then
        size_h="$(( size / 1048576 ))MB"
      elif [[ "$size" -gt 1024 ]]; then
        size_h="$(( size / 1024 ))KB"
      else
        size_h="${size}B"
      fi

      printf "  %-3d %-44s %6s   %s\n" "$idx" "$fname" "$size_h" "$modified"
      idx=$((idx + 1))
    done

    total=$(echo "$local_logs" | wc -l | tr -d ' ')
    echo ""
    echo "  Total: $total log files"
    echo ""
    echo "  Tip: Use --tail to follow the latest, --grep to search"
    ;;

  tail)
    files=$(ls -t "$LOG_PATH"/*.log 2>/dev/null | head -"$TAIL_COUNT")
    if [[ -z "$files" ]]; then
      echo "No log files found."
      exit 1
    fi

    echo "Following $TAIL_COUNT most recent log(s)... (Ctrl+C to stop)"
    echo ""
    # shellcheck disable=SC2086
    tail -f $files
    ;;

  tail-all)
    # Find all logs from the most recent iteration
    if [[ -f "$LOG_PATH/.iteration_counter" ]]; then
      latest_iter=$(cat "$LOG_PATH/.iteration_counter")
      files=$(ls "$LOG_PATH"/run_${latest_iter}_*.log 2>/dev/null)
      if [[ -z "$files" ]]; then
        echo "No logs found for iteration #$latest_iter."
        exit 1
      fi
      count=$(echo "$files" | wc -l | tr -d ' ')
      echo "Following $count log(s) from iteration #$latest_iter... (Ctrl+C to stop)"
      echo ""
      # shellcheck disable=SC2086
      tail -f $files
    else
      echo "No iteration counter found. Use --tail instead."
      exit 1
    fi
    ;;

  view)
    # Find matching log file
    match=$(ls -t "$LOG_PATH"/*.log 2>/dev/null | grep "$VIEW_FILE" | head -1)
    if [[ -z "$match" ]]; then
      echo "No log file matching '$VIEW_FILE' found."
      echo "Available logs:"
      ls -1t "$LOG_PATH"/*.log 2>/dev/null | while read -r f; do
        echo "  $(basename "$f")"
      done
      exit 1
    fi
    echo "── $(basename "$match") ──"
    echo ""
    cat "$match"
    ;;

  grep)
    echo "Searching for '$SEARCH_PATTERN' in all logs..."
    echo ""
    grep -rn --color=always "$SEARCH_PATTERN" "$LOG_PATH"/*.log 2>/dev/null || echo "No matches found."
    ;;

  summary)
    echo ""
    echo "── Log Summaries ──────────────────────────────────────────"
    echo ""

    ls -t "$LOG_PATH"/*.log 2>/dev/null | while read -r log_file; do
      fname=$(basename "$log_file")
      if [[ ! -s "$log_file" ]]; then
        echo "  $fname: (empty)"
      else
        last_line=$(tail -1 "$log_file" | head -c 100)
        echo "  $fname: $last_line"
      fi
    done
    ;;

  clean)
    count=$(ls "$LOG_PATH"/*.log 2>/dev/null | wc -l | tr -d ' ')
    if [[ "$count" -eq 0 ]]; then
      echo "No log files to clean."
      exit 0
    fi

    echo "This will delete $count log files and reset the iteration counter."
    read -r -p "Are you sure? [y/N] " confirm
    if [[ "$confirm" =~ ^[yY]$ ]]; then
      rm -f "$LOG_PATH"/*.log "$LOG_PATH"/.iteration_counter "$LOG_PATH"/.run_state.json
      echo "Cleaned $count log files."
    else
      echo "Cancelled."
    fi
    ;;
esac
