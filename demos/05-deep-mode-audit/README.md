# Demo 05: Deep Mode Audit

> **Audience:** Security / QA teams | **Duration:** 15 min | **Difficulty:** Intermediate
> Show the structured 5-phase audit workflow.

---

## Key Message

"Say `/deep`. The AI investigates, reports findings, plans fixes, executes them, and verifies — all automatically."

## What This Demo Shows

- Deep Mode's 5-phase workflow: Investigate > Report > Plan > Execute > Verify
- Automatic phase progression (thorough mode)
- Manual phase control (review between phases)
- Finding drill-down with `/focus N`
- Parallel worker swarms per phase

---

## Setup (Before the Demo)

1. Use a project with some known issues (outdated deps, missing tests, lint warnings)
2. Configure:
   ```bash
   cp demos/05-deep-mode-audit/config.json config.json
   ```
3. Let exploration complete before the demo

## Demo Script

### Step 1: Explain Deep Mode (60s)

Show the 5 phases on a slide or whiteboard:

```
Investigate → Report → Plan → Execute → Verify
```

**Talking Point:** "Deep Mode is our structured analysis workflow. Instead of a single AI pass, it runs five phases — each with specialized workers. Think of it as a thorough code review process, automated."

### Step 2: Start Deep Mode (30s)

```
/ai /deep thorough audit the codebase for security issues and test coverage gaps
```

**Talking Point:** "We're using `thorough` mode — it runs all five phases automatically without pausing. In `manual` mode, you'd review each phase before proceeding."

### Step 3: Watch the Investigation Phase (120s)

Show workers spawning:

- Worker 1: Scanning for security patterns (hardcoded secrets, SQL injection, XSS)
- Worker 2: Checking test coverage
- Worker 3: Running dependency audit

**Talking Point:** "Three workers investigating in parallel. Each is specialized — one for security, one for tests, one for dependencies. They can't modify files — read-only profile."

### Step 4: Show the Report (90s)

When the Report phase completes, show the numbered findings list:

```
Finding 1: No input validation on /api/users endpoint
Finding 2: 3 dependencies with known CVEs
Finding 3: Auth module has 0% test coverage
...
```

**Talking Point:** "A structured report with numbered findings. You can drill into any finding with `/focus 1`. In manual mode, you'd review this before the AI starts fixing things."

### Step 5: Show Execute + Verify (120s)

Watch workers:

- Creating input validation
- Updating vulnerable dependencies
- Writing tests for the auth module
- Running the full test suite to verify

**Talking Point:** "The AI is now fixing what it found. And the last phase — Verify — runs the test suite to confirm nothing broke. Five phases, zero manual intervention."

### Step 6: Show Phase Commands (60s)

Demonstrate:

- `/phase` — show current phase and progress
- `/focus 2` — deep-dive into finding #2
- `/skip 3` — skip a task from the plan

**Talking Point:** "Full control at every step. Focus on what matters, skip what doesn't. The AI adapts."

---

## Talking Points Summary

| Point                      | Message                                                    |
| -------------------------- | ---------------------------------------------------------- |
| **Structured workflow**    | 5 phases, not a single AI pass.                            |
| **Automatic or manual**    | `thorough` runs all phases; `manual` pauses for review.    |
| **Parallel investigation** | Multiple workers analyze different aspects simultaneously. |
| **Actionable report**      | Numbered findings, drill-down, skip.                       |
| **Self-verifying**         | Verify phase runs tests after every fix.                   |
