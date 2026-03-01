import '@testing-library/jest-dom';

// ---------------------------------------------------------------------------
// Global window.openbridge mock for all UI tests.
// Each method returns a sensible default; individual tests can override with
// .mockResolvedValueOnce() / .mockReturnValueOnce() as needed.
//
// Guard: this setup file is loaded in all environments. In the Node.js
// environment used for Electron tests, window is not defined — skip setup.
// ---------------------------------------------------------------------------

if (typeof window === 'undefined') {
  // Node / Electron test environment — nothing to set up here.
  // Suppress TypeScript "unused variable" warning for afterEach below.
} else {
  Object.defineProperty(window, 'openbridge', {
    writable: true,
    value: {
      detectPrerequisites: vi.fn().mockResolvedValue({
        os: 'macOS',
        nodeVersion: 'v22.0.0',
        nodeOk: true,
      }),
      detectInstalledTools: vi.fn().mockResolvedValue({ claude: true, codex: false }),
      installAiTool: vi.fn().mockResolvedValue({ success: true }),
      authenticateTool: vi.fn().mockResolvedValue({ success: true }),
      selectDirectory: vi.fn().mockResolvedValue({ path: '/selected/path' }),
      validateDirectory: vi.fn().mockResolvedValue({ valid: true }),
      getHomeDirectory: vi.fn().mockResolvedValue('/home/user'),
      getConfig: vi.fn().mockResolvedValue({
        workspacePath: '/test/project',
        channels: [{ type: 'whatsapp', enabled: true }],
      }),
      startBridge: vi.fn().mockResolvedValue({ success: true }),
      stopBridge: vi.fn().mockResolvedValue({ success: true }),
      getBridgeStatus: vi.fn().mockResolvedValue({ status: 'stopped' }),
      saveConfig: vi.fn().mockResolvedValue({ success: true }),
      onBridgeLog: vi.fn(),
      onWorkerUpdate: vi.fn(),
      onMessageReceived: vi.fn(),
      mcpGetServers: vi.fn().mockResolvedValue({ servers: [] }),
      mcpAddServer: vi.fn().mockResolvedValue({ success: true }),
      mcpToggleServer: vi.fn().mockResolvedValue({ success: true }),
      mcpRemoveServer: vi.fn().mockResolvedValue({ success: true }),
      mcpGetCatalog: vi.fn().mockResolvedValue({ entries: [] }),
      mcpConnectFromCatalog: vi.fn().mockResolvedValue({ success: true }),
      accessList: vi.fn().mockResolvedValue({ entries: [] }),
      accessAdd: vi.fn().mockResolvedValue({ success: true }),
      accessRemove: vi.fn().mockResolvedValue({ success: true }),
    },
  });

  // Clear call history between tests but keep default implementations.
  afterEach(() => {
    vi.clearAllMocks();
  });
} // end typeof window !== 'undefined' guard
