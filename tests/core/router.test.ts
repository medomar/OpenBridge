import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Router } from '../../src/core/router.js';
import { AgentOrchestrator } from '../../src/core/agent-orchestrator.js';
import { MockConnector } from '../helpers/mock-connector.js';
import { MockProvider } from '../helpers/mock-provider.js';
import type { InboundMessage } from '../../src/types/message.js';
import type { MasterManager } from '../../src/master/master-manager.js';

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
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

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

  it('should send typing indicator before processing', async () => {
    const router = new Router('mock');
    const connector = new MockConnector();
    const provider = new MockProvider();
    provider.setResponse({ content: 'AI response' });

    router.addConnector(connector);
    router.addProvider(provider);

    await connector.initialize();
    await router.route(createMessage());

    expect(connector.typingIndicators).toHaveLength(1);
    expect(connector.typingIndicators[0]).toBe('+1234567890');
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

  it('should send progress updates for long-running tasks', async () => {
    const router = new Router('mock', { progressIntervalMs: 10_000 });
    const connector = new MockConnector();
    const provider = new MockProvider();

    // Create a provider that takes a long time (controlled by promise)
    let resolveProcess!: (result: { content: string }) => void;
    provider.processMessage = (_message: InboundMessage) => {
      return new Promise((resolve) => {
        resolveProcess = resolve;
      });
    };
    // Disable streaming to force processMessage path
    provider.streamMessage = undefined;

    router.addConnector(connector);
    router.addProvider(provider);
    await connector.initialize();

    const routePromise = router.route(createMessage());

    // After initial ack, advance time past the progress interval
    await vi.advanceTimersByTimeAsync(10_000);

    // Should have sent ack + 1 progress update
    expect(connector.sentMessages).toHaveLength(2);
    expect(connector.sentMessages[0]?.content).toBe('Working on it...');
    expect(connector.sentMessages[1]?.content).toBe('Still working on it...');

    // Advance again — second progress update with different message
    await vi.advanceTimersByTimeAsync(10_000);
    expect(connector.sentMessages).toHaveLength(3);
    expect(connector.sentMessages[2]?.content).toBe('This is taking a moment \u2014 hang tight...');

    // Resolve the provider and complete routing
    resolveProcess({ content: 'Done!' });
    await routePromise;

    // Final response sent
    expect(connector.sentMessages).toHaveLength(4);
    expect(connector.sentMessages[3]?.content).toBe('Done!');
  });

  it('should stop progress updates after provider completes', async () => {
    const router = new Router('mock', { progressIntervalMs: 5_000 });
    const connector = new MockConnector();
    const provider = new MockProvider();
    provider.setResponse({ content: 'Quick response' });
    // Disable streaming
    provider.streamMessage = undefined;

    router.addConnector(connector);
    router.addProvider(provider);
    await connector.initialize();

    await router.route(createMessage());

    // ack + response only (no progress because it was fast)
    expect(connector.sentMessages).toHaveLength(2);

    // Advance time — no more progress updates should be sent
    await vi.advanceTimersByTimeAsync(15_000);
    expect(connector.sentMessages).toHaveLength(2);
  });

  it('should stop progress updates on provider error', async () => {
    const router = new Router('mock', { progressIntervalMs: 5_000 });
    const connector = new MockConnector();
    const provider = new MockProvider();

    let rejectProcess!: (error: Error) => void;
    provider.processMessage = (_message: InboundMessage) => {
      return new Promise((_resolve, reject) => {
        rejectProcess = reject;
      });
    };
    provider.streamMessage = undefined;

    router.addConnector(connector);
    router.addProvider(provider);
    await connector.initialize();

    const routePromise = router.route(createMessage());

    await vi.advanceTimersByTimeAsync(5_000);
    // ack + 1 progress update
    expect(connector.sentMessages).toHaveLength(2);

    rejectProcess(new Error('Provider failed'));
    await expect(routePromise).rejects.toThrow('Provider failed');

    // Advance more — no further progress updates
    await vi.advanceTimersByTimeAsync(15_000);
    expect(connector.sentMessages).toHaveLength(2);
  });

  it('should refresh typing indicator on each progress tick', async () => {
    const router = new Router('mock', { progressIntervalMs: 10_000 });
    const connector = new MockConnector();
    const provider = new MockProvider();

    let resolveProcess!: (result: { content: string }) => void;
    provider.processMessage = (_message: InboundMessage) => {
      return new Promise((resolve) => {
        resolveProcess = resolve;
      });
    };
    provider.streamMessage = undefined;

    router.addConnector(connector);
    router.addProvider(provider);
    await connector.initialize();

    const routePromise = router.route(createMessage());
    // Flush microtask queue so route() proceeds past the awaited ack + typing indicator
    await vi.advanceTimersByTimeAsync(0);

    // Initial typing indicator
    expect(connector.typingIndicators).toHaveLength(1);

    await vi.advanceTimersByTimeAsync(10_000);
    // Progress tick refreshes typing indicator
    expect(connector.typingIndicators).toHaveLength(2);

    resolveProcess({ content: 'Done' });
    await routePromise;
  });

  describe('with Agent Orchestrator', () => {
    it('should route through orchestrator when set', async () => {
      const router = new Router('mock');
      const connector = new MockConnector();
      const provider = new MockProvider();
      provider.setResponse({ content: 'Orchestrated response' });
      // Disable streaming so orchestrator uses processMessage
      provider.streamMessage = undefined;

      const orchestrator = new AgentOrchestrator('mock');
      orchestrator.addProvider(provider);

      router.addConnector(connector);
      router.setOrchestrator(orchestrator);

      await connector.initialize();
      await router.route(createMessage());

      // Provider was called through the orchestrator
      expect(provider.processedMessages).toHaveLength(1);
      expect(provider.processedMessages[0]?.content).toBe('hello');

      // ack + response
      expect(connector.sentMessages).toHaveLength(2);
      expect(connector.sentMessages[0]?.content).toBe('Working on it...');
      expect(connector.sentMessages[1]?.content).toBe('Orchestrated response');
    });

    it('should still send typing indicator when using orchestrator', async () => {
      const router = new Router('mock');
      const connector = new MockConnector();
      const provider = new MockProvider();
      provider.setResponse({ content: 'response' });
      provider.streamMessage = undefined;

      const orchestrator = new AgentOrchestrator('mock');
      orchestrator.addProvider(provider);

      router.addConnector(connector);
      router.setOrchestrator(orchestrator);

      await connector.initialize();
      await router.route(createMessage());

      expect(connector.typingIndicators).toHaveLength(1);
    });

    it('should propagate orchestrator errors', async () => {
      const router = new Router('mock');
      const connector = new MockConnector();

      // Create orchestrator without registering the provider — this will cause an error
      const orchestrator = new AgentOrchestrator('nonexistent');

      router.addConnector(connector);
      router.setOrchestrator(orchestrator);

      await connector.initialize();
      await expect(router.route(createMessage())).rejects.toThrow(
        'Provider "nonexistent" not registered with orchestrator',
      );
    });

    it('should not require direct providers when orchestrator is set', async () => {
      const router = new Router('mock');
      const connector = new MockConnector();
      const provider = new MockProvider();
      provider.setResponse({ content: 'via orchestrator' });
      provider.streamMessage = undefined;

      const orchestrator = new AgentOrchestrator('mock');
      orchestrator.addProvider(provider);

      // Only register connector and orchestrator — no direct addProvider call
      router.addConnector(connector);
      router.setOrchestrator(orchestrator);

      await connector.initialize();
      await router.route(createMessage());

      expect(connector.sentMessages).toHaveLength(2);
      expect(connector.sentMessages[1]?.content).toBe('via orchestrator');
    });
  });

  describe('with Master AI', () => {
    function createMockMaster() {
      const mockProcessMessage = vi.fn(async (message: InboundMessage) => {
        return `Master AI response to: ${message.content}`;
      });
      const mockGetState = vi.fn(() => 'ready' as const);

      const master = {
        processMessage: mockProcessMessage,
        getState: mockGetState,
      } as unknown as MasterManager;

      return { master, mockProcessMessage, mockGetState };
    }

    it('should route through Master when set', async () => {
      const router = new Router('mock');
      const connector = new MockConnector();
      const { master, mockProcessMessage } = createMockMaster();

      router.addConnector(connector);
      router.setMaster(master);

      await connector.initialize();
      await router.route(createMessage());

      // Master processMessage was called
      expect(mockProcessMessage).toHaveBeenCalledTimes(1);
      expect(mockProcessMessage).toHaveBeenCalledWith(
        expect.objectContaining({ content: 'hello' }),
      );

      // ack + response
      expect(connector.sentMessages).toHaveLength(2);
      expect(connector.sentMessages[0]?.content).toBe('Working on it...');
      expect(connector.sentMessages[1]?.content).toBe('Master AI response to: hello');
    });

    it('should prioritize Master over orchestrator', async () => {
      const router = new Router('mock');
      const connector = new MockConnector();
      const provider = new MockProvider();
      provider.setResponse({ content: 'Provider response' });
      provider.streamMessage = undefined;

      const orchestrator = new AgentOrchestrator('mock');
      orchestrator.addProvider(provider);

      const { master, mockProcessMessage } = createMockMaster();

      router.addConnector(connector);
      router.setOrchestrator(orchestrator);
      router.setMaster(master);

      await connector.initialize();
      await router.route(createMessage());

      // Master was called, not orchestrator/provider
      expect(mockProcessMessage).toHaveBeenCalledTimes(1);
      expect(provider.processedMessages).toHaveLength(0);

      expect(connector.sentMessages[1]?.content).toBe('Master AI response to: hello');
    });

    it('should prioritize Master over direct provider', async () => {
      const router = new Router('mock');
      const connector = new MockConnector();
      const provider = new MockProvider();
      provider.setResponse({ content: 'Provider response' });

      const { master, mockProcessMessage } = createMockMaster();

      router.addConnector(connector);
      router.addProvider(provider);
      router.setMaster(master);

      await connector.initialize();
      await router.route(createMessage());

      // Master was called, not provider
      expect(mockProcessMessage).toHaveBeenCalledTimes(1);
      expect(provider.processedMessages).toHaveLength(0);

      expect(connector.sentMessages[1]?.content).toBe('Master AI response to: hello');
    });

    it('should send typing indicator when using Master', async () => {
      const router = new Router('mock');
      const connector = new MockConnector();
      const { master } = createMockMaster();

      router.addConnector(connector);
      router.setMaster(master);

      await connector.initialize();
      await router.route(createMessage());

      expect(connector.typingIndicators).toHaveLength(1);
      expect(connector.typingIndicators[0]).toBe('+1234567890');
    });

    it('should not require provider when Master is set', async () => {
      const router = new Router('mock');
      const connector = new MockConnector();
      const { master } = createMockMaster();

      // Only register connector and master — no provider
      router.addConnector(connector);
      router.setMaster(master);

      await connector.initialize();
      await router.route(createMessage());

      expect(connector.sentMessages).toHaveLength(2);
      expect(connector.sentMessages[1]?.content).toBe('Master AI response to: hello');
    });

    it('should handle Master errors gracefully', async () => {
      const router = new Router('mock');
      const connector = new MockConnector();

      // Create master with error-throwing processMessage
      const mockProcessMessage = vi.fn().mockRejectedValueOnce(new Error('Master AI failed'));
      const master = {
        processMessage: mockProcessMessage,
        getState: vi.fn(() => 'ready' as const),
      } as unknown as MasterManager;

      router.addConnector(connector);
      router.setMaster(master);

      await connector.initialize();
      await expect(router.route(createMessage())).rejects.toThrow('Master AI failed');
    });
  });
});
