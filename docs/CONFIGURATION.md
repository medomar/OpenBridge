# OpenBridge — Configuration Guide

> **Last Updated:** 2026-02-19

---

## Setup

```bash
cp config.example.json config.json
```

`config.json` is gitignored — it contains your personal settings.

---

## Full Config Reference

```json
{
  "connectors": [
    {
      "type": "whatsapp",
      "enabled": true,
      "options": {
        "sessionName": "openbridge-default"
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
  "auth": {
    "whitelist": ["+212612345678"],
    "prefix": "/ai"
  },
  "logLevel": "info"
}
```

---

## Config Options

### Root

| Field             | Type   | Required | Default  | Description                                        |
| ----------------- | ------ | :------: | -------- | -------------------------------------------------- |
| `connectors`      | array  |   Yes    | —        | At least one connector                             |
| `providers`       | array  |   Yes    | —        | At least one provider                              |
| `defaultProvider` | string |   Yes    | —        | Which provider handles messages by default         |
| `auth`            | object |   Yes    | —        | Authentication settings                            |
| `logLevel`        | string |    No    | `"info"` | `trace`, `debug`, `info`, `warn`, `error`, `fatal` |

### Connector Options (WhatsApp)

| Field                 | Type         | Default                | Description                                             |
| --------------------- | ------------ | ---------------------- | ------------------------------------------------------- |
| `type`                | `"whatsapp"` | —                      | Connector type                                          |
| `enabled`             | boolean      | `true`                 | Enable/disable                                          |
| `options.sessionName` | string       | `"openbridge-default"` | WhatsApp session identifier (stored in `.wwebjs_auth/`) |

### Provider Options (Claude Code)

| Field                   | Type            | Default  | Description                             |
| ----------------------- | --------------- | -------- | --------------------------------------- |
| `type`                  | `"claude-code"` | —        | Provider type                           |
| `enabled`               | boolean         | `true`   | Enable/disable                          |
| `options.workspacePath` | string          | `"."`    | **Absolute path** to the target project |
| `options.maxTokens`     | number          | `4096`   | Max response tokens                     |
| `options.timeout`       | number          | `120000` | Timeout in ms (default: 2 minutes)      |

### Auth

| Field       | Type     | Default | Description                                                     |
| ----------- | -------- | ------- | --------------------------------------------------------------- |
| `whitelist` | string[] | `[]`    | Phone numbers allowed to send commands. Empty = open access.    |
| `prefix`    | string   | `"/ai"` | Command prefix. Only messages starting with this are processed. |

---

## Environment Variables

Optional overrides via `.env` file:

| Variable      | Default         | Description                                         |
| ------------- | --------------- | --------------------------------------------------- |
| `CONFIG_PATH` | `./config.json` | Path to config file                                 |
| `LOG_LEVEL`   | `info`          | Log level override                                  |
| `NODE_ENV`    | —               | Set to `production` for JSON logs (no pretty-print) |

---

## Important Notes

- **workspacePath must be absolute** — `~/Desktop/x` won't work yet, use `/Users/you/Desktop/x`
- **whitelist is optional** — if empty, anyone can send commands (useful for development)
- **config.json is gitignored** — never commit it (contains phone numbers)
- **sessionName** — changing this requires re-scanning the QR code
