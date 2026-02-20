# Writing a Provider

> Step-by-step guide to adding a new AI backend to OpenBridge.

---

## Overview

A **provider** connects an AI service to OpenBridge's core engine. It receives cleaned messages and returns AI-generated responses.

In **V2** (current), AI tools are auto-discovered on the machine at startup. The generalized CLI executor (`claude-code-executor.ts`) can run any CLI tool by setting the `command` option. You typically don't need to write a new provider — just ensure the AI CLI is installed and OpenBridge will discover it.

In **V0** (legacy), providers are manually registered and configured in `config.json`.

---

## When Do You Need a Custom Provider?

You only need a custom provider if:

- The AI tool is **not a CLI** (e.g., it's an HTTP API like OpenAI or Gemini)
- The AI tool needs **special integration** beyond simple CLI spawning
- You want to use a **local LLM** with a custom runtime

If the AI tool is a standard CLI (like `claude`, `codex`, `aider`), you don't need a custom provider — add it to the discovery registry in `src/discovery/tool-scanner.ts` instead.

---

## Option A: Add a CLI Tool to Discovery (preferred)

For CLI-based AI tools, add an entry to the known tools registry:

```typescript
// src/discovery/tool-scanner.ts

const KNOWN_AI_TOOLS = [
  {
    name: 'claude',
    command: 'claude',
    priority: 1,
    capabilities: ['code-generation', 'file-editing', 'conversation', 'tool-use'],
  },
  {
    name: 'codex',
    command: 'codex',
    priority: 2,
    capabilities: ['code-generation', 'file-editing'],
  },
  {
    name: 'aider',
    command: 'aider',
    priority: 3,
    capabilities: ['code-generation', 'file-editing'],
  },
  // Add your tool here:
  { name: 'your-tool', command: 'your-tool', priority: 6, capabilities: ['code-generation'] },
];
```

The generalized executor will handle spawning, streaming, timeouts, and session management.

---

## Option B: Write a Custom Provider (for non-CLI tools)

### Step 1: Create the Directory

```
src/providers/your-provider/
├── your-provider.ts          # Main provider class
├── your-provider-config.ts   # Config schema (optional)
└── index.ts                  # Barrel export
```

### Step 2: Implement the AIProvider Interface

Your provider must implement `AIProvider` from `src/types/provider.ts`:

```typescript
import type { AIProvider, ProviderResult } from '../../types/provider.js';
import type { InboundMessage } from '../../types/message.js';

export class YourProvider implements AIProvider {
  readonly name = 'your-provider';

  async initialize(): Promise<void> {
    // Validate API keys, test connectivity
  }

  async processMessage(message: InboundMessage): Promise<ProviderResult> {
    const aiResponse = await this.callAI(message.content);
    return {
      content: aiResponse,
      metadata: { model: 'your-model-name' },
    };
  }

  async isAvailable(): Promise<boolean> {
    return true;
  }

  async shutdown(): Promise<void> {
    // Clean up connections
  }

  private async callAI(prompt: string): Promise<string> {
    // Your AI service integration here
    return 'AI response';
  }
}
```

### Step 3: Register the Provider (V0 config)

Add your factory to `src/providers/index.ts`:

```typescript
import { YourProvider } from './your-provider/index.js';

export function registerBuiltInProviders(registry: PluginRegistry): void {
  registry.registerProvider('your-provider', (config) => {
    return new YourProvider(config.options);
  });
}
```

Configure in `config.json` (V0 format):

```json
{
  "providers": [
    {
      "type": "your-provider",
      "enabled": true,
      "options": {
        "apiKey": "sk-..."
      }
    }
  ],
  "defaultProvider": "your-provider"
}
```

### Step 4: Write Tests

```typescript
import { describe, it, expect } from 'vitest';
import { YourProvider } from '../../../src/providers/your-provider/index.js';

describe('YourProvider', () => {
  it('should implement the AIProvider interface', () => {
    const provider = new YourProvider({});
    expect(provider.name).toBe('your-provider');
  });

  it('should process messages and return results', async () => {
    const provider = new YourProvider({ apiKey: 'test-key' });
    const result = await provider.processMessage({
      id: '1',
      source: 'test',
      sender: '+1234567890',
      rawContent: 'hello',
      content: 'hello',
      timestamp: new Date(),
    });
    expect(result.content).toBeDefined();
  });
});
```

---

## Key Considerations

### Workspace Scoping

If your provider accesses the filesystem, always scope access to the configured `workspacePath`. Never allow the AI to access files outside this boundary.

### Timeout Handling

Long-running AI requests should respect the configured timeout. The Claude Code provider uses `options.timeout` (default: 120000ms).

### Error Handling

- Return meaningful error messages in `ProviderResult.content` so the user gets feedback
- Throw errors only for unrecoverable failures (the router will catch and report them)
- Log errors with context using the shared Pino logger

---

## Checklist

- [ ] Implements `AIProvider` interface fully
- [ ] `processMessage()` returns valid `ProviderResult`
- [ ] `isAvailable()` performs a real health check
- [ ] Cleans up resources in `shutdown()`
- [ ] Respects `workspacePath` scoping (if applicable)
- [ ] Handles timeouts gracefully
- [ ] Has unit tests
