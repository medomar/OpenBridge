# OpenBridge — Connector Testing Guide

How to enable and test each connector. All connectors use the same `config.json` — just swap the `channels` array.

---

## Console

The simplest connector — reads from stdin, writes to stdout. No credentials needed.

**When to use:** Local development, scripting, demos without a phone/browser.

**Setup:** Console is enabled by default. Just run the bridge.

```bash
npm run dev
```

Type a message and press Enter. Prefix with `/ai` (or whatever your `auth.prefix` is set to).

**Sample config.json:**

```json
{
  "workspacePath": "/absolute/path/to/your/project",
  "channels": [
    {
      "type": "console",
      "enabled": true
    }
  ],
  "auth": {
    "whitelist": ["console-user"],
    "prefix": "/ai"
  }
}
```

> **Note:** The Console connector sends messages as `console-user`. Add that string to your whitelist, or leave whitelist empty to allow all.

---

## WebChat

A browser-based chat UI served on `localhost`. No phone or bot account needed.

**When to use:** Demos, local testing with a polished UI, sharing with teammates on the same machine.

**Setup:**

1. Add `webchat` to `channels` in config.json (see sample below).
2. Run the bridge: `npm run dev`
3. Open `http://localhost:3000` in your browser.
4. Type a message and send.

**Sample config.json:**

```json
{
  "workspacePath": "/absolute/path/to/your/project",
  "channels": [
    {
      "type": "webchat",
      "enabled": true,
      "options": {
        "port": 3000,
        "host": "localhost"
      }
    }
  ],
  "auth": {
    "whitelist": ["webchat-user"],
    "prefix": "/ai"
  }
}
```

**Options:**

| Option | Default     | Description                               |
| ------ | ----------- | ----------------------------------------- |
| `port` | `3000`      | TCP port the HTTP + WebSocket server uses |
| `host` | `localhost` | Hostname the server binds to              |

> **Tip:** To expose WebChat on your local network (e.g. for phone testing), set `"host": "0.0.0.0"` and open `http://<your-ip>:3000`.

---

## Telegram

A Telegram bot that responds to direct messages and group `@mentions`.

**When to use:** Mobile testing, team deployments, production use with Telegram users.

**Setup:**

1. Create a bot via [@BotFather](https://t.me/botfather):
   - Send `/newbot`
   - Choose a name (e.g. `My OpenBridge Bot`)
   - Choose a username ending in `bot` (e.g. `my_openbridge_bot`)
   - Copy the token (format: `123456789:ABC-DEF...`)
2. Add the token to `config.json` (see sample below).
3. Run the bridge: `npm run dev`
4. Open Telegram, find your bot, send a message.

**Sample config.json:**

```json
{
  "workspacePath": "/absolute/path/to/your/project",
  "channels": [
    {
      "type": "telegram",
      "enabled": true,
      "options": {
        "token": "123456789:ABC-DEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnop",
        "botUsername": "my_openbridge_bot"
      }
    }
  ],
  "auth": {
    "whitelist": ["+1234567890"],
    "prefix": "/ai"
  }
}
```

**Options:**

| Option        | Required | Description                                             |
| ------------- | :------: | ------------------------------------------------------- |
| `token`       |   Yes    | Bot token from @BotFather                               |
| `botUsername` |    No    | Bot username without `@` — required for group @mentions |

**Group chats:** Add the bot to a group and mention it: `@my_openbridge_bot /ai what's in this project?`

**Whitelist:** Telegram messages use the sender's phone number (if available) or numeric user ID. To allow all users, set `"whitelist": []`.

---

## Discord

A Discord bot that responds to DMs and messages in guild channels.

**When to use:** Team deployments on Discord servers, developer communities.

**Setup:**

1. Create a Discord application and bot:
   - Go to [discord.com/developers/applications](https://discord.com/developers/applications)
   - Click **New Application** → name it (e.g. `OpenBridge`)
   - Go to **Bot** → click **Add Bot** → confirm
   - Under **Token**, click **Reset Token** and copy it
   - Under **Privileged Gateway Intents**, enable:
     - **Server Members Intent**
     - **Message Content Intent**
   - Click **Save Changes**
2. Invite the bot to your server:
   - Go to **OAuth2 → URL Generator**
   - Select scopes: `bot`
   - Select bot permissions: `Send Messages`, `Read Message History`, `View Channels`
   - Open the generated URL and add the bot to your server
3. Add the token to `config.json` (see sample below).
4. Run the bridge: `npm run dev`
5. Send a message to the bot in a channel or DM.

**Sample config.json:**

```json
{
  "workspacePath": "/absolute/path/to/your/project",
  "channels": [
    {
      "type": "discord",
      "enabled": true,
      "options": {
        "token": "YOUR_DISCORD_BOT_TOKEN_HERE"
      }
    }
  ],
  "auth": {
    "whitelist": ["your-discord-user-id"],
    "prefix": "/ai"
  }
}
```

**Options:**

| Option  | Required | Description                         |
| ------- | :------: | ----------------------------------- |
| `token` |   Yes    | Bot token from the Developer Portal |

**Whitelist:** Discord messages use the sender's Discord user ID (numeric string, e.g. `"123456789012345678"`). Enable Developer Mode in Discord settings to copy user IDs. To allow all users, set `"whitelist": []`.

---

## WhatsApp

Connects to WhatsApp via a QR code scan (uses the whatsapp-web.js library).

**When to use:** Production deployments, mobile-first workflows, sharing with non-technical users.

**Setup:**

1. Make sure Google Chrome or Chromium is installed on your machine (required by whatsapp-web.js).
2. Add `whatsapp` to `channels` in config.json (see sample below).
3. Run the bridge: `npm run dev`
4. A QR code appears in the terminal.
5. Open WhatsApp on your phone → **Settings → Linked Devices → Link a Device** → scan the QR code.
6. Send a message from a whitelisted number. Prefix with `/ai`.

**Sample config.json:**

```json
{
  "workspacePath": "/absolute/path/to/your/project",
  "channels": [
    {
      "type": "whatsapp",
      "enabled": true,
      "options": {
        "sessionName": "openbridge-default"
      }
    }
  ],
  "auth": {
    "whitelist": ["+1234567890"],
    "prefix": "/ai"
  }
}
```

**Options:**

| Option        | Default              | Description                                         |
| ------------- | -------------------- | --------------------------------------------------- |
| `sessionName` | `openbridge-default` | Name for the WhatsApp session (used as folder name) |
| `sessionPath` | (auto)               | Custom path to store session data                   |
| `headless`    | `true`               | Run Chromium headlessly (set `false` to debug)      |
| `reconnect`   | see below            | Auto-reconnect settings                             |

**Reconnect defaults:**

```json
{
  "enabled": true,
  "maxAttempts": 10,
  "initialDelayMs": 2000,
  "maxDelayMs": 60000,
  "backoffFactor": 2
}
```

**Whitelist:** Use the full international format with `+` and country code, e.g. `"+1234567890"`.

**Session persistence:** Once linked, the session is saved to disk. On restart, OpenBridge reconnects automatically without re-scanning the QR code.

**Troubleshooting:**

- **QR code not appearing:** Ensure Chrome/Chromium is installed (`google-chrome --version` or `chromium --version`).
- **`ProtocolError: Execution context was destroyed`:** Transient Chromium crash during startup — OpenBridge retries automatically (up to 3 attempts with backoff). If it persists, try restarting.
- **Session expired:** Delete the `.wwebjs_auth/` folder and re-scan the QR code.

---

## Running Multiple Connectors

You can enable multiple connectors at the same time. Each operates independently — the same Master AI handles messages from all channels.

```json
{
  "workspacePath": "/absolute/path/to/your/project",
  "channels": [
    { "type": "console", "enabled": true },
    {
      "type": "webchat",
      "enabled": true,
      "options": { "port": 3000 }
    },
    {
      "type": "telegram",
      "enabled": true,
      "options": { "token": "YOUR_TELEGRAM_TOKEN" }
    }
  ],
  "auth": {
    "whitelist": [],
    "prefix": "/ai"
  }
}
```

All connectors start in parallel on `npm run dev`. Responses are delivered back through the same connector the message came from.
