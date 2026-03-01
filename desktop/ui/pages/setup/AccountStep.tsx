import { useEffect, useState } from 'react';
import { Button } from '../../components/Button';
import { Input } from '../../components/Input';
import { type WizardStepProps } from '../Setup';

interface ToolDef {
  id: 'claude' | 'codex';
  name: string;
  icon: string;
  authCommand: string;
  apiKeyPrefix: string;
  apiKeyPlaceholder: string;
  apiKeyHint: string;
}

const TOOL_DEFS: Record<string, ToolDef> = {
  claude: {
    id: 'claude',
    name: 'Claude Code',
    icon: '🤖',
    authCommand: 'claude auth login',
    apiKeyPrefix: 'sk-ant-',
    apiKeyPlaceholder: 'sk-ant-…',
    apiKeyHint: 'Starts with sk-ant-',
  },
  codex: {
    id: 'codex',
    name: 'OpenAI Codex',
    icon: '⚡',
    authCommand: 'codex login',
    apiKeyPrefix: 'sk-',
    apiKeyPlaceholder: 'sk-…',
    apiKeyHint: 'Starts with sk- (your OpenAI API key)',
  },
};

type AuthStatus = 'idle' | 'authenticating' | 'authenticated' | 'error';

interface ToolState {
  authStatus: AuthStatus;
  errorMsg: string;
  apiKey: string;
  apiKeyValid: boolean;
  apiKeyDirty: boolean;
  showApiKey: boolean;
}

function makeInitialState(): ToolState {
  return {
    authStatus: 'idle',
    errorMsg: '',
    apiKey: '',
    apiKeyValid: false,
    apiKeyDirty: false,
    showApiKey: false,
  };
}

function validateApiKey(toolId: string, key: string): boolean {
  const def = TOOL_DEFS[toolId];
  if (!def) return false;
  return key.startsWith(def.apiKeyPrefix) && key.length >= 20;
}

export default function AccountStep({ wizardData, onUpdate, onValidChange }: WizardStepProps) {
  const installedTools = wizardData.installedTools ?? [];

  const [states, setStates] = useState<Record<string, ToolState>>(() => {
    const initial: Record<string, ToolState> = {};
    for (const id of installedTools) {
      initial[id] = makeInitialState();
    }
    return initial;
  });

  // Step is always valid — user can skip account setup
  useEffect(() => {
    onValidChange(true);
  }, [onValidChange]);

  // Sync authenticated tools to wizardData whenever states change
  useEffect(() => {
    const authenticated = Object.entries(states)
      .filter(([, s]) => s.authStatus === 'authenticated')
      .map(([id]) => id);
    onUpdate({ authenticatedTools: authenticated });
  }, [states, onUpdate]);

  function updateState(toolId: string, patch: Partial<ToolState>) {
    setStates((prev) => ({
      ...prev,
      [toolId]: { ...prev[toolId]!, ...patch },
    }));
  }

  async function handleLogin(toolId: 'claude' | 'codex') {
    updateState(toolId, { authStatus: 'authenticating', errorMsg: '' });
    try {
      const result = await window.openbridge.authenticateTool(toolId);
      if (result.success) {
        updateState(toolId, { authStatus: 'authenticated' });
      } else {
        updateState(toolId, {
          authStatus: 'error',
          errorMsg: result.error ?? 'Authentication failed',
        });
      }
    } catch {
      updateState(toolId, {
        authStatus: 'error',
        errorMsg: 'IPC error — make sure you are running inside Electron.',
      });
    }
  }

  function handleApiKeyChange(toolId: string, value: string) {
    const valid = validateApiKey(toolId, value);
    updateState(toolId, {
      apiKey: value,
      apiKeyValid: valid,
      apiKeyDirty: true,
      // Immediately authenticate if key is valid (user typed/pasted it in)
      authStatus: valid
        ? 'authenticated'
        : states[toolId]?.authStatus === 'authenticated'
          ? 'idle'
          : (states[toolId]?.authStatus ?? 'idle'),
    });
  }

  function handleToggleApiKey(toolId: string) {
    updateState(toolId, { showApiKey: !states[toolId]?.showApiKey });
  }

  if (installedTools.length === 0) {
    return (
      <div
        style={{
          maxWidth: 560,
          margin: '0 auto',
          textAlign: 'center',
          paddingTop: 'var(--space-8)',
        }}
      >
        <h2
          style={{
            fontSize: 22,
            fontWeight: 700,
            color: 'var(--color-text)',
            marginBottom: 'var(--space-4)',
          }}
        >
          Account Login
        </h2>
        <p style={{ color: 'var(--color-text-muted)', fontSize: 'var(--font-size-base)' }}>
          No AI tools are installed yet. Go back to the previous step to install at least one tool.
        </p>
      </div>
    );
  }

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
        Account Login
      </h2>

      <p
        style={{
          color: 'var(--color-text-muted)',
          fontSize: 'var(--font-size-base)',
          lineHeight: 1.6,
          marginBottom: 'var(--space-6)',
        }}
      >
        Sign in to your AI tool accounts. You can skip this step and authenticate later.
      </p>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
        {installedTools.map((toolId) => {
          const def = TOOL_DEFS[toolId];
          if (!def) return null;

          const state = states[toolId] ?? makeInitialState();
          const isAuthenticated = state.authStatus === 'authenticated';
          const isAuthenticating = state.authStatus === 'authenticating';
          const isError = state.authStatus === 'error';

          return (
            <div
              key={toolId}
              style={{
                backgroundColor: 'var(--color-surface)',
                border: `1px solid ${isAuthenticated ? 'var(--color-success)' : 'var(--color-border)'}`,
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
                  marginBottom: state.showApiKey ? 'var(--space-4)' : 0,
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
                  {def.icon}
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
                    {def.name}
                  </div>

                  {isAuthenticated ? (
                    <div
                      style={{
                        fontSize: 'var(--font-size-sm)',
                        color: 'var(--color-success)',
                        display: 'flex',
                        alignItems: 'center',
                        gap: 'var(--space-1)',
                        fontWeight: 500,
                      }}
                    >
                      ✓ Authenticated
                    </div>
                  ) : (
                    <div
                      style={{
                        fontSize: 'var(--font-size-sm)',
                        color: 'var(--color-text-muted)',
                      }}
                    >
                      Not authenticated
                    </div>
                  )}
                </div>

                {/* Action buttons */}
                <div
                  style={{
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 'var(--space-2)',
                    flexShrink: 0,
                    alignItems: 'flex-end',
                  }}
                >
                  {!isAuthenticated && (
                    <Button
                      variant="secondary"
                      onClick={() => handleLogin(def.id)}
                      disabled={isAuthenticating}
                      style={{ whiteSpace: 'nowrap' }}
                    >
                      {isAuthenticating ? 'Logging in…' : 'Login'}
                    </Button>
                  )}
                  <button
                    onClick={() => handleToggleApiKey(toolId)}
                    style={{
                      background: 'none',
                      border: 'none',
                      cursor: 'pointer',
                      color: 'var(--color-accent)',
                      fontSize: 'var(--font-size-sm)',
                      padding: 0,
                      textDecoration: 'underline',
                    }}
                  >
                    {state.showApiKey ? 'Hide API Key' : 'Enter API Key'}
                  </button>
                </div>
              </div>

              {/* Error message */}
              {isError && state.errorMsg && (
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
                  ⚠ {state.errorMsg}
                </div>
              )}

              {/* API Key input */}
              {state.showApiKey && (
                <div style={{ marginTop: 'var(--space-3)' }}>
                  <Input
                    label="API Key"
                    type="password"
                    placeholder={def.apiKeyPlaceholder}
                    value={state.apiKey}
                    onChange={(e) => handleApiKeyChange(toolId, e.target.value)}
                    validationState={
                      !state.apiKeyDirty ? 'default' : state.apiKeyValid ? 'valid' : 'invalid'
                    }
                    errorMessage={
                      state.apiKeyDirty && !state.apiKeyValid
                        ? `Invalid key format. ${def.apiKeyHint}.`
                        : undefined
                    }
                    hint={!state.apiKeyDirty ? def.apiKeyHint : undefined}
                  />
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Skip hint */}
      <p
        style={{
          marginTop: 'var(--space-4)',
          fontSize: 'var(--font-size-sm)',
          color: 'var(--color-text-muted)',
          textAlign: 'center',
        }}
      >
        You can skip this step and authenticate later via the terminal.
      </p>
    </div>
  );
}
