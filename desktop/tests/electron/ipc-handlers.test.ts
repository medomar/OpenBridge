// @vitest-environment node
/**
 * Unit tests for Electron IPC handlers (main.ts).
 *
 * Strategy: mock every dependency of main.ts so the module can be imported
 * without a real Electron runtime. ipcMain.handle is replaced by a spy that
 * stores each registered handler in `ipcHandlers` keyed by channel name.
 * Tests then call those handlers directly.
 */
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Mock } from 'vitest';

// ---------------------------------------------------------------------------
// Shared mutable mock references — created with vi.hoisted so they are
// available inside vi.mock() factories (which are hoisted before imports).
// ---------------------------------------------------------------------------

const mockExecAsync = vi.hoisted(() => vi.fn().mockResolvedValue({ stdout: '', stderr: '' }));

const mockBridgeProcess = vi.hoisted(() => ({
  start: vi.fn(),
  stop: vi.fn().mockResolvedValue(undefined),
  getStatus: vi.fn<[], string>().mockReturnValue('stopped'),
  onStatusChange: vi.fn(),
  onMessageReceived: vi.fn(),
}));

/** All IPC handlers registered by main.ts, keyed by channel name. */
const ipcHandlers: Record<string, (...args: unknown[]) => unknown> = {};

// ---------------------------------------------------------------------------
// Module mocks — must be declared before any imports from those modules.
// ---------------------------------------------------------------------------

vi.mock('electron', () => ({
  app: {
    whenReady: vi.fn().mockResolvedValue(undefined),
    on: vi.fn(),
    getPath: vi.fn().mockReturnValue('/fake/userData'),
    quit: vi.fn(),
    dock: { setBadge: vi.fn() },
  },
  BrowserWindow: Object.assign(
    vi.fn().mockImplementation(() => ({
      loadURL: vi.fn(),
      loadFile: vi.fn(),
      webContents: { openDevTools: vi.fn() },
      on: vi.fn(),
      once: vi.fn(),
      show: vi.fn(),
      hide: vi.fn(),
      isVisible: vi.fn().mockReturnValue(true),
      isFocused: vi.fn().mockReturnValue(true),
    })),
    { getAllWindows: vi.fn().mockReturnValue([]) },
  ),
  dialog: {
    showOpenDialog: vi.fn().mockResolvedValue({ canceled: false, filePaths: ['/selected/dir'] }),
    showMessageBox: vi.fn().mockResolvedValue({ response: 0 }),
  },
  ipcMain: {
    handle: vi
      .fn()
      .mockImplementation((channel: string, handler: (...args: unknown[]) => unknown) => {
        ipcHandlers[channel] = handler;
      }),
  },
  Notification: vi.fn().mockImplementation(() => ({ show: vi.fn() })),
}));

vi.mock('electron-updater', () => ({
  autoUpdater: {
    on: vi.fn(),
    checkForUpdatesAndNotify: vi.fn().mockResolvedValue(undefined),
  },
}));

vi.mock('../../electron/bridge-process.js', () => ({
  bridgeProcess: mockBridgeProcess,
}));

vi.mock('../../electron/tray.js', () => ({
  trayManager: { init: vi.fn(), update: vi.fn(), destroy: vi.fn() },
}));

// Replace promisify so that `const execAsync = promisify(exec)` in main.ts
// resolves to our controllable mock function.
vi.mock('util', async (importOriginal) => {
  const actual = await importOriginal<typeof import('util')>();
  return { ...actual, promisify: () => mockExecAsync };
});

vi.mock('fs/promises', () => ({
  access: vi.fn().mockResolvedValue(undefined),
  readFile: vi.fn().mockResolvedValue('{"workspacePath":"/test"}'),
  writeFile: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('fs', () => ({
  existsSync: vi.fn().mockReturnValue(true),
}));

vi.mock('os', () => ({
  default: { homedir: () => '/home/testuser' },
}));

// ---------------------------------------------------------------------------
// Import main.ts — this runs the module's top-level code, which registers
// all IPC handlers via ipcMain.handle (captured in ipcHandlers above).
// ---------------------------------------------------------------------------
beforeAll(async () => {
  process.env['NODE_ENV'] = 'development'; // skip auto-updater branch
  await import('../../electron/main.js');
});

beforeEach(async () => {
  vi.clearAllMocks();
  // Restore default return values cleared by clearAllMocks
  mockBridgeProcess.getStatus.mockReturnValue('stopped');
  mockBridgeProcess.stop.mockResolvedValue(undefined);
  mockExecAsync.mockResolvedValue({ stdout: '', stderr: '' });
  const fsp = await import('fs/promises');
  (fsp.readFile as Mock).mockResolvedValue('{"workspacePath":"/test"}');
  (fsp.access as Mock).mockResolvedValue(undefined);
  (fsp.writeFile as Mock).mockResolvedValue(undefined);
  const fsm = await import('fs');
  (fsm.existsSync as Mock).mockReturnValue(true);
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function call(channel: string, ...args: unknown[]): Promise<unknown> {
  const handler = ipcHandlers[channel];
  if (!handler) throw new Error(`Handler not registered: ${channel}`);
  // Electron passes the event as the first arg; handlers that ignore it use _event.
  return handler(null, ...args);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('IPC handlers', () => {
  // --- setup:detectPrerequisites ---

  it('detectPrerequisites returns nodeOk:true for Node >= 22', async () => {
    const result = await call('setup:detectPrerequisites');
    const r = result as { os: string; nodeVersion: string; nodeOk: boolean };
    const major = parseInt(process.version.slice(1).split('.')[0] ?? '0', 10);
    expect(r.nodeOk).toBe(major >= 22);
    expect(typeof r.os).toBe('string');
    expect(r.nodeVersion).toBe(process.version);
  });

  it('detectPrerequisites maps darwin platform to macOS', async () => {
    const orig = process.platform;
    Object.defineProperty(process, 'platform', { value: 'darwin', configurable: true });
    const result = (await call('setup:detectPrerequisites')) as { os: string };
    expect(result.os).toBe('macOS');
    Object.defineProperty(process, 'platform', { value: orig, configurable: true });
  });

  it('detectPrerequisites maps win32 platform to Windows', async () => {
    const orig = process.platform;
    Object.defineProperty(process, 'platform', { value: 'win32', configurable: true });
    const result = (await call('setup:detectPrerequisites')) as { os: string };
    expect(result.os).toBe('Windows');
    Object.defineProperty(process, 'platform', { value: orig, configurable: true });
  });

  // --- setup:installAiTool ---

  it('installAiTool calls npm install -g for claude', async () => {
    mockExecAsync.mockResolvedValueOnce({ stdout: '', stderr: '' });
    const result = (await call('setup:installAiTool', 'claude')) as {
      success: boolean;
    };
    expect(result.success).toBe(true);
    expect(mockExecAsync).toHaveBeenCalledWith(
      expect.stringContaining('@anthropic-ai/claude-code'),
      expect.any(Object),
    );
  });

  it('installAiTool calls npm install -g for codex', async () => {
    mockExecAsync.mockResolvedValueOnce({ stdout: '', stderr: '' });
    const result = (await call('setup:installAiTool', 'codex')) as {
      success: boolean;
    };
    expect(result.success).toBe(true);
    expect(mockExecAsync).toHaveBeenCalledWith(
      expect.stringContaining('@openai/codex'),
      expect.any(Object),
    );
  });

  it('installAiTool returns error for unknown tool', async () => {
    const result = (await call('setup:installAiTool', 'unknown-tool')) as {
      success: boolean;
      error: string;
    };
    expect(result.success).toBe(false);
    expect(result.error).toBe('Unknown tool');
  });

  it('installAiTool returns error when npm install fails', async () => {
    mockExecAsync.mockRejectedValueOnce(new Error('Permission denied'));
    const result = (await call('setup:installAiTool', 'claude')) as {
      success: boolean;
      error: string;
    };
    expect(result.success).toBe(false);
    expect(result.error).toContain('Permission denied');
  });

  // --- setup:validateDirectory ---

  it('validateDirectory returns valid:true for accessible directory', async () => {
    const { access } = await import('fs/promises');
    (access as Mock).mockResolvedValueOnce(undefined);
    const result = (await call('setup:validateDirectory', '/valid/path')) as {
      valid: boolean;
    };
    expect(result.valid).toBe(true);
  });

  it('validateDirectory returns valid:false with error for inaccessible directory', async () => {
    const { access } = await import('fs/promises');
    (access as Mock).mockRejectedValueOnce(new Error('ENOENT: no such file or directory'));
    const result = (await call('setup:validateDirectory', '/bad/path')) as {
      valid: boolean;
      error: string;
    };
    expect(result.valid).toBe(false);
    expect(result.error).toContain('ENOENT');
  });

  // --- setup:getHomeDirectory ---

  it('getHomeDirectory returns the home directory', async () => {
    const result = await call('setup:getHomeDirectory');
    expect(result).toBe('/home/testuser');
  });

  // --- bridge:start / stop / status ---

  it('bridge:start calls bridgeProcess.start and returns success', async () => {
    const result = (await call('bridge:start')) as { success: boolean };
    expect(mockBridgeProcess.start).toHaveBeenCalled();
    expect(result.success).toBe(true);
  });

  it('bridge:stop calls bridgeProcess.stop and returns success', async () => {
    const result = (await call('bridge:stop')) as { success: boolean };
    expect(mockBridgeProcess.stop).toHaveBeenCalled();
    expect(result.success).toBe(true);
  });

  it('bridge:status returns current bridge status', async () => {
    mockBridgeProcess.getStatus.mockReturnValue('running');
    const result = (await call('bridge:status')) as { status: string };
    expect(result.status).toBe('running');
  });

  it('bridge:status returns stopped when bridge is stopped', async () => {
    mockBridgeProcess.getStatus.mockReturnValue('stopped');
    const result = (await call('bridge:status')) as { status: string };
    expect(result.status).toBe('stopped');
  });

  // --- bridge:getConfig / saveConfig ---

  it('bridge:getConfig reads and parses config file', async () => {
    const { readFile } = await import('fs/promises');
    (readFile as Mock).mockResolvedValueOnce('{"workspacePath":"/my-project","channels":[]}');
    const result = (await call('bridge:getConfig')) as {
      workspacePath: string;
      channels: unknown[];
    };
    expect(result.workspacePath).toBe('/my-project');
    expect(result.channels).toEqual([]);
  });

  it('bridge:getConfig returns null when file is missing', async () => {
    const { readFile } = await import('fs/promises');
    (readFile as Mock).mockRejectedValueOnce(new Error('ENOENT'));
    const result = await call('bridge:getConfig');
    expect(result).toBeNull();
  });

  it('bridge:saveConfig writes config JSON to file', async () => {
    const { writeFile } = await import('fs/promises');
    (writeFile as Mock).mockResolvedValueOnce(undefined);
    const config = { workspacePath: '/new/path', channels: [] };
    const result = (await call('bridge:saveConfig', config)) as { success: boolean };
    expect(result.success).toBe(true);
    expect(writeFile).toHaveBeenCalledWith(
      expect.stringContaining('config.json'),
      expect.stringContaining('/new/path'),
      'utf-8',
    );
  });

  it('bridge:saveConfig returns error when write fails', async () => {
    const { writeFile } = await import('fs/promises');
    (writeFile as Mock).mockRejectedValueOnce(new Error('Disk full'));
    const result = (await call('bridge:saveConfig', {})) as {
      success: boolean;
      error: string;
    };
    expect(result.success).toBe(false);
    expect(result.error).toContain('Disk full');
  });

  // --- access:list (parseAccessTable logic) ---

  it('access:list parses ASCII table rows into structured entries', async () => {
    mockExecAsync.mockResolvedValueOnce({
      stdout: [
        '| User ID     | Channel  | Role   | Active |',
        '| +1234567890 | whatsapp | admin  | yes    |',
        '| +9876543210 | telegram | viewer | no     |',
      ].join('\n'),
      stderr: '',
    });
    const result = (await call('access:list')) as {
      entries: Array<{ user_id: string; channel: string; role: string; active: boolean }>;
    };
    expect(result.entries).toHaveLength(2);
    expect(result.entries[0]).toMatchObject({
      user_id: '+1234567890',
      channel: 'whatsapp',
      role: 'admin',
      active: true,
    });
    expect(result.entries[1]).toMatchObject({
      user_id: '+9876543210',
      channel: 'telegram',
      role: 'viewer',
      active: false,
    });
  });

  it('access:list returns empty entries for "(no entries)" output', async () => {
    mockExecAsync.mockResolvedValueOnce({
      stdout: '(no entries)',
      stderr: '',
    });
    const result = (await call('access:list')) as { entries: unknown[] };
    expect(result.entries).toEqual([]);
  });

  it('access:list returns bridgeNotInitialized when DB not found', async () => {
    mockExecAsync.mockRejectedValueOnce(new Error('Database not found'));
    const result = (await call('access:list')) as { bridgeNotInitialized?: boolean };
    expect(result.bridgeNotInitialized).toBe(true);
  });

  it('access:list returns error when CLI not built', async () => {
    const { existsSync } = await import('fs');
    (existsSync as Mock).mockReturnValueOnce(false);
    const result = (await call('access:list')) as { error: string };
    expect(result.error).toContain('not built yet');
  });
});
