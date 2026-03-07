# OpenBridge Demos

> **Customer & Integrator Presentation Kit**
> Each folder contains a self-contained demo with setup instructions, a demo script, talking points, and sample data.

---

## Demo Catalog

| #   | Demo                            | Audience                | Duration | Difficulty   |
| --- | ------------------------------- | ----------------------- | -------- | ------------ |
| 01  | [Quick Start (Console)][01]     | All                     | 5 min    | Beginner     |
| 02  | [WhatsApp Mobile Control][02]   | Mobile-first teams      | 10 min   | Beginner     |
| 03  | [Multi-AI Orchestration][03]    | Engineering leads       | 15 min   | Intermediate |
| 04  | [Workspace Exploration][04]     | DevOps / Platform teams | 10 min   | Beginner     |
| 05  | [Deep Mode Audit][05]           | Security / QA teams     | 15 min   | Intermediate |
| 06  | [MCP External Services][06]     | Integration architects  | 15 min   | Advanced     |
| 07  | [WebChat Dashboard][07]         | Product / Design teams  | 10 min   | Beginner     |
| 08  | [Security & Access Control][08] | CISOs / Compliance      | 10 min   | Intermediate |

[01]: ./01-quick-start/
[02]: ./02-whatsapp-mobile/
[03]: ./03-multi-ai-orchestration/
[04]: ./04-workspace-exploration/
[05]: ./05-deep-mode-audit/
[06]: ./06-mcp-external-services/
[07]: ./07-webchat-dashboard/
[08]: ./08-security-access-control/

---

## Before Any Demo

### Prerequisites

- Node.js >= 22
- At least one AI tool installed: [Claude Code](https://docs.anthropic.com/en/docs/claude-code), [Codex](https://github.com/openai/codex), or Aider
- A sample project to point OpenBridge at (or use the included sample data)

### Quick Setup

```bash
cd /path/to/OpenBridge
npm install
```

### Tips for Live Demos

1. **Pre-scan the workspace** before the demo starts — run `npm run dev` once so exploration is cached in `.openbridge/`
2. **Use Console mode first** (Demo 01) to validate everything works before switching to WhatsApp/Telegram
3. **Have a backup config** ready — copy `config.json` before the demo
4. **Clear terminal history** for a clean presentation

---

## Folder Structure

Each demo folder contains:

```
demos/XX-demo-name/
  README.md          # Full demo script + talking points
  config.json        # Pre-configured config for this demo
  sample-data/       # Any generated outputs, screenshots, or mock data
```

---

## Generating Demo Data

Some demos produce outputs (exploration maps, audit reports, chat transcripts). After running a demo, save interesting outputs to the `sample-data/` folder so you can reference them in future presentations without re-running the demo live.
