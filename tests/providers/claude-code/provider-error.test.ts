import { describe, it, expect } from 'vitest';
import { ProviderError, classifyError } from '../../../src/providers/claude-code/provider-error.js';

describe('ProviderError', () => {
  it('stores kind and exitCode', () => {
    const err = new ProviderError('timeout', 'transient', 124);
    expect(err.kind).toBe('transient');
    expect(err.exitCode).toBe(124);
    expect(err.message).toBe('timeout');
    expect(err.name).toBe('ProviderError');
  });

  it('is an instance of Error', () => {
    const err = new ProviderError('bad', 'permanent', 1);
    expect(err).toBeInstanceOf(Error);
    expect(err).toBeInstanceOf(ProviderError);
  });
});

describe('classifyError()', () => {
  // Transient cases
  it('classifies exit code 124 as permanent (timeout — retrying will timeout again)', () => {
    expect(classifyError(124, '')).toBe('permanent');
  });

  it('classifies exit code 143 as permanent (SIGTERM from timeout)', () => {
    expect(classifyError(143, '')).toBe('permanent');
  });

  it('classifies "timeout" in stderr as transient', () => {
    expect(classifyError(1, 'Request timeout after 30s')).toBe('transient');
  });

  it('classifies "timed out" in stderr as transient', () => {
    expect(classifyError(1, 'Connection timed out')).toBe('transient');
  });

  it('classifies "rate limit" in stderr as transient', () => {
    expect(classifyError(1, 'rate limit exceeded')).toBe('transient');
  });

  it('classifies "too many requests" in stderr as transient', () => {
    expect(classifyError(1, 'Error: Too many requests')).toBe('transient');
  });

  it('classifies "429" in stderr as transient', () => {
    expect(classifyError(1, 'HTTP 429 - slow down')).toBe('transient');
  });

  it('classifies "503" in stderr as transient', () => {
    expect(classifyError(1, 'HTTP 503 Service Unavailable')).toBe('transient');
  });

  it('classifies "ETIMEDOUT" in stderr as transient', () => {
    expect(classifyError(1, 'Error: connect ETIMEDOUT')).toBe('transient');
  });

  it('classifies "ECONNRESET" in stderr as transient', () => {
    expect(classifyError(1, 'read ECONNRESET')).toBe('transient');
  });

  it('classifies "ECONNREFUSED" in stderr as transient', () => {
    expect(classifyError(1, 'connect ECONNREFUSED 127.0.0.1:3000')).toBe('transient');
  });

  it('classifies "overloaded" in stderr as transient', () => {
    expect(classifyError(1, 'API is overloaded')).toBe('transient');
  });

  it('classifies "temporarily unavailable" in stderr as transient', () => {
    expect(classifyError(1, 'Service temporarily unavailable')).toBe('transient');
  });

  // Permanent cases
  it('classifies "invalid api key" in stderr as permanent', () => {
    expect(classifyError(1, 'Error: invalid api key')).toBe('permanent');
  });

  it('classifies "authentication failed" in stderr as permanent', () => {
    expect(classifyError(1, 'authentication failed')).toBe('permanent');
  });

  it('classifies "unauthorized" in stderr as permanent', () => {
    expect(classifyError(1, '401 Unauthorized')).toBe('permanent');
  });

  it('classifies "permission denied" in stderr as permanent', () => {
    expect(classifyError(1, 'Error: Permission denied')).toBe('permanent');
  });

  it('classifies "ENOENT" in stderr as permanent', () => {
    expect(classifyError(1, 'Error: ENOENT: no such file or directory')).toBe('permanent');
  });

  it('classifies "invalid model" in stderr as permanent', () => {
    expect(classifyError(1, 'Error: invalid model specified')).toBe('permanent');
  });

  it('classifies "400 bad request" in stderr as permanent', () => {
    expect(classifyError(1, 'HTTP 400 Bad Request')).toBe('permanent');
  });

  // Default: unknown errors → transient (safe to retry)
  it('defaults to transient for unknown exit codes with empty stderr', () => {
    expect(classifyError(1, '')).toBe('transient');
  });

  it('defaults to transient for unrecognised stderr', () => {
    expect(classifyError(2, 'some unknown error')).toBe('transient');
  });

  // Priority: transient patterns checked before permanent
  it('prioritises transient when both patterns match', () => {
    expect(classifyError(1, 'timeout: authentication failed')).toBe('transient');
  });
});
