import { useEffect, useState } from 'react';
import { Button } from '../../components/Button';
import { Select } from '../../components/Select';
import { type SettingsTabProps } from '../Settings';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const MODEL_TIER_OPTIONS = [
  { value: 'fast', label: 'Fast (Haiku / Codex Mini)' },
  { value: 'balanced', label: 'Balanced (Sonnet / Codex)' },
  { value: 'powerful', label: 'Powerful (Opus / Codex)' },
];

const MASTER_OPTIONS = [
  { value: '', label: 'Auto-detect (best available)' },
  { value: 'claude', label: 'Claude Code' },
  { value: 'codex', label: 'OpenAI Codex' },
];

interface ToolDef {
  id: 'claude' | 'codex';
  name: string;
  icon: string;
  description: string;
}

const TOOL_DEFS: ToolDef[] = [
  {
    id: 'claude',
    name: 'Claude Code',
    icon: '🤖',
    description: 'AI coding assistant by Anthropic.',
  },
  {
    id: 'codex',
    name: 'OpenAI Codex',
    icon: '⚡',
    description: 'AI coding assistant by OpenAI. Also enables Whisper voice transcription.',
  },
];

// ---------------------------------------------------------------------------
// Helpers — read/write provider config from the flat config object
// ---------------------------------------------------------------------------

type ModelTier = 'fast' | 'balanced' | 'powerful';

/** Per-tool settings stored under config.providerSettings.<toolId> */
interface ToolConfig {
  modelTier: ModelTier;
}

function readToolConfig(config: Record<string, unknown>, toolId: string): ToolConfig {
  const ps = config.providerSettings;
  const tier =
    ps !== null &&
    typeof ps === 'object' &&
    !Array.isArray(ps) &&
    typeof (ps as Record<string, unknown>)[toolId] === 'object' &&
    (ps as Record<string, Record<string, unknown>>)[toolId] !== null
      ? ((ps as Record<string, Record<string, unknown>>)[toolId].modelTier as string | undefined)
      : undefined;

  const validTiers: ModelTier[] = ['fast', 'balanced', 'powerful'];
  return {
    modelTier: validTiers.includes(tier as ModelTier) ? (tier as ModelTier) : 'balanced',
  };
}

function readMasterPreference(config: Record<string, unknown>): string {
  const pref = config.masterPreference;
  if (pref === 'claude' || pref === 'codex') return pref;
  return '';
}

// ---------------------------------------------------------------------------
// Tool card
// ---------------------------------------------------------------------------

interface ProviderCardProps {
  def: ToolDef;
  installed: boolean;
  modelTier: ModelTier;
  isMaster: boolean;
  isAuthenticating: boolean;
  authError: string | null;
  onModelTierChange: (tier: ModelTier) => void;
  onReAuthenticate: () => void;
}

function ProviderCard({
  def,
  installed,
  modelTier,
  isMaster,
  isAuthenticating,
  authError,
  onModelTierChange,
  onReAuthenticate,
}: ProviderCardProps) {
  return (
    <div
      style={{
        backgroundColor: 'var(--color-surface)',
        border: `1px solid ${isMaster ? 'var(--color-accent)' : 'var(--color-border)'}`,
        borderRadius: 'var(--radius-lg)',
        padding: 'var(--space-5)',
        display: 'flex',
        flexDirection: 'column',
        gap: 'var(--space-4)',
        transition: 'border-color 0.2s',
      }}
    >
      {/* Header row */}
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 'var(--space-4)' }}>
        {/* Icon */}
        <div style={{ fontSize: 32, lineHeight: 1, flexShrink: 0, marginTop: 2 }}>{def.icon}</div>

        {/* Name + description */}
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
            <span
              style={{
                fontSize: 'var(--font-size-base)',
                fontWeight: 600,
                color: 'var(--color-text)',
              }}
            >
              {def.name}
            </span>
            {isMaster && (
              <span
                style={{
                  fontSize: 11,
                  fontWeight: 600,
                  color: 'var(--color-accent)',
                  backgroundColor: 'rgba(59,130,246,0.1)',
                  padding: '1px 6px',
                  borderRadius: 'var(--radius-sm)',
                  whiteSpace: 'nowrap',
                }}
              >
                Master AI
              </span>
            )}
          </div>
          <div
            style={{
              fontSize: 'var(--font-size-sm)',
              color: 'var(--color-text-muted)',
              lineHeight: 1.5,
              marginTop: 'var(--space-1)',
            }}
          >
            {def.description}
          </div>
        </div>

        {/* Auth status badge */}
        <div style={{ flexShrink: 0 }}>
          {installed ? (
            <span
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 4,
                fontSize: 'var(--font-size-sm)',
                fontWeight: 600,
                color: 'var(--color-success)',
              }}
            >
              ✓ Installed
            </span>
          ) : (
            <span
              style={{
                fontSize: 'var(--font-size-sm)',
                color: 'var(--color-text-muted)',
              }}
            >
              Not installed
            </span>
          )}
        </div>
      </div>

      {/* Controls — only show when installed */}
      {installed && (
        <div
          style={{
            display: 'flex',
            alignItems: 'flex-end',
            gap: 'var(--space-4)',
            flexWrap: 'wrap',
          }}
        >
          {/* Model tier selector */}
          <div style={{ minWidth: 220, flex: 1 }}>
            <Select
              label="Preferred Model Tier"
              options={MODEL_TIER_OPTIONS}
              value={modelTier}
              onChange={(e) => {
                onModelTierChange(e.target.value as ModelTier);
              }}
            />
          </div>

          {/* Re-authenticate button */}
          <Button
            variant="secondary"
            onClick={onReAuthenticate}
            disabled={isAuthenticating}
            style={{ flexShrink: 0, alignSelf: 'flex-end' }}
          >
            {isAuthenticating ? 'Authenticating…' : 'Re-authenticate'}
          </Button>
        </div>
      )}

      {/* Auth error message */}
      {authError && (
        <div
          style={{
            padding: 'var(--space-2) var(--space-3)',
            backgroundColor: 'rgba(239,68,68,0.08)',
            borderRadius: 'var(--radius-md)',
            fontSize: 'var(--font-size-sm)',
            color: 'var(--color-error)',
          }}
        >
          ⚠ {authError}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// ProviderSettings tab
// ---------------------------------------------------------------------------

export default function ProviderSettings({ config, onUpdate }: SettingsTabProps) {
  const [installed, setInstalled] = useState<Record<string, boolean>>({
    claude: false,
    codex: false,
  });
  const [loading, setLoading] = useState(true);
  const [authenticating, setAuthenticating] = useState<Record<string, boolean>>({});
  const [authErrors, setAuthErrors] = useState<Record<string, string | null>>({});

  const masterPreference = readMasterPreference(config);

  // Detect installed tools on mount
  useEffect(() => {
    window.openbridge
      .detectInstalledTools()
      .then((result) => {
        setInstalled({ claude: result.claude, codex: result.codex });
      })
      .catch(() => {
        // IPC unavailable (browser dev preview) — leave defaults
      })
      .finally(() => {
        setLoading(false);
      });
  }, []);

  function handleModelTierChange(toolId: string, tier: ModelTier) {
    const existing =
      config.providerSettings !== null &&
      typeof config.providerSettings === 'object' &&
      !Array.isArray(config.providerSettings)
        ? (config.providerSettings as Record<string, unknown>)
        : {};
    onUpdate(
      {
        providerSettings: {
          ...existing,
          [toolId]: { ...((existing[toolId] as Record<string, unknown>) ?? {}), modelTier: tier },
        },
      },
      false,
    );
  }

  function handleMasterPreferenceChange(value: string) {
    onUpdate({ masterPreference: value || null }, true);
  }

  async function handleReAuthenticate(toolId: 'claude' | 'codex'): Promise<void> {
    setAuthenticating((prev) => ({ ...prev, [toolId]: true }));
    setAuthErrors((prev) => ({ ...prev, [toolId]: null }));
    try {
      const result = await window.openbridge.authenticateTool(toolId);
      if (!result.success) {
        setAuthErrors((prev) => ({
          ...prev,
          [toolId]: result.error ?? 'Authentication failed',
        }));
      }
    } catch {
      setAuthErrors((prev) => ({
        ...prev,
        [toolId]: 'IPC error — make sure you are running inside Electron.',
      }));
    } finally {
      setAuthenticating((prev) => ({ ...prev, [toolId]: false }));
    }
  }

  return (
    <div style={{ maxWidth: 640, display: 'flex', flexDirection: 'column', gap: 'var(--space-6)' }}>
      {/* Master AI preference */}
      <section>
        <h2
          style={{
            fontSize: 'var(--font-size-base)',
            fontWeight: 600,
            color: 'var(--color-text)',
            marginBottom: 'var(--space-3)',
          }}
        >
          Master AI
        </h2>
        <div style={{ maxWidth: 280 }}>
          <Select
            label="Preferred Master AI"
            options={MASTER_OPTIONS}
            value={masterPreference}
            onChange={(e) => {
              handleMasterPreferenceChange(e.target.value);
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
          The Master AI orchestrates workers and explores your workspace. Auto-detect picks the most
          capable installed tool. Bridge restart required.
        </p>
      </section>

      {/* Installed tools */}
      <section>
        <h2
          style={{
            fontSize: 'var(--font-size-base)',
            fontWeight: 600,
            color: 'var(--color-text)',
            marginBottom: 'var(--space-3)',
          }}
        >
          Detected AI Tools
        </h2>

        {loading ? (
          <div
            style={{
              padding: 'var(--space-8)',
              textAlign: 'center',
              color: 'var(--color-text-muted)',
              fontSize: 'var(--font-size-sm)',
            }}
          >
            Checking installed AI tools…
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
            {TOOL_DEFS.map((def) => {
              const toolConfig = readToolConfig(config, def.id);
              const isMaster =
                masterPreference === def.id ||
                (masterPreference === '' &&
                  installed[def.id] &&
                  !installed[def.id === 'claude' ? 'codex' : 'claude']);
              return (
                <ProviderCard
                  key={def.id}
                  def={def}
                  installed={installed[def.id] ?? false}
                  modelTier={toolConfig.modelTier}
                  isMaster={isMaster}
                  isAuthenticating={authenticating[def.id] ?? false}
                  authError={authErrors[def.id] ?? null}
                  onModelTierChange={(tier) => handleModelTierChange(def.id, tier)}
                  onReAuthenticate={() => {
                    void handleReAuthenticate(def.id);
                  }}
                />
              );
            })}
          </div>
        )}

        {!loading && !installed.claude && !installed.codex && (
          <p
            style={{
              marginTop: 'var(--space-4)',
              fontSize: 'var(--font-size-sm)',
              color: 'var(--color-text-muted)',
              textAlign: 'center',
            }}
          >
            No AI tools detected. Run{' '}
            <code style={{ fontFamily: 'monospace' }}>
              npm install -g @anthropic-ai/claude-code
            </code>{' '}
            or <code style={{ fontFamily: 'monospace' }}>npm install -g @openai/codex</code> to
            install one.
          </p>
        )}
      </section>
    </div>
  );
}
