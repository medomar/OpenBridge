import { z } from 'zod';

/** Schema for a connector configuration */
export const ConnectorConfigSchema = z.object({
  type: z.string(),
  enabled: z.boolean().default(true),
  options: z.record(z.unknown()).default({}),
});

/** Schema for a provider configuration */
export const ProviderConfigSchema = z.object({
  type: z.string(),
  enabled: z.boolean().default(true),
  options: z.record(z.unknown()).default({}),
});

/** Schema for rate limit configuration */
export const RateLimitConfigSchema = z.object({
  enabled: z.boolean().default(true),
  maxMessages: z.number().int().positive().default(10),
  windowMs: z.number().int().positive().default(60_000),
});

/** Schema for auth configuration */
export const AuthConfigSchema = z.object({
  whitelist: z.array(z.string()).default([]),
  prefix: z.string().default('/ai'),
  rateLimit: RateLimitConfigSchema.default({}),
});

/** Schema for queue retry configuration */
export const QueueConfigSchema = z.object({
  maxRetries: z.number().int().nonnegative().default(3),
  retryDelayMs: z.number().int().positive().default(1_000),
});

/** Root configuration schema */
export const AppConfigSchema = z.object({
  connectors: z.array(ConnectorConfigSchema).min(1),
  providers: z.array(ProviderConfigSchema).min(1),
  defaultProvider: z.string(),
  auth: AuthConfigSchema,
  queue: QueueConfigSchema.default({}),
  logLevel: z.enum(['trace', 'debug', 'info', 'warn', 'error', 'fatal']).default('info'),
});

export type ConnectorConfig = z.infer<typeof ConnectorConfigSchema>;
export type ProviderConfig = z.infer<typeof ProviderConfigSchema>;
export type RateLimitConfig = z.infer<typeof RateLimitConfigSchema>;
export type AuthConfig = z.infer<typeof AuthConfigSchema>;
export type QueueConfig = z.infer<typeof QueueConfigSchema>;
export type AppConfig = z.infer<typeof AppConfigSchema>;
