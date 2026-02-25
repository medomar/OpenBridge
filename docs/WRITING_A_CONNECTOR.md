# Writing a Connector

> Step-by-step guide to adding a new messaging platform to OpenBridge.

---

## Overview

A **connector** bridges a messaging platform (WhatsApp, Slack, Telegram, etc.) to OpenBridge's core engine. It translates platform-specific messages into the standard `InboundMessage` format and sends `OutboundMessage` responses back.

---

## Step 1: Create the Directory

```
src/connectors/your-connector/
├── your-connector.ts          # Main connector class
├── your-connector-config.ts   # Config schema (optional)
├── your-connector-message.ts  # Message parsing helpers (optional)
└── index.ts                   # Barrel export
```

---

## Step 2: Implement the Connector Interface

Your connector must implement `Connector` from `src/types/connector.ts`:

```typescript
import { EventEmitter } from 'node:events';
import type { Connector, ConnectorEvents } from '../../types/connector.js';
import type { OutboundMessage, InboundMessage } from '../../types/message.js';

export class YourConnector implements Connector {
  readonly name = 'your-connector';
  private emitter = new EventEmitter();
  private connected = false;

  async initialize(): Promise<void> {
    // Connect to the messaging platform
    // Set up event listeners for incoming messages
    // When a message arrives, emit it:
    //   this.emitter.emit('message', inboundMessage);
    this.connected = true;
  }

  async sendMessage(message: OutboundMessage): Promise<void> {
    // Translate OutboundMessage to platform-specific format
    // Send it via the platform's API
  }

  on<E extends keyof ConnectorEvents>(event: E, listener: ConnectorEvents[E]): void {
    this.emitter.on(event, listener);
  }

  async shutdown(): Promise<void> {
    // Disconnect from the platform
    // Clean up resources
    this.connected = false;
  }

  isConnected(): boolean {
    return this.connected;
  }
}
```

---

## Step 3: Handle Message Translation

Convert platform messages to `InboundMessage`:

```typescript
const inboundMessage: InboundMessage = {
  id: platformMessage.id, // Unique message ID from platform
  source: 'your-connector', // Must match connector name
  sender: platformMessage.from, // Sender identifier (phone, user ID, etc.)
  rawContent: platformMessage.body,
  content: platformMessage.body, // Cleaned content (prefix stripped by core)
  timestamp: new Date(),
  metadata: {
    // Platform-specific extras (optional)
    channelId: platformMessage.channel,
  },
};
```

---

## Step 4: Register the Connector

Add your factory to `src/connectors/index.ts`:

```typescript
import { YourConnector } from './your-connector/index.js';

export function registerBuiltInConnectors(registry: PluginRegistry): void {
  // Existing connectors...
  registry.registerConnector('your-connector', (config) => {
    return new YourConnector(config.options);
  });
}
```

---

## Step 5: Add Config Support

If your connector needs configuration, add a Zod schema in `your-connector-config.ts`:

```typescript
import { z } from 'zod';

export const YourConnectorOptionsSchema = z.object({
  apiToken: z.string().min(1),
  channelId: z.string().optional(),
});

export type YourConnectorOptions = z.infer<typeof YourConnectorOptionsSchema>;
```

Users configure it in `config.json` (V2 format):

```json
{
  "workspacePath": "/path/to/project",
  "channels": [
    {
      "type": "your-connector",
      "enabled": true,
      "options": {
        "apiToken": "xoxb-...",
        "channelId": "C012345"
      }
    }
  ],
  "auth": { "whitelist": ["+1234567890"], "prefix": "/ai" }
}
```

---

## Step 6: Write Tests

Create `tests/connectors/your-connector/your-connector.test.ts`:

```typescript
import { describe, it, expect, vi } from 'vitest';
import { YourConnector } from '../../../src/connectors/your-connector/index.js';

describe('YourConnector', () => {
  it('should implement the Connector interface', () => {
    const connector = new YourConnector({});
    expect(connector.name).toBe('your-connector');
    expect(connector.isConnected()).toBe(false);
  });

  it('should emit messages on incoming events', async () => {
    const connector = new YourConnector({});
    const handler = vi.fn();
    connector.on('message', handler);
    // Simulate incoming message...
  });
});
```

---

## Checklist

- [ ] Implements `Connector` interface fully
- [ ] Emits `'message'` events with valid `InboundMessage`
- [ ] Handles `sendMessage()` with proper platform formatting
- [ ] Cleans up resources in `shutdown()`
- [ ] Registered in `src/connectors/index.ts`
- [ ] Has unit tests
- [ ] Documented in config example
