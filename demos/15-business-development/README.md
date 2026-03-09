# Demo 15: Business Development

> **Audience:** BD managers, sales teams, startup founders | **Duration:** 15 min | **Difficulty:** Intermediate

## Key Message

> "AI assistant for lead prospection, outreach automation, CRM pipeline management, and meeting prep."

## What This Demo Shows

- Lead qualification via messaging
- Automated outreach drafting with personalization
- Pipeline status report from CRM notes
- Meeting brief generation and follow-up reminders

## Prerequisites

- Node.js >= 22
- At least one AI tool installed (Claude Code, Codex, or Aider)
- A BD workspace with lead lists, personas, and CRM exports
- Advanced setup: MCP connectors for LinkedIn (custom), Gmail MCP, and HubSpot or Pipedrive MCP

## Setup

1. Copy the demo config:
   ```bash
   cp demos/15-business-development/config.json config.json
   ```
2. Edit `workspacePath` to point at your BD workspace
3. Confirm WhatsApp and Console are enabled for demo control

`config.json` example:

```json
{
  "workspacePath": "/path/to/your/business-development-workspace",
  "channels": [
    { "type": "whatsapp", "enabled": true },
    { "type": "console", "enabled": true }
  ],
  "auth": {
    "whitelist": ["+15559876543", "console-user"],
    "prefix": "/ai"
  }
}
```

## Demo Script

1. **Show the config**

   ```bash
   cat config.json
   ```

   **Talking Point:** "The workspace contains lead lists and CRM exports, while WhatsApp keeps the demo conversational."

2. **Start OpenBridge**

   ```bash
   npm run dev
   ```

   **Talking Point:** "OpenBridge scans the workspace so the assistant can reference leads and pipeline context immediately."

3. **Qualify a lead via messaging**

   ```text
   Lead: /ai We're evaluating a CRM upgrade for a 25-person sales team. Can you share pricing and timelines?
   ```

   **Talking Point:** "The assistant extracts qualification signals like team size, urgency, and decision stage."

4. **Draft automated outreach**

   ```text
   > /ai draft a personalized outreach email for Jordan Lee at Acme Retail using the lead notes and persona guidelines
   ```

   **Talking Point:** "Outreach is tailored using internal notes, not generic templates."

5. **Generate a pipeline status report**

   ```text
   > /ai summarize pipeline status by stage and flag deals at risk from the latest CRM export
   ```

   **Talking Point:** "It turns raw CRM exports into an executive-ready summary."

6. **Create a meeting brief**

   ```text
   > /ai generate a meeting brief for tomorrow's call with Acme Retail, including goals, objections, and next steps
   ```

   **Talking Point:** "Preps the team with key context and suggested talking points."

7. **Schedule follow-up reminders**
   ```text
   > /ai list follow-up reminders for all leads who requested proposals this week
   ```
   **Talking Point:** "Keeps momentum by turning conversations into follow-up tasks."

## Talking Points Summary

| Point                     | Message                                                         |
| ------------------------- | --------------------------------------------------------------- |
| **Lead qualification**    | Extracts buying signals from incoming messages.                 |
| **Personalized outreach** | Drafts emails using internal lead notes and persona guidelines. |
| **Pipeline visibility**   | Summarizes CRM exports into pipeline health insights.           |
| **Meeting prep**          | Produces briefs with goals, risks, and next actions.            |
| **Follow-up discipline**  | Converts activity into reminders so deals keep moving.          |

## Common Questions

**Q: Can it sync directly with our CRM?**
A: Yes, via MCP connectors like HubSpot or Pipedrive when enabled.

**Q: Does it write to Gmail or LinkedIn?**
A: With Gmail MCP and a custom LinkedIn MCP connector, it can draft or send messages based on your policies.

**Q: Is this limited to WhatsApp?**
A: No, you can use Console, WebChat, or other channels depending on your org's preferences.

## Full Vertical Writeup

See `docs/USE_CASES.md` for the full business development vertical writeup.
