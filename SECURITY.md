# Security Policy

## Supported Versions

| Version | Supported |
| ------- | --------- |
| 0.x     | Yes       |

## Reporting a Vulnerability

**Please do NOT report security vulnerabilities through public GitHub issues.**

Instead, use one of the following private channels:

- **GitHub Security Advisories (preferred):** [Report a vulnerability](https://github.com/openbridge-ai/openbridge/security/advisories/new)
- **Email:** security@openbridge.dev

### Responsible Disclosure Process

1. **Submit your report** via GitHub Security Advisories or the email above. Include:
   - Description of the vulnerability
   - Steps to reproduce
   - Potential impact
   - Suggested fix (if any)

2. **Acknowledgement:** You will receive an acknowledgement within **48 hours** confirming we received your report.

3. **Assessment:** We will assess the severity and scope within **7 days** and keep you updated on our progress.

4. **Fix & Release:** Once confirmed, we will release a patch as soon as possible depending on complexity. Critical issues target a fix within **14 days**; high-severity issues within **30 days**.

5. **Disclosure:** We coordinate public disclosure with the reporter. We ask for a **90-day embargo** from report to public disclosure to give users time to update.

6. **Credit:** Reporters who responsibly disclose vulnerabilities will be credited in the release notes and CHANGELOG unless they prefer to remain anonymous. Please let us know your preference when submitting.

## Security Considerations

OpenBridge handles sensitive data including:

- **WhatsApp session tokens** (stored locally in `.wwebjs_auth/`)
- **Telegram bot tokens** (set via `channels[].token` in `config.json` — treat as a secret)
- **Discord bot tokens** (set via `channels[].token` in `config.json` — treat as a secret)
- **Message content** routed between platforms and AI providers
- **AI provider credentials** (API keys for non-local providers)
- **Workspace access** (the AI provider operates within the project workspace)

### Token Handling — Telegram & Discord

- Telegram and Discord bot tokens grant full control over the bot. Store them in environment variables or a secrets manager rather than directly in `config.json`.
- If using environment variables, reference them in your config via `"token": "${TELEGRAM_BOT_TOKEN}"` and load them before starting OpenBridge (e.g. via a `.env` file with `dotenv`).
- Never commit `config.json` containing real tokens to version control. Add `config.json` to `.gitignore`.
- Rotate tokens immediately if they are accidentally exposed in a commit, log file, or public channel.

### Best Practices for Users

- Never commit `.env`, `config.json`, `config.local.json`, or `.wwebjs_auth/` to version control
- Use the phone/user whitelist to restrict who can send commands
- Run OpenBridge in a dedicated workspace with appropriate scope
- Review AI provider permissions before granting workspace access
- Set `NODE_ENV=production` in production deployments to disable development connectors
