/**
 * Tests for result-parser.ts
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { z } from 'zod/v3';
import { parseAIResult, parseAIResultWithRetry } from '../../src/master/result-parser.js';

describe('parseAIResult', () => {
  describe('Direct JSON parsing', () => {
    it('should parse clean JSON successfully', () => {
      const output = JSON.stringify({ type: 'project', framework: 'Node.js' });
      const result = parseAIResult<{ type: string; framework: string }>(output, 'test');

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data).toEqual({ type: 'project', framework: 'Node.js' });
        expect(result.method).toBe('direct');
      }
    });

    it('should parse JSON with whitespace', () => {
      const output = '  \n\n  {"status":"ready"}  \n  ';
      const result = parseAIResult<{ status: string }>(output, 'test');

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data).toEqual({ status: 'ready' });
        expect(result.method).toBe('direct');
      }
    });

    it('should parse complex nested JSON', () => {
      const output = JSON.stringify({
        project: {
          name: 'OpenBridge',
          structure: {
            dirs: ['src', 'tests'],
            files: ['package.json', 'tsconfig.json'],
          },
        },
      });
      const result = parseAIResult(output, 'test');

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data).toHaveProperty('project.name', 'OpenBridge');
        expect(result.data).toHaveProperty('project.structure.dirs');
        expect(result.method).toBe('direct');
      }
    });
  });

  describe('Markdown fence extraction', () => {
    it('should extract JSON from markdown code fence with json label', () => {
      const output = `
Here's the result:

\`\`\`json
{
  "type": "typescript",
  "framework": "express"
}
\`\`\`

Done!
      `;
      const result = parseAIResult<{ type: string; framework: string }>(output, 'test');

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data).toEqual({ type: 'typescript', framework: 'express' });
        expect(result.method).toBe('markdown');
      }
    });

    it('should extract JSON from markdown code fence without language label', () => {
      const output = `
Result:
\`\`\`
{"status":"completed","files":42}
\`\`\`
      `;
      const result = parseAIResult<{ status: string; files: number }>(output, 'test');

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data).toEqual({ status: 'completed', files: 42 });
        expect(result.method).toBe('markdown');
      }
    });

    it('should handle markdown fence with extra whitespace', () => {
      const output = `
\`\`\`json

  {
    "value": "test"
  }

\`\`\`
      `;
      const result = parseAIResult<{ value: string }>(output, 'test');

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data).toEqual({ value: 'test' });
        expect(result.method).toBe('markdown');
      }
    });
  });

  describe('Regex extraction', () => {
    it('should extract first JSON object from text', () => {
      const output = `
The analysis is complete. Here are the results:
{"projectType":"Node.js","hasTests":true}
Additional notes follow...
      `;
      const result = parseAIResult<{ projectType: string; hasTests: boolean }>(output, 'test');

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data).toEqual({ projectType: 'Node.js', hasTests: true });
        expect(result.method).toBe('regex');
      }
    });

    it('should handle nested objects in regex extraction', () => {
      const output = `
Prefix text
{"outer":{"inner":{"value":"nested"}}}
Suffix text
      `;
      const result = parseAIResult<{ outer: { inner: { value: string } } }>(output, 'test');

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data).toEqual({ outer: { inner: { value: 'nested' } } });
        expect(result.method).toBe('regex');
      }
    });

    it('should handle JSON with string containing braces', () => {
      const output = `
Some text before
{"message":"This {string} has {braces}","count":3}
Some text after
      `;
      const result = parseAIResult<{ message: string; count: number }>(output, 'test');

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data).toEqual({ message: 'This {string} has {braces}', count: 3 });
        expect(result.method).toBe('regex');
      }
    });

    it('should handle JSON with escaped quotes', () => {
      const output = `
Text before
{"text":"He said \\"hello\\"","valid":true}
Text after
      `;
      const result = parseAIResult<{ text: string; valid: boolean }>(output, 'test');

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data).toEqual({ text: 'He said "hello"', valid: true });
        expect(result.method).toBe('regex');
      }
    });
  });

  describe('Error cases', () => {
    it('should return error for completely invalid output', () => {
      const output = 'This is not JSON at all';
      const result = parseAIResult(output, 'test');

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error).toContain('Could not extract valid JSON');
        expect(result.rawOutput).toBe(output);
      }
    });

    it('should return error for malformed JSON', () => {
      const output = '{invalid json: missing quotes}';
      const result = parseAIResult(output, 'test');

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error).toContain('Could not extract valid JSON');
      }
    });

    it('should return error for unclosed braces', () => {
      const output = '{"key":"value"';
      const result = parseAIResult(output, 'test');

      expect(result.success).toBe(false);
    });

    it('should truncate long output in error message', () => {
      const output = 'x'.repeat(500);
      const result = parseAIResult(output, 'test');

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.rawOutput.length).toBe(500);
      }
    });
  });

  describe('Schema validation', () => {
    const TestSchema = z.object({
      name: z.string(),
      count: z.number(),
    });

    it('should validate parsed JSON against schema when schema is provided', () => {
      const output = JSON.stringify({ name: 'test', count: 42 });
      const result = parseAIResult(output, 'test', TestSchema);

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data).toEqual({ name: 'test', count: 42 });
      }
    });

    it('should return ParseError when schema validation fails', () => {
      const output = JSON.stringify({ name: 'test', count: 'not-a-number' });
      const result = parseAIResult(output, 'test', TestSchema);

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error).toContain('Schema validation failed');
        expect(result.rawOutput).toBe(output);
      }
    });

    it('should return ParseError when required schema field is missing', () => {
      const output = JSON.stringify({ name: 'test' }); // missing count
      const result = parseAIResult(output, 'test', TestSchema);

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error).toContain('Schema validation failed');
      }
    });

    it('should work without schema (backward compat) — returns success for valid JSON', () => {
      const output = JSON.stringify({ anything: true });
      const result = parseAIResult(output, 'test');

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data).toEqual({ anything: true });
      }
    });

    it('should validate after markdown fence extraction when schema provided', () => {
      const output = `
Here is the result:
\`\`\`json
{"name":"markdown","count":7}
\`\`\`
      `;
      const result = parseAIResult(output, 'test', TestSchema);

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data).toEqual({ name: 'markdown', count: 7 });
        expect(result.method).toBe('markdown');
      }
    });

    it('should return ParseError when markdown-extracted JSON fails schema validation', () => {
      const output = `
\`\`\`json
{"name":"markdown","count":"wrong-type"}
\`\`\`
      `;
      const result = parseAIResult(output, 'test', TestSchema);

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error).toContain('Schema validation failed');
      }
    });

    it('should validate after regex extraction when schema provided', () => {
      const output = `Some prefix text {"name":"regex","count":99} some suffix`;
      const result = parseAIResult(output, 'test', TestSchema);

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data).toEqual({ name: 'regex', count: 99 });
        expect(result.method).toBe('regex');
      }
    });
  });

  describe('Strategy priority', () => {
    it('should prefer direct parsing over markdown when both are valid', () => {
      const output = `{"direct":true}`;
      const result = parseAIResult<{ direct: boolean }>(output, 'test');

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.method).toBe('direct');
      }
    });

    it('should fall back to markdown when direct parsing fails', () => {
      const output = `
Invalid direct JSON {nope}
\`\`\`json
{"markdown":true}
\`\`\`
      `;
      const result = parseAIResult<{ markdown: boolean }>(output, 'test');

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.method).toBe('markdown');
        expect(result.data).toEqual({ markdown: true });
      }
    });

    it('should fall back to regex when markdown fails', () => {
      const output = `
Invalid direct JSON {nope}
\`\`\`json
{also invalid}
\`\`\`
But here's valid: {"regex":true}
      `;
      const result = parseAIResult<{ regex: boolean }>(output, 'test');

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.method).toBe('regex');
        expect(result.data).toEqual({ regex: true });
      }
    });
  });
});

describe('parseAIResultWithRetry', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it('should succeed on first attempt', async () => {
    const executeFn = vi.fn().mockResolvedValue('{"success":true}');

    const resultPromise = parseAIResultWithRetry<{ success: boolean }>(executeFn, 'test');
    await vi.runAllTimersAsync();
    const result = await resultPromise;

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toEqual({ success: true });
    }
    expect(executeFn).toHaveBeenCalledTimes(1);
  });

  it('should retry on parse failure and eventually succeed', async () => {
    const executeFn = vi
      .fn()
      .mockResolvedValueOnce('invalid output')
      .mockResolvedValueOnce('still invalid')
      .mockResolvedValue('{"success":true}');

    const resultPromise = parseAIResultWithRetry<{ success: boolean }>(executeFn, 'test', 3);
    await vi.runAllTimersAsync();
    const result = await resultPromise;

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toEqual({ success: true });
    }
    expect(executeFn).toHaveBeenCalledTimes(3);
  });

  it('should return error after max retries exhausted', async () => {
    const executeFn = vi.fn().mockResolvedValue('invalid output');

    const resultPromise = parseAIResultWithRetry(executeFn, 'test', 3);
    await vi.runAllTimersAsync();
    const result = await resultPromise;

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toContain('Could not extract valid JSON');
    }
    expect(executeFn).toHaveBeenCalledTimes(3);
  });

  it('should handle execution errors and retry', async () => {
    const executeFn = vi
      .fn()
      .mockRejectedValueOnce(new Error('Network error'))
      .mockResolvedValue('{"recovered":true}');

    const resultPromise = parseAIResultWithRetry<{ recovered: boolean }>(executeFn, 'test', 2);
    await vi.runAllTimersAsync();
    const result = await resultPromise;

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toEqual({ recovered: true });
    }
    expect(executeFn).toHaveBeenCalledTimes(2);
  });

  it('should return error after all execution retries fail', async () => {
    const executeFn = vi.fn().mockRejectedValue(new Error('Persistent error'));

    const resultPromise = parseAIResultWithRetry(executeFn, 'test', 3);
    await vi.runAllTimersAsync();
    const result = await resultPromise;

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toContain('AI command execution failed');
      expect(result.error).toContain('Persistent error');
    }
    expect(executeFn).toHaveBeenCalledTimes(3);
  });

  it('should use exponential backoff between retries', async () => {
    const executeFn = vi
      .fn()
      .mockResolvedValueOnce('invalid')
      .mockResolvedValueOnce('invalid')
      .mockResolvedValue('{"done":true}');

    const resultPromise = parseAIResultWithRetry(executeFn, 'test', 3);

    // First attempt happens immediately
    await vi.advanceTimersByTimeAsync(0);
    expect(executeFn).toHaveBeenCalledTimes(1);

    // Second attempt after 1000ms (2^0 * 1000)
    await vi.advanceTimersByTimeAsync(1000);
    expect(executeFn).toHaveBeenCalledTimes(2);

    // Third attempt after 2000ms (2^1 * 1000)
    await vi.advanceTimersByTimeAsync(2000);
    expect(executeFn).toHaveBeenCalledTimes(3);

    const result = await resultPromise;
    expect(result.success).toBe(true);
  });

  it('should respect custom maxRetries parameter', async () => {
    const executeFn = vi.fn().mockResolvedValue('invalid');

    const resultPromise = parseAIResultWithRetry(executeFn, 'test', 5);
    await vi.runAllTimersAsync();
    await resultPromise;

    expect(executeFn).toHaveBeenCalledTimes(5);
  });

  it('should default to 3 retries when maxRetries not specified', async () => {
    const executeFn = vi.fn().mockResolvedValue('invalid');

    const resultPromise = parseAIResultWithRetry(executeFn, 'test');
    await vi.runAllTimersAsync();
    await resultPromise;

    expect(executeFn).toHaveBeenCalledTimes(3);
  });
});
