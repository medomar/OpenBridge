import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { OpenAPIV3 } from 'openapi-types';

// ── Hoisted mock stubs ──────────────────────────────────────────────────────

const { mockValidate } = vi.hoisted(() => ({
  mockValidate: vi.fn(),
}));

// ── swagger-parser mock ─────────────────────────────────────────────────────

vi.mock('@apidevtools/swagger-parser', () => ({
  default: { validate: mockValidate },
}));

// ── Modules under test ──────────────────────────────────────────────────────

import {
  detectInputFormat,
  parseInputToOpenAPI,
  OpenAPIAdapter,
} from '../../src/integrations/adapters/openapi-adapter.js';
import { postmanToOpenAPI } from '../../src/integrations/parsers/postman-parser.js';
import { curlsToOpenAPI, splitCurlCommands } from '../../src/integrations/parsers/curl-parser.js';

// ── Fixtures ────────────────────────────────────────────────────────────────

/** Minimal Postman Collection v2.1 with two endpoints. */
const POSTMAN_COLLECTION = {
  info: {
    name: 'Pet Store API',
    schema: 'https://schema.getpostman.com/json/collection/v2.1.0/collection.json',
    version: '1.0.0',
  },
  variable: [{ key: 'baseUrl', value: 'https://api.petstore.io' }],
  item: [
    {
      name: 'List Pets',
      request: {
        method: 'GET',
        url: {
          raw: '{{baseUrl}}/pets',
          host: ['{{baseUrl}}'],
          path: ['pets'],
          query: [{ key: 'limit', value: '10' }],
        },
      },
    },
    {
      name: 'Create Pet',
      request: {
        method: 'POST',
        url: {
          raw: '{{baseUrl}}/pets',
          host: ['{{baseUrl}}'],
          path: ['pets'],
        },
        header: [{ key: 'Content-Type', value: 'application/json' }],
        body: {
          mode: 'raw' as const,
          raw: '{"name": "Fido", "species": "dog"}',
          options: { raw: { language: 'json' } },
        },
      },
    },
  ],
};

/** cURL commands representing a simple Tasks API. */
const CURL_INPUT = `curl -X GET https://api.tasks.io/tasks -H "Authorization: Bearer tok_abc"
curl -X POST https://api.tasks.io/tasks -H "Authorization: Bearer tok_abc" -H "Content-Type: application/json" -d '{"title": "Buy groceries", "done": false}'
curl -X GET https://api.tasks.io/tasks/42 -H "Authorization: Bearer tok_abc"`;

// ── Tests ────────────────────────────────────────────────────────────────────

describe('Universal API connection flow', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.restoreAllMocks();
  });

  // ── Flow 1: Postman collection → adapter → capabilities ────────────────

  describe('Postman collection → adapter → capabilities', () => {
    it('detects Postman input format', () => {
      expect(detectInputFormat(JSON.stringify(POSTMAN_COLLECTION))).toBe('postman');
    });

    it('converts Postman collection to OpenAPI spec', () => {
      const spec = postmanToOpenAPI(POSTMAN_COLLECTION);

      expect(spec.openapi).toBe('3.0.3');
      expect(spec.info.title).toBe('Pet Store API');
      expect(spec.servers?.[0]?.url).toBe('https://api.petstore.io');

      // Should have /pets path with GET and POST
      const paths = spec.paths ?? {};
      expect(paths['/pets']).toBeDefined();
      expect(paths['/pets']?.get).toBeDefined();
      expect(paths['/pets']?.post).toBeDefined();
    });

    it('initializes adapter from Postman-derived spec and lists capabilities', async () => {
      const spec = postmanToOpenAPI(POSTMAN_COLLECTION);
      mockValidate.mockResolvedValueOnce(spec);

      const adapter = new OpenAPIAdapter('petstore');
      await adapter.initialize({
        options: { specJson: JSON.stringify(spec) },
      });

      const caps = adapter.describeCapabilities();
      expect(caps.length).toBeGreaterThanOrEqual(2);

      const names = caps.map((c) => c.name);
      // Generated operationIds from postman-parser: get_pets, post_pets
      expect(names).toContain('get_pets');
      expect(names).toContain('post_pets');

      // GET = read, POST = write
      const getCap = caps.find((c) => c.name === 'get_pets');
      expect(getCap?.category).toBe('read');
      expect(getCap?.requiresApproval).toBe(false);

      const postCap = caps.find((c) => c.name === 'post_pets');
      expect(postCap?.category).toBe('write');
      expect(postCap?.requiresApproval).toBe(true);
    });

    it('parses Postman input through parseInputToOpenAPI', async () => {
      const postmanJson = JSON.stringify(POSTMAN_COLLECTION);
      const spec = postmanToOpenAPI(POSTMAN_COLLECTION);
      mockValidate.mockResolvedValueOnce(spec);

      const result = await parseInputToOpenAPI(postmanJson);
      expect(result).toBeDefined();
      expect((result as OpenAPIV3.Document).openapi).toBe('3.0.3');
    });
  });

  // ── Flow 2: cURL commands → adapter → capabilities ────────────────────

  describe('cURL commands → adapter → capabilities', () => {
    it('detects cURL input format', () => {
      expect(detectInputFormat(CURL_INPUT)).toBe('curl');
    });

    it('splits multiple cURL commands', () => {
      const commands = splitCurlCommands(CURL_INPUT);
      expect(commands).toHaveLength(3);
      expect(commands[0]).toContain('GET');
      expect(commands[1]).toContain('POST');
      expect(commands[2]).toContain('/tasks/42');
    });

    it('converts cURL commands to OpenAPI spec', () => {
      const commands = splitCurlCommands(CURL_INPUT);
      const spec = curlsToOpenAPI(commands);

      expect(spec.openapi).toBe('3.0.3');
      expect(spec.servers?.[0]?.url).toBe('https://api.tasks.io');

      const paths = spec.paths ?? {};
      expect(paths['/tasks']).toBeDefined();
      expect(paths['/tasks/42']).toBeDefined();

      // Should have security schemes for bearer auth
      const schemes = spec.components?.securitySchemes ?? {};
      expect(schemes['bearerAuth']).toBeDefined();
    });

    it('initializes adapter from cURL-derived spec and lists capabilities', async () => {
      const commands = splitCurlCommands(CURL_INPUT);
      const spec = curlsToOpenAPI(commands);
      mockValidate.mockResolvedValueOnce(spec);

      const adapter = new OpenAPIAdapter('tasks-api');
      await adapter.initialize({
        options: { specJson: JSON.stringify(spec) },
      });

      const caps = adapter.describeCapabilities();
      expect(caps.length).toBeGreaterThanOrEqual(3);

      // Should have read and write operations
      const readOps = caps.filter((c) => c.category === 'read');
      const writeOps = caps.filter((c) => c.category === 'write');
      expect(readOps.length).toBeGreaterThanOrEqual(2); // GET /tasks, GET /tasks/42
      expect(writeOps.length).toBeGreaterThanOrEqual(1); // POST /tasks
    });

    it('parses cURL input through parseInputToOpenAPI', async () => {
      const commands = splitCurlCommands(CURL_INPUT);
      const spec = curlsToOpenAPI(commands);
      mockValidate.mockResolvedValueOnce(spec);

      const result = await parseInputToOpenAPI(CURL_INPUT);
      expect(result).toBeDefined();
      expect((result as OpenAPIV3.Document).openapi).toBe('3.0.3');
    });
  });

  // ── Flow 3: Natural language query → correct HTTP call ─────────────────

  describe('natural language query → correct HTTP call (mock HTTP)', () => {
    it('query via adapter.query() dispatches GET with path params', async () => {
      const commands = splitCurlCommands(CURL_INPUT);
      const spec = curlsToOpenAPI(commands);
      mockValidate.mockResolvedValueOnce(spec);

      const adapter = new OpenAPIAdapter('tasks-api');
      await adapter.initialize({
        options: {
          specJson: JSON.stringify(spec),
          authType: 'bearer',
          authToken: 'tok_live',
        },
      });

      // Simulate: user says "show me task 42" → mapped to GET /tasks/42
      const mockResponse = new Response(
        JSON.stringify({ id: 42, title: 'Buy groceries', done: false }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      );
      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(mockResponse);

      // Find the GET /tasks/42 capability name
      const caps = adapter.describeCapabilities();
      const getTaskCap = caps.find(
        (c) => c.category === 'read' && c.name.includes('tasks') && c.name.includes('42'),
      );
      expect(getTaskCap).toBeDefined();

      const result = await adapter.query(getTaskCap!.name, {});
      expect(result).toEqual({ id: 42, title: 'Buy groceries', done: false });

      expect(fetchSpy).toHaveBeenCalledOnce();
      const [url, options] = fetchSpy.mock.calls[0]!;
      expect(url).toBe('https://api.tasks.io/tasks/42');
      expect((options as RequestInit).method).toBe('GET');
      expect((options as RequestInit).headers).toHaveProperty('Authorization', 'Bearer tok_live');
    });

    it('execute via adapter.execute() dispatches POST with JSON body', async () => {
      const commands = splitCurlCommands(CURL_INPUT);
      const spec = curlsToOpenAPI(commands);
      mockValidate.mockResolvedValueOnce(spec);

      const adapter = new OpenAPIAdapter('tasks-api');
      await adapter.initialize({
        options: {
          specJson: JSON.stringify(spec),
          authType: 'bearer',
          authToken: 'tok_live',
        },
      });

      // Simulate: user says "create a task called Deploy v2" → POST /tasks
      const mockResponse = new Response(
        JSON.stringify({ id: 99, title: 'Deploy v2', done: false }),
        { status: 201, headers: { 'content-type': 'application/json' } },
      );
      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(mockResponse);

      // Find the POST /tasks capability name
      const caps = adapter.describeCapabilities();
      const createTaskCap = caps.find((c) => c.category === 'write' && c.name.includes('tasks'));
      expect(createTaskCap).toBeDefined();

      const result = await adapter.execute(createTaskCap!.name, {
        title: 'Deploy v2',
        done: false,
      });
      expect(result).toEqual({ id: 99, title: 'Deploy v2', done: false });

      expect(fetchSpy).toHaveBeenCalledOnce();
      const [url, options] = fetchSpy.mock.calls[0]!;
      expect(url).toBe('https://api.tasks.io/tasks');
      expect((options as RequestInit).method).toBe('POST');
      const body: unknown = JSON.parse((options as RequestInit).body as string);
      expect(body).toEqual({ title: 'Deploy v2', done: false });
    });

    it('query via Postman-derived adapter dispatches correct GET request', async () => {
      const spec = postmanToOpenAPI(POSTMAN_COLLECTION);
      mockValidate.mockResolvedValueOnce(spec);

      const adapter = new OpenAPIAdapter('petstore');
      await adapter.initialize({
        options: {
          specJson: JSON.stringify(spec),
          authType: 'bearer',
          authToken: 'tok_pets',
        },
      });

      // Simulate: user says "list all pets" → GET /pets
      const mockResponse = new Response(
        JSON.stringify([
          { id: 1, name: 'Fido' },
          { id: 2, name: 'Buddy' },
        ]),
        { status: 200, headers: { 'content-type': 'application/json' } },
      );
      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(mockResponse);

      const result = await adapter.query('get_pets', {});
      expect(result).toEqual([
        { id: 1, name: 'Fido' },
        { id: 2, name: 'Buddy' },
      ]);

      expect(fetchSpy).toHaveBeenCalledOnce();
      const [url, options] = fetchSpy.mock.calls[0]!;
      expect(url).toBe('https://api.petstore.io/pets');
      expect((options as RequestInit).method).toBe('GET');
      expect((options as RequestInit).headers).toHaveProperty('Authorization', 'Bearer tok_pets');
    });

    it('execute via Postman-derived adapter dispatches correct POST request', async () => {
      const spec = postmanToOpenAPI(POSTMAN_COLLECTION);
      mockValidate.mockResolvedValueOnce(spec);

      const adapter = new OpenAPIAdapter('petstore');
      await adapter.initialize({
        options: {
          specJson: JSON.stringify(spec),
          authType: 'bearer',
          authToken: 'tok_pets',
        },
      });

      // Simulate: user says "create a pet named Max" → POST /pets
      const mockResponse = new Response(JSON.stringify({ id: 3, name: 'Max', species: 'cat' }), {
        status: 201,
        headers: { 'content-type': 'application/json' },
      });
      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(mockResponse);

      const result = await adapter.execute('post_pets', { name: 'Max', species: 'cat' });
      expect(result).toEqual({ id: 3, name: 'Max', species: 'cat' });

      expect(fetchSpy).toHaveBeenCalledOnce();
      const [url, options] = fetchSpy.mock.calls[0]!;
      expect(url).toBe('https://api.petstore.io/pets');
      expect((options as RequestInit).method).toBe('POST');
      const body: unknown = JSON.parse((options as RequestInit).body as string);
      expect(body).toEqual({ name: 'Max', species: 'cat' });
    });
  });

  // ── Format detection edge cases ───────────────────────────────────────

  describe('format detection across input types', () => {
    it('detects OpenAPI JSON format', () => {
      const openApiJson = JSON.stringify({
        openapi: '3.0.3',
        info: { title: 'Test', version: '1.0.0' },
        paths: {},
      });
      expect(detectInputFormat(openApiJson)).toBe('openapi');
    });

    it('detects URL format', () => {
      expect(detectInputFormat('https://api.example.com/openapi.json')).toBe('url');
    });

    it('returns unknown for unrecognised input', () => {
      expect(detectInputFormat('just some random text')).toBe('unknown');
    });

    it('returns unknown for empty input', () => {
      expect(detectInputFormat('')).toBe('unknown');
    });
  });
});
