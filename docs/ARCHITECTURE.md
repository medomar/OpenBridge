# OpenBridge — Architecture

> **Last Updated:** 2026-02-20

---

## System Overview

OpenBridge is a **5-layer modular platform** that connects messaging channels to AI agents capable of understanding project APIs, executing real business tasks, and coordinating multi-step workflows.

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

---

## Layer 1: Channels (Connectors)

Messaging platform adapters. Each connector implements the `Connector` interface (`src/types/connector.ts`):

```typescript
interface Connector {
  name: string;
  initialize(): Promise<void>;
  sendMessage(message: OutboundMessage): Promise<void>;
  on(event, listener): void;
  shutdown(): Promise<void>;
  isConnected(): boolean;
}
```

Connectors translate between a messaging platform's native API and OpenBridge's internal `InboundMessage`/`OutboundMessage` types. Adding a new channel means implementing one interface.

| Channel  | Status | Library           | Directory                  |
| -------- | :----: | ----------------- | -------------------------- |
| WhatsApp |   ✅   | `whatsapp-web.js` | `src/connectors/whatsapp/` |
| Console  |   ✅   | built-in (stdin)  | `src/connectors/console/`  |
| Telegram |   ◻    | planned           | —                          |
| Discord  |   ◻    | planned           | —                          |
| Slack    |   ◻    | planned           | —                          |
| Web Chat |   ◻    | planned           | —                          |

**WhatsApp connector features (V0):**

- Auto-reconnect with exponential backoff
- Session persistence (survives restarts without re-scanning QR)
- Message chunking for responses > 4096 characters
- Typing indicator while AI processes
- Markdown-to-WhatsApp formatting conversion

---

## Layer 2: Bridge Core

The engine that wires everything together. Located in `src/core/`.

| Component        | File                   | Purpose                                                                              |
| ---------------- | ---------------------- | ------------------------------------------------------------------------------------ |
| Bridge           | `bridge.ts`            | Main orchestrator — wires connectors, providers, and services; manages lifecycle     |
| Router           | `router.ts`            | Routes messages from connector → provider → connector, with streaming and progress   |
| AuthService      | `auth.ts`              | Phone whitelist, command prefix (`/ai`), per-sender rate limiting, command filtering |
| MessageQueue     | `queue.ts`             | Per-user sequential processing with retry, exponential backoff, dead-letter queue    |
| PluginRegistry   | `registry.ts`          | Auto-discovers and registers connector/provider factories via plugin pattern         |
| Config           | `config.ts`            | Loads and validates `config.json` via Zod schemas                                    |
| ConfigWatcher    | `config-watcher.ts`    | Hot-reload — watches `config.json` for changes, re-validates, emits update events    |
| RateLimiter      | `rate-limiter.ts`      | Configurable per-user message rate limiting                                          |
| Health           | `health.ts`            | HTTP endpoint for monitoring bridge status, uptime, and component health             |
| Metrics          | `metrics.ts`           | Tracks message counts, latency, error rates, and queue depth                         |
| AuditLogger      | `audit-logger.ts`      | Structured audit trail of all message events                                         |
| WorkspaceManager | `workspace-manager.ts` | Multi-workspace routing via `@workspace-name` syntax                                 |
| Logger           | `logger.ts`            | Pino structured logging                                                              |

**Message types** are defined in `src/types/message.ts` (`InboundMessage`, `OutboundMessage`).
**Config schemas** are defined in `src/types/config.ts` using Zod.

---

## Layer 3: Agent Orchestrator _(planned — Phase 7)_

The intelligence layer that coordinates multi-agent work. Instead of routing every message directly to a single AI provider, the orchestrator decides how to handle each request.

### Architecture

```
                    User Message
                         │
                         ▼
                  ┌──────────────┐
                  │  Main Agent  │  Receives request, decides strategy
                  └──────┬───────┘
                         │
              ┌──────────┼──────────┐
              ▼          ▼          ▼
        ┌──────────┐ ┌──────────┐ ┌──────────┐
        │ Task     │ │ Task     │ │ Task     │  Specialized agents
        │ Agent A  │ │ Agent B  │ │ Agent C  │  execute subtasks
        └─────┬────┘ └─────┬────┘ └─────┬────┘
              │            │            │
              ▼            ▼            ▼
        ┌──────────────────────────────────────┐
        │        Script Coordinator             │  Event bus: tracks
        │  agent_started · task_complete ·      │  completion, manages
        │  agent_done · dependency_met          │  dependencies, triggers
        └──────────────────────────────────────┘  next steps
```

### Components

- **Main Agent** — receives the user's request, analyzes complexity, and decides whether to handle directly (simple queries) or decompose into subtasks (complex operations)
- **Task Agents** — lightweight, specialized agents that each execute a single subtask. A task agent receives a task list, has access to the workspace map and API executor, reports progress back, and emits a completion event when done
- **Script Coordinator** — the event bus between agents. Manages execution order, handles dependencies (Agent B waits for Agent A), enforces timeouts, and triggers failure handling
- **Script Strategy** — the coordination pattern: when a task agent finishes, a script event notifies the main agent, which evaluates results and triggers the next step. This allows sequential, parallel, or conditional execution flows

### Multi-Agent Flow Example

```
User: "Onboard supplier Acme Corp with their catalog"

Main Agent analyzes → decomposes into 3 subtasks:

  Task Agent 1: Register Acme Corp in vendor system
       │ completes → emits task_complete
       ▼
  Task Agent 2: Fetch + parse product catalog (247 items)
       │ completes → emits task_complete
       ▼
  Task Agent 3: Map products to taxonomy + import
       │ completes → emits agent_done
       ▼
  Main Agent: Collects results → sends summary to user
```

### Planned Types

```typescript
interface Agent {
  id: string;
  status: 'idle' | 'working' | 'done' | 'failed';
  workspace: string;
  taskList: Task[];
}

interface TaskAgent extends Agent {
  parentId: string; // main agent that created this task agent
  completionCallback: string; // script event to emit on completion
}

type ScriptEvent = 'agent_started' | 'task_complete' | 'agent_done' | 'agent_failed';
```

---

## Layer 4: Workspace Knowledge _(planned — Phase 6)_

Structured knowledge about the target project's APIs, endpoints, authentication, and data schemas. This is the core differentiator — the AI doesn't just answer questions, it knows what actions are available and how to execute them.

### Architecture

```
┌──────────────────────────────────────────────────────────┐
│                   Workspace Map                           │
│  openbridge.map.json                                      │
│                                                           │
│  ┌────────────────┐  ┌────────────────┐                   │
│  │  API Endpoints  │  │  Auth Methods  │                   │
│  │  route, method, │  │  bearer, api   │                   │
│  │  headers, body  │  │  key, oauth    │                   │
│  └────────────────┘  └────────────────┘                   │
│                                                           │
│  ┌────────────────┐  ┌────────────────┐                   │
│  │  Data Schemas   │  │  CURL Examples │                   │
│  │  request/resp   │  │  per endpoint  │                   │
│  │  Zod/JSON       │  │               │                   │
│  └────────────────┘  └────────────────┘                   │
└──────────────────────┬───────────────────────────────────┘
                       │
          ┌────────────┼────────────┐
          ▼            ▼            ▼
    ┌───────────┐ ┌──────────┐ ┌────────────────┐
    │  Scanner  │ │ Executor │ │ Context        │
    │ OpenAPI   │ │ HTTP     │ │ Injection      │
    │ Postman   │ │ requests │ │ Maps → prompts │
    │ Manual    │ │ + retries│ │ for AI         │
    └───────────┘ └──────────┘ └────────────────┘
```

### Components

- **Workspace Map** (`openbridge.map.json`) — the file where users declare their project's APIs. Contains every endpoint (route, method, headers, auth, request/response schemas) and optional CURL examples. This is the AI's knowledge base per workspace
- **Scanner** — reads `openbridge.map.json` and can also auto-generate maps by parsing OpenAPI/Swagger specs and Postman collections. Supports manual, openapi, and postman source types
- **API Executor** — makes HTTP requests on behalf of agents. Handles authentication headers, tokens, request bodies, response parsing, error handling, and retries
- **Context Injection** — workspace maps are passed to AI providers so agents know what actions are available. The provider receives structured endpoint data alongside the user's message

### Planned Types

```typescript
interface APIEndpoint {
  route: string;
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  headers?: Record<string, string>;
  auth?: AuthConfig;
  requestSchema?: object; // JSON Schema or Zod-compatible
  responseSchema?: object;
  description?: string;
  curl?: string; // example CURL command
}

interface WorkspaceMap {
  name: string;
  version: string;
  baseUrl: string;
  auth: AuthConfig;
  endpoints: APIEndpoint[];
  metadata?: Record<string, unknown>;
}

type MapSource = 'openapi' | 'postman' | 'manual';
```

### Example `openbridge.map.json`

```json
{
  "name": "my-store-api",
  "version": "1.0.0",
  "baseUrl": "https://api.mystore.com/v1",
  "auth": {
    "type": "bearer",
    "token": "${STORE_API_TOKEN}"
  },
  "endpoints": [
    {
      "route": "/products",
      "method": "GET",
      "description": "List all products with pagination",
      "responseSchema": { "type": "array", "items": { "$ref": "#/schemas/Product" } }
    },
    {
      "route": "/products",
      "method": "POST",
      "description": "Create a new product",
      "requestSchema": { "$ref": "#/schemas/CreateProduct" },
      "curl": "curl -X POST https://api.mystore.com/v1/products -H 'Authorization: Bearer $TOKEN' -d '{\"name\": \"Widget\", \"price\": 9.99}'"
    },
    {
      "route": "/orders/:id",
      "method": "GET",
      "description": "Get order by ID"
    }
  ]
}
```

---

## Layer 5: Views + Interaction _(planned — Phase 9)_

Rich outputs beyond text messages. The AI can generate visual reports, serve interactive dashboards, and run multi-step Q&A flows.

### Components

- **Temporary Views** — AI-generated reports, dashboards, and data summaries served on a local HTTP server. Auto-expire after a configurable TTL. Links sent to the user via their messaging channel
- **Permanent Views** — persisted outputs such as reconciliation reports, audit summaries, and historical data views
- **Interactive Flows** — multi-step question-and-answer sequences for onboarding, confirmations, and structured data collection. The AI asks questions, tracks conversation state, and handles responses
- **View Server** — local HTTP server that hosts generated views. Runs alongside the bridge, serves HTML/JSON content, and manages view lifecycle (creation, TTL expiry, cleanup)

### Planned Types

```typescript
interface TemporaryView {
  id: string;
  content: string; // HTML or JSON
  createdAt: Date;
  expiresAt: Date;
  url: string; // local HTTP URL
}

interface PermanentView {
  id: string;
  content: string;
  createdAt: Date;
  path: string; // persisted file path
  url: string;
}

interface InteractiveForm {
  id: string;
  steps: FormStep[];
  currentStep: number;
  state: Record<string, unknown>;
  onComplete: (data: Record<string, unknown>) => Promise<void>;
}
```

---

## AI Providers

Providers are pluggable backends that process messages. Each implements the `AIProvider` interface (`src/types/provider.ts`):

```typescript
interface AIProvider {
  name: string;
  initialize(): Promise<void>;
  processMessage(message: InboundMessage): Promise<ProviderResult>;
  isAvailable(): Promise<boolean>;
  shutdown(): Promise<void>;
}
```

| Provider    | Status | Directory                    | How it works                                               |
| ----------- | :----: | ---------------------------- | ---------------------------------------------------------- |
| Claude Code |   ✅   | `src/providers/claude-code/` | Runs `claude` CLI in target workspace with session support |
| OpenAI      |   ◻    | planned                      | API-based                                                  |
| Gemini      |   ◻    | planned                      | API-based                                                  |
| Local LLMs  |   ◻    | planned                      | Ollama, LM Studio                                          |

**Claude Code provider features (V0):**

- **Streaming** — responses stream in real-time via `claude --print --output-format stream-json`
- **Session continuity** — conversations persist across messages (30 min TTL per user) via `SessionManager`
- **Error classification** — transient errors retry automatically; permanent errors surface to the user via `ProviderError`
- **Input sanitization** — user messages escaped before shell execution via `ClaudeCodeExecutor`
- **Workspace scoping** — the AI has full access to the project's files, git, and terminal, contained to the configured workspace

### Future: Workspace-Aware Providers (Phase 8)

Providers will be enhanced with a **tool-use protocol** that allows AI to request structured actions:

```typescript
// Extended interface (planned)
interface WorkspaceAwareProvider extends AIProvider {
  processMessage(
    message: InboundMessage,
    context: WorkspaceContext, // map, available tools, active agents
  ): Promise<ProviderResult>;
}

// Tool-use action (planned)
interface ToolAction {
  action: 'api_call' | 'file_read' | 'file_write' | 'shell_exec';
  endpoint?: string;
  method?: string;
  body?: unknown;
  path?: string;
}
```

The provider receives workspace context (API map, available tools, active agents) alongside the message, and can respond with structured tool-use actions that the bridge executes on its behalf.

---

## Message Flow

### Current Flow (V0)

```
1. Connector receives raw message from messaging platform
2. Connector emits 'message' event with InboundMessage
3. Bridge.handleIncomingMessage():
   a. AuthService.isAuthorized(sender) → whitelist check
   b. AuthService.hasPrefix(content) → prefix check (/ai)
   c. AuthService.stripPrefix(content) → clean message
   d. RateLimiter.check(sender) → rate limit check
4. MessageQueue.enqueue(cleanedMessage) → per-user queue
5. Queue processes sequentially per user:
   a. Router.route(message)
   b. Router sends "Working on it..." acknowledgment
   c. WorkspaceManager resolves target workspace
   d. Provider.processMessage(message) → AI response (streamed)
   e. Router sends response back via connector (chunked if needed)
6. AuditLogger records the event
7. Metrics updated (latency, counts, errors)
```

### Planned Flow (with Orchestrator)

```
1. Connector receives raw message
2. Auth + rate limiting (same as V0)
3. MessageQueue.enqueue(cleanedMessage)
4. Queue processes:
   a. Router → Agent Orchestrator (instead of direct to provider)
   b. Main Agent analyzes request complexity
   c. Simple request → handle directly via provider
   d. Complex request → decompose into subtasks:
      i.   Create task agents with assigned subtasks
      ii.  Each task agent gets workspace map context
      iii. Task agents execute using API executor + provider
      iv.  Script Coordinator tracks completion events
      v.   Dependencies resolved (Agent B waits for Agent A)
   e. Main Agent collects results from all task agents
   f. Response formatted and sent back via connector
   g. Optional: generate a view (report, dashboard) and send link
```

---

## Configuration Model

Validated by Zod schemas in `src/types/config.ts`.

### Current Config (`config.json`)

```json
{
  "connectors": [{ "type": "whatsapp", "enabled": true, "options": {} }],
  "providers": [
    {
      "type": "claude-code",
      "enabled": true,
      "options": {
        "workspacePath": "/absolute/path/to/your/project"
      }
    }
  ],
  "defaultProvider": "claude-code",
  "auth": {
    "whitelist": ["+1234567890"],
    "prefix": "/ai"
  },
  "logLevel": "info"
}
```

The `workspacePath` in provider options points to the **target project**, not OpenBridge. This is the folder where the AI has access.

### Planned Config Extensions

```json
{
  "workspaces": {
    "my-store": {
      "path": "/path/to/store-project",
      "map": "openbridge.map.json"
    }
  },
  "orchestrator": {
    "maxConcurrentAgents": 5,
    "taskTimeout": 300000,
    "scriptStrategy": "sequential"
  },
  "views": {
    "enabled": true,
    "port": 3001,
    "defaultTTL": 3600
  }
}
```

---

## Key Design Decisions

| Decision            | Choice                                            | Rationale                                                                           |
| ------------------- | ------------------------------------------------- | ----------------------------------------------------------------------------------- |
| Workspace-scoped AI | AI only has access to the configured workspace    | Security boundary — not full machine access                                         |
| Plugin architecture | Factory pattern for connectors/providers          | New plugins register without modifying core code                                    |
| Per-user queues     | Messages processed sequentially per user          | Prevents concurrent AI sessions from conflicting while allowing cross-user parallel |
| Script strategy     | Event-driven agent coordination                   | Agents stay decoupled; scripts handle dependencies and ordering                     |
| Workspace maps      | Declarative API knowledge (`openbridge.map.json`) | AI receives structured endpoint data instead of guessing from docs                  |
| Local-first         | Everything runs on the user's machine             | No cloud dependency, no per-request cost, full data ownership                       |
| Zod validation      | Runtime config validation                         | Fail fast on bad config, TypeScript type inference                                  |
| ESM + Node 22       | Modern module system                              | Native ESM, top-level await, better performance                                     |

---

## Directory Structure

```
src/
├── index.ts                       # Entry point — loads config, registers plugins, starts bridge
├── types/
│   ├── connector.ts               # Connector interface
│   ├── provider.ts                # AIProvider interface
│   ├── message.ts                 # InboundMessage / OutboundMessage
│   ├── config.ts                  # Zod config schemas
│   └── common.ts                  # Shared utility types
├── core/
│   ├── bridge.ts                  # Main orchestrator
│   ├── router.ts                  # Message routing
│   ├── auth.ts                    # Whitelist + prefix auth
│   ├── queue.ts                   # Per-user message queue
│   ├── registry.ts                # Plugin registry
│   ├── config.ts                  # Config loader
│   ├── config-watcher.ts          # Config hot-reload
│   ├── rate-limiter.ts            # Per-user rate limiting
│   ├── health.ts                  # Health check HTTP endpoint
│   ├── metrics.ts                 # Metrics collection
│   ├── audit-logger.ts            # Audit trail
│   ├── workspace-manager.ts       # Multi-workspace routing
│   └── logger.ts                  # Pino logger
├── connectors/
│   ├── whatsapp/                  # WhatsApp connector (V0)
│   └── console/                   # Console connector (reference)
├── providers/
│   └── claude-code/               # Claude Code AI provider (V0)
├── orchestrator/                  # (planned) Agent orchestrator
├── knowledge/                     # (planned) Workspace knowledge
└── views/                         # (planned) View generator + server
```
