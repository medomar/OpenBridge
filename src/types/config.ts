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

/** Schema for auth configuration */
export const AuthConfigSchema = z.object({
  whitelist: z.array(z.string()).default([]),
  prefix: z.string().default('/ai'),
});

/** Root configuration schema */
export const AppConfigSchema = z.object({
  connectors: z.array(ConnectorConfigSchema).min(1),
  providers: z.array(ProviderConfigSchema).min(1),
  defaultProvider: z.string(),
  auth: AuthConfigSchema,
  logLevel: z.enum(['trace', 'debug', 'info', 'warn', 'error', 'fatal']).default('info'),
});

export type ConnectorConfig = z.infer<typeof ConnectorConfigSchema>;
export type ProviderConfig = z.infer<typeof ProviderConfigSchema>;
export type AuthConfig = z.infer<typeof AuthConfigSchema>;
export type AppConfig = z.infer<typeof AppConfigSchema>;
