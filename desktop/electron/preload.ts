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

  selectDirectory: (): Promise<{ path: string | null }> =>
    ipcRenderer.invoke('setup:selectDirectory'),

  validateDirectory: (dirPath: string): Promise<{ valid: boolean; error?: string }> =>
    ipcRenderer.invoke('setup:validateDirectory', dirPath),

  getHomeDirectory: (): Promise<string> => ipcRenderer.invoke('setup:getHomeDirectory'),

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

  mcpGetServers: (): Promise<unknown> => ipcRenderer.invoke('mcp:getServers'),

  mcpAddServer: (body: unknown): Promise<{ success: boolean; error?: string }> =>
    ipcRenderer.invoke('mcp:addServer', body),

  mcpToggleServer: (
    name: string,
    enabled: boolean,
  ): Promise<{ success: boolean; error?: string }> =>
    ipcRenderer.invoke('mcp:toggleServer', name, enabled),

  mcpRemoveServer: (name: string): Promise<{ success: boolean; error?: string }> =>
    ipcRenderer.invoke('mcp:removeServer', name),

  mcpGetCatalog: (): Promise<unknown> => ipcRenderer.invoke('mcp:getCatalog'),

  mcpConnectFromCatalog: (
    name: string,
    envVars: Record<string, string>,
  ): Promise<{ success: boolean; error?: string }> =>
    ipcRenderer.invoke('mcp:connectFromCatalog', name, envVars),

  accessList: (): Promise<unknown> => ipcRenderer.invoke('access:list'),

  accessAdd: (
    userId: string,
    role: string,
    channel: string,
  ): Promise<{ success: boolean; error?: string }> =>
    ipcRenderer.invoke('access:add', userId, role, channel),

  accessRemove: (userId: string, channel: string): Promise<{ success: boolean; error?: string }> =>
    ipcRenderer.invoke('access:remove', userId, channel),
});
