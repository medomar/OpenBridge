import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// vi.hoisted — create the async mock BEFORE any vi.mock factory runs so that
// when the SUT does `promisify(execFile)` at module-init time it gets our mock
// ---------------------------------------------------------------------------

const mockExecFileAsync = vi.hoisted(() => vi.fn());

// ---------------------------------------------------------------------------
// Module-level mocks
// ---------------------------------------------------------------------------

vi.mock('node:child_process', () => {
  const execFile = vi.fn();
  // Attaching the Node.js promisify custom symbol means promisify(execFile)
  // returns mockExecFileAsync directly rather than wrapping it.
  (execFile as unknown as Record<symbol, unknown>)[Symbol.for('nodejs.util.promisify.custom')] =
    mockExecFileAsync;
  return { execFile };
});

vi.mock('node:fs/promises', () => ({
  readFile: vi.fn(),
  unlink: vi.fn(),
}));

vi.mock('node:os', () => ({
  tmpdir: vi.fn(() => '/tmp'),
}));

vi.mock('../../src/core/logger.js', () => ({
  createLogger: () => ({
    warn: vi.fn(),
    info: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}));

// ---------------------------------------------------------------------------
// Import SUT and fs mocks after vi.mock declarations
// ---------------------------------------------------------------------------

import { readFile, unlink } from 'node:fs/promises';
import {
  findWhisper,
  transcribeAudio,
  _resetCachedBackend,
} from '../../src/core/voice-transcriber.js';

const mockReadFile = readFile as ReturnType<typeof vi.fn>;
const mockUnlink = unlink as ReturnType<typeof vi.fn>;

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('findWhisper', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns the whisper path when `which whisper` succeeds', async () => {
    mockExecFileAsync.mockResolvedValueOnce({ stdout: '/usr/local/bin/whisper\n', stderr: '' });

    const result = await findWhisper();

    expect(result).toBe('/usr/local/bin/whisper');
    expect(mockExecFileAsync).toHaveBeenCalledWith('which', ['whisper']);
  });

  it('returns null when `which whisper` exits with an error (not installed)', async () => {
    mockExecFileAsync.mockRejectedValueOnce(new Error('not found'));

    const result = await findWhisper();

    expect(result).toBeNull();
  });

  it('returns null when `which whisper` returns an empty string', async () => {
    mockExecFileAsync.mockResolvedValueOnce({ stdout: '   \n', stderr: '' });

    const result = await findWhisper();

    expect(result).toBeNull();
  });
});

describe('transcribeAudio', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Reset the backend cache so each test starts with a fresh detection pass
    _resetCachedBackend();
    mockUnlink.mockResolvedValue(undefined);
    // Ensure no API key bleeds in from the environment
    delete process.env['OPENAI_API_KEY'];
  });

  it('returns TranscriptionResult with CLI backend when Whisper is available', async () => {
    // detectAvailableBackend → findWhisper (which whisper)
    mockExecFileAsync.mockResolvedValueOnce({ stdout: '/usr/local/bin/whisper\n', stderr: '' });
    // actual whisper run → success
    mockExecFileAsync.mockResolvedValueOnce({ stdout: '', stderr: '' });

    mockReadFile.mockResolvedValue('Hello from Whisper!');

    const result = await transcribeAudio('/audio/voice.ogg');

    expect(result).not.toBeNull();
    expect(result?.text).toBe('Hello from Whisper!');
    expect(result?.backend).toBe('cli');
    expect(typeof result?.durationMs).toBe('number');
    // Verify whisper was invoked with the correct arguments
    expect(mockExecFileAsync).toHaveBeenNthCalledWith(2, '/usr/local/bin/whisper', [
      '/audio/voice.ogg',
      '--output-format',
      'txt',
      '--output-dir',
      '/tmp',
    ]);
  });

  it('returns null when Whisper is not installed (findWhisper returns null)', async () => {
    // detectAvailableBackend → which whisper → not found → backend = 'none'
    mockExecFileAsync.mockRejectedValueOnce(new Error('not found'));

    const result = await transcribeAudio('/audio/voice.ogg');

    expect(result).toBeNull();
    // Only the `which` call from detectAvailableBackend was made
    expect(mockExecFileAsync).toHaveBeenCalledTimes(1);
  });

  it('handles .oga format — derives correct output .txt path from basename', async () => {
    mockExecFileAsync.mockResolvedValueOnce({ stdout: '/usr/bin/whisper\n', stderr: '' });
    mockExecFileAsync.mockResolvedValueOnce({ stdout: '', stderr: '' });

    mockReadFile.mockResolvedValue('Voice message text');

    const result = await transcribeAudio('/tmp/voice_note.oga');

    expect(result?.text).toBe('Voice message text');
    expect(result?.backend).toBe('cli');
    // readFile must be called with the .txt version of the .oga basename under /tmp
    expect(mockReadFile).toHaveBeenCalledWith('/tmp/voice_note.txt', 'utf-8');
  });

  it('handles .ogg format — derives correct output .txt path from basename', async () => {
    mockExecFileAsync.mockResolvedValueOnce({ stdout: '/usr/bin/whisper\n', stderr: '' });
    mockExecFileAsync.mockResolvedValueOnce({ stdout: '', stderr: '' });

    mockReadFile.mockResolvedValue('Another message');

    const result = await transcribeAudio('/recordings/sound.ogg');

    expect(result?.text).toBe('Another message');
    expect(mockReadFile).toHaveBeenCalledWith('/tmp/sound.txt', 'utf-8');
  });

  it('deletes the temp .txt file after a successful transcription', async () => {
    mockExecFileAsync.mockResolvedValueOnce({ stdout: '/usr/bin/whisper\n', stderr: '' });
    mockExecFileAsync.mockResolvedValueOnce({ stdout: '', stderr: '' });

    mockReadFile.mockResolvedValue('Cleanup test');

    await transcribeAudio('/audio/cleanup.ogg');

    expect(mockUnlink).toHaveBeenCalledWith('/tmp/cleanup.txt');
  });

  it('returns null when Whisper runs but produces empty output', async () => {
    mockExecFileAsync.mockResolvedValueOnce({ stdout: '/usr/bin/whisper\n', stderr: '' });
    mockExecFileAsync.mockResolvedValueOnce({ stdout: '', stderr: '' });

    // Whisper wrote an empty / whitespace-only file
    mockReadFile.mockResolvedValue('   \n  ');

    const result = await transcribeAudio('/audio/empty.ogg');

    expect(result).toBeNull();
  });

  it('returns null and does not throw when Whisper execution fails mid-run', async () => {
    mockExecFileAsync.mockResolvedValueOnce({ stdout: '/usr/bin/whisper\n', stderr: '' });
    // The actual whisper process fails (non-zero exit)
    mockExecFileAsync.mockRejectedValueOnce(new Error('segfault'));

    const result = await transcribeAudio('/audio/crash.ogg');

    expect(result).toBeNull();
  });

  it('still returns transcription even if temp .txt cleanup (unlink) fails', async () => {
    mockExecFileAsync.mockResolvedValueOnce({ stdout: '/usr/bin/whisper\n', stderr: '' });
    mockExecFileAsync.mockResolvedValueOnce({ stdout: '', stderr: '' });

    mockReadFile.mockResolvedValue('Transcription OK');
    mockUnlink.mockRejectedValue(new Error('permission denied'));

    const result = await transcribeAudio('/audio/persist.ogg');

    // Cleanup failure must not surface to the caller
    expect(result?.text).toBe('Transcription OK');
  });

  it('uses API backend when OPENAI_API_KEY is set and API succeeds', async () => {
    process.env['OPENAI_API_KEY'] = 'sk-test-key';
    // detectAvailableBackend → 'api' (no exec calls needed)
    // transcribeViaApi will be called — mock fetch via global
    mockReadFile.mockResolvedValue(Buffer.from('audio data'));

    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ text: 'API transcription result' }),
    });
    vi.stubGlobal('fetch', mockFetch);

    const result = await transcribeAudio('/audio/voice.ogg');

    expect(result).not.toBeNull();
    expect(result?.text).toBe('API transcription result');
    expect(result?.backend).toBe('api');

    vi.unstubAllGlobals();
    delete process.env['OPENAI_API_KEY'];
  });

  it('falls through to CLI when API backend is set but API call fails', async () => {
    process.env['OPENAI_API_KEY'] = 'sk-test-key';
    // detectAvailableBackend → 'api' (no exec for which)
    // transcribeViaApi fails → fall through to CLI
    // findWhisper() → exec call
    mockExecFileAsync.mockResolvedValueOnce({ stdout: '/usr/bin/whisper\n', stderr: '' });
    // whisper run
    mockExecFileAsync.mockResolvedValueOnce({ stdout: '', stderr: '' });

    mockReadFile
      .mockResolvedValueOnce(Buffer.from('audio data')) // readFile in transcribeViaApi
      .mockResolvedValueOnce('CLI fallback text'); // readFile in transcribeViaCli

    const mockFetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
    });
    vi.stubGlobal('fetch', mockFetch);

    const result = await transcribeAudio('/audio/voice.ogg');

    expect(result?.text).toBe('CLI fallback text');
    expect(result?.backend).toBe('cli');

    vi.unstubAllGlobals();
    delete process.env['OPENAI_API_KEY'];
  });
});
