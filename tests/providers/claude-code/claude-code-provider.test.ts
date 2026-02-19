import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ClaudeCodeProvider } from '../../../src/providers/claude-code/claude-code-provider.js';
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

vi.mock('../../../src/providers/claude-code/claude-code-executor.js', () => ({
  executeClaudeCode: (...args: unknown[]): Promise<unknown> =>
    mockExecute(...args) as Promise<unknown>,
  sanitizePrompt: (s: string) => s,
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

    it('falls back to stderr when stdout is empty', async () => {
      mockExecute.mockResolvedValue({ stdout: '   ', stderr: 'some error output', exitCode: 1 });

      const result = await provider.processMessage(createMessage());

      expect(result.content).toBe('some error output');
    });

    it('returns default message when both stdout and stderr are empty', async () => {
      mockExecute.mockResolvedValue({ stdout: '', stderr: '', exitCode: 0 });

      const result = await provider.processMessage(createMessage());

      expect(result.content).toBe('No output from Claude Code.');
    });

    it('passes message content to executeClaudeCode', async () => {
      mockExecute.mockResolvedValue({ stdout: 'ok', stderr: '', exitCode: 0 });

      await provider.processMessage(createMessage('list all files'));

      expect(mockExecute).toHaveBeenCalledWith(
        'list all files',
        '/tmp/workspace',
        expect.any(Number),
      );
    });

    it('includes durationMs in metadata', async () => {
      mockExecute.mockResolvedValue({ stdout: 'done', stderr: '', exitCode: 0 });

      const result = await provider.processMessage(createMessage());

      expect(result.metadata?.durationMs).toBeGreaterThanOrEqual(0);
    });

    it('includes exitCode in metadata', async () => {
      mockExecute.mockResolvedValue({ stdout: '', stderr: 'fail', exitCode: 1 });

      const result = await provider.processMessage(createMessage());

      expect(result.metadata?.exitCode).toBe(1);
    });

    it('trims whitespace from stdout', async () => {
      mockExecute.mockResolvedValue({ stdout: '  trimmed output  ', stderr: '', exitCode: 0 });

      const result = await provider.processMessage(createMessage());

      expect(result.content).toBe('trimmed output');
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
