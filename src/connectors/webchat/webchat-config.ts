import { z } from 'zod';

/**
 * Schema for validating the PUT /api/webchat/settings request body.
 */
export const WebchatSettingsPutSchema = z.object({
  profile: z.enum(['fast', 'thorough', 'manual']),
});

export type WebchatSettingsPut = z.infer<typeof WebchatSettingsPutSchema>;

export const WebChatConfigSchema = z.object({
  /** TCP port the HTTP + WebSocket server listens on */
  port: z.number().int().positive().default(3000),
  /** Hostname the server binds to — defaults to 0.0.0.0 for LAN access. Use localhost to restrict to local machine only */
  host: z.string().default('0.0.0.0'),
  /**
   * Optional password for WebChat access.
   * When set, token-based auth is replaced by a password login screen.
   * The value is hashed with bcrypt before being stored or compared.
   */
  password: z.string().min(1).optional(),
});

export type WebChatConfig = z.infer<typeof WebChatConfigSchema>;
