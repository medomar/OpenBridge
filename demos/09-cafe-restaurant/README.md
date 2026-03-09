# Demo 09: Cafe & Restaurant Operations

> **Audience:** Restaurant owners, cafe managers | **Duration:** 15 min | **Difficulty:** Beginner

## Key Message

> "AI assistant for orders, reservations, menu queries, inventory alerts, and staff coordination."

## What This Demo Shows

- WhatsApp ordering with instant confirmation
- Menu FAQ handling with dietary filters
- Reservation booking with availability checks
- Inventory low-stock alerting for fast-moving items
- Daily summary for managers and staff

## Prerequisites

- Node.js 18+ installed
- WhatsApp and Telegram available for demo messages
- A local workspace folder for a cafe management project

## Setup

1. Copy the demo config:
   ```bash
   cp demos/09-cafe-restaurant/config.json config.json
   ```
2. Update `workspacePath` and whitelist values

Example `config.json`:

```json
{
  "workspacePath": "/path/to/your/cafe-restaurant-workspace",
  "channels": [
    { "type": "whatsapp", "enabled": true },
    { "type": "telegram", "enabled": true }
  ],
  "auth": {
    "whitelist": ["+1234567890", "telegram-user"],
    "prefix": "/ai"
  }
}
```

## Demo Script

### Step 1: WhatsApp Ordering (3 min)

Send an order from WhatsApp.

```bash
printf "/ai order 2 cappuccinos and 1 almond croissant for pickup at 10:15\n"
```

**Talking Point:** "Orders land in one place, are parsed instantly, and can route to the barista or POS without extra tools."

### Step 2: Menu FAQ (3 min)

Ask a menu question from Telegram.

```bash
printf "/ai does the quinoa salad have nuts?\n"
```

**Talking Point:** "The assistant answers from the live menu and highlights allergens or substitutions."

### Step 3: Reservation Booking (3 min)

Book a table for a customer.

```bash
printf "/ai book a table for 4 at 7:30pm under Jordan Lee\n"
```

**Talking Point:** "Reservations are captured with constraints, then confirmed with a clear summary."

### Step 4: Inventory Low-Stock Alert (3 min)

Trigger a low-stock check.

```bash
printf "/ai check low stock for espresso beans and oat milk\n"
```

**Talking Point:** "Inventory alerts prevent 86s by flagging the next reorder window early."

### Step 5: Daily Summary (3 min)

Generate a manager recap.

```bash
printf "/ai summarize today: orders, reservations, and low-stock items\n"
```

**Talking Point:** "At close, the assistant produces a clean summary for handoff to the next shift."

## Talking Points Summary

| Point                    | Message                                                         |
| ------------------------ | --------------------------------------------------------------- |
| **Order automation**     | Orders are parsed and routed with minimal staff overhead.       |
| **Menu expertise**       | Guests get fast, accurate answers on ingredients and allergens. |
| **Reservation accuracy** | Bookings capture time, party size, and notes in one flow.       |
| **Inventory protection** | Low-stock alerts reduce outages on high-demand items.           |
| **Shift handoff**        | Daily summaries keep the team aligned.                          |

## Common Questions

**Q: Does it replace our POS?**
A: No. It sits alongside your tools, routing orders and syncing notes without forcing a rip-and-replace.

**Q: Can multiple staff members use it?**
A: Yes. Add additional phone numbers or Telegram users to the whitelist.

**Q: What if the menu changes daily?**
A: Update the menu file in the workspace and the assistant responds immediately.

## Full Vertical Writeup

See `docs/USE_CASES.md` for the full vertical writeup.
