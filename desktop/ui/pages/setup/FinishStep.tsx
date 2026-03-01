import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button } from '../../components/Button';
import { type WizardData, type WizardStepProps } from '../Setup';

type StartStatus = 'idle' | 'generating' | 'starting' | 'error';

/** Transform wizard data into an OpenBridge config.json object. */
function buildConfig(data: WizardData): Record<string, unknown> {
  const channelConfig: Record<string, unknown> = {
    type: data.connectorType ?? 'console',
    enabled: true,
    ...(data.connectorConfig ?? {}),
  };

  return {
    workspacePath: data.workspacePath ?? '',
    channels: [channelConfig],
    auth: {
      whitelist: data.whitelist ?? [],
      prefix: '/ai',
      ...(data.allowAll === true ? { allowAll: true } : {}),
    },
  };
}

/** One row of the configuration summary table. */
function SummaryRow({ label, value }: { label: string; value: string }) {
  return (
    <div
      style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'flex-start',
        padding: 'var(--space-3) 0',
        borderBottom: '1px solid var(--color-border)',
        gap: 'var(--space-4)',
      }}
    >
      <span
        style={{
          fontSize: 'var(--font-size-sm)',
          fontWeight: 600,
          color: 'var(--color-text-muted)',
          flexShrink: 0,
          minWidth: 120,
        }}
      >
        {label}
      </span>
      <span
        style={{
          fontSize: 'var(--font-size-sm)',
          color: 'var(--color-text)',
          fontFamily: value.startsWith('/') ? 'monospace' : 'inherit',
          wordBreak: 'break-all',
          textAlign: 'right',
        }}
      >
        {value}
      </span>
    </div>
  );
}

/** Spinner dots animation shown during bridge startup. */
function LoadingDots() {
  const [dots, setDots] = useState('');

  useEffect(() => {
    const id = setInterval(() => {
      setDots((d) => (d.length >= 3 ? '' : d + '.'));
    }, 400);
    return () => clearInterval(id);
  }, []);

  return <span>{dots}</span>;
}

export default function FinishStep({ wizardData, onValidChange }: WizardStepProps) {
  const navigate = useNavigate();
  const [status, setStatus] = useState<StartStatus>('idle');
  const [errorMsg, setErrorMsg] = useState<string>('');

  // Finish step has no user input — it is always valid so Back button works.
  useEffect(() => {
    onValidChange(true);
  }, [onValidChange]);

  async function handleStart() {
    setStatus('generating');
    setErrorMsg('');

    try {
      const config = buildConfig(wizardData);
      const saveResult = await window.openbridge.saveConfig(config);
      if (!saveResult.success) {
        throw new Error('Failed to generate configuration');
      }

      setStatus('starting');
      const startResult = await window.openbridge.startBridge();
      if (!startResult.success) {
        throw new Error('Failed to start the OpenBridge process');
      }

      navigate('/dashboard');
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'An unexpected error occurred');
      setStatus('error');
    }
  }

  const isRunning = status === 'generating' || status === 'starting';

  // Summarise access control into a human-readable string.
  const accessSummary = wizardData.allowAll
    ? 'Allow everyone (no whitelist)'
    : wizardData.whitelist && wizardData.whitelist.length > 0
      ? `${wizardData.whitelist.length} number${wizardData.whitelist.length !== 1 ? 's' : ''} whitelisted`
      : '—';

  // Pick the best authenticated tool to show, or the first installed one.
  const primaryTool = wizardData.authenticatedTools?.[0] ?? wizardData.installedTools?.[0] ?? '—';

  const connectorLabel = wizardData.connectorType
    ? wizardData.connectorType.charAt(0).toUpperCase() + wizardData.connectorType.slice(1)
    : '—';

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
        Ready to Start
      </h2>

      <p
        style={{
          color: 'var(--color-text-muted)',
          fontSize: 'var(--font-size-base)',
          lineHeight: 1.6,
          marginBottom: 'var(--space-6)',
        }}
      >
        Review your configuration below, then click <strong>Start OpenBridge</strong> to generate{' '}
        <code style={{ fontFamily: 'monospace', fontSize: '0.9em' }}>config.json</code> and launch
        the bridge.
      </p>

      {/* Configuration summary */}
      <div
        style={{
          borderRadius: 'var(--radius-lg)',
          border: '1px solid var(--color-border)',
          backgroundColor: 'var(--color-surface)',
          padding: '0 var(--space-4)',
          marginBottom: 'var(--space-6)',
        }}
      >
        <SummaryRow label="Workspace" value={wizardData.workspacePath ?? '—'} />
        <SummaryRow label="AI Tool" value={primaryTool} />
        <SummaryRow label="Connector" value={connectorLabel} />
        <SummaryRow label="Access Control" value={accessSummary} />
      </div>

      {/* Error message */}
      {status === 'error' && (
        <div
          style={{
            display: 'flex',
            gap: 'var(--space-2)',
            alignItems: 'flex-start',
            padding: 'var(--space-3) var(--space-4)',
            marginBottom: 'var(--space-5)',
            borderRadius: 'var(--radius-md)',
            backgroundColor: 'rgba(239,68,68,0.08)',
            border: '1px solid rgba(239,68,68,0.3)',
          }}
        >
          <span style={{ fontSize: 16, flexShrink: 0 }}>⚠️</span>
          <div
            style={{
              fontSize: 'var(--font-size-sm)',
              color: 'var(--color-error)',
              lineHeight: 1.5,
            }}
          >
            <strong>Error:</strong> {errorMsg}
          </div>
        </div>
      )}

      {/* Start button + loading feedback */}
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'flex-start',
          gap: 'var(--space-3)',
        }}
      >
        <Button onClick={handleStart} disabled={isRunning}>
          {isRunning ? (
            <>
              {status === 'generating' ? 'Generating config' : 'Starting OpenBridge'}
              <LoadingDots />
            </>
          ) : status === 'error' ? (
            'Retry'
          ) : (
            'Start OpenBridge'
          )}
        </Button>

        {isRunning && (
          <p
            style={{
              fontSize: 'var(--font-size-sm)',
              color: 'var(--color-text-muted)',
              margin: 0,
            }}
          >
            {status === 'generating'
              ? 'Writing configuration file…'
              : 'Bridge is starting up — this may take a few seconds…'}
          </p>
        )}
      </div>
    </div>
  );
}
