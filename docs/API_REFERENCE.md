# OpenBridge API Reference

This document covers every public interface, class, and configuration schema in OpenBridge. Use it alongside the [plugin guides](./WRITING_A_CONNECTOR.md) and [architecture overview](./ARCHITECTURE.md).

---

## Table of Contents

- [Message Types](#message-types)
  - [InboundMessage](#inboundmessage)
  - [OutboundMessage](#outboundmessage)
- [Plugin Interfaces](#plugin-interfaces)
  - [Connector](#connector)
  - [ConnectorEvents](#connectorevents)
  - [AIProvider](#aiprovider)
  - [ProviderResult](#providerresult)
  - [SpawnOptions](#spawnoptions)
- [CLI Adapter Layer](#cli-adapter-layer)
  - [CLIAdapter](#cliadapter)
  - [CLISpawnConfig](#clispawnconfig)
  - [CapabilityLevel](#capabilitylevel)
  - [AdapterRegistry](#adapterregistry)
  - [CodexAdapter](#codexadapter)
- [Built-in Providers](#built-in-providers)
  - [CodexProvider](#codexprovider)
  - [CodexConfig](#codexconfig)
- [Discovery Types](#discovery-types)
  - [DiscoveredTool](#discoveredtool)
  - [ScanResult](#scanresult)
- [Master AI Types](#master-ai-types)
  - [MasterState](#masterstate)
  - [ExplorationSummary](#explorationsummary)
- [Core Classes](#core-classes)
  - [Bridge](#bridge)
  - [Router](#router)
  - [AuthService](#authservice)
  - [MessageQueue](#messagequeue)
  - [PluginRegistry](#pluginregistry)
  - [RateLimiter](#ratelimiter)
  - [ConfigWatcher](#configwatcher)
  - [AuditLogger](#auditlogger)
  - [HealthServer](#healthserver)
  - [MetricsCollector](#metricscollector)
  - [MetricsServer](#metricsserver)
- [Error Handling](#error-handling)
  - [ProviderError](#providererror)
  - [classifyError()](#classifyerror)
- [Configuration Schemas](#configuration-schemas)
  - [AppConfigV2 (current)](#appconfigv2-current)
  - [AppConfig (V0 legacy)](#appconfig-v0-legacy)
  - [AuthConfig](#authconfig)
  - [RateLimitConfig](#ratelimitconfig)
  - [CommandFilterConfig](#commandfilterconfig)
  - [QueueConfig](#queueconfig)
  - [RouterConfig](#routerconfig)
  - [AuditConfig](#auditconfig)
  - [HealthConfig](#healthconfig)
  - [MetricsConfig](#metricsconfig)
- [Memory Classes](#memory-classes)
  - [ConversationStore](#conversationstore)
- [Master AI Classes](#master-ai-classes)
  - [DotFolderManager](#dotfoldermanager)
- [Utility Functions](#utility-functions)
  - [loadConfig()](#loadconfig)
  - [scanForAITools()](#scanforaitools)
  - [createLogger()](#createlogger)
- [Built-in Commands](#built-in-commands)
  - [/history](#history-command)
- [HTTP Endpoints](#http-endpoints)
  - [Health Check](#health-check-endpoint)
  - [Metrics](#metrics-endpoint)
  - [Sessions (WebChat)](#sessions-endpoints-webchat)

---

## Message Types

_Source: `src/types/message.ts`_

### InboundMessage

A message received from a messaging connector.

| Property     | Type                      | Description                                        |
| ------------ | ------------------------- | -------------------------------------------------- |
| `id`         | `string`                  | Unique message ID (from the platform or generated) |
| `source`     | `string`                  | The connector that received this message           |
| `sender`     | `string`                  | Sender identifier (phone number, user ID, etc.)    |
| `rawContent` | `string`                  | The raw message text as received                   |
| `content`    | `string`                  | Cleaned content (prefix stripped, trimmed)         |
| `timestamp`  | `Date`                    | When the message was received                      |
| `metadata?`  | `Record<string, unknown>` | Optional platform-specific metadata                |

### OutboundMessage

A response to be sent back through a connector.

| Property    | Type                      | Description                                  |
| ----------- | ------------------------- | -------------------------------------------- |
| `target`    | `string`                  | The connector to send through                |
| `recipient` | `string`                  | The recipient identifier                     |
| `content`   | `string`                  | The response content                         |
| `replyTo?`  | `string`                  | Reference to the original inbound message ID |
| `metadata?` | `Record<string, unknown>` | Optional metadata for the connector          |

---

## Plugin Interfaces

### Connector

_Source: `src/types/connector.ts`_

Interface that every messaging connector must implement.

| Member                   | Type                                                         | Description                                      |
| ------------------------ | ------------------------------------------------------------ | ------------------------------------------------ |
| `name`                   | `readonly string`                                            | Unique identifier (e.g. `'whatsapp'`, `'slack'`) |
| `initialize()`           | `() => Promise<void>`                                        | Connect to the messaging platform                |
| `sendMessage(message)`   | `(message: OutboundMessage) => Promise<void>`                | Send a response back through the platform        |
| `sendTypingIndicator?()` | `(chatId: string) => Promise<void>`                          | Send a typing indicator (optional, best-effort)  |
| `on(event, listener)`    | `<E extends keyof ConnectorEvents>(event, listener) => void` | Register event listeners                         |
| `shutdown()`             | `() => Promise<void>`                                        | Gracefully shut down the connector               |
| `isConnected()`          | `() => boolean`                                              | Check if currently connected                     |

### ConnectorEvents

Events emitted by a connector, consumed via `connector.on(event, listener)`.

| Event          | Listener Signature                  | Description                         |
| -------------- | ----------------------------------- | ----------------------------------- |
| `message`      | `(message: InboundMessage) => void` | A valid, filtered message arrived   |
| `ready`        | `() => void`                        | Connector is ready to send/receive  |
| `auth`         | `(data: unknown) => void`           | Authentication event (e.g. QR code) |
| `error`        | `(error: Error) => void`            | Connector error                     |
| `disconnected` | `(reason: string) => void`          | Connector disconnected              |

### AIProvider

_Source: `src/types/provider.ts`_

Interface for AI providers. In V0, providers are manually registered. In V2, the Master AI uses the generalized executor to run any discovered CLI tool.

| Member             | Type                                                                  | Description                                                       |
| ------------------ | --------------------------------------------------------------------- | ----------------------------------------------------------------- |
| `name`             | `readonly string`                                                     | Unique identifier (e.g. `'claude-code'`)                          |
| `initialize()`     | `() => Promise<void>`                                                 | Validate credentials, warm up                                     |
| `processMessage()` | `(message: InboundMessage) => Promise<ProviderResult>`                | Process a message and return the AI response                      |
| `streamMessage?()` | `(message: InboundMessage) => AsyncGenerator<string, ProviderResult>` | Stream response chunks (optional, falls back to `processMessage`) |
| `isAvailable()`    | `() => Promise<boolean>`                                              | Check if the provider is ready                                    |
| `shutdown()`       | `() => Promise<void>`                                                 | Gracefully shut down                                              |

### ProviderResult

Result returned by an AI provider after processing.

| Property    | Type     | Description                    |
| ----------- | -------- | ------------------------------ |
| `content`   | `string` | The AI-generated response text |
| `metadata?` | `object` | Optional processing metadata   |

`metadata` may include:

| Property      | Type                     | Description                       |
| ------------- | ------------------------ | --------------------------------- |
| `durationMs?` | `number`                 | Processing duration in ms         |
| `usage?`      | `Record<string, number>` | Token count or similar usage data |
| `[key]`       | `unknown`                | Provider-specific data            |

### SpawnOptions

_Source: `src/core/agent-runner.ts`_

Options accepted by `AgentRunner.spawn()`. Adapter-specific fields are silently dropped by adapters that don't support them.

| Property           | Type       | Default | Description                                                                          |
| ------------------ | ---------- | ------- | ------------------------------------------------------------------------------------ |
| `prompt`           | `string`   | —       | The prompt to send to the AI agent                                                   |
| `workspacePath`    | `string`   | —       | Working directory for the agent process                                              |
| `model?`           | `string`   | —       | Tier alias (`'haiku'`, `'sonnet'`, `'opus'`) or a full model ID                      |
| `allowedTools?`    | `string[]` | —       | Tools the agent may use. Mapped to `--allowedTools` (Claude) or sandbox mode (Codex) |
| `maxTurns?`        | `number`   | —       | Max agentic turns before stopping. Claude only — dropped by Codex/Aider adapters     |
| `timeout?`         | `number`   | —       | Timeout in milliseconds per attempt                                                  |
| `retries?`         | `number`   | `3`     | Number of retry attempts on non-zero exit codes                                      |
| `retryDelay?`      | `number`   | `10000` | Delay in milliseconds between retry attempts                                         |
| `logFile?`         | `string`   | —       | Path to write the full agent log output                                              |
| `sessionId?`       | `string`   | —       | Start a new named session (`--session-id` for Claude, named session for Codex)       |
| `resumeSessionId?` | `string`   | —       | Resume a prior session (`--resume` for Claude, `exec resume --last` for Codex)       |
| `systemPrompt?`    | `string`   | —       | System prompt injected at the top of the agent context                               |
| `maxBudgetUsd?`    | `number`   | —       | Max spend in USD (`--max-budget-usd` for Claude; dropped by Codex/Aider)             |
| `mcpConfigPath?`   | `string`   | —       | Path to MCP config JSON (`--mcp-config` for Claude, `-c` for Codex; Aider drops it)  |

---

## CLI Adapter Layer

_Source: `src/core/cli-adapter.ts`, `src/core/adapter-registry.ts`, `src/core/adapters/`_

The CLI Adapter layer translates provider-neutral `SpawnOptions` into tool-specific binary, args, and env for each supported AI CLI (`claude`, `codex`, `aider`). This abstraction lets the rest of OpenBridge remain tool-agnostic.

```
SpawnOptions → CLIAdapter.buildSpawnConfig() → CLISpawnConfig → child_process.spawn()
```

### CLIAdapter

Interface that every CLI adapter must implement.

| Member                      | Type                                                        | Description                                                                                                                                             |
| --------------------------- | ----------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `name`                      | `readonly string`                                           | Provider name matching `DiscoveredTool.name` (e.g. `'claude'`, `'codex'`, `'aider'`)                                                                    |
| `buildSpawnConfig(opts)`    | `(opts: SpawnOptions) => CLISpawnConfig`                    | Translate `SpawnOptions` into the binary, args, and env for this CLI                                                                                    |
| `cleanEnv(env)`             | `(env: Record<string, string \| undefined>) => Record<...>` | Strip env vars that would cause conflicts for this CLI                                                                                                  |
| `mapCapabilityLevel(level)` | `(level: CapabilityLevel) => string[] \| undefined`         | Map capability level to CLI-specific access restrictions. Returns `undefined` if the CLI doesn't use tool lists (e.g. Codex uses sandbox modes instead) |
| `isValidModel(model)`       | `(model: string) => boolean`                                | Return `true` if the model string is recognized by this CLI                                                                                             |

### CLISpawnConfig

The output of `CLIAdapter.buildSpawnConfig()` — everything needed to call `child_process.spawn()`.

| Property       | Type                                  | Description                                                                                                                                                           |
| -------------- | ------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `binary`       | `string`                              | Command name or absolute path to the binary                                                                                                                           |
| `args`         | `string[]`                            | CLI arguments array                                                                                                                                                   |
| `env`          | `Record<string, string \| undefined>` | Environment variables (cleaned of conflicting vars)                                                                                                                   |
| `stdin?`       | `'ignore' \| 'pipe'`                  | stdin behavior. `'ignore'` closes stdin (default for Claude/Codex). `'pipe'` provides a writable stream for CLIs that require TTY detection.                          |
| `parseOutput?` | `(stdout: string) => string`          | Optional post-processor for raw stdout. Used by Codex to extract the final message from `--json` JSONL. Falls back to raw stdout if absent or if the function throws. |

### CapabilityLevel

```typescript
type CapabilityLevel = 'read-only' | 'code-edit' | 'full-access';
```

Maps tool profiles to CLI-specific access mechanisms:

| Level           | Claude (`--allowedTools`)                                 | Codex (`--sandbox`)         |
| --------------- | --------------------------------------------------------- | --------------------------- |
| `'read-only'`   | `Read, Glob, Grep`                                        | `read-only`                 |
| `'code-edit'`   | `Read, Edit, Write, Glob, Grep, Bash(git:*), Bash(npm:*)` | `workspace-write`           |
| `'full-access'` | All tools                                                 | `--full-auto` (danger mode) |

### AdapterRegistry

_Source: `src/core/adapter-registry.ts`_

Maps discovered tool names to `CLIAdapter` instances. Built-in adapters (`claude`, `codex`, `aider`) are lazy-loaded on first access. Custom adapters registered via `register()` take priority over built-ins.

**Methods:**

| Method                    | Returns                   | Description                                                         |
| ------------------------- | ------------------------- | ------------------------------------------------------------------- |
| `register(name, adapter)` | `void`                    | Register a `CLIAdapter` for a tool name (overrides built-ins)       |
| `get(name)`               | `CLIAdapter \| undefined` | Get the adapter for a tool name, creating from built-ins if needed  |
| `getForTool(tool)`        | `CLIAdapter \| undefined` | Get the adapter for a `DiscoveredTool`                              |
| `has(name)`               | `boolean`                 | Check if an adapter exists for a tool name (registered or built-in) |

**Factory:**

```typescript
function createAdapterRegistry(): AdapterRegistry;
```

Creates an `AdapterRegistry` pre-loaded with the `ClaudeAdapter`.

**Built-in adapters:**

| Tool name | Adapter         | Source                                |
| --------- | --------------- | ------------------------------------- |
| `claude`  | `ClaudeAdapter` | `src/core/adapters/claude-adapter.ts` |
| `codex`   | `CodexAdapter`  | `src/core/adapters/codex-adapter.ts`  |
| `aider`   | `AiderAdapter`  | `src/core/adapters/aider-adapter.ts`  |

### CodexAdapter

_Source: `src/core/adapters/codex-adapter.ts`_

Translates `SpawnOptions` into `codex exec` arguments for non-interactive Codex CLI execution.

**Flags always included:**

| Flag                    | Value                    | Reason                                                                         |
| ----------------------- | ------------------------ | ------------------------------------------------------------------------------ |
| `--skip-git-repo-check` | (boolean flag)           | Required for non-git or untrusted workspaces — Codex refuses to run without it |
| `--json`                | (boolean flag)           | Enables JSONL structured output (one JSON event per line to stdout)            |
| `-o <tempFile>`         | Auto-generated temp path | Reliable final-answer capture. Codex writes the last message to this file      |
| `--ephemeral`           | (worker spawns only)     | Suppresses session persistence for short-lived worker invocations              |

**Flags set conditionally:**

| Flag               | Condition                             | Value                                                      |
| ------------------ | ------------------------------------- | ---------------------------------------------------------- |
| `--model <M>`      | `opts.model` is set                   | Model string passed through                                |
| `--sandbox <mode>` | `allowedTools` present, not `Bash(*)` | `read-only` or `workspace-write`                           |
| `--full-auto`      | `Bash(*)` in `allowedTools`           | Enables auto-approve + full sandbox (`danger-full-access`) |
| `-c <path>`        | `opts.mcpConfigPath` is set           | MCP config file for Codex-native MCP passthrough           |

**Sandbox inference** from `allowedTools`:

| `allowedTools` content               | Sandbox mode                             |
| ------------------------------------ | ---------------------------------------- |
| `Bash(*)` present                    | `danger-full-access` (via `--full-auto`) |
| `Edit` or `Write` present            | `workspace-write`                        |
| Empty, undefined, or read-only tools | `read-only` (safe default)               |

**Output parsing priority:**

1. Read the `-o` temp file — Codex's most reliable output path
2. Fall back to `--json` JSONL parsing (`parseCodexJsonlOutput()`) if the temp file is absent
3. Fall back to raw stdout if no parseable `type: "message"` event is found

**OPENAI_API_KEY validation:** `buildSpawnConfig()` throws immediately if `OPENAI_API_KEY` is not set, preventing confusing downstream auth failures.

**Valid models** (Codex CLI v0.104.0): `gpt-5.2-codex` (default), `o3`, `o4-mini`. Any model ID matching `/^(gpt-|o[0-9]|codex)/` is also accepted for forward compatibility.

---

## Built-in Providers

### CodexProvider

_Source: `src/providers/codex/codex-provider.ts`_

`AIProvider` implementation for the OpenAI Codex CLI. Uses `AgentRunner` + `CodexAdapter` internally — the same pattern as `ClaudeCodeProvider`.

```typescript
import { CodexProvider } from './providers/codex/index.js';

const provider = new CodexProvider({
  workspacePath: '/path/to/project',
  timeout: 120000,
  model: 'gpt-5.2-codex',
});

await provider.initialize();
```

**Methods:**

| Method                    | Returns                                  | Description                                                                                          |
| ------------------------- | ---------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| `initialize()`            | `Promise<void>`                          | Validates `workspacePath` is accessible                                                              |
| `processMessage(message)` | `Promise<ProviderResult>`                | Runs `codex exec` with session wiring and returns the AI response                                    |
| `streamMessage(message)`  | `AsyncGenerator<string, ProviderResult>` | Falls back to `processMessage()` — yields the result in one chunk (Codex has no real-time streaming) |
| `isAvailable()`           | `Promise<boolean>`                       | Returns `true` if `codex` binary is on PATH and `OPENAI_API_KEY` is set                              |
| `shutdown()`              | `Promise<void>`                          | Clears all active sessions                                                                           |

**Session management:** Sessions are scoped by `sender:workspacePath`. The first message in a session window starts a new Codex session; follow-up messages use `codex exec resume --last`. Sessions expire after the configured TTL (default 30 minutes).

### CodexConfig

_Source: `src/providers/codex/codex-config.ts`_

Zod schema for `CodexProvider` constructor options.

| Property        | Type     | Default            | Description                                                                        |
| --------------- | -------- | ------------------ | ---------------------------------------------------------------------------------- |
| `workspacePath` | `string` | `'.'`              | Working directory for Codex invocations. Supports `~/` home directory expansion    |
| `timeout`       | `number` | `120000` (2 min)   | Timeout per invocation in milliseconds                                             |
| `model?`        | `string` | —                  | Codex model override. Defaults to the Codex CLI's built-in default                 |
| `sandbox?`      | `string` | —                  | Sandbox mode override (`'read-only'`, `'workspace-write'`, `'danger-full-access'`) |
| `sessionTtlMs`  | `number` | `1800000` (30 min) | Session inactivity TTL in milliseconds                                             |

---

## Discovery Types

_Source: `src/types/discovery.ts`_

### DiscoveredTool

An AI tool found on the machine during startup scan.

| Property       | Type       | Description                                                                       |
| -------------- | ---------- | --------------------------------------------------------------------------------- |
| `name`         | `string`   | Tool identifier (`'claude'`, `'codex'`, `'aider'`, etc.)                          |
| `path`         | `string`   | Absolute path to the CLI binary                                                   |
| `version?`     | `string`   | Version string (from `--version`)                                                 |
| `capabilities` | `string[]` | List of capabilities (e.g. `['code-generation', 'file-editing', 'conversation']`) |
| `role`         | `string`   | `'master'` or `'delegate'`                                                        |
| `available`    | `boolean`  | Whether the tool was found and is usable                                          |

### ScanResult

Result of the full AI tool discovery scan.

| Property         | Type                     | Description                           |
| ---------------- | ------------------------ | ------------------------------------- |
| `tools`          | `DiscoveredTool[]`       | All discovered tools                  |
| `master`         | `DiscoveredTool \| null` | The tool selected as Master           |
| `scanDurationMs` | `number`                 | How long the scan took (milliseconds) |

---

## Master AI Types

_Source: `src/types/master.ts`_

### MasterState

The lifecycle state of the Master AI.

```typescript
type MasterState = 'idle' | 'exploring' | 'ready' | 'error';
```

### ExplorationSummary

Summary of the Master AI's workspace exploration.

| Property      | Type       | Description                                |
| ------------- | ---------- | ------------------------------------------ |
| `name`        | `string`   | Project name (from package.json or folder) |
| `description` | `string`   | Brief project description                  |
| `languages`   | `string[]` | Detected languages                         |
| `frameworks`  | `string[]` | Detected frameworks                        |
| `exploredAt`  | `string`   | ISO 8601 timestamp of exploration          |

---

## Core Classes

### Bridge

_Source: `src/core/bridge.ts`_

Main orchestrator that wires connectors, auth, queue, Master AI, and all subsystems together.

```typescript
import { Bridge } from './core/bridge.js';

const bridge = new Bridge(config, { configPath: './config.json' });

// Register connectors before starting
const registry = bridge.getRegistry();
registry.registerConnector('whatsapp', whatsappFactory);

// In V2: Master AI is set after discovery
bridge.setMaster(masterManager);

await bridge.start();
await bridge.stop();
```

**Methods:**

| Method          | Returns          | Description                                        |
| --------------- | ---------------- | -------------------------------------------------- |
| `getRegistry()` | `PluginRegistry` | Access the plugin registry for registering plugins |
| `setMaster()`   | `void`           | Wire a MasterManager into the router               |
| `start()`       | `Promise<void>`  | Initialize all plugins, start processing           |
| `stop()`        | `Promise<void>`  | Drain queue, shut down Master + plugins gracefully |

---

### Router

_Source: `src/core/router.ts`_

Routes inbound messages to the Master AI (V2) or directly to a provider (V0), and sends responses back through the originating connector.

**Methods:**

| Method                    | Returns         | Description                                  |
| ------------------------- | --------------- | -------------------------------------------- |
| `addConnector(connector)` | `void`          | Register an active connector                 |
| `addProvider(provider)`   | `void`          | Register an active provider (V0)             |
| `setMaster(master)`       | `void`          | Set the Master AI for routing (V2, priority) |
| `route(message)`          | `Promise<void>` | Route a message through the full pipeline    |

**Routing priority:** Master AI > direct provider (V0 fallback).

---

### AuthService

_Source: `src/core/auth.ts`_

Handles sender authorization, prefix detection, prefix stripping, and command filtering.

**Methods:**

| Method                   | Returns               | Description                                        |
| ------------------------ | --------------------- | -------------------------------------------------- |
| `isAuthorized(sender)`   | `boolean`             | Check if sender is whitelisted (empty list = open) |
| `hasPrefix(content)`     | `boolean`             | Check if message starts with the configured prefix |
| `stripPrefix(content)`   | `string`              | Remove the prefix and return cleaned content       |
| `filterCommand(command)` | `CommandFilterResult` | Check command against allow/deny pattern lists     |
| `updateConfig(config)`   | `void`                | Hot-reload auth configuration                      |

---

### MessageQueue

_Source: `src/core/queue.ts`_

Per-user message queue. Each sender gets its own sequential queue so one slow response does not block messages from other users.

**Methods:**

| Method               | Returns            | Description                                         |
| -------------------- | ------------------ | --------------------------------------------------- |
| `onMessage(handler)` | `void`             | Register the message processing handler             |
| `enqueue(message)`   | `Promise<void>`    | Add a message to the sender's queue                 |
| `drain()`            | `Promise<void>`    | Wait for all queues to empty (used during shutdown) |
| `flushDeadLetters()` | `DeadLetterItem[]` | Remove and return all dead letter items             |

**Properties:**

| Property         | Type      | Description                            |
| ---------------- | --------- | -------------------------------------- |
| `size`           | `number`  | Total queued messages across all users |
| `isProcessing`   | `boolean` | Whether any user queue is active       |
| `deadLetterSize` | `number`  | Number of dead letter items            |

---

### PluginRegistry

_Source: `src/core/registry.ts`_

Factory registry for connectors. Supports both manual registration and auto-discovery.

**Methods:**

| Method                             | Returns         | Description                               |
| ---------------------------------- | --------------- | ----------------------------------------- |
| `registerConnector(type, factory)` | `void`          | Register a connector factory by type name |
| `createConnector(type, options)`   | `Connector`     | Create a connector instance from config   |
| `discoverPlugins(srcDir)`          | `Promise<void>` | Auto-discover plugins in connector dirs   |

---

### RateLimiter

_Source: `src/core/rate-limiter.ts`_

Sliding-window rate limiter. Tracks per-sender message timestamps and rejects messages that exceed the configured threshold.

**Methods:**

| Method                 | Returns   | Description                                            |
| ---------------------- | --------- | ------------------------------------------------------ |
| `isAllowed(sender)`    | `boolean` | `true` if within limit, `false` if rate limit exceeded |
| `updateConfig(config)` | `void`    | Hot-reload rate limiter configuration                  |

---

### ConfigWatcher

_Source: `src/core/config-watcher.ts`_

Watches `config.json` for file changes and triggers hot-reload handlers with debouncing.

**Methods:**

| Method              | Returns | Description                      |
| ------------------- | ------- | -------------------------------- |
| `onChange(handler)` | `void`  | Register a config change handler |
| `start()`           | `void`  | Start watching the config file   |
| `stop()`            | `void`  | Stop watching                    |

---

### AuditLogger

_Source: `src/core/audit-logger.ts`_

Persists message events as JSONL (one JSON object per line) to a configurable log file.

**Methods:**

| Method                       | Returns         | Description                   |
| ---------------------------- | --------------- | ----------------------------- |
| `logInbound(message)`        | `Promise<void>` | Log an inbound message event  |
| `logOutbound(message)`       | `Promise<void>` | Log an outbound message event |
| `logAuthDenied(sender)`      | `Promise<void>` | Log an authorization denial   |
| `logRateLimited(sender)`     | `Promise<void>` | Log a rate limit event        |
| `logError(messageId, error)` | `Promise<void>` | Log a processing error        |

---

### HealthServer

_Source: `src/core/health.ts`_

HTTP server exposing bridge health status as JSON.

**Methods:**

| Method                      | Returns         | Description                  |
| --------------------------- | --------------- | ---------------------------- |
| `setDataProvider(provider)` | `void`          | Set the health data callback |
| `start()`                   | `Promise<void>` | Start the HTTP server        |
| `stop()`                    | `Promise<void>` | Stop the HTTP server         |

**HealthStatus** (response shape):

| Property     | Type                                     | Description                  |
| ------------ | ---------------------------------------- | ---------------------------- |
| `status`     | `'healthy' \| 'degraded' \| 'unhealthy'` | Overall bridge status        |
| `uptime`     | `number`                                 | Seconds since bridge started |
| `timestamp`  | `string`                                 | ISO 8601 timestamp           |
| `connectors` | `ComponentStatus[]`                      | Status of each connector     |
| `queue`      | `object`                                 | Queue state                  |

---

### MetricsCollector

_Source: `src/core/metrics.ts`_

In-memory metrics collector. Tracks message counts, latency, and error rates.

**Methods:**

| Method                      | Returns           | Description                             |
| --------------------------- | ----------------- | --------------------------------------- |
| `recordReceived()`          | `void`            | Increment received message counter      |
| `recordProcessed(duration)` | `void`            | Record a successfully processed message |
| `recordFailed(kind)`        | `void`            | Record a failed message by error kind   |
| `snapshot()`                | `MetricsSnapshot` | Return a point-in-time metrics snapshot |

### MetricsServer

_Source: `src/core/metrics.ts`_

HTTP server that exposes collected metrics as JSON.

**Methods:**

| Method                      | Returns         | Description                   |
| --------------------------- | --------------- | ----------------------------- |
| `setDataProvider(provider)` | `void`          | Set the metrics data callback |
| `start()`                   | `Promise<void>` | Start the HTTP server         |
| `stop()`                    | `Promise<void>` | Stop the HTTP server          |

---

## Error Handling

_Source: `src/providers/claude-code/provider-error.ts`_

### ProviderError

Custom error class for classified provider failures.

| Property   | Type        | Description                                |
| ---------- | ----------- | ------------------------------------------ |
| `kind`     | `ErrorKind` | `'transient'` (retryable) or `'permanent'` |
| `exitCode` | `number`    | CLI exit code that triggered the error     |
| `message`  | `string`    | Human-readable error description           |

### classifyError()

```typescript
function classifyError(exitCode: number, stderr: string): ErrorKind;
```

Classifies a CLI execution failure as transient or permanent:

1. Exit code 124 (timeout) -> transient
2. stderr matches transient patterns (timeout, rate limit, network errors) -> transient
3. stderr matches permanent patterns (auth failure, not found, bad request) -> permanent
4. Default for unrecognized errors -> transient (safer to retry)

---

## Configuration Schemas

_Source: `src/types/config.ts`_

All configuration is validated at startup using [Zod](https://zod.dev) schemas. The config loader tries V2 first, then falls back to V0.

### AppConfigV2 (current)

The simplified config format. Three required fields.

| Property        | Type     | Default   | Description                                    |
| --------------- | -------- | --------- | ---------------------------------------------- |
| `workspacePath` | `string` | —         | Absolute path to the target project (required) |
| `channels`      | `array`  | —         | At least one channel config (required)         |
| `auth`          | `object` | —         | Authentication settings (required)             |
| `master?`       | `object` | `{}`      | Override auto-detected Master AI settings      |
| `queue?`        | `object` | see below | Queue retry configuration                      |
| `router?`       | `object` | see below | Router configuration                           |
| `audit?`        | `object` | see below | Audit logging configuration                    |
| `health?`       | `object` | see below | Health check endpoint config                   |
| `metrics?`      | `object` | see below | Metrics endpoint configuration                 |
| `logLevel?`     | `string` | `'info'`  | One of: trace, debug, info, warn, error, fatal |

**Channel config:**

| Property   | Type                      | Default | Description                              |
| ---------- | ------------------------- | ------- | ---------------------------------------- |
| `type`     | `string`                  | —       | Channel type (`'whatsapp'`, `'console'`) |
| `enabled?` | `boolean`                 | `true`  | Whether this channel is active           |
| `options?` | `Record<string, unknown>` | `{}`    | Channel-specific options                 |

### AppConfig (V0 legacy)

The original config format. Still fully supported — auto-detected by the config loader.

| Property          | Type                | Default   | Description                       |
| ----------------- | ------------------- | --------- | --------------------------------- |
| `connectors`      | `ConnectorConfig[]` | —         | At least one connector (required) |
| `providers`       | `ProviderConfig[]`  | —         | At least one provider (required)  |
| `defaultProvider` | `string`            | —         | Name of the default provider      |
| `auth`            | `AuthConfig`        | —         | Authentication configuration      |
| `queue?`          | `QueueConfig`       | see below | Queue retry configuration         |
| `router?`         | `RouterConfig`      | see below | Router configuration              |
| `audit?`          | `AuditConfig`       | see below | Audit logging configuration       |
| `health?`         | `HealthConfig`      | see below | Health check endpoint config      |
| `metrics?`        | `MetricsConfig`     | see below | Metrics endpoint configuration    |
| `logLevel?`       | `string`            | `'info'`  | Log level                         |

### AuthConfig

| Property         | Type                  | Default | Description                       |
| ---------------- | --------------------- | ------- | --------------------------------- |
| `whitelist?`     | `string[]`            | `[]`    | Allowed sender identifiers        |
| `prefix?`        | `string`              | `'/ai'` | Message prefix to trigger the bot |
| `rateLimit?`     | `RateLimitConfig`     | `{}`    | Rate limit settings               |
| `commandFilter?` | `CommandFilterConfig` | `{}`    | Command allow/deny lists          |

### RateLimitConfig

| Property       | Type      | Default | Description                             |
| -------------- | --------- | ------- | --------------------------------------- |
| `enabled?`     | `boolean` | `true`  | Enable/disable rate limiting            |
| `maxMessages?` | `number`  | `10`    | Max messages per window per sender      |
| `windowMs?`    | `number`  | `60000` | Sliding window duration in milliseconds |

### CommandFilterConfig

| Property         | Type       | Default                          | Description                                 |
| ---------------- | ---------- | -------------------------------- | ------------------------------------------- |
| `allowPatterns?` | `string[]` | `[]`                             | Regex patterns — command must match one     |
| `denyPatterns?`  | `string[]` | `[]`                             | Regex patterns — command must not match any |
| `denyMessage?`   | `string`   | `'That command is not allowed.'` | Message returned when command is denied     |

### QueueConfig

| Property        | Type     | Default | Description                                        |
| --------------- | -------- | ------- | -------------------------------------------------- |
| `maxRetries?`   | `number` | `3`     | Max retry attempts for failed messages             |
| `retryDelayMs?` | `number` | `1000`  | Base delay between retries (multiplied by attempt) |

### RouterConfig

| Property              | Type     | Default | Description                                   |
| --------------------- | -------- | ------- | --------------------------------------------- |
| `progressIntervalMs?` | `number` | `15000` | Interval for progress update messages (in ms) |

### AuditConfig

| Property   | Type      | Default       | Description                      |
| ---------- | --------- | ------------- | -------------------------------- |
| `enabled?` | `boolean` | `false`       | Enable/disable audit logging     |
| `logPath?` | `string`  | `'audit.log'` | Path to the JSONL audit log file |

### HealthConfig

| Property   | Type      | Default | Description                          |
| ---------- | --------- | ------- | ------------------------------------ |
| `enabled?` | `boolean` | `false` | Enable/disable health check endpoint |
| `port?`    | `number`  | `8080`  | HTTP port for the health endpoint    |

### MetricsConfig

| Property   | Type      | Default | Description                        |
| ---------- | --------- | ------- | ---------------------------------- |
| `enabled?` | `boolean` | `false` | Enable/disable metrics endpoint    |
| `port?`    | `number`  | `9090`  | HTTP port for the metrics endpoint |

---

## Memory Classes

### ConversationStore

_Source: `src/memory/conversation-store.ts`_

Functions for querying conversation history stored in the SQLite memory database.

#### listSessions()

```typescript
function listSessions(db: Database.Database, limit?: number, offset?: number): SessionSummary[];
```

Returns a paginated list of conversation sessions ordered by most recent activity.

| Parameter | Type                | Default | Description                |
| --------- | ------------------- | ------- | -------------------------- |
| `db`      | `Database.Database` | —       | SQLite database instance   |
| `limit`   | `number`            | `20`    | Maximum sessions to return |
| `offset`  | `number`            | `0`     | Pagination offset          |

**Returns:** `SessionSummary[]` — sessions ordered by `last_message_at DESC`.

**SessionSummary:**

| Property           | Type             | Description                                   |
| ------------------ | ---------------- | --------------------------------------------- |
| `session_id`       | `string`         | Unique session identifier                     |
| `title`            | `string \| null` | Session title (first user message, ≤50 chars) |
| `first_message_at` | `string`         | ISO 8601 timestamp of first message           |
| `last_message_at`  | `string`         | ISO 8601 timestamp of most recent message     |
| `message_count`    | `number`         | Total messages in the session                 |
| `channel`          | `string \| null` | Channel that originated the session           |
| `user_id`          | `string \| null` | Sender identifier                             |

#### searchSessions()

```typescript
function searchSessions(db: Database.Database, query: string, limit?: number): SessionSummary[];
```

Full-text search over conversation content returning session-level results via FTS5.

| Parameter | Type                | Default | Description                |
| --------- | ------------------- | ------- | -------------------------- |
| `db`      | `Database.Database` | —       | SQLite database instance   |
| `query`   | `string`            | —       | Search query string        |
| `limit`   | `number`            | `10`    | Maximum sessions to return |

**Returns:** `SessionSummary[]` ranked by number of matching messages, then by recency. Returns `[]` if query is empty or no matches found. FTS5 special characters are sanitized before querying.

#### getSessionHistory()

```typescript
function getSessionHistory(
  db: Database.Database,
  sessionId: string,
  limit?: number,
): ConversationEntry[];
```

Retrieves the full message transcript for one conversation session.

| Parameter   | Type                | Default | Description                                                 |
| ----------- | ------------------- | ------- | ----------------------------------------------------------- |
| `db`        | `Database.Database` | —       | SQLite database instance                                    |
| `sessionId` | `string`            | —       | Session ID to retrieve                                      |
| `limit`     | `number`            | `50`    | Maximum messages to return (most recent, then oldest-first) |

**Returns:** `ConversationEntry[]` in chronological order (oldest first). Returns `[]` if session not found.

**ConversationEntry:**

| Property     | Type                                         | Description                      |
| ------------ | -------------------------------------------- | -------------------------------- |
| `id`         | `number`                                     | Auto-increment row ID            |
| `session_id` | `string`                                     | Parent session identifier        |
| `role`       | `'user' \| 'master' \| 'worker' \| 'system'` | Who sent this message            |
| `content`    | `string`                                     | Message text                     |
| `channel`    | `string \| undefined`                        | Channel that carried the message |
| `user_id`    | `string \| undefined`                        | Sender identifier                |
| `created_at` | `string`                                     | ISO 8601 timestamp               |

---

## Master AI Classes

### DotFolderManager

_Source: `src/master/dotfolder-manager.ts`_

Manages the `.openbridge/` folder in the target workspace: exploration state, context memory, and the prompt library.

#### Prompt Library Methods

##### readPromptManifest()

```typescript
readPromptManifest(): Promise<PromptManifest | null>
```

Reads `.openbridge/prompts/manifest.json` and returns the parsed manifest, or `null` if the file does not exist or fails to parse.

##### writePromptManifest()

```typescript
writePromptManifest(manifest: PromptManifest): Promise<void>
```

Validates and writes the manifest to `.openbridge/prompts/manifest.json`. Creates the `prompts/` directory if needed.

##### writePromptTemplate()

```typescript
writePromptTemplate(
  filename: string,
  content: string,
  metadata: Omit<PromptTemplate, 'filePath' | 'createdAt' | 'updatedAt'>,
): Promise<void>
```

Writes a prompt template `.md` file to `.openbridge/prompts/<filename>` and creates or updates its entry in the manifest. Preserves `createdAt` when overwriting; sets `previousVersion` and `previousSuccessRate` when updating an existing entry.

##### getPromptTemplate()

```typescript
getPromptTemplate(id: string): Promise<PromptTemplate | null>
```

Looks up a prompt template by ID in the manifest. Returns `null` if the manifest does not exist or the ID is not found.

##### recordPromptUsage()

```typescript
recordPromptUsage(id: string, success: boolean): Promise<void>
```

Increments `usageCount`, conditionally increments `successCount`, recalculates `successRate = successCount / usageCount`, and updates `lastUsedAt`. No-op if the prompt ID is not found.

##### getLowPerformingPrompts()

```typescript
getLowPerformingPrompts(threshold: number): Promise<PromptTemplate[]>
```

Returns all prompts where `usageCount >= 3` AND `successRate < threshold`. Used by the prompt evolver to identify candidates for refinement.

##### resetPromptStats()

```typescript
resetPromptStats(id: string): Promise<void>
```

Zeros `usageCount`, `successCount`, and `successRate`. Preserves the previous value in `previousSuccessRate` before resetting. No-op if the ID is not found.

#### Memory File Methods

##### readMemoryFile()

```typescript
readMemoryFile(): Promise<string | null>
```

Reads `.openbridge/context/memory.md` and returns its content as a string, or `null` if the file does not exist. This file is the Master AI's curated cross-session memory.

##### writeMemoryFile()

```typescript
writeMemoryFile(content: string): Promise<void>
```

Writes content to `.openbridge/context/memory.md`. Validates that content is at most 200 lines — throws if exceeded. Creates the `context/` directory if it doesn't exist.

**Prompt Types** — _Source: `src/types/master.ts`_

| Type             | Description                                   |
| ---------------- | --------------------------------------------- |
| `PromptManifest` | `{ prompts: Record<string, PromptTemplate> }` |
| `PromptTemplate` | Full metadata object for one prompt template  |

**PromptTemplate fields:**

| Property              | Type             | Description                                    |
| --------------------- | ---------------- | ---------------------------------------------- |
| `id`                  | `string`         | Unique prompt identifier                       |
| `name`                | `string`         | Human-readable name                            |
| `filePath`            | `string`         | Path to the `.md` file                         |
| `usageCount`          | `number`         | Total times this prompt was used               |
| `successCount`        | `number`         | Times the prompt produced a successful outcome |
| `successRate`         | `number`         | `successCount / usageCount` (0–1)              |
| `createdAt`           | `string`         | ISO 8601 creation timestamp                    |
| `updatedAt`           | `string`         | ISO 8601 last-modified timestamp               |
| `lastUsedAt`          | `string \| null` | ISO 8601 last-used timestamp                   |
| `previousVersion`     | `string \| null` | Content of the previous version (on update)    |
| `previousSuccessRate` | `number \| null` | Success rate before last reset                 |

---

## Utility Functions

### loadConfig()

_Source: `src/core/config.ts`_

```typescript
function loadConfig(configPath?: string): Promise<AppConfig | AppConfigV2>;
```

Reads and validates `config.json`. Tries V2 schema first, falls back to V0. Falls back to `CONFIG_PATH` env var, then `./config.json`.

### scanForAITools()

_Source: `src/discovery/index.ts`_

```typescript
function scanForAITools(): Promise<ScanResult>;
```

Scans the machine for AI CLI tools and VS Code AI extensions. Returns all discovered tools with the recommended Master.

### createLogger()

_Source: `src/core/logger.ts`_

```typescript
function createLogger(name: string, level?: string): pino.Logger;
```

Creates a [Pino](https://getpino.io) logger instance. Uses `pino-pretty` in non-production environments.

---

## Built-in Commands

Built-in commands are intercepted by the Router before any message reaches the Master AI. They require the memory system to be initialized.

### /history Command

_Source: `src/core/router.ts`_

Provides access to past conversation sessions. Three subcommands:

#### `/history` (bare)

Lists the last 10 conversation sessions with title, message count, and date.

```
/history
```

**Response (WhatsApp/Telegram/Discord):**

```
1. What is the project structure? — 12 msgs — 2026-01-15
2. Fix the auth bug — 4 msgs — 2026-01-14
...
```

**Response (Console):** ASCII table with aligned columns.

**Response (WebChat):** HTML table with `<tr>/<td>` cells.

#### `/history search <query>`

Full-text search across all past sessions by keyword. Returns up to 10 matching sessions ranked by relevance.

```
/history search authentication
```

**Error:** Returns an error message if `query` is empty.

#### `/history <session-id>`

Displays the full conversation transcript for one session (up to 50 messages, oldest first).

```
/history a1b2c3d4-...
```

**Response (WhatsApp/Telegram/Discord):**

```
[2026-01-15 10:30] User: What is the project structure?
[2026-01-15 10:30] Master: The project has src/, tests/, and docs/ directories...
```

**Response (Console):** Plain text with separator lines.

**Response (WebChat):** HTML `<div class="msg">` bubbles with time and role.

**Error responses:**

| Condition                         | Message                                                                  |
| --------------------------------- | ------------------------------------------------------------------------ |
| Memory not initialized            | `History not available — memory system not initialized`                  |
| DB query failure                  | `History search/list temporarily unavailable — could not query sessions` |
| No sessions found (bare)          | `No past sessions found`                                                 |
| No sessions found (search)        | `No sessions found matching <query>`                                     |
| Session ID not found (transcript) | `No conversation found for session: <id>`                                |

---

## HTTP Endpoints

### Health Check Endpoint

Enabled via `health.enabled: true` in config. Default port: `8080`.

**Request:** `GET /`

**Response (200 — healthy):**

```json
{
  "status": "healthy",
  "uptime": 3600,
  "timestamp": "2026-02-20T10:30:00.000Z",
  "connectors": [{ "name": "whatsapp", "status": "healthy" }],
  "queue": { "pending": 0, "processing": false, "deadLetterSize": 0 }
}
```

**Response (503 — unhealthy):** Same shape with `"status": "unhealthy"`.

### Metrics Endpoint

Enabled via `metrics.enabled: true` in config. Default port: `9090`.

**Request:** `GET /`

**Response (200):**

```json
{
  "uptime": 3600,
  "timestamp": "2026-02-20T10:30:00.000Z",
  "messages": {
    "received": 150,
    "authorized": 140,
    "rateLimited": 5,
    "commandBlocked": 2,
    "processed": 133,
    "failed": 3
  },
  "latency": {
    "count": 133,
    "totalMs": 266000,
    "avgMs": 2000,
    "minMs": 500,
    "maxMs": 15000
  },
  "queue": { "enqueued": 140, "retries": 4, "deadLettered": 1 },
  "errors": { "total": 3, "transient": 2, "permanent": 1 }
}
```

---

### Sessions Endpoints (WebChat)

_Source: `src/connectors/webchat/webchat-connector.ts`_

Available when the WebChat connector is enabled. Requires the memory system to be initialized (memory must be wired via `setMemory()` on the connector).

#### GET /api/sessions

Returns a paginated list of conversation sessions.

**Query Parameters:**

| Parameter | Type     | Default | Description                               |
| --------- | -------- | ------- | ----------------------------------------- |
| `limit`   | `number` | `20`    | Max sessions to return (clamped to 1–100) |
| `offset`  | `number` | `0`     | Pagination offset (min 0)                 |

**Response (200 OK):**

```json
[
  {
    "session_id": "uuid-or-sender-id",
    "title": "What is the project structure?",
    "first_message_at": "2026-01-15T10:30:00.000Z",
    "last_message_at": "2026-01-15T11:45:30.000Z",
    "message_count": 12,
    "channel": "whatsapp",
    "user_id": "+1234567890"
  }
]
```

**Error Responses:**

| Status | Body                                | Condition               |
| ------ | ----------------------------------- | ----------------------- |
| `503`  | `{"error":"Memory not available"}`  | MemoryManager not wired |
| `500`  | `{"error":"Internal server error"}` | DB query error          |

#### GET /api/sessions/:id

Returns the full conversation transcript for one session.

**URL Parameter:** `id` — the session ID (URL-decoded).

**Query Parameters:**

| Parameter | Type     | Default | Description                               |
| --------- | -------- | ------- | ----------------------------------------- |
| `limit`   | `number` | `100`   | Max messages to return (clamped to 1–500) |

**Response (200 OK):**

```json
{
  "session_id": "uuid-or-sender-id",
  "messages": [
    {
      "id": 1,
      "session_id": "uuid-or-sender-id",
      "role": "user",
      "content": "What is the project structure?",
      "channel": "whatsapp",
      "user_id": "+1234567890",
      "created_at": "2026-01-15T10:30:00.000Z"
    },
    {
      "id": 2,
      "session_id": "uuid-or-sender-id",
      "role": "master",
      "content": "The project has src/, tests/, and docs/ directories...",
      "channel": null,
      "user_id": null,
      "created_at": "2026-01-15T10:30:15.000Z"
    }
  ]
}
```

Messages are in chronological order (oldest first).

**Error Responses:**

| Status | Body                                | Condition               |
| ------ | ----------------------------------- | ----------------------- |
| `503`  | `{"error":"Memory not available"}`  | MemoryManager not wired |
| `500`  | `{"error":"Internal server error"}` | DB query error          |
