# OpenBridge — Workspace Map Specification

> **Version:** 1.0 | **File:** `openbridge.map.json` | **Last Updated:** 2026-02-20

---

## Overview

The workspace map (`openbridge.map.json`) is the AI's knowledge base for a workspace. It declares every API endpoint the AI can interact with — routes, methods, authentication, request/response schemas, and examples.

When a workspace has a map file, agents know exactly what APIs are available and how to call them. Without a map, agents operate blind.

**Location:** Place `openbridge.map.json` in the root of your project (the `workspacePath` directory).

---

## File Format

The workspace map is a JSON file that conforms to the `WorkspaceMapSchema` (defined in `src/types/workspace-map.ts`).

### Root Structure

```json
{
  "version": "1.0",
  "name": "my-api",
  "description": "Description of the API",
  "baseUrl": "https://api.example.com/v1",
  "source": "manual",
  "auth": { ... },
  "headers": { ... },
  "endpoints": [ ... ],
  "metadata": { ... }
}
```

| Field         | Type    | Required | Default    | Description                                                                |
| ------------- | ------- | :------: | ---------- | -------------------------------------------------------------------------- |
| `version`     | `"1.0"` |   Yes    | —          | Schema version (must be `"1.0"`)                                           |
| `name`        | string  |   Yes    | —          | Human-readable name for this API                                           |
| `description` | string  |    No    | —          | Short description of what this API does                                    |
| `baseUrl`     | string  |   Yes    | —          | Base URL for all endpoints (must be a valid URL)                           |
| `source`      | string  |    No    | `"manual"` | How this map was created: `manual`, `openapi`, `postman`, `swagger`, `har` |
| `auth`        | object  |    No    | `none`     | Default authentication applied to all endpoints                            |
| `headers`     | object  |    No    | `{}`       | Default headers applied to every request                                   |
| `endpoints`   | array   |   Yes    | —          | List of API endpoints (at least 1 required)                                |
| `metadata`    | object  |    No    | `{}`       | Generation metadata                                                        |

---

## Authentication

Auth is configured at the map level (default for all endpoints) and can be overridden per endpoint.

### Auth Types

#### Bearer Token

```json
{
  "type": "bearer",
  "envVar": "API_TOKEN"
}
```

Reads the token from the `API_TOKEN` environment variable. Sends as `Authorization: Bearer <token>`.

#### API Key

```json
{
  "type": "api-key",
  "header": "X-API-Key",
  "prefix": "",
  "envVar": "API_KEY"
}
```

| Field    | Default           | Description                             |
| -------- | ----------------- | --------------------------------------- |
| `header` | `"Authorization"` | Header name to send the key in          |
| `prefix` | —                 | Optional prefix before the key value    |
| `envVar` | —                 | Environment variable containing the key |

#### Basic Auth

```json
{
  "type": "basic",
  "usernameEnvVar": "API_USER",
  "passwordEnvVar": "API_PASS"
}
```

Reads username and password from environment variables. Sends as `Authorization: Basic <base64>`.

#### Custom Headers

```json
{
  "type": "custom",
  "headers": {
    "X-Custom-Auth": "${MY_SECRET}",
    "X-Tenant-ID": "${TENANT_ID}"
  }
}
```

Arbitrary headers with `${ENV_VAR}` interpolation. Use this for non-standard auth schemes.

#### No Auth

```json
{
  "type": "none"
}
```

No authentication. Use for public endpoints.

---

## Endpoints

Each endpoint declares a single API operation.

```json
{
  "id": "create-product",
  "name": "Create Product",
  "description": "Create a new product in the catalog",
  "method": "POST",
  "path": "/products",
  "baseUrl": "https://alt-api.example.com/v2",
  "parameters": [ ... ],
  "headers": { ... },
  "auth": { ... },
  "requestBody": { ... },
  "response": { ... },
  "tags": ["products", "write"]
}
```

| Field         | Type   | Required | Default             | Description                                                             |
| ------------- | ------ | :------: | ------------------- | ----------------------------------------------------------------------- |
| `id`          | string |   Yes    | —                   | Unique identifier within this map                                       |
| `name`        | string |   Yes    | —                   | Human-readable name                                                     |
| `description` | string |    No    | —                   | What this endpoint does (shown to agents as context)                    |
| `method`      | string |   Yes    | —                   | HTTP method: `GET`, `POST`, `PUT`, `PATCH`, `DELETE`, `HEAD`, `OPTIONS` |
| `path`        | string |   Yes    | —                   | URL path (supports `:param` placeholders)                               |
| `baseUrl`     | string |    No    | Map-level `baseUrl` | Override the map's base URL for this endpoint                           |
| `parameters`  | array  |    No    | `[]`                | Path, query, and header parameters                                      |
| `headers`     | object |    No    | `{}`                | Static headers (merged with map-level headers)                          |
| `auth`        | object |    No    | Map-level `auth`    | Override authentication for this endpoint                               |
| `requestBody` | object |    No    | —                   | Request body schema (for POST/PUT/PATCH)                                |
| `response`    | object |    No    | —                   | Response schema                                                         |
| `tags`        | array  |    No    | `[]`                | Tags for grouping and filtering                                         |

### Parameters

```json
{
  "name": "id",
  "in": "path",
  "required": true,
  "type": "string",
  "description": "Product ID",
  "example": "prod_abc123"
}
```

| Field         | Type    | Required | Default    | Description                              |
| ------------- | ------- | :------: | ---------- | ---------------------------------------- |
| `name`        | string  |   Yes    | —          | Parameter name                           |
| `in`          | string  |   Yes    | —          | Location: `path`, `query`, `header`      |
| `required`    | boolean |    No    | `false`    | Whether this parameter is required       |
| `type`        | string  |    No    | `"string"` | Data type: `string`, `number`, `boolean` |
| `description` | string  |    No    | —          | Human-readable description               |
| `example`     | any     |    No    | —          | Example value                            |

### Request Body

```json
{
  "contentType": "application/json",
  "schema": {
    "name": { "type": "string", "required": true, "description": "Product name" },
    "price": { "type": "number", "required": true }
  },
  "example": {
    "name": "Widget",
    "price": 9.99
  }
}
```

| Field         | Type   | Required | Default              | Description               |
| ------------- | ------ | :------: | -------------------- | ------------------------- |
| `contentType` | string |    No    | `"application/json"` | Request content type      |
| `schema`      | object |    No    | —                    | Field schemas (see below) |
| `example`     | any    |    No    | —                    | Example request body      |

### Response

Same structure as request body — `contentType`, `schema`, and `example`.

### Field Schema

Field schemas describe the shape of request/response data:

```json
{
  "type": "object",
  "description": "A product",
  "required": true,
  "properties": {
    "id": { "type": "string" },
    "name": { "type": "string", "required": true },
    "tags": {
      "type": "array",
      "items": { "type": "string" }
    }
  }
}
```

| Field         | Type    | Default | Description                                              |
| ------------- | ------- | ------- | -------------------------------------------------------- |
| `type`        | string  | —       | `string`, `number`, `boolean`, `object`, `array`, `null` |
| `description` | string  | —       | Field description                                        |
| `required`    | boolean | `false` | Whether this field is required                           |
| `example`     | any     | —       | Example value                                            |
| `items`       | object  | —       | Schema for array items (when type=array)                 |
| `properties`  | object  | —       | Nested field schemas (when type=object)                  |

---

## Metadata

Optional generation information:

```json
{
  "metadata": {
    "generatedAt": "2026-02-20T00:00:00Z",
    "generatedBy": "openbridge-scanner",
    "sourceFile": "openapi.yaml"
  }
}
```

| Field         | Type   | Description                                    |
| ------------- | ------ | ---------------------------------------------- |
| `generatedAt` | string | ISO 8601 timestamp of when the map was created |
| `generatedBy` | string | Tool or person that generated the map          |
| `sourceFile`  | string | Original spec file (if auto-generated)         |

---

## Environment Variable References

Auth tokens and header values support `${ENV_VAR}` syntax. At runtime, these are resolved from the process environment.

```json
{
  "auth": {
    "type": "bearer",
    "envVar": "STORE_API_TOKEN"
  },
  "headers": {
    "X-Tenant": "${TENANT_ID}"
  }
}
```

For bearer and API key auth, `envVar` names the environment variable directly. For custom auth headers, use `${VAR}` interpolation in values.

**Security:** Never hardcode tokens in the map file. Always use environment variables. Add `openbridge.map.json` to `.gitignore` if it contains any sensitive configuration.

---

## Loading

The map loader (`src/core/map-loader.ts`) reads and validates the map file:

```typescript
import { loadWorkspaceMap } from './core/map-loader.js';

// Load from workspace directory
const map = await loadWorkspaceMap('/path/to/workspace');

// Load with custom filename
const map = await loadWorkspaceMap('/path/to/workspace', 'custom-map.json');

// Load and resolve env vars (ready for API execution)
import { loadAndResolveWorkspaceMap } from './core/map-loader.js';
const resolved = await loadAndResolveWorkspaceMap('/path/to/workspace');
```

Validation uses the Zod schemas from `src/types/workspace-map.ts`. If the map file is invalid, a `ZodError` is thrown with details about which fields failed validation.

---

## Workspace Config Integration

In `config.json`, each workspace can specify its map file:

```json
{
  "workspaces": [
    {
      "name": "my-store",
      "path": "/Users/you/Desktop/store-api",
      "map": "openbridge.map.json"
    }
  ]
}
```

If `map` is omitted, the loader looks for `openbridge.map.json` in the workspace root by default.

---

## Map Sources

| Source    | Description                                     |
| --------- | ----------------------------------------------- |
| `manual`  | Hand-written by the user                        |
| `openapi` | Auto-generated from an OpenAPI/Swagger spec     |
| `postman` | Auto-generated from a Postman collection export |
| `swagger` | Auto-generated from a Swagger 2.0 spec          |
| `har`     | Auto-generated from an HTTP Archive recording   |

The `source` field is informational — it tells agents and tools how the map was created.

---

## Example

See `map.example.json` in the project root for a complete working example with products, orders, and health check endpoints.
