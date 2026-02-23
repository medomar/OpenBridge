import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Dirent } from 'node:fs';

// ── Mock node:os ────────────────────────────────────────────────────────

vi.mock('node:os', () => ({
  homedir: () => '/home/testuser',
}));

// ── Mock node:fs/promises ───────────────────────────────────────────────

const mockReaddir = vi.fn<() => Promise<Dirent[]>>();
const mockReadFile = vi.fn<() => Promise<string>>();

vi.mock('node:fs/promises', () => ({
  readdir: (...args: unknown[]) => mockReaddir(...args),
  readFile: (...args: unknown[]) => mockReadFile(...args),
}));

// Import after mocking
import { scanVSCodeExtensions } from '../../src/discovery/vscode-scanner.js';

// ── Helpers ─────────────────────────────────────────────────────────────

function makeDirent(name: string, isDir = true): Dirent {
  return {
    name,
    isDirectory: () => isDir,
    isFile: () => !isDir,
    isBlockDevice: () => false,
    isCharacterDevice: () => false,
    isFIFO: () => false,
    isSocket: () => false,
    isSymbolicLink: () => false,
  } as unknown as Dirent;
}

function makePackageJson(publisher: string, name: string, version: string): string {
  return JSON.stringify({ publisher, name, version });
}

// ── scanVSCodeExtensions ─────────────────────────────────────────────────

describe('scanVSCodeExtensions', () => {
  beforeEach(() => {
    mockReaddir.mockReset();
    mockReadFile.mockReset();
  });

  it('returns an empty array when extensions directory does not exist', async () => {
    mockReaddir.mockRejectedValue(new Error('ENOENT: no such file or directory'));
    const tools = await scanVSCodeExtensions();
    expect(tools).toEqual([]);
  });

  it('returns an empty array when directory is empty', async () => {
    mockReaddir.mockResolvedValue([]);
    const tools = await scanVSCodeExtensions();
    expect(tools).toEqual([]);
  });

  it('returns an empty array when no known AI extensions are installed', async () => {
    mockReaddir.mockResolvedValue([
      makeDirent('ms-python.python-2024.0.1'),
      makeDirent('esbenp.prettier-vscode-10.0.0'),
    ]);
    const tools = await scanVSCodeExtensions();
    expect(tools).toEqual([]);
  });

  it('discovers GitHub Copilot extension', async () => {
    mockReaddir.mockResolvedValue([makeDirent('github.copilot-1.123.0')]);
    mockReadFile.mockResolvedValue(makePackageJson('github', 'copilot', '1.123.0'));

    const tools = await scanVSCodeExtensions();
    expect(tools).toHaveLength(1);
    expect(tools[0]!.name).toBe('GitHub Copilot');
    expect(tools[0]!.version).toBe('1.123.0');
    expect(tools[0]!.available).toBe(true);
    expect(tools[0]!.role).toBe('none');
    expect(tools[0]!.capabilities).toContain('code-completion');
    expect(tools[0]!.capabilities).toContain('code-generation');
    expect(tools[0]!.capabilities).toContain('chat');
  });

  it('discovers GitHub Copilot Chat extension', async () => {
    mockReaddir.mockResolvedValue([makeDirent('github.copilot-chat-0.22.0')]);
    // github.copilot-chat-0.22.0 starts with both 'github.copilot' and 'github.copilot-chat'
    // readFile is called twice: once for each matching prefix
    mockReadFile.mockResolvedValue(makePackageJson('github', 'copilot-chat', '0.22.0'));

    const tools = await scanVSCodeExtensions();
    // Both 'github.copilot' and 'github.copilot-chat' match — 2 entries produced
    const chatTool = tools.find((t) => t.name === 'GitHub Copilot Chat');
    expect(chatTool).toBeDefined();
    expect(chatTool!.capabilities).toContain('chat');
    expect(chatTool!.capabilities).toContain('code-generation');
    expect(chatTool!.capabilities).toContain('code-explanation');
  });

  it('discovers Cody extension (sourcegraph)', async () => {
    mockReaddir.mockResolvedValue([makeDirent('sourcegraph.cody-ai-5.6.0')]);
    mockReadFile.mockResolvedValue(makePackageJson('sourcegraph', 'cody-ai', '5.6.0'));

    const tools = await scanVSCodeExtensions();
    expect(tools).toHaveLength(1);
    expect(tools[0]!.name).toBe('Cody');
    expect(tools[0]!.capabilities).toContain('code-completion');
    expect(tools[0]!.capabilities).toContain('code-search');
  });

  it('discovers Continue extension', async () => {
    mockReaddir.mockResolvedValue([makeDirent('continue.continue-0.9.200')]);
    mockReadFile.mockResolvedValue(makePackageJson('continue', 'continue', '0.9.200'));

    const tools = await scanVSCodeExtensions();
    expect(tools).toHaveLength(1);
    expect(tools[0]!.name).toBe('Continue');
    expect(tools[0]!.capabilities).toContain('refactoring');
  });

  it('discovers Amazon Q extension', async () => {
    mockReaddir.mockResolvedValue([makeDirent('amazonwebservices.amazon-q-vscode-1.8.0')]);
    mockReadFile.mockResolvedValue(
      makePackageJson('amazonwebservices', 'amazon-q-vscode', '1.8.0'),
    );

    const tools = await scanVSCodeExtensions();
    expect(tools).toHaveLength(1);
    expect(tools[0]!.name).toBe('Amazon Q');
  });

  it('discovers multiple extensions when several are installed', async () => {
    mockReaddir.mockResolvedValue([
      makeDirent('github.copilot-1.100.0'),
      makeDirent('continue.continue-0.8.0'),
    ]);
    mockReadFile
      .mockResolvedValueOnce(makePackageJson('github', 'copilot', '1.100.0'))
      .mockResolvedValueOnce(makePackageJson('continue', 'continue', '0.8.0'));

    const tools = await scanVSCodeExtensions();
    expect(tools).toHaveLength(2);
    const names = tools.map((t) => t.name);
    expect(names).toContain('GitHub Copilot');
    expect(names).toContain('Continue');
  });

  it('skips non-directory entries', async () => {
    mockReaddir.mockResolvedValue([
      makeDirent('github.copilot-1.0.0', false), // file, not dir
    ]);

    const tools = await scanVSCodeExtensions();
    expect(tools).toEqual([]);
  });

  it('skips extension when package.json is missing (readFile throws)', async () => {
    mockReaddir.mockResolvedValue([makeDirent('github.copilot-1.0.0')]);
    mockReadFile.mockRejectedValue(new Error('ENOENT: package.json not found'));

    const tools = await scanVSCodeExtensions();
    expect(tools).toEqual([]);
  });

  it('skips extension when package.json has invalid JSON', async () => {
    mockReaddir.mockResolvedValue([makeDirent('github.copilot-1.0.0')]);
    mockReadFile.mockResolvedValue('not valid json {{{');

    const tools = await scanVSCodeExtensions();
    expect(tools).toEqual([]);
  });

  it('skips extension when package.json is missing required fields', async () => {
    mockReaddir.mockResolvedValue([makeDirent('github.copilot-1.0.0')]);
    mockReadFile.mockResolvedValue(JSON.stringify({ name: 'copilot' })); // missing publisher + version

    const tools = await scanVSCodeExtensions();
    expect(tools).toEqual([]);
  });

  it('uses correct extensions path (~/.vscode/extensions)', async () => {
    mockReaddir.mockResolvedValue([]);

    await scanVSCodeExtensions();

    expect(mockReaddir).toHaveBeenCalledWith(
      '/home/testuser/.vscode/extensions',
      expect.objectContaining({ withFileTypes: true }),
    );
  });

  it('sets role to "none" for all discovered VS Code extensions', async () => {
    mockReaddir.mockResolvedValue([makeDirent('github.copilot-1.0.0')]);
    mockReadFile.mockResolvedValue(makePackageJson('github', 'copilot', '1.0.0'));

    const tools = await scanVSCodeExtensions();
    expect(tools[0]!.role).toBe('none');
  });

  it('includes the correct extension path in the result', async () => {
    mockReaddir.mockResolvedValue([makeDirent('github.copilot-1.0.0')]);
    mockReadFile.mockResolvedValue(makePackageJson('github', 'copilot', '1.0.0'));

    const tools = await scanVSCodeExtensions();
    expect(tools[0]!.path).toBe('/home/testuser/.vscode/extensions/github.copilot-1.0.0');
  });

  it('handles extensions with no version in package.json gracefully', async () => {
    mockReaddir.mockResolvedValue([makeDirent('github.copilot-1.0.0')]);
    // version is a number (not a string) — should fall back to 'unknown'
    mockReadFile.mockResolvedValue(
      JSON.stringify({ publisher: 'github', name: 'copilot', version: 42 }),
    );

    const tools = await scanVSCodeExtensions();
    // publisher + name present but version is not a string → falls back to 'unknown'
    expect(tools[0]!.version).toBe('unknown');
  });

  it('ignores directories not matching any known extension prefix', async () => {
    mockReaddir.mockResolvedValue([
      makeDirent('ms-vscode.remote-ssh-0.109.2020121515'),
      makeDirent('github.copilot-1.100.0'),
    ]);
    mockReadFile.mockResolvedValue(makePackageJson('github', 'copilot', '1.100.0'));

    const tools = await scanVSCodeExtensions();
    expect(tools).toHaveLength(1);
    expect(tools[0]!.name).toBe('GitHub Copilot');
  });
});
