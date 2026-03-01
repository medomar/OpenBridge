import { describe, it, expect } from 'vitest';
import { homedir } from 'node:os';
import { resolve } from 'node:path';
import { resolveTilde, CodexConfigSchema } from '../../../src/providers/codex/codex-config.js';

describe('resolveTilde', () => {
  it('resolves lone ~ to home directory', () => {
    expect(resolveTilde('~')).toBe(homedir());
  });

  it('resolves ~/path to home-based absolute path', () => {
    expect(resolveTilde('~/projects/my-app')).toBe(resolve(homedir(), 'projects/my-app'));
  });

  it('leaves absolute paths unchanged', () => {
    expect(resolveTilde('/tmp/workspace')).toBe('/tmp/workspace');
  });

  it('leaves relative paths unchanged', () => {
    expect(resolveTilde('./some/path')).toBe('./some/path');
  });

  it('does not resolve tilde in the middle of a path', () => {
    expect(resolveTilde('/foo/~/bar')).toBe('/foo/~/bar');
  });
});

describe('CodexConfigSchema', () => {
  it('applies default workspacePath of "." when not provided', () => {
    const config = CodexConfigSchema.parse({});
    // "." resolves to the current directory (resolveTilde leaves "." unchanged)
    expect(config.workspacePath).toBe('.');
  });

  it('preserves absolute workspacePath', () => {
    const config = CodexConfigSchema.parse({ workspacePath: '/tmp/workspace' });
    expect(config.workspacePath).toBe('/tmp/workspace');
  });

  it('resolves tilde in workspacePath during parsing', () => {
    const config = CodexConfigSchema.parse({ workspacePath: '~/my-project' });
    expect(config.workspacePath).toBe(resolve(homedir(), 'my-project'));
  });

  it('applies default timeout of 120000ms', () => {
    const config = CodexConfigSchema.parse({ workspacePath: '/tmp' });
    expect(config.timeout).toBe(120_000);
  });

  it('accepts a custom timeout', () => {
    const config = CodexConfigSchema.parse({ workspacePath: '/tmp', timeout: 60_000 });
    expect(config.timeout).toBe(60_000);
  });

  it('rejects non-positive timeout', () => {
    expect(() => CodexConfigSchema.parse({ workspacePath: '/tmp', timeout: 0 })).toThrow();
    expect(() => CodexConfigSchema.parse({ workspacePath: '/tmp', timeout: -1 })).toThrow();
  });

  it('allows optional model field', () => {
    const withModel = CodexConfigSchema.parse({ workspacePath: '/tmp', model: 'gpt-5.2-codex' });
    expect(withModel.model).toBe('gpt-5.2-codex');

    const withoutModel = CodexConfigSchema.parse({ workspacePath: '/tmp' });
    expect(withoutModel.model).toBeUndefined();
  });

  it('allows optional sandbox field', () => {
    const withSandbox = CodexConfigSchema.parse({ workspacePath: '/tmp', sandbox: 'read-only' });
    expect(withSandbox.sandbox).toBe('read-only');

    const withoutSandbox = CodexConfigSchema.parse({ workspacePath: '/tmp' });
    expect(withoutSandbox.sandbox).toBeUndefined();
  });

  it('applies default sessionTtlMs of 1800000 (30 minutes)', () => {
    const config = CodexConfigSchema.parse({ workspacePath: '/tmp' });
    expect(config.sessionTtlMs).toBe(1_800_000);
  });

  it('accepts a custom sessionTtlMs', () => {
    const config = CodexConfigSchema.parse({ workspacePath: '/tmp', sessionTtlMs: 60_000 });
    expect(config.sessionTtlMs).toBe(60_000);
  });

  it('rejects negative sessionTtlMs', () => {
    expect(() => CodexConfigSchema.parse({ workspacePath: '/tmp', sessionTtlMs: -1 })).toThrow();
  });

  it('accepts sessionTtlMs of 0 (disable TTL)', () => {
    // 0 means sessions never naturally expire by elapsed time
    const config = CodexConfigSchema.parse({ workspacePath: '/tmp', sessionTtlMs: 0 });
    expect(config.sessionTtlMs).toBe(0);
  });
});
