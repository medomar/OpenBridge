import { access, readFile, writeFile } from 'fs/promises';
import { exec } from 'child_process';
import nodeOs from 'os';
import { promisify } from 'util';
import { app, BrowserWindow, dialog, ipcMain } from 'electron';
import path from 'path';
import { fileURLToPath } from 'url';
import { bridgeProcess } from './bridge-process.js';

const execAsync = promisify(exec);

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const isDev = process.env.NODE_ENV === 'development';

let mainWindow: BrowserWindow | null = null;

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

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

app.whenReady().then(() => {
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
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
