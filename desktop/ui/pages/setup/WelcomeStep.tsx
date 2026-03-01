import { useEffect, useState } from 'react';
import { Button } from '../../components/Button';
import { type WizardStepProps } from '../Setup';

interface PrerequisiteInfo {
  os: string;
  nodeVersion: string;
  nodeOk: boolean;
}

export default function WelcomeStep({ onValidChange, onNext }: WizardStepProps) {
  const [info, setInfo] = useState<PrerequisiteInfo | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    window.openbridge
      .detectPrerequisites()
      .then((result) => {
        setInfo(result);
        // Welcome step is always navigable — warn on bad Node but don't block
        onValidChange(true);
      })
      .catch(() => {
        // IPC unavailable (e.g., running outside Electron in browser dev) — still proceed
        setInfo(null);
        onValidChange(true);
      })
      .finally(() => {
        setLoading(false);
      });
  }, [onValidChange]);

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        textAlign: 'center',
        maxWidth: 520,
        margin: '0 auto',
        paddingTop: 'var(--space-12)',
      }}
    >
      {/* Logo */}
      <div
        style={{
          width: 80,
          height: 80,
          borderRadius: 'var(--radius-lg)',
          backgroundColor: 'var(--color-accent)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontSize: 40,
          marginBottom: 'var(--space-6)',
          boxShadow: 'var(--shadow-md)',
        }}
      >
        🌉
      </div>

      <h1
        style={{
          fontSize: 28,
          fontWeight: 700,
          color: 'var(--color-text)',
          marginBottom: 'var(--space-4)',
          lineHeight: 1.2,
        }}
      >
        Welcome to OpenBridge
      </h1>

      <p
        style={{
          color: 'var(--color-text-muted)',
          fontSize: 'var(--font-size-lg)',
          lineHeight: 1.6,
          marginBottom: 'var(--space-8)',
        }}
      >
        AI Bridge connects your messaging apps to AI tools on your machine. Zero API keys. Zero
        extra cost.
      </p>

      {/* System info */}
      <div
        style={{
          width: '100%',
          backgroundColor: 'var(--color-surface-raised)',
          borderRadius: 'var(--radius-md)',
          padding: 'var(--space-4)',
          marginBottom: 'var(--space-8)',
          fontSize: 'var(--font-size-sm)',
          color: 'var(--color-text-muted)',
        }}
      >
        {loading ? (
          <span>Checking system requirements…</span>
        ) : info ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span>Operating system</span>
              <span style={{ color: 'var(--color-text)', fontWeight: 500 }}>{info.os}</span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span>Node.js version</span>
              <span
                style={{
                  color: info.nodeOk ? 'var(--color-success)' : 'var(--color-warning)',
                  fontWeight: 500,
                  display: 'flex',
                  alignItems: 'center',
                  gap: 'var(--space-1)',
                }}
              >
                {info.nodeVersion}
                {info.nodeOk ? ' ✓' : ' ⚠'}
              </span>
            </div>
            {!info.nodeOk && (
              <p
                style={{
                  marginTop: 'var(--space-2)',
                  color: 'var(--color-warning)',
                  fontSize: 'var(--font-size-sm)',
                  textAlign: 'left',
                }}
              >
                Node.js 22 or newer is required.{' '}
                <a href="https://nodejs.org" target="_blank" rel="noreferrer">
                  Download at nodejs.org
                </a>
              </p>
            )}
          </div>
        ) : (
          <span>Could not detect system info — make sure you are running in Electron.</span>
        )}
      </div>

      <Button
        onClick={onNext}
        disabled={loading}
        style={{ padding: '10px 36px', fontSize: 'var(--font-size-base)' }}
      >
        Get Started
      </Button>
    </div>
  );
}
