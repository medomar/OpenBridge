/**
 * Cross-module integration tests for the workspace knowledge layer.
 *
 * Tests the full flow: scanner parses a spec → map-loader validates & resolves env vars
 * → APIExecutor uses the resolved map to execute requests.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { EventEmitter } from 'node:events';
import {
  parseOpenAPISpec,
  parsePostmanCollection,
} from '../../src/_archived/knowledge/workspace-scanner.js';
import { resolveMapEnvVars } from '../../../src/_archived/core/map-loader.js';
import { WorkspaceMapSchema } from '../../src/types/workspace-map.js';

// ── Mock HTTP (hoisted) ─────────────────────────────────────────

const { mockHttpsRequest } = vi.hoisted(() => {
  const mockHttpsRequest = vi.fn();
  return { mockHttpsRequest };
});

vi.mock('node:http', () => ({
  request: vi.fn(),
}));

vi.mock('node:https', () => ({
  request: mockHttpsRequest,
}));

import { APIExecutor } from '../../src/_archived/knowledge/api-executor.js';

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

  write(data: string): boolean {
    this.writtenData.push(data);
    return true;
  }

  end(): void {
    this.ended = true;
  }

  destroy(): void {
    /* noop */
  }
}

let lastMockRequest: MockClientRequest;
let mockRequestCallback: ((res: MockIncomingMessage) => void) | undefined;

function setupMockRequest(): void {
  mockHttpsRequest.mockImplementation(
    (_url: unknown, _opts: unknown, cb: (res: MockIncomingMessage) => void) => {
      mockRequestCallback = cb;
      lastMockRequest = new MockClientRequest();
      return lastMockRequest;
    },
  );
}

function simulateResponse(status: number, body: unknown): void {
  const res = new MockIncomingMessage(status, status === 200 ? 'OK' : 'Error', {
    'content-type': 'application/json',
  });
  mockRequestCallback?.(res);
  res.emitBody(JSON.stringify(body));
}

function getCallOpts(): Record<string, unknown> {
  return mockHttpsRequest.mock.calls[0]?.[1] as Record<string, unknown>;
}

function getCallUrl(): URL {
  return mockHttpsRequest.mock.calls[0]?.[0] as URL;
}

// ── Test Fixtures ───────────────────────────────────────────────

const openapi3Spec = {
  openapi: '3.0.3',
  info: { title: 'E-Commerce API', description: 'Product management', version: '2.0.0' },
  servers: [{ url: 'https://api.shop.com/v2' }],
  components: {
    securitySchemes: {
      bearerAuth: { type: 'http', scheme: 'bearer' },
    },
  },
  security: [{ bearerAuth: [] }],
  paths: {
    '/products': {
      get: {
        operationId: 'listProducts',
        summary: 'List products',
        tags: ['products'],
        parameters: [{ name: 'page', in: 'query', required: false, schema: { type: 'integer' } }],
        responses: {
          '200': {
            description: 'OK',
            content: { 'application/json': { schema: { type: 'array' } } },
          },
        },
      },
      post: {
        operationId: 'createProduct',
        summary: 'Create product',
        tags: ['products'],
        requestBody: {
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: { name: { type: 'string' }, price: { type: 'number' } },
              },
            },
          },
        },
        responses: { '201': { description: 'Created' } },
      },
    },
    '/products/{id}': {
      get: {
        operationId: 'getProduct',
        summary: 'Get product by ID',
        tags: ['products'],
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        responses: { '200': { description: 'OK' } },
      },
    },
  },
};

const postmanCollection = {
  info: {
    name: 'Inventory API',
    description: 'Stock management',
    schema: 'https://schema.getpostman.com/json/collection/v2.1.0/collection.json',
  },
  auth: {
    type: 'bearer',
    bearer: [{ key: 'token', value: '{{token}}' }],
  },
  variable: [{ key: 'baseUrl', value: 'https://api.inventory.com' }],
  item: [
    {
      name: 'Stock',
      item: [
        {
          name: 'Get Stock',
          request: {
            method: 'GET',
            url: {
              raw: 'https://api.inventory.com/stock?warehouse=main',
              protocol: 'https',
              host: ['api', 'inventory', 'com'],
              path: ['stock'],
              query: [{ key: 'warehouse', value: 'main' }],
            },
          },
        },
      ],
    },
  ],
};

// ── Integration Tests ───────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers();
  setupMockRequest();
  process.env['API_TOKEN'] = 'integration-test-token';
});

afterEach(() => {
  vi.useRealTimers();
  delete process.env['API_TOKEN'];
});

describe('Workspace Knowledge — Integration', () => {
  describe('OpenAPI → Scanner → Executor flow', () => {
    it('should parse OpenAPI spec and execute a GET request', async () => {
      // Step 1: Parse OpenAPI spec into WorkspaceMap
      const map = parseOpenAPISpec(
        openapi3Spec as Parameters<typeof parseOpenAPISpec>[0],
        'openapi',
      );

      // Step 2: Validate the map passes Zod schema
      const validated = WorkspaceMapSchema.parse(map);
      expect(validated.name).toBe('E-Commerce API');
      expect(validated.endpoints).toHaveLength(3);

      // Step 3: Create executor and execute a request
      const executor = new APIExecutor(validated);
      const promise = executor.execute({ endpointId: 'listProducts', queryParams: { page: '1' } });
      await vi.advanceTimersByTimeAsync(0);

      // Verify the request was built correctly
      const url = getCallUrl();
      expect(url.hostname).toBe('api.shop.com');
      // URL('/products', 'https://api.shop.com/v2') → absolute path replaces base path
      expect(url.pathname).toBe('/products');
      expect(url.searchParams.get('page')).toBe('1');

      const opts = getCallOpts();
      const headers = opts['headers'] as Record<string, string>;
      expect(headers['authorization']).toBe('Bearer integration-test-token');

      simulateResponse(200, [{ id: 1, name: 'Widget' }]);
      const result = await promise;
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.body).toEqual([{ id: 1, name: 'Widget' }]);
      }
    });

    it('should parse OpenAPI spec and execute a POST with body', async () => {
      const map = parseOpenAPISpec(
        openapi3Spec as Parameters<typeof parseOpenAPISpec>[0],
        'openapi',
      );
      const executor = new APIExecutor(map);

      const body = { name: 'Gadget', price: 29.99 };
      const promise = executor.execute({ endpointId: 'createProduct', body });
      await vi.advanceTimersByTimeAsync(0);

      expect(lastMockRequest.writtenData).toEqual([JSON.stringify(body)]);

      simulateResponse(200, { id: 2, ...body });
      const result = await promise;
      expect(result.ok).toBe(true);
    });

    it('should parse OpenAPI spec and resolve path params', async () => {
      const map = parseOpenAPISpec(
        openapi3Spec as Parameters<typeof parseOpenAPISpec>[0],
        'openapi',
      );
      const executor = new APIExecutor(map);

      const promise = executor.execute({
        endpointId: 'getProduct',
        pathParams: { id: 'prod-42' },
      });
      await vi.advanceTimersByTimeAsync(0);

      const url = getCallUrl();
      expect(url.pathname).toBe('/products/prod-42');

      simulateResponse(200, { id: 'prod-42', name: 'Widget' });
      await promise;
    });
  });

  describe('Postman → Scanner → Executor flow', () => {
    it('should parse Postman collection and execute a request', async () => {
      // Step 1: Parse Postman collection
      const map = parsePostmanCollection(
        postmanCollection as Parameters<typeof parsePostmanCollection>[0],
      );
      expect(map.name).toBe('Inventory API');
      expect(map.source).toBe('postman');

      // Step 2: Create executor and execute
      const executor = new APIExecutor(map);
      const promise = executor.execute({ endpointId: map.endpoints[0]!.id });
      await vi.advanceTimersByTimeAsync(0);

      const url = getCallUrl();
      expect(url.pathname).toBe('/stock');

      simulateResponse(200, [{ item: 'bolt', qty: 1000 }]);
      const result = await promise;
      expect(result.ok).toBe(true);
    });
  });

  describe('Scanner → resolveMapEnvVars → Executor flow', () => {
    it('should resolve env vars in custom auth before executing', async () => {
      process.env['CUSTOM_TOKEN'] = 'resolved-secret';

      // Create a map with custom auth that references env vars
      const map = WorkspaceMapSchema.parse({
        version: '1.0',
        name: 'custom-auth-api',
        baseUrl: 'https://api.example.com',
        auth: { type: 'custom', headers: { 'X-Auth': '${CUSTOM_TOKEN}' } },
        endpoints: [{ id: 'ep1', name: 'EP1', method: 'GET', path: '/data' }],
      });

      // Resolve env vars
      const resolved = resolveMapEnvVars(map);
      if (resolved.auth.type === 'custom') {
        expect(resolved.auth.headers['X-Auth']).toBe('resolved-secret');
      }

      // Execute with resolved map
      const executor = new APIExecutor(resolved);
      const promise = executor.execute({ endpointId: 'ep1' });
      await vi.advanceTimersByTimeAsync(0);

      const headers = getCallOpts()['headers'] as Record<string, string>;
      expect(headers['x-auth']).toBe('resolved-secret');

      simulateResponse(200, { data: 'ok' });
      const result = await promise;
      expect(result.ok).toBe(true);

      delete process.env['CUSTOM_TOKEN'];
    });
  });
});
