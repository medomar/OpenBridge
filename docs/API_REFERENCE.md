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
- [Utility Functions](#utility-functions)
  - [loadConfig()](#loadconfig)
  - [scanForAITools()](#scanforaitools)
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
