# OpenBridge — Use Cases

> Beyond code. OpenBridge works for any business with files to query, analyze, or act on — all from your phone.

---

## How It Works (For Any Business)

1. Point OpenBridge at a folder containing your business data (spreadsheets, docs, reports, configs)
2. Connect your WhatsApp
3. Send messages — the AI reads your files, answers questions, and executes tasks

---

## Software Development

Point it at your codebase.

```
/ai what's in this project?
/ai run the tests and fix any failures
/ai how does the payment flow work?
/ai add input validation to the login endpoint
/ai refactor the user model to add role-based access
/ai what changed since yesterday?
```

---

## Cafe / Restaurant

Point it at your menus, inventory sheets, supplier contacts, sales reports, and staff schedules.

### Inventory & Ordering

```
/ai what ingredients are running low this week?
/ai draft a reorder email to our dairy supplier for 50L milk and 10kg butter
/ai compare last month's food cost to this month
```

### Menu Management

```
/ai add a new seasonal item: Iced Lavender Latte, $6.50, ingredients: espresso, milk, lavender syrup
/ai which menu items have the highest profit margin?
/ai generate a weekend specials list from what we have in stock
```

### Sales & Finance

```
/ai what was today's revenue?
/ai which day of the week has the highest sales?
/ai summarize this month's expenses by category
```

### Staff

```
/ai who's scheduled for Saturday morning?
/ai swap Ahmed and Sara's shifts on Tuesday
/ai how many overtime hours did the team log this month?
```

### Customers

```
/ai draft a WhatsApp broadcast for our Friday couscous special
/ai what are the top 5 most ordered items this month?
/ai create a loyalty reward message for customers with 10+ visits
```

---

## Law Firm

Point it at contracts, case files, and legal documents.

```
/ai summarize the NDA with Acme Corp
/ai find all clauses about liability in the last 10 contracts
/ai draft a response to opposing counsel's motion
/ai what deadlines are coming up this week?
/ai compare the terms in contract A vs contract B
```

---

## Real Estate Agency

Point it at listing data, property documents, and client files.

```
/ai what properties under $500k have been listed this week?
/ai generate a comparison sheet for 123 Main St vs 456 Oak Ave
/ai draft a follow-up email for the Johnson showing
/ai which listings have been on the market for more than 30 days?
/ai summarize the inspection report for 789 Pine Rd
```

---

## Accounting / Bookkeeping

Point it at financial records, CSV exports, and tax documents.

```
/ai what's the total revenue for Q4?
/ai flag any expenses over $10k that aren't categorized
/ai prepare a summary for the client meeting tomorrow
/ai which invoices are overdue?
/ai compare this year's payroll costs to last year
```

---

## Marketing Agency

Point it at campaign folders, analytics reports, and content drafts.

```
/ai how did the Instagram campaign perform last month?
/ai rewrite this ad copy for a younger audience
/ai create a content calendar for March
/ai which campaign had the best ROI this quarter?
/ai draft 5 tweet variations for the product launch
```

---

## Healthcare Clinic (Admin)

Point it at scheduling data, patient intake forms, and operational docs.

```
/ai how many appointments were missed this week?
/ai draft a reminder template for no-shows
/ai summarize the new compliance policy changes
/ai what's the average wait time this month?
/ai generate a staffing report for next week
```

---

## Connecting OpenBridge to External Services (MCP)

OpenBridge supports [MCP (Model Context Protocol)](https://modelcontextprotocol.io) — the open standard for connecting AI agents to external services. When MCP servers are configured, workers can call Gmail, Canva, Slack, GitHub, databases, and any other MCP-compatible service directly from a WhatsApp or Console message.

> **Requirement:** Claude must be installed on your machine. MCP via `--mcp-config` is a Claude CLI feature. Codex has native MCP support wired separately.

### How It Works — End-to-End

Here is the complete flow when a user asks OpenBridge to create a Canva banner:

```
1. You send a WhatsApp message:
   "create a banner for our Friday sale — 50% off all pastries"

2. OpenBridge Router receives the message, checks your number is whitelisted.

3. Master AI decides:
   - This task needs the Canva MCP server to create a design
   - Spawns a worker with: --mcp-config /tmp/ob-mcp-<id>.json --strict-mcp-config
   - The temp config contains ONLY the canva server (not gmail, not slack)

4. The Worker runs:
   claude --print --mcp-config /tmp/ob-mcp-123.json --strict-mcp-config \
     "Create a promotional banner in Canva: 'Friday Sale — 50% off all pastries'.
      Use brand colors. Return the shareable link."

5. Claude CLI spawns the Canva MCP server process, calls its tools:
   - mcp__canva__search_designs (finds brand templates)
   - mcp__canva__generate_design (creates the banner)
   - mcp__canva__export_design (gets the shareable URL)

6. Worker returns the Canva link to the Master AI.

7. Master formats the response and sends it back to WhatsApp:
   "Done! Your Friday sale banner is ready: https://www.canva.com/design/..."
```

### Setup: Canva MCP Server

**Step 1 — Install Claude Code** (if not already installed):

```bash
npm install -g @anthropic-ai/claude-code
```

**Step 2 — Add the MCP server to your `config.json`**:

```json
{
  "workspacePath": "/path/to/your/project",
  "channels": [{ "type": "whatsapp", "enabled": true }],
  "auth": { "whitelist": ["+1234567890"] },
  "mcp": {
    "enabled": true,
    "servers": [
      {
        "name": "canva",
        "command": "npx",
        "args": ["-y", "@anthropic/canva-mcp-server@latest"],
        "env": {
          "CANVA_API_KEY": "your-canva-api-key-here"
        }
      }
    ]
  }
}
```

**Step 3 — Get your Canva API key**:

1. Go to [canva.com/developers](https://www.canva.com/developers/)
2. Create an integration and copy the API key
3. Paste it into the `CANVA_API_KEY` field above

**Step 4 — Start OpenBridge**:

```bash
npm run dev
```

On startup, OpenBridge validates the MCP server and includes it in the Master AI's system prompt. The Master knows Canva is available and will automatically give it to workers that need it.

**Step 5 — Send a message**:

```
/ai create a product launch banner for our new coffee blend
```

That's it. The Master AI decides whether and when to use Canva — no manual wiring required.

---

### More MCP Use Cases

#### Gmail — Send Email from WhatsApp

```json
{
  "name": "gmail",
  "command": "npx",
  "args": ["-y", "@anthropic/gmail-mcp-server@latest"],
  "env": { "GMAIL_OAUTH_TOKEN": "your-token" }
}
```

```
/ai email our top 10 customers a summary of this month's promotions
/ai draft and send the supplier reorder email for milk and butter
/ai check if the Johnson invoice reply came in
```

#### Slack — Post Updates from WhatsApp

```json
{
  "name": "slack",
  "command": "npx",
  "args": ["-y", "@anthropic/slack-mcp-server@latest"],
  "env": { "SLACK_BOT_TOKEN": "xoxb-..." }
}
```

```
/ai post today's sales summary to the #sales Slack channel
/ai send a staff alert about the Saturday shift change
/ai check if there are any urgent messages in #ops
```

#### GitHub — Manage Issues from WhatsApp

```json
{
  "name": "github",
  "command": "npx",
  "args": ["-y", "@modelcontextprotocol/server-github@latest"],
  "env": { "GITHUB_PERSONAL_ACCESS_TOKEN": "ghp_..." }
}
```

```
/ai what issues are open in the api-service repo?
/ai create a bug report for the login timeout issue
/ai close issue #142 — it was fixed in today's deploy
```

#### Reuse Existing Claude Desktop Config

If you already have MCP servers configured in Claude Desktop, import them directly — no need to duplicate:

```json
{
  "mcp": {
    "enabled": true,
    "configPath": "~/.claude/claude_desktop_config.json"
  }
}
```

All servers from your Claude Desktop config become available to OpenBridge workers instantly.

---

### Security Model

OpenBridge uses **per-worker MCP isolation** to prevent cross-contamination of API keys:

- Each worker gets a **temporary config file** containing only the MCP servers it specifically needs
- `--strict-mcp-config` prevents the worker from inheriting any global MCP configs
- The Master AI autonomously decides which servers each worker gets — no manual assignment needed
- Temp files are deleted immediately after the worker exits

A worker handling a Gmail task never sees your Canva API key, and vice versa.

> Browse available MCP servers at [modelcontextprotocol.io](https://modelcontextprotocol.io) and the [MCP servers GitHub repo](https://github.com/modelcontextprotocol/servers).

---

## The Pattern

Every business has the same setup:

| Step | What you do                         |
| ---- | ----------------------------------- |
| 1    | Put your business files in a folder |
| 2    | Point OpenBridge at that folder     |
| 3    | Message from your phone             |

The owner doesn't touch a computer. **Your phone becomes the control panel for your business data.**
