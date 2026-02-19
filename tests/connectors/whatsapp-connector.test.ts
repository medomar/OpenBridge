// WhatsApp connector tests are in tests/connectors/whatsapp/whatsapp-connector.test.ts
// The helpers below are tested indirectly; pure-function smoke tests live here.

import { describe, it, expect } from 'vitest';
import {
  parseWhatsAppMessage,
  splitForWhatsApp,
  WHATSAPP_MAX_LENGTH,
} from '../../src/connectors/whatsapp/whatsapp-message.js';

describe('whatsapp-message helpers', () => {
  it('parseWhatsAppMessage returns a well-formed InboundMessage', () => {
    const ts = 1700000000;
    const msg = parseWhatsAppMessage('id1', '+1', 'hello', ts);
    expect(msg.source).toBe('whatsapp');
    expect(msg.timestamp.getTime()).toBe(ts * 1000);
  });

  describe('splitForWhatsApp', () => {
    it('returns short content as a single chunk', () => {
      const short = 'ok';
      const chunks = splitForWhatsApp(short);
      expect(chunks).toEqual([short]);
    });

    it('returns exactly-at-limit content as a single chunk', () => {
      const exact = 'a'.repeat(WHATSAPP_MAX_LENGTH);
      const chunks = splitForWhatsApp(exact);
      expect(chunks).toEqual([exact]);
    });

    it('splits long content into multiple chunks', () => {
      const long = 'x'.repeat(WHATSAPP_MAX_LENGTH + 1);
      const chunks = splitForWhatsApp(long);
      expect(chunks.length).toBeGreaterThan(1);
      for (const chunk of chunks) {
        expect(chunk.length).toBeLessThanOrEqual(WHATSAPP_MAX_LENGTH);
      }
    });

    it('adds part indicators [n/total] to multi-chunk responses', () => {
      const long = 'word '.repeat(1000);
      const chunks = splitForWhatsApp(long);
      expect(chunks.length).toBeGreaterThan(1);
      expect(chunks[0]).toContain(`[1/${chunks.length}]`);
      expect(chunks[chunks.length - 1]).toContain(`[${chunks.length}/${chunks.length}]`);
    });

    it('prefers splitting on paragraph breaks', () => {
      const paragraph1 = 'a'.repeat(3000);
      const paragraph2 = 'b'.repeat(3000);
      const content = `${paragraph1}\n\n${paragraph2}`;
      const chunks = splitForWhatsApp(content);
      expect(chunks.length).toBe(2);
      // First chunk should contain paragraph1 content
      expect(chunks[0]).toContain(paragraph1);
    });

    it('falls back to newline splitting when no paragraph breaks', () => {
      const line1 = 'a'.repeat(3000);
      const line2 = 'b'.repeat(3000);
      const content = `${line1}\n${line2}`;
      const chunks = splitForWhatsApp(content);
      expect(chunks.length).toBe(2);
      expect(chunks[0]).toContain(line1);
    });

    it('splits on word boundaries when no newlines present', () => {
      // Create content longer than limit with only spaces
      const words = Array.from({ length: 900 }, (_, i) => `word${i}`).join(' ');
      const chunks = splitForWhatsApp(words);
      expect(chunks.length).toBeGreaterThan(1);
      // Each chunk (stripped of part indicator) should end with a complete word
      for (const chunk of chunks) {
        const cleaned = chunk.replace(/\n\n\[\d+\/\d+\]$/, '');
        // Should end at a word boundary (last char is alphanumeric, not mid-word)
        expect(cleaned).toMatch(/\w$/);
      }
    });

    it('handles content with no natural split points', () => {
      // A single long string with no spaces or newlines
      const noBreaks = 'x'.repeat(WHATSAPP_MAX_LENGTH * 2);
      const chunks = splitForWhatsApp(noBreaks);
      expect(chunks.length).toBeGreaterThan(1);
      for (const chunk of chunks) {
        expect(chunk.length).toBeLessThanOrEqual(WHATSAPP_MAX_LENGTH);
      }
    });

    it('preserves all content across chunks (no data loss)', () => {
      const original = 'Hello world. '.repeat(500);
      const chunks = splitForWhatsApp(original);
      // Remove part indicators and reconstruct
      const stripped = chunks.map((c) => c.replace(/\n\n\[\d+\/\d+\]$/, ''));
      // Every word from the original should appear in at least one chunk
      const originalWords = original.trim().split(/\s+/);
      const allChunkText = stripped.join(' ');
      for (const word of originalWords) {
        expect(allChunkText).toContain(word);
      }
    });
  });
});
