/**
 * Unit tests for startup trust level logging (OB-1598).
 * Tests the logTrustLevelAtStartup helper extracted from src/index.ts.
 */

import { describe, it, expect, vi } from 'vitest';
import { logTrustLevelAtStartup } from '../src/index.js';

function makeLogger() {
  return { warn: vi.fn(), info: vi.fn() };
}

describe('logTrustLevelAtStartup', () => {
  it('calls logger.warn with TRUSTED when trustLevel is trusted', () => {
    const log = makeLogger();
    logTrustLevelAtStartup(log, 'trusted');
    expect(log.warn).toHaveBeenCalledOnce();
    expect(log.warn).toHaveBeenCalledWith(expect.stringContaining('TRUSTED'));
    expect(log.info).not.toHaveBeenCalled();
  });

  it('calls logger.info with SANDBOX when trustLevel is sandbox', () => {
    const log = makeLogger();
    logTrustLevelAtStartup(log, 'sandbox');
    expect(log.info).toHaveBeenCalledOnce();
    expect(log.info).toHaveBeenCalledWith(expect.stringContaining('SANDBOX'));
    expect(log.warn).not.toHaveBeenCalled();
  });

  it('calls no log methods when trustLevel is standard', () => {
    const log = makeLogger();
    logTrustLevelAtStartup(log, 'standard');
    expect(log.warn).not.toHaveBeenCalled();
    expect(log.info).not.toHaveBeenCalled();
  });

  it('calls no log methods when trustLevel is missing (empty string)', () => {
    const log = makeLogger();
    logTrustLevelAtStartup(log, '');
    expect(log.warn).not.toHaveBeenCalled();
    expect(log.info).not.toHaveBeenCalled();
  });

  it('warn message mentions full access within workspace for trusted mode', () => {
    const log = makeLogger();
    logTrustLevelAtStartup(log, 'trusted');
    const msg = vi.mocked(log.warn).mock.calls[0]?.[0] as string;
    expect(msg).toContain('full access within workspace');
  });

  it('info message mentions agents are read-only for sandbox mode', () => {
    const log = makeLogger();
    logTrustLevelAtStartup(log, 'sandbox');
    const msg = vi.mocked(log.info).mock.calls[0]?.[0] as string;
    expect(msg).toContain('read-only');
  });
});
