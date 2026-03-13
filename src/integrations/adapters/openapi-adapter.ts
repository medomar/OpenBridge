import SwaggerParser from '@apidevtools/swagger-parser';
import type { OpenAPI, OpenAPIV3 } from 'openapi-types';
import { z, type ZodTypeAny } from 'zod';
import { createLogger } from '../../core/logger.js';
import type {
  BusinessIntegration,
  HealthStatus,
  HealthStatusState,
  IntegrationCapability,
  IntegrationConfig,
  RoleConfig,
} from '../../types/integration.js';
import { postmanToOpenAPI, type PostmanCollection } from '../parsers/postman-parser.js';
import { curlsToOpenAPI, splitCurlCommands } from '../parsers/curl-parser.js';
import type Database from 'better-sqlite3';

const logger = createLogger('openapi-adapter');

// ── Input format detection ────────────────────────────────────────────────────

/** Supported input formats for /connect api <input>. */
export type InputFormat = 'openapi' | 'postman' | 'curl' | 'url' | 'unknown';

/**
 * Detect the format of a raw user-provided API input string.
 *
 * Rules (evaluated in order):
 *  1. `curl` — input starts with `curl ` (trimmed) or first non-empty line does
 *  2. `url`  — input is a single HTTP/HTTPS URL (no spaces, no newlines after trim)
 *  3. `postman` — JSON with a top-level `info.schema` containing "postman",
 *                 or a top-level `collection.info.schema` field
 *  4. `openapi` — JSON/YAML with a top-level `openapi` or `swagger` field
 *  5. `unknown` — everything else
 *
 * @param input Raw string from the user (cURL command, JSON, YAML, URL, etc.)
 * @returns Detected format identifier
 */
export function detectInputFormat(input: string): InputFormat {
  const trimmed = input.trim();
  if (!trimmed) return 'unknown';

  // 1. cURL detection — first non-empty line starts with "curl "
  const firstLine = trimmed.split('\n').find((l) => l.trim().length > 0) ?? '';
  if (/^curl\s+/i.test(firstLine.trim())) {
    return 'curl';
  }

  // 2. URL detection — single-token HTTP/HTTPS string
  if (/^https?:\/\/\S+$/i.test(trimmed)) {
    return 'url';
  }

  // 3. JSON-based detection (Postman or OpenAPI)
  if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
    try {
      const parsed: unknown = JSON.parse(trimmed);
      if (parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)) {
        const obj = parsed as Record<string, unknown>;

        // Postman Collection v2.x: { info: { schema: "...postman..." }, item: [...] }
        const info = obj['info'];
        if (
          info !== null &&
          typeof info === 'object' &&
          !Array.isArray(info) &&
          typeof (info as Record<string, unknown>)['schema'] === 'string' &&
          String((info as Record<string, unknown>)['schema'])
            .toLowerCase()
            .includes('postman')
        ) {
          return 'postman';
        }

        // Postman wrapped export: { collection: { info: { schema: "...postman..." } } }
        const collection = obj['collection'];
        if (collection !== null && typeof collection === 'object' && !Array.isArray(collection)) {
          const colInfo = (collection as Record<string, unknown>)['info'];
          if (
            colInfo !== null &&
            typeof colInfo === 'object' &&
            !Array.isArray(colInfo) &&
            typeof (colInfo as Record<string, unknown>)['schema'] === 'string' &&
            String((colInfo as Record<string, unknown>)['schema'])
              .toLowerCase()
              .includes('postman')
          ) {
            return 'postman';
          }
        }

        // OpenAPI 3.x: { openapi: "3.x.x", ... }
        if (typeof obj['openapi'] === 'string') {
          return 'openapi';
        }

        // Swagger 2.x: { swagger: "2.0", ... }
        if (typeof obj['swagger'] === 'string') {
          return 'openapi';
        }
      }
    } catch {
      // Not valid JSON — fall through to YAML check
    }
  }

  // 4. YAML-based OpenAPI detection (openapi: or swagger: at the start of a line)
  if (/^openapi\s*:/m.test(trimmed) || /^swagger\s*:/m.test(trimmed)) {
    return 'openapi';
  }

  return 'unknown';
}

/**
 * Parse a raw API input string into an OpenAPI document.
 *
 * Routes based on `detectInputFormat()`:
 *  - `openapi` — parsed directly via swagger-parser
 *  - `url`     — fetched and parsed as OpenAPI spec
 *  - `postman` — requires postman-parser (OB-1446, not yet implemented)
 *  - `curl`    — requires curl-parser (OB-1447, not yet implemented)
 *  - `unknown` — throws an error
 *
 * @param input Raw user input
 * @returns Validated OpenAPI document
 * @throws Error if format is unsupported or parsing fails
 */
export async function parseInputToOpenAPI(input: string): Promise<OpenAPI.Document> {
  const format = detectInputFormat(input);

  switch (format) {
    case 'openapi': {
      const trimmed = input.trim();
      if (trimmed.startsWith('{')) {
        const parsed: unknown = JSON.parse(trimmed);
        return await SwaggerParser.validate(parsed as OpenAPI.Document);
      }
      // YAML — swagger-parser accepts YAML strings via validate(string)
      return await SwaggerParser.validate(trimmed);
    }

    case 'url': {
      return await SwaggerParser.validate(input.trim());
    }

    case 'postman': {
      const parsed: unknown = JSON.parse(input.trim());
      const collection = parsed as PostmanCollection;
      const openApiDoc = postmanToOpenAPI(collection);
      return await SwaggerParser.validate(openApiDoc as OpenAPI.Document);
    }

    case 'curl': {
      const commands = splitCurlCommands(input);
      if (commands.length === 0) {
        throw new Error('No valid cURL commands found in the input.');
      }
      const curlSpec = curlsToOpenAPI(commands);
      return await SwaggerParser.validate(curlSpec as OpenAPI.Document);
    }

    default:
      throw new Error(
        'Unrecognised API input format. Provide a Swagger/OpenAPI JSON or YAML, ' +
          'a Postman collection JSON, one or more cURL commands, or a URL to an OpenAPI spec.',
      );
  }
}

// ── Role-based capability tagging ────────────────────────────────────────────

/**
 * Tag API capabilities with roles based on path prefix matching and persist
 * the tags in the `integration_capabilities` SQLite table.
 *
 * @param db          Open SQLite database with the integration_capabilities table
 * @param integration Name of the integration (e.g. "my-api")
 * @param capabilities Array of capabilities produced by the adapter
 * @param roleConfig  Map of role name → path prefix, e.g. `{ seller: '/supplier', driver: '/delivery' }`
 */
export function tagCapabilitiesByRole(
  db: Database.Database,
  integration: string,
  capabilities: IntegrationCapability[],
  roleConfig: RoleConfig,
): void {
  const now = new Date().toISOString();
  const upsert = db.prepare(`
    INSERT OR IGNORE INTO integration_capabilities
      (integration_name, capability_name, role, tagged_at)
    VALUES (?, ?, ?, ?)
  `);

  db.transaction((): void => {
    for (const cap of capabilities) {
      // Each capability's path is embedded in the name — but we need the raw
      // path.  Capabilities from OpenAPIAdapter are ResolvedCapability instances
      // that carry a `path` property.  For plain IntegrationCapability objects
      // we fall back to matching against the capability name.
      const pathOrName =
        'path' in cap && typeof (cap as Record<string, unknown>)['path'] === 'string'
          ? ((cap as Record<string, unknown>)['path'] as string)
          : cap.name;

      for (const [role, prefix] of Object.entries(roleConfig)) {
        if (pathOrName.startsWith(prefix)) {
          upsert.run(integration, cap.name, role, now);
        }
      }
    }
  })();

  logger.info(
    { integration, roles: Object.keys(roleConfig), capabilities: capabilities.length },
    'Role tags applied to capabilities',
  );
}

/**
 * Retrieve the set of roles assigned to a specific capability.
 *
 * @param db          Open SQLite database
 * @param integration Integration name
 * @param capability  Capability name
 * @returns Array of role strings assigned to this capability
 */
export function getCapabilityRoles(
  db: Database.Database,
  integration: string,
  capability: string,
): string[] {
  const rows = db
    .prepare(
      `SELECT role FROM integration_capabilities
       WHERE integration_name = ? AND capability_name = ?`,
    )
    .all(integration, capability) as { role: string }[];
  return rows.map((r) => r.role);
}

/** Resolved capability generated from an OpenAPI path+method. */
interface ResolvedCapability extends IntegrationCapability {
  /** HTTP method (GET, POST, PUT, DELETE, PATCH) */
  method: string;
  /** Full path template, e.g. "/pets/{petId}" */
  path: string;
  /** Zod schema for validating call params */
  paramSchema: ZodTypeAny;
}

/**
 * Universal REST API connector that auto-generates capabilities from an
 * OpenAPI / Swagger specification.
 *
 * On `initialize()`:
 *   - Parses and validates the spec via swagger-parser
 *   - Auto-generates capabilities from paths + methods
 *   - Builds Zod parameter schemas from OpenAPI parameter definitions
 *
 * `query()` handles read (GET) operations.
 * `execute()` handles write (POST/PUT/DELETE/PATCH) operations.
 * Both make HTTP calls with proper auth headers.
 *
 * Credentials expected (from credential store):
 *   - specUrl OR specJson: URL to OpenAPI spec or inline JSON string
 *   - baseUrl (optional): Override the server URL from the spec
 *   - authType (optional): "bearer" | "apiKey" | "basic" | "none"
 *   - authToken (optional): Bearer token, API key value, or "user:pass" for basic
 *   - authHeader (optional): Custom header name for apiKey auth (default "Authorization")
 */
export class OpenAPIAdapter implements BusinessIntegration {
  readonly name: string;
  readonly type = 'api' as const;

  private capabilities: ResolvedCapability[] = [];
  private baseUrl = '';
  private authHeaders: Record<string, string> = {};
  private initialized = false;
  private db: Database.Database | null = null;
  private healthEndpoint: string | null = null;
  private lastHealthStatus: HealthStatusState = 'unknown';
  private healthAlertHandler: ((integration: string, status: HealthStatus) => void) | null = null;

  constructor(name = 'openapi') {
    this.name = name;
  }

  /**
   * Optionally wire in a SQLite database so that role tags can be stored and
   * retrieved from the `integration_capabilities` table, and health history
   * is persisted to the `integration_health_log` table.
   */
  setDatabase(db: Database.Database): void {
    this.db = db;
  }

  /**
   * Set a callback invoked when this adapter transitions to unhealthy state.
   * Called at most once per transition (healthy/unknown → unhealthy).
   */
  setHealthAlertHandler(handler: (integration: string, status: HealthStatus) => void): void {
    this.healthAlertHandler = handler;
  }

  async initialize(config: IntegrationConfig): Promise<void> {
    const opts = config.options;

    // Parse the OpenAPI spec
    const specUrl = opts['specUrl'] as string | undefined;
    const specJson = opts['specJson'] as string | undefined;

    if (!specUrl && !specJson) {
      throw new Error('OpenAPI adapter requires specUrl or specJson in config.options');
    }

    let api: OpenAPI.Document;
    try {
      if (specUrl) {
        api = await SwaggerParser.validate(specUrl);
      } else {
        const parsed: unknown = JSON.parse(specJson!);
        api = await SwaggerParser.validate(parsed as OpenAPI.Document);
      }
    } catch (err) {
      throw new Error(
        `OpenAPI spec validation failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    }

    // Resolve base URL
    const specBaseUrl = this.extractBaseUrl(api);
    this.baseUrl = (opts['baseUrl'] as string) ?? specBaseUrl;
    if (!this.baseUrl) {
      throw new Error('No server URL found in spec and no baseUrl provided');
    }
    // Strip trailing slash
    this.baseUrl = this.baseUrl.replace(/\/+$/, '');

    // Build auth headers
    this.authHeaders = this.buildAuthHeaders(opts);

    // Generate capabilities from paths
    this.capabilities = this.generateCapabilities(api);

    // Detect health endpoint (explicit config > well-known spec path > first GET path)
    this.healthEndpoint = this.detectHealthEndpoint(opts, api);

    this.initialized = true;
    logger.info(
      {
        name: this.name,
        baseUrl: this.baseUrl,
        capabilities: this.capabilities.length,
        healthEndpoint: this.healthEndpoint,
      },
      'OpenAPI adapter initialized',
    );
  }

  async healthCheck(): Promise<HealthStatus> {
    const checkedAt = new Date().toISOString();

    if (!this.initialized) {
      const result: HealthStatus = {
        status: 'unhealthy',
        message: 'Not initialized',
        checkedAt,
        details: {},
      };
      this.storeHealthLog(result, null, null, null);
      return result;
    }

    if (!this.healthEndpoint) {
      // No probeable endpoint — report basic availability
      const result: HealthStatus = {
        status: 'healthy',
        message: `OpenAPI adapter ready (${this.capabilities.length} capabilities)`,
        checkedAt,
        details: { baseUrl: this.baseUrl, capabilityCount: this.capabilities.length },
      };
      this.storeHealthLog(result, null, null, null);
      this.lastHealthStatus = 'healthy';
      return result;
    }

    // Probe the health endpoint
    const start = Date.now();
    let httpStatus: number | null = null;
    let resultStatus: HealthStatusState = 'unhealthy';
    let message = '';

    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 10_000);
      try {
        const response = await fetch(this.healthEndpoint, {
          method: 'GET',
          headers: { ...this.authHeaders },
          signal: controller.signal,
        });
        httpStatus = response.status;
        if (response.ok) {
          resultStatus = 'healthy';
          message = `Health check passed (HTTP ${httpStatus})`;
        } else if (httpStatus >= 500) {
          resultStatus = 'unhealthy';
          message = `Health check failed (HTTP ${httpStatus})`;
        } else {
          resultStatus = 'degraded';
          message = `Health check returned HTTP ${httpStatus}`;
        }
      } finally {
        clearTimeout(timeoutId);
      }
    } catch (err) {
      resultStatus = 'unhealthy';
      message = `Health check failed: ${err instanceof Error ? err.message : String(err)}`;
    }

    const latencyMs = Date.now() - start;
    const result: HealthStatus = {
      status: resultStatus,
      message,
      checkedAt,
      details: {
        baseUrl: this.baseUrl,
        healthEndpoint: this.healthEndpoint,
        httpStatus,
        latencyMs,
        capabilityCount: this.capabilities.length,
      },
    };

    this.storeHealthLog(result, this.healthEndpoint, httpStatus, latencyMs);

    // Alert on healthy/unknown → unhealthy transition
    if (resultStatus === 'unhealthy' && this.lastHealthStatus !== 'unhealthy') {
      this.healthAlertHandler?.(this.name, result);
    }
    this.lastHealthStatus = resultStatus;

    return result;
  }

  /**
   * Return the last known health check result for this adapter from the DB.
   * Returns null if no health log entries exist or no DB is wired in.
   */
  getLastHealthLog(): {
    status: string;
    message: string | null;
    checkedAt: string;
    latencyMs: number | null;
  } | null {
    if (!this.db) return null;
    try {
      return this.db
        .prepare(
          `SELECT status, message, checked_at AS checkedAt, latency_ms AS latencyMs
           FROM integration_health_log
           WHERE integration_name = ?
           ORDER BY checked_at DESC LIMIT 1`,
        )
        .get(this.name) as {
        status: string;
        message: string | null;
        checkedAt: string;
        latencyMs: number | null;
      } | null;
    } catch {
      return null;
    }
  }

  // eslint-disable-next-line @typescript-eslint/require-await
  async shutdown(): Promise<void> {
    this.capabilities = [];
    this.baseUrl = '';
    this.authHeaders = {};
    this.initialized = false;
    logger.info({ name: this.name }, 'OpenAPI adapter shut down');
  }

  /**
   * Describe the capabilities exposed by this adapter.
   *
   * @param role Optional role filter. When provided, only capabilities that
   *             have been tagged for that role (via `tagCapabilitiesByRole()`)
   *             are returned. When omitted, all capabilities are returned.
   */
  describeCapabilities(role?: string): IntegrationCapability[] {
    const all = this.capabilities.map(({ method: _m, path: _p, paramSchema: _s, ...cap }) => cap);

    if (!role || !this.db) {
      return all;
    }

    const rows = this.db
      .prepare(
        `SELECT capability_name FROM integration_capabilities
         WHERE integration_name = ? AND role = ?`,
      )
      .all(this.name, role) as { capability_name: string }[];

    const allowed = new Set(rows.map((r) => r.capability_name));
    return all.filter((c) => allowed.has(c.name));
  }

  /**
   * Tag capabilities with roles based on path prefix patterns and persist
   * the mappings to the SQLite database.
   *
   * Requires a database to be wired in via `setDatabase()`.
   *
   * @param roleConfig Map of role name → path prefix
   * @throws Error if no database has been wired in
   */
  tagCapabilitiesByRole(roleConfig: RoleConfig): void {
    if (!this.db) {
      throw new Error('OpenAPIAdapter: call setDatabase() before tagCapabilitiesByRole()');
    }
    tagCapabilitiesByRole(this.db, this.name, this.capabilities, roleConfig);
  }

  async query(operation: string, params: Record<string, unknown>): Promise<unknown> {
    const cap = this.findCapability(operation, 'read');
    return await this.makeRequest(cap, params);
  }

  async execute(operation: string, params: Record<string, unknown>): Promise<unknown> {
    const cap = this.findCapability(operation, 'write');
    return await this.makeRequest(cap, params);
  }

  // ── Internal helpers ─────────────────────────────────────────────

  /** Detect the health-check endpoint from spec paths or explicit config. */
  private detectHealthEndpoint(
    opts: Record<string, unknown>,
    api: OpenAPI.Document,
  ): string | null {
    // 1. Explicit override in config options
    const configured = opts['healthEndpoint'] as string | undefined;
    if (configured) {
      const path = configured.startsWith('/') ? configured : `/${configured}`;
      return `${this.baseUrl}${path}`;
    }

    // 2. Well-known health endpoint paths in the spec
    const v3 = api as OpenAPIV3.Document;
    const paths = v3.paths ?? {};
    const wellKnown = ['/health', '/healthz', '/status', '/ping', '/ready', '/liveness'];
    for (const hp of wellKnown) {
      if (paths[hp]?.get) return `${this.baseUrl}${hp}`;
    }

    // 3. Fall back to first GET path (avoid parameterised paths — use literal ones first)
    let firstGet: string | null = null;
    for (const [pathTemplate, pathItem] of Object.entries(paths)) {
      if (!pathItem?.get) continue;
      if (!pathTemplate.includes('{')) {
        return `${this.baseUrl}${pathTemplate}`;
      }
      firstGet ??= pathTemplate;
    }

    // Last resort: use first GET path even if parameterised (replace params with "probe")
    if (firstGet) {
      const resolved = firstGet.replace(/\{[^}]+\}/g, 'probe');
      return `${this.baseUrl}${resolved}`;
    }

    return null;
  }

  /** Write a health check result to the `integration_health_log` table. */
  private storeHealthLog(
    status: HealthStatus,
    endpointUrl: string | null,
    httpStatus: number | null,
    latencyMs: number | null,
  ): void {
    if (!this.db) return;
    try {
      this.db
        .prepare(
          `INSERT INTO integration_health_log
             (integration_name, status, message, endpoint_url, http_status, latency_ms, checked_at)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          this.name,
          status.status,
          status.message ?? null,
          endpointUrl,
          httpStatus,
          latencyMs,
          status.checkedAt,
        );
    } catch (err) {
      logger.warn({ err }, 'Failed to store health log');
    }
  }

  private findCapability(
    operation: string,
    expectedCategory: 'read' | 'write',
  ): ResolvedCapability {
    if (!this.initialized) {
      throw new Error('OpenAPI adapter not initialized — call initialize() first');
    }

    const cap = this.capabilities.find((c) => c.name === operation);
    if (!cap) {
      throw new Error(`Unknown operation: ${operation}`);
    }

    if (cap.category !== expectedCategory) {
      const correctMethod = expectedCategory === 'read' ? 'query()' : 'execute()';
      throw new Error(
        `Operation "${operation}" is a ${cap.category} operation — use ${correctMethod}`,
      );
    }

    return cap;
  }

  private async makeRequest(
    cap: ResolvedCapability,
    params: Record<string, unknown>,
  ): Promise<unknown> {
    // Validate params
    const validated: unknown = cap.paramSchema.parse(params);
    const validatedParams = (
      validated !== null && typeof validated === 'object' ? validated : {}
    ) as Record<string, unknown>;

    // Build URL — replace path parameters
    let url = `${this.baseUrl}${cap.path}`;
    const queryParams: Record<string, string> = {};
    let body: unknown = undefined;

    // Separate path params, query params, and body
    for (const [key, value] of Object.entries(validatedParams)) {
      const placeholder = `{${key}}`;
      if (url.includes(placeholder)) {
        url = url.replace(placeholder, encodeURIComponent(`${value as string | number | boolean}`));
      } else if (cap.method === 'GET' || cap.method === 'DELETE') {
        if (value !== undefined && value !== null) {
          queryParams[key] = `${value as string | number | boolean}`;
        }
      }
    }

    // For non-GET methods, put remaining non-path params in body
    if (cap.method !== 'GET' && cap.method !== 'DELETE') {
      const bodyParams: Record<string, unknown> = {};
      for (const [key, value] of Object.entries(validatedParams)) {
        if (!url.includes(encodeURIComponent(String(value)))) {
          bodyParams[key] = value;
        }
      }
      if (Object.keys(bodyParams).length > 0) {
        body = bodyParams;
      }
    }

    // Append query string
    const qs = new URLSearchParams(queryParams).toString();
    if (qs) {
      url += `?${qs}`;
    }

    // Make the HTTP request
    const fetchOptions: RequestInit = {
      method: cap.method,
      headers: {
        ...this.authHeaders,
        ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      },
    };
    if (body !== undefined) {
      fetchOptions.body = JSON.stringify(body);
    }

    logger.debug({ method: cap.method, url }, 'OpenAPI request');

    const response = await fetch(url, fetchOptions);

    if (!response.ok) {
      const text = await response.text().catch(() => '');
      throw new Error(`HTTP ${response.status} ${response.statusText}: ${text}`);
    }

    const contentType = response.headers.get('content-type') ?? '';
    if (contentType.includes('application/json')) {
      return await response.json();
    }
    return await response.text();
  }

  private extractBaseUrl(api: OpenAPI.Document): string {
    // OpenAPI 3.x
    const v3 = api as OpenAPIV3.Document;
    if (v3.servers && v3.servers.length > 0 && v3.servers[0]) {
      return v3.servers[0].url;
    }

    // Swagger 2.x
    const v2 = api as { host?: string; basePath?: string; schemes?: string[] };
    if (v2.host) {
      const scheme = v2.schemes?.[0] ?? 'https';
      const basePath = v2.basePath ?? '';
      return `${scheme}://${v2.host}${basePath}`;
    }

    return '';
  }

  private buildAuthHeaders(opts: Record<string, unknown>): Record<string, string> {
    const authType = (opts['authType'] as string) ?? 'none';
    const authToken = opts['authToken'] as string | undefined;

    if (authType === 'none' || !authToken) {
      return {};
    }

    switch (authType) {
      case 'bearer':
        return { Authorization: `Bearer ${authToken}` };
      case 'apiKey': {
        const headerName = (opts['authHeader'] as string) ?? 'Authorization';
        return { [headerName]: authToken };
      }
      case 'basic': {
        const encoded = Buffer.from(authToken).toString('base64');
        return { Authorization: `Basic ${encoded}` };
      }
      default:
        logger.warn({ authType }, 'Unknown auth type — no auth headers set');
        return {};
    }
  }

  private generateCapabilities(api: OpenAPI.Document): ResolvedCapability[] {
    const v3 = api as OpenAPIV3.Document;
    const paths = v3.paths;
    if (!paths) return [];

    const caps: ResolvedCapability[] = [];

    for (const [pathTemplate, pathItem] of Object.entries(paths)) {
      if (!pathItem) continue;

      const methods: Array<[string, OpenAPIV3.OperationObject | undefined]> = [
        ['GET', pathItem.get],
        ['POST', pathItem.post],
        ['PUT', pathItem.put],
        ['DELETE', pathItem.delete],
        ['PATCH', pathItem.patch],
      ];

      for (const [method, operation] of methods) {
        if (!operation) continue;

        const opName = this.generateOperationName(method, pathTemplate, operation);
        const isRead = method === 'GET';
        const paramSchema = this.buildParamSchema(operation, pathItem);

        caps.push({
          name: opName,
          description: operation.summary ?? operation.description ?? `${method} ${pathTemplate}`,
          category: isRead ? 'read' : 'write',
          requiresApproval: !isRead,
          method,
          path: pathTemplate,
          paramSchema,
        });
      }
    }

    return caps;
  }

  private generateOperationName(
    method: string,
    pathTemplate: string,
    operation: OpenAPIV3.OperationObject,
  ): string {
    // Use operationId if available
    if (operation.operationId) {
      return operation.operationId;
    }

    // Generate from method + path: GET /pets/{petId} → get_pets_by_petId
    const segments = pathTemplate
      .split('/')
      .filter(Boolean)
      .map((s) => {
        if (s.startsWith('{') && s.endsWith('}')) {
          return `by_${s.slice(1, -1)}`;
        }
        return s.replace(/[^a-zA-Z0-9]/g, '_');
      });

    return `${method.toLowerCase()}_${segments.join('_')}`;
  }

  private buildParamSchema(
    operation: OpenAPIV3.OperationObject,
    pathItem: OpenAPIV3.PathItemObject,
  ): ZodTypeAny {
    const shape: Record<string, ZodTypeAny> = {};

    // Merge path-level and operation-level parameters
    const allParams = [
      ...((pathItem.parameters ?? []) as OpenAPIV3.ParameterObject[]),
      ...((operation.parameters ?? []) as OpenAPIV3.ParameterObject[]),
    ];

    for (const param of allParams) {
      if (!param.name) continue;
      const zodType = this.openApiSchemaToZod(param.schema as OpenAPIV3.SchemaObject | undefined);
      shape[param.name] = param.required ? zodType : zodType.optional();
    }

    // Add request body properties (for POST/PUT/PATCH)
    if (operation.requestBody) {
      const reqBody = operation.requestBody as OpenAPIV3.RequestBodyObject;
      const jsonContent = reqBody.content?.['application/json'];
      if (jsonContent?.schema) {
        const bodySchema = jsonContent.schema as OpenAPIV3.SchemaObject;
        if (bodySchema.properties) {
          const requiredFields = new Set(bodySchema.required ?? []);
          for (const [propName, propSchema] of Object.entries(bodySchema.properties)) {
            const zodType = this.openApiSchemaToZod(propSchema as OpenAPIV3.SchemaObject);
            shape[propName] = requiredFields.has(propName) ? zodType : zodType.optional();
          }
        }
      }
    }

    if (Object.keys(shape).length === 0) {
      return z.object({}).passthrough();
    }

    return z.object(shape).passthrough();
  }

  private openApiSchemaToZod(schema: OpenAPIV3.SchemaObject | undefined): ZodTypeAny {
    if (!schema) return z.unknown();

    switch (schema.type) {
      case 'string':
        return z.string();
      case 'integer':
      case 'number':
        return z.number();
      case 'boolean':
        return z.boolean();
      case 'array':
        return z.array(this.openApiSchemaToZod(schema.items as OpenAPIV3.SchemaObject | undefined));
      case 'object':
        return z.record(z.unknown());
      default:
        return z.unknown();
    }
  }
}
