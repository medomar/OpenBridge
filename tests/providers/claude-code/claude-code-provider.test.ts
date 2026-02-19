import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ClaudeCodeProvider } from '../../../src/providers/claude-code/claude-code-provider.js';
import { ProviderError } from '../../../src/providers/claude-code/provider-error.js';
import type { InboundMessage } from '../../../src/types/message.js';

// ---------------------------------------------------------------------------
// Mock fs/promises so initialize() doesn't check real filesystem
// ---------------------------------------------------------------------------

const mockAccess = vi.fn<() => Promise<void>>().mockResolvedValue(undefined);

vi.mock('node:fs/promises', () => ({
  access: (...args: unknown[]) => mockAccess(...args),
}));

// ---------------------------------------------------------------------------
// Mock executeClaudeCode so tests never invoke the real CLI
// ---------------------------------------------------------------------------

const mockExecute = vi.fn();
const mockStream = vi.fn();

vi.mock('../../../src/providers/claude-code/claude-code-executor.js', () => ({
  executeClaudeCode: (...args: unknown[]): Promise<unknown> =>
    mockExecute(...args) as Promise<unknown>,
  sanitizePrompt: (s: string) => s,
  streamClaudeCode: (...args: unknown[]) =>
    mockStream(...args) as AsyncGenerator<string, { exitCode: number; stderr: string }>,
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createMessage(content = 'what files exist?'): InboundMessage {
  return {
    id: 'msg-1',
    source: 'whatsapp',
    sender: '+1234567890',
    rawContent: `/ai ${content}`,
    content,
    timestamp: new Date(),
  };
}

function createMockStream(
  chunks: string[],
  result: { exitCode: number; stderr: string },
): AsyncGenerator<string, { exitCode: number; stderr: string }> {
  async function* gen() {
    for (const chunk of chunks) {
      yield chunk;
    }
    return result;
  }
  return gen();
}

// ---------------------------------------------------------------------------
// ClaudeCodeProvider
// ---------------------------------------------------------------------------

describe('ClaudeCodeProvider', () => {
  let provider: ClaudeCodeProvider;

  beforeEach(() => {
    vi.clearAllMocks();
    provider = new ClaudeCodeProvider({ workspacePath: '/tmp/workspace' });
  });

  it('has name "claude-code"', () => {
    expect(provider.name).toBe('claude-code');
  });

  it('initialize() resolves when workspacePath exists', async () => {
    mockAccess.mockResolvedValue(undefined);
    await expect(provider.initialize()).resolves.toBeUndefined();
  });

  it('initialize() throws when workspacePath does not exist', async () => {
    mockAccess.mockRejectedValue(new Error('ENOENT'));
    await expect(provider.initialize()).rejects.toThrow('workspacePath does not exist');
  });

  it('shutdown() resolves without error', async () => {
    await expect(provider.shutdown()).resolves.toBeUndefined();
  });

  // -----------------------------------------------------------------------
  // processMessage()
  // -----------------------------------------------------------------------

  describe('processMessage()', () => {
    it('returns stdout as content on success', async () => {
      mockExecute.mockResolvedValue({ stdout: 'file list here', stderr: '', exitCode: 0 });

      const result = await provider.processMessage(createMessage());

      expect(result.content).toBe('file list here');
    });

    it('throws ProviderError when exit code is non-zero', async () => {
      mockExecute.mockResolvedValue({ stdout: '   ', stderr: 'some error output', exitCode: 1 });

      await expect(provider.processMessage(createMessage())).rejects.toThrow(ProviderError);
    });

    it('ProviderError includes stderr as message', async () => {
      mockExecute.mockResolvedValue({ stdout: '', stderr: 'some error output', exitCode: 1 });

      await expect(provider.processMessage(createMessage())).rejects.toThrow('some error output');
    });

    it('classifies timeout errors as transient', async () => {
      mockExecute.mockResolvedValue({ stdout: '', stderr: 'Request timeout', exitCode: 1 });

      try {
        await provider.processMessage(createMessage());
        expect.fail('should have thrown');
      } catch (error) {
        expect(error).toBeInstanceOf(ProviderError);
        expect((error as ProviderError).kind).toBe('transient');
      }
    });

    it('classifies auth errors as permanent', async () => {
      mockExecute.mockResolvedValue({ stdout: '', stderr: 'invalid api key', exitCode: 1 });

      try {
        await provider.processMessage(createMessage());
        expect.fail('should have thrown');
      } catch (error) {
        expect(error).toBeInstanceOf(ProviderError);
        expect((error as ProviderError).kind).toBe('permanent');
      }
    });

    it('returns default message when both stdout and stderr are empty', async () => {
      mockExecute.mockResolvedValue({ stdout: '', stderr: '', exitCode: 0 });

      const result = await provider.processMessage(createMessage());

      expect(result.content).toBe('No output from Claude Code.');
    });

    it('passes message content to executeClaudeCode with session options', async () => {
      mockExecute.mockResolvedValue({ stdout: 'ok', stderr: '', exitCode: 0 });

      await provider.processMessage(createMessage('list all files'));

      expect(mockExecute).toHaveBeenCalledWith(
        expect.objectContaining({
          prompt: 'list all files',
          workspacePath: '/tmp/workspace',
          timeout: expect.any(Number) as unknown,
          sessionId: expect.any(String) as unknown,
        }),
      );
    });

    it('includes durationMs in metadata', async () => {
      mockExecute.mockResolvedValue({ stdout: 'done', stderr: '', exitCode: 0 });

      const result = await provider.processMessage(createMessage());

      expect(result.metadata?.durationMs).toBeGreaterThanOrEqual(0);
    });

    it('includes exitCode in metadata', async () => {
      mockExecute.mockResolvedValue({ stdout: 'ok', stderr: '', exitCode: 0 });

      const result = await provider.processMessage(createMessage());

      expect(result.metadata?.exitCode).toBe(0);
    });

    it('trims whitespace from stdout', async () => {
      mockExecute.mockResolvedValue({ stdout: '  trimmed output  ', stderr: '', exitCode: 0 });

      const result = await provider.processMessage(createMessage());

      expect(result.content).toBe('trimmed output');
    });

    it('includes sessionId in metadata', async () => {
      mockExecute.mockResolvedValue({ stdout: 'ok', stderr: '', exitCode: 0 });

      const result = await provider.processMessage(createMessage());

      expect(result.metadata?.sessionId).toEqual(expect.any(String));
    });

    it('uses sessionId for first message from a sender', async () => {
      mockExecute.mockResolvedValue({ stdout: 'ok', stderr: '', exitCode: 0 });

      await provider.processMessage(createMessage());

      const opts = mockExecute.mock.calls[0][0] as Record<string, unknown>;
      expect(opts.sessionId).toEqual(expect.any(String));
      expect(opts.resumeSessionId).toBeUndefined();
    });

    it('uses resumeSessionId for subsequent messages from the same sender', async () => {
      mockExecute.mockResolvedValue({ stdout: 'ok', stderr: '', exitCode: 0 });

      await provider.processMessage(createMessage('first'));
      const firstOpts = mockExecute.mock.calls[0][0] as Record<string, unknown>;
      const firstSessionId = firstOpts.sessionId;

      await provider.processMessage(createMessage('second'));
      const secondOpts = mockExecute.mock.calls[1][0] as Record<string, unknown>;

      expect(secondOpts.resumeSessionId).toBe(firstSessionId);
      expect(secondOpts.sessionId).toBeUndefined();
    });

    it('uses separate sessions for different senders', async () => {
      mockExecute.mockResolvedValue({ stdout: 'ok', stderr: '', exitCode: 0 });

      const aliceMsg = createMessage('hello');
      aliceMsg.sender = '+1111111111';

      const bobMsg = createMessage('hi');
      bobMsg.sender = '+2222222222';

      await provider.processMessage(aliceMsg);
      await provider.processMessage(bobMsg);

      const aliceOpts = mockExecute.mock.calls[0][0] as Record<string, unknown>;
      const bobOpts = mockExecute.mock.calls[1][0] as Record<string, unknown>;

      expect(aliceOpts.sessionId).not.toBe(bobOpts.sessionId);
    });
  });

  // -----------------------------------------------------------------------
  // streamMessage()
  // -----------------------------------------------------------------------

  describe('streamMessage()', () => {
    it('yields chunks from streamClaudeCode', async () => {
      mockStream.mockReturnValue(
        createMockStream(['Hello ', 'world!'], { exitCode: 0, stderr: '' }),
      );

      const stream = provider.streamMessage(createMessage());
      const chunks: string[] = [];
      let result: IteratorResult<string, unknown>;

      do {
        result = await stream.next();
        if (!result.done) chunks.push(result.value);
      } while (!result.done);

      expect(chunks).toEqual(['Hello ', 'world!']);
    });

    it('returns ProviderResult with assembled content', async () => {
      mockStream.mockReturnValue(
        createMockStream(['Hello ', 'world!'], { exitCode: 0, stderr: '' }),
      );

      const stream = provider.streamMessage(createMessage());
      let result: IteratorResult<string, unknown>;

      do {
        result = await stream.next();
      } while (!result.done);

      const providerResult = result.value as { content: string; metadata: Record<string, unknown> };
      expect(providerResult.content).toBe('Hello world!');
      expect(providerResult.metadata.exitCode).toBe(0);
      expect(providerResult.metadata.durationMs).toBeGreaterThanOrEqual(0);
    });

    it('throws ProviderError when stream exits with non-zero code', async () => {
      mockStream.mockReturnValue(createMockStream([], { exitCode: 1, stderr: 'error output' }));

      const stream = provider.streamMessage(createMessage());

      await expect(async () => {
        let result: IteratorResult<string, unknown>;
        do {
          result = await stream.next();
        } while (!result.done);
      }).rejects.toThrow(ProviderError);
    });

    it('classifies stream timeout errors as transient', async () => {
      mockStream.mockReturnValue(
        createMockStream([], { exitCode: 1, stderr: 'Connection timed out' }),
      );

      const stream = provider.streamMessage(createMessage());
      try {
        let result: IteratorResult<string, unknown>;
        do {
          result = await stream.next();
        } while (!result.done);
        expect.fail('should have thrown');
      } catch (error) {
        expect(error).toBeInstanceOf(ProviderError);
        expect((error as ProviderError).kind).toBe('transient');
      }
    });

    it('returns default message when both stdout and stderr are empty', async () => {
      mockStream.mockReturnValue(createMockStream([], { exitCode: 0, stderr: '' }));

      const stream = provider.streamMessage(createMessage());
      let result: IteratorResult<string, unknown>;

      do {
        result = await stream.next();
      } while (!result.done);

      const providerResult = result.value as { content: string };
      expect(providerResult.content).toBe('No output from Claude Code.');
    });

    it('passes session options to streamClaudeCode', async () => {
      mockStream.mockReturnValue(createMockStream(['ok'], { exitCode: 0, stderr: '' }));

      const stream = provider.streamMessage(createMessage('list files'));
      // Drain the stream
      let result: IteratorResult<string, unknown>;
      do {
        result = await stream.next();
      } while (!result.done);

      expect(mockStream).toHaveBeenCalledWith(
        expect.objectContaining({
          prompt: 'list files',
          workspacePath: '/tmp/workspace',
          timeout: expect.any(Number) as unknown,
        }),
      );
    });
  });

  // -----------------------------------------------------------------------
  // isAvailable()
  // -----------------------------------------------------------------------

  describe('isAvailable()', () => {
    it('returns true when CLI exits with code 0', async () => {
      mockExecute.mockResolvedValue({ stdout: 'ping', stderr: '', exitCode: 0 });

      const available = await provider.isAvailable();

      expect(available).toBe(true);
    });

    it('returns false when CLI exits with non-zero code', async () => {
      mockExecute.mockResolvedValue({ stdout: '', stderr: 'not found', exitCode: 1 });

      const available = await provider.isAvailable();

      expect(available).toBe(false);
    });

    it('returns false when executeClaudeCode throws', async () => {
      mockExecute.mockRejectedValue(new Error('ENOENT: command not found'));

      const available = await provider.isAvailable();

      expect(available).toBe(false);
    });
  });
});
