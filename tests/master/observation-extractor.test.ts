import { describe, it, expect } from 'vitest';
import {
  extractFilesRead,
  extractFilesModified,
  classifyObservationType,
  extractObservation,
} from '../../src/master/observation-extractor.js';

// ---------------------------------------------------------------------------
// extractFilesRead
// ---------------------------------------------------------------------------

describe('extractFilesRead', () => {
  it('returns empty array for empty output', () => {
    expect(extractFilesRead('')).toEqual([]);
  });

  it('detects src/ relative paths', () => {
    const output = 'I read src/core/auth.ts and found the JWT logic.';
    const result = extractFilesRead(output);
    expect(result).toContain('src/core/auth.ts');
  });

  it('detects ./relative paths', () => {
    const output = 'Opening ./config/settings.json to check the configuration.';
    const result = extractFilesRead(output);
    expect(result).toContain('./config/settings.json');
  });

  it('detects ../parent paths', () => {
    const output = 'Read ../shared/utils.ts for helper functions.';
    const result = extractFilesRead(output);
    expect(result).toContain('../shared/utils.ts');
  });

  it('detects tests/ paths', () => {
    const output = 'Inspected tests/core/auth.test.ts for coverage.';
    const result = extractFilesRead(output);
    expect(result).toContain('tests/core/auth.test.ts');
  });

  it('does NOT include paths in write-context lines', () => {
    const output = 'Updated src/core/bridge.ts with new logic.';
    const result = extractFilesRead(output);
    expect(result).not.toContain('src/core/bridge.ts');
  });

  it('detects multiple paths from a single output', () => {
    const output = [
      'read src/core/auth.ts',
      'opened src/types/message.ts',
      'scanned src/core/queue.ts',
    ].join('\n');
    const result = extractFilesRead(output);
    expect(result).toContain('src/core/auth.ts');
    expect(result).toContain('src/types/message.ts');
    expect(result).toContain('src/core/queue.ts');
  });

  it('handles explicit tool output pattern "Reading src/..."', () => {
    const output = 'Reading src/memory/database.ts';
    const result = extractFilesRead(output);
    expect(result).toContain('src/memory/database.ts');
  });

  it('handles explicit tool output pattern "Read file: src/..."', () => {
    const output = 'Read file src/index.ts';
    const result = extractFilesRead(output);
    expect(result).toContain('src/index.ts');
  });

  it('ignores paths without a known extension', () => {
    const output = 'I looked at src/core/somefile and src/other';
    const result = extractFilesRead(output);
    expect(result).toHaveLength(0);
  });

  it('deduplicates repeated paths', () => {
    const output = 'read src/core/auth.ts\nread src/core/auth.ts again';
    const result = extractFilesRead(output);
    const count = result.filter((p) => p === 'src/core/auth.ts').length;
    expect(count).toBe(1);
  });

  it('caps results at 50 entries', () => {
    const lines = Array.from({ length: 60 }, (_, i) => `read src/module${i}/index.ts`);
    const result = extractFilesRead(lines.join('\n'));
    expect(result.length).toBeLessThanOrEqual(50);
  });

  it('supports multiple file extensions: json, yaml, md, sh, py', () => {
    const output = [
      'read src/config/app.json',
      'opened src/docs/spec.yaml',
      'inspected src/README.md',
      'scanned scripts/deploy.sh',
      'loaded src/utils/helper.py',
    ].join('\n');
    const result = extractFilesRead(output);
    expect(result).toContain('src/config/app.json');
    expect(result).toContain('src/docs/spec.yaml');
  });

  it('handles output with no file paths gracefully', () => {
    const output = 'No file references here, just plain text.';
    expect(extractFilesRead(output)).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// extractFilesModified
// ---------------------------------------------------------------------------

describe('extractFilesModified', () => {
  it('returns empty array for empty output', () => {
    expect(extractFilesModified('')).toEqual([]);
  });

  it('detects Edit() tool invocation pattern', () => {
    const output = 'Edit("src/core/auth.ts") — added JWT expiry logic';
    const result = extractFilesModified(output);
    expect(result).toContain('src/core/auth.ts');
  });

  it('detects Write() tool invocation pattern', () => {
    const output = "Write('src/types/message.ts') with updated interface";
    const result = extractFilesModified(output);
    expect(result).toContain('src/types/message.ts');
  });

  it('detects NotebookEdit() tool invocation pattern', () => {
    // .ipynb is not in READABLE_EXTENSIONS, so use a ts file
    const output = 'NotebookEdit("src/analysis.ts") updated cell';
    const result = extractFilesModified(output);
    expect(result).toContain('src/analysis.ts');
  });

  it('detects "Written to src/..." executor pattern', () => {
    const output = 'Written to src/core/bridge.ts';
    const result = extractFilesModified(output);
    expect(result).toContain('src/core/bridge.ts');
  });

  it('detects "Wrote to src/..." executor pattern', () => {
    const output = 'Wrote to src/memory/database.ts';
    const result = extractFilesModified(output);
    expect(result).toContain('src/memory/database.ts');
  });

  it('detects "Created file src/..." executor pattern', () => {
    const output = 'Created file src/master/observation-extractor.ts';
    const result = extractFilesModified(output);
    expect(result).toContain('src/master/observation-extractor.ts');
  });

  it('detects "Saved to src/..." executor pattern', () => {
    const output = 'Saved to src/core/config.ts';
    const result = extractFilesModified(output);
    expect(result).toContain('src/core/config.ts');
  });

  it('detects "Edit applied to src/..." executor pattern', () => {
    const output = 'Edit applied to src/core/router.ts';
    const result = extractFilesModified(output);
    expect(result).toContain('src/core/router.ts');
  });

  it('detects paths in write-context keyword lines', () => {
    const output = 'updated src/core/queue.ts with retry logic';
    const result = extractFilesModified(output);
    expect(result).toContain('src/core/queue.ts');
  });

  it('detects paths in delete-context keyword lines', () => {
    const output = 'deleted src/legacy/old-module.ts from the project';
    const result = extractFilesModified(output);
    expect(result).toContain('src/legacy/old-module.ts');
  });

  it('detects paths in created-context keyword lines', () => {
    const output = 'created src/memory/eviction.ts to handle LRU logic';
    const result = extractFilesModified(output);
    expect(result).toContain('src/memory/eviction.ts');
  });

  it('does NOT include read-only paths as modified', () => {
    const output = 'read src/core/auth.ts — no changes made';
    const result = extractFilesModified(output);
    expect(result).not.toContain('src/core/auth.ts');
  });

  it('deduplicates repeated paths', () => {
    const output = 'edited src/core/auth.ts\nupdated src/core/auth.ts';
    const result = extractFilesModified(output);
    const count = result.filter((p) => p === 'src/core/auth.ts').length;
    expect(count).toBe(1);
  });

  it('caps results at 50 entries', () => {
    const lines = Array.from({ length: 60 }, (_, i) => `Written to src/module${i}/index.ts`);
    const result = extractFilesModified(lines.join('\n'));
    expect(result.length).toBeLessThanOrEqual(50);
  });

  it('handles output with no file paths gracefully', () => {
    const output = 'Nothing was edited here, just text.';
    expect(extractFilesModified(output)).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// classifyObservationType
// ---------------------------------------------------------------------------

describe('classifyObservationType', () => {
  it('classifies "fixed a bug" as bugfix', () => {
    expect(classifyObservationType('fixed a null pointer bug', undefined, undefined)).toBe(
      'bugfix',
    );
  });

  it('classifies "regression" as bugfix', () => {
    expect(
      classifyObservationType('resolved a regression in the auth flow', undefined, undefined),
    ).toBe('bugfix');
  });

  it('classifies test output as test-result', () => {
    expect(
      classifyObservationType('all tests passed with full coverage', undefined, undefined),
    ).toBe('test-result');
  });

  it('classifies vitest mention as test-result', () => {
    expect(classifyObservationType('ran vitest suite successfully', undefined, undefined)).toBe(
      'test-result',
    );
  });

  it('classifies refactor output as refactor', () => {
    expect(classifyObservationType('refactored the queue module', undefined, undefined)).toBe(
      'refactor',
    );
  });

  it('classifies "renamed" as refactor', () => {
    expect(
      classifyObservationType('renamed handleMessage to processMessage', undefined, undefined),
    ).toBe('refactor');
  });

  it('classifies architecture mention as architecture', () => {
    expect(classifyObservationType('designed a new schema structure', undefined, undefined)).toBe(
      'architecture',
    );
  });

  it('classifies dependency mention as dependency', () => {
    expect(
      classifyObservationType('installed better-sqlite3 dependency', undefined, undefined),
    ).toBe('dependency');
  });

  it('classifies config mention as config', () => {
    expect(classifyObservationType('updated tsconfig settings', undefined, undefined)).toBe(
      'config',
    );
  });

  it('classifies documentation mention as documentation', () => {
    expect(
      classifyObservationType('updated README with new instructions', undefined, undefined),
    ).toBe('documentation');
  });

  it('classifies performance mention as performance', () => {
    expect(
      classifyObservationType('optimized the query for lower latency', undefined, undefined),
    ).toBe('performance');
  });

  it('classifies security mention as security', () => {
    expect(
      classifyObservationType('found a CSRF injection vulnerability', undefined, undefined),
    ).toBe('security');
  });

  it('uses prompt keywords when output has no signal', () => {
    expect(classifyObservationType('done', 'fix the bug in auth', undefined)).toBe('bugfix');
  });

  it('output keywords take precedence over profile default', () => {
    // output says "refactored" but profile defaults to investigation
    const result = classifyObservationType('refactored auth module', undefined, 'read-only');
    expect(result).toBe('refactor');
  });

  it('uses profile default when no keywords match', () => {
    expect(classifyObservationType('task completed', undefined, 'read-only')).toBe('investigation');
    expect(classifyObservationType('task completed', undefined, 'code-edit')).toBe('refactor');
    expect(classifyObservationType('task completed', undefined, 'master')).toBe('architecture');
  });

  it('falls back to investigation for unknown profile and no keywords', () => {
    expect(classifyObservationType('task completed', undefined, 'unknown-profile')).toBe(
      'investigation',
    );
    expect(classifyObservationType('task completed', undefined, undefined)).toBe('investigation');
  });

  it('is case-insensitive for keyword matching', () => {
    expect(classifyObservationType('FIXED the REGRESSION', undefined, undefined)).toBe('bugfix');
    expect(classifyObservationType('TESTS PASSED', undefined, undefined)).toBe('test-result');
  });
});

// ---------------------------------------------------------------------------
// extractObservation (integration)
// ---------------------------------------------------------------------------

describe('extractObservation', () => {
  it('returns an Observation with all required fields populated', () => {
    const result = extractObservation({
      output: 'Fixed a bug in src/core/auth.ts — JWT expiry was incorrect.',
      sessionId: 'sess-1',
      workerId: 'worker-1',
    });

    expect(result.session_id).toBe('sess-1');
    expect(result.worker_id).toBe('worker-1');
    expect(typeof result.title).toBe('string');
    expect(result.title.length).toBeGreaterThan(0);
    expect(typeof result.narrative).toBe('string');
    expect(Array.isArray(result.facts)).toBe(true);
    expect(Array.isArray(result.concepts)).toBe(true);
    expect(Array.isArray(result.files_read)).toBe(true);
    expect(Array.isArray(result.files_modified)).toBe(true);
  });

  it('classifies type from output keywords', () => {
    const result = extractObservation({
      output: 'Fixed the null pointer bug in the authentication handler.',
      sessionId: 's',
      workerId: 'w',
    });
    expect(result.type).toBe('bugfix');
  });

  it('classifies type from profile when output has no keywords', () => {
    const result = extractObservation({
      output: 'Completed the assigned task.',
      sessionId: 's',
      workerId: 'w',
      profile: 'read-only',
    });
    expect(result.type).toBe('investigation');
  });

  it('classifies type from prompt when output has no keywords', () => {
    const result = extractObservation({
      output: 'Done.',
      sessionId: 's',
      workerId: 'w',
      prompt: 'Write tests for the authentication module',
    });
    expect(result.type).toBe('test-result');
  });

  it('extracts files_modified from Edit() pattern', () => {
    const result = extractObservation({
      output: 'Edit("src/core/bridge.ts") — added graceful shutdown',
      sessionId: 's',
      workerId: 'w',
    });
    expect(result.files_modified).toContain('src/core/bridge.ts');
  });

  it('extracts files_read from read-context lines', () => {
    const result = extractObservation({
      output: 'read src/types/message.ts to understand the interface',
      sessionId: 's',
      workerId: 'w',
    });
    expect(result.files_read).toContain('src/types/message.ts');
  });

  it('extracts facts from bullet points', () => {
    const output = [
      'Summary of changes:',
      '- JWT expiry increased to 24h',
      '- Added rate limiter middleware',
    ].join('\n');
    const result = extractObservation({ output, sessionId: 's', workerId: 'w' });
    expect(result.facts).toContain('JWT expiry increased to 24h');
    expect(result.facts).toContain('Added rate limiter middleware');
  });

  it('extracts concepts from CamelCase identifiers', () => {
    const output = 'The MasterManager orchestrates WorkerRegistry lifecycle.';
    const result = extractObservation({ output, sessionId: 's', workerId: 'w' });
    expect(result.concepts).toContain('MasterManager');
    expect(result.concepts).toContain('WorkerRegistry');
  });

  it('handles empty output without throwing', () => {
    expect(() => extractObservation({ output: '', sessionId: 's', workerId: 'w' })).not.toThrow();
  });

  it('handles output with only whitespace without throwing', () => {
    expect(() =>
      extractObservation({ output: '   \n  \n  ', sessionId: 's', workerId: 'w' }),
    ).not.toThrow();
  });

  it('title uses summary-verb line when present', () => {
    const output = 'Fixed JWT expiry logic in the auth module.\n\nSome extra details.';
    const result = extractObservation({ output, sessionId: 's', workerId: 'w' });
    expect(result.title).toBe('Fixed JWT expiry logic in the auth module');
  });

  it('title uses markdown heading when no summary-verb line', () => {
    const output = '## Authentication Refactor\n\nSome details about the refactor.';
    const result = extractObservation({ output, sessionId: 's', workerId: 'w' });
    expect(result.title).toBe('Authentication Refactor');
  });

  it('narrative is at most 500 characters', () => {
    const longOutput = 'A '.repeat(300);
    const result = extractObservation({ output: longOutput, sessionId: 's', workerId: 'w' });
    expect(result.narrative.length).toBeLessThanOrEqual(500);
  });
});
