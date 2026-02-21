/**
 * Result Parser — Robust JSON extraction from AI output
 *
 * AI responses aren't always clean JSON. This module implements progressive fallback strategies:
 * 1. Direct JSON.parse() on the full stdout
 * 2. Extract from markdown code fences (```json ... ```)
 * 3. Regex extraction of first {...} block
 * 4. Return parse error for retry handling
 */

import { createLogger } from '../core/logger.js';

const logger = createLogger('result-parser');

export interface ParseResult<T> {
  success: true;
  data: T;
  method: 'direct' | 'markdown' | 'regex';
}

export interface ParseError {
  success: false;
  error: string;
  rawOutput: string;
}

export type ParsedAIResult<T> = ParseResult<T> | ParseError;

/**
 * Parse AI output to extract JSON result
 *
 * @param stdout - Raw output from AI command
 * @param label - Human-readable label for logging (e.g., "structure scan")
 * @returns Parsed result or error
 */
export function parseAIResult<T>(stdout: string, label: string): ParsedAIResult<T> {
  // Strategy 1: Direct JSON.parse()
  try {
    const data = JSON.parse(stdout) as T;
    logger.debug({ label, method: 'direct' }, 'AI result parsed successfully (direct)');
    return { success: true, data, method: 'direct' };
  } catch (directError) {
    logger.debug(
      { label, error: String(directError) },
      'Direct JSON parse failed, trying markdown extraction',
    );
  }

  // Strategy 2: Extract from markdown code fences
  const markdownMatch = stdout.match(/```(?:json)?\s*\n([\s\S]*?)\n```/);
  if (markdownMatch?.[1]) {
    try {
      const data = JSON.parse(markdownMatch[1]) as T;
      logger.debug({ label, method: 'markdown' }, 'AI result parsed successfully (markdown fence)');
      return { success: true, data, method: 'markdown' };
    } catch (markdownError) {
      logger.debug(
        { label, error: String(markdownError) },
        'Markdown fence extraction failed, trying regex',
      );
    }
  }

  // Strategy 3: Regex extraction - try all {...} blocks
  // Find all potential JSON blocks and try parsing each one
  let searchStart = 0;
  while (searchStart < stdout.length) {
    const braceIndex = stdout.indexOf('{', searchStart);
    if (braceIndex === -1) break;

    let braceCount = 0;
    let inString = false;
    let escapeNext = false;

    for (let i = braceIndex; i < stdout.length; i++) {
      const char = stdout[i];

      if (escapeNext) {
        escapeNext = false;
        continue;
      }

      if (char === '\\') {
        escapeNext = true;
        continue;
      }

      if (char === '"') {
        inString = !inString;
        continue;
      }

      if (!inString) {
        if (char === '{') {
          braceCount++;
        } else if (char === '}') {
          braceCount--;
          if (braceCount === 0) {
            // Found matching closing brace
            const jsonCandidate = stdout.slice(braceIndex, i + 1);
            try {
              const data = JSON.parse(jsonCandidate) as T;
              logger.debug(
                { label, method: 'regex' },
                'AI result parsed successfully (regex extraction)',
              );
              return { success: true, data, method: 'regex' };
            } catch (regexError) {
              logger.debug(
                { label, error: String(regexError) },
                'Regex extraction failed for candidate, trying next',
              );
              // Continue searching after this block
              searchStart = i + 1;
              break;
            }
          }
        }
      }
    }

    // If we didn't find a closing brace, move past this opening brace
    if (braceCount !== 0) {
      searchStart = braceIndex + 1;
    }
  }

  // All strategies failed
  const truncatedOutput = stdout.length > 200 ? `${stdout.slice(0, 200)}...` : stdout;
  logger.warn(
    { label, outputLength: stdout.length, truncatedOutput },
    'All JSON extraction strategies failed',
  );

  return {
    success: false,
    error:
      'Could not extract valid JSON from AI output using any strategy (direct, markdown, regex)',
    rawOutput: stdout,
  };
}

/**
 * Parse AI result with automatic retry logic
 *
 * @param executeFn - Function that executes the AI command and returns stdout
 * @param label - Human-readable label for logging
 * @param maxRetries - Maximum number of retry attempts (default: 3)
 * @returns Parsed result or final error after all retries
 */
export async function parseAIResultWithRetry<T>(
  executeFn: () => Promise<string>,
  label: string,
  maxRetries: number = 3,
): Promise<ParsedAIResult<T>> {
  let lastError: ParseError | null = null;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    logger.debug({ label, attempt, maxRetries }, 'Executing AI command');

    try {
      const stdout = await executeFn();
      const result = parseAIResult<T>(stdout, label);

      if (result.success) {
        return result;
      }

      lastError = result;

      if (attempt < maxRetries) {
        logger.info({ label, attempt, maxRetries }, 'Parse failed, retrying...');
        // Exponential backoff: 1s, 2s, 4s
        await new Promise((resolve) => setTimeout(resolve, 1000 * Math.pow(2, attempt - 1)));
      }
    } catch (execError) {
      logger.error({ label, attempt, error: String(execError) }, 'AI command execution failed');

      lastError = {
        success: false,
        error: `AI command execution failed: ${String(execError)}`,
        rawOutput: '',
      };

      if (attempt < maxRetries) {
        logger.info({ label, attempt, maxRetries }, 'Execution failed, retrying...');
        await new Promise((resolve) => setTimeout(resolve, 1000 * Math.pow(2, attempt - 1)));
      }
    }
  }

  logger.error({ label, maxRetries }, 'All retry attempts exhausted');
  return lastError!;
}
