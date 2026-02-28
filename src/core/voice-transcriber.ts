import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { unlink, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
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

/**
 * Locate the whisper CLI binary on PATH.
 * Returns the full path if found, null otherwise.
 */
export async function findWhisper(): Promise<string | null> {
  try {
    const { stdout } = await execFileAsync('which', ['whisper']);
    return stdout.trim() || null;
  } catch {
    return null;
  }
}

let _cachedBackend: TranscriptionBackend | undefined;
let _cachedWhisperPath: string | null = null;

/**
 * Detect and cache the best available transcription backend for this process.
 *
 * Priority: (1) OPENAI_API_KEY in env → 'api', (2) local whisper binary → 'cli', (3) 'none'.
 * Result is cached after the first call — detection runs exactly once per process.
 */
export async function detectAvailableBackend(): Promise<TranscriptionBackend> {
  if (_cachedBackend !== undefined) return _cachedBackend;

  let backend: TranscriptionBackend;
  if (process.env['OPENAI_API_KEY']) {
    backend = 'api';
  } else {
    _cachedWhisperPath = await findWhisper();
    backend = _cachedWhisperPath ? 'cli' : 'none';
  }

  logger.info({ backend }, 'Transcription backend detected');
  _cachedBackend = backend;
  return backend;
}

/**
 * Reset the cached backend and whisper path.
 * @internal For testing only — do not call in production code.
 */
export function _resetCachedBackend(): void {
  _cachedBackend = undefined;
  _cachedWhisperPath = null;
}

/**
 * Transcribe an audio file using the OpenAI Whisper API.
 *
 * Reads OPENAI_API_KEY from env — the same key used by Codex, no extra config.
 * Uses Node.js native fetch() + FormData + Blob (Node >= 22, no extra deps).
 * Returns null if the API key is missing, the request fails, or the response
 * is non-2xx. Errors are logged via Pino but never thrown.
 *
 * @param audioPath - Absolute path to the audio file.
 * @returns Transcription text, or null if unavailable.
 */
export async function transcribeViaApi(audioPath: string): Promise<string | null> {
  const apiKey = process.env['OPENAI_API_KEY'];
  if (!apiKey) return null;

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
        Authorization: `Bearer ${apiKey}`,
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

/**
 * Transcribe an audio file using the local Whisper CLI binary.
 *
 * @param whisperPath - Absolute path to the whisper binary.
 * @param audioPath - Absolute path to the audio file.
 * @returns Transcription text, or null on failure.
 */
async function transcribeViaCli(whisperPath: string, audioPath: string): Promise<string | null> {
  try {
    const outputDir = tmpdir();
    await execFileAsync(whisperPath, [
      audioPath,
      '--output-format',
      'txt',
      '--output-dir',
      outputDir,
    ]);

    // Whisper writes <input-basename-without-ext>.txt in the output directory
    const inputBasename = basename(audioPath).replace(/\.[^.]+$/, '');
    const txtPath = join(outputDir, `${inputBasename}.txt`);
    const text = await readFile(txtPath, 'utf-8').catch(() => '');
    await unlink(txtPath).catch(() => {});
    return text.trim() || null;
  } catch (err) {
    logger.warn({ err }, 'Voice transcription failed');
    return null;
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
