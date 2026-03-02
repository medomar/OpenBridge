import { describe, it, expect } from 'vitest';
import {
  parseSpawnMarkers,
  hasSpawnMarkers,
  extractTaskSummaries,
} from '../../src/master/spawn-parser.js';
import type { ParsedSpawnMarker } from '../../src/master/spawn-parser.js';

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

    it('should parse tool field when present', () => {
      const output = `[SPAWN:code-edit]{"prompt":"Refactor auth","tool":"codex","model":"fast"}[/SPAWN]`;

      const result = parseSpawnMarkers(output);

      expect(result.markers).toHaveLength(1);
      expect(result.markers[0]!.body.tool).toBe('codex');
      expect(result.markers[0]!.body.model).toBe('fast');
    });

    it('should have undefined tool when not specified (backward compat)', () => {
      const output = `[SPAWN:read-only]{"prompt":"List files","model":"haiku"}[/SPAWN]`;

      const result = parseSpawnMarkers(output);

      expect(result.markers).toHaveLength(1);
      expect(result.markers[0]!.body.tool).toBeUndefined();
    });

    it('should parse tool + model + all fields together', () => {
      const output = `[SPAWN:full-access]{"prompt":"Deploy","tool":"aider","model":"balanced","maxTurns":20,"retries":1}[/SPAWN]`;

      const result = parseSpawnMarkers(output);

      expect(result.markers).toHaveLength(1);
      const body = result.markers[0]!.body;
      expect(body.tool).toBe('aider');
      expect(body.model).toBe('balanced');
      expect(body.maxTurns).toBe(20);
      expect(body.retries).toBe(1);
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

  describe('extractTaskSummaries', () => {
    /** Helper to build a minimal ParsedSpawnMarker for testing */
    function makeMarker(profile: string, prompt: string): ParsedSpawnMarker {
      return {
        profile,
        body: { prompt },
        rawMatch: `[SPAWN:${profile}]{"prompt":"${prompt}"}[/SPAWN]`,
      };
    }

    it('returns correct one-line summaries from SPAWN markers', () => {
      const markers: ParsedSpawnMarker[] = [
        makeMarker('read-only', 'List all TypeScript files in src/'),
        makeMarker('code-edit', 'Add validation to the API endpoint'),
      ];

      const summaries = extractTaskSummaries(markers);

      expect(summaries).toHaveLength(2);
      expect(summaries[0]).toBe('List all TypeScript files in src/');
      expect(summaries[1]).toBe('Add validation to the API endpoint');
    });

    it('uses only the first non-empty line of multi-line prompts', () => {
      const marker = makeMarker(
        'code-edit',
        'Step 1: Read the file\nStep 2: Modify the function\nStep 3: Save',
      );

      const summaries = extractTaskSummaries([marker]);

      expect(summaries).toHaveLength(1);
      expect(summaries[0]).toBe('Step 1: Read the file');
    });

    it('produces a sensible fallback summary when prompt is empty', () => {
      const marker: ParsedSpawnMarker = {
        profile: 'read-only',
        body: { prompt: '   ' }, // whitespace only — treated as empty
        rawMatch: '[SPAWN:read-only]{"prompt":"   "}[/SPAWN]',
      };

      const summaries = extractTaskSummaries([marker]);

      expect(summaries).toHaveLength(1);
      expect(summaries[0]).toBe('Task via read-only profile');
    });

    it('truncates long summaries to 120 characters with ellipsis', () => {
      const longPrompt = 'A'.repeat(150);
      const marker = makeMarker('full-access', longPrompt);

      const summaries = extractTaskSummaries([marker]);

      expect(summaries).toHaveLength(1);
      expect(summaries[0]).toHaveLength(120);
      expect(summaries[0]!.slice(-3)).toBe('...');
      expect(summaries[0]).toBe('A'.repeat(117) + '...');
    });

    it('does not truncate summaries that are exactly 120 characters', () => {
      const exactPrompt = 'B'.repeat(120);
      const marker = makeMarker('read-only', exactPrompt);

      const summaries = extractTaskSummaries([marker]);

      expect(summaries[0]).toHaveLength(120);
      expect(summaries[0]!.slice(-3)).not.toBe('...');
    });

    it('returns an empty array for an empty marker list', () => {
      expect(extractTaskSummaries([])).toEqual([]);
    });

    it('handles multiple markers with mixed prompt lengths', () => {
      const markers: ParsedSpawnMarker[] = [
        makeMarker('read-only', 'Short task'),
        makeMarker('code-edit', 'C'.repeat(200)),
        makeMarker('full-access', '   \n  \n  '), // all whitespace lines
      ];

      const summaries = extractTaskSummaries(markers);

      expect(summaries).toHaveLength(3);
      expect(summaries[0]).toBe('Short task');
      expect(summaries[1]).toHaveLength(120);
      expect(summaries[1]!.slice(-3)).toBe('...');
      expect(summaries[2]).toBe('Task via full-access profile');
    });
  });

  describe('code-audit profile', () => {
    it('correctly parses a SPAWN marker with profile code-audit and preserves the profile name', () => {
      const output = `[SPAWN:code-audit]{"prompt":"Run the test suite and report failures","model":"sonnet","maxTurns":15}[/SPAWN]`;

      const result = parseSpawnMarkers(output);

      expect(result.markers).toHaveLength(1);
      expect(result.markers[0]!.profile).toBe('code-audit');
      expect(result.markers[0]!.body.prompt).toBe('Run the test suite and report failures');
      expect(result.markers[0]!.body.model).toBe('sonnet');
      expect(result.markers[0]!.body.maxTurns).toBe(15);
    });

    it('strips a code-audit SPAWN marker from cleanedOutput', () => {
      const output = `Analyzing your project.\n\n[SPAWN:code-audit]{"prompt":"Run npm test and report failures"}[/SPAWN]\n\nResults incoming.`;

      const result = parseSpawnMarkers(output);

      expect(result.cleanedOutput).not.toContain('[SPAWN:code-audit]');
      expect(result.cleanedOutput).not.toContain('[/SPAWN]');
      expect(result.cleanedOutput).toContain('Analyzing your project.');
    });

    it('parses an unknown profile without crashing — parser accepts any valid profile name', () => {
      const output = `[SPAWN:totally-custom-profile-xyz]{"prompt":"Do custom work"}[/SPAWN]`;

      const result = parseSpawnMarkers(output);

      // The parser is profile-agnostic: unknown profiles are parsed successfully.
      // Profile validation (and warnings for unresolved profiles) happen downstream
      // in resolveTools(), not in the spawn parser itself.
      expect(result.markers).toHaveLength(1);
      expect(result.markers[0]!.profile).toBe('totally-custom-profile-xyz');
      expect(result.markers[0]!.body.prompt).toBe('Do custom work');
    });

    it('extractTaskSummaries produces correct fallback for code-audit profile with empty prompt', () => {
      const marker: ParsedSpawnMarker = {
        profile: 'code-audit',
        body: { prompt: '   ' },
        rawMatch: '[SPAWN:code-audit]{"prompt":"   "}[/SPAWN]',
      };

      const summaries = extractTaskSummaries([marker]);

      expect(summaries).toHaveLength(1);
      expect(summaries[0]).toBe('Task via code-audit profile');
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
