# OpenBridge — Future Work

> **Purpose:** Deferred items and backlog for future versions.
> **Last Updated:** 2026-03-09 | **Current Release:** v0.0.15 (1332 tasks shipped, 177 findings fixed)
> **Status:** Clean slate — ready for new planning cycle.

---

## Backlog (Unscoped Ideas)

| Feature                      | Description                                                                                                    | Notes                     | Inspired By                         |
| ---------------------------- | -------------------------------------------------------------------------------------------------------------- | ------------------------- | ----------------------------------- |
| E2E test: business files     | CSV workspace E2E test                                                                                         | Testing gap               | —                                   |
| Scheduled tasks              | Cron-like task scheduling ("run tests every morning at 9am")                                                   | New capability            | —                                   |
| AI tool marketplace          | Browse and install community-built connectors and providers                                                    | Plugin ecosystem          | —                                   |
| Webhook connector            | HTTP webhook endpoint for CI/CD integration                                                                    | New connector type        | —                                   |
| Secrets management           | Encrypted storage for Discord/Telegram tokens                                                                  | Security                  | —                                   |
| WhatsApp session persist     | Avoid re-scan when session expires                                                                             | UX improvement            | —                                   |
| Access Control Dashboard     | Web-based UI for managing per-user access control                                                              | ~10–15 tasks              | —                                   |
| Server Deployment Mode       | Docker container + headless mode for VPS/cloud                                                                 | Infrastructure            | —                                   |
| MCP server builder skill     | Master auto-generates MCP server stubs for custom integrations ("connect my Notion")                           | Extends MCP ecosystem     | awesome-claude-skills (mcp-builder) |
| Browser automation skill     | Playwright-based web scraping, form filling, and UI testing via workers                                        | Extends worker capability | awesome-claude-skills (playwright)  |
| iOS/Android testing skill    | Mobile app build + simulator testing via workers                                                               | Mobile development        | awesome-claude-skills (ios-sim)     |
| Email template generator     | HTML email design + send via SMTP — marketing, newsletters, notifications                                      | Business use case         | awesome-claude-skills               |
| Scientific computing skill   | Data science libraries (pandas, numpy, scipy) integration for analysis workers                                 | Research use case         | awesome-claude-skills (scientific)  |
| Multi-agent startup mode     | Loki-mode inspired — orchestrate 30+ agents across functional swarms for large projects                        | Advanced orchestration    | awesome-claude-skills (loki-mode)   |
| Sandbox-first deployments    | Workers deploy preview apps in sandboxed containers with temp public URLs (extends tunnel + Docker)            | Manus pattern             | system-prompts (Manus)              |
| Atomic task decomposition    | Master breaks tasks into verb-led, single-outcome, ≤14-word items for clearer worker instructions              | Cursor pattern            | system-prompts (Cursor)             |
| Parallel-by-default spawning | Master spawns independent workers simultaneously by default, with explicit dependency detection for sequencing | Cursor pattern            | system-prompts (Cursor)             |
| Worker reasoning checkpoints | Workers run self-check ("Am I sure?") before destructive operations (git push, file delete, deploy)            | Devin pattern             | system-prompts (Devin)              |

---

## How to Start a New Feature

1. Create a new finding in [FINDINGS.md](FINDINGS.md) if the feature addresses a gap
2. Design the implementation and estimate tasks
3. Add a new phase section to [TASKS.md](TASKS.md) with task IDs
4. Update [ROADMAP.md](../ROADMAP.md) to reflect the new phase
5. Implement, test, and mark tasks as Done
6. Archive completed tasks when the phase ships
