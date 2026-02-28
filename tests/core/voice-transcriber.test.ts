import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

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
  access: vi.fn(),
  readFile: vi.fn(),
  unlink: vi.fn(),
}));

vi.mock('node:os', () => ({
  tmpdir: vi.fn(() => '/tmp'),
  homedir: vi.fn(() => '/mock-home'),
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

import { access, readFile, unlink } from 'node:fs/promises';
import {
  findWhisper,
  transcribeAudio,
  transcribeViaApi,
  resolveOpenAIToken,
  _resetCachedBackend,
  TRANSCRIPTION_FALLBACK_MESSAGE,
} from '../../src/core/voice-transcriber.js';

const mockAccess = access as ReturnType<typeof vi.fn>;
const mockReadFile = readFile as ReturnType<typeof vi.fn>;
const mockUnlink = unlink as ReturnType<typeof vi.fn>;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function mockWhisperNotFound(): void {
  // findWhisper tries `which whisper` then `which whisper-cli`
  mockExecFileAsync.mockRejectedValueOnce(new Error('not found')); // whisper
  mockExecFileAsync.mockRejectedValueOnce(new Error('not found')); // whisper-cli
}

function mockWhisperFound(path = '/usr/local/bin/whisper'): void {
  mockExecFileAsync.mockResolvedValueOnce({ stdout: `${path}\n`, stderr: '' });
}

function mockWhisperCliFound(path = '/opt/homebrew/bin/whisper-cli'): void {
  mockExecFileAsync.mockRejectedValueOnce(new Error('not found')); // whisper
  mockExecFileAsync.mockResolvedValueOnce({ stdout: `${path}\n`, stderr: '' }); // whisper-cli
}

function mockNoCodexAuth(): void {
  mockReadFile.mockRejectedValueOnce(new Error('ENOENT'));
}

// Codex auth.json content for API key login
const CODEX_AUTH_APIKEY = JSON.stringify({
  auth_mode: 'api-key',
  OPENAI_API_KEY: 'sk-codex-stored-key',
  tokens: null,
});

// Codex auth.json for OAuth login (no usable API key)
const CODEX_AUTH_OAUTH = JSON.stringify({
  auth_mode: 'chatgpt',
  OPENAI_API_KEY: null,
  tokens: { access_token: 'eyJhbGciOiJSUzI1NiIs...' },
});

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

  it('returns whisper-cli path when whisper is not found but whisper-cli is', async () => {
    mockWhisperCliFound();

    const result = await findWhisper();

    expect(result).toBe('/opt/homebrew/bin/whisper-cli');
    expect(mockExecFileAsync).toHaveBeenCalledWith('which', ['whisper-cli']);
  });

  it('returns null when neither whisper nor whisper-cli is installed', async () => {
    mockWhisperNotFound();

    const result = await findWhisper();

    expect(result).toBeNull();
  });

  it('returns null when `which whisper` returns an empty string', async () => {
    mockExecFileAsync.mockResolvedValueOnce({ stdout: '   \n', stderr: '' });
    mockExecFileAsync.mockRejectedValueOnce(new Error('not found'));

    const result = await findWhisper();

    expect(result).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// resolveOpenAIToken
// ---------------------------------------------------------------------------

describe('resolveOpenAIToken', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env['OPENAI_API_KEY'];
  });

  afterEach(() => {
    delete process.env['OPENAI_API_KEY'];
  });

  it('returns OPENAI_API_KEY from env when set', async () => {
    process.env['OPENAI_API_KEY'] = 'sk-env-key';

    const token = await resolveOpenAIToken();

    expect(token).toBe('sk-env-key');
    expect(mockReadFile).not.toHaveBeenCalled();
  });

  it('returns OPENAI_API_KEY from Codex auth.json (API key login)', async () => {
    mockReadFile.mockResolvedValueOnce(CODEX_AUTH_APIKEY);

    const token = await resolveOpenAIToken();

    expect(token).toBe('sk-codex-stored-key');
    expect(mockReadFile).toHaveBeenCalledWith('/mock-home/.codex/auth.json', 'utf-8');
  });

  it('returns null for Codex OAuth login (access_token not usable with Whisper API)', async () => {
    mockReadFile.mockResolvedValueOnce(CODEX_AUTH_OAUTH);

    const token = await resolveOpenAIToken();

    expect(token).toBeNull();
  });

  it('returns null when auth.json does not exist', async () => {
    mockReadFile.mockRejectedValueOnce(new Error('ENOENT'));

    const token = await resolveOpenAIToken();

    expect(token).toBeNull();
  });

  it('returns null when auth.json has no usable credentials', async () => {
    const emptyAuth = JSON.stringify({ auth_mode: 'none', tokens: null });
    mockReadFile.mockResolvedValueOnce(emptyAuth);

    const token = await resolveOpenAIToken();

    expect(token).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// transcribeAudio — Python whisper (CLI)
// ---------------------------------------------------------------------------

describe('transcribeAudio', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    _resetCachedBackend();
    mockUnlink.mockResolvedValue(undefined);
    delete process.env['OPENAI_API_KEY'];
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    delete process.env['OPENAI_API_KEY'];
  });

  it('returns TranscriptionResult with CLI backend when whisper (Python) is available', async () => {
    mockNoCodexAuth();
    mockWhisperFound();
    mockExecFileAsync.mockResolvedValueOnce({ stdout: '', stderr: '' }); // whisper run
    mockReadFile.mockResolvedValueOnce('Hello from Whisper!'); // .txt output

    const result = await transcribeAudio('/audio/voice.ogg');

    expect(result).not.toBeNull();
    expect(result?.text).toBe('Hello from Whisper!');
    expect(result?.backend).toBe('cli');
    expect(typeof result?.durationMs).toBe('number');
  });

  it('returns null when no backend is available', async () => {
    mockNoCodexAuth();
    mockWhisperNotFound();

    const result = await transcribeAudio('/audio/voice.ogg');

    expect(result).toBeNull();
  });

  it('handles .oga format — derives correct output .txt path', async () => {
    mockNoCodexAuth();
    mockWhisperFound('/usr/bin/whisper');
    mockExecFileAsync.mockResolvedValueOnce({ stdout: '', stderr: '' });
    mockReadFile.mockResolvedValueOnce('Voice message text');

    const result = await transcribeAudio('/tmp/voice_note.oga');

    expect(result?.text).toBe('Voice message text');
    expect(mockReadFile).toHaveBeenCalledWith('/tmp/voice_note.txt', 'utf-8');
  });

  it('handles .ogg format — derives correct output .txt path', async () => {
    mockNoCodexAuth();
    mockWhisperFound('/usr/bin/whisper');
    mockExecFileAsync.mockResolvedValueOnce({ stdout: '', stderr: '' });
    mockReadFile.mockResolvedValueOnce('Another message');

    const result = await transcribeAudio('/recordings/sound.ogg');

    expect(result?.text).toBe('Another message');
    expect(mockReadFile).toHaveBeenCalledWith('/tmp/sound.txt', 'utf-8');
  });

  it('deletes the temp .txt file after a successful transcription', async () => {
    mockNoCodexAuth();
    mockWhisperFound('/usr/bin/whisper');
    mockExecFileAsync.mockResolvedValueOnce({ stdout: '', stderr: '' });
    mockReadFile.mockResolvedValueOnce('Cleanup test');

    await transcribeAudio('/audio/cleanup.ogg');

    expect(mockUnlink).toHaveBeenCalledWith('/tmp/cleanup.txt');
  });

  it('returns null when Whisper runs but produces empty output', async () => {
    mockNoCodexAuth();
    mockWhisperFound('/usr/bin/whisper');
    mockExecFileAsync.mockResolvedValueOnce({ stdout: '', stderr: '' });
    mockReadFile.mockResolvedValueOnce('   \n  ');

    const result = await transcribeAudio('/audio/empty.ogg');

    expect(result).toBeNull();
  });

  it('returns null and does not throw when Whisper execution fails', async () => {
    mockNoCodexAuth();
    mockWhisperFound('/usr/bin/whisper');
    mockExecFileAsync.mockRejectedValueOnce(new Error('segfault'));

    const result = await transcribeAudio('/audio/crash.ogg');

    expect(result).toBeNull();
  });

  it('still returns transcription even if temp cleanup fails', async () => {
    mockNoCodexAuth();
    mockWhisperFound('/usr/bin/whisper');
    mockExecFileAsync.mockResolvedValueOnce({ stdout: '', stderr: '' });
    mockReadFile.mockResolvedValueOnce('Transcription OK');
    mockUnlink.mockRejectedValue(new Error('permission denied'));

    const result = await transcribeAudio('/audio/persist.ogg');

    expect(result?.text).toBe('Transcription OK');
  });

  it('uses API backend when OPENAI_API_KEY env var is set', async () => {
    process.env['OPENAI_API_KEY'] = 'sk-test-key';
    mockReadFile.mockResolvedValue(Buffer.from('audio data'));

    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ text: 'API transcription result' }),
      }),
    );

    const result = await transcribeAudio('/audio/voice.ogg');

    expect(result?.text).toBe('API transcription result');
    expect(result?.backend).toBe('api');
  });

  it('uses API backend when Codex has stored API key', async () => {
    mockReadFile
      .mockResolvedValueOnce(CODEX_AUTH_APIKEY) // resolveOpenAIToken
      .mockResolvedValueOnce(Buffer.from('audio data')); // transcribeViaApi

    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ text: 'Codex API key result' }),
      }),
    );

    const result = await transcribeAudio('/audio/voice.ogg');

    expect(result?.text).toBe('Codex API key result');
    expect(result?.backend).toBe('api');
  });

  it('uses CLI backend when Codex only has OAuth token (not API key)', async () => {
    // OAuth token → resolveOpenAIToken returns null → falls to CLI
    mockReadFile.mockResolvedValueOnce(CODEX_AUTH_OAUTH);
    mockWhisperFound('/usr/bin/whisper');
    mockExecFileAsync.mockResolvedValueOnce({ stdout: '', stderr: '' });
    mockReadFile.mockResolvedValueOnce('CLI transcription');

    const result = await transcribeAudio('/audio/voice.ogg');

    expect(result?.text).toBe('CLI transcription');
    expect(result?.backend).toBe('cli');
  });

  it('falls through to CLI when API call fails', async () => {
    process.env['OPENAI_API_KEY'] = 'sk-test-key';

    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 500 }));

    mockReadFile.mockResolvedValueOnce(Buffer.from('audio data')); // transcribeViaApi
    mockWhisperFound('/usr/bin/whisper');
    mockExecFileAsync.mockResolvedValueOnce({ stdout: '', stderr: '' });
    mockReadFile.mockResolvedValueOnce('CLI fallback text');

    const result = await transcribeAudio('/audio/voice.ogg');

    expect(result?.text).toBe('CLI fallback text');
    expect(result?.backend).toBe('cli');
  });
});

// ---------------------------------------------------------------------------
// transcribeAudio — whisper-cli (Homebrew whisper-cpp)
// ---------------------------------------------------------------------------

describe('transcribeAudio — whisper-cli (Homebrew)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    _resetCachedBackend();
    mockUnlink.mockResolvedValue(undefined);
    delete process.env['OPENAI_API_KEY'];
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('uses whisper-cli with --model and --file for WAV files', async () => {
    mockNoCodexAuth();
    mockWhisperCliFound('/opt/homebrew/bin/whisper-cli');
    // findWhisperModel → fsAccess succeeds
    mockAccess.mockResolvedValueOnce(undefined);
    // whisper-cli run
    mockExecFileAsync.mockResolvedValueOnce({ stdout: '', stderr: '' });
    mockReadFile.mockResolvedValueOnce('Whisper-cpp result');

    const result = await transcribeAudio('/audio/voice.wav');

    expect(result?.text).toBe('Whisper-cpp result');
    expect(result?.backend).toBe('cli');
    expect(mockExecFileAsync).toHaveBeenCalledWith(
      '/opt/homebrew/bin/whisper-cli',
      expect.arrayContaining([
        '--model',
        '--file',
        '/audio/voice.wav',
        '--output-txt',
        '--no-prints',
      ]),
      expect.objectContaining({ timeout: 120_000 }),
    );
  });

  it('converts OGG to WAV via ffmpeg before passing to whisper-cli', async () => {
    mockNoCodexAuth();
    mockWhisperCliFound('/opt/homebrew/bin/whisper-cli');
    mockAccess.mockResolvedValueOnce(undefined); // findWhisperModel
    // ffmpeg conversion
    mockExecFileAsync.mockResolvedValueOnce({ stdout: '', stderr: '' });
    // whisper-cli run
    mockExecFileAsync.mockResolvedValueOnce({ stdout: '', stderr: '' });
    mockReadFile.mockResolvedValueOnce('OGG transcribed');

    const result = await transcribeAudio('/audio/voice.ogg');

    expect(result?.text).toBe('OGG transcribed');
    // Verify ffmpeg was called for conversion
    expect(mockExecFileAsync).toHaveBeenCalledWith(
      'ffmpeg',
      expect.arrayContaining(['-y', '-i', '/audio/voice.ogg']),
      expect.objectContaining({ timeout: 30_000 }),
    );
  });

  it('returns null when whisper-cli found but no model file exists', async () => {
    mockNoCodexAuth();
    mockWhisperCliFound('/opt/homebrew/bin/whisper-cli');
    mockAccess.mockRejectedValue(new Error('ENOENT')); // all model paths fail

    const result = await transcribeAudio('/audio/voice.wav');

    expect(result).toBeNull();
  });

  it('returns null when ffmpeg conversion fails for non-WAV input', async () => {
    mockNoCodexAuth();
    mockWhisperCliFound('/opt/homebrew/bin/whisper-cli');
    mockAccess.mockResolvedValueOnce(undefined); // findWhisperModel
    mockExecFileAsync.mockRejectedValueOnce(new Error('ffmpeg not found')); // ffmpeg fails

    const result = await transcribeAudio('/audio/voice.ogg');

    expect(result).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// transcribeAudio — fallback chain
// ---------------------------------------------------------------------------

describe('transcribeAudio — fallback chain', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    _resetCachedBackend();
    mockUnlink.mockResolvedValue(undefined);
    delete process.env['OPENAI_API_KEY'];
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    delete process.env['OPENAI_API_KEY'];
  });

  it('(1) API available via env → uses API backend', async () => {
    process.env['OPENAI_API_KEY'] = 'sk-test-key';
    mockReadFile.mockResolvedValue(Buffer.from('audio data'));

    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ text: 'Transcribed via API' }),
      }),
    );

    const result = await transcribeAudio('/audio/voice.ogg');

    expect(result?.text).toBe('Transcribed via API');
    expect(result?.backend).toBe('api');
  });

  it('(2) API fails + CLI available → falls through to CLI', async () => {
    process.env['OPENAI_API_KEY'] = 'sk-test-key';

    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 500 }));

    mockReadFile.mockResolvedValueOnce(Buffer.from('audio data'));
    mockWhisperFound('/usr/bin/whisper');
    mockExecFileAsync.mockResolvedValueOnce({ stdout: '', stderr: '' });
    mockReadFile.mockResolvedValueOnce('CLI fallback text');

    const result = await transcribeAudio('/audio/voice.ogg');

    expect(result?.text).toBe('CLI fallback text');
    expect(result?.backend).toBe('cli');
  });

  it('(3) neither backend available → returns null; fallback message correct', async () => {
    mockNoCodexAuth();
    mockWhisperNotFound();

    const result = await transcribeAudio('/audio/voice.ogg');

    expect(result).toBeNull();
    expect(TRANSCRIPTION_FALLBACK_MESSAGE).toBe(
      '[Voice message — set OPENAI_API_KEY or install whisper for transcription]',
    );
  });
});

// ---------------------------------------------------------------------------
// transcribeViaApi
// ---------------------------------------------------------------------------

describe('transcribeViaApi', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    _resetCachedBackend();
    delete process.env['OPENAI_API_KEY'];
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    delete process.env['OPENAI_API_KEY'];
  });

  it('returns transcription text on a successful API response', async () => {
    process.env['OPENAI_API_KEY'] = 'sk-test-key';
    mockReadFile.mockResolvedValue(Buffer.from('audio data'));

    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ text: 'Hello from Whisper API' }),
      }),
    );

    const result = await transcribeViaApi('/audio/voice.ogg');

    expect(result).toBe('Hello from Whisper API');
  });

  it('uses Codex-stored API key when env var is absent', async () => {
    mockReadFile
      .mockResolvedValueOnce(CODEX_AUTH_APIKEY)
      .mockResolvedValueOnce(Buffer.from('audio data'));

    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ text: 'Codex key result' }),
    });
    vi.stubGlobal('fetch', mockFetch);

    const result = await transcribeViaApi('/audio/voice.ogg');

    expect(result).toBe('Codex key result');
    expect(mockFetch).toHaveBeenCalledWith(
      'https://api.openai.com/v1/audio/transcriptions',
      expect.objectContaining({
        headers: { Authorization: 'Bearer sk-codex-stored-key' },
      }),
    );
  });

  it('returns null without calling fetch when no credentials are available', async () => {
    mockNoCodexAuth();
    const mockFetch = vi.fn();
    vi.stubGlobal('fetch', mockFetch);

    const result = await transcribeViaApi('/audio/voice.ogg');

    expect(result).toBeNull();
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('returns null when the API responds with an error status', async () => {
    process.env['OPENAI_API_KEY'] = 'sk-test-key';
    mockReadFile.mockResolvedValue(Buffer.from('audio data'));

    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 429 }));

    const result = await transcribeViaApi('/audio/voice.ogg');

    expect(result).toBeNull();
  });

  it('returns null gracefully on network error', async () => {
    process.env['OPENAI_API_KEY'] = 'sk-test-key';
    mockReadFile.mockResolvedValue(Buffer.from('audio data'));

    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('ECONNREFUSED')));

    const result = await transcribeViaApi('/audio/voice.ogg');

    expect(result).toBeNull();
  });
});
