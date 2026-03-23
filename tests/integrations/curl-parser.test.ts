import { describe, it, expect } from 'vitest';
import { curlsToOpenAPI, splitCurlCommands } from '../../src/integrations/parsers/curl-parser.js';

describe('curl-parser', () => {
  // ── splitCurlCommands ──────────────────────────────────────────────────────

  describe('splitCurlCommands', () => {
    it('splits multiple curl commands separated by newlines', () => {
      const input = `curl https://api.example.com/users
curl https://api.example.com/posts`;
      const commands = splitCurlCommands(input);
      expect(commands).toHaveLength(2);
      expect(commands[0]).toContain('/users');
      expect(commands[1]).toContain('/posts');
    });

    it('joins backslash-continued lines into a single command', () => {
      const input = `curl -X POST https://api.example.com/users \\
  -H "Content-Type: application/json" \\
  -d '{"name":"Alice"}'`;
      const commands = splitCurlCommands(input);
      expect(commands).toHaveLength(1);
      expect(commands[0]).toContain('-H');
      expect(commands[0]).toContain('-d');
    });

    it('returns empty array for empty input', () => {
      expect(splitCurlCommands('')).toEqual([]);
    });
  });

  // ── curlsToOpenAPI — basic cases ───────────────────────────────────────────

  describe('curlsToOpenAPI', () => {
    it('(1) parses a simple GET cURL into a valid OpenAPI 3.0 spec', () => {
      const spec = curlsToOpenAPI(['curl https://api.example.com/users']);

      expect(spec.openapi).toBe('3.0.3');
      expect(spec.info).toBeDefined();
      expect(spec.info.version).toBe('1.0.0');
      expect(spec.paths).toBeDefined();
      expect(spec.paths['/users']).toBeDefined();

      const getOp = (spec.paths['/users'] as Record<string, unknown>)['get'];
      expect(getOp).toBeDefined();
    });

    it('(1) infers GET method when no -X flag is provided', () => {
      const spec = curlsToOpenAPI(['curl https://api.example.com/health']);

      const getOp = (spec.paths['/health'] as Record<string, unknown>)['get'];
      expect(getOp).toBeDefined();
    });

    it('(1) sets the server base URL from the cURL URL', () => {
      const spec = curlsToOpenAPI(['curl https://api.example.com/users']);

      expect(spec.servers).toBeDefined();
      expect(spec.servers![0]!.url).toBe('https://api.example.com');
    });

    // ── (2) POST with JSON body ──────────────────────────────────────────────

    it('(2) parses a POST cURL with a JSON body', () => {
      const spec = curlsToOpenAPI([
        `curl -X POST https://api.example.com/users -H "Content-Type: application/json" -d '{"name":"Alice","age":30}'`,
      ]);

      const postOp = (spec.paths['/users'] as Record<string, unknown>)['post'] as Record<
        string,
        unknown
      >;
      expect(postOp).toBeDefined();

      const reqBody = postOp['requestBody'] as Record<string, unknown>;
      expect(reqBody).toBeDefined();

      const content = reqBody['content'] as Record<string, unknown>;
      expect(content['application/json']).toBeDefined();
    });

    it('(2) infers POST method when body is provided without -X flag', () => {
      const spec = curlsToOpenAPI([`curl https://api.example.com/messages -d '{"text":"hello"}'`]);

      const postOp = (spec.paths['/messages'] as Record<string, unknown>)['post'];
      expect(postOp).toBeDefined();
    });

    it('(2) infers JSON schema from body example', () => {
      const spec = curlsToOpenAPI([
        `curl -X POST https://api.example.com/orders -H "Content-Type: application/json" -d '{"item":"book","qty":2,"price":9.99}'`,
      ]);

      const postOp = (spec.paths['/orders'] as Record<string, unknown>)['post'] as Record<
        string,
        unknown
      >;
      const reqBody = postOp['requestBody'] as Record<string, unknown>;
      const content = reqBody['content'] as Record<
        string,
        Record<string, Record<string, Record<string, unknown>>>
      >;
      const schema = content['application/json']!['schema']!;

      expect(schema['type']).toBe('object');
      const props = schema['properties'] as Record<string, Record<string, string>>;
      expect(props['item']!['type']).toBe('string');
      expect(props['qty']!['type']).toBe('integer');
      expect(props['price']!['type']).toBe('number');
    });

    // ── (3) Auth headers extracted ───────────────────────────────────────────

    it('(3) extracts Bearer auth header and creates a security scheme', () => {
      const spec = curlsToOpenAPI([
        `curl https://api.example.com/me -H "Authorization: Bearer my-token"`,
      ]);

      expect(spec.components?.securitySchemes?.['bearerAuth']).toEqual({
        type: 'http',
        scheme: 'bearer',
      });

      const getOp = (spec.paths['/me'] as Record<string, unknown>)['get'] as Record<
        string,
        unknown
      >;
      expect(getOp['security']).toEqual([{ bearerAuth: [] }]);
    });

    it('(3) extracts Basic auth from Authorization header', () => {
      const spec = curlsToOpenAPI([
        `curl https://api.example.com/admin -H "Authorization: Basic dXNlcjpwYXNz"`,
      ]);

      expect(spec.components?.securitySchemes?.['basicAuth']).toEqual({
        type: 'http',
        scheme: 'basic',
      });
    });

    it('(3) extracts Basic auth from -u flag', () => {
      const spec = curlsToOpenAPI([`curl -u admin:secret https://api.example.com/protected`]);

      expect(spec.components?.securitySchemes?.['basicAuth']).toEqual({
        type: 'http',
        scheme: 'basic',
      });
    });

    it('(3) detects X-API-Key header as apiKey security scheme', () => {
      const spec = curlsToOpenAPI([`curl https://api.example.com/data -H "X-API-Key: abc123"`]);

      const scheme = spec.components?.securitySchemes?.['apiKeyAuth'];
      expect(scheme).toBeDefined();
      expect((scheme as Record<string, unknown>)['type']).toBe('apiKey');
      expect((scheme as Record<string, unknown>)['name']).toBe('X-API-Key');
    });

    // ── (4) Multi-line cURL with backslash ───────────────────────────────────

    it('(4) parses multi-line cURL command with backslash continuation', () => {
      const multiLine = `curl -X POST https://api.example.com/users \\
  -H "Authorization: Bearer token123" \\
  -H "Content-Type: application/json" \\
  -d '{"name":"Bob","email":"bob@example.com"}'`;

      const spec = curlsToOpenAPI([multiLine]);

      expect(spec.paths['/users']).toBeDefined();
      const postOp = (spec.paths['/users'] as Record<string, unknown>)['post'] as Record<
        string,
        unknown
      >;
      expect(postOp).toBeDefined();
      expect(postOp['requestBody']).toBeDefined();
      expect(spec.components?.securitySchemes?.['bearerAuth']).toBeDefined();
    });

    it('(4) handles --data-raw flag in multi-line cURL', () => {
      const multiLine = `curl -X PUT https://api.example.com/items/1 \\
  -H "Content-Type: application/json" \\
  --data-raw '{"status":"active"}'`;

      const spec = curlsToOpenAPI([multiLine]);

      // Path may be /items/1 or /items/{1} — either way, the path should exist
      const pathKeys = Object.keys(spec.paths);
      expect(pathKeys.some((p) => p.includes('items'))).toBe(true);
    });

    // ── (5) Multiple cURLs grouped by base path ──────────────────────────────

    it('(5) groups multiple cURLs sharing the same base into one server entry', () => {
      const spec = curlsToOpenAPI([
        'curl https://api.example.com/users',
        'curl -X POST https://api.example.com/users -d \'{"name":"Alice"}\'',
        'curl https://api.example.com/posts',
      ]);

      // All three paths under same origin → one server
      expect(spec.servers).toHaveLength(1);
      expect(spec.servers![0]!.url).toBe('https://api.example.com');

      // Three distinct operations registered
      expect(spec.paths['/users']).toBeDefined();
      expect(spec.paths['/posts']).toBeDefined();
      expect((spec.paths['/users'] as Record<string, unknown>)['get']).toBeDefined();
      expect((spec.paths['/users'] as Record<string, unknown>)['post']).toBeDefined();
      expect((spec.paths['/posts'] as Record<string, unknown>)['get']).toBeDefined();
    });

    it('(5) does not duplicate same method on same path', () => {
      const spec = curlsToOpenAPI([
        'curl https://api.example.com/users',
        'curl https://api.example.com/users', // duplicate
      ]);

      const pathItem = spec.paths['/users'] as Record<string, unknown>;
      // Only one GET, not two
      expect(pathItem['get']).toBeDefined();
      const pathCount = Object.keys(pathItem).length;
      expect(pathCount).toBe(1);
    });

    // ── (6) Output is valid OpenAPI 3.0 ─────────────────────────────────────

    it('(6) output has required OpenAPI 3.0 top-level fields', () => {
      const spec = curlsToOpenAPI([
        'curl https://api.example.com/users',
        `curl -X POST https://api.example.com/products -H "Content-Type: application/json" -d '{"name":"Widget"}'`,
      ]);

      // Required top-level fields
      expect(spec.openapi).toMatch(/^3\./);
      expect(spec.info).toBeDefined();
      expect(typeof spec.info.title).toBe('string');
      expect(typeof spec.info.version).toBe('string');
      expect(spec.paths).toBeDefined();
      expect(typeof spec.paths).toBe('object');
    });

    it('(6) generates valid operationIds (no special chars)', () => {
      const spec = curlsToOpenAPI([
        'curl https://api.example.com/users',
        'curl https://api.example.com/users/123',
      ]);

      const getUsers = (spec.paths['/users'] as Record<string, unknown>)['get'] as Record<
        string,
        unknown
      >;
      const operationId = getUsers['operationId'] as string;
      expect(operationId).toMatch(/^[a-zA-Z0-9_]+$/);
    });

    it('(6) every path entry has at least one HTTP method', () => {
      const spec = curlsToOpenAPI([
        'curl https://api.example.com/users',
        'curl -X DELETE https://api.example.com/users/42',
      ]);

      const validMethods = ['get', 'post', 'put', 'patch', 'delete', 'head', 'options', 'trace'];

      for (const [, pathItem] of Object.entries(spec.paths)) {
        const methods = Object.keys(pathItem as Record<string, unknown>).filter((k) =>
          validMethods.includes(k),
        );
        expect(methods.length).toBeGreaterThan(0);
      }
    });

    // ── Edge cases ───────────────────────────────────────────────────────────

    it('returns a valid spec for empty input', () => {
      const spec = curlsToOpenAPI([]);

      expect(spec.openapi).toBe('3.0.3');
      expect(spec.paths).toEqual({});
    });

    it('handles query parameters in the URL', () => {
      const spec = curlsToOpenAPI(['curl "https://api.example.com/search?q=hello&limit=10"']);

      expect(spec.paths['/search']).toBeDefined();
      const getOp = (spec.paths['/search'] as Record<string, unknown>)['get'] as Record<
        string,
        unknown
      >;
      const params = getOp['parameters'] as Array<Record<string, unknown>>;
      expect(params.some((p) => p['name'] === 'q')).toBe(true);
      expect(params.some((p) => p['name'] === 'limit')).toBe(true);
    });

    it('skips common headers (Authorization, Content-Type) from parameters list', () => {
      const spec = curlsToOpenAPI([
        `curl https://api.example.com/data -H "Authorization: Bearer tok" -H "X-Custom-Header: foo"`,
      ]);

      const getOp = (spec.paths['/data'] as Record<string, unknown>)['get'] as Record<
        string,
        unknown
      >;
      const params = (getOp['parameters'] as Array<Record<string, unknown>> | undefined) ?? [];
      // Authorization is skipped; custom header appears as a parameter
      expect(params.some((p) => p['name'] === 'Authorization')).toBe(false);
      expect(params.some((p) => p['name'] === 'X-Custom-Header')).toBe(true);
    });
  });
});
