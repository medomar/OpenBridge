import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { access as fsAccess, unlink, readFile } from 'node:fs/promises';
import { tmpdir, homedir } from 'node:os';
import { basename, join } from 'node:path';
import { createLogger } from './logger.js';

const execFileAsync = promisify(execFile);

const logger = createLogger('voice-transcriber');

export type TranscriptionBackend = 'api' | 'cli' | 'none';

export interface TranscriptionResult {
  text: string;
  backend: TranscriptionBackend;
  durationMs: number;
}

/** Fallback message shown when no transcription backend is available. */
export const TRANSCRIPTION_FALLBACK_MESSAGE =
  '[Voice message — set OPENAI_API_KEY or install whisper for transcription]';

/** Whisper CLI binary names to search for, in priority order. */
const WHISPER_BINARY_NAMES = ['whisper', 'whisper-cli'];

/**
 * Locate a whisper CLI binary on PATH.
 * Searches for both `whisper` (pip install) and `whisper-cli` (brew install whisper-cpp).
 * Returns the full path if found, null otherwise.
 */
export async function findWhisper(): Promise<string | null> {
  for (const name of WHISPER_BINARY_NAMES) {
    try {
      const { stdout } = await execFileAsync('which', [name]);
      const path = stdout.trim();
      if (path) return path;
    } catch {
      // not found, try next
    }
  }
  return null;
}

let _cachedBackend: TranscriptionBackend | undefined;
let _cachedWhisperPath: string | null = null;
let _cachedApiToken: string | null = null;

/**
 * Resolve an OpenAI API key for Whisper API calls.
 *
 * Priority:
 * 1. `OPENAI_API_KEY` env var (explicit API key)
 * 2. `~/.codex/auth.json` → `OPENAI_API_KEY` field (Codex API key login)
 *
 * Note: Codex OAuth tokens (access_token from `codex login` with ChatGPT) are NOT
 * usable with the Whisper API — they lack the required scopes. Only real API keys
 * (sk-...) work with the audio transcription endpoint.
 *
 * Returns the API key string or null if no credentials are available.
 */
export async function resolveOpenAIToken(): Promise<string | null> {
  // 1. Env var takes priority
  const envKey = process.env['OPENAI_API_KEY'];
  if (envKey) return envKey;

  // 2. Read from Codex auth file — only use real API keys, not OAuth tokens
  try {
    const authPath = join(homedir(), '.codex', 'auth.json');
    const raw = await readFile(authPath, 'utf-8');
    const auth = JSON.parse(raw) as Record<string, unknown>;

    // Only use OPENAI_API_KEY if it's a real key string (not null)
    if (auth['OPENAI_API_KEY'] && typeof auth['OPENAI_API_KEY'] === 'string') {
      return auth['OPENAI_API_KEY'];
    }
  } catch {
    // auth.json doesn't exist or is unreadable — not an error
  }

  return null;
}

/**
 * Detect and cache the best available transcription backend for this process.
 *
 * Priority:
 * 1. OpenAI Whisper API (env var OPENAI_API_KEY or Codex-stored API key) → 'api'
 * 2. Local whisper binary (whisper or whisper-cli on PATH) → 'cli'
 * 3. Neither → 'none'
 *
 * Result is cached after the first call — detection runs exactly once per process.
 */
export async function detectAvailableBackend(): Promise<TranscriptionBackend> {
  if (_cachedBackend !== undefined) return _cachedBackend;

  let backend: TranscriptionBackend;

  // Check for a real API key (env var or Codex-stored)
  _cachedApiToken = await resolveOpenAIToken();
  if (_cachedApiToken) {
    backend = 'api';
  } else {
    // No API key — check for local whisper binary
    _cachedWhisperPath = await findWhisper();
    backend = _cachedWhisperPath ? 'cli' : 'none';
  }

  logger.info({ backend }, 'Transcription backend detected');
  _cachedBackend = backend;
  return backend;
}

/**
 * Reset the cached backend, whisper path, and API token.
 * @internal For testing only — do not call in production code.
 */
export function _resetCachedBackend(): void {
  _cachedBackend = undefined;
  _cachedWhisperPath = null;
  _cachedApiToken = null;
}

/**
 * Transcribe an audio file using the OpenAI Whisper API.
 *
 * Uses the resolved API token (env var, Codex OAuth, or Codex API key).
 * Uses Node.js native fetch() + FormData + Blob (Node >= 22, no extra deps).
 * Returns null if no credentials are available, the request fails, or the response
 * is non-2xx. Errors are logged via Pino but never thrown.
 *
 * @param audioPath - Absolute path to the audio file.
 * @returns Transcription text, or null if unavailable.
 */
export async function transcribeViaApi(audioPath: string): Promise<string | null> {
  const token = _cachedApiToken ?? (await resolveOpenAIToken());
  if (!token) return null;

  try {
    const audioData = await readFile(audioPath);
    const blob = new Blob([audioData]);
    const filename = basename(audioPath);

    const form = new FormData();
    form.append('file', blob, filename);
    form.append('model', 'whisper-1');

    const response = await fetch('https://api.openai.com/v1/audio/transcriptions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
      },
      body: form,
    });

    if (!response.ok) {
      logger.warn({ status: response.status }, 'Whisper API returned non-2xx response');
      return null;
    }

    const json = (await response.json()) as { text?: string };
    return json.text ?? null;
  } catch (err) {
    logger.warn({ err }, 'Whisper API transcription failed');
    return null;
  }
}

/** Default model search paths for whisper-cli (Homebrew whisper-cpp). */
const WHISPER_MODEL_PATHS = [
  join(homedir(), '.local', 'share', 'whisper-models', 'ggml-base.en.bin'),
  join(homedir(), '.local', 'share', 'whisper-models', 'ggml-base.bin'),
  join(homedir(), '.local', 'share', 'whisper-models', 'ggml-small.en.bin'),
  '/opt/homebrew/share/whisper-cpp/models/ggml-base.en.bin',
  '/usr/local/share/whisper-cpp/models/ggml-base.en.bin',
];

/**
 * Find a GGML model file for whisper-cli.
 * Returns the first existing path from the search list, or null.
 */
async function findWhisperModel(): Promise<string | null> {
  for (const p of WHISPER_MODEL_PATHS) {
    try {
      await fsAccess(p);
      return p;
    } catch {
      // not found, try next
    }
  }
  return null;
}

/**
 * Detect if a whisper binary is the Homebrew whisper-cpp variant (whisper-cli)
 * vs the Python whisper package.
 */
function isWhisperCpp(whisperPath: string): boolean {
  return basename(whisperPath) === 'whisper-cli';
}

/** Audio formats that whisper-cli can read directly (without ffmpeg conversion). */
const WHISPER_CPP_NATIVE_FORMATS = new Set(['.wav', '.mp3', '.flac']);

/**
 * Convert an audio file to 16 kHz mono WAV using ffmpeg.
 * Required for whisper-cli which cannot reliably read OGG/Opus files.
 * Returns the path to the WAV file, or null if ffmpeg is not available / conversion fails.
 */
async function convertToWav(audioPath: string): Promise<string | null> {
  const wavPath = audioPath.replace(/\.[^.]+$/, '') + '-converted.wav';
  try {
    await execFileAsync(
      'ffmpeg',
      ['-y', '-i', audioPath, '-ar', '16000', '-ac', '1', '-c:a', 'pcm_s16le', wavPath],
      { timeout: 30_000 },
    );
    return wavPath;
  } catch {
    logger.warn({ audioPath }, 'ffmpeg conversion failed or ffmpeg not installed');
    return null;
  }
}

/**
 * Transcribe an audio file using the local Whisper CLI binary.
 * Handles both `whisper` (Python/pip) and `whisper-cli` (Homebrew whisper-cpp).
 * For whisper-cli, non-WAV files are converted via ffmpeg first.
 *
 * @param whisperPath - Absolute path to the whisper binary.
 * @param audioPath - Absolute path to the audio file.
 * @returns Transcription text, or null on failure.
 */
async function transcribeViaCli(whisperPath: string, audioPath: string): Promise<string | null> {
  let convertedPath: string | null = null;
  try {
    const outputDir = tmpdir();

    if (isWhisperCpp(whisperPath)) {
      const modelPath = await findWhisperModel();
      if (!modelPath) {
        logger.warn(
          'No GGML model file found for whisper-cli — download one from https://huggingface.co/ggerganov/whisper.cpp',
        );
        return null;
      }

      // whisper-cli only reliably reads WAV/MP3/FLAC — convert OGG/Opus via ffmpeg
      const ext = audioPath.substring(audioPath.lastIndexOf('.')).toLowerCase();
      let inputPath = audioPath;
      if (!WHISPER_CPP_NATIVE_FORMATS.has(ext)) {
        convertedPath = await convertToWav(audioPath);
        if (!convertedPath) return null;
        inputPath = convertedPath;
      }

      const outputBasename = basename(audioPath).replace(/\.[^.]+$/, '');
      await execFileAsync(
        whisperPath,
        [
          '--model',
          modelPath,
          '--file',
          inputPath,
          '--output-txt',
          '--output-file',
          join(outputDir, outputBasename),
          '--no-prints',
        ],
        { timeout: 120_000 },
      );
    } else {
      // Python whisper: handles all formats natively
      await execFileAsync(
        whisperPath,
        [audioPath, '--output-format', 'txt', '--output-dir', outputDir],
        { timeout: 120_000 },
      );
    }

    const inputBasename = basename(audioPath).replace(/\.[^.]+$/, '');
    const txtPath = join(outputDir, `${inputBasename}.txt`);
    const text = await readFile(txtPath, 'utf-8').catch(() => '');
    await unlink(txtPath).catch(() => {});
    return text.trim() || null;
  } catch (err) {
    logger.warn({ err }, 'Voice transcription failed');
    return null;
  } finally {
    // Clean up converted WAV file if we created one
    if (convertedPath) {
      await unlink(convertedPath).catch(() => {});
    }
  }
}

/**
 * Transcribe an audio file using the best available backend.
 *
 * Fallback chain: OpenAI Whisper API → local Whisper CLI → null.
 * If the API backend is detected but fails for a given file, falls through to CLI.
 *
 * @param audioPath - Absolute path to the audio file (ogg, oga, wav, mp3, etc.)
 * @returns TranscriptionResult with text, backend used, and duration — or null if
 *          no backend is available or all attempts fail.
 */
export async function transcribeAudio(audioPath: string): Promise<TranscriptionResult | null> {
  const startMs = Date.now();
  const backend = await detectAvailableBackend();

  if (backend === 'api') {
    const text = await transcribeViaApi(audioPath);
    if (text !== null) {
      return { text, backend: 'api', durationMs: Date.now() - startMs };
    }
    // API failed — fall through to CLI
    const whisperPath = await findWhisper();
    if (whisperPath) {
      const cliText = await transcribeViaCli(whisperPath, audioPath);
      if (cliText !== null) {
        return { text: cliText, backend: 'cli', durationMs: Date.now() - startMs };
      }
    }
    return null;
  }

  if (backend === 'cli') {
    // Use path cached during detection to avoid a redundant `which` call
    const whisperPath = _cachedWhisperPath ?? (await findWhisper());
    if (whisperPath) {
      const cliText = await transcribeViaCli(whisperPath, audioPath);
      if (cliText !== null) {
        return { text: cliText, backend: 'cli', durationMs: Date.now() - startMs };
      }
    }
    return null;
  }

  // backend === 'none'
  return null;
}
