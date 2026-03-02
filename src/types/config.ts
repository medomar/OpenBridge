import { z } from 'zod';

/** Schema for a connector configuration */
export const ConnectorConfigSchema = z.object({
  type: z.string(),
  enabled: z.boolean().default(true),
  options: z.record(z.unknown()).default({}),
});

/** Schema for a workspace configuration entry */
export const WorkspaceConfigSchema = z.object({
  name: z.string().min(1),
  path: z.string().min(1),
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

/** Schema for command filter configuration */
export const CommandFilterConfigSchema = z.object({
  allowPatterns: z.array(z.string()).default([]),
  denyPatterns: z.array(z.string()).default([]),
  denyMessage: z.string().default('That command is not allowed.'),
});

/** Schema for auth configuration */
export const AuthConfigSchema = z.object({
  whitelist: z.array(z.string()).default([]),
  prefix: z.string().default('/ai'),
  rateLimit: RateLimitConfigSchema.default({}),
  commandFilter: CommandFilterConfigSchema.default({}),
});

/** Schema for queue retry configuration */
export const QueueConfigSchema = z.object({
  maxRetries: z.number().int().nonnegative().default(3),
  retryDelayMs: z.number().int().positive().default(1_000),
});

/** Schema for router configuration */
export const RouterConfigSchema = z.object({
  progressIntervalMs: z.number().int().positive().default(15_000),
});

/** Schema for audit log configuration */
export const AuditConfigSchema = z.object({
  enabled: z.boolean().default(false),
  logPath: z.string().default('audit.log'),
});

/** Schema for health check endpoint configuration */
export const HealthConfigSchema = z.object({
  enabled: z.boolean().default(false),
  port: z.number().int().positive().default(8080),
});

/** Schema for metrics endpoint configuration */
export const MetricsConfigSchema = z.object({
  enabled: z.boolean().default(false),
  port: z.number().int().positive().default(9090),
});

/** Root configuration schema */
export const AppConfigSchema = z
  .object({
    connectors: z.array(ConnectorConfigSchema).min(1),
    providers: z.array(ProviderConfigSchema).min(1),
    defaultProvider: z.string(),
    workspaces: z.array(WorkspaceConfigSchema).default([]),
    defaultWorkspace: z.string().optional(),
    auth: AuthConfigSchema,
    queue: QueueConfigSchema.default({}),
    router: RouterConfigSchema.default({}),
    audit: AuditConfigSchema.default({}),
    health: HealthConfigSchema.default({}),
    metrics: MetricsConfigSchema.default({}),
    logLevel: z.enum(['trace', 'debug', 'info', 'warn', 'error', 'fatal']).default('info'),
  })
  .refine(
    (config) => config.providers.some((p) => p.type === config.defaultProvider),
    (config) => ({
      message: `defaultProvider "${config.defaultProvider}" does not match any provider type. Available: ${config.providers.map((p) => p.type).join(', ')}`,
      path: ['defaultProvider'],
    }),
  );

export type WorkspaceConfig = z.infer<typeof WorkspaceConfigSchema>;
export type ConnectorConfig = z.infer<typeof ConnectorConfigSchema>;
export type ProviderConfig = z.infer<typeof ProviderConfigSchema>;
export type RateLimitConfig = z.infer<typeof RateLimitConfigSchema>;
export type CommandFilterConfig = z.infer<typeof CommandFilterConfigSchema>;
export type AuthConfig = z.infer<typeof AuthConfigSchema>;
export type QueueConfig = z.infer<typeof QueueConfigSchema>;
export type RouterConfig = z.infer<typeof RouterConfigSchema>;
export type AuditConfig = z.infer<typeof AuditConfigSchema>;
export type HealthConfig = z.infer<typeof HealthConfigSchema>;
export type MetricsConfig = z.infer<typeof MetricsConfigSchema>;
export type AppConfig = z.infer<typeof AppConfigSchema>;

/** V2 channel schema — simplified connector config */
export const V2ChannelSchema = z.object({
  type: z.string(),
  enabled: z.boolean().default(true),
  options: z.record(z.unknown()).optional(),
});

/** V2 auth schema — simplified auth config with optional advanced features */
export const V2AuthSchema = z.object({
  whitelist: z.array(z.string()).min(1),
  prefix: z.string().default('/ai'),
  rateLimit: RateLimitConfigSchema.optional(),
  commandFilter: CommandFilterConfigSchema.optional(),
});

/** V2 master AI override schema */
export const V2MasterSchema = z.object({
  tool: z.string().optional(),
  explorationPrompt: z.string().optional(),
  sessionTtlMs: z.number().int().positive().optional(),
});

/** V2 workspace options — remote git clone + auto-pull configuration */
export const V2WorkspaceSchema = z.object({
  /** Polling interval in seconds for remote workspace auto-pull (default: 300) */
  pullInterval: z.number().int().positive().optional(),
});

/** Schema for a single MCP server definition */
export const MCPServerSchema = z.object({
  name: z.string().min(1),
  command: z.string().min(1),
  args: z.array(z.string()).optional(),
  env: z.record(z.string()).optional(),
});

/** Schema for the MCP configuration block */
export const MCPConfigSchema = z.object({
  enabled: z.boolean().default(true),
  servers: z.array(MCPServerSchema).default([]),
  configPath: z.string().optional(),
});

/**
 * Default glob patterns for environment variables that should be stripped from
 * worker processes. Matches common secret/credential variable naming conventions.
 */
export const ENV_DENY_PATTERNS: readonly string[] = [
  'AWS_*',
  'GITHUB_*',
  'GH_*',
  'TOKEN*',
  '*_TOKEN',
  'SECRET*',
  '*_SECRET',
  'PASSWORD*',
  '*_PASSWORD',
  'PRIVATE_*',
  'DB_*',
  'DATABASE_*',
  'SMTP_*',
  'OPENAI_*',
  'ANTHROPIC_*',
  'API*KEY*',
  '*_CREDENTIAL',
  'REDIS_*',
  'MONGO_*',
  'MYSQL_*',
  'POSTGRES_*',
];

/** Schema for security configuration — env var sanitization for workers */
export const SecurityConfigSchema = z.object({
  /** Glob patterns for env vars to strip from worker environments (denylist mode) */
  envDenyPatterns: z.array(z.string()).default([...ENV_DENY_PATTERNS]),
  /** Glob patterns for env vars to always allow even if matched by deny list (e.g. GITHUB_ACTIONS for CI) */
  envAllowPatterns: z.array(z.string()).default([]),
});

export type SecurityConfig = z.infer<typeof SecurityConfigSchema>;

/** Schema for email (SMTP) configuration */
export const EmailConfigSchema = z.object({
  host: z.string().min(1),
  port: z.number().int().positive().default(587),
  user: z.string().min(1),
  pass: z.string().min(1),
  from: z.string().email(),
  allowlist: z.array(z.string().email()).default([]),
});

/** V2 config schema — autonomous AI bridge with 3 core fields */
export const V2ConfigSchema = z
  .object({
    workspacePath: z.string().min(1),
    channels: z.array(V2ChannelSchema).min(1),
    auth: V2AuthSchema,
    master: V2MasterSchema.optional(),
    workspace: V2WorkspaceSchema.optional(),
    mcp: MCPConfigSchema.optional(),
    security: SecurityConfigSchema.optional(),
    email: EmailConfigSchema.optional(),
    queue: QueueConfigSchema.optional(),
    router: RouterConfigSchema.optional(),
    audit: AuditConfigSchema.optional(),
    health: HealthConfigSchema.optional(),
    metrics: MetricsConfigSchema.optional(),
    logLevel: z.enum(['trace', 'debug', 'info', 'warn', 'error', 'fatal']).optional(),
  })
  .strict();

export type V2Channel = z.infer<typeof V2ChannelSchema>;
export type V2Auth = z.infer<typeof V2AuthSchema>;
export type V2Master = z.infer<typeof V2MasterSchema>;
export type V2Workspace = z.infer<typeof V2WorkspaceSchema>;
export type MCPServer = z.infer<typeof MCPServerSchema>;
export type MCPConfig = z.infer<typeof MCPConfigSchema>;
export type EmailConfig = z.infer<typeof EmailConfigSchema>;
export type V2Config = z.infer<typeof V2ConfigSchema>;

/** Schema for an MCP catalog entry — describes a known MCP server users can install */
export const MCPCatalogEntrySchema = z.object({
  name: z.string().min(1),
  description: z.string().min(1),
  category: z.enum(['code', 'productivity', 'communication', 'data', 'design']),
  command: z.string().min(1),
  args: z.array(z.string()),
  envVars: z.array(
    z.object({
      key: z.string().min(1),
      description: z.string().min(1),
      required: z.boolean(),
    }),
  ),
  docsUrl: z.string().url(),
});

export type MCPCatalogEntry = z.infer<typeof MCPCatalogEntrySchema>;
