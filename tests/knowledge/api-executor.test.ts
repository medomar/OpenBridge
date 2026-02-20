import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { EventEmitter } from 'node:events';
import type { WorkspaceMap } from '../../src/types/workspace-map.js';

// ── Mock HTTP (hoisted) ─────────────────────────────────────────

const { mockHttpRequest, mockHttpsRequest } = vi.hoisted(() => {
  const mockHttpRequest = vi.fn();
  const mockHttpsRequest = vi.fn();
  return { mockHttpRequest, mockHttpsRequest };
});

vi.mock('node:http', () => ({
  request: mockHttpRequest,
}));

vi.mock('node:https', () => ({
  request: mockHttpsRequest,
}));

// ── Import After Mocks ──────────────────────────────────────────

import { APIExecutor } from '../../src/knowledge/api-executor.js';

// ── Mock Helpers ────────────────────────────────────────────────

class MockIncomingMessage extends EventEmitter {
  statusCode: number;
  statusMessage: string;
  headers: Record<string, string>;

  constructor(status: number, statusMessage: string, headers: Record<string, string> = {}) {
    super();
    this.statusCode = status;
    this.statusMessage = statusMessage;
    this.headers = headers;
  }

  emitBody(body: string): void {
    this.emit('data', Buffer.from(body));
    this.emit('end');
  }
}

class MockClientRequest extends EventEmitter {
  writtenData: string[] = [];
  ended = false;
  destroyed = false;

  write(data: string): boolean {
    this.writtenData.push(data);
    return true;
  }

  end(): void {
    this.ended = true;
  }

  destroy(): void {
    this.destroyed = true;
  }
}

let lastMockRequest: MockClientRequest;
let mockRequestCallback: ((res: MockIncomingMessage) => void) | undefined;

function setupMockRequest(mockFn: ReturnType<typeof vi.fn>): void {
  mockFn.mockImplementation(
    (_url: unknown, _opts: unknown, cb: (res: MockIncomingMessage) => void) => {
      mockRequestCallback = cb;
      lastMockRequest = new MockClientRequest();
      return lastMockRequest;
    },
  );
}

/** Safely extract URL from first mock call */
function getCallUrl(mockFn: ReturnType<typeof vi.fn>): URL {
  return mockFn.mock.calls[0]?.[0] as URL;
}

/** Safely extract options (headers, method) from first mock call */
function getCallOpts(mockFn: ReturnType<typeof vi.fn>): Record<string, unknown> {
  return mockFn.mock.calls[0]?.[1] as Record<string, unknown>;
}

function simulateResponse(
  status: number,
  body: unknown,
  headers: Record<string, string> = {},
): void {
  const contentType = headers['content-type'] ?? 'application/json';
  const res = new MockIncomingMessage(status, status === 200 ? 'OK' : 'Error', {
    'content-type': contentType,
    ...headers,
  });
  mockRequestCallback?.(res);
  const bodyStr = typeof body === 'string' ? body : JSON.stringify(body);
  res.emitBody(bodyStr);
}

// ── Test Fixtures ───────────────────────────────────────────────

const testMap: WorkspaceMap = {
  version: '1.0',
  name: 'test-api',
  description: 'Test API for executor tests',
  baseUrl: 'https://api.example.com',
  auth: { type: 'bearer', envVar: 'API_TOKEN' },
  source: 'manual',
  headers: { 'x-api-version': '2' },
  endpoints: [
    {
      id: 'list-products',
      name: 'List Products',
      description: 'Get all products',
      method: 'GET',
      path: '/products',
      parameters: [
        { name: 'page', in: 'query', required: false, type: 'number' },
        { name: 'limit', in: 'query', required: false, type: 'number', example: '20' },
      ],
      headers: {},
      tags: ['products'],
    },
    {
      id: 'get-product',
      name: 'Get Product',
      description: 'Get a product by ID',
      method: 'GET',
      path: '/products/:id',
      parameters: [{ name: 'id', in: 'path', required: true, type: 'string' }],
      headers: {},
      tags: ['products'],
    },
    {
      id: 'create-product',
      name: 'Create Product',
      description: 'Create a new product',
      method: 'POST',
      path: '/products',
      parameters: [],
      headers: { 'x-custom': 'endpoint-header' },
      tags: ['products'],
      requestBody: {
        contentType: 'application/json',
        example: { name: 'Widget', price: 9.99 },
      },
    },
    {
      id: 'no-auth-endpoint',
      name: 'Public endpoint',
      method: 'GET',
      path: '/public/health',
      parameters: [],
      headers: {},
      tags: ['public'],
      auth: { type: 'none' },
    },
    {
      id: 'custom-base',
      name: 'Custom base URL',
      method: 'GET',
      path: '/status',
      baseUrl: 'https://other.example.com',
      parameters: [],
      headers: {},
      tags: [],
    },
    {
      id: 'multi-path-params',
      name: 'Nested resource',
      method: 'GET',
      path: '/shops/:shopId/products/:productId',
      parameters: [
        { name: 'shopId', in: 'path', required: true, type: 'string' },
        { name: 'productId', in: 'path', required: true, type: 'string' },
      ],
      headers: {},
      tags: [],
    },
  ],
  metadata: {},
};

// ── Tests ────────────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers();
  setupMockRequest(mockHttpRequest);
  setupMockRequest(mockHttpsRequest);
  process.env['API_TOKEN'] = 'test-token-123';
});

afterEach(() => {
  vi.useRealTimers();
  delete process.env['API_TOKEN'];
});

describe('APIExecutor', () => {
  describe('constructor', () => {
    it('should index all endpoints by ID', () => {
      const executor = new APIExecutor(testMap);
      expect(executor.findEndpoint('list-products')).toBeDefined();
      expect(executor.findEndpoint('get-product')).toBeDefined();
      expect(executor.findEndpoint('create-product')).toBeDefined();
      expect(executor.findEndpoint('nonexistent')).toBeUndefined();
    });

    it('should list all endpoints', () => {
      const executor = new APIExecutor(testMap);
      const endpoints = executor.listEndpoints();
      expect(endpoints).toHaveLength(testMap.endpoints.length);
      expect(endpoints[0]).toEqual({
        id: 'list-products',
        method: 'GET',
        path: '/products',
        name: 'List Products',
      });
    });
  });

  describe('execute — endpoint not found', () => {
    it('should return ENDPOINT_NOT_FOUND error', async () => {
      const executor = new APIExecutor(testMap);
      const result = await executor.execute({ endpointId: 'nonexistent' });

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.code).toBe('ENDPOINT_NOT_FOUND');
        expect(result.retryable).toBe(false);
        expect(result.error).toContain('nonexistent');
      }
    });
  });

  describe('execute — successful requests', () => {
    it('should execute a simple GET request with HTTPS', async () => {
      const executor = new APIExecutor(testMap);
      const promise = executor.execute({ endpointId: 'list-products' });

      await vi.advanceTimersByTimeAsync(0);

      expect(mockHttpsRequest).toHaveBeenCalledTimes(1);
      const url = getCallUrl(mockHttpsRequest);
      const opts = getCallOpts(mockHttpsRequest);
      expect(url.toString()).toContain('api.example.com/products');
      expect(opts['method']).toBe('GET');

      simulateResponse(200, { products: [{ id: 1 }] });
      const result = await promise;

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.status).toBe(200);
        expect(result.body).toEqual({ products: [{ id: 1 }] });
        expect(result.durationMs).toBeGreaterThanOrEqual(0);
        expect(result.endpoint.id).toBe('list-products');
      }
    });

    it('should include auth headers from map-level auth', async () => {
      const executor = new APIExecutor(testMap);
      const promise = executor.execute({ endpointId: 'list-products' });
      await vi.advanceTimersByTimeAsync(0);

      const headers = getCallOpts(mockHttpsRequest)['headers'] as Record<string, string>;
      expect(headers['authorization']).toBe('Bearer test-token-123');

      simulateResponse(200, []);
      await promise;
    });

    it('should include map-level default headers', async () => {
      const executor = new APIExecutor(testMap);
      const promise = executor.execute({ endpointId: 'list-products' });
      await vi.advanceTimersByTimeAsync(0);

      const headers = getCallOpts(mockHttpsRequest)['headers'] as Record<string, string>;
      expect(headers['x-api-version']).toBe('2');

      simulateResponse(200, []);
      await promise;
    });

    it('should include endpoint-level headers', async () => {
      const executor = new APIExecutor(testMap);
      const promise = executor.execute({ endpointId: 'create-product' });
      await vi.advanceTimersByTimeAsync(0);

      const headers = getCallOpts(mockHttpsRequest)['headers'] as Record<string, string>;
      expect(headers['x-custom']).toBe('endpoint-header');

      simulateResponse(201, { id: 1 });
      await promise;
    });

    it('should use endpoint-level auth override (none)', async () => {
      const executor = new APIExecutor(testMap);
      const promise = executor.execute({ endpointId: 'no-auth-endpoint' });
      await vi.advanceTimersByTimeAsync(0);

      const headers = getCallOpts(mockHttpsRequest)['headers'] as Record<string, string>;
      expect(headers['authorization']).toBeUndefined();

      simulateResponse(200, { status: 'ok' });
      await promise;
    });

    it('should resolve path parameters', async () => {
      const executor = new APIExecutor(testMap);
      const promise = executor.execute({
        endpointId: 'get-product',
        pathParams: { id: '42' },
      });
      await vi.advanceTimersByTimeAsync(0);

      expect(getCallUrl(mockHttpsRequest).pathname).toBe('/products/42');

      simulateResponse(200, { id: 42, name: 'Widget' });
      await promise;
    });

    it('should resolve multiple path parameters', async () => {
      const executor = new APIExecutor(testMap);
      const promise = executor.execute({
        endpointId: 'multi-path-params',
        pathParams: { shopId: 'shop-1', productId: 'prod-99' },
      });
      await vi.advanceTimersByTimeAsync(0);

      expect(getCallUrl(mockHttpsRequest).pathname).toBe('/shops/shop-1/products/prod-99');

      simulateResponse(200, {});
      await promise;
    });

    it('should encode path parameters', async () => {
      const executor = new APIExecutor(testMap);
      const promise = executor.execute({
        endpointId: 'get-product',
        pathParams: { id: 'a b/c' },
      });
      await vi.advanceTimersByTimeAsync(0);

      expect(getCallUrl(mockHttpsRequest).pathname).toBe('/products/a%20b%2Fc');

      simulateResponse(200, {});
      await promise;
    });

    it('should add query parameters', async () => {
      const executor = new APIExecutor(testMap);
      const promise = executor.execute({
        endpointId: 'list-products',
        queryParams: { page: '2', limit: '10' },
      });
      await vi.advanceTimersByTimeAsync(0);

      const callUrl = getCallUrl(mockHttpsRequest);
      expect(callUrl.searchParams.get('page')).toBe('2');
      expect(callUrl.searchParams.get('limit')).toBe('10');

      simulateResponse(200, []);
      await promise;
    });

    it('should send request body for POST', async () => {
      const executor = new APIExecutor(testMap);
      const body = { name: 'New Product', price: 19.99 };
      const promise = executor.execute({ endpointId: 'create-product', body });
      await vi.advanceTimersByTimeAsync(0);

      expect(lastMockRequest.writtenData).toEqual([JSON.stringify(body)]);
      expect(lastMockRequest.ended).toBe(true);

      simulateResponse(201, { id: 1, ...body });
      await promise;
    });

    it('should use endpoint-level baseUrl override', async () => {
      const executor = new APIExecutor(testMap);
      const promise = executor.execute({ endpointId: 'custom-base' });
      await vi.advanceTimersByTimeAsync(0);

      const callUrl = getCallUrl(mockHttpsRequest);
      expect(callUrl.hostname).toBe('other.example.com');
      expect(callUrl.pathname).toBe('/status');

      simulateResponse(200, {});
      await promise;
    });

    it('should allow caller to provide extra headers', async () => {
      const executor = new APIExecutor(testMap);
      const promise = executor.execute({
        endpointId: 'list-products',
        headers: { 'x-request-id': 'req-123' },
      });
      await vi.advanceTimersByTimeAsync(0);

      const headers = getCallOpts(mockHttpsRequest)['headers'] as Record<string, string>;
      expect(headers['x-request-id']).toBe('req-123');

      simulateResponse(200, []);
      await promise;
    });

    it('should parse non-JSON responses as string', async () => {
      const executor = new APIExecutor(testMap);
      const promise = executor.execute({ endpointId: 'no-auth-endpoint' });
      await vi.advanceTimersByTimeAsync(0);

      const res = new MockIncomingMessage(200, 'OK', { 'content-type': 'text/plain' });
      mockRequestCallback?.(res);
      res.emitBody('healthy');

      const result = await promise;
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.body).toBe('healthy');
      }
    });
  });

  describe('execute — error handling', () => {
    it('should return HTTP_ERROR for non-2xx status codes', async () => {
      const executor = new APIExecutor(testMap);
      const promise = executor.execute({
        endpointId: 'get-product',
        pathParams: { id: '999' },
      });
      await vi.advanceTimersByTimeAsync(0);

      simulateResponse(404, { error: 'Not found' });
      const result = await promise;

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.code).toBe('HTTP_ERROR');
        expect(result.error).toContain('404');
        expect(result.retryable).toBe(false);
      }
    });

    it('should return REQUEST_BUILD_ERROR for missing path params', async () => {
      const executor = new APIExecutor(testMap);
      const result = await executor.execute({ endpointId: 'get-product' });

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.code).toBe('REQUEST_BUILD_ERROR');
        expect(result.error).toContain('id');
        expect(result.retryable).toBe(false);
      }
    });

    it('should return AUTH_ERROR when env var is missing', async () => {
      delete process.env['API_TOKEN'];
      const executor = new APIExecutor(testMap);
      const result = await executor.execute({ endpointId: 'list-products' });

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.code).toBe('AUTH_ERROR');
        expect(result.error).toContain('API_TOKEN');
        expect(result.retryable).toBe(false);
      }
    });

    it('should mark 5xx errors as retryable', async () => {
      const executor = new APIExecutor(testMap, { maxRetries: 0 });
      const promise = executor.execute({ endpointId: 'no-auth-endpoint' });
      await vi.advanceTimersByTimeAsync(0);

      simulateResponse(503, { error: 'Service unavailable' });
      const result = await promise;

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.retryable).toBe(true);
      }
    });

    it('should mark 429 as retryable', async () => {
      const executor = new APIExecutor(testMap, { maxRetries: 0 });
      const promise = executor.execute({ endpointId: 'no-auth-endpoint' });
      await vi.advanceTimersByTimeAsync(0);

      simulateResponse(429, { error: 'Rate limited' });
      const result = await promise;

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.retryable).toBe(true);
      }
    });

    it('should handle request timeout', async () => {
      const executor = new APIExecutor(testMap, { maxRetries: 0 });
      const promise = executor.execute({ endpointId: 'no-auth-endpoint', timeoutMs: 5000 });
      await vi.advanceTimersByTimeAsync(0);

      lastMockRequest.emit('timeout');
      const result = await promise;

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.code).toBe('TIMEOUT');
        expect(result.retryable).toBe(true);
        expect(result.error).toContain('5000');
      }
    });

    it('should handle network errors', async () => {
      const executor = new APIExecutor(testMap, { maxRetries: 0 });
      const promise = executor.execute({ endpointId: 'no-auth-endpoint' });
      await vi.advanceTimersByTimeAsync(0);

      lastMockRequest.emit('error', new Error('ECONNREFUSED'));
      const result = await promise;

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.code).toBe('NETWORK_ERROR');
        expect(result.retryable).toBe(true);
        expect(result.error).toContain('ECONNREFUSED');
      }
    });
  });

  describe('execute — retries', () => {
    it('should retry transient errors up to maxRetries', async () => {
      const executor = new APIExecutor(testMap, { maxRetries: 2, retryBaseDelayMs: 100 });
      const promise = executor.execute({ endpointId: 'no-auth-endpoint' });

      // First attempt — 503
      await vi.advanceTimersByTimeAsync(0);
      simulateResponse(503, { error: 'down' });

      // Wait for retry delay (100ms * 2^0 = 100ms)
      await vi.advanceTimersByTimeAsync(100);
      simulateResponse(503, { error: 'still down' });

      // Wait for retry delay (100ms * 2^1 = 200ms)
      await vi.advanceTimersByTimeAsync(200);
      simulateResponse(200, { status: 'recovered' });

      const result = await promise;
      expect(result.ok).toBe(true);
      expect(mockHttpsRequest).toHaveBeenCalledTimes(3);
    });

    it('should not retry non-retryable errors', async () => {
      const executor = new APIExecutor(testMap, { maxRetries: 2 });
      const promise = executor.execute({ endpointId: 'no-auth-endpoint' });

      await vi.advanceTimersByTimeAsync(0);
      simulateResponse(400, { error: 'Bad request' });

      const result = await promise;
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.code).toBe('HTTP_ERROR');
        expect(result.retryable).toBe(false);
      }
      expect(mockHttpsRequest).toHaveBeenCalledTimes(1);
    });

    it('should return last error after all retries exhausted', async () => {
      const executor = new APIExecutor(testMap, { maxRetries: 1, retryBaseDelayMs: 50 });
      const promise = executor.execute({ endpointId: 'no-auth-endpoint' });

      // First attempt
      await vi.advanceTimersByTimeAsync(0);
      simulateResponse(500, { error: 'server error' });

      // Retry
      await vi.advanceTimersByTimeAsync(50);
      simulateResponse(502, { error: 'bad gateway' });

      const result = await promise;
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error).toContain('502');
      }
      expect(mockHttpsRequest).toHaveBeenCalledTimes(2);
    });
  });

  describe('execute — auth types', () => {
    it('should handle basic auth', async () => {
      process.env['API_USER'] = 'admin';
      process.env['API_PASS'] = 'secret';
      const basicMap: WorkspaceMap = {
        ...testMap,
        auth: { type: 'basic', usernameEnvVar: 'API_USER', passwordEnvVar: 'API_PASS' },
      };
      const executor = new APIExecutor(basicMap);
      const promise = executor.execute({ endpointId: 'list-products' });
      await vi.advanceTimersByTimeAsync(0);

      const headers = getCallOpts(mockHttpsRequest)['headers'] as Record<string, string>;
      const expected = Buffer.from('admin:secret').toString('base64');
      expect(headers['authorization']).toBe(`Basic ${expected}`);

      simulateResponse(200, []);
      await promise;
      delete process.env['API_USER'];
      delete process.env['API_PASS'];
    });

    it('should handle api-key auth', async () => {
      process.env['MY_KEY'] = 'key-abc';
      const apiKeyMap: WorkspaceMap = {
        ...testMap,
        auth: { type: 'api-key', header: 'X-API-Key', envVar: 'MY_KEY' },
      };
      const executor = new APIExecutor(apiKeyMap);
      const promise = executor.execute({ endpointId: 'list-products' });
      await vi.advanceTimersByTimeAsync(0);

      const headers = getCallOpts(mockHttpsRequest)['headers'] as Record<string, string>;
      expect(headers['x-api-key']).toBe('key-abc');

      simulateResponse(200, []);
      await promise;
      delete process.env['MY_KEY'];
    });

    it('should handle api-key auth with prefix', async () => {
      process.env['MY_KEY'] = 'key-abc';
      const apiKeyMap: WorkspaceMap = {
        ...testMap,
        auth: {
          type: 'api-key',
          header: 'Authorization',
          prefix: 'ApiKey',
          envVar: 'MY_KEY',
        },
      };
      const executor = new APIExecutor(apiKeyMap);
      const promise = executor.execute({ endpointId: 'list-products' });
      await vi.advanceTimersByTimeAsync(0);

      const headers = getCallOpts(mockHttpsRequest)['headers'] as Record<string, string>;
      expect(headers['authorization']).toBe('ApiKey key-abc');

      simulateResponse(200, []);
      await promise;
      delete process.env['MY_KEY'];
    });

    it('should handle custom auth headers', async () => {
      const customMap: WorkspaceMap = {
        ...testMap,
        auth: {
          type: 'custom',
          headers: { 'X-Custom-Auth': 'static-token', 'X-Tenant': 'tenant-1' },
        },
      };
      const executor = new APIExecutor(customMap);
      const promise = executor.execute({ endpointId: 'list-products' });
      await vi.advanceTimersByTimeAsync(0);

      const headers = getCallOpts(mockHttpsRequest)['headers'] as Record<string, string>;
      expect(headers['x-custom-auth']).toBe('static-token');
      expect(headers['x-tenant']).toBe('tenant-1');

      simulateResponse(200, []);
      await promise;
    });
  });

  describe('execute — HTTP protocol', () => {
    it('should use http for http:// URLs', async () => {
      const httpMap: WorkspaceMap = {
        ...testMap,
        baseUrl: 'http://localhost:3000',
        auth: { type: 'none' },
      };
      const executor = new APIExecutor(httpMap);
      const promise = executor.execute({ endpointId: 'no-auth-endpoint' });
      await vi.advanceTimersByTimeAsync(0);

      expect(mockHttpRequest).toHaveBeenCalledTimes(1);
      expect(mockHttpsRequest).not.toHaveBeenCalled();

      simulateResponse(200, {});
      await promise;
    });
  });
});
