import { useState } from 'react';
import { Button } from '../../components/Button';
import { Input } from '../../components/Input';
import { Select } from '../../components/Select';
import { type SettingsTabProps } from '../Settings';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const LOG_LEVEL_OPTIONS = [
  { value: 'debug', label: 'Debug' },
  { value: 'info', label: 'Info' },
  { value: 'warn', label: 'Warn' },
  { value: 'error', label: 'Error' },
];

const THEME_OPTIONS = [
  { value: 'system', label: 'System' },
  { value: 'light', label: 'Light' },
  { value: 'dark', label: 'Dark' },
];

// ---------------------------------------------------------------------------
// GeneralSettings tab
// ---------------------------------------------------------------------------

export default function GeneralSettings({ config, onUpdate }: SettingsTabProps) {
  const [workspacePath, setWorkspacePath] = useState<string>(
    typeof config.workspacePath === 'string' ? config.workspacePath : '',
  );
  const [browsing, setBrowsing] = useState(false);

  const autoStart = config.autoStart === true;
  const logLevel =
    typeof config.logLevel === 'string' &&
    ['debug', 'info', 'warn', 'error'].includes(config.logLevel)
      ? config.logLevel
      : 'info';
  const theme =
    typeof config.theme === 'string' && ['system', 'light', 'dark'].includes(config.theme)
      ? config.theme
      : 'system';

  // ------------------------------------------------------------------
  // Workspace path
  // ------------------------------------------------------------------

  function handlePathChange(e: React.ChangeEvent<HTMLInputElement>): void {
    const value = e.target.value;
    setWorkspacePath(value);
    onUpdate({ workspacePath: value }, true);
  }

  async function handleBrowse(): Promise<void> {
    setBrowsing(true);
    try {
      const result = await window.openbridge.selectDirectory();
      if (result.path) {
        setWorkspacePath(result.path);
        onUpdate({ workspacePath: result.path }, true);
      }
    } catch {
      // IPC unavailable (browser dev preview)
    } finally {
      setBrowsing(false);
    }
  }

  // ------------------------------------------------------------------
  // Render
  // ------------------------------------------------------------------

  return (
    <div style={{ maxWidth: 560, display: 'flex', flexDirection: 'column', gap: 'var(--space-6)' }}>
      {/* Workspace Path */}
      <section>
        <h2
          style={{
            fontSize: 'var(--font-size-base)',
            fontWeight: 600,
            color: 'var(--color-text)',
            marginBottom: 'var(--space-3)',
          }}
        >
          Workspace
        </h2>
        <div style={{ display: 'flex', gap: 'var(--space-2)', alignItems: 'flex-end' }}>
          <div style={{ flex: 1 }}>
            <Input
              label="Workspace Path"
              placeholder="/path/to/your/project"
              value={workspacePath}
              onChange={handlePathChange}
            />
          </div>
          <Button
            variant="secondary"
            onClick={() => {
              void handleBrowse();
            }}
            disabled={browsing}
            style={{ flexShrink: 0 }}
          >
            {browsing ? 'Opening…' : 'Browse'}
          </Button>
        </div>
        <p
          style={{
            marginTop: 'var(--space-2)',
            fontSize: 'var(--font-size-sm)',
            color: 'var(--color-text-muted)',
          }}
        >
          The project directory that the Master AI explores and works in. Bridge restart required.
        </p>
      </section>

      {/* Bridge Auto-Start */}
      <section>
        <h2
          style={{
            fontSize: 'var(--font-size-base)',
            fontWeight: 600,
            color: 'var(--color-text)',
            marginBottom: 'var(--space-3)',
          }}
        >
          Bridge
        </h2>
        <label
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 'var(--space-3)',
            cursor: 'pointer',
          }}
        >
          <input
            type="checkbox"
            checked={autoStart}
            onChange={(e) => {
              onUpdate({ autoStart: e.target.checked }, false);
            }}
            style={{ width: 16, height: 16, cursor: 'pointer' }}
          />
          <span style={{ fontSize: 'var(--font-size-base)', color: 'var(--color-text)' }}>
            Auto-start bridge on app launch
          </span>
        </label>
        <p
          style={{
            marginTop: 'var(--space-2)',
            fontSize: 'var(--font-size-sm)',
            color: 'var(--color-text-muted)',
            paddingLeft: 'calc(16px + var(--space-3))',
          }}
        >
          Automatically connect channels and begin processing messages when OpenBridge opens.
        </p>
      </section>

      {/* Log Level */}
      <section>
        <h2
          style={{
            fontSize: 'var(--font-size-base)',
            fontWeight: 600,
            color: 'var(--color-text)',
            marginBottom: 'var(--space-3)',
          }}
        >
          Logging
        </h2>
        <div style={{ maxWidth: 240 }}>
          <Select
            label="Log Level"
            options={LOG_LEVEL_OPTIONS}
            value={logLevel}
            onChange={(e) => {
              onUpdate({ logLevel: e.target.value }, false);
            }}
          />
        </div>
        <p
          style={{
            marginTop: 'var(--space-2)',
            fontSize: 'var(--font-size-sm)',
            color: 'var(--color-text-muted)',
          }}
        >
          Controls the verbosity of logs shown in the Log Viewer. Debug shows all internal events.
        </p>
      </section>

      {/* Theme */}
      <section>
        <h2
          style={{
            fontSize: 'var(--font-size-base)',
            fontWeight: 600,
            color: 'var(--color-text)',
            marginBottom: 'var(--space-3)',
          }}
        >
          Appearance
        </h2>
        <div style={{ maxWidth: 240 }}>
          <Select
            label="Theme"
            options={THEME_OPTIONS}
            value={theme}
            onChange={(e) => {
              onUpdate({ theme: e.target.value }, false);
            }}
          />
        </div>
        <p
          style={{
            marginTop: 'var(--space-2)',
            fontSize: 'var(--font-size-sm)',
            color: 'var(--color-text-muted)',
          }}
        >
          System follows your OS appearance setting. Takes effect immediately.
        </p>
      </section>
    </div>
  );
}
