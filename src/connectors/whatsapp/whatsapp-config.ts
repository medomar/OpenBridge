import { z } from 'zod';

export const WhatsAppConfigSchema = z.object({
  sessionName: z.string().default('openbridge-default'),
});

export type WhatsAppConfig = z.infer<typeof WhatsAppConfigSchema>;
