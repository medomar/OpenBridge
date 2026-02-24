# OpenBridge — Troubleshooting Guide

> Common errors, their causes, and how to fix them.

---

## Quick Reference

| Symptom                              | Jump to                                       |
| ------------------------------------ | --------------------------------------------- |
| Bridge won't start                   | [Startup Errors](#startup-errors)             |
| QR code won't scan / session expired | [WhatsApp Issues](#whatsapp-issues)           |
| Messages not being processed         | [Message Flow Issues](#message-flow-issues)   |
| AI responses failing                 | [AI Tool Issues](#ai-tool-issues)             |
| No AI tools discovered               | [Discovery Issues](#discovery-issues)         |
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

   Fix: Create a config file.

   ```bash
   npx openbridge init
   # Or copy the example:
   cp config.example.json config.json
   ```

2. **Invalid config schema**

   Zod validation errors look like:

   ```
   ZodError: [{ "code": "too_small", "minimum": 1, "path": ["channels"] }]
   ```

   Fix: Ensure your config matches V2 format (3 required fields) or V0 format. See [CONFIGURATION.md](./CONFIGURATION.md).

3. **workspacePath does not exist**

   ```
   workspacePath does not exist or is not accessible: /path/to/workspace
   ```

   Fix: Use an absolute path to an existing directory. Tilde (`~`) is resolved automatically, but relative paths are not.

   ```json
   "workspacePath": "/Users/you/Desktop/my-project"
   ```

4. **Node.js version too old**

   OpenBridge requires Node.js >= 22 (ESM support). Older versions may produce syntax errors or module resolution failures.

   ```bash
   node --version   # Must be v22.x or higher
   ```

---

## Discovery Issues

### No AI tools found

```
No AI tools discovered on this machine
```

OpenBridge scans for known CLI tools (`claude`, `codex`, `aider`, `cursor`, `cody`) using `which`. If none are found, the bridge cannot start in V2 mode.

Fix:

```bash
# Check if any AI CLI is installed
which claude
which codex
which aider

# Install one (e.g. Claude Code)
npm install -g @anthropic-ai/claude-code
```

### Wrong tool selected as Master

The discovery module picks the highest-priority available tool as Master. Priority: claude > codex > aider > cursor > cody.

Fix: Override in `config.json`:

```json
{
  "master": {
    "tool": "codex"
  }
}
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

### `WhatsApp disconnected` / `WhatsApp reconnect: max attempts reached`

The WhatsApp connection dropped and auto-reconnect was exhausted.

Fix:

1. Check that your phone has an internet connection and WhatsApp is open.
2. Verify the linked device still appears in WhatsApp settings.
3. Restart the bridge. If the session is invalid, delete `.wwebjs_auth/` and re-scan.

### `Failed to send typing indicator`

This is a non-critical warning. The typing indicator is best-effort — message processing continues normally.

---

## AI Tool Issues

### AI CLI not found

If you see `ENOENT` errors or "command not found" when the Master AI tries to run:

```bash
# Check if the AI CLI is installed and in PATH
which claude

# If not found, install it
npm install -g @anthropic-ai/claude-code
```

Make sure the binary is in your system `PATH`.

### Execution timeout

The default timeout is 120 seconds (2 minutes). Complex prompts or large workspaces can exceed this.

```
AI execution error: timeout
```

Fix: Simplify the prompt, or increase the timeout in your Master AI configuration.

### `invalid api key` / `authentication failed`

The AI CLI is not authenticated or the API key has expired.

Fix: Run the AI CLI directly in your terminal to verify authentication:

```bash
claude --print "hello"
```

If this fails, re-authenticate following the tool's documentation.

### Transient vs. permanent errors

The executor classifies errors automatically:

- **Transient** (retried automatically): timeouts, `429 Too Many Requests`, `503 Service Unavailable`, network errors
- **Permanent** (not retried): invalid API key, permission denied, `400 Bad Request`

If a message fails with a transient error, the queue retries it (up to `queue.maxRetries` times). Permanent errors are sent to the dead letter queue.

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
   Rate limit exceeded (sender: +1234567890)
   ```

   Fix: Adjust `auth.rateLimit.maxMessages` and `auth.rateLimit.windowMs`, or disable:

   ```json
   "rateLimit": { "enabled": false }
   ```

4. **Command blocked**

   The message matched a deny pattern in `auth.commandFilter.denyPatterns`.

5. **Master AI not ready**

   If the Master AI is still exploring the workspace, messages may be queued until exploration completes.

### Messages stuck in queue

If messages are accepted but never get a response:

1. Check logs for AI tool errors (timeouts, auth failures).
2. Check the health endpoint: `curl http://localhost:8080/`
3. Look at `queue.deadLetterSize` — if it's growing, messages are failing permanently.

### "Working on it..." but no response

The `dev:watch` script can kill the Node process during AI execution, preventing the response from being sent.

Fix: Use `npm run dev` (no watch) instead of `npm run dev:watch` when testing AI responses.

---

## Configuration Issues

### Config hot-reload not working

The bridge watches `config.json` and auto-applies updates to auth settings (whitelist, rate limits, command filters) without a restart.

If hot-reload isn't working, check file permissions on `config.json`.

### `Failed to reload config file — keeping current config`

The updated `config.json` has a JSON syntax error or fails Zod validation.

Fix: Validate your JSON:

```bash
node -e "console.log(JSON.parse(require('fs').readFileSync('config.json','utf8')))"
```

### Changes that require a restart

Config hot-reload only applies to auth settings. Changes to these require a full restart:

- Channels (adding/removing)
- Workspace path
- Queue settings
- Health check / metrics ports
- Log level

---

## Monitoring Issues

### Health check returning 503

The health endpoint returns 503 when at least one connector is disconnected.

Fix: Check WhatsApp connection status in the logs. See [WhatsApp Issues](#whatsapp-issues).

### `EADDRINUSE`

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

---

## Logging & Debugging

### Increase log verbosity

```json
"logLevel": "debug"
```

Available levels (most to least verbose): `trace`, `debug`, `info`, `warn`, `error`, `fatal`.

### Reading logs

Logs are JSON by default (Pino format). Use `pino-pretty` for human-readable output:

```bash
npm run dev   # Already uses pino-pretty in dev mode
```

For production (JSON logs), pipe through pino-pretty:

```bash
node dist/index.js | npx pino-pretty
```

---

## Environment Checklist

| Requirement           | Check command                             | Expected                |
| --------------------- | ----------------------------------------- | ----------------------- |
| Node.js >= 22         | `node --version`                          | `v22.x.x` or higher     |
| npm >= 10             | `npm --version`                           | `10.x.x` or higher      |
| At least one AI CLI   | `which claude \|\| which codex`           | Path to binary          |
| AI CLI works          | `claude --print "test"`                   | AI response in terminal |
| Chromium installed    | `which chromium \|\| which google-chrome` | Path to browser         |
| config.json exists    | `ls config.json`                          | File listed             |
| workspacePath exists  | `ls <your-workspace-path>`                | Directory contents      |
| Health port available | `lsof -i :8080`                           | No output (port free)   |
