# Demo 12: Accounting Operations

> **Audience:** Accountants, bookkeepers, small business owners | **Duration:** 20 min | **Difficulty:** Intermediate

## Key Message

> "AI assistant for invoice processing, expense categorization, financial reporting, and tax prep."

## What This Demo Shows

- Receipt and invoice processing with line-item extraction
- Expense categorization against a chart of accounts
- Monthly P&L generation with variance highlights
- Tax deadline reminders for upcoming filings

## Prerequisites

- Node.js 18+ installed
- Telegram available for finance team messages
- A local workspace folder for an accounting workspace

## Setup

1. Copy the demo config:
   ```bash
   cp demos/12-accounting/config.json config.json
   ```
2. Update `workspacePath` and whitelist values

Example `config.json`:

```json
{
  "workspacePath": "/path/to/your/accounting-workspace",
  "channels": [{ "type": "telegram", "enabled": true }],
  "auth": {
    "whitelist": ["telegram-user"],
    "prefix": "/ai"
  }
}
```

## Demo Script

### Step 1: Receipt and Invoice Processing (6 min)

Process a new receipt.

```bash
printf "/ai process receipt: vendor Acme Office, $214.50, date 2026-03-01\n"
```

**Talking Point:** "Documents are parsed into clean line items with minimal manual work."

### Step 2: Expense Categorization (5 min)

Categorize the expense.

```bash
printf "/ai categorize expense: Acme Office $214.50 to Office Supplies\n"
```

**Talking Point:** "The assistant applies your chart of accounts consistently."

### Step 3: Monthly P&L Generation (5 min)

Generate the P&L.

```bash
printf "/ai generate March P&L with month-over-month variance\n"
```

**Talking Point:** "Financial reporting is produced instantly and highlights changes that matter."

### Step 4: Tax Deadline Reminders (4 min)

List upcoming deadlines.

```bash
printf "/ai list upcoming tax deadlines for Q2 filings\n"
```

**Talking Point:** "Proactive reminders reduce last-minute rushes and missed filings."

## Talking Points Summary

| Point                       | Message                                                   |
| --------------------------- | --------------------------------------------------------- |
| **Automated intake**        | Receipts and invoices are extracted into structured data. |
| **Accurate categorization** | Expenses map to the correct accounts with consistency.    |
| **Instant reporting**       | P&Ls are generated on demand with variance insights.      |
| **Deadline awareness**      | Reminders keep the team ahead of tax obligations.         |

## Common Questions

**Q: Can it handle multiple entities?**
A: Yes. Separate folders or workspaces can be used per client or entity.

**Q: Does it replace our accounting software?**
A: No. It accelerates workflows while your system of record remains the same.

**Q: How do we audit the outputs?**
A: Every step is logged, and reports are stored in the workspace for review.

## Full Vertical Writeup

See `docs/USE_CASES.md` for the full vertical writeup.
