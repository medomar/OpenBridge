// WhatsApp connector tests are in tests/connectors/whatsapp/whatsapp-connector.test.ts
// The helpers below are tested indirectly; pure-function smoke tests live here.

import { describe, it, expect } from 'vitest';
import {
  parseWhatsAppMessage,
  truncateForWhatsApp,
  WHATSAPP_MAX_LENGTH,
} from '../../src/connectors/whatsapp/whatsapp-message.js';

describe('whatsapp-message helpers', () => {
  it('parseWhatsAppMessage returns a well-formed InboundMessage', () => {
    const ts = 1700000000;
    const msg = parseWhatsAppMessage('id1', '+1', 'hello', ts);
    expect(msg.source).toBe('whatsapp');
    expect(msg.timestamp.getTime()).toBe(ts * 1000);
  });

  it('truncateForWhatsApp leaves short content unchanged', () => {
    const short = 'ok';
    expect(truncateForWhatsApp(short)).toBe(short);
  });

  it('truncateForWhatsApp truncates and appends [truncated] for long content', () => {
    const long = 'x'.repeat(WHATSAPP_MAX_LENGTH + 1);
    const result = truncateForWhatsApp(long);
    expect(result.length).toBeLessThanOrEqual(WHATSAPP_MAX_LENGTH);
    expect(result).toContain('[truncated]');
  });
});
