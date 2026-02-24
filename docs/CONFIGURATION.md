# OpenBridge — Configuration Guide

> **Last Updated:** 2026-02-23

---

## Quick Start (V2 Config)

The simplest possible configuration — 3 fields:

```json
{
  "workspacePath": "/absolute/path/to/your/project",
  "channels": [{ "type": "whatsapp", "enabled": true }],
  "auth": {
    "whitelist": ["+1234567890"],
    "prefix": "/ai"
  }
}
```

That's it. AI tools are auto-discovered on your machine. The Master AI is auto-selected.

You can generate this with:

```bash
npx openbridge init
```

---

## V2 Config Reference

### Root

| Field           | Type     | Required | Default | Description                                    |
| --------------- | -------- | :------: | ------- | ---------------------------------------------- |
| `workspacePath` | `string` |   Yes    | —       | Absolute path to the target project            |
| `channels`      | `array`  |   Yes    | —       | At least one messaging channel                 |
| `auth`          | `object` |   Yes    | —       | Authentication and security settings           |
| `master`        | `object` |    No    | `{}`    | Override auto-detected Master AI settings      |
| `queue`         | `object` |    No    | `{}`    | Message queue settings                         |
| `router`        | `object` |    No    | `{}`    | Router settings (progress interval)            |
| `audit`         | `object` |    No    | `{}`    | Audit logging settings                         |
| `health`        | `object` |    No    | `{}`    | Health check endpoint settings                 |
| `metrics`       | `object` |    No    | `{}`    | Metrics endpoint settings                      |
| `logLevel`      | `string` |    No    | `info`  | One of: trace, debug, info, warn, error, fatal |

### `workspacePath`

Absolute path to the project the Master AI will explore and operate on.

```json
"workspacePath": "/Users/you/projects/my-api"
```

Tilde (`~`) is automatically resolved to the home directory.

### `channels`

Array of messaging channel configurations. At least one required.

```json
"channels": [
  {
    "type": "whatsapp",
    "enabled": true,
    "options": {
      "sessionName": "openbridge-default",
      "sessionPath": ".wwebjs_auth"
    }
  }
]
```

| Field     | Type      | Required | Default | Description                                                              |
| --------- | --------- | :------: | ------- | ------------------------------------------------------------------------ |
| `type`    | `string`  |   Yes    | —       | Channel type: `console`, `webchat`, `whatsapp`, `telegram`, or `discord` |
| `enabled` | `boolean` |    No    | `true`  | Enable/disable this channel                                              |
| `options` | `object`  |    No    | `{}`    | Channel-specific options (see per-type tables below)                     |

#### Console Options

No options required. The Console connector reads from stdin and writes to stdout.

> **Note:** Console messages are sent as `console-user`. Add `"console-user"` to your whitelist, or leave whitelist empty (V0 only) to allow all.

#### WebChat Options

| Option | Type     | Default     | Description                               |
| ------ | -------- | ----------- | ----------------------------------------- |
| `port` | `number` | `3000`      | TCP port the HTTP + WebSocket server uses |
| `host` | `string` | `localhost` | Hostname the server binds to              |

> **Tip:** To expose WebChat on your local network, set `"host": "0.0.0.0"`.

#### Telegram Options

| Option        | Type     | Required | Description                                             |
| ------------- | -------- | :------: | ------------------------------------------------------- |
| `token`       | `string` |   Yes    | Bot token from @BotFather                               |
| `botUsername` | `string` |    No    | Bot username without `@` — required for group @mentions |

> **Setup:** Create a bot via [@BotFather](https://t.me/botfather) (`/newbot`), copy the token. Telegram whitelist entries use the sender's phone number or numeric user ID.

#### Discord Options

| Option  | Type     | Required | Description                         |
| ------- | -------- | :------: | ----------------------------------- |
| `token` | `string` |   Yes    | Bot token from the Developer Portal |

> **Setup:** Create an application at [discord.com/developers/applications](https://discord.com/developers/applications), add a Bot, copy the token. Discord whitelist entries use numeric user IDs (e.g. `"123456789012345678"`).

#### WhatsApp Options

| Option        | Type     | Default              | Description                        |
| ------------- | -------- | -------------------- | ---------------------------------- |
| `sessionName` | `string` | `openbridge-default` | Session identifier for persistence |
| `sessionPath` | `string` | `.wwebjs_auth`       | Directory for session data         |

### `auth`

Authentication and security configuration.

```json
"auth": {
  "whitelist": ["+1234567890", "+0987654321"],
  "prefix": "/ai",
  "rateLimit": {
    "enabled": true,
    "maxMessages": 10,
    "windowMs": 60000
  },
  "commandFilter": {
    "denyPatterns": ["rm -rf", "DROP TABLE", "sudo"]
  }
}
```

| Field           | Type       | Default                   | Description                                                           |
| --------------- | ---------- | ------------------------- | --------------------------------------------------------------------- |
| `whitelist`     | `string[]` | `[]` (V0) / required (V2) | Senders allowed to use the bridge. **V2 requires at least one entry** |
| `prefix`        | `string`   | `/ai`                     | Command prefix (messages without it are ignored)                      |
| `rateLimit`     | `object`   | `{}`                      | Per-user rate limiting                                                |
| `commandFilter` | `object`   | `{}`                      | Command allow/deny patterns                                           |

> **V2 whitelist requirement:** In V2 config, `auth.whitelist` must contain at least one entry. An empty array is rejected at startup with a Zod validation error. Use the sender's identifier for each connector: phone number for WhatsApp/Telegram (e.g. `"+1234567890"`), `"console-user"` for Console, `"webchat-user"` for WebChat, and numeric user ID for Discord. If you need open access during development, use V0 config format instead.

#### Rate Limit

| Field         | Type      | Default | Description                 |
| ------------- | --------- | ------- | --------------------------- |
| `enabled`     | `boolean` | `true`  | Enable rate limiting        |
| `maxMessages` | `number`  | `10`    | Max messages per window     |
| `windowMs`    | `number`  | `60000` | Time window in milliseconds |

#### Command Filter

| Field           | Type       | Default                          | Description                                |
| --------------- | ---------- | -------------------------------- | ------------------------------------------ |
| `allowPatterns` | `string[]` | `[]`                             | Only allow commands matching these (regex) |
| `denyPatterns`  | `string[]` | `[]`                             | Block commands matching these (regex)      |
| `denyMessage`   | `string`   | `"That command is not allowed."` | Message shown when blocked                 |

### `master` (optional)

Override the auto-detected Master AI settings. By default, OpenBridge scans your machine for AI tools (`claude`, `codex`, `aider`, etc.) and picks the most capable one as Master. Use this section to override that behavior.

```json
"master": {
  "tool": "codex"
}
```

| Field               | Type     | Default       | Description                                          |
| ------------------- | -------- | ------------- | ---------------------------------------------------- |
| `tool`              | `string` | auto-detected | Force a specific tool as Master (exact name or path) |
| `explorationPrompt` | `string` | built-in      | Custom prompt for workspace exploration _(planned)_  |
| `sessionTtlMs`      | `number` | `1800000`     | Session lifetime in milliseconds _(planned)_         |

#### Discovery Override Examples

**Force a specific tool by name:**

```json
"master": {
  "tool": "aider"
}
```

OpenBridge will skip auto-detection and use `aider` if it's installed.

**Use a specific Claude installation:**

```json
"master": {
  "tool": "/usr/local/bin/claude"
}
```

Useful if you have multiple AI CLIs installed and want to pick a specific one.

**Planned features (not yet implemented):**

- `explorationPrompt`: Custom exploration instructions for non-code workspaces
- `sessionTtlMs`: Override session expiry time for privacy/performance tuning

### `queue`

```json
"queue": { "maxRetries": 3, "retryDelayMs": 1000 }
```

| Field          | Type     | Default | Description                     |
| -------------- | -------- | ------- | ------------------------------- |
| `maxRetries`   | `number` | `3`     | Max retry attempts per message  |
| `retryDelayMs` | `number` | `1000`  | Base delay between retries (ms) |

### `router`

```json
"router": { "progressIntervalMs": 15000 }
```

| Field                | Type     | Default | Description                                   |
| -------------------- | -------- | ------- | --------------------------------------------- |
| `progressIntervalMs` | `number` | `15000` | Interval for "Still working..." messages (ms) |

### `audit`

```json
"audit": { "enabled": true, "logPath": "audit.log" }
```

| Field     | Type      | Default       | Description             |
| --------- | --------- | ------------- | ----------------------- |
| `enabled` | `boolean` | `false`       | Enable audit logging    |
| `logPath` | `string`  | `"audit.log"` | Path for audit log file |

### `health`

```json
"health": { "enabled": true, "port": 8080 }
```

| Field     | Type      | Default | Description                  |
| --------- | --------- | ------- | ---------------------------- |
| `enabled` | `boolean` | `false` | Enable health check endpoint |
| `port`    | `number`  | `8080`  | Port for health HTTP server  |

### `metrics`

```json
"metrics": { "enabled": true, "port": 9090 }
```

| Field     | Type      | Default | Description                  |
| --------- | --------- | ------- | ---------------------------- |
| `enabled` | `boolean` | `false` | Enable metrics endpoint      |
| `port`    | `number`  | `9090`  | Port for metrics HTTP server |

---

## V0 Config (Legacy)

The old config format is still fully supported. The config loader auto-detects the format.

```json
{
  "connectors": [
    { "type": "whatsapp", "enabled": true, "options": { "sessionName": "openbridge-default" } }
  ],
  "providers": [
    { "type": "claude-code", "enabled": true, "options": { "workspacePath": "/path/to/project" } }
  ],
  "defaultProvider": "claude-code",
  "auth": { "whitelist": ["+1234567890"], "prefix": "/ai" },
  "queue": { "maxRetries": 3, "retryDelayMs": 1000 }
}
```

V0 config runs the legacy startup flow (direct provider routing, no discovery, no Master AI).

### Claude Code Provider Options (V0 only)

| Option          | Type     | Default   | Description                           |
| --------------- | -------- | --------- | ------------------------------------- |
| `workspacePath` | `string` | required  | Absolute path to target project       |
| `maxTokens`     | `number` | `4096`    | Max token output                      |
| `timeout`       | `number` | `120000`  | CLI execution timeout (ms)            |
| `sessionTtlMs`  | `number` | `1800000` | Session TTL per user (30 min default) |

---

## Environment Variables

| Variable      | Description                              | Default       |
| ------------- | ---------------------------------------- | ------------- |
| `CONFIG_PATH` | Path to config file                      | `config.json` |
| `LOG_LEVEL`   | Override log level from config           | from config   |
| `NODE_ENV`    | Environment (`development`/`production`) | `development` |

---

## Config Validation

All config is validated at startup using Zod schemas defined in `src/types/config.ts`. Invalid config produces clear error messages with the exact field path that failed.

### V2 Detection Logic

The config loader tries V2 schema first (checks for `workspacePath` at root level, no `providers` array). If V2 parsing fails, it falls back to V0 schema.

```
Load config.json
  → Try AppConfigV2Schema.safeParse()
    → Success? Use V2 startup flow (discovery + Master)
    → Fail? Try AppConfigSchema.parse()
      → Success? Use V0 startup flow (direct provider)
      → Fail? Throw validation error with details
```

---

## Full V2 Example

```json
{
  "workspacePath": "/Users/you/projects/my-saas-app",
  "channels": [
    {
      "type": "whatsapp",
      "enabled": true,
      "options": {
        "sessionName": "openbridge-main",
        "sessionPath": ".wwebjs_auth"
      }
    }
  ],
  "auth": {
    "whitelist": ["+1234567890", "+0987654321"],
    "prefix": "/ai",
    "rateLimit": {
      "enabled": true,
      "maxMessages": 15,
      "windowMs": 60000
    },
    "commandFilter": {
      "denyPatterns": ["rm -rf", "DROP TABLE", "sudo", "format c:"]
    }
  },
  "queue": {
    "maxRetries": 3,
    "retryDelayMs": 1000
  },
  "router": {
    "progressIntervalMs": 15000
  },
  "health": {
    "enabled": true,
    "port": 8080
  },
  "logLevel": "info"
}
```
