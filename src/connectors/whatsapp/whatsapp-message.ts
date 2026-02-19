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

/** Truncate a response to fit WhatsApp's message limits */
export function truncateForWhatsApp(content: string): string {
  if (content.length <= WHATSAPP_MAX_LENGTH) {
    return content;
  }
  const truncated = content.slice(0, WHATSAPP_MAX_LENGTH - 20);
  return `${truncated}\n\n[truncated]`;
}
