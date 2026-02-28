import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('openbridge', {
  detectPrerequisites: (): Promise<{ os: string; nodeVersion: string; nodeOk: boolean }> =>
    ipcRenderer.invoke('setup:detectPrerequisites'),

  detectInstalledTools: (): Promise<{ claude: boolean; codex: boolean }> =>
    ipcRenderer.invoke('setup:detectInstalledTools'),

  installAiTool: (tool: 'claude' | 'codex'): Promise<{ success: boolean; error?: string }> =>
    ipcRenderer.invoke('setup:installAiTool', tool),

  authenticateTool: (tool: 'claude' | 'codex'): Promise<{ success: boolean; error?: string }> =>
    ipcRenderer.invoke('setup:authenticateTool', tool),

  startBridge: (): Promise<{ success: boolean }> => ipcRenderer.invoke('bridge:start'),

  stopBridge: (): Promise<{ success: boolean }> => ipcRenderer.invoke('bridge:stop'),

  getBridgeStatus: (): Promise<{ status: string }> => ipcRenderer.invoke('bridge:status'),

  getConfig: (): Promise<unknown> => ipcRenderer.invoke('bridge:getConfig'),

  saveConfig: (config: unknown): Promise<{ success: boolean }> =>
    ipcRenderer.invoke('bridge:saveConfig', config),

  onBridgeLog: (callback: (log: string) => void): void => {
    ipcRenderer.on('bridge-log', (_event, log: string) => callback(log));
  },

  onWorkerUpdate: (callback: (update: unknown) => void): void => {
    ipcRenderer.on('worker-update', (_event, update: unknown) => callback(update));
  },

  onMessageReceived: (callback: (message: unknown) => void): void => {
    ipcRenderer.on('message-received', (_event, message: unknown) => callback(message));
  },
});
