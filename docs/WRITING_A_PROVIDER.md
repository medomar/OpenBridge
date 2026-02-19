# Writing a Provider

> Step-by-step guide to adding a new AI backend to OpenBridge.

---

## Overview

A **provider** connects an AI service (Claude Code, OpenAI, Gemini, local LLMs, etc.) to OpenBridge's core engine. It receives cleaned messages and returns AI-generated responses.

---

## Step 1: Create the Directory

```
src/providers/your-provider/
├── your-provider.ts          # Main provider class
├── your-provider-config.ts   # Config schema (optional)
├── your-provider-client.ts   # API client wrapper (optional)
└── index.ts                  # Barrel export
```

---

## Step 2: Implement the AIProvider Interface

Your provider must implement `AIProvider` from `src/types/provider.ts`:

```typescript
import type { AIProvider, ProviderResult } from '../../types/provider.js';
import type { InboundMessage } from '../../types/message.js';

export class YourProvider implements AIProvider {
  readonly name = 'your-provider';

  async initialize(): Promise<void> {
    // Validate API keys, test connectivity
    // Pre-warm connections if needed
  }

  async processMessage(message: InboundMessage): Promise<ProviderResult> {
    // Send message.content to your AI service
    // Return the response
    const aiResponse = await this.callAI(message.content);

    return {
      content: aiResponse,
      metadata: {
        model: 'your-model-name',
        tokensUsed: 150,
      },
    };
  }

  async isAvailable(): Promise<boolean> {
    // Health check — can the AI service be reached?
    return true;
  }

  async shutdown(): Promise<void> {
    // Clean up connections, flush buffers
  }

  private async callAI(prompt: string): Promise<string> {
    // Your AI service integration here
    return 'AI response';
  }
}
```

---

## Step 3: Handle the ProviderResult

The `processMessage()` method must return a `ProviderResult`:

```typescript
interface ProviderResult {
  content: string; // The AI response text
  metadata?: {
    // Optional provider-specific data
    model?: string;
    tokensUsed?: number;
    latencyMs?: number;
    [key: string]: unknown;
  };
}
```

The router uses `content` to send the response back through the connector. Metadata is logged but not sent to the user.

---

## Step 4: Register the Provider

Add your factory to `src/providers/index.ts`:

```typescript
import { YourProvider } from './your-provider/index.js';

export function registerBuiltInProviders(registry: PluginRegistry): void {
  // Existing providers...
  registry.registerProvider('your-provider', (config) => {
    return new YourProvider(config.options);
  });
}
```

---

## Step 5: Add Config Support

If your provider needs configuration, add a Zod schema in `your-provider-config.ts`:

```typescript
import { z } from 'zod';

export const YourProviderOptionsSchema = z.object({
  apiKey: z.string().min(1),
  model: z.string().default('gpt-4'),
  maxTokens: z.number().positive().default(4096),
  temperature: z.number().min(0).max(2).default(0.7),
});

export type YourProviderOptions = z.infer<typeof YourProviderOptionsSchema>;
```

Users configure it in `config.json`:

```json
{
  "providers": [
    {
      "type": "your-provider",
      "enabled": true,
      "options": {
        "apiKey": "sk-...",
        "model": "gpt-4",
        "maxTokens": 4096
      }
    }
  ],
  "defaultProvider": "your-provider"
}
```

---

## Step 6: Write Tests

Create `tests/providers/your-provider/your-provider.test.ts`:

```typescript
import { describe, it, expect, vi } from 'vitest';
import { YourProvider } from '../../../src/providers/your-provider/index.js';

describe('YourProvider', () => {
  it('should implement the AIProvider interface', () => {
    const provider = new YourProvider({});
    expect(provider.name).toBe('your-provider');
  });

  it('should process messages and return results', async () => {
    const provider = new YourProvider({ apiKey: 'test-key' });
    // Mock the AI API call
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

  it('should report availability', async () => {
    const provider = new YourProvider({});
    const available = await provider.isAvailable();
    expect(typeof available).toBe('boolean');
  });
});
```

---

## Key Considerations

### Workspace Scoping

If your provider accesses the filesystem (like Claude Code does), always scope access to the configured `workspacePath`. Never allow the AI to access files outside this boundary.

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
- [ ] Registered in `src/providers/index.ts`
- [ ] Has unit tests
- [ ] Documented in config example
