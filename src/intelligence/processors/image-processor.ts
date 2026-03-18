/**
 * Image Processor — Extract text and data from images via AI vision + OCR
 *
 * Two extraction paths:
 * 1. AI vision: encode image as base64, spawn a read-only worker to describe
 *    the image and extract visible text, numbers, tables, and business data.
 * 2. OCR: use tesseract.js for pure text extraction.
 *
 * Both paths run concurrently. Results are combined — AI vision provides
 * richer descriptions while OCR provides reliable raw text extraction.
 */

import { readFile, stat } from 'fs/promises';
import { extname } from 'path';
import { createLogger } from '../../core/logger.js';
import type { ProcessorResult } from '../../types/intelligence.js';

const logger = createLogger('image-processor');

/** Maximum image file size (20 MB) — skip oversized files to avoid memory pressure */
const MAX_IMAGE_SIZE_BYTES = 20 * 1024 * 1024;

/** MIME type mapping for common image extensions */
const EXTENSION_TO_MIME: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.bmp': 'image/bmp',
  '.tiff': 'image/tiff',
  '.tif': 'image/tiff',
  '.webp': 'image/webp',
};

/** Minimal tesseract.js typings to avoid requiring @types at build time */
interface TesseractWorker {
  recognize(image: Buffer): Promise<{ data: { text: string; confidence: number } }>;
  terminate(): Promise<void>;
}

interface TesseractModule {
  createWorker(lang: string): Promise<TesseractWorker>;
}

/** Minimal AgentRunner typings for optional AI vision path */
interface AgentRunnerResult {
  stdout: string;
  exitCode: number;
}

interface AgentRunnerLike {
  spawn(opts: {
    prompt: string;
    workspacePath: string;
    model?: string;
    allowedTools?: string[];
    maxTurns?: number;
    timeout?: number;
    retries?: number;
  }): Promise<AgentRunnerResult>;
}

/**
 * Infer MIME type from file extension.
 */
function getMimeType(filePath: string): string {
  const ext = extname(filePath).toLowerCase();
  return EXTENSION_TO_MIME[ext] ?? 'application/octet-stream';
}

/**
 * OCR path — extract text from image using tesseract.js.
 * Returns the recognized text and confidence score.
 */
async function ocrExtract(imageBuffer: Buffer): Promise<{ text: string; confidence: number }> {
  let Tesseract: TesseractModule;
  try {
    const mod = (await import('tesseract.js')) as unknown as {
      default?: TesseractModule;
    } & TesseractModule;
    Tesseract = mod.default ?? mod;
  } catch {
    throw new Error(
      'tesseract.js is not installed. Run `npm install tesseract.js` to enable image OCR.',
    );
  }

  const worker = await Tesseract.createWorker('eng');
  try {
    const { data } = await worker.recognize(imageBuffer);
    return { text: data.text, confidence: data.confidence };
  } finally {
    await worker.terminate();
  }
}

/**
 * AI vision path — encode image as base64 and spawn a read-only worker
 * to describe the image and extract visible business data.
 */
async function aiVisionExtract(
  imageBuffer: Buffer,
  filePath: string,
  mimeType: string,
): Promise<string | null> {
  let AgentRunner: new () => AgentRunnerLike;
  try {
    const mod = (await import('../../core/agent-runner.js')) as {
      AgentRunner: new () => AgentRunnerLike;
    };
    AgentRunner = mod.AgentRunner;
  } catch {
    logger.debug('AgentRunner not available, skipping AI vision path');
    return null;
  }

  const base64 = imageBuffer.toString('base64');
  const dataUri = `data:${mimeType};base64,${base64}`;

  const prompt = [
    'Describe this image and extract any text, numbers, tables, or business data visible.',
    'If you see a table, format it as markdown.',
    'If you see text, reproduce it exactly.',
    '',
    `Image (base64 data URI): ${dataUri}`,
    '',
    `File: ${filePath}`,
  ].join('\n');

  const runner = new AgentRunner();
  try {
    const result = await runner.spawn({
      prompt,
      workspacePath: '.',
      allowedTools: ['Read', 'Glob', 'Grep'],
      maxTurns: 3,
      // Sonnet-class models need 90-130s for image analysis (OB-F206)
      timeout: 180_000,
      retries: 0,
    });

    if (result.exitCode === 0 && result.stdout.trim().length > 0) {
      return result.stdout.trim();
    }

    logger.debug(
      { exitCode: result.exitCode, outputLen: result.stdout.length },
      'AI vision worker returned no useful output',
    );
    return null;
  } catch (err) {
    logger.debug({ err, filePath }, 'AI vision extraction failed, falling back to OCR only');
    return null;
  }
}

/**
 * Process an image file and extract text content via OCR and optional AI vision.
 *
 * @param filePath - Absolute path to the image file
 * @returns ProcessorResult with rawText, metadata (dimensions, OCR confidence, AI description)
 */
export async function processImage(filePath: string): Promise<ProcessorResult> {
  // Validate file size
  const fileStat = await stat(filePath);
  if (fileStat.size > MAX_IMAGE_SIZE_BYTES) {
    throw new Error(
      `Image file exceeds ${MAX_IMAGE_SIZE_BYTES / (1024 * 1024)} MB limit: ${fileStat.size} bytes`,
    );
  }

  const imageBuffer = await readFile(filePath);
  const mimeType = getMimeType(filePath);

  const metadata: Record<string, unknown> = {
    mimeType,
    fileSize: fileStat.size,
  };

  // Run OCR and AI vision concurrently
  const [ocrResult, aiDescription] = await Promise.all([
    ocrExtract(imageBuffer).catch((err) => {
      logger.warn({ err, filePath }, 'OCR extraction failed');
      metadata['ocrError'] = err instanceof Error ? err.message : String(err);
      return null;
    }),
    aiVisionExtract(imageBuffer, filePath, mimeType).catch((err) => {
      logger.debug({ err, filePath }, 'AI vision extraction failed');
      return null;
    }),
  ]);

  // Build raw text from available results
  const textParts: string[] = [];

  if (aiDescription) {
    textParts.push(aiDescription);
    metadata['aiVisionApplied'] = true;
  }

  if (ocrResult) {
    const ocrText = ocrResult.text.trim();
    metadata['ocrApplied'] = true;
    metadata['ocrConfidence'] = ocrResult.confidence;

    if (ocrText.length > 0) {
      // If we already have AI description, append OCR text under a heading
      if (aiDescription) {
        textParts.push(`\n--- OCR Text ---\n${ocrText}`);
      } else {
        textParts.push(ocrText);
      }
    }
  }

  const rawText = textParts.join('\n');

  if (rawText.length === 0) {
    logger.warn({ filePath }, 'No text extracted from image via OCR or AI vision');
    metadata['extractionFailed'] = true;
  }

  logger.info(
    {
      filePath,
      textLength: rawText.length,
      ocrApplied: !!ocrResult,
      aiVisionApplied: !!aiDescription,
    },
    'Image processing complete',
  );

  return {
    rawText,
    tables: [],
    images: [{ filePath, mimeType, size: fileStat.size }],
    metadata,
  };
}
