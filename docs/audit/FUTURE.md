# OpenBridge — Future Work

> **Purpose:** Deferred items and backlog for future versions.
> **Last Updated:** 2026-03-12 | **Current Release:** v0.0.15 (1332 tasks shipped, 177 findings fixed)
> **Active Development:** v0.1.0–v0.1.7 Business Platform — 173 tasks across Phases 116–127 (see [TASKS.md](TASKS.md))
> **Status:** Business platform implementation in progress.

---

## Now Scoped (Moved to TASKS.md)

The following items from the previous backlog are now part of the active task list:

| Feature                  | Scoped As                         | Phase |
| ------------------------ | --------------------------------- | ----- |
| Scheduled tasks          | Workflow Engine schedule triggers | 121   |
| Webhook connector        | Integration Hub webhook router    | 119   |
| Secrets management       | Credential Store (AES-256-GCM)    | 119   |
| Email template generator | Business Document Generation      | 122   |
| Browser automation skill | Deferred (see backlog below)      | —     |

---

## Backlog (Unscoped Ideas)

| Feature                        | Description                                                                                                    | Notes                     | Inspired By                         |
| ------------------------------ | -------------------------------------------------------------------------------------------------------------- | ------------------------- | ----------------------------------- |
| E2E test: business files       | CSV workspace E2E test                                                                                         | Testing gap               | —                                   |
| AI tool marketplace            | Browse and install community-built connectors and providers                                                    | Plugin ecosystem          | —                                   |
| WhatsApp session persist       | Avoid re-scan when session expires                                                                             | UX improvement            | —                                   |
| Access Control Dashboard       | Web-based UI for managing per-user access control                                                              | ~10–15 tasks              | —                                   |
| Server Deployment Mode         | Docker container + headless mode for VPS/cloud                                                                 | Infrastructure            | —                                   |
| MCP server builder skill       | Master auto-generates MCP server stubs for custom integrations ("connect my Notion")                           | Extends MCP ecosystem     | awesome-claude-skills (mcp-builder) |
| Browser automation skill       | Playwright-based web scraping, form filling, and UI testing via workers                                        | Extends worker capability | awesome-claude-skills (playwright)  |
| iOS/Android testing skill      | Mobile app build + simulator testing via workers                                                               | Mobile development        | awesome-claude-skills (ios-sim)     |
| Scientific computing skill     | Data science libraries (pandas, numpy, scipy) integration for analysis workers                                 | Research use case         | awesome-claude-skills (scientific)  |
| Multi-agent startup mode       | Loki-mode inspired — orchestrate 30+ agents across functional swarms for large projects                        | Advanced orchestration    | awesome-claude-skills (loki-mode)   |
| Sandbox-first deployments      | Workers deploy preview apps in sandboxed containers with temp public URLs (extends tunnel + Docker)            | Manus pattern             | system-prompts (Manus)              |
| Atomic task decomposition      | Master breaks tasks into verb-led, single-outcome, ≤14-word items for clearer worker instructions              | Cursor pattern            | system-prompts (Cursor)             |
| Parallel-by-default spawning   | Master spawns independent workers simultaneously by default, with explicit dependency detection for sequencing | Cursor pattern            | system-prompts (Cursor)             |
| Worker reasoning checkpoints   | Workers run self-check ("Am I sure?") before destructive operations (git push, file delete, deploy)            | Devin pattern             | system-prompts (Devin)              |
| Construction industry template | DocTypes + workflows for construction project management                                                       | Phase 124 extension       | —                                   |
| Healthcare template            | Patient records, appointments, prescriptions DocTypes                                                          | Regulated industry        | —                                   |
| Education template             | Students, courses, grades, attendance DocTypes                                                                 | Education sector          | —                                   |
| NATS JetStream connector       | Direct NATS/JetStream event subscription for real-time event-driven integrations                               | Event-driven architecture | n8n webhook triggers                |
| Multi-tenant deployment        | Multiple businesses on one OpenBridge instance with data isolation                                             | SaaS pattern              | Twenty CRM per-workspace schema     |
| Mobile app (React Native)      | Native mobile client for OpenBridge with push notifications                                                    | Mobile access             | —                                   |
| Voice-first interface          | Full voice conversation via WhatsApp audio → transcription → AI → TTS → audio reply                            | Accessibility             | —                                   |
| Dashboard builder              | Drag-and-drop dashboard creation from DocType data (Chart.js + gridstack.js)                                   | Business intelligence     | Metabase, Odoo dashboards           |
| Approval chain workflows       | Multi-level approval (manager → director → CFO) with escalation                                                | Enterprise governance     | Odoo approval module                |
| Multi-currency support         | Currency conversion in DocType computed fields, exchange rate feeds                                            | International business    | Odoo multi-currency accounting      |
| Inventory management module    | Stock levels, reorder points, purchase orders, warehouse locations                                             | Retail/wholesale          | Odoo inventory, ERPNext stock       |
| Video/audio processing         | Whisper transcription + ffmpeg frame extraction for video/audio business files                                 | Phase 116 extension       | STRATEGY.md §5                      |
| MySQL database adapter         | `mysql2` integration adapter alongside PostgreSQL                                                              | Phase 120 extension       | IMPLEMENTATION-PLAN §C15            |
| MongoDB database adapter       | `mongodb` native driver integration adapter                                                                    | Phase 120 extension       | STRATEGY.md §7                      |
| Odoo integration adapter       | REST/XML-RPC adapter for Odoo ERP (10M+ users)                                                                 | P1 integration            | STRATEGY.md §7                      |
| ERPNext integration adapter    | REST adapter for ERPNext/Frappe ERP                                                                            | P1 integration            | STRATEGY.md §7                      |
| QuickBooks/Xero adapter        | Accounting platform adapters for financial data sync                                                           | P2 integration            | STRATEGY.md §7                      |
| WhatsApp Business API          | Official WhatsApp Business API adapter (replaces whatsapp-web.js for enterprise)                               | Enterprise upgrade        | STRATEGY.md §7                      |
| Shopify/WooCommerce adapters   | E-commerce platform adapters for product/order sync                                                            | P3 integration            | STRATEGY.md §7                      |
| Logistics industry template    | Delivery routes, fleet tracking, warehouse DocTypes + workflows                                                | Phase 124 extension       | STRATEGY.md §10                     |
| Professional services template | Law firm, consulting, accounting DocTypes (clients, cases, billable hours)                                     | Phase 124 extension       | STRATEGY.md §10                     |
| Template marketplace           | Community-contributed industry templates with install/publish                                                  | Plugin ecosystem          | STRATEGY.md §21                     |
| WebChat file reception         | Wire document processing into WebChat connector file uploads                                                   | Phase 116 extension       | Connector parity                    |
| Discord file reception         | Wire document processing into Discord connector file attachments                                               | Phase 116 extension       | Connector parity                    |
| `call_integration` hook type   | DocType lifecycle hook that calls an integration adapter action                                                | Phase 118 extension       | IMPLEMENTATION-PLAN §B, Part 4      |
| GraphQL adapter                | Auto-discover and connect to any GraphQL API via introspection                                                 | Phase 123 extension       | STRATEGY.md §7                      |

---

## How to Start a New Feature

1. Create a new finding in [FINDINGS.md](FINDINGS.md) if the feature addresses a gap
2. Design the implementation and estimate tasks
3. Add a new phase section to [TASKS.md](TASKS.md) with task IDs
4. Update [ROADMAP.md](../ROADMAP.md) to reflect the new phase
5. Implement, test, and mark tasks as Done
6. Archive completed tasks when the phase ships
