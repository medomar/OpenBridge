import { describe, it, expect } from 'vitest';
import { splitMessage, PLATFORM_MAX_LENGTH } from '../../src/connectors/message-splitter.js';

describe('splitMessage()', () => {
  it('should return content as-is when under the limit', () => {
    const result = splitMessage('short message', 4096);
    expect(result).toEqual(['short message']);
  });

  it('should return content as-is when exactly at the limit', () => {
    const content = 'a'.repeat(4096);
    const result = splitMessage(content, 4096);
    expect(result).toEqual([content]);
  });

  it('should split on paragraph break (double newline) preferentially', () => {
    const para1 = 'a'.repeat(2000);
    const para2 = 'b'.repeat(2000);
    const para3 = 'c'.repeat(2000);
    const content = `${para1}\n\n${para2}\n\n${para3}`;
    const result = splitMessage(content, 4096);

    expect(result.length).toBeGreaterThan(1);
    // Each chunk (with possible part indicator) should be under the limit
    for (const chunk of result) {
      expect(chunk.length).toBeLessThanOrEqual(4096);
    }
  });

  it('should split on newline when no paragraph breaks available', () => {
    const line1 = 'a'.repeat(2000);
    const line2 = 'b'.repeat(2000);
    const line3 = 'c'.repeat(2000);
    const content = `${line1}\n${line2}\n${line3}`;
    const result = splitMessage(content, 4096);

    expect(result.length).toBeGreaterThan(1);
    for (const chunk of result) {
      expect(chunk.length).toBeLessThanOrEqual(4096);
    }
  });

  it('should split on space when no newlines available', () => {
    // Create content with words that exceed the limit
    const words = Array.from({ length: 500 }, (_, i) => `word${i.toString()}`);
    const content = words.join(' ');
    const result = splitMessage(content, 100);

    expect(result.length).toBeGreaterThan(1);
    for (const chunk of result) {
      expect(chunk.length).toBeLessThanOrEqual(100);
    }
  });

  it('should hard-split when no whitespace available', () => {
    const content = 'x'.repeat(200);
    const result = splitMessage(content, 100);

    expect(result.length).toBe(3); // 88 + 88 + 24 (with part indicators)
    for (const chunk of result) {
      expect(chunk.length).toBeLessThanOrEqual(100);
    }
  });

  it('should add [n/total] part indicators to all chunks', () => {
    const content = 'a'.repeat(5000);
    const result = splitMessage(content, 4096);

    expect(result.length).toBe(2);
    expect(result[0]).toMatch(/\[1\/2\]$/);
    expect(result[1]).toMatch(/\[2\/2\]$/);
  });

  it('should work correctly with Telegram limit (4096)', () => {
    const content = 'Hello world. '.repeat(400); // ~5200 chars
    const result = splitMessage(content, PLATFORM_MAX_LENGTH.telegram);

    expect(result.length).toBe(2);
    for (const chunk of result) {
      expect(chunk.length).toBeLessThanOrEqual(4096);
    }
  });

  it('should work correctly with Discord limit (2000)', () => {
    const content = 'Hello world. '.repeat(200); // ~2600 chars
    const result = splitMessage(content, PLATFORM_MAX_LENGTH.discord);

    expect(result.length).toBe(2);
    for (const chunk of result) {
      expect(chunk.length).toBeLessThanOrEqual(2000);
    }
  });

  it('should handle empty string', () => {
    const result = splitMessage('', 4096);
    expect(result).toEqual(['']);
  });

  it('should handle content that splits into exactly one chunk after processing', () => {
    // Edge case: content is slightly over limit but splits into one logical chunk
    const content = 'a'.repeat(4090) + '\n\n' + 'b'.repeat(5);
    const result = splitMessage(content, 4096);

    // Should split because total > 4096, but first chunk should contain the bulk
    expect(result.length).toBe(2);
  });
});

describe('PLATFORM_MAX_LENGTH', () => {
  it('should export correct platform limits', () => {
    expect(PLATFORM_MAX_LENGTH.whatsapp).toBe(4096);
    expect(PLATFORM_MAX_LENGTH.telegram).toBe(4096);
    expect(PLATFORM_MAX_LENGTH.discord).toBe(2000);
  });
});
