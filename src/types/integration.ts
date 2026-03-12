import { z } from 'zod';

// ── Integration Type ──────────────────────────────────────────────

/** High-level category of an external integration */
export const IntegrationTypeSchema = z.enum([
  'payment',
  'storage',
  'communication',
  'database',
  'api',
  'calendar',
]);

// ── Integration Capability ────────────────────────────────────────

/** Access level category for an integration capability */
export const CapabilityCategorySchema = z.enum(['read', 'write', 'admin']);

/**
 * A single capability exposed by an integration.
 * Master AI reads these to understand what the integration can do.
 */
export const IntegrationCapabilitySchema = z.object({
  /** Operation name (e.g., "create_payment_link", "list_files", "send_email") */
  name: z.string().min(1),
  /** Human-readable description for Master AI prompt injection */
  description: z.string().min(1),
  /** Access level for this capability */
  category: CapabilityCategorySchema,
  /** Whether this operation requires human approval before execution */
  requiresApproval: z.boolean(),
});

// ── Integration Config ────────────────────────────────────────────

/**
 * Runtime configuration passed to an integration on initialize().
 * Contains the integration name, credentials reference, and any
 * adapter-specific options.
 */
export const IntegrationConfigSchema = z.object({
  /** Integration identifier matching BusinessIntegration.name */
  name: z.string().min(1),
  /** Reference key for retrieving credentials from the credential store */
  credentialKey: z.string().min(1).optional(),
  /** Adapter-specific configuration options */
  options: z.record(z.unknown()).default({}),
});

// ── Health Status ─────────────────────────────────────────────────

/** Possible health states for an integration */
export const HealthStatusStateSchema = z.enum(['healthy', 'degraded', 'unhealthy', 'unknown']);

/** Result of a health check on an integration */
export const HealthStatusSchema = z.object({
  /** Overall health state */
  status: HealthStatusStateSchema,
  /** Human-readable message describing the health state */
  message: z.string().optional(),
  /** When this health check was performed (ISO 8601) */
  checkedAt: z.string().datetime(),
  /** Additional diagnostic details */
  details: z.record(z.unknown()).default({}),
});

// ── Integration Credential ────────────────────────────────────────

/**
 * An encrypted credential record stored in the integration_credentials table.
 * The actual secret bytes are stored AES-256-GCM encrypted at rest.
 */
export const IntegrationCredentialSchema = z.object({
  /** Auto-assigned SQLite row id (absent before INSERT) */
  id: z.number().int().positive().optional(),
  /** Integration name this credential belongs to */
  integrationName: z.string().min(1),
  /** AES-256-GCM ciphertext (hex-encoded) */
  encrypted: z.string().min(1),
  /** Initialisation vector (hex-encoded, 12 bytes for GCM) */
  iv: z.string().min(1),
  /** GCM authentication tag (hex-encoded, 16 bytes) */
  authTag: z.string().min(1),
  /** Current health status of the integration using this credential */
  healthStatus: HealthStatusStateSchema.default('unknown'),
  /** When this credential was created (ISO 8601) */
  createdAt: z.string().datetime().optional(),
  /** When this credential was last updated (ISO 8601) */
  updatedAt: z.string().datetime().optional(),
});

// ── Integration Info ──────────────────────────────────────────────

/**
 * Summary record returned by IntegrationHub.list().
 * Lightweight view — does not include credential details.
 */
export const IntegrationInfoSchema = z.object({
  /** Integration identifier */
  name: z.string().min(1),
  /** Integration category */
  type: IntegrationTypeSchema,
  /** Whether the integration has been successfully initialized */
  connected: z.boolean(),
  /** Last known health status */
  healthStatus: HealthStatusStateSchema,
  /** Number of capabilities this integration exposes */
  capabilityCount: z.number().int().nonnegative(),
});

// ── BusinessIntegration Interface ────────────────────────────────

/**
 * Contract that every integration adapter must implement.
 * Adapters live in src/integrations/adapters/.
 */
export interface BusinessIntegration {
  /** Unique integration identifier (e.g., "stripe", "google-drive") */
  name: string;
  /** High-level category of this integration */
  type: IntegrationType;

  // Lifecycle
  initialize(config: IntegrationConfig): Promise<void>;
  healthCheck(): Promise<HealthStatus>;
  shutdown(): Promise<void>;

  // Discovery — Master AI reads this to understand capabilities
  // role: optional filter — only return capabilities tagged for this role
  describeCapabilities(role?: string): IntegrationCapability[];

  // Read (no approval needed)
  query(operation: string, params: Record<string, unknown>): Promise<unknown>;

  // Write (requires human approval unless pre-approved)
  execute(operation: string, params: Record<string, unknown>): Promise<unknown>;

  // Real-time events (optional)
  subscribe?(event: string, handler: EventHandler): void;
  registerWebhook?(endpoint: string): Promise<void>;
  unregisterWebhook?(): Promise<void>;
}

/** Callback invoked when an integration emits a real-time event */
export type EventHandler = (event: Record<string, unknown>) => void | Promise<void>;

// ── Role Config ───────────────────────────────────────────────────

/**
 * Maps role names to path prefix patterns for capability tagging.
 *
 * Example: `{ "seller": "/supplier", "driver": "/delivery" }`
 * means endpoints starting with /supplier are tagged for the "seller" role,
 * and endpoints starting with /delivery are tagged for the "driver" role.
 */
export const RoleConfigSchema = z.record(z.string().min(1));

// ── Inferred Types ────────────────────────────────────────────────

export type IntegrationType = z.infer<typeof IntegrationTypeSchema>;
export type CapabilityCategory = z.infer<typeof CapabilityCategorySchema>;
export type IntegrationCapability = z.infer<typeof IntegrationCapabilitySchema>;
export type IntegrationConfig = z.infer<typeof IntegrationConfigSchema>;
export type HealthStatusState = z.infer<typeof HealthStatusStateSchema>;
export type HealthStatus = z.infer<typeof HealthStatusSchema>;
export type IntegrationCredential = z.infer<typeof IntegrationCredentialSchema>;
export type IntegrationInfo = z.infer<typeof IntegrationInfoSchema>;
export type RoleConfig = z.infer<typeof RoleConfigSchema>;
