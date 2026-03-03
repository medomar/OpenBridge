import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../../src/core/github-publisher.js', () => ({
  publishToGitHubPages: vi.fn().mockResolvedValue('https://owner.github.io/repo/report.html'),
}));

vi.mock('../../src/core/agent-runner.js', () => ({
  AgentRunner: vi.fn().mockImplementation(() => ({
    spawn: vi.fn().mockResolvedValue({ stdout: 'Fast-path answer', stderr: '', exitCode: 0 }),
    spawnWithHandle: vi.fn(),
  })),
  TOOLS_READ_ONLY: ['Read', 'Glob', 'Grep'],
  estimateCost: vi.fn().mockReturnValue({
    estimatedTurns: 10,
    costString: '~$0.30',
    timeString: '~2 min',
  }),
  DEFAULT_MAX_TURNS_TASK: 15,
}));

import { Router, classifyMessagePriority } from '../../src/core/router.js';
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
import type { ActivityRecord, MemoryManager } from '../../src/memory/index.js';
import type { ParsedSpawnMarker } from '../../src/master/spawn-parser.js';

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

  describe('status command queue depth display (OB-923)', () => {
    function createStatusMsg(): InboundMessage {
      return {
        id: 'msg-status',
        source: 'mock',
        sender: '+1234567890',
        rawContent: 'status',
        content: 'status',
        timestamp: new Date(),
      };
    }

    function createMockMemory(agents: Partial<ActivityRecord>[] = []) {
      return {
        getActiveAgents: vi.fn().mockResolvedValue(agents),
        getExplorationProgress: vi.fn().mockResolvedValue([]),
        getDailyCost: vi.fn().mockResolvedValue(0),
      };
    }

    function setupRouter() {
      const router = new Router('mock');
      const connector = new MockConnector();
      const provider = new MockProvider();
      router.addConnector(connector);
      router.addProvider(provider);
      return { router, connector };
    }

    it('should show "Queue: idle" when no messages are waiting', async () => {
      const { router, connector } = setupRouter();
      await connector.initialize();

      router.setMemory(createMockMemory() as never);
      router.setQueue({
        getQueueSnapshot: vi.fn().mockReturnValue([]),
        onUrgentEnqueued: vi.fn(),
      } as never);

      await router.route(createStatusMsg());

      expect(connector.sentMessages).toHaveLength(1);
      expect(connector.sentMessages[0]?.content).toContain('Queue: idle');
    });

    it('should show per-user queue depth when messages are waiting', async () => {
      const { router, connector } = setupRouter();
      await connector.initialize();

      router.setMemory(createMockMemory() as never);
      router.setQueue({
        getQueueSnapshot: vi
          .fn()
          .mockReturnValue([{ sender: '+1234567890', pending: 2, estimatedWaitMs: 60_000 }]),
        onUrgentEnqueued: vi.fn(),
      } as never);

      await router.route(createStatusMsg());

      expect(connector.sentMessages).toHaveLength(1);
      const content = connector.sentMessages[0]?.content ?? '';
      expect(content).toContain('Queue:');
      expect(content).toContain('2 messages waiting');
    });

    it('should show estimated wait time in seconds when under 1 minute', async () => {
      const { router, connector } = setupRouter();
      await connector.initialize();

      router.setMemory(createMockMemory() as never);
      router.setQueue({
        getQueueSnapshot: vi
          .fn()
          .mockReturnValue([{ sender: '+1234567890', pending: 1, estimatedWaitMs: 30_000 }]),
        onUrgentEnqueued: vi.fn(),
      } as never);

      await router.route(createStatusMsg());

      const content = connector.sentMessages[0]?.content ?? '';
      expect(content).toContain('~30s');
    });

    it('should show estimated wait time in minutes when >= 1 minute', async () => {
      const { router, connector } = setupRouter();
      await connector.initialize();

      router.setMemory(createMockMemory() as never);
      router.setQueue({
        getQueueSnapshot: vi
          .fn()
          .mockReturnValue([{ sender: '+1234567890', pending: 3, estimatedWaitMs: 90_000 }]),
        onUrgentEnqueued: vi.fn(),
      } as never);

      await router.route(createStatusMsg());

      const content = connector.sentMessages[0]?.content ?? '';
      expect(content).toContain('~2m');
    });

    it('should omit queue section when setQueue is not called', async () => {
      const { router, connector } = setupRouter();
      await connector.initialize();

      router.setMemory(createMockMemory() as never);
      // No setQueue call

      await router.route(createStatusMsg());

      const content = connector.sentMessages[0]?.content ?? '';
      expect(content).not.toContain('Queue:');
    });
  });

  // ---------------------------------------------------------------------------
  // OB-925: Tests for responsive Master
  // ---------------------------------------------------------------------------

  describe('classifyMessagePriority (OB-921)', () => {
    it('should classify "implement auth" as complex-task (priority 3)', () => {
      expect(classifyMessagePriority('implement auth')).toBe(3);
    });

    it('should classify "refactor the login system" as complex-task (priority 3)', () => {
      expect(classifyMessagePriority('refactor the login system')).toBe(3);
    });

    it('should classify "build a REST API" as complex-task (priority 3)', () => {
      expect(classifyMessagePriority('build a REST API')).toBe(3);
    });

    it('should classify compound action with "and" as complex-task (priority 3)', () => {
      expect(classifyMessagePriority('review code and add tests')).toBe(3);
    });

    it('should classify "architect a new service" as complex-task (priority 3)', () => {
      expect(classifyMessagePriority('architect a new service')).toBe(3);
    });

    it('should classify "fix the login bug" as tool-use (priority 2)', () => {
      expect(classifyMessagePriority('fix the login bug')).toBe(2);
    });

    it('should classify "create config.ts" as tool-use (priority 2)', () => {
      expect(classifyMessagePriority('create config.ts')).toBe(2);
    });

    it('should classify "update the README" as tool-use (priority 2)', () => {
      expect(classifyMessagePriority('update the README')).toBe(2);
    });

    it('should classify "what is the entry point?" as quick-answer (priority 1)', () => {
      expect(classifyMessagePriority('what is the entry point?')).toBe(1);
    });

    it('should classify "how does authentication work?" as quick-answer (priority 1)', () => {
      expect(classifyMessagePriority('how does authentication work?')).toBe(1);
    });

    it('should classify "status" as quick-answer (priority 1)', () => {
      expect(classifyMessagePriority('status')).toBe(1);
    });

    it('should classify "list all modules" as quick-answer (priority 1)', () => {
      expect(classifyMessagePriority('list all modules')).toBe(1);
    });

    it('should classify "explain the router" as quick-answer (priority 1)', () => {
      expect(classifyMessagePriority('explain the router')).toBe(1);
    });

    it('should default to tool-use (priority 2) for unclassified messages', () => {
      expect(classifyMessagePriority('do something with the code')).toBe(2);
    });

    it('should classify short questions ending in "?" as quick-answer (priority 1)', () => {
      // Short generic question — no keywords needed, just "?" + short length
      expect(classifyMessagePriority('Where is the config?')).toBe(1);
    });
  });

  describe('fast-path responder during Master processing (OB-925)', () => {
    function createQuickMsg(content = 'what is the entry point?'): InboundMessage {
      return {
        id: 'msg-fp',
        source: 'mock',
        sender: '+1234567890',
        rawContent: content,
        content,
        timestamp: new Date(),
      };
    }

    function createProcessingMaster(withWorkspaceMap = false) {
      const master = {
        processMessage: vi.fn().mockResolvedValue('Master response'),
        getState: vi.fn(() => 'processing' as const),
        getWorkspaceMap: vi.fn().mockResolvedValue(
          withWorkspaceMap
            ? {
                projectName: 'my-app',
                projectType: 'nodejs',
                frameworks: ['express'],
                summary: 'A Node.js API',
                commands: { dev: 'npm run dev' },
              }
            : null,
        ),
      } as unknown as MasterManager;
      return master;
    }

    it('should use fast-path when master is processing and message is quick-answer (priority 1)', async () => {
      const router = new Router('mock');
      const connector = new MockConnector();
      const master = createProcessingMaster();

      router.addConnector(connector);
      router.setMaster(master);
      router.setWorkspacePath('/tmp/test-workspace');
      await connector.initialize();

      await router.route(createQuickMsg('what is the entry point?'));

      // Master.processMessage must NOT be called — fast-path handles it
      expect((master.processMessage as ReturnType<typeof vi.fn>).mock.calls).toHaveLength(0);
    });

    it('should send fast-path response to the connector', async () => {
      const router = new Router('mock');
      const connector = new MockConnector();
      const master = createProcessingMaster();

      router.addConnector(connector);
      router.setMaster(master);
      router.setWorkspacePath('/tmp/test-workspace');
      await connector.initialize();

      await router.route(createQuickMsg('what is the entry point?'));

      expect(connector.sentMessages).toHaveLength(1);
      // Should contain the fast-path agent response (mocked AgentRunner returns "Fast-path answer")
      expect(connector.sentMessages[0]?.content).toBe('Fast-path answer');
    });

    it('should route priority-2 messages to Master even when it is processing', async () => {
      const router = new Router('mock');
      const connector = new MockConnector();
      const master = createProcessingMaster();

      router.addConnector(connector);
      router.setMaster(master);
      router.setWorkspacePath('/tmp/test-workspace');
      await connector.initialize();

      // "fix the bug" is priority 2 (tool-use), should NOT go through fast-path
      const toolUseMsg: InboundMessage = {
        id: 'msg-tool',
        source: 'mock',
        sender: '+1234567890',
        rawContent: 'fix the login bug',
        content: 'fix the login bug',
        timestamp: new Date(),
      };
      await router.route(toolUseMsg);

      // Master.processMessage IS called because priority != 1
      expect((master.processMessage as ReturnType<typeof vi.fn>).mock.calls).toHaveLength(1);
    });

    it('should route quick-answer to Master when it is ready (not processing)', async () => {
      const router = new Router('mock');
      const connector = new MockConnector();

      // Master is READY, not processing
      const master = {
        processMessage: vi.fn().mockResolvedValue('Master quick-answer'),
        getState: vi.fn(() => 'ready' as const),
        getWorkspaceMap: vi.fn().mockResolvedValue(null),
      } as unknown as MasterManager;

      router.addConnector(connector);
      router.setMaster(master);
      router.setWorkspacePath('/tmp/test-workspace');
      await connector.initialize();

      await router.route(createQuickMsg('what is the entry point?'));

      // Master.processMessage IS called because state is not 'processing'
      expect((master.processMessage as ReturnType<typeof vi.fn>).mock.calls).toHaveLength(1);
      expect(connector.sentMessages[1]?.content).toBe('Master quick-answer');
    });

    it('should send "busy" message when workspace path is not set and master is processing', async () => {
      const router = new Router('mock');
      const connector = new MockConnector();
      const master = createProcessingMaster();

      router.addConnector(connector);
      router.setMaster(master);
      // Deliberately do NOT set workspacePath
      await connector.initialize();

      await router.route(createQuickMsg('what is the entry point?'));

      // Should get a "busy" fallback (no workspacePath means fast-path can't run)
      expect(connector.sentMessages).toHaveLength(1);
      expect(connector.sentMessages[0]?.content).toContain('busy');

      // Master.processMessage must NOT be called
      expect((master.processMessage as ReturnType<typeof vi.fn>).mock.calls).toHaveLength(0);
    });

    it('should include workspace context in fast-path prompt when workspace map is available', async () => {
      const router = new Router('mock');
      const connector = new MockConnector();
      const master = createProcessingMaster(true); // pass true to return workspace map

      router.addConnector(connector);
      router.setMaster(master);
      router.setWorkspacePath('/tmp/test-workspace');
      await connector.initialize();

      await router.route(createQuickMsg('what frameworks are used?'));

      // The response goes through fast-path (master.processMessage NOT called)
      expect((master.processMessage as ReturnType<typeof vi.fn>).mock.calls).toHaveLength(0);
      // Workspace map was requested to build context
      expect((master.getWorkspaceMap as ReturnType<typeof vi.fn>).mock.calls).toHaveLength(1);
    });

    it('should send typing indicator during fast-path response', async () => {
      const router = new Router('mock');
      const connector = new MockConnector();
      const master = createProcessingMaster();

      router.addConnector(connector);
      router.setMaster(master);
      router.setWorkspacePath('/tmp/test-workspace');
      await connector.initialize();

      await router.route(createQuickMsg('what is the entry point?'));

      expect(connector.typingIndicators).toHaveLength(1);
      expect(connector.typingIndicators[0]).toBe('+1234567890');
    });
  });

  // ── Explore command handling (OB-954) ───────────────────────────────────

  describe('explore command handling (OB-954)', () => {
    function createExploreMsg(content: string, sender = '+1234567890'): InboundMessage {
      return {
        id: 'msg-explore-954',
        source: 'mock',
        sender,
        rawContent: content,
        content,
        timestamp: new Date(),
      };
    }

    function createMockMasterForExplore(state: string = 'ready') {
      return {
        processMessage: vi.fn().mockResolvedValue('Master response'),
        getState: vi.fn(() => state),
        reExplore: vi.fn().mockResolvedValue(undefined),
        fullReExplore: vi.fn().mockResolvedValue(undefined),
        getExplorationSummary: vi.fn().mockReturnValue({
          status: 'completed',
          projectType: 'node',
          frameworks: ['typescript', 'vitest'],
          directoriesExplored: 12,
          filesScanned: 150,
          startedAt: new Date().toISOString(),
          completedAt: new Date().toISOString(),
          insights: [],
          gitInitialized: true,
        }),
        getWorkerRegistry: vi.fn().mockReturnValue({
          getRunningWorkers: vi.fn().mockReturnValue([]),
          getAllWorkers: vi.fn().mockReturnValue([]),
        }),
      } as unknown as MasterManager;
    }

    it('should return "not available" when no master is set', async () => {
      const router = new Router('mock');
      const connector = new MockConnector();
      const provider = new MockProvider();
      provider.setResponse({ content: 'response' });
      router.addConnector(connector);
      router.addProvider(provider);
      await connector.initialize();

      await router.route(createExploreMsg('explore'));

      expect(connector.sentMessages).toHaveLength(1);
      expect(connector.sentMessages[0]?.content).toContain('not available');
    });

    it('should call reExplore() for bare "explore" command', async () => {
      const router = new Router('mock');
      const connector = new MockConnector();
      const master = createMockMasterForExplore('ready');

      router.addConnector(connector);
      router.setMaster(master);
      await connector.initialize();

      await router.route(createExploreMsg('explore'));

      expect(master.reExplore).toHaveBeenCalledOnce();
      expect(master.fullReExplore).not.toHaveBeenCalled();
      expect(connector.sentMessages).toHaveLength(2);
      expect(connector.sentMessages[0]?.content).toContain('quick');
      expect(connector.sentMessages[1]?.content).toContain('completed');
    });

    it('should call fullReExplore() for "explore full" command', async () => {
      const router = new Router('mock');
      const connector = new MockConnector();
      const master = createMockMasterForExplore('ready');

      router.addConnector(connector);
      router.setMaster(master);
      await connector.initialize();

      await router.route(createExploreMsg('explore full'));

      expect(master.fullReExplore).toHaveBeenCalledOnce();
      expect(master.reExplore).not.toHaveBeenCalled();
      expect(connector.sentMessages).toHaveLength(2);
      expect(connector.sentMessages[0]?.content).toContain('full');
    });

    it('should be case-insensitive for "EXPLORE FULL"', async () => {
      const router = new Router('mock');
      const connector = new MockConnector();
      const master = createMockMasterForExplore('ready');

      router.addConnector(connector);
      router.setMaster(master);
      await connector.initialize();

      await router.route(createExploreMsg('EXPLORE FULL'));

      expect(master.fullReExplore).toHaveBeenCalledOnce();
    });

    it('should return "already in progress" when Master is exploring', async () => {
      const router = new Router('mock');
      const connector = new MockConnector();
      const master = createMockMasterForExplore('exploring');

      router.addConnector(connector);
      router.setMaster(master);
      await connector.initialize();

      await router.route(createExploreMsg('explore'));

      expect(connector.sentMessages).toHaveLength(1);
      expect(connector.sentMessages[0]?.content).toContain('already in progress');
      expect(master.reExplore).not.toHaveBeenCalled();
    });

    it('should return state-blocked message when Master is processing', async () => {
      const router = new Router('mock');
      const connector = new MockConnector();
      const master = createMockMasterForExplore('processing');

      router.addConnector(connector);
      router.setMaster(master);
      await connector.initialize();

      await router.route(createExploreMsg('explore'));

      expect(connector.sentMessages).toHaveLength(1);
      expect(connector.sentMessages[0]?.content).toContain('processing');
    });

    it('should send error message when exploration fails', async () => {
      const router = new Router('mock');
      const connector = new MockConnector();
      const master = createMockMasterForExplore('ready');
      (master.reExplore as ReturnType<typeof vi.fn>).mockRejectedValue(
        new Error('Exploration timeout'),
      );

      router.addConnector(connector);
      router.setMaster(master);
      await connector.initialize();

      await router.route(createExploreMsg('explore'));

      expect(connector.sentMessages).toHaveLength(2);
      expect(connector.sentMessages[1]?.content).toContain('failed');
      expect(connector.sentMessages[1]?.content).toContain('Exploration timeout');
    });

    it('should show exploration summary for "explore status"', async () => {
      const router = new Router('mock');
      const connector = new MockConnector();
      const master = createMockMasterForExplore('ready');

      router.addConnector(connector);
      router.setMaster(master);
      await connector.initialize();

      await router.route(createExploreMsg('explore status'));

      expect(connector.sentMessages).toHaveLength(1);
      expect(connector.sentMessages[0]?.content).toContain('Exploration Status');
      expect(connector.sentMessages[0]?.content).toContain('node');
      expect(connector.sentMessages[0]?.content).toContain('typescript');
      expect(master.reExplore).not.toHaveBeenCalled();
    });

    it('should deny explore when auth denies access', async () => {
      const router = new Router('mock');
      const connector = new MockConnector();
      const master = createMockMasterForExplore('ready');
      const mockAuth = {
        checkAccessControl: vi.fn().mockReturnValue({
          allowed: false,
          reason: 'Not permitted.',
        }),
        isAuthorized: vi.fn().mockReturnValue(true),
      };

      router.addConnector(connector);
      router.setMaster(master);
      router.setAuth(mockAuth as unknown as AuthService);
      await connector.initialize();

      await router.route(createExploreMsg('explore'));

      expect(connector.sentMessages).toHaveLength(1);
      expect(connector.sentMessages[0]?.content).toContain('Not permitted');
      expect(master.reExplore).not.toHaveBeenCalled();
    });

    it('should include project info in completion message', async () => {
      const router = new Router('mock');
      const connector = new MockConnector();
      const master = createMockMasterForExplore('ready');

      router.addConnector(connector);
      router.setMaster(master);
      await connector.initialize();

      await router.route(createExploreMsg('explore'));

      const completion = connector.sentMessages[1]?.content ?? '';
      expect(completion).toContain('node');
      expect(completion).toContain('typescript');
      expect(completion).toContain('12');
    });
  });

  describe('media attachment injection (OB-1193)', () => {
    it('should append ## Attachments section when message has attachments', async () => {
      const router = new Router('mock');
      const connector = new MockConnector();
      const provider = new MockProvider();
      provider.setResponse({ content: 'done' });
      provider.streamMessage = undefined;

      router.addConnector(connector);
      router.addProvider(provider);
      await connector.initialize();

      const message: InboundMessage = {
        id: 'msg-media-1',
        source: 'mock',
        sender: '+1234567890',
        rawContent: 'analyze this image',
        content: 'analyze this image',
        timestamp: new Date(),
        attachments: [
          {
            type: 'image',
            filePath: '/tmp/.openbridge/media/photo.jpg',
            mimeType: 'image/jpeg',
            filename: 'photo.jpg',
            sizeBytes: 204800,
          },
        ],
      };

      await router.route(message);

      const content = provider.processedMessages[0]?.content ?? '';
      expect(content).toContain('## Attachments');
      expect(content).toContain('/tmp/.openbridge/media/photo.jpg');
      expect(content).toContain('image/jpeg');
      expect(content).toContain('(photo.jpg)');
      expect(content).toContain('200.0 KB');
    });

    it('should not inject ## Attachments when attachments is undefined', async () => {
      const router = new Router('mock');
      const connector = new MockConnector();
      const provider = new MockProvider();
      provider.setResponse({ content: 'done' });
      provider.streamMessage = undefined;

      router.addConnector(connector);
      router.addProvider(provider);
      await connector.initialize();

      await router.route(createMessage()); // no attachments field

      const content = provider.processedMessages[0]?.content ?? '';
      expect(content).toBe('hello');
      expect(content).not.toContain('## Attachments');
    });

    it('should not inject ## Attachments when attachments is an empty array', async () => {
      const router = new Router('mock');
      const connector = new MockConnector();
      const provider = new MockProvider();
      provider.setResponse({ content: 'done' });
      provider.streamMessage = undefined;

      router.addConnector(connector);
      router.addProvider(provider);
      await connector.initialize();

      const message: InboundMessage = {
        id: 'msg-media-2',
        source: 'mock',
        sender: '+1234567890',
        rawContent: 'hello',
        content: 'hello',
        timestamp: new Date(),
        attachments: [],
      };

      await router.route(message);

      const content = provider.processedMessages[0]?.content ?? '';
      expect(content).toBe('hello');
      expect(content).not.toContain('## Attachments');
    });

    it('should list all attachments when multiple are present', async () => {
      const router = new Router('mock');
      const connector = new MockConnector();
      const provider = new MockProvider();
      provider.setResponse({ content: 'done' });
      provider.streamMessage = undefined;

      router.addConnector(connector);
      router.addProvider(provider);
      await connector.initialize();

      const message: InboundMessage = {
        id: 'msg-media-3',
        source: 'mock',
        sender: '+1234567890',
        rawContent: 'process these files',
        content: 'process these files',
        timestamp: new Date(),
        attachments: [
          {
            type: 'image',
            filePath: '/tmp/media/img.png',
            mimeType: 'image/png',
            sizeBytes: 1024,
          },
          {
            type: 'document',
            filePath: '/tmp/media/doc.pdf',
            mimeType: 'application/pdf',
            filename: 'report.pdf',
            sizeBytes: 51200,
          },
        ],
      };

      await router.route(message);

      const content = provider.processedMessages[0]?.content ?? '';
      expect(content).toContain('## Attachments');
      expect(content).toContain('/tmp/media/img.png');
      expect(content).toContain('/tmp/media/doc.pdf');
      expect(content).toContain('(report.pdf)');
    });

    it('should omit filename parentheses when filename is not provided', async () => {
      const router = new Router('mock');
      const connector = new MockConnector();
      const provider = new MockProvider();
      provider.setResponse({ content: 'done' });
      provider.streamMessage = undefined;

      router.addConnector(connector);
      router.addProvider(provider);
      await connector.initialize();

      const message: InboundMessage = {
        id: 'msg-media-4',
        source: 'mock',
        sender: '+1234567890',
        rawContent: 'check this',
        content: 'check this',
        timestamp: new Date(),
        attachments: [
          {
            type: 'video',
            filePath: '/tmp/media/clip.mp4',
            mimeType: 'video/mp4',
            sizeBytes: 2048,
          },
        ],
      };

      await router.route(message);

      const content = provider.processedMessages[0]?.content ?? '';
      expect(content).toContain('**video**:');
      expect(content).not.toContain('**video** (');
    });
  });

  describe('spawn confirmation and audit (OB-1395)', () => {
    function createSpawnMarker(profile: string, prompt: string): ParsedSpawnMarker {
      return {
        profile,
        body: { prompt },
        rawMatch: `[SPAWN:${profile}]{"prompt":"${prompt}"}[/SPAWN]`,
      };
    }

    it('high-risk SPAWN (full-access profile) triggers confirmation prompt', async () => {
      const router = new Router('mock');
      const connector = new MockConnector();
      router.addConnector(connector);
      router.setSecurityConfig({ confirmHighRisk: true });
      await connector.initialize();

      const marker = createSpawnMarker('full-access', 'Edit all configuration files');
      const message = createMessage();

      const needsConfirmation = await router.requestSpawnConfirmation(
        message.sender,
        connector,
        [marker],
        message,
      );

      expect(needsConfirmation).toBe(true);
      expect(connector.sentMessages).toHaveLength(1);
      const content = connector.sentMessages[0]?.content ?? '';
      expect(content).toContain('Confirmation required');
      expect(content).toContain('full-access');
      expect(content).toContain('"go"');
      expect(content).toContain('"skip"');
      expect(content).toContain('~$0.30');

      // Clean up pending timeout to avoid leaking fake timers
      router.takePendingSpawnConfirmation(message.sender);
    });

    it('low-risk SPAWN (read-only profile) proceeds without confirmation', async () => {
      const router = new Router('mock');
      const connector = new MockConnector();
      router.addConnector(connector);
      router.setSecurityConfig({ confirmHighRisk: true });
      await connector.initialize();

      const marker = createSpawnMarker('read-only', 'Read source files');
      const message = createMessage();

      const needsConfirmation = await router.requestSpawnConfirmation(
        message.sender,
        connector,
        [marker],
        message,
      );

      expect(needsConfirmation).toBe(false);
      expect(connector.sentMessages).toHaveLength(0);
    });

    it('/confirm approves pending spawn and re-routes the original message', async () => {
      const router = new Router('mock');
      const connector = new MockConnector();
      const provider = new MockProvider();
      provider.setResponse({ content: 'Worker executed' });
      provider.streamMessage = undefined;

      router.addConnector(connector);
      router.addProvider(provider);
      router.setSecurityConfig({ confirmHighRisk: true });
      await connector.initialize();

      const originalMessage = createMessage(); // content: 'hello'
      const marker = createSpawnMarker('full-access', 'Task to execute');

      // Set up pending confirmation
      await router.requestSpawnConfirmation(
        originalMessage.sender,
        connector,
        [marker],
        originalMessage,
      );
      expect(connector.sentMessages).toHaveLength(1); // confirmation prompt sent

      // Send /confirm — should re-route the original message
      const confirmMessage: InboundMessage = {
        id: 'confirm-1',
        source: 'mock',
        sender: '+1234567890',
        rawContent: '/confirm',
        content: '/confirm',
        timestamp: new Date(),
      };
      await router.route(confirmMessage);

      // Provider should have received the original message content
      expect(provider.processedMessages.length).toBeGreaterThan(0);
      expect(provider.processedMessages[provider.processedMessages.length - 1]?.content).toBe(
        'hello',
      );

      // Pending entry should be cleared
      expect(router.hasPendingSpawnConfirmation('+1234567890')).toBe(false);
    });

    it('/skip cancels the pending spawn and sends cancellation notice', async () => {
      const router = new Router('mock');
      const connector = new MockConnector();
      const provider = new MockProvider();
      provider.setResponse({ content: 'fallback' });
      provider.streamMessage = undefined;
      router.addConnector(connector);
      router.addProvider(provider);
      router.setSecurityConfig({ confirmHighRisk: true });
      await connector.initialize();

      const originalMessage = createMessage();
      const marker = createSpawnMarker('full-access', 'Task to skip');

      // Set up pending confirmation
      await router.requestSpawnConfirmation(
        originalMessage.sender,
        connector,
        [marker],
        originalMessage,
      );
      expect(connector.sentMessages).toHaveLength(1); // confirmation prompt

      // Send /skip
      const skipMessage: InboundMessage = {
        id: 'skip-1',
        source: 'mock',
        sender: '+1234567890',
        rawContent: '/skip',
        content: '/skip',
        timestamp: new Date(),
      };
      await router.route(skipMessage);

      expect(connector.sentMessages).toHaveLength(2);
      expect(connector.sentMessages[1]?.content).toBe('Spawn cancelled.');
      expect(router.hasPendingSpawnConfirmation('+1234567890')).toBe(false);
    });

    it('pending spawn auto-cancels after 60 second timeout', async () => {
      const router = new Router('mock');
      const connector = new MockConnector();
      router.addConnector(connector);
      router.setSecurityConfig({ confirmHighRisk: true });
      await connector.initialize();

      const originalMessage = createMessage();
      const marker = createSpawnMarker('full-access', 'Task that times out');

      await router.requestSpawnConfirmation(
        originalMessage.sender,
        connector,
        [marker],
        originalMessage,
      );
      expect(connector.sentMessages).toHaveLength(1); // confirmation prompt
      expect(router.hasPendingSpawnConfirmation('+1234567890')).toBe(true);

      // Advance past the 60-second timeout
      await vi.advanceTimersByTimeAsync(61_000);

      // Timeout message should have been sent
      expect(connector.sentMessages).toHaveLength(2);
      expect(connector.sentMessages[1]?.content).toContain('timed out');
      expect(router.hasPendingSpawnConfirmation('+1234567890')).toBe(false);
    });

    it('estimateCost returns reasonable values for different model tiers', async () => {
      const { estimateCost: realEstimateCost } = (await vi.importActual(
        '../../src/core/agent-runner.js',
      )) as unknown as {
        estimateCost: (
          _profile: string,
          maxTurns: number,
          modelTier: string,
        ) => { estimatedTurns: number; costString: string; timeString: string };
      };

      const fastResult = realEstimateCost('read-only', 10, 'fast');
      expect(fastResult.estimatedTurns).toBe(10);
      expect(fastResult.costString).toMatch(/^~\$[\d.]+$/);
      expect(parseFloat(fastResult.costString.slice(2))).toBeGreaterThan(0);
      expect(fastResult.timeString).toMatch(/^~\d+ min$/);

      const balancedResult = realEstimateCost('full-access', 15, 'balanced');
      expect(balancedResult.estimatedTurns).toBe(15);
      expect(parseFloat(balancedResult.costString.slice(2))).toBeGreaterThan(
        parseFloat(fastResult.costString.slice(2)),
      );

      const powerfulResult = realEstimateCost('master', 5, 'powerful');
      expect(powerfulResult.estimatedTurns).toBe(5);
      expect(parseFloat(powerfulResult.costString.slice(2))).toBeGreaterThan(0);
    });

    it('/audit shows recent worker spawn history from memory', async () => {
      const router = new Router('mock');
      const connector = new MockConnector();
      const provider = new MockProvider();
      provider.setResponse({ content: 'fallback' });
      provider.streamMessage = undefined;

      const mockSpawns: ActivityRecord[] = [
        {
          id: 'worker-1234567890ab',
          type: 'worker',
          model: 'claude-3-5-sonnet',
          profile: 'read-only',
          task_summary: 'Read and analyze source files',
          status: 'done',
          started_at: '2024-01-01T10:00:00.000Z',
          updated_at: '2024-01-01T10:05:00.000Z',
          completed_at: '2024-01-01T10:05:00.000Z',
          cost_usd: 0.05,
        },
        {
          id: 'worker-0987654321cd',
          type: 'worker',
          model: 'claude-3-5-sonnet',
          profile: 'code-edit',
          task_summary: 'Edit configuration files',
          status: 'done',
          started_at: '2024-01-01T11:00:00.000Z',
          updated_at: '2024-01-01T11:10:00.000Z',
          completed_at: '2024-01-01T11:10:00.000Z',
          cost_usd: 0.12,
        },
      ];

      const mockMemory = {
        getRecentWorkerSpawns: vi.fn().mockResolvedValue(mockSpawns),
        getConsentMode: vi.fn().mockResolvedValue('always-ask'),
        searchConversations: vi.fn().mockResolvedValue([]),
        getChunks: vi.fn().mockResolvedValue([]),
      } as unknown as MemoryManager;

      router.addConnector(connector);
      router.addProvider(provider);
      router.setMemory(mockMemory);
      await connector.initialize();

      const auditMessage: InboundMessage = {
        id: 'audit-1',
        source: 'mock',
        sender: '+1234567890',
        rawContent: '/audit',
        content: '/audit',
        timestamp: new Date(),
      };
      await router.route(auditMessage);

      expect(connector.sentMessages).toHaveLength(1);
      const content = connector.sentMessages[0]?.content ?? '';
      expect(content).toContain('Worker Audit Log');
      expect(content).toContain('read-only');
      expect(content).toContain('code-edit');
    });

    it('/audit responds with empty message when no worker spawns recorded', async () => {
      const router = new Router('mock');
      const connector = new MockConnector();
      const provider = new MockProvider();
      provider.setResponse({ content: 'fallback' });
      provider.streamMessage = undefined;

      const mockMemory = {
        getRecentWorkerSpawns: vi.fn().mockResolvedValue([]),
        getConsentMode: vi.fn().mockResolvedValue('always-ask'),
        searchConversations: vi.fn().mockResolvedValue([]),
        getChunks: vi.fn().mockResolvedValue([]),
      } as unknown as MemoryManager;

      router.addConnector(connector);
      router.addProvider(provider);
      router.setMemory(mockMemory);
      await connector.initialize();

      const auditMessage: InboundMessage = {
        id: 'audit-2',
        source: 'mock',
        sender: '+1234567890',
        rawContent: '/audit',
        content: '/audit',
        timestamp: new Date(),
      };
      await router.route(auditMessage);

      expect(connector.sentMessages).toHaveLength(1);
      expect(connector.sentMessages[0]?.content).toContain('No worker spawns recorded');
    });
  });

  // ---------------------------------------------------------------------------
  // OB-1416: Deep Mode command tests
  // ---------------------------------------------------------------------------

  describe('Deep Mode commands (OB-1416)', () => {
    function createDeepMsg(content: string, sender = '+1234567890'): InboundMessage {
      return {
        id: 'msg-deep',
        source: 'mock',
        sender,
        rawContent: content,
        content,
        timestamp: new Date(),
      };
    }

    function createMockDeepModeManager(
      opts: {
        activeSessions?: string[];
        sessionState?: Record<string, unknown> | null;
        isPaused?: boolean;
        currentPhase?: string;
        startSessionResult?: string | null;
        phaseResult?: Record<string, unknown> | null;
      } = {},
    ) {
      return {
        startSession: vi.fn().mockReturnValue(opts.startSessionResult ?? 'session-1'),
        abort: vi.fn(),
        getActiveSessions: vi.fn().mockReturnValue(opts.activeSessions ?? []),
        getSessionState: vi.fn().mockReturnValue(opts.sessionState ?? null),
        isPaused: vi.fn().mockReturnValue(opts.isPaused ?? false),
        resume: vi.fn(),
        focusOnItem: vi.fn(),
        skipItem: vi.fn(),
        getPhaseResult: vi.fn().mockReturnValue(opts.phaseResult ?? null),
        getCurrentPhase: vi.fn().mockReturnValue(opts.currentPhase ?? 'investigate'),
        setTaskModelOverride: vi.fn().mockReturnValue(true),
      };
    }

    function createMockMasterWithDeepMode(deepMode: ReturnType<typeof createMockDeepModeManager>) {
      return {
        processMessage: vi.fn().mockResolvedValue('Deep investigation result'),
        getState: vi.fn(() => 'ready' as const),
        getDeepModeManager: vi.fn().mockReturnValue(deepMode),
      } as unknown as MasterManager;
    }

    it('/deep thorough activates Deep Mode and sends activation message', async () => {
      const router = new Router('mock');
      const connector = new MockConnector();
      const deepMode = createMockDeepModeManager({ activeSessions: [] });
      const master = createMockMasterWithDeepMode(deepMode);

      router.addConnector(connector);
      router.setMaster(master);
      await connector.initialize();

      await router.route(createDeepMsg('/deep thorough'));

      expect(deepMode.startSession).toHaveBeenCalledWith(
        expect.stringContaining('thorough'),
        'thorough',
      );
      expect(connector.sentMessages).toHaveLength(1);
      expect(connector.sentMessages[0]?.content).toContain('Deep Mode started');
      expect(connector.sentMessages[0]?.content).toContain('thorough');
    });

    it('/proceed resumes a paused manual session and reports the current phase', async () => {
      const router = new Router('mock');
      const connector = new MockConnector();
      const deepMode = createMockDeepModeManager({
        activeSessions: ['session-1'],
        sessionState: {
          sessionId: 'session-1',
          profile: 'manual',
          currentPhase: 'plan',
          phaseResults: {},
          startedAt: new Date().toISOString(),
          taskSummary: 'Review auth system',
          skippedItems: [],
          taskModelOverrides: {},
        },
        isPaused: true,
        currentPhase: 'plan',
      });
      const master = createMockMasterWithDeepMode(deepMode);

      router.addConnector(connector);
      router.setMaster(master);
      await connector.initialize();

      await router.route(createDeepMsg('/proceed'));

      expect(deepMode.resume).toHaveBeenCalledWith('session-1');
      expect(connector.sentMessages).toHaveLength(1);
      expect(connector.sentMessages[0]?.content).toContain('plan');
    });

    it('/focus 3 records the focus, calls Master, and sends investigation result', async () => {
      const router = new Router('mock');
      const connector = new MockConnector();
      const deepMode = createMockDeepModeManager({
        activeSessions: ['session-1'],
        sessionState: {
          sessionId: 'session-1',
          profile: 'thorough',
          currentPhase: 'investigate',
          phaseResults: {},
          startedAt: new Date().toISOString(),
          taskSummary: 'Review auth system',
          skippedItems: [],
          taskModelOverrides: {},
        },
        currentPhase: 'investigate',
      });
      const master = createMockMasterWithDeepMode(deepMode);

      router.addConnector(connector);
      router.setMaster(master);
      await connector.initialize();

      await router.route(createDeepMsg('/focus 3'));

      expect(deepMode.focusOnItem).toHaveBeenCalledWith('session-1', 3);
      // processMessage should be called once for the focused investigation
      expect(master.processMessage).toHaveBeenCalledOnce();
      // First message is the immediate confirmation; second is Master's response
      expect(connector.sentMessages[0]?.content).toContain('#3');
      expect(connector.sentMessages).toHaveLength(2);
      expect(connector.sentMessages[1]?.content).toBe('Deep investigation result');
    });

    it('/skip 2 marks the item as skipped and sends a confirmation', async () => {
      const router = new Router('mock');
      const connector = new MockConnector();
      const deepMode = createMockDeepModeManager({
        activeSessions: ['session-1'],
        sessionState: {
          sessionId: 'session-1',
          profile: 'thorough',
          currentPhase: 'plan',
          phaseResults: {},
          startedAt: new Date().toISOString(),
          taskSummary: 'Fix security issues',
          skippedItems: [],
          taskModelOverrides: {},
        },
      });
      const master = createMockMasterWithDeepMode(deepMode);

      router.addConnector(connector);
      router.setMaster(master);
      await connector.initialize();

      await router.route(createDeepMsg('/skip 2'));

      expect(deepMode.skipItem).toHaveBeenCalledWith('session-1', 2);
      expect(connector.sentMessages).toHaveLength(1);
      expect(connector.sentMessages[0]?.content).toContain('#2');
      expect(connector.sentMessages[0]?.content).toContain('skipped');
    });

    it('/phase shows current phase, completed phases, and profile', async () => {
      const router = new Router('mock');
      const connector = new MockConnector();
      const deepMode = createMockDeepModeManager({
        activeSessions: ['session-1'],
        sessionState: {
          sessionId: 'session-1',
          profile: 'thorough',
          currentPhase: 'plan',
          phaseResults: {
            investigate: {
              phase: 'investigate',
              output: 'Found 3 security issues.',
              completedAt: new Date().toISOString(),
            },
          },
          startedAt: new Date().toISOString(),
          taskSummary: 'Audit security',
          skippedItems: [],
          taskModelOverrides: {},
        },
        currentPhase: 'plan',
        phaseResult: {
          phase: 'investigate',
          output: 'Found 3 security issues.',
          completedAt: new Date().toISOString(),
        },
      });
      const master = createMockMasterWithDeepMode(deepMode);

      router.addConnector(connector);
      router.setMaster(master);
      await connector.initialize();

      await router.route(createDeepMsg('/phase'));

      expect(connector.sentMessages).toHaveLength(1);
      const content = connector.sentMessages[0]?.content ?? '';
      expect(content).toContain('Phase Status');
      expect(content).toContain('plan');
      expect(content).toContain('thorough');
    });

    it('natural language "proceed" routes to the proceed handler when a session is active', async () => {
      const router = new Router('mock');
      const connector = new MockConnector();
      const deepMode = createMockDeepModeManager({
        activeSessions: ['session-1'],
        sessionState: {
          sessionId: 'session-1',
          profile: 'manual',
          currentPhase: 'report',
          phaseResults: {},
          startedAt: new Date().toISOString(),
          taskSummary: 'Fix auth system',
          skippedItems: [],
          taskModelOverrides: {},
        },
        isPaused: true,
        currentPhase: 'report',
      });
      const master = createMockMasterWithDeepMode(deepMode);

      router.addConnector(connector);
      router.setMaster(master);
      await connector.initialize();

      // Plain "proceed" (no leading slash) should trigger the proceed handler
      await router.route(createDeepMsg('proceed'));

      expect(deepMode.resume).toHaveBeenCalledWith('session-1');
      expect(connector.sentMessages).toHaveLength(1);
      expect(connector.sentMessages[0]?.content).toContain('report');
    });

    it('/deep off aborts all active sessions and sends a deactivation message', async () => {
      const router = new Router('mock');
      const connector = new MockConnector();
      const deepMode = createMockDeepModeManager({
        activeSessions: ['session-1', 'session-2'],
      });
      const master = createMockMasterWithDeepMode(deepMode);

      router.addConnector(connector);
      router.setMaster(master);
      await connector.initialize();

      await router.route(createDeepMsg('/deep off'));

      expect(deepMode.abort).toHaveBeenCalledTimes(2);
      expect(deepMode.abort).toHaveBeenCalledWith('session-1');
      expect(deepMode.abort).toHaveBeenCalledWith('session-2');
      expect(connector.sentMessages).toHaveLength(1);
      expect(connector.sentMessages[0]?.content).toContain('deactivated');
    });
  });

  describe('/allow command — tool escalation grant (OB-1586)', () => {
    function createAllowMsg(content: string, sender = '+1234567890'): InboundMessage {
      return {
        id: 'allow-1',
        source: 'mock',
        sender,
        rawContent: content,
        content,
        timestamp: new Date(),
      };
    }

    it('/allow with no pending escalation responds with "No pending tool escalation."', async () => {
      const router = new Router('mock');
      const connector = new MockConnector();
      const provider = new MockProvider();
      provider.streamMessage = undefined;
      router.addConnector(connector);
      router.addProvider(provider);
      await connector.initialize();

      await router.route(createAllowMsg('/allow Bash(npm:test)'));

      expect(connector.sentMessages).toHaveLength(1);
      expect(connector.sentMessages[0]?.content).toBe('No pending tool escalation.');
    });

    it('/allow <tool> grants single tool with default scope "once"', async () => {
      const router = new Router('mock');
      const connector = new MockConnector();
      const provider = new MockProvider();
      provider.streamMessage = undefined;
      router.addConnector(connector);
      router.addProvider(provider);
      await connector.initialize();

      const originalMessage = createAllowMsg('do something', '+1234567890');
      await router.requestToolEscalation(
        'worker-abc',
        ['Bash(npm:test)'],
        'read-only',
        'Need to run tests',
        originalMessage,
        connector,
      );
      expect(connector.sentMessages).toHaveLength(1); // escalation prompt

      await router.route(createAllowMsg('/allow Bash(npm:test)'));

      expect(connector.sentMessages).toHaveLength(2);
      const reply = connector.sentMessages[1]?.content ?? '';
      expect(reply).toContain('Granted');
      expect(reply).toContain('Bash(npm:test)');
      expect(reply).toContain('worker-abc');
      expect(reply).toContain('this request');
      expect(router.hasPendingEscalation('+1234567890')).toBe(false);
    });

    it('/allow <profile> recognises a built-in profile name', async () => {
      const router = new Router('mock');
      const connector = new MockConnector();
      const provider = new MockProvider();
      provider.streamMessage = undefined;
      router.addConnector(connector);
      router.addProvider(provider);
      await connector.initialize();

      const originalMessage = createAllowMsg('do something', '+1234567890');
      await router.requestToolEscalation(
        'worker-xyz',
        ['Bash'],
        'read-only',
        'Need to edit files',
        originalMessage,
        connector,
      );

      await router.route(createAllowMsg('/allow code-edit'));

      const reply = connector.sentMessages[1]?.content ?? '';
      expect(reply).toContain('profile upgrade to');
      expect(reply).toContain('code-edit');
      expect(reply).toContain('this request');
    });

    it('/allow <tool> --session grants with session scope', async () => {
      const router = new Router('mock');
      const connector = new MockConnector();
      const provider = new MockProvider();
      provider.streamMessage = undefined;
      router.addConnector(connector);
      router.addProvider(provider);
      await connector.initialize();

      const originalMessage = createAllowMsg('do something', '+1234567890');
      await router.requestToolEscalation(
        'worker-1',
        ['Write'],
        'read-only',
        'Need write access',
        originalMessage,
        connector,
      );

      await router.route(createAllowMsg('/allow Write --session'));

      const reply = connector.sentMessages[1]?.content ?? '';
      expect(reply).toContain('Granted');
      expect(reply).toContain('this session');
    });

    it('/allow <profile> --permanent grants with permanent scope', async () => {
      const router = new Router('mock');
      const connector = new MockConnector();
      const provider = new MockProvider();
      provider.streamMessage = undefined;
      router.addConnector(connector);
      router.addProvider(provider);
      await connector.initialize();

      const originalMessage = createAllowMsg('do something', '+1234567890');
      await router.requestToolEscalation(
        'worker-2',
        ['Bash'],
        'read-only',
        'Need full access',
        originalMessage,
        connector,
      );

      await router.route(createAllowMsg('/allow full-access --permanent'));

      const reply = connector.sentMessages[1]?.content ?? '';
      expect(reply).toContain('profile upgrade to');
      expect(reply).toContain('full-access');
      expect(reply).toContain('permanently');
    });

    it('/allow clears the pending escalation so no duplicate grant is possible', async () => {
      const router = new Router('mock');
      const connector = new MockConnector();
      const provider = new MockProvider();
      provider.streamMessage = undefined;
      router.addConnector(connector);
      router.addProvider(provider);
      await connector.initialize();

      const originalMessage = createAllowMsg('do something', '+1234567890');
      await router.requestToolEscalation(
        'worker-3',
        ['Bash(npm:test)'],
        'read-only',
        'Need to run tests',
        originalMessage,
        connector,
      );

      // First /allow consumes the pending escalation
      await router.route(createAllowMsg('/allow Bash(npm:test)'));
      expect(router.hasPendingEscalation('+1234567890')).toBe(false);

      // Second /allow with nothing pending — should get the "no pending" message
      await router.route(createAllowMsg('/allow Bash(npm:test)'));
      const lastMsg = connector.sentMessages[connector.sentMessages.length - 1];
      expect(lastMsg?.content).toBe('No pending tool escalation.');
    });
  });
});
