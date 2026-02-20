import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  loadWorkspaceMap,
  loadAndResolveWorkspaceMap,
  resolveEnvVars,
  resolveMapEnvVars,
  DEFAULT_MAP_FILENAME,
} from '../../src/core/map-loader.js';
import type { WorkspaceMap } from '../../src/types/workspace-map.js';

const mockReadFile = vi.fn<(...args: unknown[]) => Promise<string>>();

vi.mock('node:fs/promises', () => ({
  readFile: (...args: unknown[]) => mockReadFile(...args),
}));

function makeValidMap(overrides: Partial<WorkspaceMap> = {}): WorkspaceMap {
  return {
    version: '1.0',
    name: 'test-api',
    baseUrl: 'https://api.example.com',
    source: 'manual',
    auth: { type: 'none' },
    headers: {},
    endpoints: [
      {
        id: 'get-items',
        name: 'Get Items',
        method: 'GET',
        path: '/items',
        parameters: [],
        headers: {},
        tags: [],
      },
    ],
    metadata: {},
    ...overrides,
  };
}

describe('map-loader', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('DEFAULT_MAP_FILENAME', () => {
    it('is openbridge.map.json', () => {
      expect(DEFAULT_MAP_FILENAME).toBe('openbridge.map.json');
    });
  });

  describe('resolveEnvVars()', () => {
    afterEach(() => {
      delete process.env['TEST_TOKEN'];
      delete process.env['OTHER_VAR'];
    });

    it('replaces ${VAR} with env value', () => {
      process.env['TEST_TOKEN'] = 'my-secret';
      expect(resolveEnvVars('Bearer ${TEST_TOKEN}')).toBe('Bearer my-secret');
    });

    it('replaces multiple vars in one string', () => {
      process.env['TEST_TOKEN'] = 'abc';
      process.env['OTHER_VAR'] = '123';
      expect(resolveEnvVars('${TEST_TOKEN}-${OTHER_VAR}')).toBe('abc-123');
    });

    it('returns string unchanged when no vars present', () => {
      expect(resolveEnvVars('plain-value')).toBe('plain-value');
    });

    it('throws when referenced env var is not set', () => {
      expect(() => resolveEnvVars('${MISSING_VAR}')).toThrow(
        'Environment variable "MISSING_VAR" is not set',
      );
    });
  });

  describe('resolveMapEnvVars()', () => {
    afterEach(() => {
      delete process.env['MAP_TOKEN'];
      delete process.env['CUSTOM_HEADER'];
    });

    it('resolves custom auth header env vars', () => {
      process.env['CUSTOM_HEADER'] = 'resolved-value';
      const map = makeValidMap({
        auth: { type: 'custom', headers: { 'X-Auth': '${CUSTOM_HEADER}' } },
      });
      const resolved = resolveMapEnvVars(map);
      expect(resolved.auth).toEqual({
        type: 'custom',
        headers: { 'X-Auth': 'resolved-value' },
      });
    });

    it('resolves env vars in default headers', () => {
      process.env['MAP_TOKEN'] = 'token-123';
      const map = makeValidMap({
        headers: { 'X-Trace': '${MAP_TOKEN}' },
      });
      const resolved = resolveMapEnvVars(map);
      expect(resolved.headers['X-Trace']).toBe('token-123');
    });

    it('resolves env vars in endpoint-level custom auth', () => {
      process.env['CUSTOM_HEADER'] = 'ep-value';
      const map = makeValidMap({
        endpoints: [
          {
            id: 'ep1',
            name: 'EP1',
            method: 'GET',
            path: '/ep1',
            auth: { type: 'custom', headers: { 'X-EP': '${CUSTOM_HEADER}' } },
            parameters: [],
            headers: {},
            tags: [],
          },
        ],
      });
      const resolved = resolveMapEnvVars(map);
      expect(resolved.endpoints[0]!.auth).toEqual({
        type: 'custom',
        headers: { 'X-EP': 'ep-value' },
      });
    });

    it('passes through none auth unchanged', () => {
      const map = makeValidMap({ auth: { type: 'none' } });
      const resolved = resolveMapEnvVars(map);
      expect(resolved.auth).toEqual({ type: 'none' });
    });

    it('passes through bearer auth envVar reference unchanged', () => {
      const map = makeValidMap({ auth: { type: 'bearer', envVar: 'MY_TOKEN' } });
      const resolved = resolveMapEnvVars(map);
      expect(resolved.auth).toEqual({ type: 'bearer', envVar: 'MY_TOKEN' });
    });
  });

  describe('loadWorkspaceMap()', () => {
    it('loads and validates a valid map file', async () => {
      const validMap = makeValidMap();
      mockReadFile.mockResolvedValueOnce(JSON.stringify(validMap));

      const result = await loadWorkspaceMap('/workspace');
      expect(result.name).toBe('test-api');
      expect(result.endpoints).toHaveLength(1);
      expect(mockReadFile).toHaveBeenCalledWith('/workspace/openbridge.map.json', 'utf-8');
    });

    it('uses custom map filename', async () => {
      const validMap = makeValidMap();
      mockReadFile.mockResolvedValueOnce(JSON.stringify(validMap));

      await loadWorkspaceMap('/workspace', 'custom-map.json');
      expect(mockReadFile).toHaveBeenCalledWith('/workspace/custom-map.json', 'utf-8');
    });

    it('supports absolute map path', async () => {
      const validMap = makeValidMap();
      mockReadFile.mockResolvedValueOnce(JSON.stringify(validMap));

      await loadWorkspaceMap('/workspace', '/etc/maps/api.json');
      expect(mockReadFile).toHaveBeenCalledWith('/etc/maps/api.json', 'utf-8');
    });

    it('throws on invalid JSON', async () => {
      mockReadFile.mockResolvedValueOnce('not json');
      await expect(loadWorkspaceMap('/workspace')).rejects.toThrow();
    });

    it('throws on missing required fields', async () => {
      mockReadFile.mockResolvedValueOnce(JSON.stringify({ name: 'test' }));
      await expect(loadWorkspaceMap('/workspace')).rejects.toThrow();
    });

    it('throws when endpoints array is empty', async () => {
      const map = makeValidMap({ endpoints: [] });
      mockReadFile.mockResolvedValueOnce(JSON.stringify(map));
      await expect(loadWorkspaceMap('/workspace')).rejects.toThrow();
    });

    it('throws when file does not exist', async () => {
      mockReadFile.mockRejectedValueOnce(new Error('ENOENT: no such file'));
      await expect(loadWorkspaceMap('/workspace')).rejects.toThrow('ENOENT');
    });

    it('validates endpoint method is a valid HTTP method', async () => {
      const map = makeValidMap();
      map.endpoints[0]!.method = 'INVALID' as 'GET';
      mockReadFile.mockResolvedValueOnce(JSON.stringify(map));
      await expect(loadWorkspaceMap('/workspace')).rejects.toThrow();
    });

    it('validates baseUrl is a valid URL', async () => {
      const map = makeValidMap({ baseUrl: 'not-a-url' });
      mockReadFile.mockResolvedValueOnce(JSON.stringify(map));
      await expect(loadWorkspaceMap('/workspace')).rejects.toThrow();
    });

    it('loads map with bearer auth', async () => {
      const map = makeValidMap({ auth: { type: 'bearer', envVar: 'TOKEN' } });
      mockReadFile.mockResolvedValueOnce(JSON.stringify(map));
      const result = await loadWorkspaceMap('/workspace');
      expect(result.auth).toEqual({ type: 'bearer', envVar: 'TOKEN' });
    });

    it('loads map with api-key auth', async () => {
      const map = makeValidMap({
        auth: { type: 'api-key', header: 'X-Key', envVar: 'KEY' },
      });
      mockReadFile.mockResolvedValueOnce(JSON.stringify(map));
      const result = await loadWorkspaceMap('/workspace');
      expect(result.auth.type).toBe('api-key');
    });

    it('loads map with basic auth', async () => {
      const map = makeValidMap({
        auth: { type: 'basic', usernameEnvVar: 'USER', passwordEnvVar: 'PASS' },
      });
      mockReadFile.mockResolvedValueOnce(JSON.stringify(map));
      const result = await loadWorkspaceMap('/workspace');
      expect(result.auth.type).toBe('basic');
    });

    it('applies defaults for optional fields', async () => {
      const minimal = {
        version: '1.0',
        name: 'minimal',
        baseUrl: 'https://api.test.com',
        endpoints: [{ id: 'ep1', name: 'EP', method: 'GET', path: '/test' }],
      };
      mockReadFile.mockResolvedValueOnce(JSON.stringify(minimal));
      const result = await loadWorkspaceMap('/workspace');
      expect(result.auth).toEqual({ type: 'none' });
      expect(result.source).toBe('manual');
      expect(result.headers).toEqual({});
      expect(result.metadata).toEqual({});
      expect(result.endpoints[0]!.parameters).toEqual([]);
      expect(result.endpoints[0]!.headers).toEqual({});
      expect(result.endpoints[0]!.tags).toEqual([]);
    });

    it('loads map with full endpoint definitions', async () => {
      const map = makeValidMap({
        endpoints: [
          {
            id: 'create-item',
            name: 'Create Item',
            description: 'Creates an item',
            method: 'POST',
            path: '/items',
            parameters: [{ name: 'dryRun', in: 'query', type: 'boolean', required: false }],
            headers: { 'X-Request-ID': 'abc' },
            requestBody: {
              contentType: 'application/json',
              schema: {
                name: { type: 'string', required: true },
              },
              example: { name: 'Test' },
            },
            response: {
              contentType: 'application/json',
              schema: {
                id: { type: 'string' },
              },
            },
            tags: ['items', 'write'],
          },
        ],
      });
      mockReadFile.mockResolvedValueOnce(JSON.stringify(map));
      const result = await loadWorkspaceMap('/workspace');
      const ep = result.endpoints[0]!;
      expect(ep.id).toBe('create-item');
      // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
      expect(ep.requestBody?.schema?.['name']?.type).toBe('string');
      expect(ep.tags).toEqual(['items', 'write']);
    });
  });

  describe('loadAndResolveWorkspaceMap()', () => {
    afterEach(() => {
      delete process.env['RESOLVE_TOKEN'];
    });

    it('loads and resolves env vars in one call', async () => {
      process.env['RESOLVE_TOKEN'] = 'secret';
      const map = makeValidMap({
        auth: { type: 'custom', headers: { 'X-Auth': '${RESOLVE_TOKEN}' } },
      });
      mockReadFile.mockResolvedValueOnce(JSON.stringify(map));

      const result = await loadAndResolveWorkspaceMap('/workspace');
      expect(result.auth).toEqual({
        type: 'custom',
        headers: { 'X-Auth': 'secret' },
      });
    });
  });

  describe('resolveMapEnvVars() — endpoint headers', () => {
    afterEach(() => {
      delete process.env['EP_HEADER_VAR'];
    });

    it('resolves env vars in endpoint-level headers', () => {
      process.env['EP_HEADER_VAR'] = 'resolved';
      const map = makeValidMap({
        endpoints: [
          {
            id: 'ep1',
            name: 'EP1',
            method: 'GET',
            path: '/ep1',
            parameters: [],
            headers: { 'X-Trace': '${EP_HEADER_VAR}' },
            tags: [],
          },
        ],
      });
      const resolved = resolveMapEnvVars(map);
      expect(resolved.endpoints[0]!.headers['X-Trace']).toBe('resolved');
    });

    it('does not mutate the original map', () => {
      process.env['EP_HEADER_VAR'] = 'new-value';
      const map = makeValidMap({
        headers: { 'X-Global': '${EP_HEADER_VAR}' },
      });
      const original = JSON.parse(JSON.stringify(map)) as WorkspaceMap;
      resolveMapEnvVars(map);
      expect(map.headers['X-Global']).toBe(original.headers['X-Global']);
    });
  });

  describe('resolveEnvVars() — edge cases', () => {
    afterEach(() => {
      delete process.env['EMPTY_VAR'];
    });

    it('handles env var with empty string value', () => {
      process.env['EMPTY_VAR'] = '';
      expect(resolveEnvVars('prefix-${EMPTY_VAR}-suffix')).toBe('prefix--suffix');
    });

    it('handles string with no env var references', () => {
      expect(resolveEnvVars('static-value-123')).toBe('static-value-123');
    });

    it('handles empty string', () => {
      expect(resolveEnvVars('')).toBe('');
    });
  });

  describe('resolveMapEnvVars() — api-key auth', () => {
    it('preserves api-key auth fields (envVar is not resolved at map level)', () => {
      const map = makeValidMap({
        auth: { type: 'api-key', header: 'X-Key', envVar: 'MY_API_KEY' },
      });
      const resolved = resolveMapEnvVars(map);
      if (resolved.auth.type === 'api-key') {
        expect(resolved.auth.envVar).toBe('MY_API_KEY');
        expect(resolved.auth.header).toBe('X-Key');
      }
    });
  });
});
