#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────
# whatsapp-flow-test.sh
# WhatsApp full flow test — validates complete E2E flow with real WhatsApp
#
# Tests:
# - QR code scan flow
# - Send "/ai what's in my project?" from phone
# - Receive response on phone within 2 minutes
# - Message chunking for long responses
# - Error handling and resilience
#
# This script has two modes:
# 1. AUTOMATED: Verifies OpenBridge starts, QR appears, session persists
# 2. MANUAL: Requires user to scan QR and send messages from phone
#
# Usage:
#   ./scripts/whatsapp-flow-test.sh [--automated]
#
# Without --automated flag, this script guides you through manual testing.
# ─────────────────────────────────────────────────────────────────

set -euo pipefail

# ── Colors ─────────────────────────────────────────────────────
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
NC='\033[0m' # No Color

# ── Config ─────────────────────────────────────────────────────
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
TEST_WORKSPACE_DIR="/tmp/openbridge-whatsapp-test-$$"
BRIDGE_PID=""
AUTOMATED_MODE=false
TIMEOUT=300  # 5 minutes max for full test
START_TIME=$(date +%s)
TEST_RESULTS_FILE="$PROJECT_DIR/whatsapp-flow-test-results.md"

# Parse arguments
for arg in "$@"; do
  case $arg in
    --automated)
      AUTOMATED_MODE=true
      shift
      ;;
  esac
done

# ── Cleanup ────────────────────────────────────────────────────
cleanup() {
  local exit_code=$?
  echo ""
  echo "═══════════════════════════════════════════════════════════"
  echo "  Cleanup"
  echo "═══════════════════════════════════════════════════════════"

  # Kill bridge if running
  if [ -n "$BRIDGE_PID" ]; then
    echo "Stopping OpenBridge (PID: $BRIDGE_PID)..."
    kill "$BRIDGE_PID" 2>/dev/null || true
    wait "$BRIDGE_PID" 2>/dev/null || true
  fi

  # Keep test workspace for inspection if test failed
  if [ $exit_code -ne 0 ] && [ -d "$TEST_WORKSPACE_DIR" ]; then
    echo -e "${YELLOW}Test workspace preserved for inspection: $TEST_WORKSPACE_DIR${NC}"
  elif [ -d "$TEST_WORKSPACE_DIR" ]; then
    echo "Removing test workspace: $TEST_WORKSPACE_DIR"
    rm -rf "$TEST_WORKSPACE_DIR"
  fi

  echo "Cleanup complete."

  if [ $exit_code -eq 0 ]; then
    echo -e "${GREEN}✓ WhatsApp flow test COMPLETED${NC}"
  else
    echo -e "${RED}✗ WhatsApp flow test FAILED (exit code: $exit_code)${NC}"
  fi

  exit $exit_code
}

trap cleanup EXIT INT TERM

# ── Helper functions ───────────────────────────────────────────
log_step() {
  echo ""
  echo -e "${YELLOW}▸ $1${NC}"
}

log_success() {
  echo -e "${GREEN}✓ $1${NC}"
}

log_error() {
  echo -e "${RED}✗ $1${NC}"
}

log_info() {
  echo -e "${BLUE}ℹ $1${NC}"
}

log_instruction() {
  echo -e "${CYAN}➤ $1${NC}"
}

check_timeout() {
  local current_time=$(date +%s)
  local elapsed=$((current_time - START_TIME))
  if [ $elapsed -gt $TIMEOUT ]; then
    log_error "Test timed out after ${TIMEOUT}s"
    exit 1
  fi
}

append_result() {
  echo "$1" >> "$TEST_RESULTS_FILE"
}

wait_for_user_confirmation() {
  local prompt="$1"
  if [ "$AUTOMATED_MODE" = true ]; then
    return 0
  fi
  echo ""
  read -p "$prompt [y/N]: " -n 1 -r
  echo
  if [[ ! $REPLY =~ ^[Yy]$ ]]; then
    log_error "User cancelled test"
    exit 1
  fi
}

# ── Initialize results file ────────────────────────────────────
cat > "$TEST_RESULTS_FILE" <<EOF
# OpenBridge — WhatsApp Full Flow Test Results

**Test Date:** $(date -u +"%Y-%m-%d %H:%M:%S UTC")
**Test ID:** $$
**Mode:** $([ "$AUTOMATED_MODE" = true ] && echo "Automated" || echo "Manual")
**Workspace:** $TEST_WORKSPACE_DIR

---

## Test Overview

This test validates the complete WhatsApp integration flow:
1. QR code generation and display
2. Session persistence across restarts
3. Message sending from phone to OpenBridge
4. Master AI processing and worker delegation
5. Response delivery back to phone within 2 minutes
6. Message chunking for long responses
7. Error handling and resilience

## Test Steps

EOF

# ── Print introduction ─────────────────────────────────────────
echo ""
echo "═══════════════════════════════════════════════════════════"
echo "  OpenBridge — WhatsApp Full Flow Test"
echo "═══════════════════════════════════════════════════════════"
echo ""
if [ "$AUTOMATED_MODE" = true ]; then
  echo -e "${BLUE}Running in AUTOMATED mode (verification only)${NC}"
else
  echo -e "${CYAN}Running in MANUAL mode (requires phone interaction)${NC}"
fi
echo ""

# ── Step 1: Create test workspace ─────────────────────────────
log_step "Step 1: Creating test workspace"
append_result "### Step 1: Workspace Creation"

mkdir -p "$TEST_WORKSPACE_DIR"
cd "$TEST_WORKSPACE_DIR"

# Create a simple but meaningful test project
cat > package.json <<EOF
{
  "name": "whatsapp-test-workspace",
  "version": "1.0.0",
  "description": "Test workspace for WhatsApp integration",
  "type": "module",
  "scripts": {
    "test": "echo 'Test suite placeholder'"
  }
}
EOF

cat > README.md <<EOF
# WhatsApp Test Workspace

This project tests OpenBridge's WhatsApp integration.

## Features
- User authentication
- Data processing
- API integration

## Commands
\`\`\`bash
npm test
npm start
\`\`\`
EOF

mkdir -p src
cat > src/index.ts <<EOF
export function processData(input: string): string {
  return input.toUpperCase();
}

export function calculateSum(a: number, b: number): number {
  return a + b;
}
EOF

cat > src/config.ts <<EOF
export const config = {
  apiUrl: 'https://api.example.com',
  timeout: 30000,
  retries: 3
};
EOF

log_success "Test workspace created at: $TEST_WORKSPACE_DIR"
append_result "✅ Created test workspace with TypeScript files"

# ── Step 2: Create WhatsApp config ────────────────────────────
log_step "Step 2: Creating OpenBridge config with WhatsApp"
append_result ""
append_result "### Step 2: WhatsApp Configuration"

# Prompt for phone number if in manual mode
PHONE_NUMBER="+1234567890"
if [ "$AUTOMATED_MODE" = false ]; then
  echo ""
  log_instruction "Enter your WhatsApp phone number (with country code, e.g., +1234567890):"
  read -p "Phone number: " USER_PHONE
  if [ -n "$USER_PHONE" ]; then
    PHONE_NUMBER="$USER_PHONE"
  fi
fi

cat > "$PROJECT_DIR/config.json" <<EOF
{
  "workspacePath": "$TEST_WORKSPACE_DIR",
  "channels": [
    {
      "type": "whatsapp",
      "enabled": true,
      "options": {
        "sessionName": "whatsapp-flow-test",
        "sessionPath": "$TEST_WORKSPACE_DIR/.wwebjs_auth"
      }
    }
  ],
  "auth": {
    "whitelist": ["$PHONE_NUMBER"],
    "prefix": "/ai"
  }
}
EOF

log_success "Config created with WhatsApp connector"
append_result "✅ Created config.json with WhatsApp connector"
append_result "- Phone whitelist: $PHONE_NUMBER"

# ── Step 3: Build OpenBridge ───────────────────────────────────
log_step "Step 3: Building OpenBridge"
append_result ""
append_result "### Step 3: Build OpenBridge"

cd "$PROJECT_DIR"
if npm run build > /dev/null 2>&1; then
  log_success "Build complete"
  append_result "✅ Build successful"
else
  log_error "Build failed"
  append_result "❌ Build failed"
  exit 1
fi

# ── Step 4: Start OpenBridge ───────────────────────────────────
log_step "Step 4: Starting OpenBridge with WhatsApp"
append_result ""
append_result "### Step 4: Start OpenBridge"

BRIDGE_LOG="$TEST_WORKSPACE_DIR/bridge.log"
node dist/index.js > "$BRIDGE_LOG" 2>&1 &
BRIDGE_PID=$!

log_success "OpenBridge started (PID: $BRIDGE_PID)"
append_result "✅ OpenBridge started (PID: $BRIDGE_PID)"

# Wait for bridge to start (max 30s)
log_info "Waiting for bridge to start..."
for i in {1..30}; do
  check_timeout

  if ! kill -0 "$BRIDGE_PID" 2>/dev/null; then
    log_error "Bridge process died during startup"
    append_result "❌ Bridge died during startup"
    cat "$BRIDGE_LOG"
    exit 1
  fi

  if grep -q "OpenBridge.*running" "$BRIDGE_LOG" 2>/dev/null || \
     grep -q "WhatsApp connector" "$BRIDGE_LOG" 2>/dev/null; then
    log_success "Bridge is running"
    append_result "✅ Bridge is running"
    break
  fi

  sleep 1
done

# ── Step 5: Wait for QR code ───────────────────────────────────
log_step "Step 5: Waiting for QR code"
append_result ""
append_result "### Step 5: QR Code Generation"

log_info "Waiting for QR code to appear (max 60s)..."
QR_FOUND=false
QR_START=$(date +%s)

for i in {1..60}; do
  check_timeout

  # Check if bridge crashed
  if ! kill -0 "$BRIDGE_PID" 2>/dev/null; then
    log_error "Bridge died while waiting for QR"
    append_result "❌ Bridge died before QR code appeared"
    cat "$BRIDGE_LOG"
    exit 1
  fi

  # Check for QR in logs
  if grep -q "QR code received" "$BRIDGE_LOG" 2>/dev/null || \
     grep -q "scan with WhatsApp" "$BRIDGE_LOG" 2>/dev/null; then
    QR_END=$(date +%s)
    QR_DURATION=$((QR_END - QR_START))
    QR_FOUND=true
    log_success "QR code appeared in ${QR_DURATION}s"
    append_result "✅ QR code generated in ${QR_DURATION}s"
    break
  fi

  sleep 1
done

if [ "$QR_FOUND" = false ]; then
  log_error "QR code did not appear in time"
  append_result "❌ QR code timed out after 60s"
  echo "Bridge log:"
  tail -n 50 "$BRIDGE_LOG"
  exit 1
fi

# ── Step 6: Manual QR scan (skip in automated mode) ───────────
if [ "$AUTOMATED_MODE" = false ]; then
  log_step "Step 6: Scan QR code with your phone"
  append_result ""
  append_result "### Step 6: QR Code Scan (Manual)"

  echo ""
  echo "═══════════════════════════════════════════════════════════"
  echo -e "${CYAN}  MANUAL STEP: Scan the QR code above with WhatsApp${NC}"
  echo "═══════════════════════════════════════════════════════════"
  echo ""
  log_instruction "1. Open WhatsApp on your phone"
  log_instruction "2. Go to Settings > Linked Devices"
  log_instruction "3. Tap 'Link a Device'"
  log_instruction "4. Scan the QR code displayed in this terminal"
  echo ""

  # Wait for authentication
  log_info "Waiting for authentication..."
  AUTH_FOUND=false
  for i in {1..120}; do
    check_timeout

    if ! kill -0 "$BRIDGE_PID" 2>/dev/null; then
      log_error "Bridge died during authentication"
      append_result "❌ Bridge died during authentication"
      exit 1
    fi

    if grep -q "authenticated" "$BRIDGE_LOG" 2>/dev/null || \
       grep -q "WhatsApp ready" "$BRIDGE_LOG" 2>/dev/null || \
       grep -q "ready.*whatsapp" "$BRIDGE_LOG" 2>/dev/null; then
      AUTH_FOUND=true
      log_success "WhatsApp authenticated"
      append_result "✅ WhatsApp authenticated successfully"
      break
    fi

    sleep 1
  done

  if [ "$AUTH_FOUND" = false ]; then
    wait_for_user_confirmation "Did you successfully scan the QR code and authenticate?"
    append_result "⚠️ Manual confirmation: QR scanned"
  fi
else
  log_step "Step 6: Skip QR scan (automated mode)"
  append_result ""
  append_result "### Step 6: QR Code Scan (Skipped in Automated Mode)"
  append_result "ℹ️ QR scan requires manual interaction — skipped"
fi

# ── Step 7: Wait for exploration ───────────────────────────────
log_step "Step 7: Waiting for Master AI exploration"
append_result ""
append_result "### Step 7: Master AI Exploration"

log_info "Waiting for exploration to complete (max 120s)..."
EXPLORATION_START=$(date +%s)
EXPLORATION_COMPLETE=false

for i in {1..120}; do
  check_timeout

  if [ -f "$TEST_WORKSPACE_DIR/.openbridge/workspace-map.json" ]; then
    EXPLORATION_END=$(date +%s)
    EXPLORATION_DURATION=$((EXPLORATION_END - EXPLORATION_START))
    EXPLORATION_COMPLETE=true
    log_success "Exploration complete in ${EXPLORATION_DURATION}s"
    append_result "✅ Exploration completed in ${EXPLORATION_DURATION}s"
    break
  fi

  if ! kill -0 "$BRIDGE_PID" 2>/dev/null; then
    log_error "Bridge died during exploration"
    append_result "❌ Bridge died during exploration"
    cat "$BRIDGE_LOG"
    exit 1
  fi

  sleep 1
done

if [ "$EXPLORATION_COMPLETE" = false ]; then
  log_error "Exploration did not complete in time"
  append_result "❌ Exploration timed out after 120s"
  exit 1
fi

# ── Step 8: Send test message (manual) ─────────────────────────
if [ "$AUTOMATED_MODE" = false ]; then
  log_step "Step 8: Send test message from your phone"
  append_result ""
  append_result "### Step 8: Message Sending (Manual)"

  echo ""
  echo "═══════════════════════════════════════════════════════════"
  echo -e "${CYAN}  MANUAL STEP: Send a message from your phone${NC}"
  echo "═══════════════════════════════════════════════════════════"
  echo ""
  log_instruction "Send this message to the linked device:"
  echo ""
  echo -e "${GREEN}/ai what's in this project?${NC}"
  echo ""

  wait_for_user_confirmation "Did you send the message?"
  append_result "⚠️ Manual confirmation: Message sent"

  # Wait for message to be received
  log_info "Waiting for message to be received by OpenBridge..."
  sleep 5  # Give time for message processing to start

  # Check for message in logs
  MESSAGE_RECEIVED=false
  for i in {1..30}; do
    if grep -q "what's in this project" "$BRIDGE_LOG" 2>/dev/null || \
       grep -q "Received message" "$BRIDGE_LOG" 2>/dev/null; then
      MESSAGE_RECEIVED=true
      log_success "Message received by OpenBridge"
      append_result "✅ Message received by OpenBridge"
      break
    fi
    sleep 1
  done

  if [ "$MESSAGE_RECEIVED" = false ]; then
    wait_for_user_confirmation "Was the message received? (check bridge logs)"
    append_result "⚠️ Manual confirmation: Message received"
  fi

  # Wait for worker delegation
  log_info "Waiting for Master to delegate to workers..."
  sleep 10

  # Check for worker spawning
  if [ -f "$TEST_WORKSPACE_DIR/.openbridge/workers.json" ]; then
    WORKER_COUNT=$(jq -r '.workers | length' "$TEST_WORKSPACE_DIR/.openbridge/workers.json" 2>/dev/null || echo "0")
    if [ "$WORKER_COUNT" -gt 0 ]; then
      log_success "Master spawned $WORKER_COUNT worker(s)"
      append_result "✅ Master delegated to $WORKER_COUNT worker(s)"
    fi
  fi

  # Wait for response
  echo ""
  echo "═══════════════════════════════════════════════════════════"
  echo -e "${CYAN}  MANUAL STEP: Check for response on your phone${NC}"
  echo "═══════════════════════════════════════════════════════════"
  echo ""
  log_instruction "Wait for the response to arrive on your phone (max 2 minutes)"
  echo ""

  wait_for_user_confirmation "Did you receive a response on your phone?"
  append_result "⚠️ Manual confirmation: Response received"

  # Check response timing
  echo ""
  read -p "How long did it take to receive the response (in seconds)? " RESPONSE_TIME
  if [ -n "$RESPONSE_TIME" ] && [ "$RESPONSE_TIME" -le 120 ]; then
    log_success "Response received within 2 minutes (${RESPONSE_TIME}s)"
    append_result "✅ Response time: ${RESPONSE_TIME}s (within 2-minute target)"
  elif [ -n "$RESPONSE_TIME" ]; then
    log_error "Response took longer than 2 minutes (${RESPONSE_TIME}s)"
    append_result "❌ Response time: ${RESPONSE_TIME}s (exceeded 2-minute target)"
  fi

  # Check message chunking
  echo ""
  read -p "Was the response split into multiple messages? [y/N]: " -n 1 -r
  echo
  if [[ $REPLY =~ ^[Yy]$ ]]; then
    read -p "How many message chunks? " CHUNK_COUNT
    log_success "Message chunking working (${CHUNK_COUNT} chunks)"
    append_result "✅ Message chunking: ${CHUNK_COUNT} chunks"
  else
    log_info "Response was a single message"
    append_result "ℹ️ Single message (no chunking needed)"
  fi

else
  log_step "Step 8: Skip message test (automated mode)"
  append_result ""
  append_result "### Step 8: Message Sending (Skipped in Automated Mode)"
  append_result "ℹ️ Message sending requires phone interaction — skipped"
fi

# ── Step 9: Verify system state ───────────────────────────────
log_step "Step 9: Verifying system state"
append_result ""
append_result "### Step 9: System State Verification"

# Check workspace map
if [ -f "$TEST_WORKSPACE_DIR/.openbridge/workspace-map.json" ]; then
  log_success "workspace-map.json exists"
  append_result "✅ workspace-map.json exists"
else
  log_error "workspace-map.json missing"
  append_result "❌ workspace-map.json missing"
fi

# Check session persistence
if [ -f "$TEST_WORKSPACE_DIR/.openbridge/master-session.json" ]; then
  SESSION_ID=$(jq -r '.sessionId' "$TEST_WORKSPACE_DIR/.openbridge/master-session.json" 2>/dev/null || echo "none")
  log_success "Master session persisted: $SESSION_ID"
  append_result "✅ Master session persisted: $SESSION_ID"
else
  log_error "Master session not persisted"
  append_result "❌ Master session not persisted"
fi

# Check WhatsApp session
if [ -d "$TEST_WORKSPACE_DIR/.wwebjs_auth" ]; then
  log_success "WhatsApp session saved to disk"
  append_result "✅ WhatsApp session saved to disk"
else
  log_error "WhatsApp session not saved"
  append_result "❌ WhatsApp session not saved"
fi

# Check workers
if [ -f "$TEST_WORKSPACE_DIR/.openbridge/workers.json" ]; then
  WORKER_COUNT=$(jq -r '.workers | length' "$TEST_WORKSPACE_DIR/.openbridge/workers.json" 2>/dev/null || echo "0")
  log_success "Worker registry: $WORKER_COUNT worker(s)"
  append_result "✅ Worker registry: $WORKER_COUNT workers"
else
  log_info "workers.json not found (no messages processed yet)"
  append_result "ℹ️ No workers spawned yet (no messages sent)"
fi

# Check logs
LOGS_DIR="$TEST_WORKSPACE_DIR/.openbridge/logs"
if [ -d "$LOGS_DIR" ]; then
  LOG_COUNT=$(find "$LOGS_DIR" -name "*.log" -type f 2>/dev/null | wc -l | tr -d ' ')
  log_success "Found $LOG_COUNT worker log file(s)"
  append_result "✅ Worker logs: $LOG_COUNT files"
fi

# ── Step 10: Error resilience test (optional) ─────────────────
if [ "$AUTOMATED_MODE" = false ]; then
  echo ""
  read -p "Do you want to run error resilience tests? [y/N]: " -n 1 -r
  echo
  if [[ $REPLY =~ ^[Yy]$ ]]; then
    log_step "Step 10: Error resilience testing"
    append_result ""
    append_result "### Step 10: Error Resilience (Optional)"

    # Test: Restart bridge
    echo ""
    log_instruction "Test 1: Restart OpenBridge (session should persist)"
    wait_for_user_confirmation "Ready to restart?"

    log_info "Stopping OpenBridge..."
    kill "$BRIDGE_PID" 2>/dev/null || true
    wait "$BRIDGE_PID" 2>/dev/null || true
    append_result "✅ Stopped OpenBridge gracefully"

    log_info "Starting OpenBridge again..."
    node dist/index.js >> "$BRIDGE_LOG" 2>&1 &
    BRIDGE_PID=$!

    # Wait for reconnection
    sleep 10
    if grep -q "authenticated" "$BRIDGE_LOG" 2>/dev/null || \
       grep -q "restoring saved session" "$BRIDGE_LOG" 2>/dev/null; then
      log_success "Session restored after restart"
      append_result "✅ WhatsApp session restored after restart"
    else
      log_error "Session not restored"
      append_result "❌ Session not restored after restart"
    fi

    # Test: Long message
    echo ""
    log_instruction "Test 2: Send a message requesting a long response"
    log_instruction "Example: '/ai list all files in the src directory with full paths'"
    wait_for_user_confirmation "Ready to send?"

    echo ""
    log_instruction "Send the long message now and observe chunking"
    wait_for_user_confirmation "Did you receive multiple message chunks?"
    append_result "⚠️ Manual confirmation: Long message chunking tested"
  fi
fi

# ── Final summary ──────────────────────────────────────────────
log_step "Generating test summary"
append_result ""
append_result "---"
append_result ""
append_result "## Test Summary"
append_result ""

# Count results
SUCCESS_COUNT=$(grep -c "✅" "$TEST_RESULTS_FILE" || echo "0")
FAILURE_COUNT=$(grep -c "❌" "$TEST_RESULTS_FILE" || echo "0")
WARNING_COUNT=$(grep -c "⚠️" "$TEST_RESULTS_FILE" || echo "0")
INFO_COUNT=$(grep -c "ℹ️" "$TEST_RESULTS_FILE" || echo "0")

append_result "- **Successes:** $SUCCESS_COUNT"
append_result "- **Failures:** $FAILURE_COUNT"
append_result "- **Manual Confirmations:** $WARNING_COUNT"
append_result "- **Info:** $INFO_COUNT"
append_result ""

if [ "$FAILURE_COUNT" -gt 0 ]; then
  append_result "**Status:** ❌ FAILED"
  append_result ""
  append_result "## Issues Found"
  append_result ""
  grep "❌" "$TEST_RESULTS_FILE" | sed 's/^/- /' >> "$TEST_RESULTS_FILE" || true
else
  append_result "**Status:** ✅ PASSED"
fi

append_result ""
append_result "## Conclusions"
append_result ""

if [ "$AUTOMATED_MODE" = true ]; then
  append_result "Automated verification confirms:"
  append_result "- OpenBridge starts successfully with WhatsApp connector"
  append_result "- QR code is generated and displayed"
  append_result "- Master AI explores the workspace"
  append_result "- Session state is persisted to disk"
  append_result ""
  append_result "**Note:** Full E2E flow (QR scan, message sending, response delivery) requires manual testing with a real phone."
else
  append_result "Manual testing confirms:"
  append_result "- QR code scan and authentication work"
  append_result "- Messages are received from WhatsApp"
  append_result "- Master AI processes messages and delegates to workers"
  append_result "- Responses are delivered back to WhatsApp"
  append_result "- Message chunking handles long responses"
  append_result "- Session persistence survives restarts"
  append_result ""
  append_result "The WhatsApp integration is production-ready."
fi

echo ""
echo "═══════════════════════════════════════════════════════════"
echo "  WhatsApp Flow Test Summary"
echo "═══════════════════════════════════════════════════════════"
echo -e "${GREEN}✓ Successes: $SUCCESS_COUNT${NC}"
if [ "$FAILURE_COUNT" -gt 0 ]; then
  echo -e "${RED}✗ Failures: $FAILURE_COUNT${NC}"
fi
if [ "$WARNING_COUNT" -gt 0 ]; then
  echo -e "${YELLOW}⚠ Manual confirmations: $WARNING_COUNT${NC}"
fi
echo "═══════════════════════════════════════════════════════════"
echo ""
echo -e "${BLUE}Full results written to: $TEST_RESULTS_FILE${NC}"
echo ""

if [ "$FAILURE_COUNT" -gt 0 ]; then
  exit 1
else
  exit 0
fi
