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
- [Core Classes](#core-classes)
  - [Bridge](#bridge)
  - [Router](#router)
  - [AuthService](#authservice)
  - [MessageQueue](#messagequeue)
  - [PluginRegistry](#pluginregistry)
  - [RateLimiter](#ratelimiter)
  - [WorkspaceManager](#workspacemanager)
  - [ConfigWatcher](#configwatcher)
  - [AuditLogger](#auditlogger)
  - [HealthServer](#healthserver)
  - [MetricsCollector](#metricscollector)
  - [MetricsServer](#metricsserver)
- [Error Handling](#error-handling)
  - [ProviderError](#providererror)
  - [classifyError()](#classifyerror)
- [Configuration Schemas](#configuration-schemas)
  - [AppConfig](#appconfig)
  - [ConnectorConfig](#connectorconfig)
  - [ProviderConfig](#providerconfig)
  - [AuthConfig](#authconfig)
  - [RateLimitConfig](#ratelimitconfig)
  - [CommandFilterConfig](#commandfilterconfig)
  - [QueueConfig](#queueconfig)
  - [RouterConfig](#routerconfig)
  - [WorkspaceConfig](#workspaceconfig)
  - [AuditConfig](#auditconfig)
  - [HealthConfig](#healthconfig)
  - [MetricsConfig](#metricsconfig)
- [Utility Functions](#utility-functions)
  - [loadConfig()](#loadconfig)
  - [resolveConfigPath()](#resolveconfigpath)
  - [createLogger()](#createlogger)
- [HTTP Endpoints](#http-endpoints)
  - [Health Check](#health-check-endpoint)
  - [Metrics](#metrics-endpoint)

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

Interface that every AI provider must implement.

| Member             | Type                                                                  | Description                                                       |
| ------------------ | --------------------------------------------------------------------- | ----------------------------------------------------------------- |
| `name`             | `readonly string`                                                     | Unique identifier (e.g. `'claude-code'`, `'openai'`)              |
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

---

## Core Classes

### Bridge

_Source: `src/core/bridge.ts`_

Main orchestrator that wires connectors, providers, auth, queue, and all subsystems together.

```typescript
import { Bridge } from './core/bridge.js';

const bridge = new Bridge(config, { configPath: './config.json' });

// Register plugins before starting
const registry = bridge.getRegistry();
registry.registerConnector('whatsapp', whatsappFactory);
registry.registerProvider('claude-code', claudeCodeFactory);

await bridge.start();

// Later, graceful shutdown
await bridge.stop();
```

**Constructor:**

| Parameter  | Type            | Description                           |
| ---------- | --------------- | ------------------------------------- |
| `config`   | `AppConfig`     | Validated application configuration   |
| `options?` | `BridgeOptions` | Optional settings (e.g. `configPath`) |

**BridgeOptions:**

| Property      | Type     | Description                                |
| ------------- | -------- | ------------------------------------------ |
| `configPath?` | `string` | Path to `config.json` (enables hot-reload) |

**Methods:**

| Method          | Returns          | Description                                        |
| --------------- | ---------------- | -------------------------------------------------- |
| `getRegistry()` | `PluginRegistry` | Access the plugin registry for registering plugins |
| `start()`       | `Promise<void>`  | Initialize all plugins, start processing           |
| `stop()`        | `Promise<void>`  | Drain queue, shut down all plugins gracefully      |

---

### Router

_Source: `src/core/router.ts`_

Routes inbound messages to the appropriate AI provider and sends responses back through the originating connector.

**Constructor:**

| Parameter         | Type               | Description                     |
| ----------------- | ------------------ | ------------------------------- |
| `defaultProvider` | `string`           | Name of the default AI provider |
| `config?`         | `RouterConfig`     | Router configuration            |
| `auditLogger?`    | `AuditLogger`      | Optional audit logger           |
| `metrics?`        | `MetricsCollector` | Optional metrics collector      |

**Methods:**

| Method                    | Returns         | Description                               |
| ------------------------- | --------------- | ----------------------------------------- |
| `addConnector(connector)` | `void`          | Register an active connector              |
| `addProvider(provider)`   | `void`          | Register an active provider               |
| `route(message)`          | `Promise<void>` | Route a message through the full pipeline |

**Properties:**

| Property          | Type     | Description                   |
| ----------------- | -------- | ----------------------------- |
| `defaultProvider` | `string` | Current default provider name |

---

### AuthService

_Source: `src/core/auth.ts`_

Handles sender authorization, prefix detection, prefix stripping, and command filtering.

**Constructor:**

| Parameter | Type         | Description        |
| --------- | ------------ | ------------------ |
| `config`  | `AuthConfig` | Auth configuration |

**Methods:**

| Method                   | Returns               | Description                                        |
| ------------------------ | --------------------- | -------------------------------------------------- |
| `isAuthorized(sender)`   | `boolean`             | Check if sender is whitelisted (empty list = open) |
| `hasPrefix(content)`     | `boolean`             | Check if message starts with the configured prefix |
| `stripPrefix(content)`   | `string`              | Remove the prefix and return cleaned content       |
| `filterCommand(command)` | `CommandFilterResult` | Check command against allow/deny pattern lists     |
| `updateConfig(config)`   | `void`                | Hot-reload auth configuration                      |

**CommandFilterResult:**

| Property  | Type      | Description                    |
| --------- | --------- | ------------------------------ |
| `allowed` | `boolean` | Whether the command is allowed |
| `reason?` | `string`  | Denial reason (if blocked)     |

**Properties:**

| Property        | Type     | Description               |
| --------------- | -------- | ------------------------- |
| `commandPrefix` | `string` | Current configured prefix |

---

### MessageQueue

_Source: `src/core/queue.ts`_

Per-user message queue. Each sender gets its own sequential queue so one slow response does not block messages from other users.

**Constructor:**

| Parameter  | Type                   | Description                |
| ---------- | ---------------------- | -------------------------- |
| `config?`  | `Partial<QueueConfig>` | Queue configuration        |
| `metrics?` | `MetricsCollector`     | Optional metrics collector |

**Methods:**

| Method               | Returns            | Description                                         |
| -------------------- | ------------------ | --------------------------------------------------- |
| `onMessage(handler)` | `void`             | Register the message processing handler             |
| `enqueue(message)`   | `Promise<void>`    | Add a message to the sender's queue                 |
| `drain()`            | `Promise<void>`    | Wait for all queues to empty (used during shutdown) |
| `flushDeadLetters()` | `DeadLetterItem[]` | Remove and return all dead letter items             |

**Properties:**

| Property         | Type                            | Description                            |
| ---------------- | ------------------------------- | -------------------------------------- |
| `size`           | `number`                        | Total queued messages across all users |
| `isProcessing`   | `boolean`                       | Whether any user queue is active       |
| `deadLetters`    | `ReadonlyArray<DeadLetterItem>` | Snapshot of dead letter queue          |
| `deadLetterSize` | `number`                        | Number of dead letter items            |

**DeadLetterItem:**

| Property   | Type             | Description                         |
| ---------- | ---------------- | ----------------------------------- |
| `message`  | `InboundMessage` | The failed message                  |
| `error`    | `string`         | Error description                   |
| `attempts` | `number`         | Number of attempts before failure   |
| `failedAt` | `Date`           | When the message permanently failed |

---

### PluginRegistry

_Source: `src/core/registry.ts`_

Factory registry for connectors and providers. Supports both manual registration and auto-discovery.

**Methods:**

| Method                             | Returns         | Description                                      |
| ---------------------------------- | --------------- | ------------------------------------------------ |
| `registerConnector(type, factory)` | `void`          | Register a connector factory by type name        |
| `registerProvider(type, factory)`  | `void`          | Register a provider factory by type name         |
| `createConnector(type, options)`   | `Connector`     | Create a connector instance from config          |
| `createProvider(type, options)`    | `AIProvider`    | Create a provider instance from config           |
| `discoverPlugins(srcDir)`          | `Promise<void>` | Auto-discover plugins in connector/provider dirs |

**Properties:**

| Property              | Type       | Description                     |
| --------------------- | ---------- | ------------------------------- |
| `availableConnectors` | `string[]` | Registered connector type names |
| `availableProviders`  | `string[]` | Registered provider type names  |

**Factory Types:**

```typescript
type ConnectorFactory = (options: Record<string, unknown>) => Connector;
type ProviderFactory = (options: Record<string, unknown>) => AIProvider;
```

**Auto-Discovery Plugin Modules:**

Connector plugins must export:

```typescript
export const pluginName: string;
export const connectorFactory: ConnectorFactory;
```

Provider plugins must export:

```typescript
export const pluginName: string;
export const providerFactory: ProviderFactory;
```

---

### RateLimiter

_Source: `src/core/rate-limiter.ts`_

Sliding-window rate limiter. Tracks per-sender message timestamps and rejects messages that exceed the configured threshold.

**Constructor:**

| Parameter | Type              | Description              |
| --------- | ----------------- | ------------------------ |
| `config`  | `RateLimitConfig` | Rate limit configuration |

**Methods:**

| Method                 | Returns   | Description                                            |
| ---------------------- | --------- | ------------------------------------------------------ |
| `isAllowed(sender)`    | `boolean` | `true` if within limit, `false` if rate limit exceeded |
| `updateConfig(config)` | `void`    | Hot-reload rate limiter configuration                  |

---

### WorkspaceManager

_Source: `src/core/workspace-manager.ts`_

Manages multiple workspace paths. Parses `@workspace-name` syntax from messages and resolves workspace paths.

**Constructor:**

| Parameter           | Type                | Description                       |
| ------------------- | ------------------- | --------------------------------- |
| `workspaces`        | `WorkspaceConfig[]` | List of workspace name/path pairs |
| `defaultWorkspace?` | `string`            | Name of the default workspace     |

**Methods:**

| Method                    | Returns                                 | Description                                 |
| ------------------------- | --------------------------------------- | ------------------------------------------- |
| `validatePaths()`         | `Promise<void>`                         | Validate all workspace paths exist on disk  |
| `parseWorkspace(content)` | `WorkspaceParseResult`                  | Parse `@name command` syntax from content   |
| `resolve(name)`           | `string \| undefined`                   | Resolve workspace name to its file path     |
| `listWorkspaces()`        | `Array<{ name: string; path: string }>` | List all available workspaces               |
| `formatList()`            | `string`                                | Format workspace list as user-friendly text |

**Properties:**

| Property      | Type                  | Description                             |
| ------------- | --------------------- | --------------------------------------- |
| `enabled`     | `boolean`             | `true` if any workspaces are configured |
| `defaultName` | `string \| undefined` | Default workspace name                  |

**WorkspaceParseResult:**

| Property    | Type                  | Description                        |
| ----------- | --------------------- | ---------------------------------- |
| `workspace` | `string \| undefined` | Parsed workspace name (if present) |
| `content`   | `string`              | Remaining message content          |

---

### ConfigWatcher

_Source: `src/core/config-watcher.ts`_

Watches `config.json` for file changes and triggers hot-reload handlers with debouncing.

**Constructor:**

| Parameter     | Type     | Default | Description                      |
| ------------- | -------- | ------- | -------------------------------- |
| `configPath`  | `string` | —       | Absolute or relative config path |
| `debounceMs?` | `number` | `500`   | Debounce delay for rapid changes |

**Methods:**

| Method              | Returns | Description                      |
| ------------------- | ------- | -------------------------------- |
| `onChange(handler)` | `void`  | Register a config change handler |
| `start()`           | `void`  | Start watching the config file   |
| `stop()`            | `void`  | Stop watching                    |

**Properties:**

| Property     | Type      | Description                   |
| ------------ | --------- | ----------------------------- |
| `isWatching` | `boolean` | Whether the watcher is active |

---

### AuditLogger

_Source: `src/core/audit-logger.ts`_

Persists message events as JSONL (one JSON object per line) to a configurable log file.

**Constructor:**

| Parameter | Type          | Description         |
| --------- | ------------- | ------------------- |
| `config`  | `AuditConfig` | Audit configuration |

**Methods:**

| Method                       | Returns         | Description                   |
| ---------------------------- | --------------- | ----------------------------- |
| `logInbound(message)`        | `Promise<void>` | Log an inbound message event  |
| `logOutbound(message)`       | `Promise<void>` | Log an outbound message event |
| `logAuthDenied(sender)`      | `Promise<void>` | Log an authorization denial   |
| `logRateLimited(sender)`     | `Promise<void>` | Log a rate limit event        |
| `logError(messageId, error)` | `Promise<void>` | Log a processing error        |

**AuditEntry** (written to the log file):

| Property         | Type                      | Description            |
| ---------------- | ------------------------- | ---------------------- |
| `timestamp`      | `string`                  | ISO 8601 timestamp     |
| `event`          | `AuditEventType`          | Event type             |
| `messageId?`     | `string`                  | Associated message ID  |
| `sender?`        | `string`                  | Sender identifier      |
| `source?`        | `string`                  | Connector name         |
| `recipient?`     | `string`                  | Recipient identifier   |
| `contentLength?` | `number`                  | Message content length |
| `error?`         | `string`                  | Error description      |
| `metadata?`      | `Record<string, unknown>` | Additional metadata    |

**AuditEventType:** `'inbound' | 'outbound' | 'auth_denied' | 'rate_limited' | 'error'`

---

### HealthServer

_Source: `src/core/health.ts`_

HTTP server exposing bridge health status as JSON.

**Constructor:**

| Parameter | Type                    | Description         |
| --------- | ----------------------- | ------------------- |
| `config?` | `Partial<HealthConfig>` | Health check config |

**Methods:**

| Method                      | Returns         | Description                  |
| --------------------------- | --------------- | ---------------------------- |
| `setDataProvider(provider)` | `void`          | Set the health data callback |
| `start()`                   | `Promise<void>` | Start the HTTP server        |
| `stop()`                    | `Promise<void>` | Stop the HTTP server         |

**HealthStatus** (response shape):

| Property     | Type                                     | Description                                             |
| ------------ | ---------------------------------------- | ------------------------------------------------------- |
| `status`     | `'healthy' \| 'degraded' \| 'unhealthy'` | Overall bridge status                                   |
| `uptime`     | `number`                                 | Seconds since bridge started                            |
| `timestamp`  | `string`                                 | ISO 8601 timestamp                                      |
| `connectors` | `ComponentStatus[]`                      | Status of each connector                                |
| `providers`  | `ComponentStatus[]`                      | Status of each provider                                 |
| `queue`      | `object`                                 | Queue state (`pending`, `processing`, `deadLetterSize`) |

**ComponentStatus:**

| Property | Type                                     | Description      |
| -------- | ---------------------------------------- | ---------------- |
| `name`   | `string`                                 | Component name   |
| `status` | `'healthy' \| 'degraded' \| 'unhealthy'` | Component status |

---

### MetricsCollector

_Source: `src/core/metrics.ts`_

In-memory metrics collector. Tracks message counts, latency, and error rates.

**Methods:**

| Method                      | Returns           | Description                             |
| --------------------------- | ----------------- | --------------------------------------- |
| `recordReceived()`          | `void`            | Increment received message counter      |
| `recordAuthorized()`        | `void`            | Increment authorized message counter    |
| `recordRateLimited()`       | `void`            | Increment rate-limited counter          |
| `recordCommandBlocked()`    | `void`            | Increment command-blocked counter       |
| `recordProcessed(duration)` | `void`            | Record a successfully processed message |
| `recordFailed(kind)`        | `void`            | Record a failed message by error kind   |
| `recordEnqueued()`          | `void`            | Increment enqueued counter              |
| `recordRetry()`             | `void`            | Increment retry counter                 |
| `recordDeadLettered()`      | `void`            | Increment dead-lettered counter         |
| `snapshot()`                | `MetricsSnapshot` | Return a point-in-time metrics snapshot |

**MetricsSnapshot:**

```typescript
interface MetricsSnapshot {
  uptime: number;
  timestamp: string;
  messages: {
    received: number;
    authorized: number;
    rateLimited: number;
    commandBlocked: number;
    processed: number;
    failed: number;
  };
  latency: {
    count: number;
    totalMs: number;
    avgMs: number;
    minMs: number;
    maxMs: number;
  };
  queue: {
    enqueued: number;
    retries: number;
    deadLettered: number;
  };
  errors: {
    total: number;
    transient: number;
    permanent: number;
  };
}
```

### MetricsServer

_Source: `src/core/metrics.ts`_

HTTP server that exposes collected metrics as JSON. Same pattern as `HealthServer`.

**Constructor:**

| Parameter | Type                     | Description    |
| --------- | ------------------------ | -------------- |
| `config?` | `Partial<MetricsConfig>` | Metrics config |

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

```typescript
class ProviderError extends Error {
  readonly kind: ErrorKind; // 'transient' | 'permanent'
  readonly exitCode: number;
}
```

| Property   | Type        | Description                                |
| ---------- | ----------- | ------------------------------------------ |
| `kind`     | `ErrorKind` | `'transient'` (retryable) or `'permanent'` |
| `exitCode` | `number`    | CLI exit code that triggered the error     |
| `message`  | `string`    | Human-readable error description           |

### classifyError()

```typescript
function classifyError(exitCode: number, stderr: string): ErrorKind;
```

Classifies a CLI execution failure as transient or permanent using heuristics:

1. Exit code 124 (timeout) -> transient
2. stderr matches transient patterns (timeout, rate limit, network errors) -> transient
3. stderr matches permanent patterns (auth failure, not found, bad request) -> permanent
4. Default for unrecognized errors -> transient (safer to retry)

---

## Configuration Schemas

_Source: `src/types/config.ts`_

All configuration is validated at startup using [Zod](https://zod.dev) schemas. Invalid config causes a clear validation error before the bridge starts.

### AppConfig

Root configuration object. Loaded from `config.json`.

| Property            | Type                | Default   | Description                                    |
| ------------------- | ------------------- | --------- | ---------------------------------------------- |
| `connectors`        | `ConnectorConfig[]` | —         | At least one connector (required)              |
| `providers`         | `ProviderConfig[]`  | —         | At least one provider (required)               |
| `defaultProvider`   | `string`            | —         | Name of the default provider                   |
| `workspaces?`       | `WorkspaceConfig[]` | `[]`      | Multi-workspace definitions                    |
| `defaultWorkspace?` | `string`            | —         | Default workspace name                         |
| `auth`              | `AuthConfig`        | —         | Authentication configuration                   |
| `queue?`            | `QueueConfig`       | see below | Queue retry configuration                      |
| `router?`           | `RouterConfig`      | see below | Router configuration                           |
| `audit?`            | `AuditConfig`       | see below | Audit logging configuration                    |
| `health?`           | `HealthConfig`      | see below | Health check endpoint config                   |
| `metrics?`          | `MetricsConfig`     | see below | Metrics endpoint configuration                 |
| `logLevel?`         | `string`            | `'info'`  | One of: trace, debug, info, warn, error, fatal |

### ConnectorConfig

| Property   | Type                      | Default | Description                        |
| ---------- | ------------------------- | ------- | ---------------------------------- |
| `type`     | `string`                  | —       | Connector type (e.g. `'whatsapp'`) |
| `enabled?` | `boolean`                 | `true`  | Whether this connector is active   |
| `options?` | `Record<string, unknown>` | `{}`    | Connector-specific options         |

### ProviderConfig

| Property   | Type                      | Default | Description                          |
| ---------- | ------------------------- | ------- | ------------------------------------ |
| `type`     | `string`                  | —       | Provider type (e.g. `'claude-code'`) |
| `enabled?` | `boolean`                 | `true`  | Whether this provider is active      |
| `options?` | `Record<string, unknown>` | `{}`    | Provider-specific options            |

### AuthConfig

| Property         | Type                  | Default   | Description                       |
| ---------------- | --------------------- | --------- | --------------------------------- |
| `whitelist?`     | `string[]`            | `[]`      | Allowed sender identifiers        |
| `prefix?`        | `string`              | `'/ai'`   | Message prefix to trigger the bot |
| `rateLimit?`     | `RateLimitConfig`     | see below | Rate limit settings               |
| `commandFilter?` | `CommandFilterConfig` | see below | Command allow/deny lists          |

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

### WorkspaceConfig

| Property | Type     | Description                       |
| -------- | -------- | --------------------------------- |
| `name`   | `string` | Workspace identifier (min 1 char) |
| `path`   | `string` | Absolute path to the workspace    |

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

## Utility Functions

### loadConfig()

_Source: `src/core/config.ts`_

```typescript
function loadConfig(configPath?: string): Promise<AppConfig>;
```

Reads and validates `config.json`. Falls back to `CONFIG_PATH` env var, then `./config.json`.

### resolveConfigPath()

_Source: `src/core/config.ts`_

```typescript
function resolveConfigPath(configPath?: string): string;
```

Resolves the config file path. Priority: argument > `CONFIG_PATH` env var > `./config.json`.

### createLogger()

_Source: `src/core/logger.ts`_

```typescript
function createLogger(name: string, level?: string): pino.Logger;
```

Creates a [Pino](https://getpino.io) logger instance. Uses `pino-pretty` in non-production environments.

---

## HTTP Endpoints

### Health Check Endpoint

Enabled via `health.enabled: true` in config. Default port: `8080`.

**Request:** `GET /` (any path)

**Response (200 — healthy/degraded):**

```json
{
  "status": "healthy",
  "uptime": 3600,
  "timestamp": "2026-01-15T10:30:00.000Z",
  "connectors": [{ "name": "whatsapp", "status": "healthy" }],
  "providers": [{ "name": "claude-code", "status": "healthy" }],
  "queue": { "pending": 0, "processing": false, "deadLetterSize": 0 }
}
```

**Response (503 — unhealthy):** Same shape with `"status": "unhealthy"`.

### Metrics Endpoint

Enabled via `metrics.enabled: true` in config. Default port: `9090`.

**Request:** `GET /` (any path)

**Response (200):**

```json
{
  "uptime": 3600,
  "timestamp": "2026-01-15T10:30:00.000Z",
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
