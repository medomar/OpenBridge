import { access, readFile, writeFile } from 'fs/promises';
import { existsSync } from 'fs';
import { exec } from 'child_process';
import nodeOs from 'os';
import { promisify } from 'util';
import { app, BrowserWindow, dialog, ipcMain, Notification } from 'electron';
import { autoUpdater } from 'electron-updater';
import path from 'path';
import { fileURLToPath } from 'url';
import { bridgeProcess, type MessageEvent } from './bridge-process.js';
import { trayManager } from './tray.js';

const execAsync = promisify(exec);

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const isDev = process.env.NODE_ENV === 'development';

let mainWindow: BrowserWindow | null = null;
let isQuitting = false;
let hasShownMinimizeNotification = false;
let unreadCount = 0;

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 900,
    minHeight: 600,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js'),
    },
    title: 'OpenBridge',
    show: false,
  });

  if (isDev) {
    mainWindow.loadURL('http://localhost:5173');
    mainWindow.webContents.openDevTools();
  } else {
    mainWindow.loadFile(path.join(__dirname, '../ui/dist/index.html'));
  }

  mainWindow.once('ready-to-show', () => {
    mainWindow?.show();
  });

  // Minimize-to-tray: intercept the close event and hide the window instead
  // of destroying it. Only allow the window to actually close when isQuitting
  // is true (set by app.on('before-quit'), triggered from the tray Quit item
  // or Cmd+Q / system quit).
  mainWindow.on('close', (e) => {
    if (!isQuitting) {
      e.preventDefault();
      mainWindow?.hide();
      if (!hasShownMinimizeNotification) {
        hasShownMinimizeNotification = true;
        new Notification({
          title: 'OpenBridge',
          body: 'OpenBridge is still running in the background.',
        }).show();
      }
    }
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  // Clear the unread badge when the user opens/focuses the window.
  mainWindow.on('focus', () => {
    if (unreadCount > 0) {
      unreadCount = 0;
      if (process.platform === 'darwin' && app.dock) {
        app.dock.setBadge('');
      }
    }
  });
}

// Set isQuitting before any windows close so the 'close' handler lets them through.
app.on('before-quit', () => {
  isQuitting = true;
});

app.whenReady().then(() => {
  createWindow();

  trayManager.init(() => mainWindow);
  bridgeProcess.onStatusChange((status) => {
    trayManager.update(status);
  });

  // Show OS notification and increment dock badge when a message arrives while
  // the window is hidden or not focused. Badge is cleared on window focus.
  bridgeProcess.onMessageReceived((event: MessageEvent) => {
    const win = mainWindow;
    if (!win || !win.isVisible() || !win.isFocused()) {
      unreadCount++;
      new Notification({
        title: 'OpenBridge',
        body: `New message from ${event.sender} via ${event.channel}`,
      }).show();
      if (process.platform === 'darwin' && app.dock) {
        app.dock.setBadge(String(unreadCount));
      }
    }
  });

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });

  // ---------------------------------------------------------------------------
  // Auto-updater — macOS + Windows. Linux AppImage requires manual update.
  // Update feed is configured in desktop/electron-builder.yml (provider: github).
  // Only runs in production builds — skipped in dev mode.
  // ---------------------------------------------------------------------------
  if (!isDev) {
    autoUpdater.on('update-available', () => {
      new Notification({
        title: 'OpenBridge',
        body: 'Update available — downloading...',
      }).show();
    });

    autoUpdater.on('update-downloaded', () => {
      const win = mainWindow;
      const showDialog = win
        ? dialog.showMessageBox(win, {
            type: 'info',
            title: 'OpenBridge',
            message: 'Update ready — restart to apply',
            buttons: ['Restart Now', 'Later'],
            defaultId: 0,
            cancelId: 1,
          })
        : dialog.showMessageBox({
            type: 'info',
            title: 'OpenBridge',
            message: 'Update ready — restart to apply',
            buttons: ['Restart Now', 'Later'],
            defaultId: 0,
            cancelId: 1,
          });

      showDialog
        .then(({ response }) => {
          if (response === 0) autoUpdater.quitAndInstall();
        })
        .catch(() => {});
    });

    autoUpdater.checkForUpdatesAndNotify().catch(() => {
      // Non-fatal — silently ignore network or config errors during update check.
    });
  }
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

// IPC handlers for setup wizard
ipcMain.handle('setup:detectPrerequisites', async () => {
  const platform = process.platform;
  const os = platform === 'darwin' ? 'macOS' : platform === 'win32' ? 'Windows' : platform;
  const nodeVersion = process.version;
  const match = /^v(\d+)/.exec(nodeVersion);
  const major = match ? parseInt(match[1], 10) : 0;
  return { os, nodeVersion, nodeOk: major >= 22 };
});

// IPC handlers for AI tool detection and installation
ipcMain.handle('setup:detectInstalledTools', async () => {
  const whichCmd = process.platform === 'win32' ? 'where' : 'which';

  const checkTool = async (cmd: string): Promise<boolean> => {
    try {
      await execAsync(`${whichCmd} ${cmd}`);
      return true;
    } catch {
      return false;
    }
  };

  const [claude, codex] = await Promise.all([checkTool('claude'), checkTool('codex')]);
  return { claude, codex };
});

ipcMain.handle('setup:installAiTool', async (_event, tool: string) => {
  const packageMap: Record<string, string> = {
    claude: '@anthropic-ai/claude-code',
    codex: '@openai/codex',
  };
  const pkg = packageMap[tool];
  if (!pkg) return { success: false, error: 'Unknown tool' };

  try {
    await execAsync(`npm install -g ${pkg}`, { timeout: 180_000 });
    return { success: true };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return { success: false, error: message };
  }
});

ipcMain.handle('setup:authenticateTool', async (_event, tool: string) => {
  const commandMap: Record<string, string> = {
    claude: 'claude auth login',
    codex: 'codex login',
  };
  const cmd = commandMap[tool];
  if (!cmd) return { success: false, error: 'Unknown tool' };

  try {
    await execAsync(cmd, { timeout: 120_000 });
    return { success: true };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return { success: false, error: message };
  }
});

ipcMain.handle('setup:selectDirectory', async () => {
  const result = await dialog.showOpenDialog({ properties: ['openDirectory'] });
  if (result.canceled || result.filePaths.length === 0) return { path: null };
  return { path: result.filePaths[0] };
});

ipcMain.handle('setup:validateDirectory', async (_event, dirPath: string) => {
  try {
    await access(dirPath);
    return { valid: true };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return { valid: false, error: message };
  }
});

ipcMain.handle('setup:getHomeDirectory', () => nodeOs.homedir());

function getConfigFilePath(): string {
  return path.join(app.getPath('userData'), 'config.json');
}

// IPC handlers for bridge control
ipcMain.handle('bridge:start', async () => {
  try {
    bridgeProcess.start(getConfigFilePath());
    return { success: true };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return { success: false, error: message };
  }
});

ipcMain.handle('bridge:stop', async () => {
  try {
    await bridgeProcess.stop();
    return { success: true };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return { success: false, error: message };
  }
});

ipcMain.handle('bridge:status', async () => {
  return { status: bridgeProcess.getStatus() };
});

ipcMain.handle('bridge:getConfig', async () => {
  try {
    const raw = await readFile(getConfigFilePath(), 'utf-8');
    return JSON.parse(raw) as unknown;
  } catch {
    return null;
  }
});

ipcMain.handle('bridge:saveConfig', async (_event, config: unknown) => {
  try {
    const configPath = getConfigFilePath();
    await writeFile(configPath, JSON.stringify(config, null, 2), 'utf-8');
    return { success: true };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return { success: false, error: message };
  }
});

// ---------------------------------------------------------------------------
// MCP IPC handlers — proxy calls to the bridge's REST API (/api/mcp/*)
// ---------------------------------------------------------------------------

async function getBridgeBaseUrl(): Promise<string> {
  try {
    const raw = await readFile(getConfigFilePath(), 'utf-8');
    const config = JSON.parse(raw) as unknown;
    if (config && typeof config === 'object') {
      const channels = (config as Record<string, unknown>).channels;
      if (Array.isArray(channels)) {
        const webchat = channels.find(
          (c: unknown) =>
            typeof c === 'object' &&
            c !== null &&
            (c as Record<string, unknown>).type === 'webchat',
        );
        if (webchat && typeof webchat === 'object') {
          const opts = (webchat as Record<string, unknown>).options;
          if (opts && typeof opts === 'object') {
            const port = (opts as Record<string, unknown>).port;
            if (typeof port === 'number') return `http://localhost:${port}`;
          }
        }
      }
    }
  } catch {
    // fall through to default
  }
  return 'http://localhost:3000';
}

ipcMain.handle('mcp:getServers', async () => {
  const base = await getBridgeBaseUrl();
  try {
    const res = await fetch(`${base}/api/mcp/servers`);
    if (!res.ok) return { servers: [] };
    const servers = (await res.json()) as unknown;
    return { servers: Array.isArray(servers) ? servers : [] };
  } catch {
    return { bridgeOffline: true };
  }
});

ipcMain.handle('mcp:addServer', async (_event, body: unknown) => {
  const base = await getBridgeBaseUrl();
  try {
    const res = await fetch(`${base}/api/mcp/servers`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const err = (await res.json().catch(() => ({}))) as Record<string, unknown>;
      return { success: false, error: (err['error'] as string | undefined) ?? 'Request failed' };
    }
    return { success: true };
  } catch {
    return { success: false, error: 'Bridge is not running.' };
  }
});

ipcMain.handle('mcp:toggleServer', async (_event, name: string, enabled: boolean) => {
  const base = await getBridgeBaseUrl();
  try {
    const res = await fetch(`${base}/api/mcp/servers/${encodeURIComponent(name)}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ enabled }),
    });
    if (!res.ok) return { success: false, error: 'Request failed' };
    return { success: true };
  } catch {
    return { success: false, error: 'Bridge is not running.' };
  }
});

ipcMain.handle('mcp:removeServer', async (_event, name: string) => {
  const base = await getBridgeBaseUrl();
  try {
    const res = await fetch(`${base}/api/mcp/servers/${encodeURIComponent(name)}`, {
      method: 'DELETE',
    });
    if (!res.ok) return { success: false, error: 'Request failed' };
    return { success: true };
  } catch {
    return { success: false, error: 'Bridge is not running.' };
  }
});

ipcMain.handle('mcp:getCatalog', async () => {
  const base = await getBridgeBaseUrl();
  try {
    const res = await fetch(`${base}/api/mcp/catalog`);
    if (!res.ok) return { entries: [] };
    const entries = (await res.json()) as unknown;
    return { entries: Array.isArray(entries) ? entries : [] };
  } catch {
    return { entries: [] };
  }
});

ipcMain.handle('mcp:connectFromCatalog', async (_event, name: string, envVars: unknown) => {
  const base = await getBridgeBaseUrl();
  try {
    const res = await fetch(`${base}/api/mcp/catalog/${encodeURIComponent(name)}/connect`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ envVars }),
    });
    if (!res.ok) {
      const err = (await res.json().catch(() => ({}))) as Record<string, unknown>;
      return { success: false, error: (err['error'] as string | undefined) ?? 'Request failed' };
    }
    return { success: true };
  } catch {
    return { success: false, error: 'Bridge is not running.' };
  }
});

// ---------------------------------------------------------------------------
// Access control IPC handlers — proxy to `openbridge access` CLI
// ---------------------------------------------------------------------------

interface AccessEntry {
  user_id: string;
  channel: string;
  role: string;
  active: boolean;
}

/**
 * Parse the formatted ASCII table output of `openbridge access list` into
 * structured objects. Lines starting with `|` are data rows; the header row
 * is detected by checking if the first cell equals "User ID".
 */
function parseAccessTable(output: string): AccessEntry[] {
  const entries: AccessEntry[] = [];
  if (output.includes('(no entries)')) return entries;

  for (const line of output.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed.startsWith('|')) continue;
    const cols = trimmed
      .split('|')
      .map((s) => s.trim())
      .filter((s) => s.length > 0);
    if (cols.length < 4) continue;
    if (cols[0] === 'User ID') continue; // header row
    entries.push({
      user_id: cols[0] ?? '',
      channel: cols[1] ?? '',
      role: cols[2] ?? 'viewer',
      active: (cols[3] ?? 'yes') === 'yes',
    });
  }
  return entries;
}

function getCliPath(): string {
  return path.resolve(__dirname, '../../dist/cli/index.js');
}

function getConfigDir(): string {
  return path.dirname(getConfigFilePath());
}

ipcMain.handle('access:list', async () => {
  const cliPath = getCliPath();
  const configDir = getConfigDir();
  if (!existsSync(cliPath)) {
    return { error: 'Bridge not built yet — run `npm run build` to compile the CLI.' };
  }
  try {
    const { stdout } = await execAsync(`node "${cliPath}" access list`, { cwd: configDir });
    const entries = parseAccessTable(stdout);
    return { entries };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    if (message.includes('not found') || message.includes('Database not found')) {
      return { bridgeNotInitialized: true };
    }
    return { error: message };
  }
});

ipcMain.handle('access:add', async (_event, userId: string, role: string, channel: string) => {
  const cliPath = getCliPath();
  const configDir = getConfigDir();
  if (!existsSync(cliPath)) {
    return { success: false, error: 'Bridge not built yet — run `npm run build` first.' };
  }
  try {
    await execAsync(
      `node "${cliPath}" access add "${userId}" --role "${role}" --channel "${channel}"`,
      { cwd: configDir },
    );
    return { success: true };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return { success: false, error: message };
  }
});

ipcMain.handle('access:remove', async (_event, userId: string, channel: string) => {
  const cliPath = getCliPath();
  const configDir = getConfigDir();
  if (!existsSync(cliPath)) {
    return { success: false, error: 'Bridge not built yet — run `npm run build` first.' };
  }
  try {
    await execAsync(`node "${cliPath}" access remove "${userId}" --channel "${channel}"`, {
      cwd: configDir,
    });
    return { success: true };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return { success: false, error: message };
  }
});
