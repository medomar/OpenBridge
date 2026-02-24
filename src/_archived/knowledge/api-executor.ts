import { request as httpRequest } from 'node:http';
import { request as httpsRequest } from 'node:https';
import type { IncomingMessage, ClientRequest } from 'node:http';
import type { WorkspaceMap, APIEndpoint, EndpointAuth } from '../../types/workspace-map.js';
import { createLogger } from '../../core/logger.js';
import { resolveEnvVars } from '../core/map-loader.js';

const logger = createLogger('api-executor');

// ── Types ────────────────────────────────────────────────────────

/** Parameters for executing an API call */
export interface ExecuteRequest {
  /** Endpoint ID from the workspace map */
  endpointId: string;
  /** Path parameter values (e.g. { id: '123' }) */
  pathParams?: Record<string, string>;
  /** Query parameter values */
  queryParams?: Record<string, string>;
  /** Request body (serialized based on content type) */
  body?: unknown;
  /** Additional headers (merged with endpoint + map defaults) */
  headers?: Record<string, string>;
  /** Request timeout in milliseconds (default: 30000) */
  timeoutMs?: number;
}

/** Successful API execution result */
export interface ExecuteResponse {
  ok: true;
  status: number;
  statusText: string;
  headers: Record<string, string>;
  body: unknown;
  durationMs: number;
  endpoint: { id: string; method: string; path: string };
}

/** Failed API execution result */
export interface ExecuteError {
  ok: false;
  error: string;
  code: ExecuteErrorCode;
  durationMs: number;
  endpoint: { id: string; method: string; path: string };
  /** Whether the error is transient and retryable */
  retryable: boolean;
}

export type ExecuteResult = ExecuteResponse | ExecuteError;

export type ExecuteErrorCode =
  | 'ENDPOINT_NOT_FOUND'
  | 'AUTH_ERROR'
  | 'TIMEOUT'
  | 'NETWORK_ERROR'
  | 'REQUEST_BUILD_ERROR'
  | 'RESPONSE_PARSE_ERROR'
  | 'HTTP_ERROR';

/** Options for the APIExecutor constructor */
export interface APIExecutorOptions {
  /** Max retries for transient errors (default: 2) */
  maxRetries?: number;
  /** Default timeout in ms (default: 30000) */
  defaultTimeoutMs?: number;
  /** Base delay for exponential backoff in ms (default: 1000) */
  retryBaseDelayMs?: number;
}

// ── Default Config ───────────────────────────────────────────────

const DEFAULT_TIMEOUT_MS = 30_000;
const DEFAULT_MAX_RETRIES = 2;
const DEFAULT_RETRY_BASE_DELAY_MS = 1000;

// HTTP status codes that indicate transient errors
const RETRYABLE_STATUS_CODES = new Set([408, 429, 500, 502, 503, 504]);

// ── API Executor ─────────────────────────────────────────────────

export class APIExecutor {
  private readonly map: WorkspaceMap;
  private readonly endpointIndex: Map<string, APIEndpoint>;
  private readonly maxRetries: number;
  private readonly defaultTimeoutMs: number;
  private readonly retryBaseDelayMs: number;

  constructor(map: WorkspaceMap, options: APIExecutorOptions = {}) {
    this.map = map;
    this.maxRetries = options.maxRetries ?? DEFAULT_MAX_RETRIES;
    this.defaultTimeoutMs = options.defaultTimeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.retryBaseDelayMs = options.retryBaseDelayMs ?? DEFAULT_RETRY_BASE_DELAY_MS;

    // Build index for O(1) endpoint lookup
    this.endpointIndex = new Map();
    for (const ep of map.endpoints) {
      this.endpointIndex.set(ep.id, ep);
    }
  }

  /**
   * Execute an API call for the given endpoint.
   * Handles auth, path params, query params, headers, body, retries, and timeouts.
   */
  async execute(req: ExecuteRequest): Promise<ExecuteResult> {
    const endpoint = this.endpointIndex.get(req.endpointId);
    if (!endpoint) {
      return {
        ok: false,
        error: `Endpoint "${req.endpointId}" not found in workspace map "${this.map.name}"`,
        code: 'ENDPOINT_NOT_FOUND',
        durationMs: 0,
        endpoint: { id: req.endpointId, method: 'UNKNOWN', path: 'UNKNOWN' },
        retryable: false,
      };
    }

    const endpointMeta = { id: endpoint.id, method: endpoint.method, path: endpoint.path };

    // Build the full URL
    let url: URL;
    try {
      url = this.buildUrl(endpoint, req.pathParams, req.queryParams);
    } catch (err) {
      return {
        ok: false,
        error: `Failed to build URL: ${err instanceof Error ? err.message : String(err)}`,
        code: 'REQUEST_BUILD_ERROR',
        durationMs: 0,
        endpoint: endpointMeta,
        retryable: false,
      };
    }

    // Build headers
    let headers: Record<string, string>;
    try {
      headers = this.buildHeaders(endpoint, req.headers);
    } catch (err) {
      return {
        ok: false,
        error: `Failed to resolve auth: ${err instanceof Error ? err.message : String(err)}`,
        code: 'AUTH_ERROR',
        durationMs: 0,
        endpoint: endpointMeta,
        retryable: false,
      };
    }

    // Serialize body
    const bodyStr = this.serializeBody(req.body, endpoint);
    if (bodyStr !== undefined && !headers['content-type']) {
      headers['content-type'] = endpoint.requestBody?.contentType ?? 'application/json';
    }

    const timeoutMs = req.timeoutMs ?? this.defaultTimeoutMs;

    // Execute with retries
    let lastResult: ExecuteResult | undefined;
    for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
      if (attempt > 0) {
        const delay = this.retryBaseDelayMs * Math.pow(2, attempt - 1);
        logger.info({ endpointId: endpoint.id, attempt, delay }, 'Retrying API call');
        await sleep(delay);
      }

      lastResult = await this.executeOnce(
        url,
        endpoint.method,
        headers,
        bodyStr,
        timeoutMs,
        endpointMeta,
      );

      if (lastResult.ok || !lastResult.retryable) {
        return lastResult;
      }

      logger.warn(
        { endpointId: endpoint.id, attempt, error: lastResult.error },
        'Transient API error, will retry',
      );
    }

    // All retries exhausted
    return lastResult!;
  }

  /**
   * Find an endpoint by ID.
   */
  findEndpoint(endpointId: string): APIEndpoint | undefined {
    return this.endpointIndex.get(endpointId);
  }

  /**
   * List all available endpoint IDs.
   */
  listEndpoints(): Array<{ id: string; method: string; path: string; name: string }> {
    return this.map.endpoints.map((ep) => ({
      id: ep.id,
      method: ep.method,
      path: ep.path,
      name: ep.name,
    }));
  }

  // ── Private Helpers ──────────────────────────────────────────────

  private buildUrl(
    endpoint: APIEndpoint,
    pathParams?: Record<string, string>,
    queryParams?: Record<string, string>,
  ): URL {
    const baseUrl = endpoint.baseUrl ?? this.map.baseUrl;

    // Replace :param placeholders with actual values
    let path = endpoint.path;
    const paramMatches = path.match(/:(\w+)/g);
    if (paramMatches) {
      for (const match of paramMatches) {
        const paramName = match.slice(1); // remove ':'
        const value = pathParams?.[paramName];
        if (value === undefined) {
          throw new Error(`Missing required path parameter: ${paramName}`);
        }
        path = path.replace(match, encodeURIComponent(value));
      }
    }

    const url = new URL(path, baseUrl);

    // Add query parameters from endpoint definition defaults
    for (const param of endpoint.parameters) {
      if (param.in === 'query' && param.example !== undefined) {
        // Only set default if caller didn't provide it
        if (!queryParams?.[param.name]) {
          url.searchParams.set(param.name, `${param.example as string | number | boolean}`);
        }
      }
    }

    // Add caller-provided query params (override defaults)
    if (queryParams) {
      for (const [key, value] of Object.entries(queryParams)) {
        url.searchParams.set(key, value);
      }
    }

    return url;
  }

  private buildHeaders(
    endpoint: APIEndpoint,
    extraHeaders?: Record<string, string>,
  ): Record<string, string> {
    const headers: Record<string, string> = {};

    // 1. Map-level default headers
    for (const [key, value] of Object.entries(this.map.headers)) {
      headers[key.toLowerCase()] = resolveEnvVars(value);
    }

    // 2. Endpoint-level headers (override map defaults)
    for (const [key, value] of Object.entries(endpoint.headers)) {
      headers[key.toLowerCase()] = resolveEnvVars(value);
    }

    // 3. Auth headers
    const auth = endpoint.auth ?? this.map.auth;
    Object.assign(headers, this.resolveAuth(auth));

    // 4. Header parameters from endpoint definition
    for (const param of endpoint.parameters) {
      if (param.in === 'header' && param.example !== undefined) {
        headers[param.name.toLowerCase()] = `${param.example as string | number | boolean}`;
      }
    }

    // 5. Caller-provided headers (highest priority)
    if (extraHeaders) {
      for (const [key, value] of Object.entries(extraHeaders)) {
        headers[key.toLowerCase()] = value;
      }
    }

    return headers;
  }

  private resolveAuth(auth: EndpointAuth): Record<string, string> {
    switch (auth.type) {
      case 'bearer': {
        const token = resolveEnvVars(`\${${auth.envVar}}`);
        return { authorization: `Bearer ${token}` };
      }
      case 'api-key': {
        const key = resolveEnvVars(`\${${auth.envVar}}`);
        const header = auth.header.toLowerCase();
        const value = auth.prefix ? `${auth.prefix} ${key}` : key;
        return { [header]: value };
      }
      case 'basic': {
        const username = resolveEnvVars(`\${${auth.usernameEnvVar}}`);
        const password = resolveEnvVars(`\${${auth.passwordEnvVar}}`);
        const encoded = Buffer.from(`${username}:${password}`).toString('base64');
        return { authorization: `Basic ${encoded}` };
      }
      case 'custom': {
        const resolved: Record<string, string> = {};
        for (const [key, value] of Object.entries(auth.headers)) {
          resolved[key.toLowerCase()] = resolveEnvVars(value);
        }
        return resolved;
      }
      case 'none':
        return {};
    }
  }

  private serializeBody(body: unknown, endpoint: APIEndpoint): string | undefined {
    if (body === undefined || body === null) return undefined;

    const contentType = endpoint.requestBody?.contentType ?? 'application/json';
    if (contentType.includes('json')) {
      return JSON.stringify(body);
    }
    return `${body as string | number | boolean}`;
  }

  private async executeOnce(
    url: URL,
    method: string,
    headers: Record<string, string>,
    body: string | undefined,
    timeoutMs: number,
    endpointMeta: { id: string; method: string; path: string },
  ): Promise<ExecuteResult> {
    const start = Date.now();
    const isHttps = url.protocol === 'https:';
    const requestFn = isHttps ? httpsRequest : httpRequest;

    logger.info({ url: url.toString(), method, endpointId: endpointMeta.id }, 'Executing API call');

    return new Promise<ExecuteResult>((resolve) => {
      let resolved = false;
      const done = (result: ExecuteResult): void => {
        if (resolved) return;
        resolved = true;
        resolve(result);
      };

      let req: ClientRequest;
      try {
        req = requestFn(
          url,
          {
            method,
            headers,
            timeout: timeoutMs,
          },
          (res: IncomingMessage) => {
            const chunks: Buffer[] = [];
            res.on('data', (chunk: Buffer) => chunks.push(chunk));
            res.on('end', () => {
              const durationMs = Date.now() - start;
              const rawBody = Buffer.concat(chunks).toString('utf-8');
              const status = res.statusCode ?? 0;
              const statusText = res.statusMessage ?? '';

              // Parse response headers to plain object
              const responseHeaders: Record<string, string> = {};
              for (const [key, value] of Object.entries(res.headers)) {
                if (value !== undefined) {
                  responseHeaders[key] = Array.isArray(value) ? value.join(', ') : value;
                }
              }

              // Try to parse JSON body
              let parsedBody: unknown = rawBody;
              const contentType = responseHeaders['content-type'] ?? '';
              if (contentType.includes('json') && rawBody.length > 0) {
                try {
                  parsedBody = JSON.parse(rawBody);
                } catch {
                  // Keep raw string if JSON parse fails
                }
              }

              logger.info(
                { endpointId: endpointMeta.id, status, durationMs },
                'API call completed',
              );

              if (status >= 200 && status < 300) {
                done({
                  ok: true,
                  status,
                  statusText,
                  headers: responseHeaders,
                  body: parsedBody,
                  durationMs,
                  endpoint: endpointMeta,
                });
              } else {
                done({
                  ok: false,
                  error: `HTTP ${status} ${statusText}: ${typeof parsedBody === 'string' ? parsedBody.slice(0, 500) : JSON.stringify(parsedBody).slice(0, 500)}`,
                  code: 'HTTP_ERROR',
                  durationMs,
                  endpoint: endpointMeta,
                  retryable: RETRYABLE_STATUS_CODES.has(status),
                });
              }
            });
            res.on('error', (err) => {
              done({
                ok: false,
                error: `Response read error: ${err.message}`,
                code: 'NETWORK_ERROR',
                durationMs: Date.now() - start,
                endpoint: endpointMeta,
                retryable: true,
              });
            });
          },
        );
      } catch (err) {
        done({
          ok: false,
          error: `Request creation failed: ${err instanceof Error ? err.message : String(err)}`,
          code: 'NETWORK_ERROR',
          durationMs: Date.now() - start,
          endpoint: endpointMeta,
          retryable: true,
        });
        return;
      }

      req.on('timeout', () => {
        req.destroy();
        done({
          ok: false,
          error: `Request timed out after ${timeoutMs}ms`,
          code: 'TIMEOUT',
          durationMs: Date.now() - start,
          endpoint: endpointMeta,
          retryable: true,
        });
      });

      req.on('error', (err) => {
        done({
          ok: false,
          error: `Network error: ${err.message}`,
          code: 'NETWORK_ERROR',
          durationMs: Date.now() - start,
          endpoint: endpointMeta,
          retryable: true,
        });
      });

      if (body !== undefined) {
        req.write(body);
      }
      req.end();
    });
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
