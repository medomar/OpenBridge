import { describe, it, expect, vi, beforeEach } from 'vitest';
import { WorkspaceManager } from '../../src/core/workspace-manager.js';

const mockAccess = vi.fn<() => Promise<void>>().mockResolvedValue(undefined);

vi.mock('node:fs/promises', () => ({
  access: (...args: unknown[]) => mockAccess(...args),
}));

describe('WorkspaceManager', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('constructor', () => {
    it('creates with empty workspaces', () => {
      const wm = new WorkspaceManager([], undefined);
      expect(wm.enabled).toBe(false);
    });

    it('creates with configured workspaces', () => {
      const wm = new WorkspaceManager(
        [
          { name: 'frontend', path: '/projects/frontend' },
          { name: 'backend', path: '/projects/backend' },
        ],
        'frontend',
      );
      expect(wm.enabled).toBe(true);
      expect(wm.defaultName).toBe('frontend');
    });
  });

  describe('parseWorkspace()', () => {
    it('returns workspace name and remaining content for @workspace syntax', () => {
      const wm = new WorkspaceManager([{ name: 'myapp', path: '/projects/myapp' }]);
      const result = wm.parseWorkspace('@myapp list all files');
      expect(result.workspace).toBe('myapp');
      expect(result.content).toBe('list all files');
    });

    it('returns undefined workspace when no @ prefix', () => {
      const wm = new WorkspaceManager([{ name: 'myapp', path: '/projects/myapp' }]);
      const result = wm.parseWorkspace('list all files');
      expect(result.workspace).toBeUndefined();
      expect(result.content).toBe('list all files');
    });

    it('returns undefined workspace when @name does not match any configured workspace', () => {
      const wm = new WorkspaceManager([{ name: 'myapp', path: '/projects/myapp' }]);
      const result = wm.parseWorkspace('@unknown list all files');
      expect(result.workspace).toBeUndefined();
      expect(result.content).toBe('@unknown list all files');
    });

    it('handles leading whitespace', () => {
      const wm = new WorkspaceManager([{ name: 'myapp', path: '/projects/myapp' }]);
      const result = wm.parseWorkspace('  @myapp do something');
      expect(result.workspace).toBe('myapp');
      expect(result.content).toBe('do something');
    });

    it('handles workspace names with hyphens', () => {
      const wm = new WorkspaceManager([{ name: 'my-app', path: '/projects/my-app' }]);
      const result = wm.parseWorkspace('@my-app hello');
      expect(result.workspace).toBe('my-app');
      expect(result.content).toBe('hello');
    });
  });

  describe('resolve()', () => {
    it('resolves a workspace name to its path', () => {
      const wm = new WorkspaceManager([{ name: 'myapp', path: '/projects/myapp' }]);
      expect(wm.resolve('myapp')).toBe('/projects/myapp');
    });

    it('returns undefined for unknown workspace name', () => {
      const wm = new WorkspaceManager([{ name: 'myapp', path: '/projects/myapp' }]);
      expect(wm.resolve('unknown')).toBeUndefined();
    });

    it('falls back to default workspace when name is undefined', () => {
      const wm = new WorkspaceManager([{ name: 'myapp', path: '/projects/myapp' }], 'myapp');
      expect(wm.resolve(undefined)).toBe('/projects/myapp');
    });

    it('returns undefined when no default and name is undefined', () => {
      const wm = new WorkspaceManager([{ name: 'myapp', path: '/projects/myapp' }]);
      expect(wm.resolve(undefined)).toBeUndefined();
    });
  });

  describe('validatePaths()', () => {
    it('resolves when all paths exist', async () => {
      const wm = new WorkspaceManager([
        { name: 'a', path: '/projects/a' },
        { name: 'b', path: '/projects/b' },
      ]);
      await expect(wm.validatePaths()).resolves.toBeUndefined();
      expect(mockAccess).toHaveBeenCalledTimes(2);
    });

    it('throws when a path does not exist', async () => {
      mockAccess.mockRejectedValueOnce(new Error('ENOENT'));
      const wm = new WorkspaceManager([{ name: 'bad', path: '/no/such/path' }]);
      await expect(wm.validatePaths()).rejects.toThrow('Workspace "bad" path does not exist');
    });
  });

  describe('listWorkspaces()', () => {
    it('returns all workspace entries', () => {
      const wm = new WorkspaceManager([
        { name: 'frontend', path: '/projects/frontend' },
        { name: 'backend', path: '/projects/backend' },
      ]);
      const list = wm.listWorkspaces();
      expect(list).toHaveLength(2);
      expect(list[0]).toEqual({ name: 'frontend', path: '/projects/frontend' });
      expect(list[1]).toEqual({ name: 'backend', path: '/projects/backend' });
    });
  });

  describe('formatList()', () => {
    it('returns a friendly list with default indicator', () => {
      const wm = new WorkspaceManager(
        [
          { name: 'frontend', path: '/projects/frontend' },
          { name: 'backend', path: '/projects/backend' },
        ],
        'frontend',
      );
      const output = wm.formatList();
      expect(output).toContain('frontend');
      expect(output).toContain('(default)');
      expect(output).toContain('backend');
      expect(output).toContain('@workspace-name');
    });

    it('returns fallback message when no workspaces configured', () => {
      const wm = new WorkspaceManager([]);
      expect(wm.formatList()).toBe('No workspaces configured.');
    });
  });
});
