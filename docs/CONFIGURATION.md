# OpenBridge — Configuration Guide

> **Last Updated:** 2026-02-20

---

## Setup

```bash
cp config.example.json config.json
```

`config.json` is gitignored — it contains your personal settings.

---

## Quick Start Config

The minimum config to start the bridge:

```json
{
  "connectors": [{ "type": "whatsapp" }],
  "providers": [
    {
      "type": "claude-code",
      "options": {
        "workspacePath": "/Users/you/Desktop/my-project"
      }
    }
  ],
  "defaultProvider": "claude-code",
  "auth": {
    "whitelist": ["+212612345678"],
    "prefix": "/ai"
  }
}
```

---

## Full Config Reference

This is the complete config with all options, including planned sections for upcoming features.

```json
{
  "connectors": [
    {
      "type": "whatsapp",
      "enabled": true,
      "options": {
        "sessionName": "openbridge-default",
        "sessionPath": ".wwebjs_auth"
      }
    }
  ],
  "providers": [
    {
      "type": "claude-code",
      "enabled": true,
      "options": {
        "workspacePath": "/Users/you/Desktop/my-project",
        "maxTokens": 4096,
        "timeout": 120000
      }
    }
  ],
  "defaultProvider": "claude-code",
  "workspaces": [
    { "name": "my-store", "path": "/Users/you/Desktop/store-api" },
    { "name": "backend", "path": "/Users/you/Desktop/backend" }
  ],
  "defaultWorkspace": "my-store",
  "auth": {
    "whitelist": ["+212612345678"],
    "prefix": "/ai",
    "rateLimit": {
      "enabled": true,
      "maxMessages": 10,
      "windowMs": 60000
    },
    "commandFilter": {
      "allowPatterns": [],
      "denyPatterns": ["rm\\s+-rf", "drop\\s+table", "format\\s+disk"],
      "denyMessage": "That command is not allowed."
    }
  },
  "queue": {
    "maxRetries": 3,
    "retryDelayMs": 1000
  },
  "router": {
    "progressIntervalMs": 15000
  },
  "audit": {
    "enabled": false,
    "logPath": "audit.log"
  },
  "health": {
    "enabled": false,
    "port": 8080
  },
  "metrics": {
    "enabled": false,
    "port": 9090
  },
  "logLevel": "info"
}
```

---

## Config Sections

### Root

| Field              | Type   | Required | Default  | Description                                        |
| ------------------ | ------ | :------: | -------- | -------------------------------------------------- |
| `connectors`       | array  |   Yes    | —        | At least one connector                             |
| `providers`        | array  |   Yes    | —        | At least one provider                              |
| `defaultProvider`  | string |   Yes    | —        | Which provider handles messages by default         |
| `workspaces`       | array  |    No    | `[]`     | Named workspaces for multi-project routing         |
| `defaultWorkspace` | string |    No    | —        | Default workspace name (must match a workspace)    |
| `auth`             | object |   Yes    | —        | Authentication and authorization settings          |
| `queue`            | object |    No    | defaults | Message queue configuration                        |
| `router`           | object |    No    | defaults | Router behavior                                    |
| `audit`            | object |    No    | defaults | Audit logging configuration                        |
| `health`           | object |    No    | defaults | Health check endpoint                              |
| `metrics`          | object |    No    | defaults | Metrics endpoint                                   |
| `logLevel`         | string |    No    | `"info"` | `trace`, `debug`, `info`, `warn`, `error`, `fatal` |

---

### Connectors

Each connector represents a messaging channel. You need at least one.

#### WhatsApp

```json
{
  "type": "whatsapp",
  "enabled": true,
  "options": {
    "sessionName": "openbridge-default",
    "sessionPath": ".wwebjs_auth"
  }
}
```

| Field                 | Type         | Default                | Description                                             |
| --------------------- | ------------ | ---------------------- | ------------------------------------------------------- |
| `type`                | `"whatsapp"` | —                      | Connector type                                          |
| `enabled`             | boolean      | `true`                 | Enable/disable this connector                           |
| `options.sessionName` | string       | `"openbridge-default"` | WhatsApp session identifier (stored in `.wwebjs_auth/`) |
| `options.sessionPath` | string       | `".wwebjs_auth"`       | Directory for session data                              |

#### Console

```json
{
  "type": "console",
  "enabled": true
}
```

The console connector reads from stdin and writes to stdout. Useful for development and testing.

---

### Providers

Each provider is an AI backend that processes messages. You need at least one.

#### Claude Code

```json
{
  "type": "claude-code",
  "enabled": true,
  "options": {
    "workspacePath": "/Users/you/Desktop/my-project",
    "maxTokens": 4096,
    "timeout": 120000
  }
}
```

| Field                   | Type            | Default  | Description                             |
| ----------------------- | --------------- | -------- | --------------------------------------- |
| `type`                  | `"claude-code"` | —        | Provider type                           |
| `enabled`               | boolean         | `true`   | Enable/disable this provider            |
| `options.workspacePath` | string          | `"."`    | **Absolute path** to the target project |
| `options.maxTokens`     | number          | `4096`   | Max response tokens                     |
| `options.timeout`       | number          | `120000` | Timeout in ms (default: 2 minutes)      |

**Important:** `workspacePath` is the target project — not the OpenBridge folder. The AI provider runs inside that directory with full access to files, git, and terminal.

---

### Auth

```json
{
  "auth": {
    "whitelist": ["+212612345678"],
    "prefix": "/ai",
    "rateLimit": {
      "enabled": true,
      "maxMessages": 10,
      "windowMs": 60000
    },
    "commandFilter": {
      "allowPatterns": [],
      "denyPatterns": ["rm\\s+-rf", "drop\\s+table"],
      "denyMessage": "That command is not allowed."
    }
  }
}
```

| Field                         | Type     | Default                          | Description                                                  |
| ----------------------------- | -------- | -------------------------------- | ------------------------------------------------------------ |
| `whitelist`                   | string[] | `[]`                             | Phone numbers allowed to send commands. Empty = open access. |
| `prefix`                      | string   | `"/ai"`                          | Only messages starting with this prefix are processed.       |
| `rateLimit.enabled`           | boolean  | `true`                           | Enable per-user rate limiting                                |
| `rateLimit.maxMessages`       | number   | `10`                             | Max messages per window                                      |
| `rateLimit.windowMs`          | number   | `60000`                          | Rate limit window in ms (default: 1 minute)                  |
| `commandFilter.allowPatterns` | string[] | `[]`                             | Regex patterns to explicitly allow (overrides deny)          |
| `commandFilter.denyPatterns`  | string[] | `[]`                             | Regex patterns to block                                      |
| `commandFilter.denyMessage`   | string   | `"That command is not allowed."` | Message sent when a command is denied                        |

---

### Workspaces

Multi-workspace support lets you switch between projects using the `@workspace-name` syntax in messages.

```json
{
  "workspaces": [
    { "name": "my-store", "path": "/Users/you/Desktop/store-api" },
    { "name": "backend", "path": "/Users/you/Desktop/backend" }
  ],
  "defaultWorkspace": "my-store"
}
```

| Field               | Type   | Required | Default | Description                                    |
| ------------------- | ------ | :------: | ------- | ---------------------------------------------- |
| `workspaces`        | array  |    No    | `[]`    | List of named workspaces                       |
| `workspaces[].name` | string |   Yes    | —       | Workspace name (used in `@name` routing)       |
| `workspaces[].path` | string |   Yes    | —       | Absolute path to the project directory         |
| `defaultWorkspace`  | string |    No    | —       | Default workspace when no `@name` is specified |

**Usage:** Send `@backend /ai list all endpoints` to target the backend workspace.

---

### Queue

```json
{
  "queue": {
    "maxRetries": 3,
    "retryDelayMs": 1000
  }
}
```

| Field          | Type   | Default | Description                                                  |
| -------------- | ------ | ------- | ------------------------------------------------------------ |
| `maxRetries`   | number | `3`     | Max retry attempts for failed messages before sending to DLQ |
| `retryDelayMs` | number | `1000`  | Base delay between retries (exponential backoff applied)     |

---

### Router

```json
{
  "router": {
    "progressIntervalMs": 15000
  }
}
```

| Field                | Type   | Default | Description                                           |
| -------------------- | ------ | ------- | ----------------------------------------------------- |
| `progressIntervalMs` | number | `15000` | Interval (ms) between progress updates for long tasks |

---

### Audit

```json
{
  "audit": {
    "enabled": false,
    "logPath": "audit.log"
  }
}
```

| Field     | Type    | Default       | Description                    |
| --------- | ------- | ------------- | ------------------------------ |
| `enabled` | boolean | `false`       | Enable audit logging           |
| `logPath` | string  | `"audit.log"` | File path for audit log output |

---

### Health

```json
{
  "health": {
    "enabled": false,
    "port": 8080
  }
}
```

| Field     | Type    | Default | Description                       |
| --------- | ------- | ------- | --------------------------------- |
| `enabled` | boolean | `false` | Enable health check HTTP endpoint |
| `port`    | number  | `8080`  | Port for the health endpoint      |

**Endpoint:** `GET http://localhost:<port>/health`

---

### Metrics

```json
{
  "metrics": {
    "enabled": false,
    "port": 9090
  }
}
```

| Field     | Type    | Default | Description                   |
| --------- | ------- | ------- | ----------------------------- |
| `enabled` | boolean | `false` | Enable metrics HTTP endpoint  |
| `port`    | number  | `9090`  | Port for the metrics endpoint |

**Endpoint:** `GET http://localhost:<port>/metrics`

---

## Planned Config Schemas

The following sections document config schemas for planned features (Phases 6–10). These schemas are not yet implemented — they serve as the spec for upcoming development.

### Workspace Maps (Phase 6)

Each workspace can have an `openbridge.map.json` file that declares the project's APIs. This is the AI's structured knowledge base — it tells agents what endpoints are available, how to authenticate, and what data schemas to expect.

#### Workspace Config (extended)

```json
{
  "workspaces": [
    {
      "name": "my-store",
      "path": "/Users/you/Desktop/store-api",
      "map": "openbridge.map.json",
      "mapSource": "manual"
    }
  ]
}
```

| Field       | Type   | Required | Default                 | Description                                               |
| ----------- | ------ | :------: | ----------------------- | --------------------------------------------------------- |
| `name`      | string |   Yes    | —                       | Workspace name                                            |
| `path`      | string |   Yes    | —                       | Absolute path to the project                              |
| `map`       | string |    No    | `"openbridge.map.json"` | Path to the workspace map file (relative to workspace)    |
| `mapSource` | string |    No    | `"manual"`              | How the map was generated: `manual`, `openapi`, `postman` |

#### `openbridge.map.json` Schema

The workspace map file declares every API endpoint the AI can interact with.

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
      "headers": {
        "Accept": "application/json"
      },
      "responseSchema": {
        "type": "array",
        "items": { "$ref": "#/schemas/Product" }
      }
    },
    {
      "route": "/products",
      "method": "POST",
      "description": "Create a new product",
      "requestSchema": {
        "type": "object",
        "properties": {
          "name": { "type": "string" },
          "price": { "type": "number" },
          "category": { "type": "string" }
        },
        "required": ["name", "price"]
      },
      "curl": "curl -X POST https://api.mystore.com/v1/products -H 'Authorization: Bearer $TOKEN' -d '{\"name\": \"Widget\", \"price\": 9.99}'"
    },
    {
      "route": "/orders/:id",
      "method": "GET",
      "description": "Get order by ID"
    }
  ],
  "schemas": {
    "Product": {
      "type": "object",
      "properties": {
        "id": { "type": "string" },
        "name": { "type": "string" },
        "price": { "type": "number" },
        "category": { "type": "string" },
        "stock": { "type": "integer" }
      }
    }
  }
}
```

**Map root fields:**

| Field       | Type   | Required | Description                                                       |
| ----------- | ------ | :------: | ----------------------------------------------------------------- |
| `name`      | string |   Yes    | API name                                                          |
| `version`   | string |   Yes    | Map version (semver)                                              |
| `baseUrl`   | string |   Yes    | Base URL for all endpoints                                        |
| `auth`      | object |    No    | Default authentication for all endpoints                          |
| `endpoints` | array  |   Yes    | List of API endpoints                                             |
| `schemas`   | object |    No    | Reusable data schemas (JSON Schema format, referenced via `$ref`) |

**Auth config:**

| Field    | Type   | Required | Description                                                      |
| -------- | ------ | :------: | ---------------------------------------------------------------- |
| `type`   | string |   Yes    | Auth type: `bearer`, `api-key`, `basic`, `oauth2`, `custom`      |
| `token`  | string |    No    | Token value (supports `${ENV_VAR}` syntax for env variable refs) |
| `header` | string |    No    | Custom header name (for `api-key` type, e.g. `X-API-Key`)        |
| `prefix` | string |    No    | Token prefix (default: `Bearer` for bearer type)                 |

**Endpoint fields:**

| Field            | Type   | Required | Description                                          |
| ---------------- | ------ | :------: | ---------------------------------------------------- |
| `route`          | string |   Yes    | URL path (supports `:param` syntax for path params)  |
| `method`         | string |   Yes    | HTTP method: `GET`, `POST`, `PUT`, `PATCH`, `DELETE` |
| `description`    | string |    No    | Human-readable description (shown to AI as context)  |
| `headers`        | object |    No    | Additional headers for this endpoint                 |
| `auth`           | object |    No    | Override auth for this endpoint                      |
| `requestSchema`  | object |    No    | JSON Schema for the request body                     |
| `responseSchema` | object |    No    | JSON Schema for the response                         |
| `curl`           | string |    No    | Example CURL command                                 |

---

### Agent Orchestration (Phase 7)

Configures the multi-agent orchestrator — how many agents can run concurrently, timeouts, and the default execution strategy.

```json
{
  "orchestrator": {
    "enabled": true,
    "maxConcurrentAgents": 5,
    "taskTimeout": 300000,
    "agentTimeout": 600000,
    "scriptStrategy": "sequential",
    "retryFailedTasks": true,
    "maxTaskRetries": 2
  }
}
```

| Field                 | Type    | Default        | Description                                                                     |
| --------------------- | ------- | -------------- | ------------------------------------------------------------------------------- |
| `enabled`             | boolean | `true`         | Enable the agent orchestrator (if `false`, messages route directly to provider) |
| `maxConcurrentAgents` | number  | `5`            | Max task agents running simultaneously                                          |
| `taskTimeout`         | number  | `300000`       | Timeout per task in ms (default: 5 minutes)                                     |
| `agentTimeout`        | number  | `600000`       | Timeout for the entire agent workflow in ms (default: 10 minutes)               |
| `scriptStrategy`      | string  | `"sequential"` | Default execution strategy: `sequential`, `parallel`, `conditional`             |
| `retryFailedTasks`    | boolean | `true`         | Whether to retry failed tasks automatically                                     |
| `maxTaskRetries`      | number  | `2`            | Max retries per task before marking as failed                                   |

**Script strategies:**

| Strategy      | Description                                                                      |
| ------------- | -------------------------------------------------------------------------------- |
| `sequential`  | Task agents execute one after another, each waiting for the previous to complete |
| `parallel`    | All task agents execute simultaneously, results collected when all finish        |
| `conditional` | Main agent decides the next step based on each task agent's result               |

---

### Views + Interaction (Phase 9)

Configures the local HTTP server that hosts AI-generated views (reports, dashboards, interactive forms).

```json
{
  "views": {
    "enabled": true,
    "port": 3001,
    "host": "localhost",
    "defaultTTL": 3600,
    "maxViews": 100,
    "cleanupIntervalMs": 60000
  }
}
```

| Field               | Type    | Default       | Description                                                      |
| ------------------- | ------- | ------------- | ---------------------------------------------------------------- |
| `enabled`           | boolean | `false`       | Enable the view server                                           |
| `port`              | number  | `3001`        | Port for the local view server                                   |
| `host`              | string  | `"localhost"` | Host to bind the view server to                                  |
| `defaultTTL`        | number  | `3600`        | Default time-to-live for temporary views in seconds (1 hour)     |
| `maxViews`          | number  | `100`         | Maximum number of active views before oldest are cleaned up      |
| `cleanupIntervalMs` | number  | `60000`       | Interval in ms for cleaning up expired views (default: 1 minute) |

---

### Integrations (Phase 10)

Configures external platform connectors (Shopify, Amazon, etc.) that agents can interact with through the workspace map.

```json
{
  "integrations": [
    {
      "name": "shopify-store",
      "type": "shopify",
      "auth": {
        "type": "api-key",
        "token": "${SHOPIFY_ACCESS_TOKEN}",
        "header": "X-Shopify-Access-Token"
      },
      "baseUrl": "https://my-store.myshopify.com/admin/api/2024-01",
      "syncInterval": 300000
    }
  ]
}
```

| Field                         | Type   | Required | Default | Description                                               |
| ----------------------------- | ------ | :------: | ------- | --------------------------------------------------------- |
| `integrations`                | array  |    No    | `[]`    | List of external platform integrations                    |
| `integrations[].name`         | string |   Yes    | —       | Integration name (referenced in workspace maps)           |
| `integrations[].type`         | string |   Yes    | —       | Platform type: `shopify`, `amazon`, `custom`              |
| `integrations[].auth`         | object |   Yes    | —       | Authentication config (same format as workspace map auth) |
| `integrations[].baseUrl`      | string |   Yes    | —       | Base URL for the platform API                             |
| `integrations[].syncInterval` | number |    No    | —       | Auto-sync interval in ms (if applicable)                  |

---

## Environment Variables

Optional overrides via `.env` file:

| Variable      | Default         | Description                                         |
| ------------- | --------------- | --------------------------------------------------- |
| `CONFIG_PATH` | `./config.json` | Path to config file                                 |
| `LOG_LEVEL`   | `info`          | Log level override                                  |
| `NODE_ENV`    | —               | Set to `production` for JSON logs (no pretty-print) |

Workspace map auth tokens support `${ENV_VAR}` syntax to reference environment variables. For example, `"token": "${STORE_API_TOKEN}"` reads the value from the `STORE_API_TOKEN` environment variable at runtime.

---

## Zod Validation

All config is validated at startup using Zod schemas defined in `src/types/config.ts`. If validation fails, the bridge logs the error and exits with a non-zero code.

Current schemas:

| Schema                      | Validates                        |
| --------------------------- | -------------------------------- |
| `AppConfigSchema`           | Root config object               |
| `ConnectorConfigSchema`     | Individual connector entry       |
| `ProviderConfigSchema`      | Individual provider entry        |
| `WorkspaceConfigSchema`     | Workspace name + path            |
| `AuthConfigSchema`          | Auth section (whitelist, prefix) |
| `RateLimitConfigSchema`     | Rate limit settings              |
| `CommandFilterConfigSchema` | Allow/deny patterns              |
| `QueueConfigSchema`         | Queue retry settings             |
| `RouterConfigSchema`        | Router behavior                  |
| `AuditConfigSchema`         | Audit log settings               |
| `HealthConfigSchema`        | Health endpoint                  |
| `MetricsConfigSchema`       | Metrics endpoint                 |

**Planned schemas** (to be added as each phase is implemented):

| Schema                     | Phase | Validates                            |
| -------------------------- | :---: | ------------------------------------ |
| `WorkspaceMapSchema`       |   6   | `openbridge.map.json` structure      |
| `APIEndpointSchema`        |   6   | Individual endpoint in workspace map |
| `MapAuthSchema`            |   6   | Auth config within workspace maps    |
| `OrchestratorConfigSchema` |   7   | Agent orchestrator settings          |
| `ViewConfigSchema`         |   9   | View server settings                 |
| `IntegrationConfigSchema`  |  10   | External platform integrations       |

---

## Important Notes

- **workspacePath** — must be an absolute path. Tilde (`~`) is resolved automatically at startup.
- **whitelist** — if empty, anyone can send commands. Useful for development, but set it in production.
- **config.json** — gitignored. Never commit it (contains phone numbers and tokens).
- **openbridge.map.json** — should also be gitignored if it contains API tokens. Use `${ENV_VAR}` syntax instead.
- **sessionName** — changing this requires re-scanning the WhatsApp QR code.
- **defaultProvider** — must match the `type` of one of the configured providers. Validated at startup.
- **Config hot-reload** — the bridge watches `config.json` for changes and re-validates automatically. No restart needed for auth, rate limit, and command filter changes.
