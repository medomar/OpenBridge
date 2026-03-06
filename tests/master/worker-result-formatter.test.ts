import { describe, it, expect } from 'vitest';
import {
  formatWorkerResult,
  formatWorkerError,
  buildWorkerFeedbackPrompt,
  formatWorkerBatch,
  extractWorkerSummary,
} from '../../src/master/worker-result-formatter.js';
import type { WorkerResultMeta } from '../../src/master/worker-result-formatter.js';
import type { AgentResult } from '../../src/core/agent-runner.js';

describe('Worker Result Formatter', () => {
  describe('formatWorkerResult', () => {
    it('should format a successful worker result with all metadata', () => {
      const meta: WorkerResultMeta = {
        workerIndex: 1,
        totalWorkers: 3,
        profile: 'read-only',
        model: 'haiku',
        durationMs: 1200,
        success: true,
        exitCode: 0,
        retryCount: 0,
      };

      const result = formatWorkerResult(meta, 'Found 15 test files');

      expect(result).toContain('[WORKER RESULT');
      expect(result).toContain('haiku');
      expect(result).toContain('read-only');
      expect(result).toContain('worker 1/3');
      expect(result).toContain('1.2s');
      expect(result).toContain('Found 15 test files');
      expect(result).toContain('[/WORKER RESULT]');
    });

    it('should use "default" when model is undefined', () => {
      const meta: WorkerResultMeta = {
        workerIndex: 1,
        totalWorkers: 1,
        profile: 'code-edit',
        durationMs: 500,
        success: true,
        exitCode: 0,
        retryCount: 0,
      };

      const result = formatWorkerResult(meta, 'Done');

      expect(result).toContain('default');
      expect(result).toContain('code-edit');
    });

    it('should format sub-second durations in milliseconds', () => {
      const meta: WorkerResultMeta = {
        workerIndex: 1,
        totalWorkers: 1,
        profile: 'read-only',
        model: 'haiku',
        durationMs: 450,
        success: true,
        exitCode: 0,
        retryCount: 0,
      };

      const result = formatWorkerResult(meta, 'Quick check done');

      expect(result).toContain('450ms');
    });

    it('should trim output whitespace', () => {
      const meta: WorkerResultMeta = {
        workerIndex: 1,
        totalWorkers: 1,
        profile: 'read-only',
        model: 'haiku',
        durationMs: 1000,
        success: true,
        exitCode: 0,
        retryCount: 0,
      };

      const result = formatWorkerResult(meta, '  output with spaces  \n\n');

      expect(result).toContain('output with spaces');
      expect(result).not.toContain('  output');
    });

    it('appends PARTIAL warning when turnsExhausted is true (OB-1676)', () => {
      const meta: WorkerResultMeta = {
        workerIndex: 1,
        totalWorkers: 1,
        profile: 'code-edit',
        model: 'sonnet',
        durationMs: 5000,
        success: true,
        exitCode: 0,
        retryCount: 0,
        turnsExhausted: true,
        maxTurns: 15,
      };

      const result = formatWorkerResult(meta, 'Found the issue but ran out of turns');

      expect(result).toContain('[PARTIAL — worker used all 15 turns, result may be incomplete]');
      expect(result).toContain('Found the issue but ran out of turns');
    });

    it('does not append PARTIAL warning when turnsExhausted is absent', () => {
      const meta: WorkerResultMeta = {
        workerIndex: 1,
        totalWorkers: 1,
        profile: 'code-edit',
        model: 'sonnet',
        durationMs: 5000,
        success: true,
        exitCode: 0,
        retryCount: 0,
      };

      const result = formatWorkerResult(meta, 'All done');

      expect(result).not.toContain('[PARTIAL');
    });

    it('uses "?" for maxTurns in PARTIAL warning when maxTurns is not provided', () => {
      const meta: WorkerResultMeta = {
        workerIndex: 1,
        totalWorkers: 1,
        profile: 'read-only',
        model: 'haiku',
        durationMs: 3000,
        success: true,
        exitCode: 0,
        retryCount: 0,
        turnsExhausted: true,
      };

      const result = formatWorkerResult(meta, 'Partial output');

      expect(result).toContain('[PARTIAL — worker used all ? turns, result may be incomplete]');
    });
  });

  describe('formatWorkerError', () => {
    it('should format a worker error with exit code (no category → generic format)', () => {
      const meta: WorkerResultMeta = {
        workerIndex: 2,
        totalWorkers: 3,
        profile: 'code-edit',
        model: 'sonnet',
        durationMs: 500,
        success: false,
        exitCode: 1,
        retryCount: 0,
      };

      const result = formatWorkerError(meta, 'Test command not found');

      expect(result).toContain('[WORKER ERROR');
      expect(result).toContain('sonnet');
      expect(result).toContain('code-edit');
      expect(result).toContain('worker 2/3');
      expect(result).toContain('500ms');
      expect(result).toContain('exit 1');
      expect(result).toContain('Test command not found');
      expect(result).toContain('[/WORKER ERROR]');
    });

    it('should format a categorised failure with [WORKER FAILED: <category>] format', () => {
      const meta: WorkerResultMeta = {
        workerIndex: 1,
        totalWorkers: 2,
        profile: 'code-edit',
        model: 'sonnet',
        durationMs: 500,
        success: false,
        exitCode: 1,
        retryCount: 2,
        errorCategory: 'rate-limit',
      };

      const result = formatWorkerError(meta, 'Too many requests');

      expect(result).toContain('[WORKER FAILED: rate-limit');
      expect(result).toContain('sonnet');
      expect(result).toContain('code-edit');
      expect(result).toContain('worker 1/2');
      expect(result).toContain('exit 1');
      expect(result).toContain('Too many requests');
      expect(result).toContain('[/WORKER FAILED]');
      expect(result).not.toContain('[WORKER ERROR');
    });

    it('should use [WORKER FAILED: auth] format for auth errors', () => {
      const meta: WorkerResultMeta = {
        workerIndex: 1,
        totalWorkers: 1,
        profile: 'read-only',
        model: 'haiku',
        durationMs: 100,
        success: false,
        exitCode: 1,
        retryCount: 0,
        errorCategory: 'auth',
      };

      const result = formatWorkerError(meta, 'Invalid API key');

      expect(result).toContain('[WORKER FAILED: auth');
      expect(result).toContain('[/WORKER FAILED]');
    });

    it('should use [WORKER FAILED: context-overflow] for context overflow errors', () => {
      const meta: WorkerResultMeta = {
        workerIndex: 1,
        totalWorkers: 1,
        profile: 'full-access',
        model: 'opus',
        durationMs: 300,
        success: false,
        exitCode: 1,
        retryCount: 0,
        errorCategory: 'context-overflow',
      };

      const result = formatWorkerError(meta, 'Context length exceeded');

      expect(result).toContain('[WORKER FAILED: context-overflow');
      expect(result).toContain('[/WORKER FAILED]');
    });

    it('should handle exception errors (exit -1, no category)', () => {
      const meta: WorkerResultMeta = {
        workerIndex: 1,
        totalWorkers: 1,
        profile: 'full-access',
        model: 'opus',
        durationMs: 0,
        success: false,
        exitCode: -1,
        retryCount: 0,
      };

      const result = formatWorkerError(meta, 'Process spawn failed');

      expect(result).toContain('exit -1');
      expect(result).toContain('Process spawn failed');
      expect(result).toContain('[WORKER ERROR');
    });
  });

  describe('buildWorkerFeedbackPrompt', () => {
    it('should build feedback prompt for a single worker', () => {
      const results = [
        '[WORKER RESULT (haiku, read-only, worker 1/1, 1.0s)]\nOutput\n[/WORKER RESULT]',
      ];

      const prompt = buildWorkerFeedbackPrompt(results);

      expect(prompt).toContain('1 worker completed');
      expect(prompt).toContain('Output');
      expect(prompt).toContain('Summarize the worker results');
    });

    it('should build feedback prompt for multiple workers', () => {
      const results = [
        '[WORKER RESULT (haiku, read-only, worker 1/2, 1.0s)]\nResult 1\n[/WORKER RESULT]',
        '[WORKER RESULT (sonnet, code-edit, worker 2/2, 2.0s)]\nResult 2\n[/WORKER RESULT]',
      ];

      const prompt = buildWorkerFeedbackPrompt(results);

      expect(prompt).toContain('2 workers completed');
      expect(prompt).toContain('Result 1');
      expect(prompt).toContain('Result 2');
    });
  });

  describe('formatWorkerBatch', () => {
    it('should format a batch of successful workers', () => {
      const outcomes: PromiseSettledResult<AgentResult>[] = [
        {
          status: 'fulfilled',
          value: {
            stdout: 'Found 5 tables',
            stderr: '',
            exitCode: 0,
            durationMs: 1200,
            retryCount: 0,
          },
        },
        {
          status: 'fulfilled',
          value: {
            stdout: 'Found 12 endpoints',
            stderr: '',
            exitCode: 0,
            durationMs: 800,
            retryCount: 0,
          },
        },
      ];

      const markers = [
        { profile: 'read-only', body: { model: 'haiku' } },
        { profile: 'read-only', body: { model: 'haiku' } },
      ];

      const { formattedResults, feedbackPrompt } = formatWorkerBatch(outcomes, markers);

      expect(formattedResults).toHaveLength(2);
      expect(formattedResults[0]).toContain('Found 5 tables');
      expect(formattedResults[0]).toContain('haiku');
      expect(formattedResults[0]).toContain('worker 1/2');
      expect(formattedResults[1]).toContain('Found 12 endpoints');
      expect(formattedResults[1]).toContain('worker 2/2');
      expect(feedbackPrompt).toContain('2 workers completed');
    });

    it('should format mixed success and failure results', () => {
      const outcomes: PromiseSettledResult<AgentResult>[] = [
        {
          status: 'fulfilled',
          value: {
            stdout: 'Success output',
            stderr: '',
            exitCode: 0,
            durationMs: 1000,
            retryCount: 0,
          },
        },
        {
          status: 'fulfilled',
          value: {
            stdout: '',
            stderr: 'Command failed',
            exitCode: 1,
            durationMs: 500,
            retryCount: 0,
          },
        },
      ];

      const markers = [
        { profile: 'read-only', body: { model: 'haiku' } },
        { profile: 'code-edit', body: { model: 'sonnet' } },
      ];

      const { formattedResults } = formatWorkerBatch(outcomes, markers);

      expect(formattedResults).toHaveLength(2);
      expect(formattedResults[0]).toContain('WORKER RESULT');
      expect(formattedResults[0]).toContain('Success output');
      // formatWorkerBatch classifies errors → uses [WORKER FAILED: crash] for exit 1 with generic stderr
      expect(formattedResults[1]).toContain('WORKER FAILED');
      expect(formattedResults[1]).toContain('Command failed');
      expect(formattedResults[1]).toContain('exit 1');
    });

    it('should include error category in [WORKER FAILED] format for rate-limit errors', () => {
      const outcomes: PromiseSettledResult<AgentResult>[] = [
        {
          status: 'fulfilled',
          value: {
            stdout: '',
            stderr: 'rate limit exceeded, retry after 60 seconds',
            exitCode: 1,
            durationMs: 200,
            retryCount: 2,
          },
        },
      ];

      const markers = [{ profile: 'code-edit', body: { model: 'sonnet' } }];

      const { formattedResults } = formatWorkerBatch(outcomes, markers);

      expect(formattedResults).toHaveLength(1);
      expect(formattedResults[0]).toContain('[WORKER FAILED: rate-limit');
      expect(formattedResults[0]).toContain('[/WORKER FAILED]');
    });

    it('should include error category in [WORKER FAILED] format for context-overflow errors', () => {
      const outcomes: PromiseSettledResult<AgentResult>[] = [
        {
          status: 'fulfilled',
          value: {
            stdout: '',
            stderr: 'context window exceeded',
            exitCode: 1,
            durationMs: 300,
            retryCount: 0,
          },
        },
      ];

      const markers = [{ profile: 'read-only', body: { model: 'opus' } }];

      const { formattedResults } = formatWorkerBatch(outcomes, markers);

      expect(formattedResults).toHaveLength(1);
      expect(formattedResults[0]).toContain('[WORKER FAILED: context-overflow');
      expect(formattedResults[0]).toContain('[/WORKER FAILED]');
    });

    it('should handle rejected promises (exceptions → crash category)', () => {
      const outcomes: PromiseSettledResult<AgentResult>[] = [
        {
          status: 'rejected',
          reason: new Error('Process spawn failed'),
        },
      ];

      const markers = [{ profile: 'full-access', body: { model: 'opus' } }];

      const { formattedResults } = formatWorkerBatch(outcomes, markers);

      expect(formattedResults).toHaveLength(1);
      // Rejected promises are classified as 'crash'
      expect(formattedResults[0]).toContain('[WORKER FAILED: crash');
      expect(formattedResults[0]).toContain('Process spawn failed');
      expect(formattedResults[0]).toContain('exit -1');
    });

    it('should use model from AgentResult when marker body has no model', () => {
      const outcomes: PromiseSettledResult<AgentResult>[] = [
        {
          status: 'fulfilled',
          value: {
            stdout: 'Output',
            stderr: '',
            exitCode: 0,
            durationMs: 1000,
            retryCount: 0,
            model: 'sonnet',
          },
        },
      ];

      const markers = [{ profile: 'read-only', body: {} }];

      const { formattedResults } = formatWorkerBatch(outcomes, markers);

      expect(formattedResults[0]).toContain('sonnet');
    });

    it('returns empty observations array when sessionId is not provided', () => {
      const outcomes: PromiseSettledResult<AgentResult>[] = [
        {
          status: 'fulfilled',
          value: {
            stdout: 'Fixed the authentication bug in src/core/auth.ts',
            stderr: '',
            exitCode: 0,
            durationMs: 1000,
            retryCount: 0,
          },
        },
      ];

      const markers = [{ profile: 'code-edit', body: { model: 'sonnet' } }];

      const { observations } = formatWorkerBatch(outcomes, markers);

      expect(observations).toHaveLength(0);
    });

    it('extracts observation for each fulfilled worker when sessionId is provided', () => {
      const outcomes: PromiseSettledResult<AgentResult>[] = [
        {
          status: 'fulfilled',
          value: {
            stdout: 'Fixed the authentication bug in src/core/auth.ts',
            stderr: '',
            exitCode: 0,
            durationMs: 1000,
            retryCount: 0,
          },
        },
        {
          status: 'fulfilled',
          value: {
            stdout: 'Updated src/memory/database.ts with new schema',
            stderr: '',
            exitCode: 0,
            durationMs: 800,
            retryCount: 0,
          },
        },
      ];

      const markers = [
        { profile: 'code-edit', body: { model: 'sonnet', prompt: 'Fix auth bug' } },
        { profile: 'code-edit', body: { model: 'haiku', prompt: 'Update schema' } },
      ];
      const workerIds = ['worker-abc', 'worker-def'];

      const { observations } = formatWorkerBatch(outcomes, markers, workerIds, 'session-123');

      expect(observations).toHaveLength(2);
      expect(observations[0]).toHaveProperty('session_id', 'session-123');
      expect(observations[0]).toHaveProperty('worker_id', 'worker-abc');
      expect(observations[0]).toHaveProperty('type');
      expect(observations[0]).toHaveProperty('title');
      expect(observations[0]).toHaveProperty('narrative');
      expect(observations[1]).toHaveProperty('session_id', 'session-123');
      expect(observations[1]).toHaveProperty('worker_id', 'worker-def');
    });

    it('uses fallback worker ID when workerIds array is not provided', () => {
      const outcomes: PromiseSettledResult<AgentResult>[] = [
        {
          status: 'fulfilled',
          value: {
            stdout: 'Investigated the codebase',
            stderr: '',
            exitCode: 0,
            durationMs: 500,
            retryCount: 0,
          },
        },
      ];

      const markers = [{ profile: 'read-only', body: { model: 'haiku' } }];

      const { observations } = formatWorkerBatch(outcomes, markers, undefined, 'session-xyz');

      expect(observations).toHaveLength(1);
      expect(observations[0]!.worker_id).toBe('worker-1');
    });

    it('skips observation extraction for rejected promises', () => {
      const outcomes: PromiseSettledResult<AgentResult>[] = [
        {
          status: 'rejected',
          reason: new Error('Spawn failed'),
        },
      ];

      const markers = [{ profile: 'full-access', body: { model: 'opus' } }];

      const { observations } = formatWorkerBatch(outcomes, markers, ['worker-1'], 'session-abc');

      expect(observations).toHaveLength(0);
    });

    it('returns workerSummaries for each fulfilled worker (OB-1632)', () => {
      const outcomes: PromiseSettledResult<AgentResult>[] = [
        {
          status: 'fulfilled',
          value: {
            stdout: 'Fixed the auth bug in src/core/auth.ts',
            stderr: '',
            exitCode: 0,
            durationMs: 1000,
            retryCount: 0,
          },
        },
        {
          status: 'rejected',
          reason: new Error('Spawn failed'),
        },
      ];

      const markers = [
        { profile: 'code-edit', body: { model: 'sonnet', prompt: 'Fix the auth bug' } },
        { profile: 'read-only', body: { model: 'haiku', prompt: 'Investigate routes' } },
      ];

      const { workerSummaries } = formatWorkerBatch(outcomes, markers);

      // Only fulfilled workers produce summaries
      expect(workerSummaries).toHaveLength(1);
      expect(workerSummaries[0]).toHaveProperty('request', 'Fix the auth bug');
      expect(workerSummaries[0]).toHaveProperty('files_modified');
      expect(workerSummaries[0]).toHaveProperty('files_read');
    });

    it('returns empty workerSummaries when all workers are rejected', () => {
      const outcomes: PromiseSettledResult<AgentResult>[] = [
        { status: 'rejected', reason: new Error('Spawn failed') },
      ];

      const markers = [{ profile: 'code-edit', body: {} }];

      const { workerSummaries } = formatWorkerBatch(outcomes, markers);

      expect(workerSummaries).toHaveLength(0);
    });
  });

  describe('extractWorkerSummary', () => {
    it('sets request from the input prompt', () => {
      const summary = extractWorkerSummary('Some output text here.', 'Fix the login bug');
      expect(summary.request).toBe('Fix the login bug');
    });

    it('uses "unknown" when request is empty', () => {
      const summary = extractWorkerSummary('Some output here.', '');
      expect(summary.request).toBe('unknown');
    });

    it('extracts completed field from summary-verb lines', () => {
      const output = 'Fixed the authentication issue in router.ts\nUpdated session handling.';
      const summary = extractWorkerSummary(output, 'Fix auth');
      expect(summary.completed).toMatch(/fixed|updated/i);
    });

    it('extracts completed field from markdown Summary section', () => {
      const output = '## Summary\nAdded retry logic for failed requests.\n## Next Steps\nTest it.';
      const summary = extractWorkerSummary(output, 'Add retry logic');
      expect(summary.completed).toContain('Added retry logic');
    });

    it('extracts next_steps from markdown section', () => {
      const output =
        'Did the work.\n\n## Next Steps\nRun tests on the new endpoint.\nDeploy to staging.';
      const summary = extractWorkerSummary(output, 'Implement endpoint');
      expect(summary.next_steps).toMatch(/run tests|deploy/i);
    });

    it('extracts investigated field from markdown Analysis section', () => {
      const output =
        '## Analysis\nRead src/core/auth.ts and reviewed the token logic.\n## Result\nDone.';
      const summary = extractWorkerSummary(output, 'Investigate auth');
      expect(summary.investigated).toContain('Read src/core/auth.ts');
    });

    it('extracts files_modified using path patterns', () => {
      const output = 'Updated src/core/auth.ts with new token validation logic.';
      const summary = extractWorkerSummary(output, 'Fix auth');
      expect(summary.files_modified).toContain('src/core/auth.ts');
    });

    it('does not set error_summary when isError is false', () => {
      const summary = extractWorkerSummary('All done successfully.', 'Do task', false);
      expect(summary.error_summary).toBeUndefined();
    });

    it('sets error_summary when isError is true', () => {
      const output = 'error: Cannot find module src/missing.ts\nProcess exited with code 1.';
      const summary = extractWorkerSummary(output, 'Run task', true);
      expect(summary.error_summary).toBeDefined();
      expect(summary.error_summary!.length).toBeGreaterThan(0);
    });

    it('returns empty strings for undetected fields', () => {
      const summary = extractWorkerSummary('Nothing to extract here.', 'Do something');
      expect(summary.investigated).toBe('');
      expect(summary.completed).toBe('');
      expect(summary.learned).toBe('');
      expect(summary.next_steps).toBe('');
    });

    it('caps extracted fields at 300 characters', () => {
      const longLine = 'Fixed '.padEnd(400, 'x');
      const summary = extractWorkerSummary(longLine, 'Fix stuff');
      expect(summary.completed.length).toBeLessThanOrEqual(300);
    });
  });
});
