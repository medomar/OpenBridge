#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────
# stop.sh
# Gracefully stop running task runner agents.
#
# Usage:
#   ./scripts/stop.sh              # Stop all task runner agents
#   ./scripts/stop.sh --force      # Force kill (SIGKILL)
#   ./scripts/stop.sh --pid 12345  # Stop a specific agent by PID
# ─────────────────────────────────────────────────────────────────

set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
STATE_FILE="$PROJECT_DIR/logs/task-runs/.run_state.json"

FORCE=false
TARGET_PID=""

usage() {
  cat <<EOF
Usage: $(basename "$0") [OPTIONS]

Stop running task runner agents.

Options:
  --force         Force kill with SIGKILL (default: graceful SIGTERM)
  --pid PID       Stop a specific agent by PID
  --help          Show this message

Examples:
  ./scripts/stop.sh                # Gracefully stop all agents
  ./scripts/stop.sh --force        # Force kill all agents
  ./scripts/stop.sh --pid 12345    # Stop specific agent
EOF
  exit 0
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --force)  FORCE=true; shift ;;
    --pid)    TARGET_PID="$2"; shift 2 ;;
    --help)   usage ;;
    *)        echo "Unknown option: $1"; usage ;;
  esac
done

# ── Find Agents ──────────────────────────────────────────────────

if [[ -n "$TARGET_PID" ]]; then
  pids="$TARGET_PID"
else
  # Find claude --print processes (task runner agents only)
  pids=$(ps aux | grep "[c]laude.*--print" | awk '{print $2}' || true)
fi

if [[ -z "$pids" ]]; then
  echo "No task runner agents found."
  exit 0
fi

count=$(echo "$pids" | wc -l | tr -d ' ')

# ── Show What We're Stopping ─────────────────────────────────────

echo ""
echo "Found $count agent(s) to stop:"
echo ""
echo "  PID      CPU    STARTED"
echo "  ───────  ─────  ───────"
echo "$pids" | while read -r pid; do
  info=$(ps -p "$pid" -o pid=,pcpu=,lstart= 2>/dev/null || echo "$pid  ?  ?")
  pid_v=$(echo "$info" | awk '{print $1}')
  cpu_v=$(echo "$info" | awk '{print $2}')
  start_v=$(echo "$info" | awk '{for(i=3;i<=NF;i++) printf "%s ", $i; print ""}')
  printf "  %-7s  %5s%%  %s\n" "$pid_v" "$cpu_v" "$start_v"
done

echo ""

# ── Stop Agents ──────────────────────────────────────────────────

if [[ "$FORCE" == "true" ]]; then
  signal="SIGKILL"
  echo "Force killing agents..."
else
  signal="SIGTERM"
  echo "Sending graceful shutdown (SIGTERM)..."
fi

echo "$pids" | while read -r pid; do
  if kill -0 "$pid" 2>/dev/null; then
    if [[ "$FORCE" == "true" ]]; then
      kill -9 "$pid" 2>/dev/null && echo "  Killed PID $pid" || echo "  Failed to kill PID $pid"
    else
      kill "$pid" 2>/dev/null && echo "  Stopped PID $pid" || echo "  Failed to stop PID $pid"
    fi
  else
    echo "  PID $pid already stopped"
  fi
done

# Also stop the parent run-tasks.sh if running
parent_pids=$(ps aux | grep "[r]un-tasks.sh" | awk '{print $2}' || true)
if [[ -n "$parent_pids" ]]; then
  echo ""
  echo "Stopping task runner loop(s)..."
  echo "$parent_pids" | while read -r pid; do
    if [[ "$FORCE" == "true" ]]; then
      kill -9 "$pid" 2>/dev/null && echo "  Killed runner PID $pid"
    else
      kill "$pid" 2>/dev/null && echo "  Stopped runner PID $pid"
    fi
  done
fi

# Update state file
if [[ -f "$STATE_FILE" ]]; then
  # Simple update - replace status
  if command -v python3 &>/dev/null; then
    python3 -c "
import json, sys
try:
    with open('$STATE_FILE', 'r') as f:
        state = json.load(f)
    state['status'] = 'stopped'
    state['stopped_at'] = '$(date -u +%Y-%m-%dT%H:%M:%SZ)'
    with open('$STATE_FILE', 'w') as f:
        json.dump(state, f, indent=2)
except:
    pass
" 2>/dev/null
  fi
fi

echo ""
echo "Done. Use ./scripts/status.sh to verify."
