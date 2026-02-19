import type { InboundMessage } from '../../types/message.js';

/** Maximum message length for WhatsApp responses */
export const WHATSAPP_MAX_LENGTH = 4096;

/** Parse a raw WhatsApp message into an InboundMessage */
export function parseWhatsAppMessage(
  id: string,
  sender: string,
  body: string,
  timestamp: number,
): InboundMessage {
  return {
    id,
    source: 'whatsapp',
    sender,
    rawContent: body,
    content: body, // Will be cleaned by AuthService
    timestamp: new Date(timestamp * 1000),
  };
}

/**
 * Split a response into WhatsApp-safe chunks (≤ WHATSAPP_MAX_LENGTH each).
 *
 * Splitting strategy (in order of preference):
 * 1. If content fits in a single message, return it as-is.
 * 2. Split on the last double-newline (paragraph break) within the limit.
 * 3. Split on the last single newline within the limit.
 * 4. Split on the last space (word boundary) within the limit.
 * 5. Hard-split at the limit as a last resort.
 *
 * Each chunk (except the last) gets a "[n/total]" suffix so the user
 * knows the message continues.
 */
export function splitForWhatsApp(content: string): string[] {
  if (content.length <= WHATSAPP_MAX_LENGTH) {
    return [content];
  }

  const chunks: string[] = [];
  let remaining = content;

  while (remaining.length > 0) {
    if (remaining.length <= WHATSAPP_MAX_LENGTH) {
      chunks.push(remaining);
      break;
    }

    // Reserve space for the part indicator suffix (e.g. "\n\n[3/10]")
    const reservedForSuffix = 12;
    const maxChunk = WHATSAPP_MAX_LENGTH - reservedForSuffix;

    const slice = remaining.slice(0, maxChunk);

    // Try split points from best to worst
    let splitAt = slice.lastIndexOf('\n\n');
    if (splitAt <= 0) splitAt = slice.lastIndexOf('\n');
    if (splitAt <= 0) splitAt = slice.lastIndexOf(' ');
    if (splitAt <= 0) splitAt = maxChunk;

    chunks.push(remaining.slice(0, splitAt));
    remaining = remaining.slice(splitAt).trimStart();
  }

  // If only one chunk after splitting (edge case), return as-is
  if (chunks.length === 1) {
    return chunks;
  }

  // Add part indicators
  const total = chunks.length;
  return chunks.map((chunk, i) => `${chunk}\n\n[${i + 1}/${total}]`);
}
