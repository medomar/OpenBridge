# OpenBridge — Architecture

> **Last Updated:** 2026-02-19

---

## System Design

OpenBridge is a 3-layer plugin architecture:

```
┌──────────────────┐      ┌──────────────────┐      ┌──────────────────┐
│   CONNECTORS     │      │    BRIDGE CORE    │      │   AI PROVIDERS   │
│  (Messaging In)  │─────▶│                  │─────▶│   (AI Out)       │
│                  │◀─────│  Router / Auth /  │◀─────│                  │
│  ✅ WhatsApp     │      │  Queue / Config   │      │  ✅ Claude Code  │
│  ◻ Slack         │      │                  │      │  ◻ OpenAI API    │
│  ◻ Telegram      │      └──────────────────┘      │  ◻ Gemini        │
│  ◻ iMessage      │                                 │  ◻ Local LLMs    │
└──────────────────┘                                 └──────────────────┘
```

### Layer 1: Connectors

Each connector implements `src/types/connector.ts`:

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

Connectors translate between a messaging platform's native API and OpenBridge's internal `InboundMessage`/`OutboundMessage` types.

### Layer 2: Bridge Core

Located in `src/core/`. Responsible for:

| Component      | File          | Purpose                                               |
| -------------- | ------------- | ----------------------------------------------------- |
| Bridge         | `bridge.ts`   | Orchestrator — wires everything together              |
| Router         | `router.ts`   | Routes messages from connector → provider → connector |
| AuthService    | `auth.ts`     | Phone whitelist + command prefix                      |
| MessageQueue   | `queue.ts`    | Sequential processing (prevents race conditions)      |
| PluginRegistry | `registry.ts` | Registers connector/provider factories                |
| Config         | `config.ts`   | Loads and validates `config.json` via Zod             |
| Logger         | `logger.ts`   | Pino structured logging                               |

### Layer 3: AI Providers

Each provider implements `src/types/provider.ts`:

```typescript
interface AIProvider {
  name: string;
  initialize(): Promise<void>;
  processMessage(message: InboundMessage): Promise<ProviderResult>;
  isAvailable(): Promise<boolean>;
  shutdown(): Promise<void>;
}
```

Providers take a cleaned message and return a response. The Claude Code provider runs `claude --print "<message>"` as a child process inside the target workspace.

---

## Message Flow

```
1. WhatsApp connector receives raw message
2. Connector emits 'message' event with InboundMessage
3. Bridge.handleIncomingMessage():
   a. AuthService.isAuthorized(sender) → whitelist check
   b. AuthService.hasPrefix(content) → prefix check
   c. AuthService.stripPrefix(content) → clean message
4. MessageQueue.enqueue(cleanedMessage)
5. Queue processes sequentially:
   a. Router.route(message)
   b. Router sends "Working on it..." ack
   c. Provider.processMessage(message) → AI response
   d. Router sends response back via connector
```

---

## Configuration Model

Validated by Zod schemas in `src/types/config.ts`:

```json
{
  "connectors": [{ "type": "whatsapp", "enabled": true, "options": {} }],
  "providers": [{ "type": "claude-code", "enabled": true, "options": {} }],
  "defaultProvider": "claude-code",
  "auth": { "whitelist": ["+XXX"], "prefix": "/ai" },
  "logLevel": "info"
}
```

The `workspacePath` in provider options points to the **target project**, not OpenBridge. This is the folder where the AI has access.

---

## Key Design Decisions

| Decision              | Choice                                         | Rationale                                                 |
| --------------------- | ---------------------------------------------- | --------------------------------------------------------- |
| Workspace-scoped AI   | AI only has access to the configured workspace | Security boundary — not full machine                      |
| Sequential queue      | Messages processed one at a time               | Prevents concurrent Claude Code sessions from conflicting |
| Plugin registry       | Factory pattern for connectors/providers       | New plugins register without modifying core code          |
| Zod validation        | Runtime config validation                      | Fail fast on bad config, TypeScript type inference        |
| ESM + Node 16 modules | Modern module system                           | Native ESM, better tree-shaking                           |
