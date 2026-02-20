# OpenBridge

## What is OpenBridge?

OpenBridge is an open-source platform that turns AI into a **workforce** — agents that understand your project's APIs, execute real business tasks, and coordinate multi-step workflows. You interact through the messaging app you already use (WhatsApp, Telegram, Slack). The AI runs on your machine, uses your own AI subscription, and has deep knowledge of your workspace.

This is not a chatbot. OpenBridge agents can read your API documentation, call your endpoints, onboard suppliers, sync inventory across stores, generate reports, and handle complex multi-step operations — all triggered from a text message.

## Why OpenBridge?

**The problem:** AI assistants today are generic. They don't know your APIs, can't execute actions on your behalf, and treat every conversation as isolated. You end up copy-pasting API docs, explaining your stack, and manually running the actions the AI suggests.

**The solution:** OpenBridge gives AI structured knowledge of your project — every endpoint, every authentication method, every data schema. Agents don't just answer questions; they execute tasks against your real systems using a tool-use protocol. When a task is too complex for one agent, the orchestrator breaks it into subtasks and coordinates multiple agents working in parallel.

**Zero extra cost:** OpenBridge runs locally and uses your existing AI subscription (Claude Max, OpenAI API key, etc.). No per-request fees, no cloud dependency, no vendor lock-in.

## Real-World Use Cases

### E-Commerce Operations

> _"Add the new summer collection to all three stores"_

The agent reads your workspace map, knows the Shopify and WooCommerce API endpoints, authenticates with each store, creates products with the right categories and pricing, and reports back with links.

### Supplier Onboarding

> _"Onboard Acme Corp as a supplier — here's their catalog PDF"_

The orchestrator creates a task agent to parse the catalog, another to map products to your schema, and a third to create the supplier account and import products. Each agent reports progress; the orchestrator coordinates the sequence.

### Multi-Store Inventory Sync

> _"Sync inventory between the Casablanca and Marrakech warehouses"_

The agent calls both warehouse APIs, compares stock levels, identifies discrepancies, generates a reconciliation report, and optionally pushes adjustments — all with your approval at each step via interactive messages.

### DevOps from Your Phone

> _"Deploy the staging branch and run the E2E tests"_

The agent executes git and CI commands in your workspace, monitors the deployment, runs tests, and sends you the results — including a link to a generated report if you have views enabled.

## Architecture

OpenBridge is built on 5 layers. Each layer is modular and extensible through interfaces.

```
┌──────────────────────────────────────────────────────────────────┐
│                        CHANNELS                                  │
│  WhatsApp · Telegram · Discord · Slack · Web Chat                │
│  Connectors translate between messaging APIs and OpenBridge      │
└──────────────────────┬───────────────────────────────────────────┘
                       │
                       ▼
┌──────────────────────────────────────────────────────────────────┐
│                      BRIDGE CORE                                 │
│  Router · Auth · Queue · Config · Registry · Health · Metrics    │
│  Message routing, authentication, rate limiting, plugin system   │
└──────────────────────┬───────────────────────────────────────────┘
                       │
                       ▼
┌──────────────────────────────────────────────────────────────────┐
│                  AGENT ORCHESTRATOR                               │
│  Main Agent · Task Agents · Script Coordinator · Event Bus       │
│  Breaks tasks into subtasks, delegates to specialized agents,    │
│  coordinates execution order, handles dependencies               │
└──────────────────────┬───────────────────────────────────────────┘
                       │
                       ▼
┌──────────────────────────────────────────────────────────────────┐
│                 WORKSPACE KNOWLEDGE                               │
│  Workspace Maps · API Discovery · API Executor · Data Schemas    │
│  Structured knowledge of every endpoint, auth method, and        │
│  data model in the target project (openbridge.map.json)          │
└──────────────────────┬───────────────────────────────────────────┘
                       │
                       ▼
┌──────────────────────────────────────────────────────────────────┐
│               VIEWS + INTERACTION                                 │
│  Reports · Dashboards · Interactive Flows · Onboarding Wizards   │
│  AI generates visual outputs and multi-step Q&A flows,           │
│  served via local HTTP and linked in chat messages                │
└──────────────────────────────────────────────────────────────────┘

AI PROVIDERS (pluggable at every layer)
  Claude Code · OpenAI · Gemini · Local LLMs · Custom Agents
  Each provider implements the AIProvider interface with
  optional workspace context and tool-use protocol support
```

### Layer 1: Channels (Connectors)

Messaging platform adapters. Each implements the `Connector` interface — initialize, receive messages, send responses, show typing indicators, shut down gracefully.

| Channel  | Status | Library           |
| -------- | :----: | ----------------- |
| WhatsApp |   ✅   | `whatsapp-web.js` |
| Console  |   ✅   | built-in (stdin)  |
| Telegram |   ◻    | planned           |
| Discord  |   ◻    | planned           |
| Slack    |   ◻    | planned           |
| Web Chat |   ◻    | planned           |

### Layer 2: Bridge Core

The engine that wires everything together:

- **Router** — routes messages from connector → provider → connector, with streaming support and progress updates
- **AuthService** — phone whitelist, command prefix (`/ai`), per-sender rate limiting, command allow/deny filters
- **MessageQueue** — per-user sequential processing with retry, exponential backoff, and dead-letter queue
- **PluginRegistry** — auto-discovers connectors and providers via factory pattern
- **Config** — Zod-validated `config.json` with hot-reload support
- **Health + Metrics** — optional HTTP endpoints for monitoring uptime, latency, error rates
- **AuditLogger** — structured audit trail of all message events
- **WorkspaceManager** — multi-workspace routing via `@workspace-name` syntax

### Layer 3: Agent Orchestrator _(planned)_

The intelligence layer that coordinates work:

- **Main Agent** — receives the user's request, decides whether to handle directly or delegate
- **Task Agents** — specialized agents that execute subtasks (API calls, data transforms, file operations)
- **Script Coordinator** — event bus between agents, manages execution order, dependencies, timeouts
- **Script Strategy** — when a task agent finishes, a script notifies the main agent, which triggers the next step

### Layer 4: Workspace Knowledge _(planned)_

Structured knowledge about the target project:

- **Workspace Map** (`openbridge.map.json`) — declares every API endpoint, authentication method, request/response schema, and CURL example
- **Scanner** — auto-generates maps from OpenAPI/Swagger specs and Postman collections
- **API Executor** — makes HTTP requests on behalf of agents with proper auth, headers, retries, and error handling
- **Context Injection** — workspace maps are passed to AI providers so agents know what actions are available

### Layer 5: Views + Interaction _(planned)_

Rich outputs beyond text messages:

- **Temporary Views** — AI-generated reports and dashboards served on local HTTP, auto-expire after TTL
- **Permanent Views** — persisted outputs (reconciliation reports, audit logs)
- **Interactive Flows** — multi-step Q&A for onboarding, confirmations, and structured data collection
- **View Server** — local HTTP server that hosts generated views, links sent to user via chat

## AI Providers

Providers are pluggable backends that process messages. Each implements the `AIProvider` interface.

| Provider    | Status | How it works                                               |
| ----------- | :----: | ---------------------------------------------------------- |
| Claude Code |   ✅   | Runs `claude` CLI in target workspace with session support |
| OpenAI      |   ◻    | planned — API-based                                        |
| Gemini      |   ◻    | planned — API-based                                        |
| Local LLMs  |   ◻    | planned — Ollama, LM Studio                                |

The Claude Code provider (V0) runs the `claude` CLI as a child process inside the configured workspace. It supports:

- **Streaming** — responses stream in real-time, no long timeouts
- **Session continuity** — conversations persist across messages (30 min TTL per user)
- **Error classification** — transient errors retry automatically; permanent errors surface to the user
- **Workspace scoping** — the AI has full access to the project's files, git, and terminal, but is contained to that workspace

## How It Works Today (V0)

```
You (WhatsApp)                    OpenBridge (your machine)
    │                                     │
    │  "/ai what endpoints does           │
    │   the orders API have?"             │
    │ ──────────────────────────────────▶  │
    │                                     │  1. WhatsApp connector receives message
    │                                     │  2. Auth: whitelist ✓, prefix ✓, rate limit ✓
    │                                     │  3. Queue: enqueue for your user
    │  "Working on it..."                 │  4. Router: send acknowledgment
    │ ◀──────────────────────────────────  │
    │                                     │  5. Provider: claude --print "..." in workspace
    │                                     │  6. Claude reads project files, analyzes code
    │  "The orders API has 5              │  7. Response streamed back
    │   endpoints: GET /orders,           │
    │   POST /orders, ..."                │
    │ ◀──────────────────────────────────  │
```

## Business Model

OpenBridge is open source (Apache 2.0). The tool is free; the expertise to configure it is the service.

**For businesses:** Walk into any company, map their APIs into `openbridge.map.json`, configure agents tailored to their workflows, connect their preferred messaging channel, and hand over a system they operate from their phone. The AI uses their own subscription — zero per-request cost.

**For developers:** Run it on your machine, connect your AI subscription, and operate your projects from anywhere. Add custom connectors and providers as needed.

**For the community:** Extend with new connectors, providers, workspace map importers, agent templates, and industry-specific configurations.

## Current Status

| Component            | Status                      |
| -------------------- | --------------------------- |
| WhatsApp connector   | ✅ Production-ready (V0)    |
| Console connector    | ✅ Reference implementation |
| Claude Code provider | ✅ Production-ready (V0)    |
| Bridge Core          | ✅ Complete (V0)            |
| Workspace Knowledge  | ◻ In development (Phase 6)  |
| Agent Orchestrator   | ◻ In development (Phase 7)  |
| Tool-Use Protocol    | ◻ In development (Phase 8)  |
| Views + Interaction  | ◻ Planned (Phase 9)         |
| More channels        | ◻ Planned (Phase 10)        |

## Tech Stack

- **Runtime:** Node.js >= 22 (ESM)
- **Language:** TypeScript 5.7+ (strict mode)
- **Testing:** Vitest
- **Linting:** ESLint 9 flat config + typescript-eslint
- **Formatting:** Prettier
- **Git hooks:** Husky v9 + lint-staged + commitlint (conventional commits)
- **Config validation:** Zod
- **Logging:** Pino
- **License:** Apache 2.0
