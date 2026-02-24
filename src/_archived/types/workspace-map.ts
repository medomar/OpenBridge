import { z } from 'zod';

// ── Auth Schemas ──────────────────────────────────────────────────

/** Schema for API key authentication */
export const ApiKeyAuthSchema = z.object({
  type: z.literal('api-key'),
  header: z.string().default('Authorization'),
  prefix: z.string().optional(),
  envVar: z.string(),
});

/** Schema for Bearer token authentication */
export const BearerAuthSchema = z.object({
  type: z.literal('bearer'),
  envVar: z.string(),
});

/** Schema for Basic authentication */
export const BasicAuthSchema = z.object({
  type: z.literal('basic'),
  usernameEnvVar: z.string(),
  passwordEnvVar: z.string(),
});

/** Schema for custom header authentication */
export const CustomAuthSchema = z.object({
  type: z.literal('custom'),
  headers: z.record(z.string()),
});

/** Schema for no authentication */
export const NoAuthSchema = z.object({
  type: z.literal('none'),
});

/** Discriminated union for endpoint auth */
export const EndpointAuthSchema = z.discriminatedUnion('type', [
  ApiKeyAuthSchema,
  BearerAuthSchema,
  BasicAuthSchema,
  CustomAuthSchema,
  NoAuthSchema,
]);

// ── Parameter & Schema Schemas ────────────────────────────────────

/** Schema for request/response field definition */
export const FieldSchemaSchema: z.ZodType = z.lazy(() =>
  z.object({
    type: z.enum(['string', 'number', 'boolean', 'object', 'array', 'null']),
    description: z.string().optional(),
    required: z.boolean().default(false),
    example: z.unknown().optional(),
    items: FieldSchemaSchema.optional(),
    properties: z.record(FieldSchemaSchema).optional(),
  }),
);

/** Schema for a URL/query parameter */
export const ParameterSchema = z.object({
  name: z.string(),
  in: z.enum(['path', 'query', 'header']),
  required: z.boolean().default(false),
  type: z.enum(['string', 'number', 'boolean']).default('string'),
  description: z.string().optional(),
  example: z.unknown().optional(),
});

// ── API Endpoint Schema ───────────────────────────────────────────

export const HttpMethodSchema = z.enum([
  'GET',
  'POST',
  'PUT',
  'PATCH',
  'DELETE',
  'HEAD',
  'OPTIONS',
]);

/** Schema for a single API endpoint definition */
export const APIEndpointSchema = z.object({
  /** Unique ID for this endpoint within the workspace map */
  id: z.string().min(1),
  /** Human-readable name */
  name: z.string().min(1),
  /** Short description of what this endpoint does */
  description: z.string().optional(),
  /** HTTP method */
  method: HttpMethodSchema,
  /** URL path (may include :param placeholders, e.g. /products/:id) */
  path: z.string().min(1),
  /** Base URL override (uses workspace-level baseUrl if not set) */
  baseUrl: z.string().url().optional(),
  /** URL, query, and header parameters */
  parameters: z.array(ParameterSchema).default([]),
  /** Request headers (static, merged with auth headers) */
  headers: z.record(z.string()).default({}),
  /** Auth override for this endpoint (uses workspace-level auth if not set) */
  auth: EndpointAuthSchema.optional(),
  /** Request body schema (for POST/PUT/PATCH) */
  requestBody: z
    .object({
      contentType: z.string().default('application/json'),
      schema: z.record(FieldSchemaSchema).optional(),
      example: z.unknown().optional(),
    })
    .optional(),
  /** Response schema */
  response: z
    .object({
      contentType: z.string().default('application/json'),
      schema: z.record(FieldSchemaSchema).optional(),
      example: z.unknown().optional(),
    })
    .optional(),
  /** Tags for grouping/filtering (e.g. ["products", "crud"]) */
  tags: z.array(z.string()).default([]),
});

// ── Map Source ─────────────────────────────────────────────────────

/** How the workspace map was generated or declared */
export const MapSourceSchema = z.enum(['manual', 'openapi', 'postman', 'swagger', 'har']);

// ── Workspace Map Schema ──────────────────────────────────────────

/** Schema for the full workspace map (the openbridge.map.json file) */
export const WorkspaceMapSchema = z.object({
  /** Schema version for forward compatibility */
  version: z.literal('1.0'),
  /** Human-readable workspace name */
  name: z.string().min(1),
  /** Description of the target project/API */
  description: z.string().optional(),
  /** Base URL for all endpoints (can be overridden per endpoint) */
  baseUrl: z.string().url(),
  /** Default auth applied to all endpoints (can be overridden per endpoint) */
  auth: EndpointAuthSchema.default({ type: 'none' }),
  /** How this map was sourced */
  source: MapSourceSchema.default('manual'),
  /** Default headers applied to every request */
  headers: z.record(z.string()).default({}),
  /** API endpoints */
  endpoints: z.array(APIEndpointSchema).min(1),
  /** Metadata */
  metadata: z
    .object({
      generatedAt: z.string().optional(),
      generatedBy: z.string().optional(),
      sourceFile: z.string().optional(),
    })
    .default({}),
});

// ── Inferred Types ────────────────────────────────────────────────

export type ApiKeyAuth = z.infer<typeof ApiKeyAuthSchema>;
export type BearerAuth = z.infer<typeof BearerAuthSchema>;
export type BasicAuth = z.infer<typeof BasicAuthSchema>;
export type CustomAuth = z.infer<typeof CustomAuthSchema>;
export type NoAuth = z.infer<typeof NoAuthSchema>;
export type EndpointAuth = z.infer<typeof EndpointAuthSchema>;
export type FieldSchema = z.infer<typeof FieldSchemaSchema>;
export type Parameter = z.infer<typeof ParameterSchema>;
export type HttpMethod = z.infer<typeof HttpMethodSchema>;
export type APIEndpoint = z.infer<typeof APIEndpointSchema>;
export type MapSource = z.infer<typeof MapSourceSchema>;
export type WorkspaceMap = z.infer<typeof WorkspaceMapSchema>;
