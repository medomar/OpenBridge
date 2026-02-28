import { lazy, Suspense, useEffect, useState } from 'react';
import { Button } from '../components/Button';

const GeneralSettings = lazy(() => import('./settings/GeneralSettings'));
const ConnectorSettings = lazy(() => import('./settings/ConnectorSettings'));

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type SettingsTab = 'general' | 'connectors' | 'providers' | 'mcp' | 'access' | 'advanced';

type Config = Record<string, unknown>;

/** Contract every settings tab component must satisfy. */
export interface SettingsTabProps {
  config: Config;
  onUpdate: (updates: Partial<Config>, requiresRestart?: boolean) => void;
}

interface TabDefinition {
  id: SettingsTab;
  label: string;
}

// ---------------------------------------------------------------------------
// Tab definitions
// ---------------------------------------------------------------------------

const TABS: TabDefinition[] = [
  { id: 'general', label: 'General' },
  { id: 'connectors', label: 'Connectors' },
  { id: 'providers', label: 'AI Providers' },
  { id: 'mcp', label: 'MCP Servers' },
  { id: 'access', label: 'Access Control' },
  { id: 'advanced', label: 'Advanced' },
];

// ---------------------------------------------------------------------------
// Placeholder tab — shown until OB-1283 through OB-1287 replace each tab
// ---------------------------------------------------------------------------

function PlaceholderTab({ label }: { label: string }) {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        minHeight: 200,
        color: 'var(--color-text-muted)',
        fontSize: 'var(--font-size-base)',
      }}
    >
      {label} settings — coming soon
    </div>
  );
}

// ---------------------------------------------------------------------------
// Settings page
// ---------------------------------------------------------------------------

export default function Settings() {
  const [activeTab, setActiveTab] = useState<SettingsTab>('general');

  // Persisted config (last saved state)
  const [savedConfig, setSavedConfig] = useState<Config | null>(null);
  // Working draft — mutated by tab components before the user hits Save
  const [draftConfig, setDraftConfig] = useState<Config | null>(null);

  const [isSaving, setIsSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saveSuccess, setSaveSuccess] = useState(false);
  const [restartRequired, setRestartRequired] = useState(false);

  // Load config from the Electron main process on mount
  useEffect(() => {
    window.openbridge
      .getConfig()
      .then((cfg) => {
        const c = (cfg as Config) ?? {};
        setSavedConfig(c);
        setDraftConfig(c);
      })
      .catch(() => {
        setSavedConfig({});
        setDraftConfig({});
      });
  }, []);

  /** Called by tab components to apply incremental changes to the draft. */
  function handleUpdate(updates: Partial<Config>, requiresRestart = true) {
    setDraftConfig((prev) => ({ ...(prev ?? {}), ...updates }));
    if (requiresRestart) setRestartRequired(true);
  }

  async function handleSave() {
    if (draftConfig == null) return;
    setIsSaving(true);
    setSaveError(null);
    setSaveSuccess(false);
    try {
      const result = await window.openbridge.saveConfig(draftConfig);
      if (result.success) {
        setSavedConfig(draftConfig);
        setSaveSuccess(true);
        setTimeout(() => setSaveSuccess(false), 3000);
      } else {
        setSaveError('Failed to save configuration.');
      }
    } catch {
      setSaveError('Failed to save configuration.');
    } finally {
      setIsSaving(false);
    }
  }

  const hasChanges =
    savedConfig != null &&
    draftConfig != null &&
    JSON.stringify(savedConfig) !== JSON.stringify(draftConfig);

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
      }}
    >
      {/* Page heading */}
      <h1
        style={{
          fontSize: 'var(--font-size-xl)',
          fontWeight: 700,
          color: 'var(--color-text)',
          marginBottom: 'var(--space-4)',
          flexShrink: 0,
        }}
      >
        Settings
      </h1>

      {/* Tab bar */}
      <div
        role="tablist"
        style={{
          display: 'flex',
          borderBottom: '1px solid var(--color-border)',
          gap: 0,
          flexShrink: 0,
        }}
      >
        {TABS.map((tab) => {
          const isActive = tab.id === activeTab;
          return (
            <button
              key={tab.id}
              role="tab"
              aria-selected={isActive}
              onClick={() => setActiveTab(tab.id)}
              style={{
                padding: 'var(--space-3) var(--space-4)',
                background: 'transparent',
                border: 'none',
                borderBottom: isActive ? '2px solid var(--color-accent)' : '2px solid transparent',
                color: isActive ? 'var(--color-accent)' : 'var(--color-text-muted)',
                fontWeight: isActive ? 600 : 400,
                cursor: 'pointer',
                fontSize: 'var(--font-size-sm)',
                transition: 'color 0.15s, border-color 0.15s',
                whiteSpace: 'nowrap',
              }}
            >
              {tab.label}
            </button>
          );
        })}
      </div>

      {/* Tab content */}
      <div
        role="tabpanel"
        style={{
          flex: 1,
          overflowY: 'auto',
          paddingTop: 'var(--space-6)',
          minHeight: 0,
        }}
      >
        {activeTab === 'general' && draftConfig != null && (
          <Suspense fallback={<PlaceholderTab label="General" />}>
            <GeneralSettings config={draftConfig} onUpdate={handleUpdate} />
          </Suspense>
        )}
        {activeTab === 'connectors' && draftConfig != null && (
          <Suspense fallback={<PlaceholderTab label="Connectors" />}>
            <ConnectorSettings config={draftConfig} onUpdate={handleUpdate} />
          </Suspense>
        )}
        {activeTab === 'providers' && <PlaceholderTab label="AI Providers" />}
        {activeTab === 'mcp' && <PlaceholderTab label="MCP Servers" />}
        {activeTab === 'access' && <PlaceholderTab label="Access Control" />}
        {activeTab === 'advanced' && <PlaceholderTab label="Advanced" />}
      </div>

      {/* Restart-required notice */}
      {restartRequired && hasChanges && (
        <div
          style={{
            flexShrink: 0,
            marginTop: 'var(--space-4)',
            padding: 'var(--space-3) var(--space-4)',
            backgroundColor: 'rgba(234,179,8,0.08)',
            border: '1px solid var(--color-warning)',
            borderRadius: 'var(--radius-md)',
            color: 'var(--color-warning)',
            fontSize: 'var(--font-size-sm)',
          }}
        >
          Bridge restart required for these changes to take effect.
        </div>
      )}

      {/* Footer — save action + status messages */}
      <div
        style={{
          flexShrink: 0,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'flex-end',
          gap: 'var(--space-3)',
          paddingTop: 'var(--space-4)',
          marginTop: 'var(--space-4)',
          borderTop: '1px solid var(--color-border)',
        }}
      >
        {saveError != null && (
          <span style={{ color: 'var(--color-error)', fontSize: 'var(--font-size-sm)' }}>
            {saveError}
          </span>
        )}
        {saveSuccess && (
          <span style={{ color: 'var(--color-success)', fontSize: 'var(--font-size-sm)' }}>
            Settings saved.
          </span>
        )}
        <Button onClick={() => void handleSave()} disabled={isSaving || !hasChanges}>
          {isSaving ? 'Saving…' : 'Save'}
        </Button>
      </div>
    </div>
  );
}
