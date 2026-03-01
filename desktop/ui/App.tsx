import { type ReactNode, useEffect, useState } from 'react';
import { Navigate, NavLink, Route, Routes } from 'react-router-dom';
import Dashboard from './pages/Dashboard';
import Settings from './pages/Settings';

// Electron preload API — exposed via contextBridge in desktop/electron/preload.ts
declare global {
  interface Window {
    openbridge: {
      detectPrerequisites(): Promise<{ os: string; nodeVersion: string; nodeOk: boolean }>;
      detectInstalledTools(): Promise<{ claude: boolean; codex: boolean }>;
      installAiTool(tool: 'claude' | 'codex'): Promise<{ success: boolean; error?: string }>;
      authenticateTool(tool: 'claude' | 'codex'): Promise<{ success: boolean; error?: string }>;
      selectDirectory(): Promise<{ path: string | null }>;
      validateDirectory(dirPath: string): Promise<{ valid: boolean; error?: string }>;
      getHomeDirectory(): Promise<string>;
      getConfig(): Promise<unknown>;
      startBridge(): Promise<{ success: boolean }>;
      stopBridge(): Promise<{ success: boolean }>;
      getBridgeStatus(): Promise<{ status: string }>;
      saveConfig(config: unknown): Promise<{ success: boolean }>;
      onBridgeLog(callback: (log: string) => void): void;
      onWorkerUpdate(callback: (update: unknown) => void): void;
      onMessageReceived(callback: (message: unknown) => void): void;
      mcpGetServers(): Promise<unknown>;
      mcpAddServer(body: unknown): Promise<{ success: boolean; error?: string }>;
      mcpToggleServer(
        name: string,
        enabled: boolean,
      ): Promise<{ success: boolean; error?: string }>;
      mcpRemoveServer(name: string): Promise<{ success: boolean; error?: string }>;
      mcpGetCatalog(): Promise<unknown>;
      mcpConnectFromCatalog(
        name: string,
        envVars: Record<string, string>,
      ): Promise<{ success: boolean; error?: string }>;
    };
  }
}

// Placeholder page — will be replaced once Setup wizard tasks land
function SetupPage() {
  return <div>Setup Wizard</div>;
}

// Sidebar layout — visible on /dashboard and /settings but not /setup
function AppLayout({ children }: { children: ReactNode }) {
  const linkStyle = (isActive: boolean): React.CSSProperties => ({
    display: 'block',
    padding: '10px 16px',
    color: isActive ? '#cba6f7' : '#cdd6f4',
    textDecoration: 'none',
    background: isActive ? 'rgba(203,166,247,0.1)' : 'transparent',
    borderLeft: isActive ? '3px solid #cba6f7' : '3px solid transparent',
  });

  return (
    <div style={{ display: 'flex', height: '100vh', fontFamily: 'system-ui, sans-serif' }}>
      <nav
        style={{
          width: 200,
          background: '#1e1e2e',
          color: '#cdd6f4',
          display: 'flex',
          flexDirection: 'column',
          padding: '24px 0',
          flexShrink: 0,
        }}
      >
        <div style={{ padding: '0 16px 24px', fontWeight: 700, fontSize: 16, color: '#cdd6f4' }}>
          OpenBridge
        </div>
        <NavLink to="/dashboard" style={({ isActive }) => linkStyle(isActive)}>
          Dashboard
        </NavLink>
        <NavLink to="/settings" style={({ isActive }) => linkStyle(isActive)}>
          Settings
        </NavLink>
      </nav>
      <main style={{ flex: 1, overflow: 'auto', padding: 24 }}>{children}</main>
    </div>
  );
}

// Redirects to /setup when no config exists, otherwise to /dashboard
function DefaultRedirect() {
  const [target, setTarget] = useState<string | null>(null);

  useEffect(() => {
    window.openbridge
      .getConfig()
      .then((config) => {
        setTarget(config != null ? '/dashboard' : '/setup');
      })
      .catch(() => {
        setTarget('/setup');
      });
  }, []);

  if (target === null) return null;
  return <Navigate to={target} replace />;
}

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<DefaultRedirect />} />
      <Route path="/setup" element={<SetupPage />} />
      <Route
        path="/dashboard"
        element={
          <AppLayout>
            <Dashboard />
          </AppLayout>
        }
      />
      <Route
        path="/settings"
        element={
          <AppLayout>
            <Settings />
          </AppLayout>
        }
      />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
