import { describe, it, expect } from 'vitest';
import { parseSpawnMarkers, hasSpawnMarkers } from '../../src/master/spawn-parser.js';

describe('spawn-parser', () => {
  describe('parseSpawnMarkers', () => {
    it('should parse a single SPAWN marker', () => {
      const output = `I'll analyze the codebase for you.

[SPAWN:read-only]{"prompt":"List all TypeScript files in src/","model":"haiku","maxTurns":10}[/SPAWN]

Let me check that for you.`;

      const result = parseSpawnMarkers(output);

      expect(result.markers).toHaveLength(1);
      expect(result.markers[0]!.profile).toBe('read-only');
      expect(result.markers[0]!.body.prompt).toBe('List all TypeScript files in src/');
      expect(result.markers[0]!.body.model).toBe('haiku');
      expect(result.markers[0]!.body.maxTurns).toBe(10);
    });

    it('should parse multiple SPAWN markers', () => {
      const output = `I'll break this into subtasks.

[SPAWN:read-only]{"prompt":"Analyze the database schema","model":"haiku","maxTurns":10}[/SPAWN]

[SPAWN:code-edit]{"prompt":"Add validation to the API endpoint","model":"sonnet","maxTurns":15}[/SPAWN]

Working on it.`;

      const result = parseSpawnMarkers(output);

      expect(result.markers).toHaveLength(2);
      expect(result.markers[0]!.profile).toBe('read-only');
      expect(result.markers[0]!.body.prompt).toBe('Analyze the database schema');
      expect(result.markers[1]!.profile).toBe('code-edit');
      expect(result.markers[1]!.body.prompt).toBe('Add validation to the API endpoint');
    });

    it('should strip SPAWN markers from cleaned output', () => {
      const output = `Before marker.

[SPAWN:read-only]{"prompt":"Do something","model":"haiku"}[/SPAWN]

After marker.`;

      const result = parseSpawnMarkers(output);

      expect(result.cleanedOutput).toBe('Before marker.\n\nAfter marker.');
      expect(result.cleanedOutput).not.toContain('[SPAWN');
      expect(result.cleanedOutput).not.toContain('[/SPAWN]');
    });

    it('should handle prompt-only body (minimal manifest)', () => {
      const output = `[SPAWN:full-access]{"prompt":"Run the test suite"}[/SPAWN]`;

      const result = parseSpawnMarkers(output);

      expect(result.markers).toHaveLength(1);
      expect(result.markers[0]!.body.prompt).toBe('Run the test suite');
      expect(result.markers[0]!.body.model).toBeUndefined();
      expect(result.markers[0]!.body.maxTurns).toBeUndefined();
    });

    it('should handle all optional fields', () => {
      const output = `[SPAWN:code-edit]{"prompt":"Fix the bug","model":"opus","maxTurns":20,"timeout":120000,"retries":2}[/SPAWN]`;

      const result = parseSpawnMarkers(output);

      expect(result.markers).toHaveLength(1);
      const body = result.markers[0]!.body;
      expect(body.prompt).toBe('Fix the bug');
      expect(body.model).toBe('opus');
      expect(body.maxTurns).toBe(20);
      expect(body.timeout).toBe(120000);
      expect(body.retries).toBe(2);
    });

    it('should skip markers with invalid JSON', () => {
      const output = `[SPAWN:read-only]{not valid json}[/SPAWN]

[SPAWN:code-edit]{"prompt":"Valid marker"}[/SPAWN]`;

      const result = parseSpawnMarkers(output);

      expect(result.markers).toHaveLength(1);
      expect(result.markers[0]!.profile).toBe('code-edit');
    });

    it('should skip markers with missing prompt', () => {
      const output = `[SPAWN:read-only]{"model":"haiku"}[/SPAWN]

[SPAWN:code-edit]{"prompt":"Valid marker"}[/SPAWN]`;

      const result = parseSpawnMarkers(output);

      expect(result.markers).toHaveLength(1);
      expect(result.markers[0]!.profile).toBe('code-edit');
    });

    it('should skip markers with empty prompt', () => {
      const output = `[SPAWN:read-only]{"prompt":""}[/SPAWN]

[SPAWN:code-edit]{"prompt":"Valid marker"}[/SPAWN]`;

      const result = parseSpawnMarkers(output);

      expect(result.markers).toHaveLength(1);
      expect(result.markers[0]!.profile).toBe('code-edit');
    });

    it('should return empty markers for output without SPAWN markers', () => {
      const output = 'Just a regular response with no markers.';

      const result = parseSpawnMarkers(output);

      expect(result.markers).toHaveLength(0);
      expect(result.cleanedOutput).toBe(output);
    });

    it('should handle profiles with hyphens and underscores', () => {
      const output = `[SPAWN:test-runner]{"prompt":"Run unit tests"}[/SPAWN]

[SPAWN:my_custom_profile]{"prompt":"Do custom work"}[/SPAWN]`;

      const result = parseSpawnMarkers(output);

      expect(result.markers).toHaveLength(2);
      expect(result.markers[0]!.profile).toBe('test-runner');
      expect(result.markers[1]!.profile).toBe('my_custom_profile');
    });

    it('should handle multiline prompts in JSON', () => {
      const output = `[SPAWN:code-edit]{"prompt":"Step 1: Read the file\\nStep 2: Modify the function\\nStep 3: Save","model":"sonnet"}[/SPAWN]`;

      const result = parseSpawnMarkers(output);

      expect(result.markers).toHaveLength(1);
      expect(result.markers[0]!.body.prompt).toContain('Step 1');
      expect(result.markers[0]!.body.prompt).toContain('Step 2');
    });

    it('should preserve rawMatch for each marker', () => {
      const output = `[SPAWN:read-only]{"prompt":"Do something"}[/SPAWN]`;

      const result = parseSpawnMarkers(output);

      expect(result.markers[0]!.rawMatch).toBe(
        '[SPAWN:read-only]{"prompt":"Do something"}[/SPAWN]',
      );
    });
  });

  describe('hasSpawnMarkers', () => {
    it('should return true when SPAWN markers are present', () => {
      const output = `Some text [SPAWN:read-only]{"prompt":"test"}[/SPAWN] more text`;
      expect(hasSpawnMarkers(output)).toBe(true);
    });

    it('should return false when no SPAWN markers are present', () => {
      expect(hasSpawnMarkers('Just regular text')).toBe(false);
    });

    it('should return false for malformed markers', () => {
      expect(hasSpawnMarkers('[SPAWN:]no profile[/SPAWN]')).toBe(false);
    });

    it('should return true for multiple markers', () => {
      const output = `[SPAWN:a]{"prompt":"x"}[/SPAWN] [SPAWN:b]{"prompt":"y"}[/SPAWN]`;
      expect(hasSpawnMarkers(output)).toBe(true);
    });
  });
});
