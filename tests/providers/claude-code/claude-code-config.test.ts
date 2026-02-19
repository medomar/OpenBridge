import { describe, it, expect } from 'vitest';
import { homedir } from 'node:os';
import { resolve } from 'node:path';
import {
  resolveTilde,
  ClaudeCodeConfigSchema,
} from '../../../src/providers/claude-code/claude-code-config.js';

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

describe('ClaudeCodeConfigSchema', () => {
  it('resolves tilde in workspacePath during parsing', () => {
    const config = ClaudeCodeConfigSchema.parse({ workspacePath: '~/my-project' });
    expect(config.workspacePath).toBe(resolve(homedir(), 'my-project'));
  });

  it('preserves absolute workspacePath', () => {
    const config = ClaudeCodeConfigSchema.parse({ workspacePath: '/tmp/workspace' });
    expect(config.workspacePath).toBe('/tmp/workspace');
  });
});
