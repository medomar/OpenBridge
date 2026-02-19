#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────
# status.sh
# Shows the current state of the task runner: running agents,
# task progress, recent activity, and audit score.
#
# Usage:
#   ./scripts/status.sh              # Full dashboard
#   ./scripts/status.sh --watch      # Auto-refresh every 5s
#   ./scripts/status.sh --watch 10   # Auto-refresh every 10s
#   ./scripts/status.sh --agents     # Only show running agents
#   ./scripts/status.sh --tasks      # Only show task progress
#   ./scripts/status.sh --logs       # Only show recent log activity
# ─────────────────────────────────────────────────────────────────

set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

# Defaults (same as run-tasks.sh)
TASKS_FILE="docs/audit/TASKS.md"
HEALTH_FILE="docs/audit/HEALTH.md"
POINTER_FILE="docs/audit/.current_task"
LOG_DIR="logs/task-runs"
STATE_FILE="logs/task-runs/.run_state.json"

SHOW_AGENTS=true
SHOW_TASKS=true
SHOW_LOGS=true
WATCH_MODE=false
WATCH_INTERVAL=5

# ── Usage ────────────────────────────────────────────────────────

usage() {
  cat <<EOF
Usage: $(basename "$0") [OPTIONS]

Shows the current state of the task runner.

Display:
  --agents          Only show running agents
  --tasks           Only show task progress
  --logs            Only show recent log activity
  --watch [N]       Auto-refresh every N seconds (default: 5)

Paths:
  --tasks-file F    Task list file (default: $TASKS_FILE)
  --health-file F   Health score file (default: $HEALTH_FILE)
  --log-dir DIR     Log directory (default: $LOG_DIR)
  --project DIR     Project root (default: auto-detected)

Other:
  --help            Show this message
EOF
  exit 0
}

# ── Parse Args ───────────────────────────────────────────────────

while [[ $# -gt 0 ]]; do
  case "$1" in
    --agents)      SHOW_AGENTS=true; SHOW_TASKS=false; SHOW_LOGS=false; shift ;;
    --tasks)       SHOW_AGENTS=false; SHOW_TASKS=true; SHOW_LOGS=false; shift ;;
    --logs)        SHOW_AGENTS=false; SHOW_TASKS=false; SHOW_LOGS=true; shift ;;
    --watch)
      WATCH_MODE=true; shift
      if [[ $# -gt 0 && "$1" =~ ^[0-9]+$ ]]; then
        WATCH_INTERVAL="$1"; shift
      fi
      ;;
    --tasks-file)  TASKS_FILE="$2"; shift 2 ;;
    --health-file) HEALTH_FILE="$2"; shift 2 ;;
    --log-dir)     LOG_DIR="$2"; shift 2 ;;
    --project)     PROJECT_DIR="$2"; shift 2 ;;
    --help)        usage ;;
    *)             echo "Unknown option: $1"; usage ;;
  esac
done

TASKS_PATH="$PROJECT_DIR/$TASKS_FILE"
HEALTH_PATH="$PROJECT_DIR/$HEALTH_FILE"
POINTER_PATH="$PROJECT_DIR/$POINTER_FILE"
LOG_PATH="$PROJECT_DIR/$LOG_DIR"
STATE_PATH="$PROJECT_DIR/$STATE_FILE"

# ── Display Functions ────────────────────────────────────────────

show_header() {
  echo ""
  echo "╔═════════════════════════════════════════════════════════════╗"
  echo "║            Task Runner — Status Dashboard                  ║"
  echo "╠═════════════════════════════════════════════════════════════╣"
  echo "║  $(date)"
  echo "╚═════════════════════════════════════════════════════════════╝"
}

show_agents() {
  echo ""
  echo "── Running Agents ─────────────────────────────────────────"

  # Find claude --print processes (task runner agents)
  local agent_pids
  agent_pids=$(ps aux | grep "[c]laude.*--print" | awk '{print $2}' || true)

  if [[ -z "$agent_pids" ]]; then
    echo "  No task runner agents currently running."
  else
    local count
    count=$(echo "$agent_pids" | wc -l | tr -d ' ')
    echo "  Active agents: $count"
    echo ""
    echo "  PID      CPU    MEM    STARTED  MODEL"
    echo "  ───────  ─────  ─────  ───────  ─────"
    ps aux | grep "[c]laude.*--print" | while read -r line; do
      local pid cpu mem start model_flag
      pid=$(echo "$line" | awk '{print $2}')
      cpu=$(echo "$line" | awk '{print $3}')
      mem=$(echo "$line" | awk '{print $4}')
      start=$(echo "$line" | awk '{print $9}')
      # Extract model if specified
      if echo "$line" | grep -q "\-\-model"; then
        model_flag=$(echo "$line" | grep -o '\-\-model [^ ]*' | awk '{print $2}')
      else
        model_flag="default"
      fi
      printf "  %-7s  %5s%%  %5s%%  %7s  %s\n" "$pid" "$cpu" "$mem" "$start" "$model_flag"
    done
  fi

  # Show run state if exists
  if [[ -f "$STATE_PATH" ]]; then
    echo ""
    echo "  Last run state:"
    local started_at iteration phase model parallel status
    started_at=$(grep -o '"started_at":"[^"]*"' "$STATE_PATH" 2>/dev/null | cut -d'"' -f4 || echo "unknown")
    iteration=$(grep -o '"iteration":[0-9]*' "$STATE_PATH" 2>/dev/null | cut -d: -f2 || echo "?")
    phase=$(grep -o '"phase":"[^"]*"' "$STATE_PATH" 2>/dev/null | cut -d'"' -f4 || echo "all")
    model=$(grep -o '"model":"[^"]*"' "$STATE_PATH" 2>/dev/null | cut -d'"' -f4 || echo "default")
    parallel=$(grep -o '"parallel":[0-9]*' "$STATE_PATH" 2>/dev/null | cut -d: -f2 || echo "1")
    status=$(grep -o '"status":"[^"]*"' "$STATE_PATH" 2>/dev/null | cut -d'"' -f4 || echo "unknown")
    echo "    Started:    $started_at"
    echo "    Iteration:  $iteration"
    echo "    Phase:      $phase"
    echo "    Model:      $model"
    echo "    Parallel:   $parallel"
    echo "    Status:     $status"
  fi
}

show_tasks() {
  echo ""
  echo "── Task Progress ──────────────────────────────────────────"

  if [[ ! -f "$TASKS_PATH" ]]; then
    echo "  Tasks file not found: $TASKS_PATH"
    return
  fi

  # Extract summary line from TASKS.md header
  local summary
  summary=$(head -5 "$TASKS_PATH" | grep -o 'Total:.*' || echo "No summary found")
  echo "  $summary"

  # Extract health score
  if [[ -f "$HEALTH_PATH" ]]; then
    local score
    score=$(head -5 "$HEALTH_PATH" | grep -o 'Current Score: [0-9.]*/10' || echo "No score")
    echo "  $score"
  fi

  echo ""

  # Count task statuses
  local done_count pending_count progress_count
  done_count=$(grep -c "✅ Done" "$TASKS_PATH" 2>/dev/null || echo "0")
  pending_count=$(grep -c "◻ Pending" "$TASKS_PATH" 2>/dev/null || echo "0")
  progress_count=$(grep -c "🔄 In Progress" "$TASKS_PATH" 2>/dev/null || echo "0")

  # Progress bar
  local total=$((done_count + pending_count + progress_count))
  if [[ "$total" -gt 0 ]]; then
    local pct=$((done_count * 100 / total))
    local bar_width=40
    local filled=$((pct * bar_width / 100))
    local empty=$((bar_width - filled))
    printf "  [%s%s] %d%%\n" \
      "$(printf '█%.0s' $(seq 1 $filled 2>/dev/null) 2>/dev/null)" \
      "$(printf '░%.0s' $(seq 1 $empty 2>/dev/null) 2>/dev/null)" \
      "$pct"
    echo ""
  fi

  echo "  ✅ Done:        $done_count"
  echo "  🔄 In Progress: $progress_count"
  echo "  ◻  Pending:     $pending_count"

  # Pointer file
  echo ""
  if [[ -f "$POINTER_PATH" ]]; then
    echo "  Next task: $(cat "$POINTER_PATH")"
  else
    echo "  Next task: (no pointer file — will scan task list)"
  fi

  # Show phase breakdown
  echo ""
  echo "  Phase breakdown:"
  local phase_num=1
  while [[ $phase_num -le 4 ]]; do
    local phase_done phase_pending phase_total
    # Count tasks in this phase section
    phase_done=$(sed -n "/## Phase $phase_num/,/## Phase $((phase_num + 1))\|## Status/p" "$TASKS_PATH" 2>/dev/null | grep -c "✅ Done" || echo "0")
    phase_pending=$(sed -n "/## Phase $phase_num/,/## Phase $((phase_num + 1))\|## Status/p" "$TASKS_PATH" 2>/dev/null | grep -c "◻ Pending\|🔄 In Progress" || echo "0")
    phase_total=$((phase_done + phase_pending))
    if [[ "$phase_total" -gt 0 ]]; then
      local phase_status="◻"
      if [[ "$phase_done" -eq "$phase_total" ]]; then
        phase_status="✅"
      elif [[ "$phase_done" -gt 0 ]]; then
        phase_status="🔄"
      fi
      echo "    $phase_status Phase $phase_num: $phase_done/$phase_total done"
    fi
    phase_num=$((phase_num + 1))
  done
}

show_logs() {
  echo ""
  echo "── Recent Log Activity ────────────────────────────────────"

  if [[ ! -d "$LOG_PATH" ]]; then
    echo "  No log directory found."
    return
  fi

  # Iteration counter
  if [[ -f "$LOG_PATH/.iteration_counter" ]]; then
    echo "  Total iterations: $(cat "$LOG_PATH/.iteration_counter")"
  fi

  echo ""

  # List recent log files with sizes and status
  local log_files
  log_files=$(ls -t "$LOG_PATH"/*.log 2>/dev/null | head -10)

  if [[ -z "$log_files" ]]; then
    echo "  No log files found."
    return
  fi

  echo "  FILE                                        SIZE     STATUS"
  echo "  ──────────────────────────────────────────   ──────   ──────"

  echo "$log_files" | while read -r log_file; do
    local fname size status_indicator last_line
    fname=$(basename "$log_file")
    size=$(wc -c < "$log_file" | tr -d ' ')

    # Human-readable size
    if [[ "$size" -gt 1048576 ]]; then
      size="$(( size / 1048576 ))MB"
    elif [[ "$size" -gt 1024 ]]; then
      size="$(( size / 1024 ))KB"
    else
      size="${size}B"
    fi

    # Determine status from log content
    if [[ ! -s "$log_file" ]]; then
      status_indicator="⚠ empty"
    elif tail -5 "$log_file" 2>/dev/null | grep -qi "error\|failed\|exception"; then
      status_indicator="❌ error"
    elif tail -5 "$log_file" 2>/dev/null | grep -qi "completed\|success\|done"; then
      status_indicator="✅ done"
    else
      # Check if process is still writing
      local file_age
      file_age=$(( $(date +%s) - $(stat -f %m "$log_file" 2>/dev/null || stat -c %Y "$log_file" 2>/dev/null || echo 0) ))
      if [[ "$file_age" -lt 60 ]]; then
        status_indicator="🔄 active"
      else
        status_indicator="— ended"
      fi
    fi

    printf "  %-44s %6s   %s\n" "$fname" "$size" "$status_indicator"
  done

  # Show last lines of most recent active log
  local latest_log
  latest_log=$(ls -t "$LOG_PATH"/*.log 2>/dev/null | head -1)
  if [[ -n "$latest_log" && -s "$latest_log" ]]; then
    echo ""
    echo "  Latest output ($(basename "$latest_log")):"
    echo "  ┌─────────────────────────────────────────────────────────"
    tail -5 "$latest_log" 2>/dev/null | while IFS= read -r line; do
      echo "  │ $line"
    done
    echo "  └─────────────────────────────────────────────────────────"
  fi
}

# ── Main ─────────────────────────────────────────────────────────

render() {
  if [[ "$WATCH_MODE" == "true" ]]; then
    clear
  fi

  show_header
  [[ "$SHOW_AGENTS" == "true" ]] && show_agents
  [[ "$SHOW_TASKS" == "true" ]]  && show_tasks
  [[ "$SHOW_LOGS" == "true" ]]   && show_logs

  echo ""
}

if [[ "$WATCH_MODE" == "true" ]]; then
  trap 'echo ""; echo "Stopped watching."; exit 0' INT
  while true; do
    render
    echo "  Refreshing in ${WATCH_INTERVAL}s... (Ctrl+C to stop)"
    sleep "$WATCH_INTERVAL"
  done
else
  render
fi
