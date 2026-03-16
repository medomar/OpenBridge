import { describe, it, expect } from 'vitest';
import { getMasterTools } from '../../src/master/master-manager.js';
import { BUILT_IN_PROFILES } from '../../src/types/agent.js';

// OB-1586: getMasterTools() returns correct tool set based on trust level

describe('getMasterTools', () => {
  it('trusted level includes Bash(*)', () => {
    const tools = getMasterTools('trusted');
    expect(tools).toContain('Bash(*)');
  });

  it('trusted level returns full-access profile tools', () => {
    const tools = getMasterTools('trusted');
    expect(tools).toEqual([...BUILT_IN_PROFILES['full-access'].tools]);
  });

  it('sandbox level equals read-only tool set', () => {
    const tools = getMasterTools('sandbox');
    expect(tools).toEqual(['Read', 'Glob', 'Grep']);
  });

  it('sandbox level does not include Write or Edit', () => {
    const tools = getMasterTools('sandbox');
    expect(tools).not.toContain('Write');
    expect(tools).not.toContain('Edit');
  });

  it('sandbox level does not include Bash', () => {
    const tools = getMasterTools('sandbox');
    expect(tools.some((t) => t.startsWith('Bash'))).toBe(false);
  });

  it('standard level matches BUILT_IN_PROFILES.master.tools', () => {
    const tools = getMasterTools('standard');
    expect(tools).toEqual([...BUILT_IN_PROFILES.master.tools]);
  });

  it('standard level does not include Bash(*)', () => {
    const tools = getMasterTools('standard');
    expect(tools).not.toContain('Bash(*)');
  });

  it('standard level includes Write and Edit', () => {
    const tools = getMasterTools('standard');
    expect(tools).toContain('Write');
    expect(tools).toContain('Edit');
  });
});
