import { app, BrowserWindow, ipcMain } from 'electron';
import path from 'path';
import { fileURLToPath } from 'url';

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

// IPC handlers for bridge control
ipcMain.handle('bridge:start', async () => {
  // Bridge process management handled by bridge-process.ts
  return { success: true };
});

ipcMain.handle('bridge:stop', async () => {
  return { success: true };
});

ipcMain.handle('bridge:status', async () => {
  return { status: 'stopped' };
});

ipcMain.handle('bridge:getConfig', async () => {
  return null;
});

ipcMain.handle('bridge:saveConfig', async (_event, config: unknown) => {
  void config;
  return { success: true };
});
