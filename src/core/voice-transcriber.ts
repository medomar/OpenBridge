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
