import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../../src/core/github-publisher.js', () => ({
  publishToGitHubPages: vi.fn().mockResolvedValue('https://owner.github.io/repo/report.html'),
}));
import { Router } from '../../src/core/router.js';
import { AgentOrchestrator } from '../../src/core/agent-orchestrator.js';
import { MockConnector } from '../helpers/mock-connector.js';
import { MockProvider } from '../helpers/mock-provider.js';
import { ProviderError } from '../../src/providers/claude-code/provider-error.js';
import type { InboundMessage } from '../../src/types/message.js';
import type { MasterManager } from '../../src/master/master-manager.js';
import type { AuthService } from '../../src/core/auth.js';
import { mkdtemp, writeFile, mkdir } from 'node:fs/promises';
import { publishToGitHubPages } from '../../src/core/github-publisher.js';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

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

  it('should not send cycling progress messages (only ack + response)', async () => {
    const router = new Router('mock');
    const connector = new MockConnector();
    const provider = new MockProvider();

    // Create a provider that takes a long time (controlled by promise)
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

    // Advance time well past where old cycling timer would fire
    await vi.advanceTimersByTimeAsync(60_000);

    // Only the initial ack — no cycling messages
    expect(connector.sentMessages).toHaveLength(1);
    expect(connector.sentMessages[0]?.content).toBe('Working on it...');

    // Resolve the provider and complete routing
    resolveProcess({ content: 'Done!' });
    await routePromise;

    // ack + final response only
    expect(connector.sentMessages).toHaveLength(2);
    expect(connector.sentMessages[1]?.content).toBe('Done!');
  });

  it('should send only ack + response even for fast tasks', async () => {
    const router = new Router('mock');
    const connector = new MockConnector();
    const provider = new MockProvider();
    provider.setResponse({ content: 'Quick response' });
    provider.streamMessage = undefined;

    router.addConnector(connector);
    router.addProvider(provider);
    await connector.initialize();

    await router.route(createMessage());

    // ack + response only
    expect(connector.sentMessages).toHaveLength(2);
    expect(connector.sentMessages[0]?.content).toBe('Working on it...');
    expect(connector.sentMessages[1]?.content).toBe('Quick response');
  });

  it('should send only ack + error on provider failure (no cycling)', async () => {
    const router = new Router('mock');
    const connector = new MockConnector();
    const provider = new MockProvider();

    provider.processMessage = vi
      .fn()
      .mockRejectedValue(new ProviderError('Provider failed', 'permanent', 1));
    provider.streamMessage = undefined;

    router.addConnector(connector);
    router.addProvider(provider);
    await connector.initialize();

    await expect(router.route(createMessage())).rejects.toThrow('Provider failed');

    // ack + error message only — no cycling messages
    expect(connector.sentMessages).toHaveLength(2);
    expect(connector.sentMessages[0]?.content).toBe('Working on it...');
    expect(connector.sentMessages[1]?.content).toContain('Request failed');
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

  describe('sendProgress (OB-513)', () => {
    it('should call connector sendProgress when connector supports it', async () => {
      const router = new Router('mock');
      const connector = new MockConnector();
      router.addConnector(connector);
      await connector.initialize();

      await router.sendProgress('mock', '+1234567890', { type: 'classifying' });

      expect(connector.progressEvents).toHaveLength(1);
      expect(connector.progressEvents[0]?.event).toEqual({ type: 'classifying' });
      expect(connector.progressEvents[0]?.chatId).toBe('+1234567890');
    });

    it('should pass the full event payload to the connector', async () => {
      const router = new Router('mock');
      const connector = new MockConnector();
      router.addConnector(connector);
      await connector.initialize();

      await router.sendProgress('mock', '+1234567890', {
        type: 'spawning',
        workerCount: 3,
      });

      expect(connector.progressEvents[0]?.event).toEqual({ type: 'spawning', workerCount: 3 });
    });

    it('should be a no-op when connector is not found', async () => {
      const router = new Router('mock');
      // No connector added
      await expect(
        router.sendProgress('unknown', '+1234567890', { type: 'classifying' }),
      ).resolves.toBeUndefined();
    });
  });

  describe('defaultProvider getter (OB-635)', () => {
    it('should return the configured default provider name', () => {
      const router = new Router('claude');
      expect(router.defaultProvider).toBe('claude');
    });
  });

  describe('route() — connector not found (OB-635)', () => {
    it('should return early without throwing when source connector is not registered', async () => {
      const router = new Router('mock');
      const provider = new MockProvider();
      router.addProvider(provider);
      // No connector added for source 'unknown'

      const message: InboundMessage = {
        id: 'msg-1',
        source: 'unknown',
        sender: '+1234567890',
        rawContent: '/ai hello',
        content: 'hello',
        timestamp: new Date(),
      };

      // Should resolve without throwing (early return after logging error)
      await expect(router.route(message)).resolves.toBeUndefined();

      // Provider was NOT called because routing short-circuited
      expect(provider.processedMessages).toHaveLength(0);
    });
  });

  describe('ProviderError handling (OB-635)', () => {
    it('should send a user-friendly error message and rethrow for permanent ProviderError', async () => {
      const router = new Router('mock');
      const connector = new MockConnector();
      const provider = new MockProvider();

      provider.processMessage = vi
        .fn()
        .mockRejectedValue(new ProviderError('auth failed', 'permanent', 1));
      provider.streamMessage = undefined;

      router.addConnector(connector);
      router.addProvider(provider);
      await connector.initialize();

      await expect(router.route(createMessage())).rejects.toThrow('auth failed');

      // Should have sent ack + error message
      expect(connector.sentMessages).toHaveLength(2);
      expect(connector.sentMessages[0]?.content).toBe('Working on it...');
      expect(connector.sentMessages[1]?.content).toContain('Request failed');
    });

    it('should send a timeout message for ProviderError with exit code 124', async () => {
      const router = new Router('mock');
      const connector = new MockConnector();
      const provider = new MockProvider();

      provider.processMessage = vi
        .fn()
        .mockRejectedValue(new ProviderError('timed out', 'transient', 124));
      provider.streamMessage = undefined;

      router.addConnector(connector);
      router.addProvider(provider);
      await connector.initialize();

      await expect(router.route(createMessage())).rejects.toThrow('timed out');

      expect(connector.sentMessages).toHaveLength(2);
      expect(connector.sentMessages[1]?.content).toContain('timed out');
    });

    it('should send a transient error message for transient ProviderError', async () => {
      const router = new Router('mock');
      const connector = new MockConnector();
      const provider = new MockProvider();

      provider.processMessage = vi
        .fn()
        .mockRejectedValue(new ProviderError('rate limit exceeded', 'transient', 429));
      provider.streamMessage = undefined;

      router.addConnector(connector);
      router.addProvider(provider);
      await connector.initialize();

      await expect(router.route(createMessage())).rejects.toThrow('rate limit exceeded');

      expect(connector.sentMessages).toHaveLength(2);
      expect(connector.sentMessages[1]?.content).toContain('temporarily unavailable');
    });
  });

  describe('SHARE marker processing (OB-611)', () => {
    let workspaceDir: string;
    let generatedDir: string;

    beforeEach(async () => {
      workspaceDir = await mkdtemp(join(tmpdir(), 'openbridge-share-test-'));
      generatedDir = join(workspaceDir, '.openbridge', 'generated');
      await mkdir(generatedDir, { recursive: true });
    });

    it('should send a file as media attachment and strip the SHARE marker', async () => {
      const router = new Router('mock');
      const connector = new MockConnector();
      const provider = new MockProvider();
      provider.setResponse({ content: '[SHARE:mock]report.html[/SHARE]' });
      provider.streamMessage = undefined;

      await writeFile(join(generatedDir, 'report.html'), '<h1>Report</h1>');
      router.setWorkspacePath(workspaceDir);
      router.addConnector(connector);
      router.addProvider(provider);
      await connector.initialize();

      await router.route(createMessage());

      // ack + media message + final response (empty after strip)
      const mediaMsgs = connector.sentMessages.filter((m) => m.media !== undefined);
      expect(mediaMsgs).toHaveLength(1);
      expect(mediaMsgs[0]?.media?.filename).toBe('report.html');
      expect(mediaMsgs[0]?.media?.mimeType).toBe('text/html');
      expect(mediaMsgs[0]?.media?.type).toBe('document');
      expect(mediaMsgs[0]?.media?.data).toEqual(Buffer.from('<h1>Report</h1>'));
    });

    it('should strip marker from final response text', async () => {
      const router = new Router('mock');
      const connector = new MockConnector();
      const provider = new MockProvider();
      provider.setResponse({ content: 'Here is your file: [SHARE:mock]report.pdf[/SHARE]' });
      provider.streamMessage = undefined;

      await writeFile(join(generatedDir, 'report.pdf'), '%PDF-1.4');
      router.setWorkspacePath(workspaceDir);
      router.addConnector(connector);
      router.addProvider(provider);
      await connector.initialize();

      await router.route(createMessage());

      const textMsgs = connector.sentMessages.filter((m) => m.media === undefined);
      const finalReply = textMsgs[textMsgs.length - 1];
      expect(finalReply?.content).toBe('Here is your file:');
    });

    it('should block files outside .openbridge/generated/ (path traversal)', async () => {
      const router = new Router('mock');
      const connector = new MockConnector();
      const provider = new MockProvider();
      provider.setResponse({
        content: '[SHARE:mock]../../etc/passwd[/SHARE]',
      });
      provider.streamMessage = undefined;

      router.setWorkspacePath(workspaceDir);
      router.addConnector(connector);
      router.addProvider(provider);
      await connector.initialize();

      await router.route(createMessage());

      // No media should be sent for the blocked path
      const mediaMsgs = connector.sentMessages.filter((m) => m.media !== undefined);
      expect(mediaMsgs).toHaveLength(0);
    });

    it('should skip SHARE marker gracefully when file does not exist', async () => {
      const router = new Router('mock');
      const connector = new MockConnector();
      const provider = new MockProvider();
      provider.setResponse({ content: 'Result: [SHARE:mock]missing.txt[/SHARE]' });
      provider.streamMessage = undefined;

      router.setWorkspacePath(workspaceDir);
      router.addConnector(connector);
      router.addProvider(provider);
      await connector.initialize();

      // Should not throw
      await router.route(createMessage());

      const mediaMsgs = connector.sentMessages.filter((m) => m.media !== undefined);
      expect(mediaMsgs).toHaveLength(0);
    });

    it('should do nothing when workspacePath is not set', async () => {
      const router = new Router('mock');
      const connector = new MockConnector();
      const provider = new MockProvider();
      provider.setResponse({ content: '[SHARE:mock]report.html[/SHARE] Done' });
      provider.streamMessage = undefined;

      // workspacePath NOT set — marker is kept in output (passthrough)
      router.addConnector(connector);
      router.addProvider(provider);
      await connector.initialize();

      await router.route(createMessage());

      const mediaMsgs = connector.sentMessages.filter((m) => m.media !== undefined);
      expect(mediaMsgs).toHaveLength(0);
    });

    it('should detect MIME type and media type by extension', async () => {
      const files: Array<{ name: string; content: Buffer; mimeType: string; mediaType: string }> = [
        {
          name: 'data.csv',
          content: Buffer.from('a,b'),
          mimeType: 'text/csv',
          mediaType: 'document',
        },
        {
          name: 'photo.png',
          content: Buffer.from('\x89PNG'),
          mimeType: 'image/png',
          mediaType: 'image',
        },
        {
          name: 'clip.mp4',
          content: Buffer.from('\x00\x00'),
          mimeType: 'video/mp4',
          mediaType: 'video',
        },
      ];

      for (const file of files) {
        const router = new Router('mock');
        const connector = new MockConnector();
        const provider = new MockProvider();
        provider.setResponse({ content: `[SHARE:mock]${file.name}[/SHARE]` });
        provider.streamMessage = undefined;

        await writeFile(join(generatedDir, file.name), file.content);
        router.setWorkspacePath(workspaceDir);
        router.addConnector(connector);
        router.addProvider(provider);
        await connector.initialize();

        await router.route(createMessage());

        const mediaMsgs = connector.sentMessages.filter((m) => m.media !== undefined);
        expect(mediaMsgs[0]?.media?.mimeType).toBe(file.mimeType);
        expect(mediaMsgs[0]?.media?.type).toBe(file.mediaType);
      }
    });
  });

  describe('stop all confirmation flow (OB-879)', () => {
    function createStopMessage(content: string): InboundMessage {
      return {
        id: 'msg-stop',
        source: 'mock',
        sender: '+1234567890',
        rawContent: content,
        content,
        timestamp: new Date(),
      };
    }

    function createMockMasterWithWorkers(runningCount: number) {
      const runningWorkers = Array.from({ length: runningCount }, (_, i) => ({
        id: `worker-${i + 1}`,
        status: 'running' as const,
        pid: 1000 + i,
        model: 'claude-sonnet',
        profile: 'code-edit',
        task_summary: `Task ${i + 1}`,
        started_at: new Date().toISOString(),
      }));

      const mockKillAllWorkers = vi.fn().mockResolvedValue({
        stopped: runningWorkers.map((w) => w.id),
        message: `Stopped ${runningCount} worker${runningCount !== 1 ? 's' : ''}.`,
      });

      const mockKillWorker = vi.fn().mockResolvedValue({
        success: true,
        message: 'Stopped worker worker-1.',
      });

      const mockGetWorkerRegistry = vi.fn().mockReturnValue({
        getRunningWorkers: vi.fn().mockReturnValue(runningWorkers),
        getAllWorkers: vi.fn().mockReturnValue(runningWorkers),
      });

      const master = {
        processMessage: vi.fn().mockResolvedValue('Master response'),
        getState: vi.fn(() => 'ready' as const),
        killAllWorkers: mockKillAllWorkers,
        killWorker: mockKillWorker,
        getWorkerRegistry: mockGetWorkerRegistry,
      } as unknown as MasterManager;

      return { master, mockKillAllWorkers, mockKillWorker, mockGetWorkerRegistry };
    }

    it('should ask for confirmation when "stop all" is sent with running workers', async () => {
      const router = new Router('mock');
      const connector = new MockConnector();
      const { master, mockKillAllWorkers } = createMockMasterWithWorkers(3);

      router.addConnector(connector);
      router.setMaster(master);
      await connector.initialize();

      await router.route(createStopMessage('stop all'));

      // Should NOT have killed workers yet
      expect(mockKillAllWorkers).not.toHaveBeenCalled();

      // Should have sent a confirmation prompt
      expect(connector.sentMessages).toHaveLength(1);
      expect(connector.sentMessages[0]?.content).toContain('3 running workers');
      expect(connector.sentMessages[0]?.content).toContain("Reply 'confirm'");
      expect(connector.sentMessages[0]?.content).toContain('30 seconds');
    });

    it('should ask for confirmation when bare "stop" is sent with running workers', async () => {
      const router = new Router('mock');
      const connector = new MockConnector();
      const { master, mockKillAllWorkers } = createMockMasterWithWorkers(1);

      router.addConnector(connector);
      router.setMaster(master);
      await connector.initialize();

      await router.route(createStopMessage('stop'));

      expect(mockKillAllWorkers).not.toHaveBeenCalled();
      expect(connector.sentMessages[0]?.content).toContain('1 running worker');
      expect(connector.sentMessages[0]?.content).toContain("Reply 'confirm'");
    });

    it('should reply "No workers are currently running" when stop all with 0 workers', async () => {
      const router = new Router('mock');
      const connector = new MockConnector();
      const { master, mockKillAllWorkers } = createMockMasterWithWorkers(0);

      router.addConnector(connector);
      router.setMaster(master);
      await connector.initialize();

      await router.route(createStopMessage('stop all'));

      expect(mockKillAllWorkers).not.toHaveBeenCalled();
      expect(connector.sentMessages[0]?.content).toBe('No workers are currently running.');
    });

    it('should execute kill when "confirm" is received within the timeout', async () => {
      const router = new Router('mock');
      const connector = new MockConnector();
      const { master, mockKillAllWorkers } = createMockMasterWithWorkers(2);

      router.addConnector(connector);
      router.setMaster(master);
      await connector.initialize();

      // Step 1: send "stop all"
      await router.route(createStopMessage('stop all'));
      expect(mockKillAllWorkers).not.toHaveBeenCalled();
      expect(connector.sentMessages[0]?.content).toContain("Reply 'confirm'");

      // Step 2: send "confirm" within 30 seconds
      await router.route(createStopMessage('confirm'));

      expect(mockKillAllWorkers).toHaveBeenCalledOnce();
      expect(connector.sentMessages[1]?.content).toContain('Stopped 2 workers');
    });

    it('should execute kill when "CONFIRM" (case-insensitive) is received', async () => {
      const router = new Router('mock');
      const connector = new MockConnector();
      const { master, mockKillAllWorkers } = createMockMasterWithWorkers(1);

      router.addConnector(connector);
      router.setMaster(master);
      await connector.initialize();

      await router.route(createStopMessage('stop all'));
      await router.route(createStopMessage('CONFIRM'));

      expect(mockKillAllWorkers).toHaveBeenCalledOnce();
    });

    it('should report confirmation expired after 30 seconds', async () => {
      const router = new Router('mock');
      const connector = new MockConnector();
      const { master, mockKillAllWorkers } = createMockMasterWithWorkers(2);

      router.addConnector(connector);
      router.setMaster(master);
      await connector.initialize();

      // Step 1: send "stop all"
      await router.route(createStopMessage('stop all'));

      // Advance time past the 30-second timeout
      await vi.advanceTimersByTimeAsync(31_000);

      // Step 2: send "confirm" after timeout
      await router.route(createStopMessage('confirm'));

      expect(mockKillAllWorkers).not.toHaveBeenCalled();
      expect(connector.sentMessages[1]?.content).toContain('Confirmation expired');
      expect(connector.sentMessages[1]?.content).toContain("'stop all'");
    });

    it('should only honour the confirmation once (one-shot)', async () => {
      const router = new Router('mock');
      const connector = new MockConnector();
      const { master, mockKillAllWorkers } = createMockMasterWithWorkers(2);

      router.addConnector(connector);
      router.setMaster(master);
      await connector.initialize();

      await router.route(createStopMessage('stop all'));
      // First confirm → executes kill
      await router.route(createStopMessage('confirm'));
      expect(mockKillAllWorkers).toHaveBeenCalledOnce();

      // Second "confirm" → no pending confirmation, routes to Master
      await router.route(createStopMessage('confirm'));
      // Master's processMessage is called (not killAllWorkers a second time)
      expect(mockKillAllWorkers).toHaveBeenCalledOnce();
    });

    it('should not intercept "confirm" when there is no pending confirmation', async () => {
      const router = new Router('mock');
      const connector = new MockConnector();
      const mockProcessMessage = vi.fn().mockResolvedValue('Master confirm response');
      const master = {
        processMessage: mockProcessMessage,
        getState: vi.fn(() => 'ready' as const),
        killAllWorkers: vi.fn(),
        killWorker: vi.fn(),
        getWorkerRegistry: vi.fn().mockReturnValue({
          getRunningWorkers: vi.fn().mockReturnValue([]),
          getAllWorkers: vi.fn().mockReturnValue([]),
        }),
      } as unknown as MasterManager;

      router.addConnector(connector);
      router.setMaster(master);
      await connector.initialize();

      // "confirm" with no pending stop — should fall through to Master
      await router.route(createStopMessage('confirm'));

      expect(mockProcessMessage).toHaveBeenCalledOnce();
      // ack + master response (not a confirmation prompt)
      expect(connector.sentMessages).toHaveLength(2);
      expect(connector.sentMessages[0]?.content).toBe('Working on it...');
    });

    it('should execute single-worker stop immediately without confirmation', async () => {
      const router = new Router('mock');
      const connector = new MockConnector();
      const { master, mockKillWorker } = createMockMasterWithWorkers(1);

      router.addConnector(connector);
      router.setMaster(master);
      await connector.initialize();

      await router.route(createStopMessage('stop worker-1'));

      // Single-worker stop should execute immediately
      expect(mockKillWorker).toHaveBeenCalledOnce();
      expect(connector.sentMessages[0]?.content).toContain('Stopped worker');
    });
  });

  describe('stop command handling (OB-881)', () => {
    function createStopMsg(content: string, sender = '+1234567890'): InboundMessage {
      return {
        id: 'msg-stop-881',
        source: 'mock',
        sender,
        rawContent: content,
        content,
        timestamp: new Date(),
      };
    }

    function createMockMasterWithNamedWorkers(
      workers: Array<{ id: string; status?: 'running' | 'done' }>,
    ) {
      const runningWorkers = workers
        .filter((w) => (w.status ?? 'running') === 'running')
        .map((w) => ({
          id: w.id,
          status: 'running' as const,
          pid: 9000,
          model: 'claude-sonnet',
          profile: 'code-edit',
          task_summary: 'Fix auth bug',
          started_at: new Date(Date.now() - 45_000).toISOString(),
        }));

      const allWorkers = workers.map((w) => ({
        id: w.id,
        status: w.status ?? 'running',
        pid: 9000,
        model: 'claude-sonnet',
        profile: 'code-edit',
        task_summary: 'Fix auth bug',
        started_at: new Date(Date.now() - 45_000).toISOString(),
      }));

      const mockKillWorker = vi.fn().mockImplementation((id: string) =>
        Promise.resolve({
          success: true,
          message: `Stopped worker ${id} (sonnet, 'Fix auth bug', 45s)`,
        }),
      );

      const mockKillAllWorkers = vi.fn().mockResolvedValue({
        stopped: runningWorkers.map((w) => w.id),
        message: `Stopped ${runningWorkers.length} worker${runningWorkers.length !== 1 ? 's' : ''}.`,
      });

      const master = {
        processMessage: vi.fn().mockResolvedValue('Master response'),
        getState: vi.fn(() => 'ready' as const),
        killWorker: mockKillWorker,
        killAllWorkers: mockKillAllWorkers,
        getWorkerRegistry: vi.fn().mockReturnValue({
          getRunningWorkers: vi.fn().mockReturnValue(runningWorkers),
          getAllWorkers: vi.fn().mockReturnValue(allWorkers),
        }),
      } as unknown as MasterManager;

      return { master, mockKillWorker, mockKillAllWorkers };
    }

    // ── Access control ────────────────────────────────────────────────────────

    it('should return permission-denied when auth denies stop action', async () => {
      const router = new Router('mock');
      const connector = new MockConnector();
      const { master } = createMockMasterWithNamedWorkers([{ id: 'worker-abc123' }]);

      const mockAuth = {
        checkAccessControl: vi.fn().mockReturnValue({
          allowed: false,
          reason: 'That action is not permitted for your role.',
        }),
        isAuthorized: vi.fn().mockReturnValue(true),
      };

      router.addConnector(connector);
      router.setMaster(master);
      router.setAuth(mockAuth as unknown as AuthService);
      await connector.initialize();

      await router.route(createStopMsg('stop worker-abc123'));

      expect(connector.sentMessages).toHaveLength(1);
      expect(connector.sentMessages[0]?.content).toContain('not permitted');
    });

    it('should use default denial message when auth denies without a reason', async () => {
      const router = new Router('mock');
      const connector = new MockConnector();
      const { master } = createMockMasterWithNamedWorkers([{ id: 'worker-abc123' }]);

      const mockAuth = {
        checkAccessControl: vi.fn().mockReturnValue({ allowed: false }),
        isAuthorized: vi.fn().mockReturnValue(true),
      };

      router.addConnector(connector);
      router.setMaster(master);
      router.setAuth(mockAuth as unknown as AuthService);
      await connector.initialize();

      await router.route(createStopMsg('stop all'));

      expect(connector.sentMessages).toHaveLength(1);
      expect(connector.sentMessages[0]?.content).toContain('permission');
    });

    it('should allow stop when auth grants access', async () => {
      const router = new Router('mock');
      const connector = new MockConnector();
      const { master, mockKillWorker } = createMockMasterWithNamedWorkers([
        { id: 'worker-abc123' },
      ]);

      const mockAuth = {
        checkAccessControl: vi.fn().mockReturnValue({ allowed: true }),
        isAuthorized: vi.fn().mockReturnValue(true),
      };

      router.addConnector(connector);
      router.setMaster(master);
      router.setAuth(mockAuth as unknown as AuthService);
      await connector.initialize();

      await router.route(createStopMsg('stop worker-abc123'));

      expect(mockKillWorker).toHaveBeenCalledOnce();
    });

    it('should allow stop when no auth service is configured', async () => {
      const router = new Router('mock');
      const connector = new MockConnector();
      const { master, mockKillWorker } = createMockMasterWithNamedWorkers([
        { id: 'worker-abc123' },
      ]);

      // No auth set
      router.addConnector(connector);
      router.setMaster(master);
      await connector.initialize();

      await router.route(createStopMsg('stop worker-abc123'));

      expect(mockKillWorker).toHaveBeenCalledOnce();
    });

    // ── No master ─────────────────────────────────────────────────────────────

    it('should return "Stop command not available" when no master is set', async () => {
      const router = new Router('mock');
      const connector = new MockConnector();
      const provider = new MockProvider();
      provider.setResponse({ content: 'response' });

      router.addConnector(connector);
      router.addProvider(provider);
      await connector.initialize();

      await router.route(createStopMsg('stop worker-123'));

      expect(connector.sentMessages).toHaveLength(1);
      expect(connector.sentMessages[0]?.content).toContain('not available');
    });

    it('should return "Stop command not available" for "stop all" when no master', async () => {
      const router = new Router('mock');
      const connector = new MockConnector();
      const provider = new MockProvider();
      provider.setResponse({ content: 'response' });

      router.addConnector(connector);
      router.addProvider(provider);
      await connector.initialize();

      await router.route(createStopMsg('stop all'));

      expect(connector.sentMessages).toHaveLength(1);
      expect(connector.sentMessages[0]?.content).toContain('not available');
    });

    // ── Case-insensitive interception ─────────────────────────────────────────

    it('should intercept "STOP ALL" (uppercase) without routing to Master', async () => {
      const router = new Router('mock');
      const connector = new MockConnector();
      const { master, mockKillAllWorkers } = createMockMasterWithNamedWorkers([{ id: 'worker-1' }]);

      router.addConnector(connector);
      router.setMaster(master);
      await connector.initialize();

      await router.route(createStopMsg('STOP ALL'));

      // Master processMessage should NOT be called
      expect((master.processMessage as ReturnType<typeof vi.fn>).mock.calls).toHaveLength(0);
      // Should have gotten a confirmation prompt (not routed to master)
      expect(connector.sentMessages).toHaveLength(1);
      expect(connector.sentMessages[0]?.content).toContain("Reply 'confirm'");
      expect(mockKillAllWorkers).not.toHaveBeenCalled();
    });

    it('should intercept "Stop" (mixed case) without routing to Master', async () => {
      const router = new Router('mock');
      const connector = new MockConnector();
      const { master } = createMockMasterWithNamedWorkers([{ id: 'worker-1' }]);

      router.addConnector(connector);
      router.setMaster(master);
      await connector.initialize();

      await router.route(createStopMsg('Stop'));

      expect((master.processMessage as ReturnType<typeof vi.fn>).mock.calls).toHaveLength(0);
      expect(connector.sentMessages).toHaveLength(1);
    });

    // ── Partial ID matching ───────────────────────────────────────────────────

    it('should match worker by suffix (stop w8f3 → worker-1708123456789-w8f3)', async () => {
      const router = new Router('mock');
      const connector = new MockConnector();
      const workerId = 'worker-1708123456789-w8f3';
      const { master, mockKillWorker } = createMockMasterWithNamedWorkers([{ id: workerId }]);

      router.addConnector(connector);
      router.setMaster(master);
      await connector.initialize();

      await router.route(createStopMsg('stop w8f3'));

      expect(mockKillWorker).toHaveBeenCalledOnce();
      expect(mockKillWorker).toHaveBeenCalledWith(workerId, '+1234567890');
    });

    it('should match worker by exact ID', async () => {
      const router = new Router('mock');
      const connector = new MockConnector();
      const workerId = 'worker-1708123456789-w8f3';
      const { master, mockKillWorker } = createMockMasterWithNamedWorkers([{ id: workerId }]);

      router.addConnector(connector);
      router.setMaster(master);
      await connector.initialize();

      await router.route(createStopMsg(`stop ${workerId}`));

      expect(mockKillWorker).toHaveBeenCalledOnce();
      expect(mockKillWorker).toHaveBeenCalledWith(workerId, '+1234567890');
    });

    it('should match worker by substring', async () => {
      const router = new Router('mock');
      const connector = new MockConnector();
      const workerId = 'worker-1708123456789-abc';
      const { master, mockKillWorker } = createMockMasterWithNamedWorkers([{ id: workerId }]);

      router.addConnector(connector);
      router.setMaster(master);
      await connector.initialize();

      // "1708123456789" is a substring of the full ID
      await router.route(createStopMsg('stop 1708123456789'));

      expect(mockKillWorker).toHaveBeenCalledOnce();
      expect(mockKillWorker).toHaveBeenCalledWith(workerId, '+1234567890');
    });

    it('should return "Worker not found" when partial ID has no match', async () => {
      const router = new Router('mock');
      const connector = new MockConnector();
      const { master, mockKillWorker } = createMockMasterWithNamedWorkers([
        { id: 'worker-1708123456789-abc' },
      ]);

      router.addConnector(connector);
      router.setMaster(master);
      await connector.initialize();

      await router.route(createStopMsg('stop zzzzz'));

      expect(mockKillWorker).not.toHaveBeenCalled();
      expect(connector.sentMessages).toHaveLength(1);
      expect(connector.sentMessages[0]?.content).toContain("'zzzzz' not found");
      expect(connector.sentMessages[0]?.content).toContain('status');
    });

    // ── Response formatting ───────────────────────────────────────────────────

    it('should include worker details in single-stop response', async () => {
      const router = new Router('mock');
      const connector = new MockConnector();
      const { master } = createMockMasterWithNamedWorkers([{ id: 'worker-abc123' }]);

      router.addConnector(connector);
      router.setMaster(master);
      await connector.initialize();

      await router.route(createStopMsg('stop worker-abc123'));

      expect(connector.sentMessages[0]?.content).toContain('Stopped worker');
      expect(connector.sentMessages[0]?.content).toContain('worker-abc123');
    });

    it('should pass replyTo from the original message', async () => {
      const router = new Router('mock');
      const connector = new MockConnector();
      const { master } = createMockMasterWithNamedWorkers([{ id: 'worker-abc123' }]);

      router.addConnector(connector);
      router.setMaster(master);
      await connector.initialize();

      const msg = createStopMsg('stop worker-abc123');
      msg.id = 'original-msg-id';
      await router.route(msg);

      expect(connector.sentMessages[0]?.replyTo).toBe('original-msg-id');
    });
  });

  describe('SHARE:github-pages marker processing (OB-613)', () => {
    let workspaceDir: string;
    let generatedDir: string;

    beforeEach(async () => {
      workspaceDir = await mkdtemp(join(tmpdir(), 'openbridge-ghpages-test-'));
      generatedDir = join(workspaceDir, '.openbridge', 'generated');
      await mkdir(generatedDir, { recursive: true });
      vi.mocked(publishToGitHubPages).mockClear();
    });

    it('should call publishToGitHubPages and strip the marker from the response', async () => {
      const router = new Router('mock');
      const connector = new MockConnector();
      const provider = new MockProvider();
      provider.setResponse({ content: '[SHARE:github-pages]report.html[/SHARE]' });
      provider.streamMessage = undefined;

      await writeFile(join(generatedDir, 'report.html'), '<h1>Report</h1>');
      router.setWorkspacePath(workspaceDir);
      router.addConnector(connector);
      router.addProvider(provider);
      await connector.initialize();

      await router.route(createMessage());

      expect(publishToGitHubPages).toHaveBeenCalledOnce();
      const calledPath = vi.mocked(publishToGitHubPages).mock.calls[0]?.[0] ?? '';
      expect(calledPath).toContain('report.html');

      // Marker must be stripped from the final response text
      const textMsgs = connector.sentMessages.filter((m) => m.media === undefined);
      const finalReply = textMsgs[textMsgs.length - 1];
      expect(finalReply?.content).toBe('');
    });

    it('should strip marker from a response that has surrounding text', async () => {
      const router = new Router('mock');
      const connector = new MockConnector();
      const provider = new MockProvider();
      provider.setResponse({
        content: 'Published![SHARE:github-pages]page.html[/SHARE] Done.',
      });
      provider.streamMessage = undefined;

      await writeFile(join(generatedDir, 'page.html'), '<h1>Page</h1>');
      router.setWorkspacePath(workspaceDir);
      router.addConnector(connector);
      router.addProvider(provider);
      await connector.initialize();

      await router.route(createMessage());

      const textMsgs = connector.sentMessages.filter((m) => m.media === undefined);
      const finalReply = textMsgs[textMsgs.length - 1];
      expect(finalReply?.content).toBe('Published! Done.');
    });

    it('should block path traversal attempts for github-pages markers', async () => {
      const router = new Router('mock');
      const connector = new MockConnector();
      const provider = new MockProvider();
      provider.setResponse({ content: '[SHARE:github-pages]../../etc/passwd[/SHARE]' });
      provider.streamMessage = undefined;

      router.setWorkspacePath(workspaceDir);
      router.addConnector(connector);
      router.addProvider(provider);
      await connector.initialize();

      await router.route(createMessage());

      // publishToGitHubPages must NOT be called for path-traversal attempts
      expect(publishToGitHubPages).not.toHaveBeenCalled();
    });

    it('should handle publishToGitHubPages failure gracefully', async () => {
      vi.mocked(publishToGitHubPages).mockRejectedValueOnce(new Error('git push failed'));

      const router = new Router('mock');
      const connector = new MockConnector();
      const provider = new MockProvider();
      provider.setResponse({ content: '[SHARE:github-pages]report.html[/SHARE]' });
      provider.streamMessage = undefined;

      await writeFile(join(generatedDir, 'report.html'), '<h1>Report</h1>');
      router.setWorkspacePath(workspaceDir);
      router.addConnector(connector);
      router.addProvider(provider);
      await connector.initialize();

      // Should not throw — errors are caught and logged
      await expect(router.route(createMessage())).resolves.not.toThrow();

      // Marker is still stripped even on failure
      const textMsgs = connector.sentMessages.filter((m) => m.media === undefined);
      const finalReply = textMsgs[textMsgs.length - 1];
      expect(finalReply?.content).toBe('');
    });
  });
});
