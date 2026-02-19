# AI Bridge

## Executive Summary

An open-source, modular bridge that connects **messaging platforms** to **AI agents**, turning any smartphone into a remote control for an AI-powered assistant. Users send a message from their preferred chat app, and it gets routed to the AI backend of their choice — with full access to the workspace, files, terminal, and configured tools. The response is sent back automatically.

**V0 ships with WhatsApp + Claude Code** as the default connector and AI backend. But the architecture is designed from day one so that any messaging connector (Slack, Telegram, iMessage, Discord, ...) and any AI provider (Claude Code, OpenAI, Gemini, local LLMs, custom agents, ...) can be plugged in.

Beyond personal developer use, this project serves as the foundation for a **consulting-driven business model**: walk into any company, configure an AI agent tailored to their workflows and connected to their platforms via API, and hand over a system they control from their phone. The tool is open source; the expertise to configure it is the service.

## What We're Building

A lightweight, plugin-based Node.js service that runs alongside your workspace and acts as a two-way bridge between **any messaging connector** and **any AI backend**:

### Architecture

```
┌──────────────────┐      ┌──────────────────┐      ┌──────────────────┐
│   CONNECTORS     │      │    BRIDGE CORE    │      │   AI PROVIDERS   │
│  (Messaging In)  │─────▶│                  │─────▶│   (AI Out)       │
│                  │◀─────│  Router / Auth /  │◀─────│                  │
│  ✅ WhatsApp     │      │  Queue / Config   │      │  ✅ Claude Code  │
│  ◻ Slack         │      │                  │      │  ◻ OpenAI API    │
│  ◻ Telegram      │      └──────────────────┘      │  ◻ Gemini        │
│  ◻ iMessage      │                                 │  ◻ Local LLMs    │
│  ◻ Discord       │                                 │  ◻ Custom Agent  │
└──────────────────┘                                 └──────────────────┘
   ✅ = V0 ready                                        ✅ = V0 ready
   ◻ = Future                                           ◻ = Future
```

### How it works

- **Inbound (Connector → Core)**: A connector listens for incoming messages (V0: WhatsApp via `whatsapp-web.js`), filters by whitelisted senders and a command prefix (e.g. `/ai`), and forwards the cleaned message to the bridge core.
- **Core (Router)**: The bridge core reads the user's configuration to determine which AI provider should handle the request, manages the message queue, and routes the task to the correct backend.
- **Outbound (AI Provider → Connector)**: The AI provider processes the task and returns a result. The bridge core formats the response and sends it back through the originating connector.
- **Context-Aware**: When using a workspace-aware backend like Claude Code, the AI has full awareness of the codebase, git history, file structure, and any configured MCP servers or custom commands. The phone is just a remote input — the intelligence lives in the workspace.

### V0 scope

| Layer       | V0 Implementation                | Extensible to                                         |
| ----------- | -------------------------------- | ----------------------------------------------------- |
| Connector   | WhatsApp (`whatsapp-web.js`)     | Slack, Telegram, iMessage, Discord, SMS, ...          |
| AI Provider | Claude Code CLI (local, VS Code) | OpenAI, Gemini, Ollama, LM Studio, custom agents, ... |
| Auth        | Phone number whitelist           | OAuth, API keys, role-based access                    |
| Config      | Single `config.json`             | Per-user profiles, multi-workspace routing            |

No cloud dependency. It runs on the user's machine. In V0 with Claude Code, no API keys are required — it uses the existing Claude account (Max subscription via Claude Code CLI). Other AI providers can be configured with their own credentials.

## Core Value Proposition

**For developers**: Control any project from your phone. Review code, fix bugs, deploy, run tests — all through a chat message while away from your desk. Choose the AI that fits your workflow.

**For businesses (via consulting)**: Any company can have an AI agent connected to their tools — e-commerce platforms, invoicing systems, CRMs, email — configured by an expert and operated through the app they already use every day. Swap connectors or AI backends without rebuilding anything.

**For the community**: An open-source foundation that anyone can extend with new connectors, AI providers, workflow templates, and industry-specific configurations.

**Key differentiators**:

- **Connector-agnostic** — WhatsApp today, Slack or Telegram tomorrow. Same core, different frontends.
- **AI-agnostic** — Claude Code today, OpenAI or a local LLM tomorrow. Swap backends without changing anything else.
- **Zero cloud infrastructure** — runs locally on the user's machine
- **Deep workspace context** — the AI is scoped to the project workspace, not the full machine. It has full awareness of the codebase, git history, file structure, terminal, and any configured MCP servers or tools within that workspace. This is the security boundary: powerful inside the project, contained outside of it.
- **Self-improving plugin architecture** — adding a new connector or AI provider means implementing a single interface. More importantly, the AI itself can modify the bridge's configuration, add new workflows, and improve its own workspace setup — it's not just a passive responder, it's an active participant in maintaining and evolving the system.

## The Flow (V0: WhatsApp + Claude Code)

```
┌─────────────────────────────────────────────────────────────┐
│                      USER'S PHONE                           │
│                                                             │
│  WhatsApp: "/ai add dark mode to the settings screen"       │
└──────────────────────────┬──────────────────────────────────┘
                           │
                           ▼
┌─────────────────────────────────────────────────────────────┐
│                   BRIDGE CORE (Mac)                          │
│                                                             │
│  1. WhatsApp connector receives message                     │
│  2. Validates sender (whitelist) + prefix (/ai)             │
│  3. Core reads config → routes to Claude Code provider      │
│  4. Sends "Working on it..." reply via connector            │
└──────────────────────────┬──────────────────────────────────┘
                           │
                           ▼
┌─────────────────────────────────────────────────────────────┐
│           AI PROVIDER: CLAUDE CODE (VS Code Terminal)        │
│                                                             │
│  Workspace: ~/projects/my-ios-app                           │
│                                                             │
│  Claude Code receives: "add dark mode to the settings       │
│  screen"                                                    │
│                                                             │
│  → Reads existing files                                     │
│  → Understands the project structure                        │
│  → Writes/modifies code                                     │
│  → Runs build or tests if needed                            │
│  → Returns summary of changes                               │
└──────────────────────────┬──────────────────────────────────┘
                           │
                           ▼
┌─────────────────────────────────────────────────────────────┐
│                      USER'S PHONE                           │
│                                                             │
│  WhatsApp: "Done. Added dark mode toggle to                 │
│  SettingsView.swift and created ThemeManager.swift.          │
│  Modified 3 files. Build successful."                       │
└─────────────────────────────────────────────────────────────┘
```
