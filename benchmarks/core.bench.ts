import { bench, describe, vi } from 'vitest';

// Silence all pino loggers during benchmarks
vi.mock('../src/core/logger.js', () => ({
  createLogger: () => ({
    info: () => {},
    warn: () => {},
    error: () => {},
    debug: () => {},
    trace: () => {},
    fatal: () => {},
  }),
}));

import { MessageQueue } from '../src/core/queue.js';
import { AuthService } from '../src/core/auth.js';
import { Router } from '../src/core/router.js';
import { PluginRegistry } from '../src/core/registry.js';
import type { InboundMessage, OutboundMessage } from '../src/types/message.js';
import type { Connector } from '../src/types/connector.js';
import type { AIProvider, ProviderResult } from '../src/types/provider.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

let msgCounter = 0;
function createMessage(sender = '+1234567890'): InboundMessage {
  msgCounter++;
  return {
    id: `bench-${msgCounter}`,
    source: 'test',
    sender,
    rawContent: `/ai benchmark test ${msgCounter}`,
    content: `benchmark test ${msgCounter}`,
    timestamp: new Date(),
  };
}

function createMockConnector(name = 'test'): Connector {
  return {
    name,
    initialize: async () => {},
    sendMessage: async (_msg: OutboundMessage) => {},
    sendTypingIndicator: async (_chatId: string) => {},
    on: () => {},
    shutdown: async () => {},
    isConnected: () => true,
  };
}

function createMockProvider(name = 'test-provider'): AIProvider {
  return {
    name,
    initialize: async () => {},
    processMessage: async (_msg: InboundMessage): Promise<ProviderResult> => ({
      content: 'benchmark response',
    }),
    isAvailable: async () => true,
    shutdown: async () => {},
  };
}

// ---------------------------------------------------------------------------
// AuthService benchmarks
// ---------------------------------------------------------------------------

describe('AuthService', () => {
  const auth = new AuthService({
    whitelist: Array.from({ length: 100 }, (_, i) => `+1${String(i).padStart(10, '0')}`),
    prefix: '/ai',
    rateLimit: { enabled: false, maxMessages: 10, windowMs: 60_000 },
    commandFilter: {
      allowPatterns: ['.*'],
      denyPatterns: ['rm\\s+-rf', 'sudo', 'DROP\\s+TABLE'],
      denyMessage: 'Blocked.',
    },
  });

  bench('isAuthorized — whitelisted sender', () => {
    auth.isAuthorized('+10000000050');
  });

  bench('isAuthorized — unknown sender', () => {
    auth.isAuthorized('+9999999999');
  });

  bench('hasPrefix — matching prefix', () => {
    auth.hasPrefix('/ai what files are here?');
  });

  bench('hasPrefix — no prefix', () => {
    auth.hasPrefix('just a regular message');
  });

  bench('stripPrefix', () => {
    auth.stripPrefix('/ai build the project');
  });

  bench('filterCommand — allowed', () => {
    auth.filterCommand('list all files in src/');
  });

  bench('filterCommand — denied by pattern', () => {
    auth.filterCommand('sudo rm -rf /');
  });
});

// ---------------------------------------------------------------------------
// MessageQueue benchmarks
// ---------------------------------------------------------------------------

describe('MessageQueue', () => {
  bench('enqueue + process — single message', async () => {
    const queue = new MessageQueue({ maxRetries: 0, retryDelayMs: 0 });
    queue.onMessage(async () => {});
    await queue.enqueue(createMessage());
    await queue.drain();
  });

  bench('enqueue — 10 messages, same sender', async () => {
    const queue = new MessageQueue({ maxRetries: 0, retryDelayMs: 0 });
    queue.onMessage(async () => {});
    const sender = '+1bench000000';
    for (let i = 0; i < 10; i++) {
      await queue.enqueue(createMessage(sender));
    }
    await queue.drain();
  });

  bench('enqueue — 10 messages, different senders', async () => {
    const queue = new MessageQueue({ maxRetries: 0, retryDelayMs: 0 });
    queue.onMessage(async () => {});
    for (let i = 0; i < 10; i++) {
      await queue.enqueue(createMessage(`+1bench${String(i).padStart(6, '0')}`));
    }
    await queue.drain();
  });

  bench('queue size check', () => {
    const queue = new MessageQueue();
    void queue.size;
    void queue.isProcessing;
  });
});

// ---------------------------------------------------------------------------
// Router benchmarks
// ---------------------------------------------------------------------------

describe('Router', () => {
  bench('route — single message', async () => {
    const router = new Router('test-provider', { progressIntervalMs: 60_000 });
    router.addConnector(createMockConnector());
    router.addProvider(createMockProvider());
    await router.route(createMessage());
  });

  bench('addConnector + addProvider', () => {
    const router = new Router('bench');
    router.addConnector(createMockConnector('c1'));
    router.addProvider(createMockProvider('p1'));
  });

  bench('connector/provider lookup via route (map lookup)', async () => {
    const router = new Router('test-provider', { progressIntervalMs: 60_000 });
    // Register 10 connectors and providers to stress the Map lookup
    for (let i = 0; i < 10; i++) {
      router.addConnector(createMockConnector(`connector-${i}`));
      router.addProvider(createMockProvider(`provider-${i}`));
    }
    router.addConnector(createMockConnector('test'));
    router.addProvider(createMockProvider('test-provider'));
    await router.route(createMessage());
  });
});

// ---------------------------------------------------------------------------
// PluginRegistry benchmarks
// ---------------------------------------------------------------------------

describe('PluginRegistry', () => {
  bench('registerConnector + createConnector', () => {
    const registry = new PluginRegistry();
    registry.registerConnector('bench-type', () => createMockConnector());
    registry.createConnector('bench-type', {});
  });

  bench('registerProvider + createProvider', () => {
    const registry = new PluginRegistry();
    registry.registerProvider('bench-type', () => createMockProvider());
    registry.createProvider('bench-type', {});
  });

  bench('registry with 20 plugins — factory lookup', () => {
    const registry = new PluginRegistry();
    for (let i = 0; i < 20; i++) {
      registry.registerConnector(`conn-${i}`, () => createMockConnector(`conn-${i}`));
      registry.registerProvider(`prov-${i}`, () => createMockProvider(`prov-${i}`));
    }
    // Look up the last-registered ones
    registry.createConnector('conn-19', {});
    registry.createProvider('prov-19', {});
  });

  bench('availableConnectors + availableProviders', () => {
    const registry = new PluginRegistry();
    for (let i = 0; i < 10; i++) {
      registry.registerConnector(`conn-${i}`, () => createMockConnector());
      registry.registerProvider(`prov-${i}`, () => createMockProvider());
    }
    void registry.availableConnectors;
    void registry.availableProviders;
  });
});
