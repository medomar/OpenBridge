import { z } from 'zod';

export const TelegramConfigSchema = z.object({
  /** Telegram bot token from @BotFather */
  token: z.string().min(1, 'Telegram bot token is required'),
  /** Bot username (without @) — required for group mention detection */
  botUsername: z.string().optional(),
});

export type TelegramConfig = z.infer<typeof TelegramConfigSchema>;
