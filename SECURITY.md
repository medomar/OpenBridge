# Security Policy

## Supported Versions

| Version | Supported |
| ------- | --------- |
| 0.x     | Yes       |

## Reporting a Vulnerability

**Please do NOT report security vulnerabilities through public GitHub issues.**

Instead, please report them via email to the project maintainers.

You should receive a response within 48 hours. If the issue is confirmed, we will
release a patch as soon as possible depending on complexity.

Please include:

- Description of the vulnerability
- Steps to reproduce
- Potential impact
- Suggested fix (if any)

## Security Considerations

OpenBridge handles sensitive data including:

- **WhatsApp session tokens** (stored locally in `.wwebjs_auth/`)
- **Message content** routed between platforms and AI providers
- **AI provider credentials** (API keys for non-local providers)
- **Workspace access** (the AI provider operates within the project workspace)

### Best Practices for Users

- Never commit `.env`, `config.local.json`, or `.wwebjs_auth/` to version control
- Use the phone number whitelist to restrict who can send commands
- Run OpenBridge in a dedicated workspace with appropriate scope
- Review AI provider permissions before granting workspace access
