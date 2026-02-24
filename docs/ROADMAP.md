# OpenBridge — Roadmap

> **Last Updated:** 2026-02-24 | **Current Version:** v0.0.1

This document outlines the vision and planned features for OpenBridge. Features move from **Vision** to **Planned** to **In Progress** to **Released** as they mature.

---

## Released (v0.0.1)

Everything that shipped in the first release — 207 tasks across 30 phases.

| Feature                                                      | Phase | Status  |
| ------------------------------------------------------------ | ----- | ------- |
| Bridge Core (router, auth, queue, config)                    | 1–5   | Shipped |
| WhatsApp + Console connectors                                | 1–5   | Shipped |
| Claude Code provider                                         | 1–5   | Shipped |
| AI tool auto-discovery                                       | 6–10  | Shipped |
| Incremental workspace exploration (5-pass)                   | 11–14 | Shipped |
| MVP release                                                  | 15    | Shipped |
| Agent Runner (--allowedTools, --max-turns, --model, retries) | 16–18 | Shipped |
| Self-governing Master AI                                     | 18–21 | Shipped |
| Tool profiles (read-only, code-edit, full-access, master)    | 16–17 | Shipped |
| Worker orchestration + SPAWN markers                         | 19–21 | Shipped |
| Self-improvement (prompt tracking, model selection learning) | 20–21 | Shipped |
| WebChat, Telegram, Discord connectors                        | 22–24 | Shipped |
| AI-powered intent classification                             | 29    | Shipped |
| Live progress events across all connectors                   | 29    | Shipped |
| Production hardening + v0.0.1 tag                            | 30    | Shipped |

---

## Planned — Phase 31: Media & Proactive Messaging

> **Goal:** Extend OpenBridge from text-only to media-capable, and enable the AI to send messages proactively (not just reply).

| Task                                                 | ID     | Feature                                                                          | Priority | Complexity |
| ---------------------------------------------------- | ------ | -------------------------------------------------------------------------------- | -------- | ---------- |
| Extend OutboundMessage with media/attachment support | OB-600 | Add optional `media` field to OutboundMessage (type, buffer, mimeType, filename) | High     | Medium     |
| WhatsApp: send to specific number                    | OB-601 | Allow Master AI to proactively send a message to any whitelisted phone number    | High     | Low        |
| WhatsApp: send file/document attachments             | OB-602 | Send PDFs, images, HTML files as WhatsApp document messages via MessageMedia     | High     | Medium     |
| WhatsApp: receive and transcribe voice messages      | OB-605 | Download audio from `message.hasMedia`, transcribe with local STT (Whisper)      | Medium   | High       |
| WhatsApp: send voice replies (TTS)                   | OB-606 | Convert AI text responses to audio using local TTS, send as voice message        | Low      | High       |
| WebChat: file download support                       | OB-607 | Serve generated files via WebChat UI (download buttons in chat)                  | Medium   | Low        |

### Design Notes — Media Architecture

```
OutboundMessage (extended)
{
  target: string;
  recipient: string;
  content: string;                     // text content (always present)
  media?: {                            // NEW — optional attachment
    type: "document" | "image" | "audio" | "video";
    data: Buffer;
    mimeType: string;
    filename?: string;
  };
  replyTo?: string;
  metadata?: Record<string, unknown>;
}
```

### Design Notes — Proactive Messaging

The Master AI will be able to send messages to specific numbers using a new marker format:

```
[SEND:whatsapp]+1234567890|Your report is ready.[/SEND]
```

Only whitelisted numbers can be contacted. The router will parse SEND markers and route them to the appropriate connector.

---

## Planned — Phase 32: Content Publishing & Sharing

> **Goal:** When the AI generates content (HTML, PDF, reports), give it ways to share that content with users — locally, via messaging, or on the web.

| Task                                                          | ID     | Feature                                                                 | Priority | Complexity |
| ------------------------------------------------------------- | ------ | ----------------------------------------------------------------------- | -------- | ---------- |
| Local file server — serve generated content via HTTP          | OB-610 | Extend WebChat HTTP server with `/shared/` endpoint for generated files | High     | Low        |
| Share via WhatsApp — send generated files as attachments      | OB-611 | Combine OB-602 (file send) with generated content pipeline              | High     | Medium     |
| Share via email — SMTP integration for sending files          | OB-612 | Configurable SMTP settings, send attachments/HTML emails                | Medium   | Medium     |
| GitHub Pages publish — push HTML to gh-pages branch           | OB-613 | Master commits generated HTML to `gh-pages` branch, pushes for hosting  | Medium   | Medium     |
| Shareable link generation — unique URLs for generated content | OB-614 | Generate short-lived or permanent URLs for shared files                 | Medium   | High       |

### Design Notes — Content Pipeline

```
User: "Generate an investor report for our project"
  ↓
Master AI → Worker (code-edit profile)
  ↓ generates report.html
Worker saves to: .openbridge/generated/report-2026-02-24.html
  ↓
Master detects generated file → asks user how to share:
  ↓
Options:
  1. Local: http://localhost:3000/shared/report-2026-02-24.html
  2. WhatsApp: send as document to requesting user
  3. Email: send to configured address
  4. GitHub Pages: https://username.github.io/project/reports/report.html
```

### Hosting Approaches Comparison

| Approach                | Pros                           | Cons                 | Requires          |
| ----------------------- | ------------------------------ | -------------------- | ----------------- |
| Local HTTP (`/shared/`) | Instant, zero config           | LAN only             | Nothing extra     |
| GitHub Pages            | Free, permanent, custom domain | ~1min deploy, public | Git push access   |
| Ngrok/Cloudflare Tunnel | Internet-accessible, instant   | Temporary URLs       | External CLI tool |
| Cloud storage (S3, R2)  | Permanent, fast, CDN           | Requires API keys    | Cloud account     |

**Recommended first implementation:** Local HTTP + WhatsApp file send (zero external deps).

---

## Planned — Phase 33: Smart Memory

> **Goal:** Give the Master AI long-term memory beyond `.openbridge/` flat files.

| Task                                                           | ID     | Feature                                                                 | Priority | Complexity |
| -------------------------------------------------------------- | ------ | ----------------------------------------------------------------------- | -------- | ---------- |
| Context compaction — summarize when Master context grows large | OB-190 | Progressive summarization of conversation history                       | Medium   | Medium     |
| Vector memory — SQLite + embeddings for knowledge retrieval    | OB-191 | Semantic search over workspace knowledge, past conversations, learnings | Low      | High       |
| Skill creator — Master creates reusable skill templates        | OB-192 | Auto-generate prompt templates from successful task patterns            | Low      | Medium     |

---

## Backlog — Future Phases

These are ideas captured for future consideration. Not yet scoped or scheduled.

| Feature                  | ID     | Description                                                        | Notes                |
| ------------------------ | ------ | ------------------------------------------------------------------ | -------------------- |
| Docker sandbox           | OB-193 | Run workers in containers for untrusted workspaces                 | Security isolation   |
| Interactive AI views     | OB-124 | AI generates live reports/dashboards on local HTTP                 | Needs Phase 32 first |
| E2E test: business files | OB-306 | CSV workspace E2E test                                             | Testing gap          |
| Multi-workspace support  | —      | Master manages multiple project folders simultaneously             | Architecture change  |
| Scheduled tasks          | —      | Cron-like task scheduling ("run tests every morning at 9am")       | New capability       |
| Team mode                | —      | Multiple whitelisted users with different permissions/roles        | Auth expansion       |
| AI tool marketplace      | —      | Browse and install community-built connectors and providers        | Plugin ecosystem     |
| Web dashboard            | —      | Browser-based admin panel for monitoring Master, workers, logs     | Operational tooling  |
| Webhook connector        | —      | HTTP webhook endpoint for CI/CD integration (GitHub Actions, etc.) | New connector type   |
| PDF generation           | —      | Built-in HTML-to-PDF conversion for generated reports              | Uses Puppeteer       |

---

## Version Milestones

| Version    | Target     | Key Features                                                |
| ---------- | ---------- | ----------------------------------------------------------- |
| **v0.0.1** | 2026-02-23 | Foundation — 5 connectors, self-governing Master, 207 tasks |
| **v0.1.0** | TBD        | Media support, proactive messaging, content sharing         |
| **v0.2.0** | TBD        | Smart memory, context compaction, skill creator             |
| **v1.0.0** | TBD        | Stable API, multi-workspace, team mode, web dashboard       |

---

## How to Propose a Feature

1. Open an issue on [GitHub](https://github.com/medomar/OpenBridge/issues) with the `feature-request` label
2. Describe the use case, not just the solution
3. Features that align with the "zero config, zero API keys" philosophy are prioritized
4. All features must work with the existing plugin architecture (Connector + AIProvider interfaces)

---

## Principles

These guide what we build and how:

1. **Zero config** — features should work out of the box with no API keys or complex setup
2. **Your tools, your cost** — OpenBridge uses AI tools already on your machine
3. **AI does the work** — we don't hardcode business logic; we let the AI figure it out
4. **Bounded workers** — workers always have restricted permissions and finite turns
5. **Everything is tracked** — `.openbridge/` stores all knowledge, git-tracked
6. **Plugin architecture** — new channels and AI tools are added via interfaces, not forks
