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
 * Transcribe an audio file using the Whisper CLI.
 *
 * @param audioPath - Absolute path to the audio file (ogg, oga, wav, mp3, etc.)
 * @returns Transcription text, or null if Whisper is not installed or transcription fails.
 */
export async function transcribeAudio(audioPath: string): Promise<string | null> {
  try {
    const whisperPath = await findWhisper();
    if (!whisperPath) return null;

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
