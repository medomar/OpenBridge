# Demo 13: Marketing Agency

> **Audience:** Marketing managers, agency owners, content teams | **Duration:** 15 min | **Difficulty:** Beginner

## Key Message

> "AI assistant for campaign management, content creation, social media scheduling, and analytics reporting."

## What This Demo Shows

- Campaign content brief generation in minutes
- Social media post drafting with consistent brand voice
- Campaign performance summary from metrics
- Competitor snapshot and positioning insights

## Prerequisites

- Node.js >= 22
- At least one AI tool installed (Claude Code, Codex, or Aider)
- A marketing workspace folder with campaign notes, briefs, and metrics

## Setup

1. Copy the demo config:
   ```bash
   cp demos/13-marketing-agency/config.json config.json
   ```
2. Edit `workspacePath` to point at your marketing workspace
3. Start OpenBridge when ready

`config.json` example:

```json
{
  "workspacePath": "/path/to/your/marketing-workspace",
  "channels": [
    { "type": "webchat", "enabled": true },
    { "type": "console", "enabled": true }
  ],
  "auth": {
    "whitelist": ["console-user"],
    "prefix": "/ai"
  }
}
```

## Demo Script

1. **Show the config**

   ```bash
   cat config.json
   ```

   **Talking Point:** "The workspace points to our marketing assets. Two channels are enabled so teams can use WebChat or Console."

2. **Start OpenBridge**

   ```bash
   npm run dev
   ```

   **Talking Point:** "OpenBridge discovers the installed AI tools and pre-scans the workspace for campaign context."

3. **Generate a campaign content brief**

   ```text
   > /ai create a content brief for a 4-week launch campaign for the new Breeze CRM, including target audience, key messages, and content themes
   ```

   **Talking Point:** "We go from scattered notes to a structured brief in seconds."

4. **Draft social media posts**

   ```text
   > /ai draft 5 LinkedIn posts and 5 X posts for the Breeze CRM launch using our brand voice and the content brief
   ```

   **Talking Point:** "The assistant adapts tone and format per channel while staying on brand."

5. **Summarize campaign performance**

   ```text
   > /ai summarize the last 2 weeks of campaign performance and call out the top 3 winning messages
   ```

   **Talking Point:** "It can read the metrics files and deliver a clear executive summary."

6. **Run a competitor snapshot**
   ```text
   > /ai provide a competitor analysis comparing Breeze CRM with Atlas CRM and Northwind CRM using our positioning notes
   ```
   **Talking Point:** "Competitive insights are grounded in our internal positioning docs, not generic internet answers."

## Talking Points Summary

| Point                       | Message                                                     |
| --------------------------- | ----------------------------------------------------------- |
| **Speed to brief**          | Turns scattered notes into a ready-to-use campaign brief.   |
| **On-brand content**        | Drafts posts that follow the team's tone and guidelines.    |
| **Performance clarity**     | Summarizes metrics into decisions, not just numbers.        |
| **Competitive positioning** | Compares against rivals using internal positioning sources. |
| **Multi-channel delivery**  | Works in WebChat for teams or Console for power users.      |

## Common Questions

**Q: Can it ingest analytics from our dashboards?**
A: Yes, as long as the exports or summaries are saved in the workspace, the assistant can analyze them.

**Q: Will it keep our brand voice?**
A: Store brand guidelines in the workspace and the assistant will follow them in drafts.

**Q: Does it schedule posts directly?**
A: Scheduling can be added via MCP connectors, but this demo focuses on content generation and summaries.

## Full Vertical Writeup

See `docs/USE_CASES.md` for the full marketing agency vertical writeup.
