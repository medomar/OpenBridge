import { describe, it, expect } from 'vitest';
import { Router } from '../../src/core/router.js';
import { MockConnector } from '../helpers/mock-connector.js';
import { MockProvider } from '../helpers/mock-provider.js';
import type { InboundMessage } from '../../src/types/message.js';

function createMessage(): InboundMessage {
  return {
    id: 'msg-1',
    source: 'mock',
    sender: '+1234567890',
    rawContent: '/ai hello',
    content: 'hello',
    timestamp: new Date(),
  };
}

describe('Router', () => {
  it('should route a message to the default provider and send response back', async () => {
    const router = new Router('mock');
    const connector = new MockConnector();
    const provider = new MockProvider();
    provider.setResponse({ content: 'AI response' });

    router.addConnector(connector);
    router.addProvider(provider);

    await connector.initialize();
    await router.route(createMessage());

    expect(provider.processedMessages).toHaveLength(1);
    expect(provider.processedMessages[0]?.content).toBe('hello');

    // Should have sent 2 messages: ack + response
    expect(connector.sentMessages).toHaveLength(2);
    expect(connector.sentMessages[0]?.content).toBe('Working on it...');
    expect(connector.sentMessages[1]?.content).toBe('AI response');
  });

  it('should use streamMessage when the provider supports it', async () => {
    const router = new Router('mock');
    const connector = new MockConnector();
    const provider = new MockProvider();
    provider.setStreamChunks(['chunk1', 'chunk2']);
    provider.setResponse({ content: 'chunk1chunk2' });

    router.addConnector(connector);
    router.addProvider(provider);

    await connector.initialize();
    await router.route(createMessage());

    // Should have sent 2 messages: ack + final assembled response
    expect(connector.sentMessages).toHaveLength(2);
    expect(connector.sentMessages[0]?.content).toBe('Working on it...');
    expect(connector.sentMessages[1]?.content).toBe('chunk1chunk2');
  });
});
