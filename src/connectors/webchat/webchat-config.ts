import { z } from 'zod';

export const WebChatConfigSchema = z.object({
  /** TCP port the HTTP + WebSocket server listens on */
  port: z.number().int().positive().default(3000),
  /** Hostname the server binds to */
  host: z.string().default('localhost'),
});

export type WebChatConfig = z.infer<typeof WebChatConfigSchema>;
