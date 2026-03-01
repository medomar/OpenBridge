import { useEffect, useState } from 'react';
import { Button } from '../../components/Button';
import { type WizardStepProps } from '../Setup';

interface ToolDef {
  id: 'claude' | 'codex';
  name: string;
  icon: string;
  description: string;
  npmPackage: string;
}

const TOOLS: ToolDef[] = [
  {
    id: 'claude',
    name: 'Claude Code',
    icon: '🤖',
    description:
      'AI coding assistant by Anthropic. Uses your Anthropic account — zero extra cost beyond your subscription.',
    npmPackage: '@anthropic-ai/claude-code',
  },
  {
    id: 'codex',
    name: 'OpenAI Codex',
    icon: '⚡',
    description:
      'AI coding assistant by OpenAI. Uses your OpenAI API key. Also enables Whisper voice transcription.',
    npmPackage: '@openai/codex',
  },
];

type ToolStatus = 'installed' | 'not-installed' | 'installing' | 'error';

export default function AIToolStep({ onUpdate, onValidChange }: WizardStepProps) {
  const [statuses, setStatuses] = useState<Record<string, ToolStatus>>({
    claude: 'not-installed',
    codex: 'not-installed',
  });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);

  // Detect installed tools on mount
  useEffect(() => {
    window.openbridge
      .detectInstalledTools()
      .then((result) => {
        setStatuses({
          claude: result.claude ? 'installed' : 'not-installed',
          codex: result.codex ? 'installed' : 'not-installed',
        });
      })
      .catch(() => {
        // IPC unavailable (e.g., running in browser dev mode) — leave defaults
      })
      .finally(() => {
        setLoading(false);
      });
  }, []);

  // Sync wizard validity and accumulated data whenever statuses change
  useEffect(() => {
    const installed = Object.entries(statuses)
      .filter(([, s]) => s === 'installed')
      .map(([id]) => id);
    onValidChange(installed.length > 0);
    onUpdate({ installedTools: installed });
  }, [statuses, onValidChange, onUpdate]);

  async function handleInstall(toolId: 'claude' | 'codex') {
    setStatuses((prev) => ({ ...prev, [toolId]: 'installing' }));
    setErrors((prev) => ({ ...prev, [toolId]: '' }));

    try {
      const result = await window.openbridge.installAiTool(toolId);
      if (result.success) {
        setStatuses((prev) => ({ ...prev, [toolId]: 'installed' }));
      } else {
        setStatuses((prev) => ({ ...prev, [toolId]: 'error' }));
        setErrors((prev) => ({ ...prev, [toolId]: result.error ?? 'Installation failed' }));
      }
    } catch {
      setStatuses((prev) => ({ ...prev, [toolId]: 'error' }));
      setErrors((prev) => ({
        ...prev,
        [toolId]: 'IPC error — make sure you are running inside Electron.',
      }));
    }
  }

  const anyInstalled = Object.values(statuses).some((s) => s === 'installed');

  return (
    <div style={{ maxWidth: 560, margin: '0 auto' }}>
      <h2
        style={{
          fontSize: 22,
          fontWeight: 700,
          color: 'var(--color-text)',
          marginBottom: 'var(--space-2)',
        }}
      >
        Choose an AI Tool
      </h2>

      <p
        style={{
          color: 'var(--color-text-muted)',
          fontSize: 'var(--font-size-base)',
          lineHeight: 1.6,
          marginBottom: 'var(--space-6)',
        }}
      >
        OpenBridge needs at least one AI tool installed on your machine. Select one — or install
        both — to continue.
      </p>

      {loading ? (
        <div
          style={{
            padding: 'var(--space-8)',
            textAlign: 'center',
            color: 'var(--color-text-muted)',
          }}
        >
          Checking installed AI tools…
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
          {TOOLS.map((tool) => {
            const status = statuses[tool.id] ?? 'not-installed';
            const isInstalled = status === 'installed';
            const isInstalling = status === 'installing';
            const isError = status === 'error';
            const errorMsg = errors[tool.id];

            return (
              <div
                key={tool.id}
                style={{
                  backgroundColor: 'var(--color-surface)',
                  border: `1px solid ${isInstalled ? 'var(--color-success)' : 'var(--color-border)'}`,
                  borderRadius: 'var(--radius-lg)',
                  padding: 'var(--space-5)',
                  transition: 'border-color 0.2s',
                }}
              >
                {/* Card header */}
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'flex-start',
                    gap: 'var(--space-4)',
                  }}
                >
                  {/* Icon */}
                  <div
                    style={{
                      fontSize: 32,
                      lineHeight: 1,
                      flexShrink: 0,
                      marginTop: 2,
                    }}
                  >
                    {tool.icon}
                  </div>

                  {/* Text */}
                  <div style={{ flex: 1 }}>
                    <div
                      style={{
                        fontSize: 'var(--font-size-base)',
                        fontWeight: 600,
                        color: 'var(--color-text)',
                        marginBottom: 'var(--space-1)',
                      }}
                    >
                      {tool.name}
                    </div>
                    <div
                      style={{
                        fontSize: 'var(--font-size-sm)',
                        color: 'var(--color-text-muted)',
                        lineHeight: 1.5,
                      }}
                    >
                      {tool.description}
                    </div>
                    <div
                      style={{
                        marginTop: 'var(--space-1)',
                        fontSize: 'var(--font-size-sm)',
                        color: 'var(--color-text-muted)',
                        fontFamily: 'monospace',
                      }}
                    >
                      npm install -g {tool.npmPackage}
                    </div>
                  </div>

                  {/* Status / action */}
                  <div style={{ flexShrink: 0 }}>
                    {isInstalled ? (
                      <span
                        style={{
                          display: 'inline-flex',
                          alignItems: 'center',
                          gap: 'var(--space-1)',
                          color: 'var(--color-success)',
                          fontWeight: 600,
                          fontSize: 'var(--font-size-sm)',
                        }}
                      >
                        ✓ Installed
                      </span>
                    ) : (
                      <Button
                        variant="secondary"
                        onClick={() => handleInstall(tool.id)}
                        disabled={isInstalling}
                        style={{ whiteSpace: 'nowrap' }}
                      >
                        {isInstalling ? 'Installing…' : 'Install'}
                      </Button>
                    )}
                  </div>
                </div>

                {/* Error message */}
                {isError && errorMsg && (
                  <div
                    style={{
                      marginTop: 'var(--space-3)',
                      padding: 'var(--space-2) var(--space-3)',
                      backgroundColor: 'rgba(239,68,68,0.08)',
                      borderRadius: 'var(--radius-md)',
                      fontSize: 'var(--font-size-sm)',
                      color: 'var(--color-error)',
                    }}
                  >
                    ⚠ {errorMsg}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Hint */}
      {!loading && !anyInstalled && (
        <p
          style={{
            marginTop: 'var(--space-4)',
            fontSize: 'var(--font-size-sm)',
            color: 'var(--color-text-muted)',
            textAlign: 'center',
          }}
        >
          Install at least one tool above to continue.
        </p>
      )}
    </div>
  );
}
