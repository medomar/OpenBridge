# OpenBridge — Task List

## V0 — Core Functionality

### Must Have (before first real use)

- [ ] **Resolve `~` tilde in workspacePath** — config loader should expand `~/Desktop/x` to absolute path
- [ ] **Real-world WhatsApp QR test** — scan QR, send a message, verify full round-trip works
- [ ] **Auto-reconnect on WhatsApp disconnect** — reconnect automatically when session drops
- [ ] **Graceful shutdown** — bridge.stop() should properly shut down all connectors and providers
- [ ] **Error handling in router** — catch provider failures and send error message back to user instead of silently failing
- [ ] **Create `develop` branch** — all active work should happen on develop, main stays clean for releases

### Should Have

- [ ] **Message splitting for long responses** — split responses >4096 chars into multiple WhatsApp messages instead of truncating
- [ ] **Streaming responses** — send partial output as Claude works instead of waiting for full completion
- [ ] **Status messages** — send "Working on it..." with estimated wait, then the actual response
- [ ] **Message history/context** — keep last N messages so follow-up commands have context ("now fix the tests" after "add dark mode")
- [ ] **Timeout handling** — configurable timeout per provider with user-friendly timeout message
- [ ] **Rate limiting** — prevent spam/accidental message floods from overwhelming Claude

### Nice to Have

- [ ] **Multi-workspace routing** — `/ai:ios fix the bug` routes to iOS workspace, `/ai:web add a page` routes to web workspace
- [ ] **Per-user provider config** — different phone numbers can route to different AI providers
- [ ] **Message formatting** — format Claude's code output nicely for WhatsApp (code blocks, bullet points)
- [ ] **Command system** — built-in commands like `/ai:status`, `/ai:config`, `/ai:help` that don't go to the AI
- [ ] **Logging to file** — persist logs for debugging

---

## V1 — Extensibility

### New Connectors

- [ ] **Telegram connector** — implement Connector interface with Telegram Bot API
- [ ] **Slack connector** — implement Connector interface with Slack Bolt
- [ ] **Discord connector** — implement Connector interface with discord.js
- [ ] **iMessage connector** — investigate AppleScript/Shortcuts approach on macOS

### New AI Providers

- [ ] **OpenAI provider** — implement AIProvider interface with OpenAI API (GPT-4, etc.)
- [ ] **Gemini provider** — implement AIProvider interface with Google AI SDK
- [ ] **Ollama provider** — implement AIProvider interface for local LLMs via Ollama
- [ ] **Custom HTTP provider** — generic provider that POSTs to any API endpoint

### Platform

- [ ] **Web dashboard** — local web UI to monitor messages, view logs, manage config
- [ ] **Config hot-reload** — detect config.json changes and reload without restart
- [ ] **Plugin system** — load connectors/providers from npm packages or local folders
- [ ] **Docker support** — Dockerfile + docker-compose for easy deployment

---

## Documentation

- [ ] **Configuration guide** — `docs/configuration.md` with all config options explained
- [ ] **Writing a connector guide** — `docs/writing-a-connector.md` step-by-step tutorial
- [ ] **Writing a provider guide** — `docs/writing-a-provider.md` step-by-step tutorial
- [ ] **Deployment guide** — how to run OpenBridge as a background service (systemd, pm2, launchd)

---

## Tech Debt

- [ ] **Integration tests** — test full message flow with mock WhatsApp + mock Claude
- [ ] **WhatsApp connector unit tests** — currently untested (requires mocking whatsapp-web.js)
- [ ] **Claude Code provider unit tests** — currently untested (requires mocking child_process)
- [ ] **CI badge** — connect GitHub repo so CI badge in README works
- [ ] **npm publish setup** — prepare for publishing to npm registry
- [ ] **Codecov integration** — upload coverage reports from CI
