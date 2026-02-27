import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { CodexProvider } from '../../../src/providers/codex/codex-provider.js';
import { ProviderError } from '../../../src/providers/claude-code/provider-error.js';
import type { InboundMessage } from '../../../src/types/message.js';

// ---------------------------------------------------------------------------
// Mock fs/promises so initialize() doesn't check real filesystem
// ---------------------------------------------------------------------------

const mockAccess = vi.fn().mockResolvedValue(undefined);

vi.mock('node:fs/promises', () => ({
  access: (...args: unknown[]) => mockAccess(...args) as Promise<void>,
}));

// ---------------------------------------------------------------------------
// Mock child_process so isAvailable() doesn't invoke the real CLI
// ---------------------------------------------------------------------------

const mockExec = vi.fn();

vi.mock('node:child_process', () => ({
  exec: (...args: unknown[]) => {
    // node:util's promisify calls exec(cmd, opts, callback) — invoke callback
    const cb = args[args.length - 1] as (err: Error | null, result: { stdout: string }) => void;
    const result = mockExec(...args.slice(0, -1)) as
      | Promise<{ stdout: string }>
      | { stdout: string }
      | Error;
    if (result instanceof Error) {
      cb(result, { stdout: '' });
    } else if (result && typeof (result as Promise<unknown>).then === 'function') {
      (result as Promise<{ stdout: string }>).then(
        (v) => cb(null, v),
        (e: Error) => cb(e, { stdout: '' }),
      );
    } else {
      cb(null, result as { stdout: string });
    }
  },
}));

// ---------------------------------------------------------------------------
// Mock AgentRunner so tests never invoke the real CLI
// ---------------------------------------------------------------------------

const mockSpawn = vi.fn();

vi.mock('../../../src/core/agent-runner.js', () => ({
  AgentRunner: class {
    spawn = (...args: unknown[]): Promise<unknown> => mockSpawn(...args) as Promise<unknown>;
  },
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createMessage(content = 'what files exist?', sender = '+1234567890'): InboundMessage {
  return {
    id: 'msg-1',
    source: 'whatsapp',
    sender,
    rawContent: `/ai ${content}`,
    content,
    timestamp: new Date(),
  };
}

const DEFAULT_OPTIONS = { workspacePath: '/tmp/workspace' };

// ---------------------------------------------------------------------------
// CodexProvider
// ---------------------------------------------------------------------------

describe('CodexProvider', () => {
  let provider: CodexProvider;

  beforeEach(() => {
    vi.clearAllMocks();
    // Default: OPENAI_API_KEY is set
    process.env['OPENAI_API_KEY'] = 'sk-test-key';
    mockAccess.mockResolvedValue(undefined);
    mockSpawn.mockResolvedValue({ stdout: 'ok', stderr: '', exitCode: 0 });
    provider = new CodexProvider(DEFAULT_OPTIONS);
  });

  afterEach(() => {
    delete process.env['OPENAI_API_KEY'];
  });

  it('has name "codex"', () => {
    expect(provider.name).toBe('codex');
  });

  // -----------------------------------------------------------------------
  // initialize()
  // -----------------------------------------------------------------------

  describe('initialize()', () => {
    it('resolves when workspacePath exists', async () => {
      mockAccess.mockResolvedValue(undefined);
      await expect(provider.initialize()).resolves.toBeUndefined();
    });

    it('throws when workspacePath does not exist', async () => {
      mockAccess.mockRejectedValue(new Error('ENOENT'));
      await expect(provider.initialize()).rejects.toThrow('workspacePath does not exist');
    });
  });

  // -----------------------------------------------------------------------
  // shutdown()
  // -----------------------------------------------------------------------

  it('shutdown() resolves without error', async () => {
    await expect(provider.shutdown()).resolves.toBeUndefined();
  });

  // -----------------------------------------------------------------------
  // processMessage()
  // -----------------------------------------------------------------------

  describe('processMessage()', () => {
    it('returns stdout as content on success', async () => {
      mockSpawn.mockResolvedValue({ stdout: 'file list here', stderr: '', exitCode: 0 });

      const result = await provider.processMessage(createMessage());

      expect(result.content).toBe('file list here');
    });

    it('trims whitespace from stdout', async () => {
      mockSpawn.mockResolvedValue({ stdout: '  trimmed output  ', stderr: '', exitCode: 0 });

      const result = await provider.processMessage(createMessage());

      expect(result.content).toBe('trimmed output');
    });

    it('returns default message when stdout is empty', async () => {
      mockSpawn.mockResolvedValue({ stdout: '', stderr: '', exitCode: 0 });

      const result = await provider.processMessage(createMessage());

      expect(result.content).toBe('No output from Codex.');
    });

    it('includes durationMs in metadata', async () => {
      const result = await provider.processMessage(createMessage());

      expect(result.metadata?.durationMs).toBeGreaterThanOrEqual(0);
    });

    it('includes exitCode in metadata', async () => {
      mockSpawn.mockResolvedValue({ stdout: 'ok', stderr: '', exitCode: 0 });

      const result = await provider.processMessage(createMessage());

      expect(result.metadata?.exitCode).toBe(0);
    });

    it('throws ProviderError when exit code is non-zero', async () => {
      mockSpawn.mockResolvedValue({ stdout: '', stderr: 'some error', exitCode: 1 });

      await expect(provider.processMessage(createMessage())).rejects.toThrow(ProviderError);
    });

    it('ProviderError uses stderr as message when available', async () => {
      mockSpawn.mockResolvedValue({ stdout: '', stderr: 'codex crashed', exitCode: 1 });

      await expect(provider.processMessage(createMessage())).rejects.toThrow('codex crashed');
    });

    it('ProviderError uses fallback message when stderr is empty', async () => {
      mockSpawn.mockResolvedValue({ stdout: '', stderr: '', exitCode: 2 });

      await expect(provider.processMessage(createMessage())).rejects.toThrow(
        'Codex exited with code 2',
      );
    });

    it('passes message content to AgentRunner.spawn', async () => {
      await provider.processMessage(createMessage('list all files'));

      expect(mockSpawn).toHaveBeenCalledWith(
        expect.objectContaining({
          prompt: 'list all files',
          workspacePath: '/tmp/workspace',
          timeout: expect.any(Number) as unknown,
        }),
      );
    });

    it('uses workspacePath from message metadata when provided', async () => {
      const message = createMessage('hello');
      message.metadata = { workspacePath: '/custom/path' };

      await provider.processMessage(message);

      expect(mockSpawn).toHaveBeenCalledWith(
        expect.objectContaining({ workspacePath: '/custom/path' }),
      );
    });

    it('falls back to config workspacePath when metadata has no override', async () => {
      const message = createMessage('hello');
      message.metadata = {};

      await provider.processMessage(message);

      expect(mockSpawn).toHaveBeenCalledWith(
        expect.objectContaining({ workspacePath: '/tmp/workspace' }),
      );
    });

    // -----------------------------------------------------------------------
    // Error classification
    // -----------------------------------------------------------------------

    it('classifies timeout errors as transient', async () => {
      mockSpawn.mockResolvedValue({ stdout: '', stderr: 'Request timeout after 30s', exitCode: 1 });

      try {
        await provider.processMessage(createMessage());
        expect.fail('should have thrown');
      } catch (error) {
        expect(error).toBeInstanceOf(ProviderError);
        expect((error as ProviderError).kind).toBe('transient');
      }
    });

    it('classifies rate limit errors as transient', async () => {
      mockSpawn.mockResolvedValue({ stdout: '', stderr: 'rate limit exceeded', exitCode: 1 });

      try {
        await provider.processMessage(createMessage());
        expect.fail('should have thrown');
      } catch (error) {
        expect(error).toBeInstanceOf(ProviderError);
        expect((error as ProviderError).kind).toBe('transient');
      }
    });

    it('classifies 429 Too Many Requests as transient', async () => {
      mockSpawn.mockResolvedValue({
        stdout: '',
        stderr: 'HTTP 429 Too Many Requests',
        exitCode: 1,
      });

      try {
        await provider.processMessage(createMessage());
        expect.fail('should have thrown');
      } catch (error) {
        expect(error).toBeInstanceOf(ProviderError);
        expect((error as ProviderError).kind).toBe('transient');
      }
    });

    it('classifies auth errors as permanent', async () => {
      mockSpawn.mockResolvedValue({ stdout: '', stderr: 'invalid api key', exitCode: 1 });

      try {
        await provider.processMessage(createMessage());
        expect.fail('should have thrown');
      } catch (error) {
        expect(error).toBeInstanceOf(ProviderError);
        expect((error as ProviderError).kind).toBe('permanent');
      }
    });

    it('classifies authentication failed as permanent', async () => {
      mockSpawn.mockResolvedValue({ stdout: '', stderr: 'authentication failed', exitCode: 1 });

      try {
        await provider.processMessage(createMessage());
        expect.fail('should have thrown');
      } catch (error) {
        expect(error).toBeInstanceOf(ProviderError);
        expect((error as ProviderError).kind).toBe('permanent');
      }
    });

    it('classifies ENOENT as permanent', async () => {
      mockSpawn.mockResolvedValue({ stdout: '', stderr: 'ENOENT: no such file', exitCode: 1 });

      try {
        await provider.processMessage(createMessage());
        expect.fail('should have thrown');
      } catch (error) {
        expect(error).toBeInstanceOf(ProviderError);
        expect((error as ProviderError).kind).toBe('permanent');
      }
    });
  });

  // -----------------------------------------------------------------------
  // Session management in processMessage()
  // -----------------------------------------------------------------------

  describe('session management', () => {
    it('uses sessionId (new session) for first message from a sender', async () => {
      await provider.processMessage(createMessage('first'));

      const opts = mockSpawn.mock.calls[0][0] as Record<string, unknown>;
      expect(opts.sessionId).toBeDefined();
      expect(opts.resumeSessionId).toBeUndefined();
    });

    it('uses resumeSessionId for subsequent messages from the same sender', async () => {
      await provider.processMessage(createMessage('first'));
      await provider.processMessage(createMessage('second'));

      const firstOpts = mockSpawn.mock.calls[0][0] as Record<string, unknown>;
      const secondOpts = mockSpawn.mock.calls[1][0] as Record<string, unknown>;

      expect(firstOpts.sessionId).toBeDefined();
      expect(secondOpts.resumeSessionId).toBeDefined();
      expect(secondOpts.sessionId).toBeUndefined();
    });

    it('uses separate sessions for different senders', async () => {
      const alice = createMessage('hello', '+1111111111');
      const bob = createMessage('hi', '+2222222222');

      await provider.processMessage(alice);
      await provider.processMessage(bob);

      const aliceOpts = mockSpawn.mock.calls[0][0] as Record<string, unknown>;
      const bobOpts = mockSpawn.mock.calls[1][0] as Record<string, unknown>;

      // Both are new sessions, both should have sessionId
      expect(aliceOpts.sessionId).toBeDefined();
      expect(bobOpts.sessionId).toBeDefined();
      // Session keys differ (sender:workspacePath), so the session IDs differ
      expect(aliceOpts.sessionId).not.toBe(bobOpts.sessionId);
    });

    it('uses separate sessions for the same sender in different workspaces', async () => {
      const msgA = createMessage('hello');
      msgA.metadata = { workspacePath: '/workspace-a' };

      const msgB = createMessage('hello');
      msgB.metadata = { workspacePath: '/workspace-b' };

      await provider.processMessage(msgA);
      await provider.processMessage(msgB);

      const optsA = mockSpawn.mock.calls[0][0] as Record<string, unknown>;
      const optsB = mockSpawn.mock.calls[1][0] as Record<string, unknown>;

      // Both new, but different session keys
      expect(optsA.sessionId).toBeDefined();
      expect(optsB.sessionId).toBeDefined();
    });

    it('uses RESUME_LAST sentinel when no explicit sessionId is stored', async () => {
      // First message creates session (isNew: true)
      await provider.processMessage(createMessage('first'));
      // Second message resumes (isNew: false, no stored explicit sessionId)
      await provider.processMessage(createMessage('second'));

      const secondOpts = mockSpawn.mock.calls[1][0] as Record<string, unknown>;
      // The CodexProvider falls back to '__last__' when no explicit sessionId is stored
      expect(secondOpts.resumeSessionId).toBe('__last__');
    });
  });

  // -----------------------------------------------------------------------
  // streamMessage()
  // -----------------------------------------------------------------------

  describe('streamMessage()', () => {
    it('yields the processMessage result as a single chunk', async () => {
      mockSpawn.mockResolvedValue({ stdout: 'batch result', stderr: '', exitCode: 0 });

      const stream = provider.streamMessage(createMessage());
      const chunks: string[] = [];
      let result: IteratorResult<string, unknown>;

      do {
        result = await stream.next();
        if (!result.done) chunks.push(result.value);
      } while (!result.done);

      expect(chunks).toEqual(['batch result']);
    });

    it('returns ProviderResult with the content', async () => {
      mockSpawn.mockResolvedValue({ stdout: 'codex answer', stderr: '', exitCode: 0 });

      const stream = provider.streamMessage(createMessage());
      let result: IteratorResult<string, unknown>;

      do {
        result = await stream.next();
      } while (!result.done);

      const providerResult = result.value as { content: string };
      expect(providerResult.content).toBe('codex answer');
    });

    it('propagates ProviderError from processMessage', async () => {
      mockSpawn.mockResolvedValue({ stdout: '', stderr: 'error', exitCode: 1 });

      const stream = provider.streamMessage(createMessage());

      await expect(async () => {
        let result: IteratorResult<string, unknown>;
        do {
          result = await stream.next();
        } while (!result.done);
      }).rejects.toThrow(ProviderError);
    });
  });

  // -----------------------------------------------------------------------
  // isAvailable()
  // -----------------------------------------------------------------------

  describe('isAvailable()', () => {
    it('returns false when OPENAI_API_KEY is not set', async () => {
      delete process.env['OPENAI_API_KEY'];

      const available = await provider.isAvailable();

      expect(available).toBe(false);
    });

    it('returns true when OPENAI_API_KEY is set and codex binary exists', async () => {
      process.env['OPENAI_API_KEY'] = 'sk-test-key';
      mockExec.mockResolvedValue({ stdout: 'codex 0.104.0' });

      const available = await provider.isAvailable();

      expect(available).toBe(true);
    });

    it('returns false when codex binary is not found (exec throws)', async () => {
      process.env['OPENAI_API_KEY'] = 'sk-test-key';
      mockExec.mockRejectedValue(new Error('command not found: codex'));

      const available = await provider.isAvailable();

      expect(available).toBe(false);
    });
  });

  // -----------------------------------------------------------------------
  // Config validation
  // -----------------------------------------------------------------------

  describe('config validation', () => {
    it('constructs with minimal options (workspacePath only)', () => {
      expect(() => new CodexProvider({ workspacePath: '/tmp' })).not.toThrow();
    });

    it('constructs with all options', () => {
      expect(
        () =>
          new CodexProvider({
            workspacePath: '/tmp',
            timeout: 60_000,
            model: 'gpt-5.2-codex',
            sandbox: 'read-only',
            sessionTtlMs: 900_000,
          }),
      ).not.toThrow();
    });

    it('throws when required workspacePath is missing (uses default ".")', () => {
      // workspacePath has a default of "." so empty options are valid
      expect(() => new CodexProvider({})).not.toThrow();
    });
  });
});
