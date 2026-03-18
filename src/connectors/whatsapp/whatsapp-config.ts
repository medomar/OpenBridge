import { z } from 'zod/v3';

export const WhatsAppConfigSchema = z.object({
  sessionName: z.string().default('openbridge-default'),
  sessionPath: z.string().optional(),
  headless: z.boolean().default(true),
  reconnect: z
    .object({
      enabled: z.boolean().default(true),
      maxAttempts: z.number().int().min(0).default(10),
      initialDelayMs: z.number().int().min(0).default(2000),
      maxDelayMs: z.number().int().min(0).default(60000),
      backoffFactor: z.number().min(1).default(2),
    })
    .default({}),
});

export type WhatsAppConfig = z.infer<typeof WhatsAppConfigSchema>;
