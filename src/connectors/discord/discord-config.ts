import { z } from 'zod/v3';

export const DiscordConfigSchema = z.object({
  /** Discord bot token from the Developer Portal */
  token: z.string().min(1, 'Discord bot token is required'),
});

export type DiscordConfig = z.infer<typeof DiscordConfigSchema>;
