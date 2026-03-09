# Demo 11: Real Estate Operations

> **Audience:** Real estate agents, property managers | **Duration:** 15 min | **Difficulty:** Beginner

## Key Message

> "AI assistant for property listings, client matching, viewing scheduling, and market analysis."

## What This Demo Shows

- Property inquiry handling with instant responses
- Automated listing description drafting
- Viewing scheduling with calendar-ready details
- Market report generation for a target neighborhood

## Prerequisites

- Node.js 18+ installed
- WhatsApp or WebChat available for client inquiries
- A local workspace folder for a real estate CRM

## Setup

1. Copy the demo config:
   ```bash
   cp demos/11-real-estate/config.json config.json
   ```
2. Update `workspacePath` and whitelist values

Example `config.json`:

```json
{
  "workspacePath": "/path/to/your/real-estate-workspace",
  "channels": [
    { "type": "whatsapp", "enabled": true },
    { "type": "webchat", "enabled": true }
  ],
  "auth": {
    "whitelist": ["+1234567890", "webchat-user"],
    "prefix": "/ai"
  }
}
```

## Demo Script

### Step 1: Property Inquiry Handling (4 min)

Respond to a buyer inquiry.

```bash
printf "/ai respond to inquiry: 2-bed condo under $650k near Mission Bay\n"
```

**Talking Point:** "Inquiries are answered quickly with relevant listings and next steps."

### Step 2: Listing Description Drafting (4 min)

Create a new listing description.

```bash
printf "/ai draft a listing description for 412 Pine St, 3-bed, 2-bath, renovated kitchen\n"
```

**Talking Point:** "Listings are generated in your voice and can be refined in seconds."

### Step 3: Viewing Scheduler (4 min)

Schedule a viewing.

```bash
printf "/ai schedule a viewing for Jordan Lee, Saturday 11am, 412 Pine St\n"
```

**Talking Point:** "Scheduling captures availability and produces a clear confirmation message."

### Step 4: Market Report Generation (3 min)

Request a neighborhood snapshot.

```bash
printf "/ai generate a market report for Mission Bay: pricing trends and days on market\n"
```

**Talking Point:** "Market insights are assembled quickly to help clients decide."

## Talking Points Summary

| Point                   | Message                                                |
| ----------------------- | ------------------------------------------------------ |
| **Rapid responses**     | Clients get answers immediately, improving conversion. |
| **Listing quality**     | Drafts are consistent and on-brand for the brokerage.  |
| **Scheduling clarity**  | Viewings are confirmed with fewer back-and-forths.     |
| **Market intelligence** | Reports help agents win client trust.                  |

## Common Questions

**Q: Can it match buyers to listings automatically?**
A: Yes. The assistant can score listings against buyer criteria in the workspace.

**Q: Does it work for rentals and sales?**
A: Yes. The same workflow supports rental listings and purchase listings.

**Q: Can we customize the tone of listings?**
A: Absolutely. Update the templates in your workspace to match your brand voice.

## Full Vertical Writeup

See `docs/USE_CASES.md` for the full vertical writeup.
