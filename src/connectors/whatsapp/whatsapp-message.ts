import type { InboundMessage } from '../../types/message.js';
import { splitMessage, PLATFORM_MAX_LENGTH } from '../message-splitter.js';

/** Maximum message length for WhatsApp responses */
export const WHATSAPP_MAX_LENGTH = PLATFORM_MAX_LENGTH.whatsapp;

/** Parse a raw WhatsApp message into an InboundMessage */
export function parseWhatsAppMessage(
  id: string,
  sender: string,
  body: string,
  timestamp: number,
  attachments?: InboundMessage['attachments'],
): InboundMessage {
  return {
    id,
    source: 'whatsapp',
    sender,
    rawContent: body,
    content: body, // Will be cleaned by AuthService
    timestamp: new Date(timestamp * 1000),
    ...(attachments !== undefined && { attachments }),
  };
}

/**
 * Split a response into WhatsApp-safe chunks (≤ WHATSAPP_MAX_LENGTH each).
 * Delegates to the shared splitMessage() utility.
 */
export function splitForWhatsApp(content: string): string[] {
  return splitMessage(content, WHATSAPP_MAX_LENGTH);
}
