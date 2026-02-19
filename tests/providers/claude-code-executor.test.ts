import { describe, it, expect } from 'vitest';
import { sanitizePrompt } from '../../src/providers/claude-code/claude-code-executor.js';

describe('sanitizePrompt', () => {
  it('passes through normal text unchanged', () => {
    expect(sanitizePrompt('hello world')).toBe('hello world');
  });

  it('preserves tabs, newlines, and carriage returns', () => {
    expect(sanitizePrompt('line1\nline2\r\n\ttabbed')).toBe('line1\nline2\r\n\ttabbed');
  });

  it('strips null bytes', () => {
    expect(sanitizePrompt('hello\x00world')).toBe('helloworld');
  });

  it('strips ASCII control characters except whitespace', () => {
    // \x01–\x08 and \x0E–\x1F are stripped; \x09 \x0A \x0D are kept
    expect(sanitizePrompt('\x01\x07\x08\x0E\x1F')).toBe('');
    expect(sanitizePrompt('\x0B\x0C')).toBe(''); // vertical tab and form feed are stripped
  });

  it('preserves shell metacharacters (safe because spawn is used)', () => {
    const input = 'what does `rm -rf /` do?';
    expect(sanitizePrompt(input)).toBe(input);
  });

  it('truncates prompts exceeding the maximum length', () => {
    const long = 'a'.repeat(40_000);
    const result = sanitizePrompt(long);
    expect(result.length).toBe(32_768);
  });

  it('returns a non-truncated prompt that is exactly at the limit', () => {
    const exact = 'a'.repeat(32_768);
    expect(sanitizePrompt(exact)).toBe(exact);
  });
});
