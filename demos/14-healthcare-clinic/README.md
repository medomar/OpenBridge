# Demo 14: Healthcare Clinic

> **Audience:** Clinic administrators, healthcare providers | **Duration:** 20 min | **Difficulty:** Intermediate

## Key Message

> "AI assistant for appointment booking, patient FAQ, triage routing, staff notifications, and compliance reminders."

## What This Demo Shows

- Patient appointment booking via WhatsApp
- FAQ handling for common patient questions
- Triage routing based on symptoms and urgency
- Daily schedule summary for staff
- HIPAA compliance reminder workflow

## Prerequisites

- Node.js >= 22
- At least one AI tool installed (Claude Code, Codex, or Aider)
- WhatsApp channel configured for clinic inbox
- A clinic management workspace with schedules, FAQs, and policy docs

## Setup

1. Copy the demo config:
   ```bash
   cp demos/14-healthcare-clinic/config.json config.json
   ```
2. Edit `workspacePath` to point at your clinic workspace
3. Add the clinic WhatsApp number to the auth whitelist

`config.json` example:

```json
{
  "workspacePath": "/path/to/your/clinic-workspace",
  "channels": [
    { "type": "whatsapp", "enabled": true },
    { "type": "console", "enabled": true }
  ],
  "auth": {
    "whitelist": ["+15551234567", "console-user"],
    "prefix": "/ai"
  }
}
```

## Demo Script

1. **Show the config**

   ```bash
   cat config.json
   ```

   **Talking Point:** "We enable WhatsApp for patients and Console for staff back office workflows."

2. **Start OpenBridge**

   ```bash
   npm run dev
   ```

   **Talking Point:** "The assistant scans clinic FAQs, schedule templates, and compliance policies on startup."

3. **Book a patient appointment (WhatsApp)**

   ```text
   Patient: /ai I need an appointment for a persistent cough next week after 3pm
   ```

   **Talking Point:** "The assistant captures intent, checks availability, and proposes times."

4. **Handle a patient FAQ**

   ```text
   Patient: /ai What insurance plans do you accept for pediatric visits?
   ```

   **Talking Point:** "Answers are grounded in the clinic's stored FAQ and policy docs."

5. **Route triage priority**

   ```text
   Staff: /ai triage this message: 'Severe chest pain and shortness of breath for 30 minutes'
   ```

   **Talking Point:** "It flags urgent cases and routes them to the correct on-call provider."

6. **Summarize the daily schedule**

   ```text
   > /ai summarize today's schedule by provider and note any gaps or overbooked slots
   ```

   **Talking Point:** "Clinics get a quick operational snapshot without opening multiple systems."

7. **Send a HIPAA compliance reminder**
   ```text
   > /ai draft a HIPAA compliance reminder for staff about secure messaging and PHI handling
   ```
   **Talking Point:** "Compliance stays top of mind with pre-approved reminders."

## Talking Points Summary

| Point                   | Message                                       |
| ----------------------- | --------------------------------------------- |
| **Patient access**      | Book appointments directly from WhatsApp.     |
| **Reliable FAQs**       | Pulls answers from clinic-approved sources.   |
| **Triage safety**       | Escalates urgent symptoms with clear routing. |
| **Operational clarity** | Daily schedules summarized in seconds.        |
| **Compliance support**  | Automates reminders for HIPAA-safe workflows. |

## Common Questions

**Q: Does it replace the scheduling system?**
A: No, it assists staff and patients. It can draft or suggest booking details, then staff confirm in the system of record.

**Q: How do we ensure compliant responses?**
A: Store policy documents and approved language in the workspace so the assistant follows them.

**Q: Can it notify staff automatically?**
A: Yes, notifications can be wired through channels or MCP connectors depending on your setup.

## Full Vertical Writeup

See `docs/USE_CASES.md` for the full healthcare clinic vertical writeup.
