# Demo 10: Law Firm Operations

> **Audience:** Law firm partners, legal ops managers | **Duration:** 20 min | **Difficulty:** Intermediate

## Key Message

> "AI assistant for case research, document drafting, client intake, and deadline tracking."

## What This Demo Shows

- Client intake via WhatsApp with structured matter creation
- Case summary generation from existing files
- Legal document drafting with clause reuse
- Deadline reminders and docket tracking

## Prerequisites

- Node.js 18+ installed
- WhatsApp available for client intake demo
- A local workspace folder for a legal practice management system

## Setup

1. Copy the demo config:
   ```bash
   cp demos/10-law-firm/config.json config.json
   ```
2. Update `workspacePath` and whitelist values

Example `config.json`:

```json
{
  "workspacePath": "/path/to/your/law-firm-workspace",
  "channels": [{ "type": "whatsapp", "enabled": true }],
  "auth": {
    "whitelist": ["+1234567890"],
    "prefix": "/ai"
  }
}
```

## Demo Script

### Step 1: Client Intake via WhatsApp (5 min)

Capture a new client matter.

```bash
printf "/ai intake new client: Pat Morgan, employment dispute, needs consult next week\n"
```

**Talking Point:** "Intake is structured automatically, so staff spend less time on manual data entry."

### Step 2: Case Summary Generation (5 min)

Summarize a matter from the workspace.

```bash
printf "/ai summarize case file for Morgan v. Northwind\n"
```

**Talking Point:** "The assistant reads the case folder and produces a concise briefing for partners."

### Step 3: Legal Document Drafting (5 min)

Draft a first-pass document.

```bash
printf "/ai draft a demand letter with the standard employment retaliation clauses\n"
```

**Talking Point:** "Drafts follow your templates and clause library, reducing repetitive work."

### Step 4: Deadline Reminders (5 min)

Request upcoming deadlines.

```bash
printf "/ai list all deadlines in the next 14 days for Morgan v. Northwind\n"
```

**Talking Point:** "Deadlines are tracked and surfaced on demand to avoid missed filings."

## Talking Points Summary

| Point                     | Message                                               |
| ------------------------- | ----------------------------------------------------- |
| **Structured intake**     | Client details are captured cleanly on first contact. |
| **Fast case context**     | Summaries provide immediate briefing value.           |
| **Drafting acceleration** | Reusable clauses reduce drafting time.                |
| **Deadline protection**   | Reminders lower the risk of missed filings.           |

## Common Questions

**Q: Is client data kept private?**
A: Yes. The bridge runs locally and only uses the AI providers you already authorize.

**Q: Can we lock down who can message the assistant?**
A: Yes. Only whitelisted numbers can initiate intake or drafting requests.

**Q: Does it integrate with our DMS?**
A: It works with any files in the workspace, and integrations can be added later.

## Full Vertical Writeup

See `docs/USE_CASES.md` for the full vertical writeup.
