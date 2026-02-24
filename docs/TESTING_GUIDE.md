# OpenBridge — Testing Guide

> **Last Updated:** 2026-02-21

---

## Overview

This guide covers rapid preprod testing workflows for OpenBridge. The Console connector provides a frictionless testing path that bypasses WhatsApp QR code authentication, enabling fast iteration and validation of all use case scenarios.

---

## Console-Based Preprod Testing (Recommended)

### Why Console Testing?

The Console connector is the **primary rapid testing path** for OpenBridge preprod validation:

- **No QR code dependency** — eliminates WhatsApp setup friction
- **Fast iteration** — test changes in seconds, not minutes
- **CI/CD friendly** — scriptable, automatable, no phone required
- **Full feature parity** — same message routing, auth, Master AI flow as WhatsApp
- **Use case validation** — test business scenarios without device switching

### Quick Start

1. **Create a test config** (`config.test.json`):

```json
{
  "workspacePath": "/absolute/path/to/test/workspace",
  "channels": [
    {
      "type": "console",
      "enabled": true,
      "options": {
        "userId": "test-user",
        "prompt": "> "
      }
    }
  ],
  "auth": {
    "whitelist": ["test-user"],
    "prefix": "/ai"
  }
}
```

2. **Start OpenBridge** with the test config:

```bash
CONFIG_PATH=config.test.json npm run dev
```

3. **Interact via terminal**:

```
> /ai what's in this workspace?
[AI response appears here]

> /ai list all files in the src/ directory
[AI response appears here]

> /ai what's today's revenue?
[AI response appears here]
```

---

## Use Case Testing Matrix

The Console connector enables rapid validation of all USE_CASES.md scenarios:

### 1. Software Development

**Test workspace:** Point at a code project (Node.js, Python, Go, etc.)

```bash
# config.test.json
{
  "workspacePath": "/path/to/your/codebase",
  "channels": [{ "type": "console", "enabled": true }],
  "auth": { "whitelist": ["test-user"], "prefix": "/ai" }
}
```

**Sample queries:**

```
> /ai what's in this project?
> /ai run the tests
> /ai how does the authentication work?
> /ai what dependencies are outdated?
```

**Expected behavior:**

- Exploration creates `.openbridge/workspace-map.json` with code structure
- Responses reference files, functions, and modules by name
- Technical tone, uses programming terminology

### 2. Cafe / Restaurant

**Test workspace:** Create a folder with business files:

```
test-cafe/
  inventory.csv          # ingredient stock levels
  sales-2026-02.csv      # daily revenue data
  menu.txt               # current menu items
  suppliers.txt          # supplier contact list
  schedule.csv           # staff shifts
```

**Sample queries:**

```
> /ai what ingredients are running low?
> /ai what was yesterday's total revenue?
> /ai who's working Saturday morning?
> /ai which menu item has the highest profit margin?
```

**Expected behavior:**

- Exploration detects non-code workspace (no package.json, no code files)
- Responses are conversational, non-technical
- AI correctly parses CSV data and answers business questions
- No crashes when querying available data

### 3. Law Firm

**Test workspace:**

```
test-law-firm/
  contracts/
    acme-corp-nda.txt
    consulting-agreement-2026.txt
  case-files/
    smith-v-jones.md
  deadlines.csv
```

**Sample queries:**

```
> /ai summarize the Acme Corp NDA
> /ai find all liability clauses in the consulting agreement
> /ai what deadlines are coming up this week?
```

**Expected behavior:**

- AI reads document content correctly
- Responses formatted for professional context
- Handles legal terminology appropriately

### 4. Accounting / Bookkeeping

**Test workspace:**

```
test-accounting/
  revenue-q4-2025.csv
  expenses-2026-02.csv
  invoices/
    invoice-001.txt
    invoice-002.txt
  payroll.csv
```

**Sample queries:**

```
> /ai what's the total revenue for Q4?
> /ai which invoices are overdue?
> /ai compare this month's expenses to last month
> /ai flag any expenses over $10k
```

**Expected behavior:**

- AI correctly sums/aggregates CSV data
- Handles financial calculations accurately
- Professional, concise responses

### 5. Multi-Turn Conversations (Session Continuity)

**Test scenario:**

```
> /ai which invoices are overdue?
[AI: "Invoices 003 and 007 are overdue by 15 and 30 days respectively."]

> /ai send reminders to those clients
[AI: "I'll draft reminder emails for invoice 003 (Acme Corp) and 007 (Beta LLC)."]
```

**Expected behavior:**

- Second message references context from first ("those clients")
- Master AI uses `--resume` flag to maintain session
- No need to repeat query context

---

## Testing Workflow

### Daily Development Testing

1. **Create minimal test workspace** with representative files for your target use case
2. **Start Console connector** with test config
3. **Run through typical queries** for that use case category
4. **Verify responses** are accurate, well-formatted, and non-technical (if business workspace)

### Pre-Release Validation

**Run the full use case matrix:**

```bash
# Test code workspace
CONFIG_PATH=config.code.json npm run dev
# Interact: project structure, file contents, technical queries
# Ctrl+C to stop

# Test cafe workspace
CONFIG_PATH=config.cafe.json npm run dev
# Interact: inventory, sales, schedule queries
# Ctrl+C to stop

# Test law firm workspace
CONFIG_PATH=config.law.json npm run dev
# Interact: contract summaries, deadline queries
# Ctrl+C to stop

# Test accounting workspace
CONFIG_PATH=config.accounting.json npm run dev
# Interact: revenue, expenses, invoice queries
# Ctrl+C to stop
```

**Checklist:**

- [ ] All use case categories respond accurately
- [ ] Non-code workspaces get conversational (non-technical) tone
- [ ] Session continuity works (multi-turn context is preserved)
- [ ] Graceful "unknown" responses when data doesn't exist
- [ ] No crashes or empty responses
- [ ] `.openbridge/` folder created with correct structure

---

## Automated E2E Testing

Console connector is fully testable in CI/CD:

```typescript
// tests/e2e/console-preprod.test.ts
import { describe, it, expect } from 'vitest';
import { ConsoleConnector } from '../../src/connectors/console/console-connector.js';
// ... test implementation
```

See `tests/e2e/non-code-workspace-e2e.test.ts` for a complete example of automated Console-based testing with a cafe business scenario.

---

## Console vs WhatsApp Testing

| Aspect              | Console                     | WhatsApp                               |
| ------------------- | --------------------------- | -------------------------------------- |
| **Setup Time**      | 5 seconds (edit config)     | 30+ seconds (QR scan, phone auth)      |
| **Device Required** | None                        | Phone with WhatsApp                    |
| **CI/CD Support**   | Full (scriptable)           | None (requires interactive QR)         |
| **Iteration Speed** | Instant (restart + type)    | Slow (QR rescan if session expires)    |
| **Session Sharing** | Local only                  | Multi-device (phone + computer)        |
| **Best For**        | Preprod, dev, CI/CD testing | Production use, real user interactions |

**Recommendation:** Use Console for all preprod testing and development. Switch to WhatsApp for final production validation and real-world user acceptance testing.

---

## Common Testing Patterns

### Test Graceful "Unknown" Handling

**Scenario:** User asks about data that doesn't exist

```
> /ai what's today's revenue?
```

**Expected (if no sales file exists):**

```
I don't see any sales or revenue data in this workspace. The workspace contains [list actual files]. If you'd like to track revenue, you can add a CSV file with sales data.
```

**NOT expected:**

- Empty response
- Error/crash
- Hallucinated data

### Test Incremental Exploration

**Scenario:** Verify exploration completes in 5 passes

**Method:**

1. Start OpenBridge with Console connector
2. Monitor logs for exploration phases
3. Check `.openbridge/exploration/exploration-state.json`

**Expected:**

- Phases: structure_scan → classification → directory_dives → assembly → finalization
- Each phase checkpointed (state file updates after each)
- Final `workspace-map.json` exists
- No timeout errors (143 exit code)

### Test Session Continuity

**Scenario:** Multi-turn conversation

```
> /ai list all menu items with prices over $10
[AI: "Steak Sandwich ($12), Lobster Roll ($15), Salmon Platter ($18)"]

> /ai which one has the best profit margin?
[AI references previous list without needing to re-query]
```

**Verification:**

- Check logs for `--resume <session-id>` flag in Claude CLI call
- Verify second response contextually references first query

---

## Troubleshooting Console Testing

### Issue: Prompt doesn't appear

**Cause:** Connector not initialized

**Fix:** Check logs for "Console connector ready" message. If missing, check config validation errors.

### Issue: Messages not routed to Master AI

**Cause:** Sender not whitelisted or prefix missing

**Fix:**

```json
{
  "auth": {
    "whitelist": ["test-user"], // Must match options.userId
    "prefix": "/ai" // Include in every message
  }
}
```

### Issue: Empty or generic responses

**Cause:** Workspace exploration incomplete or failed

**Fix:**

1. Check `.openbridge/exploration/exploration-state.json` for phase status
2. Look for errors in logs during exploration
3. Manually delete `.openbridge/` and restart to re-trigger exploration

### Issue: Non-technical tone expected but got technical

**Cause:** Workspace contains code files (package.json, _.ts, _.py)

**Fix:** Ensure test workspace has ONLY business files (CSV, TXT, MD, XLSX). Remove any code artifacts.

---

## Next Steps

- **Extend test coverage:** Add Console-based E2E tests for each use case category
- **CI integration:** Run Console tests in GitHub Actions on every PR
- **Performance benchmarks:** Measure response time for Console vs WhatsApp
- **Multi-connector testing:** Test Console + WhatsApp running simultaneously

---

## Related Documentation

- [USE_CASES.md](USE_CASES.md) — All supported business scenarios
- [CONFIGURATION.md](CONFIGURATION.md) — Console connector config reference
- [ARCHITECTURE.md](ARCHITECTURE.md) — How message routing works
- [TROUBLESHOOTING.md](TROUBLESHOOTING.md) — Common issues and fixes
