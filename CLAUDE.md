# OpenBridge — Development Guide

## Quick Reference

```bash
npm run dev          # Start bridge (hot reload) — reads config.json
npm run build        # Compile TypeScript → dist/
npm run start        # Run compiled version from dist/
npm run test         # Run all tests
npm run lint         # Lint check
npm run typecheck    # Type check
```

## How to Use OpenBridge

### Step 1: Create your config

```bash
cp config.example.json config.json
```

Edit `config.json`:

- Set `workspacePath` to the **absolute path** of the project you want the AI to work on
- Set `whitelist` to your phone number (with country code, e.g. `+212612345678`)
- Set `prefix` to whatever trigger word you want (default: `/ai`)

Example:

```json
{
  "providers": [
    {
      "type": "claude-code",
      "options": {
        "workspacePath": "/Users/sayadimohamedomar/Desktop/my-app"
      }
    }
  ],
  "auth": {
    "whitelist": ["+212XXXXXXXXX"],
    "prefix": "/ai"
  }
}
```

### Step 2: Run the bridge

```bash
npm run dev
```

A QR code appears in the terminal. Scan it with WhatsApp (Linked Devices).

### Step 3: Send a command

From your phone, send a WhatsApp message to yourself:

```
/ai what files are in this project?
```

The bridge will:

1. Check your phone number is whitelisted
2. Strip the `/ai` prefix
3. Run `claude --print "what files are in this project?"` inside your workspace
4. Send the response back to your WhatsApp

## Architecture

```
Phone → WhatsApp → Connector → Bridge Core → Router → AI Provider → Claude CLI
                                                                        ↓
Phone ← WhatsApp ← Connector ← Bridge Core ← Router ←────────── Response
```

### Key files

| File                         | Purpose                                                      |
| ---------------------------- | ------------------------------------------------------------ |
| `config.json`                | Your runtime config (gitignored)                             |
| `src/index.ts`               | Entry point — loads config, registers plugins, starts bridge |
| `src/core/bridge.ts`         | Orchestrator — wires connectors, providers, auth, queue      |
| `src/core/router.ts`         | Routes messages from connector to provider and back          |
| `src/core/auth.ts`           | Phone whitelist + prefix detection                           |
| `src/core/queue.ts`          | Sequential message processing                                |
| `src/core/registry.ts`       | Plugin registry — connectors and providers register here     |
| `src/types/connector.ts`     | Interface every connector must implement                     |
| `src/types/provider.ts`      | Interface every AI provider must implement                   |
| `src/connectors/whatsapp/`   | WhatsApp connector (V0)                                      |
| `src/providers/claude-code/` | Claude Code CLI provider (V0)                                |

### How `workspacePath` works

The `workspacePath` in config.json is the target project — **not** the OpenBridge folder.

Example: if you're building an iOS app at `~/Desktop/my-ios-app`, you set:

```json
"workspacePath": "/Users/you/Desktop/my-ios-app"
```

When a message arrives, Claude Code runs **inside that folder** with full access to its files, git, and terminal. OpenBridge is just the messenger.

### Adding a new connector

1. Create `src/connectors/your-connector/`
2. Implement the `Connector` interface from `src/types/connector.ts`
3. Register it in `src/connectors/index.ts`
4. Add `{ "type": "your-connector" }` to config.json

### Adding a new AI provider

1. Create `src/providers/your-provider/`
2. Implement the `AIProvider` interface from `src/types/provider.ts`
3. Register it in `src/providers/index.ts`
4. Add `{ "type": "your-provider" }` to config.json

## Conventions

- Conventional commits: `feat(scope): description`
- Scopes: core, whatsapp, claude, connector, provider, config, deps, ci, docs
- Branch from `develop`, merge via PR
- All code must pass `npm run lint && npm run test && npm run build`
