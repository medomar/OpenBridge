import { describe, it, expect } from 'vitest';
import {
  TOOLS_FILE_MANAGEMENT,
  resolveTools,
  isPathWithinWorkspace,
  scanDestructiveCommandViolations,
} from '../../src/core/agent-runner.js';
import { BUILT_IN_PROFILES } from '../../src/types/agent.js';

// ── file-management tool profile ──────────────────────────────────

describe('file-management tool profile', () => {
  describe('profile definition in BUILT_IN_PROFILES', () => {
    const profile = BUILT_IN_PROFILES['file-management'];

    it('exists in BUILT_IN_PROFILES', () => {
      expect(profile).toBeDefined();
    });

    it('includes Bash(rm:*)', () => {
      expect(profile.tools).toContain('Bash(rm:*)');
    });

    it('includes Bash(mv:*)', () => {
      expect(profile.tools).toContain('Bash(mv:*)');
    });

    it('includes Bash(cp:*)', () => {
      expect(profile.tools).toContain('Bash(cp:*)');
    });

    it('includes Bash(mkdir:*)', () => {
      expect(profile.tools).toContain('Bash(mkdir:*)');
    });

    it('includes Bash(chmod:*)', () => {
      expect(profile.tools).toContain('Bash(chmod:*)');
    });

    it('includes Read, Glob, Grep, Write, Edit', () => {
      expect(profile.tools).toContain('Read');
      expect(profile.tools).toContain('Glob');
      expect(profile.tools).toContain('Grep');
      expect(profile.tools).toContain('Write');
      expect(profile.tools).toContain('Edit');
    });

    it('does not include unrestricted Bash(*)', () => {
      expect(profile.tools).not.toContain('Bash(*)');
    });
  });

  describe('TOOLS_FILE_MANAGEMENT constant', () => {
    it('includes Bash(rm:*)', () => {
      expect(TOOLS_FILE_MANAGEMENT).toContain('Bash(rm:*)');
    });

    it('includes Bash(mv:*)', () => {
      expect(TOOLS_FILE_MANAGEMENT).toContain('Bash(mv:*)');
    });

    it('includes Bash(cp:*)', () => {
      expect(TOOLS_FILE_MANAGEMENT).toContain('Bash(cp:*)');
    });

    it('includes Bash(mkdir:*)', () => {
      expect(TOOLS_FILE_MANAGEMENT).toContain('Bash(mkdir:*)');
    });
  });

  describe('resolveTools()', () => {
    it('returns tools for file-management profile', () => {
      const tools = resolveTools('file-management');
      expect(tools).toBeDefined();
      expect(tools).toContain('Bash(rm:*)');
      expect(tools).toContain('Bash(mv:*)');
      expect(tools).toContain('Bash(cp:*)');
      expect(tools).toContain('Bash(mkdir:*)');
    });

    it('returns the same tools as TOOLS_FILE_MANAGEMENT', () => {
      const tools = resolveTools('file-management');
      expect(tools).toEqual([...TOOLS_FILE_MANAGEMENT]);
    });
  });
});

// ── isPathWithinWorkspace() ────────────────────────────────────────

describe('isPathWithinWorkspace()', () => {
  const workspace = '/home/user/my-project';

  it('accepts a path that equals the workspace root', () => {
    expect(isPathWithinWorkspace(workspace, workspace)).toBe(true);
  });

  it('accepts a path inside the workspace', () => {
    expect(isPathWithinWorkspace(`${workspace}/src/index.ts`, workspace)).toBe(true);
  });

  it('accepts a deeply nested path inside the workspace', () => {
    expect(isPathWithinWorkspace(`${workspace}/a/b/c/d.txt`, workspace)).toBe(true);
  });

  it('rejects a path outside the workspace', () => {
    expect(isPathWithinWorkspace('/etc/passwd', workspace)).toBe(false);
  });

  it('rejects the parent of the workspace', () => {
    expect(isPathWithinWorkspace('/home/user', workspace)).toBe(false);
  });

  it('rejects a sibling directory that starts with the same prefix', () => {
    expect(isPathWithinWorkspace('/home/user/my-project-extra', workspace)).toBe(false);
  });

  it('handles relative paths resolved against workspace', () => {
    // Relative path "src/foo.ts" resolves to workspace/src/foo.ts → inside
    expect(isPathWithinWorkspace('src/foo.ts', workspace)).toBe(true);
  });

  it('handles ../ escape attempts', () => {
    expect(isPathWithinWorkspace(`${workspace}/../../etc/passwd`, workspace)).toBe(false);
  });
});

// ── scanDestructiveCommandViolations() ────────────────────────────

describe('scanDestructiveCommandViolations()', () => {
  const workspace = '/home/user/my-project';

  it('returns empty array when stdout is empty', () => {
    expect(scanDestructiveCommandViolations('', workspace)).toEqual([]);
  });

  it('returns empty array when all rm targets are inside workspace', () => {
    const stdout = `rm -rf ${workspace}/old-build`;
    expect(scanDestructiveCommandViolations(stdout, workspace)).toEqual([]);
  });

  it('returns empty array when all mv targets are inside workspace', () => {
    const stdout = `mv ${workspace}/a.txt ${workspace}/b.txt`;
    expect(scanDestructiveCommandViolations(stdout, workspace)).toEqual([]);
  });

  it('detects rm targeting a path outside workspace', () => {
    const stdout = `rm -rf /tmp/some-file`;
    const violations = scanDestructiveCommandViolations(stdout, workspace);
    expect(violations.length).toBeGreaterThan(0);
    expect(violations[0].command).toBe('rm');
    expect(violations[0].path).toBe('/tmp/some-file');
  });

  it('detects mv targeting a path outside workspace', () => {
    const stdout = `mv /etc/hosts /etc/hosts.bak`;
    const violations = scanDestructiveCommandViolations(stdout, workspace);
    expect(violations.length).toBeGreaterThan(0);
    expect(violations[0].command).toBe('mv');
  });

  it('detects multiple violations in a single stdout blob', () => {
    const stdout = [`rm /etc/passwd`, `rm /var/log/app.log`].join('\n');
    const violations = scanDestructiveCommandViolations(stdout, workspace);
    expect(violations.length).toBe(2);
  });

  it('does not flag rm on workspace-internal path', () => {
    const stdout = `rm -f ${workspace}/dist/bundle.js`;
    const violations = scanDestructiveCommandViolations(stdout, workspace);
    expect(violations).toEqual([]);
  });
});
