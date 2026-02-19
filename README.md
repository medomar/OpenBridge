<div align="center">

# OpenBridge

**Connect any messaging platform to any AI provider.**

[![License](https://img.shields.io/badge/license-Apache%202.0-blue.svg)](LICENSE)
[![Node.js](https://img.shields.io/badge/node-%3E%3D22.0.0-brightgreen.svg)](https://nodejs.org/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.7-blue.svg)](https://www.typescriptlang.org/)
[![CI](https://github.com/medomar/OpenBridge/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/medomar/OpenBridge/actions/workflows/ci.yml)
[![PRs Welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg)](CONTRIBUTING.md)

Send a message from your phone. Your AI processes it within the workspace. Get the response back instantly.

[Getting Started](#getting-started) |
[Documentation](#documentation) |
[Contributing](#contributing) |
[License](#license)

</div>

---

## What is OpenBridge?

OpenBridge is an open-source, modular bridge that connects **messaging platforms** (WhatsApp, Slack, Telegram, ...) to **AI providers** (Claude Code, OpenAI, Gemini, local LLMs, ...). It turns any smartphone into a remote control for an AI-powered assistant scoped to your project workspace.

### Architecture

```
Connectors          Bridge Core          AI Providers
(Messaging In)      (Router/Auth/        (AI Out)
                     Queue/Config)
WhatsApp ------>                  ------> Claude Code
Slack    ------>     OpenBridge   ------> OpenAI
Telegram ------>                  ------> Local LLMs
```

**V0 ships with**: WhatsApp connector + Claude Code provider

### Key Features

- **Connector-agnostic** -- WhatsApp today, Slack or Telegram tomorrow
- **AI-agnostic** -- Claude Code today, OpenAI or a local LLM tomorrow
- **Zero cloud infrastructure** -- runs locally on your machine
- **Deep workspace context** -- the AI sees your codebase, git history, and tools
- **Plugin architecture** -- add a connector or provider by implementing one interface

## Getting Started

### Prerequisites

- Node.js >= 22.0.0
- npm >= 10.0.0
- A WhatsApp account (for V0 connector)
- Claude Code CLI installed (for V0 provider)

### Installation

```bash
git clone https://github.com/medomar/OpenBridge.git
cd OpenBridge
npm install
cp config.example.json config.json
# Edit config.json with your phone number whitelist
```

### Quick Start

```bash
# Start in development mode
npm run dev

# Scan the QR code with WhatsApp when prompted
# Send "/ai hello" from your phone to test
```

### Configuration

Copy the example config and customize:

```bash
cp config.example.json config.json
```

See [Configuration Guide](docs/configuration.md) for details.

## Documentation

- [Project Overview](OVERVIEW.md) -- Vision, architecture, and V0 scope
- [Configuration Guide](docs/configuration.md)
- [Writing a Connector](docs/writing-a-connector.md)
- [Writing an AI Provider](docs/writing-a-provider.md)

## Contributing

We welcome contributions! Please see [CONTRIBUTING.md](CONTRIBUTING.md) for guidelines.

## Security

To report security vulnerabilities, please see [SECURITY.md](SECURITY.md).

## License

This project is licensed under the Apache License 2.0 -- see the [LICENSE](LICENSE) file for details.
