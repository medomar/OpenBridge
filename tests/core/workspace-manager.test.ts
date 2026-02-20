import { describe, it, expect, vi, beforeEach } from 'vitest';
import { WorkspaceManager } from '../../src/core/workspace-manager.js';
import type { WorkspaceMap } from '../../src/types/workspace-map.js';
import type { ScanResult } from '../../src/_archived/knowledge/workspace-scanner.js';

const mockAccess = vi.fn<() => Promise<void>>().mockResolvedValue(undefined);
const mockScanWorkspace = vi.fn<(path: string) => Promise<ScanResult>>();

vi.mock('node:fs/promises', () => ({
  access: (...args: unknown[]) => mockAccess(...args),
}));

vi.mock('../../src/_archived/knowledge/workspace-scanner.js', () => ({
  scanWorkspace: (...args: unknown[]) => mockScanWorkspace(...(args as [string])),
}));

function createMockMap(name: string): WorkspaceMap {
  return {
    version: '1.0',
    name,
    baseUrl: 'http://localhost:3000',
    auth: { type: 'none' },
    source: 'manual',
    headers: {},
    endpoints: [
      {
        id: 'ep-1',
        name: 'Get items',
        method: 'GET',
        path: '/items',
        parameters: [],
        headers: {},
        tags: [],
      },
    ],
    metadata: {},
  };
}

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

  describe('loadMaps()', () => {
    it('loads maps for workspaces that have map files', async () => {
      const mockMap = createMockMap('Frontend API');
      mockScanWorkspace.mockResolvedValue({
        success: true,
        map: mockMap,
        sourceFile: '/projects/frontend/openbridge.map.json',
      });

      const wm = new WorkspaceManager([{ name: 'frontend', path: '/projects/frontend' }]);
      await wm.loadMaps();

      expect(mockScanWorkspace).toHaveBeenCalledWith('/projects/frontend');
      expect(wm.getMap('frontend')).toBe(mockMap);
    });

    it('skips workspaces without map files', async () => {
      mockScanWorkspace.mockResolvedValue({
        success: false,
        error: 'ENOENT: no such file',
        sourceFile: '/projects/backend/openbridge.map.json',
      });

      const wm = new WorkspaceManager([{ name: 'backend', path: '/projects/backend' }]);
      await wm.loadMaps();

      expect(wm.getMap('backend')).toBeUndefined();
    });

    it('loads maps for multiple workspaces independently', async () => {
      const frontendMap = createMockMap('Frontend API');
      mockScanWorkspace
        .mockResolvedValueOnce({
          success: true,
          map: frontendMap,
          sourceFile: '/projects/frontend/openbridge.map.json',
        })
        .mockResolvedValueOnce({
          success: false,
          error: 'ENOENT',
          sourceFile: '/projects/backend/openbridge.map.json',
        });

      const wm = new WorkspaceManager([
        { name: 'frontend', path: '/projects/frontend' },
        { name: 'backend', path: '/projects/backend' },
      ]);
      await wm.loadMaps();

      expect(wm.getMap('frontend')).toBe(frontendMap);
      expect(wm.getMap('backend')).toBeUndefined();
    });
  });

  describe('getMap()', () => {
    it('returns undefined for workspace without a loaded map', () => {
      const wm = new WorkspaceManager([{ name: 'myapp', path: '/projects/myapp' }]);
      expect(wm.getMap('myapp')).toBeUndefined();
    });

    it('returns undefined for unknown workspace name', () => {
      const wm = new WorkspaceManager([{ name: 'myapp', path: '/projects/myapp' }]);
      expect(wm.getMap('unknown')).toBeUndefined();
    });
  });

  describe('resolveMap()', () => {
    it('returns map for a named workspace', async () => {
      const mockMap = createMockMap('My API');
      mockScanWorkspace.mockResolvedValue({
        success: true,
        map: mockMap,
        sourceFile: '/projects/myapp/openbridge.map.json',
      });

      const wm = new WorkspaceManager([{ name: 'myapp', path: '/projects/myapp' }], 'myapp');
      await wm.loadMaps();

      expect(wm.resolveMap('myapp')).toBe(mockMap);
    });

    it('falls back to default workspace when name is undefined', async () => {
      const mockMap = createMockMap('Default API');
      mockScanWorkspace.mockResolvedValue({
        success: true,
        map: mockMap,
        sourceFile: '/projects/myapp/openbridge.map.json',
      });

      const wm = new WorkspaceManager([{ name: 'myapp', path: '/projects/myapp' }], 'myapp');
      await wm.loadMaps();

      expect(wm.resolveMap(undefined)).toBe(mockMap);
    });

    it('returns undefined when no default and name is undefined', () => {
      const wm = new WorkspaceManager([{ name: 'myapp', path: '/projects/myapp' }]);
      expect(wm.resolveMap(undefined)).toBeUndefined();
    });
  });

  describe('getAllMaps()', () => {
    it('returns all loaded maps', async () => {
      const map1 = createMockMap('API 1');
      const map2 = createMockMap('API 2');
      mockScanWorkspace
        .mockResolvedValueOnce({ success: true, map: map1, sourceFile: 'a.json' })
        .mockResolvedValueOnce({ success: true, map: map2, sourceFile: 'b.json' });

      const wm = new WorkspaceManager([
        { name: 'a', path: '/projects/a' },
        { name: 'b', path: '/projects/b' },
      ]);
      await wm.loadMaps();

      const allMaps = wm.getAllMaps();
      expect(allMaps.size).toBe(2);
      expect(allMaps.get('a')).toBe(map1);
      expect(allMaps.get('b')).toBe(map2);
    });

    it('returns empty map when no maps loaded', () => {
      const wm = new WorkspaceManager([]);
      expect(wm.getAllMaps().size).toBe(0);
    });
  });
});
