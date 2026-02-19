# OpenBridge — Troubleshooting Guide

> Common errors, their causes, and how to fix them.

---

## Quick Reference

| Symptom                              | Jump to                                       |
| ------------------------------------ | --------------------------------------------- |
| Bridge won't start                   | [Startup Errors](#startup-errors)             |
| QR code won't scan / session expired | [WhatsApp Issues](#whatsapp-issues)           |
| Messages not being processed         | [Message Flow Issues](#message-flow-issues)   |
| AI responses failing                 | [Claude Code Issues](#claude-code-issues)     |
| Config changes not taking effect     | [Configuration Issues](#configuration-issues) |
| Health check returning 503           | [Monitoring Issues](#monitoring-issues)       |

---

## Startup Errors

### `FATAL: Failed to start OpenBridge`

The bridge logs this when initialization fails. Check the accompanying error message for the root cause.

**Common causes:**

1. **Missing `config.json`**

   ```
   ENOENT: no such file or directory, open './config.json'
   ```

   Fix: Copy the example config and edit it.

   ```bash
   cp config.example.json config.json
   ```

2. **Invalid config schema**

   Zod validation errors look like:

   ```
   ZodError: [{ "code": "too_small", "minimum": 1, "path": ["connectors"] }]
   ```

   Fix: Ensure `config.json` has at least one connector and one provider. See `config.example.json` for the expected structure.

3. **Unknown connector or provider type**

   ```
   Unknown connector type: "slack". Available: whatsapp
   Unknown provider type: "gpt-4". Available: claude-code
   ```

   Fix: V0 only supports `"whatsapp"` as a connector type and `"claude-code"` as a provider type. Check for typos (type values are case-sensitive).

4. **workspacePath does not exist**

   ```
   workspacePath does not exist or is not accessible: /path/to/workspace
   ```

   Fix: Use an absolute path to an existing directory. Tilde (`~`) is resolved automatically, but relative paths are not.

   ```json
   "workspacePath": "/Users/you/Desktop/my-project"
   ```

5. **Node.js version too old**

   OpenBridge requires Node.js >= 22 (ESM support). Older versions may produce syntax errors or module resolution failures.

   ```bash
   node --version   # Must be v22.x or higher
   ```

---

## WhatsApp Issues

### QR code displayed — what now?

On first run (or after session expiry), the terminal shows a QR code. Open WhatsApp on your phone, go to **Settings > Linked Devices > Link a Device**, and scan the code.

If the QR code is hard to read in the terminal, try widening your terminal window or reducing the font size.

### `WhatsApp authentication failed — saved session invalid, re-scan QR required`

The saved session is corrupted or expired.

Fix:

```bash
# Delete the session directory (default: .wwebjs_auth/)
rm -rf .wwebjs_auth/

# Restart the bridge and scan the QR code again
npm run dev
```

If you configured a custom `sessionPath`, delete that directory instead.

### `WhatsApp disconnected` / `WhatsApp reconnect: max attempts reached`

The WhatsApp connection dropped and auto-reconnect either kicked in or was exhausted.

**During reconnection** the bridge logs attempts with exponential backoff:

```
WhatsApp reconnect attempt 1/10, delay: 2000ms
WhatsApp reconnect attempt 2/10, delay: 4000ms
...
```

If all attempts fail:

```
WhatsApp reconnect: max attempts reached, giving up
```

Fix:

1. Check that your phone has an internet connection and WhatsApp is open.
2. Verify the linked device still appears in WhatsApp settings.
3. Restart the bridge. If the session is invalid, delete `.wwebjs_auth/` and re-scan.
4. To allow more reconnection attempts, increase `reconnect.maxAttempts` in your connector config.

### `WhatsApp connector is not connected`

The router tried to send a message before the WhatsApp client was ready.

Fix: Wait for the `WhatsApp client ready` log message before sending messages. If it never appears, check the QR code / authentication steps above.

### `Failed to send typing indicator`

This is a non-critical warning. The typing indicator is best-effort — message processing continues normally even if this fails.

---

## Claude Code Issues

### Claude CLI not found

If you see `ENOENT` errors or "command not found" when the provider tries to run `claude`:

```bash
# Check if Claude CLI is installed
which claude

# If not found, install it
npm install -g @anthropic-ai/claude-code
```

Make sure the `claude` binary is in your system `PATH`. If you installed it locally, the bridge may not find it.

### Execution timeout

The default timeout is 120 seconds (2 minutes). Complex prompts or large workspaces can exceed this.

```
Claude Code execution error: timeout
```

Fix: Increase the timeout in `config.json`:

```json
{
  "providers": [
    {
      "type": "claude-code",
      "options": {
        "timeout": 300000
      }
    }
  ]
}
```

You can also reduce processing time by:

- Simplifying the prompt
- Excluding large directories (e.g., `node_modules`) from the workspace

### `invalid api key` / `authentication failed`

The Claude CLI is not authenticated or the API key has expired.

Fix: Run `claude` directly in your terminal to verify authentication:

```bash
claude --print "hello"
```

If this fails, re-authenticate following the Claude CLI documentation.

### Transient vs. permanent errors

The provider classifies errors automatically:

- **Transient** (retried automatically): timeouts, `429 Too Many Requests`, `503 Service Unavailable`, network errors (`ECONNRESET`, `ETIMEDOUT`)
- **Permanent** (not retried): invalid API key, permission denied, `400 Bad Request`, `ENOENT`

If a message fails with a transient error, the queue retries it (up to `queue.maxRetries` times). Permanent errors skip retries and are sent to the dead letter queue.

### Prompt truncated warning

```
Prompt truncated to maximum allowed length (original: 40000, truncated: 32768)
```

Prompts longer than 32,768 characters are silently truncated. Keep prompts under this limit.

---

## Message Flow Issues

### Messages not arriving / silently dropped

Several things can cause messages to be dropped without a response:

1. **Sender not whitelisted**

   ```
   Unauthorized sender: +9999999999
   ```

   Fix: Add the phone number (with country code) to `auth.whitelist` in `config.json`.

2. **Missing prefix**

   Messages must start with the configured prefix (default: `/ai`). A message like "hello" is ignored — send `/ai hello` instead.

3. **Rate limited**

   ```
   Rate limit exceeded (sender: +1234567890, count: 11, maxMessages: 10)
   ```

   The sender exceeded the message limit for the current time window. No error is sent back to the user.

   Fix: Adjust `auth.rateLimit.maxMessages` and `auth.rateLimit.windowMs`, or disable rate limiting:

   ```json
   "rateLimit": { "enabled": false }
   ```

4. **Command blocked**

   ```
   Command blocked by deny pattern (command: rm -rf /, pattern: rm\s+-rf)
   ```

   The message matched a deny pattern in `auth.commandFilter.denyPatterns`.

   Fix: Review the deny patterns in your config. The user receives the configured `denyMessage` (default: "That command is not allowed.").

### `Default provider not found`

```
Default provider not found (provider: claude-code)
```

The `defaultProvider` in config doesn't match any registered provider's type.

Fix: Ensure `defaultProvider` matches one of the provider `type` values in the `providers` array.

### Messages stuck in queue

If messages are accepted but never get a response:

1. Check logs for provider errors (Claude CLI issues, timeouts).
2. Check the health endpoint for queue status: `curl http://localhost:8080/`
3. Look at `queue.deadLetterSize` — if it's growing, messages are failing permanently.

### Dead letter queue

Messages that fail all retry attempts are moved to the dead letter queue (DLQ). They stay in memory until the bridge restarts.

To check DLQ size via the health endpoint:

```bash
curl -s http://localhost:8080/ | jq '.queue.deadLetterSize'
```

There is no API to replay or flush the DLQ. Restart the bridge to clear it.

---

## Configuration Issues

### Config hot-reload not working

The bridge watches `config.json` for changes and auto-applies updates to auth settings (whitelist, rate limits, command filters) without a restart.

If hot-reload isn't working:

```
Config file watcher error
```

Fix: Check file permissions on `config.json`. On some systems, the file watcher may not work with network-mounted or symlinked files.

### `Failed to reload config file — keeping current config`

The updated `config.json` has a JSON syntax error or fails Zod validation. The bridge keeps running with the previous config.

Fix: Validate your JSON:

```bash
node -e "console.log(JSON.parse(require('fs').readFileSync('config.json','utf8')))"
```

### Changes that require a restart

Config hot-reload only applies to auth settings. Changes to these require a full restart:

- Connectors (adding/removing)
- Providers (adding/removing, workspacePath)
- Queue settings (maxRetries, retryDelayMs)
- Health check / metrics ports
- Log level

---

## Monitoring Issues

### Health check returning 503

```json
{ "status": "unhealthy", "error": "Not initialized" }
```

The health endpoint returns 503 when at least one connector is disconnected.

Fix: Check WhatsApp connection status in the logs. If the connector is reconnecting, wait for it to finish. If it failed, see [WhatsApp Issues](#whatsapp-issues).

### `Health check server error` / `EADDRINUSE`

```
EADDRINUSE: address already in use :::8080
```

Another process is using the health check port.

Fix:

```bash
# Find what's using the port
lsof -i :8080

# Either kill the process or change the port in config.json
```

```json
"health": { "enabled": true, "port": 9090 }
```

### `Metrics server error`

Same as above but for the metrics port. Default is 9090.

Fix: Change `metrics.port` in config or free the port.

---

## Logging & Debugging

### Increase log verbosity

Set `logLevel` in `config.json` to get more detail:

```json
"logLevel": "debug"
```

Available levels (most to least verbose): `trace`, `debug`, `info`, `warn`, `error`, `fatal`.

For production, use `info` or `warn`. For troubleshooting, use `debug` or `trace`.

### Reading logs

Logs are JSON by default (Pino format). Use `pino-pretty` for human-readable output:

```bash
npm run dev   # Already uses pino-pretty in dev mode
```

For production (JSON logs), pipe through pino-pretty:

```bash
node dist/index.js | npx pino-pretty
```

### Audit log

If audit logging is enabled (`audit.enabled: true`), message history is written to the configured `audit.logPath` (default: `audit.log`) in JSONL format.

```
Failed to write audit log entry
```

If you see this error, check that the audit log path is writable and the disk has free space.

---

## Environment Checklist

Run through this list when setting up OpenBridge for the first time:

| Requirement            | Check command                             | Expected                |
| ---------------------- | ----------------------------------------- | ----------------------- |
| Node.js >= 22          | `node --version`                          | `v22.x.x` or higher     |
| npm >= 10              | `npm --version`                           | `10.x.x` or higher      |
| Claude CLI installed   | `which claude`                            | Path to `claude` binary |
| Claude CLI works       | `claude --print "test"`                   | AI response in terminal |
| Chromium installed     | `which chromium \|\| which google-chrome` | Path to browser         |
| config.json exists     | `ls config.json`                          | File listed             |
| workspacePath exists   | `ls <your-workspace-path>`                | Directory contents      |
| Health port available  | `lsof -i :8080`                           | No output (port free)   |
| Metrics port available | `lsof -i :9090`                           | No output (port free)   |
