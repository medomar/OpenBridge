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

  # ── Helper: extract JSON value (handles spaces, colons in values) ──
  json_val() {
    local key="$1" file="$2"
    # For string values: "key": "value" (value may contain colons, dots, etc.)
    local result
    result=$(sed -n "s/.*\"${key}\"[[:space:]]*:[[:space:]]*\"\([^\"]*\)\".*/\1/p" "$file" 2>/dev/null | head -1)
    if [[ -n "$result" ]]; then
      echo "$result"
      return
    fi
    # For numeric/unquoted values: "key": 123
    sed -n "s/.*\"${key}\"[[:space:]]*:[[:space:]]*\([^,}[:space:]]*\).*/\1/p" "$file" 2>/dev/null | head -1
  }

  # ── 1. Check if the task runner process is alive via PID ──────
  local runner_alive=false
  local runner_pid=""
  if [[ -f "$STATE_PATH" ]]; then
    runner_pid=$(json_val "pid" "$STATE_PATH")
    local state_status
    state_status=$(json_val "status" "$STATE_PATH")
    if [[ -n "$runner_pid" && "$state_status" == "running" ]] && kill -0 "$runner_pid" 2>/dev/null; then
      runner_alive=true
    fi
  fi

  # ── 2. Find claude agent processes (multiple detection methods) ─
  # Method A: Look for claude processes spawned by the runner
  # Method B: Look for any "claude" CLI processes in terminal sessions
  # ps aux truncates command names, so we match broadly on "claude"
  # but exclude: this grep, the VSCode extension host, and other non-agent uses
  local agent_lines
  agent_lines=$(ps aux | grep -E '[c]laude\b' \
    | grep -v 'vscode\|extensions\|grep\|status\.sh\|tee\|/bin/zsh' \
    | grep -v "$$" \
    || true)

  # If the runner is alive, also find its child processes directly
  if [[ "$runner_alive" == "true" && -n "$runner_pid" ]]; then
    local child_pids
    child_pids=$(pgrep -P "$runner_pid" 2>/dev/null || true)
    if [[ -n "$child_pids" ]]; then
      for cpid in $child_pids; do
        # Include grandchildren (the actual claude processes)
        local grandchild_lines
        grandchild_lines=$(pgrep -P "$cpid" 2>/dev/null | while read -r gpid; do
          ps aux | awk -v pid="$gpid" '$2 == pid' 2>/dev/null
        done || true)
        if [[ -n "$grandchild_lines" ]]; then
          agent_lines="${agent_lines}
${grandchild_lines}"
        fi
      done
    fi
    # Deduplicate by PID, filter helper processes
    agent_lines=$(echo "$agent_lines" | grep -v 'tee\|/bin/zsh\|/bin/bash\|grep' | awk '!seen[$2]++' | grep -v '^$' || true)
  fi

  # ── 3. Display runner + agent status ──────────────────────────
  if [[ "$runner_alive" == "true" ]]; then
    echo "  Task runner:  ACTIVE (PID $runner_pid)"
  elif [[ -f "$STATE_PATH" ]]; then
    local state_status
    state_status=$(json_val "status" "$STATE_PATH")
    echo "  Task runner:  $state_status (PID $runner_pid — not running)"
  else
    echo "  Task runner:  No state file found."
  fi

  echo ""

  if [[ -z "$agent_lines" ]]; then
    if [[ "$runner_alive" == "true" ]]; then
      echo "  Agent processes: starting up or between iterations..."
    else
      echo "  No task runner agents currently running."
    fi
  else
    local count
    count=$(echo "$agent_lines" | grep -c '.' || echo "0")
    echo "  Active agents: $count"
    echo ""
    echo "  PID      CPU    MEM    STARTED  COMMAND"
    echo "  ───────  ─────  ─────  ───────  ───────"
    echo "$agent_lines" | while read -r line; do
      [[ -z "$line" ]] && continue
      local pid cpu mem start cmd
      pid=$(echo "$line" | awk '{print $2}')
      cpu=$(echo "$line" | awk '{print $3}')
      mem=$(echo "$line" | awk '{print $4}')
      start=$(echo "$line" | awk '{print $9}')
      # Show the command name (trimmed)
      cmd=$(echo "$line" | awk '{for(i=11;i<=NF;i++) printf "%s ", $i; print ""}' | cut -c1-40)
      if [[ -z "$cmd" || "$cmd" =~ ^[[:space:]]*$ ]]; then
        cmd="claude"
      fi
      printf "  %-7s  %5s%%  %5s%%  %7s  %s\n" "$pid" "$cpu" "$mem" "$start" "$cmd"
    done
  fi

  # ── 4. Show run state details ─────────────────────────────────
  if [[ -f "$STATE_PATH" ]]; then
    echo ""
    echo "  Run state:"
    local started_at iteration phase model budget status consecutive_failures
    started_at=$(json_val "started_at" "$STATE_PATH")
    iteration=$(json_val "iteration" "$STATE_PATH")
    phase=$(json_val "phase" "$STATE_PATH")
    model=$(json_val "model" "$STATE_PATH")
    budget=$(json_val "budget" "$STATE_PATH")
    status=$(json_val "status" "$STATE_PATH")
    consecutive_failures=$(json_val "consecutive_failures" "$STATE_PATH")
    echo "    Status:     ${status:-unknown}"
    echo "    Started:    ${started_at:-unknown}"
    echo "    Iteration:  ${iteration:-?}"
    echo "    Phase:      ${phase:-all}"
    echo "    Model:      ${model:-default}"
    echo "    Budget:     \$${budget:-5}/agent"
    echo "    Failures:   ${consecutive_failures:-0} consecutive"

    # Show skip info if available
    local skipped max_task_failures
    skipped=$(json_val "skipped_tasks" "$STATE_PATH")
    max_task_failures=$(json_val "max_task_failures" "$STATE_PATH")
    if [[ -n "$skipped" && "$skipped" != "0" ]]; then
      echo "    Skipped:    ${skipped} task(s)"
    fi
    if [[ -n "$max_task_failures" ]]; then
      echo "    Skip after: ${max_task_failures} failures per task"
    fi
  fi
}

show_tasks() {
  echo ""
  echo "── Task Progress ──────────────────────────────────────────"

  if [[ ! -f "$TASKS_PATH" ]]; then
    echo "  Tasks file not found: $TASKS_PATH"
    return
  fi

  # Extract summary line from TASKS.md header (strip markdown bold markers)
  local summary
  summary=$(head -5 "$TASKS_PATH" | grep -E 'Pending:|Total:|Done:' | head -1 | sed 's/[>*]//g' | sed 's/^[[:space:]]*//' || echo "No summary found")
  echo "  $summary"

  # Extract health score (strip markdown bold markers)
  if [[ -f "$HEALTH_PATH" ]]; then
    local score
    score=$(head -5 "$HEALTH_PATH" | grep 'Current Score:' | sed 's/[>*]//g' | sed 's/^[[:space:]]*//' || echo "No score")
    echo "  $score"
  fi

  echo ""

  # Count task statuses — only count rows with OB-xxx finding IDs (actual task rows)
  local task_rows done_count pending_count progress_count
  task_rows=$(grep 'OB-[0-9]' "$TASKS_PATH" 2>/dev/null || true)
  done_count=$(echo "$task_rows" | grep -c "✅ Done" 2>/dev/null || true)
  pending_count=$(echo "$task_rows" | grep -c -E "◻ Pending|⬚ Pending|\\| Pending" 2>/dev/null || true)
  progress_count=$(echo "$task_rows" | grep -c "🔄 In Progress" 2>/dev/null || true)
  # Ensure numeric (default to 0)
  done_count=${done_count:-0}
  pending_count=${pending_count:-0}
  progress_count=${progress_count:-0}

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

  # Show phase breakdown — dynamically detect all phases from TASKS.md
  echo ""
  echo "  Phase breakdown:"
  local phase_numbers
  phase_numbers=$(grep -oE '^#{2,3} Phase [0-9]+' "$TASKS_PATH" 2>/dev/null | grep -oE '[0-9]+' | sort -n || true)
  if [[ -n "$phase_numbers" ]]; then
    while IFS= read -r phase_num; do
      [[ -z "$phase_num" ]] && continue
      local phase_rows phase_done phase_pending phase_total
      phase_rows=$(awk "/^#{2,3} Phase $phase_num/{found=1; next} /^#{2,3} /{found=0} found && /OB-[0-9]/" "$TASKS_PATH" 2>/dev/null || true)
      if [[ -n "$phase_rows" ]]; then
        phase_done=$(echo "$phase_rows" | grep -c "✅ Done" 2>/dev/null || true)
        phase_pending=$(echo "$phase_rows" | grep -c -E "◻ Pending|⬚ Pending|\\| Pending|🔄 In Progress" 2>/dev/null || true)
      else
        phase_done=0
        phase_pending=0
      fi
      phase_done=${phase_done:-0}
      phase_pending=${phase_pending:-0}
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
    done <<< "$phase_numbers"
  else
    echo "    (no phases found)"
  fi

  # Show skipped tasks
  local skipped_file="$LOG_PATH/.skipped_tasks"
  if [[ -f "$skipped_file" && -s "$skipped_file" ]]; then
    local skip_count
    skip_count=$(wc -l < "$skipped_file" | tr -d ' ')
    echo ""
    echo "  Skipped tasks ($skip_count):"
    while IFS='|' read -r task_id timestamp reason; do
      echo "    - $task_id: $reason"
    done < "$skipped_file"
  fi

  # Show failure counts for tasks that have failed but not yet skipped
  local failures_file="$LOG_PATH/.task_failures.json"
  if [[ -f "$failures_file" ]] && command -v python3 &>/dev/null; then
    local failure_summary
    failure_summary=$(python3 -c "
import json
try:
    with open('$failures_file', 'r') as f:
        data = json.load(f)
    for tid, info in sorted(data.items()):
        count = info.get('count', 0)
        if count > 0:
            print(f'    {tid}: {count} failure(s)')
except:
    pass
" 2>/dev/null)
    if [[ -n "$failure_summary" ]]; then
      echo ""
      echo "  Task failure counts:"
      echo "$failure_summary"
    fi
  fi
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
    elif grep -qi "Reached max turns" "$log_file" 2>/dev/null; then
      status_indicator="⚠ max-turns"
    elif grep -qi "TIMEOUT: Agent killed" "$log_file" 2>/dev/null; then
      status_indicator="⚠ timeout"
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
