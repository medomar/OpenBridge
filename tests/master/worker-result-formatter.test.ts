import { describe, it, expect } from 'vitest';
import {
  formatWorkerResult,
  formatWorkerError,
  buildWorkerFeedbackPrompt,
  formatWorkerBatch,
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
  });

  describe('formatWorkerError', () => {
    it('should format a worker error with exit code', () => {
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

    it('should handle exception errors (exit -1)', () => {
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
      expect(prompt).toContain('synthesize these results');
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
      expect(formattedResults[1]).toContain('WORKER ERROR');
      expect(formattedResults[1]).toContain('Command failed');
      expect(formattedResults[1]).toContain('exit 1');
    });

    it('should handle rejected promises (exceptions)', () => {
      const outcomes: PromiseSettledResult<AgentResult>[] = [
        {
          status: 'rejected',
          reason: new Error('Process spawn failed'),
        },
      ];

      const markers = [{ profile: 'full-access', body: { model: 'opus' } }];

      const { formattedResults } = formatWorkerBatch(outcomes, markers);

      expect(formattedResults).toHaveLength(1);
      expect(formattedResults[0]).toContain('WORKER ERROR');
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
  });
});
