# Error Resilience Test Guide

**Test Script:** `scripts/error-resilience-test.sh`
**Purpose:** Validates OpenBridge handles failure scenarios gracefully
**Duration:** ~5-10 minutes (depending on system speed)

---

## Overview

This test validates that OpenBridge can handle various error conditions without crashing or losing data. It covers:

1. **Message queueing during exploration** — messages sent while Master is exploring should be queued
2. **Master restart after kill** — killing the Master AI process mid-task should not crash the bridge
3. **Long message truncation** — very long messages should be handled without crashes
4. **Response interruption** — killing a worker mid-response should not crash the bridge

---

## Running the Test

### Prerequisites

1. OpenBridge built successfully (`npm run build`)
2. No other OpenBridge instances running
3. Terminal with bash shell
4. At least 5 minutes of uninterrupted testing time

### Execute

```bash
cd /path/to/OpenBridge
./scripts/error-resilience-test.sh
```

### What to Expect

The test will:

1. Create a temporary test workspace in `/tmp/openbridge-resilience-test-*`
2. Start OpenBridge with Console connector (no WhatsApp QR required)
3. Run 4 error scenarios sequentially
4. Generate a results report
5. Clean up and exit

**Total runtime:** 5-10 minutes

---

## Test Scenarios

### Test 1: Message Queueing During Exploration

**Goal:** Verify messages sent during exploration are queued, not dropped

**Steps:**

1. Start OpenBridge
2. Wait for exploration to begin (but not complete)
3. Verify message queue infrastructure exists
4. Wait for exploration to complete

**Success Criteria:**

- ✅ Message queue module is loaded
- ✅ Bridge continues running
- ✅ No errors in logs

**Failure Modes:**

- ❌ Queue module not found
- ❌ Bridge crashes when exploration is interrupted

---

### Test 2: Master Restart After Kill

**Goal:** Verify killing Master AI mid-task doesn't crash the bridge

**Steps:**

1. Start OpenBridge
2. Wait for Master AI session to start
3. Find Master process (PID matching `claude.*session-id.*master`)
4. Send SIGKILL to Master process
5. Verify bridge survives

**Success Criteria:**

- ✅ Bridge continues running after Master kill
- ✅ Master session state persisted to `.openbridge/master-session.json`
- ✅ No crash or data corruption

**Failure Modes:**

- ❌ Bridge crashes when Master is killed
- ❌ Session state lost
- ❌ No recovery mechanism

---

### Test 3: Long Message Truncation

**Goal:** Verify very long messages don't crash the system

**Steps:**

1. Generate a 10KB message (10,000 'A' characters)
2. Send to bridge via queue
3. Verify bridge survives
4. Check for truncation logic in code

**Success Criteria:**

- ✅ Bridge continues running
- ✅ Truncation logic exists in router/queue
- ✅ No out-of-memory errors

**Failure Modes:**

- ❌ Bridge crashes on long message
- ❌ Out of memory error
- ❌ No length limits enforced

---

### Test 4: Response Interruption

**Goal:** Verify killing a worker mid-response doesn't crash the bridge

**Steps:**

1. Wait for a worker to spawn
2. Find worker process (PID matching `claude.*print`)
3. Send SIGKILL to worker process
4. Verify bridge survives
5. Check worker registry for failure tracking

**Success Criteria:**

- ✅ Bridge continues running after worker kill
- ✅ Worker failure recorded in `workers.json`
- ✅ Error handling code exists

**Failure Modes:**

- ❌ Bridge crashes when worker is killed
- ❌ Worker failure not tracked
- ❌ Orphaned processes

---

## Expected Output

### Successful Test Run

```
═══════════════════════════════════════════════════════════
  Error Resilience Test Summary
═══════════════════════════════════════════════════════════
✓ Message queueing verified
✓ Master restart capability verified
✓ Long message handling verified
✓ Response interruption handling verified
═══════════════════════════════════════════════════════════

✓ Error resilience test PASSED
```

### Test Results File

The test generates `error-resilience-test-results.md` in the project root with:

- Timestamp
- Test workspace path
- Individual test results
- Key findings
- Any warnings or partial passes

---

## Interpreting Results

### Status Indicators

| Status     | Meaning                                                              |
| ---------- | -------------------------------------------------------------------- |
| ✅ PASSED  | Test succeeded completely                                            |
| ⚠️ PARTIAL | Test succeeded with caveats (e.g., could not trigger exact scenario) |
| ⚠️ SKIPPED | Test skipped (e.g., process not found, timing issue)                 |
| ❌ FAILED  | Test failed — issue must be fixed                                    |

### Common Warnings

**"Exploration completed too quickly to test queuing"**

- Not a failure — just means exploration was fast
- Queue infrastructure is still verified

**"Could not find Master AI process to kill"**

- Not a failure — timing issue
- Session state file existence is still checked

**"No worker process found to interrupt"**

- Not a failure — no workers spawned yet
- Error handling code existence is still verified

---

## Troubleshooting

### Test Hangs During Exploration

**Symptom:** Test waits for exploration but never completes

**Causes:**

- Master AI stuck in infinite loop
- AgentRunner timeout too long
- Process deadlock

**Fix:**

1. Kill the test (Ctrl+C)
2. Check `/tmp/openbridge-resilience-test-*/bridge-*.log`
3. Look for errors or infinite retries
4. Verify `--max-turns` is being passed to workers

---

### Bridge Crashes on Test 2 (Master Kill)

**Symptom:** Bridge dies when Master process is killed

**Causes:**

- No error handling for child process exit
- Master session not properly isolated
- Missing graceful shutdown hooks

**Fix:**

1. Check `src/master/master-manager.ts` for try/catch around Master spawn
2. Verify `MasterManager.handleMasterCrash()` exists and is called
3. Add process exit event listeners

---

### Test 4 Fails (Worker Kill Crashes Bridge)

**Symptom:** Bridge crashes when worker is killed

**Causes:**

- No error handling for worker failures
- Worker registry not updated on crash
- Promise rejection not caught

**Fix:**

1. Check `src/master/worker-registry.ts` for error handling
2. Verify `Promise.allSettled()` used (not `Promise.all()`)
3. Add cleanup hooks for orphaned workers

---

## Validating Fixes

After fixing issues:

1. Run the full test suite: `npm run test`
2. Run this error resilience test: `./scripts/error-resilience-test.sh`
3. Run E2E smoke test: `./scripts/e2e-smoke.sh`
4. Run real workspace test: `./scripts/real-workspace-test.sh`

All tests should pass before merging fixes.

---

## Manual Testing

If automated test is unreliable, manually test each scenario:

### Manual Test 1: Message During Exploration

```bash
# Terminal 1: Start OpenBridge
npm run dev

# Terminal 2: Wait 5s, send message
echo "/ai what files are in src?" | nc localhost <port>
```

Verify: Message queued and processed after exploration.

---

### Manual Test 2: Kill Master

```bash
# Terminal 1: Start OpenBridge
npm run dev

# Terminal 2: Kill Master
pgrep -f "claude.*session-id.*master" | xargs kill -9

# Terminal 1: Verify bridge still running, no crash
```

Verify: Bridge survives, Master restarts gracefully.

---

### Manual Test 3: Long Message

```bash
# Terminal 1: Start OpenBridge
npm run dev

# Terminal 2: Send 10KB message
python3 -c "print('/ai ' + 'A' * 10000)" | nc localhost <port>
```

Verify: Bridge survives, no OOM error.

---

### Manual Test 4: Kill Worker

```bash
# Terminal 1: Start OpenBridge, send task
npm run dev
# (send a task that spawns worker)

# Terminal 2: Kill worker mid-execution
pgrep -f "claude.*print" | head -n 1 | xargs kill -9

# Terminal 1: Verify bridge still running, error logged
```

Verify: Bridge survives, worker failure tracked.

---

## Architecture Validation

This test validates key architectural decisions:

### 1. Process Isolation

- Master runs in separate process → can be killed without killing bridge
- Workers run in separate processes → can be killed without killing Master
- Bridge core is isolated from AI execution

### 2. State Persistence

- Master session state written to disk → survives crash
- Worker registry persisted → failures tracked
- Exploration state checkpointed → resumable

### 3. Error Handling

- All spawns wrapped in try/catch
- All promises use `.catch()` or `Promise.allSettled()`
- Child process exit events handled
- Timeouts enforced

### 4. Queue Resilience

- Messages queued per user
- Queue persists across exploration
- No messages dropped on error

---

## Success Criteria Summary

The error resilience test validates that OpenBridge:

✅ **Never crashes** — Bridge core stays alive through all errors
✅ **Never loses data** — Session state, worker results, queue persisted
✅ **Recovers gracefully** — Master restarts, workers retry, queue flushes
✅ **Tracks failures** — All errors logged, registry updated
✅ **Isolates processes** — Killing child doesn't kill parent

If all tests pass, OpenBridge is production-ready for error scenarios.
