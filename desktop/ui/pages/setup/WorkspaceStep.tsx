import { useEffect, useRef, useState } from 'react';
import { Button } from '../../components/Button';
import { Input } from '../../components/Input';
import { type WizardStepProps } from '../Setup';

type DirValidation = 'idle' | 'validating' | 'valid' | 'invalid';

export default function WorkspaceStep({ wizardData, onUpdate, onValidChange }: WizardStepProps) {
  const [path, setPath] = useState<string>(wizardData.workspacePath ?? '');
  const [validation, setValidation] = useState<DirValidation>('idle');
  const [errorMsg, setErrorMsg] = useState<string>('');
  const [browsing, setBrowsing] = useState<boolean>(false);

  // Track whether validation is for the current path to avoid stale updates
  const validatingForPath = useRef<string>('');

  async function validateDir(dirPath: string): Promise<void> {
    const trimmed = dirPath.trim();
    validatingForPath.current = trimmed;

    if (!trimmed) {
      setValidation('invalid');
      setErrorMsg('Please select or enter a workspace directory.');
      onValidChange(false);
      return;
    }

    setValidation('validating');
    setErrorMsg('');

    try {
      const result = await window.openbridge.validateDirectory(trimmed);
      // Ignore result if a newer validation has started
      if (validatingForPath.current !== trimmed) return;

      if (result.valid) {
        setValidation('valid');
        setErrorMsg('');
        onValidChange(true);
        onUpdate({ workspacePath: trimmed });
      } else {
        setValidation('invalid');
        setErrorMsg(result.error ?? 'Directory is not accessible.');
        onValidChange(false);
      }
    } catch {
      if (validatingForPath.current !== trimmed) return;
      setValidation('invalid');
      setErrorMsg('Could not validate directory — make sure you are running in Electron.');
      onValidChange(false);
    }
  }

  // On mount: populate from wizardData or default to home directory
  useEffect(() => {
    const existing = wizardData.workspacePath ?? '';
    if (existing) {
      // Already selected in a previous visit to this step
      void validateDir(existing);
      return;
    }

    window.openbridge
      .getHomeDirectory()
      .then((home) => {
        if (home) {
          setPath(home);
          void validateDir(home);
        }
      })
      .catch(() => {
        // Not running in Electron (e.g., browser dev preview) — leave empty
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // intentionally empty: component is re-mounted per wizard step (key prop in Setup.tsx)

  function handleChange(e: React.ChangeEvent<HTMLInputElement>): void {
    const value = e.target.value;
    setPath(value);
    // Reset validation until the user commits (onBlur)
    setValidation('idle');
    setErrorMsg('');
    onValidChange(false);
  }

  function handleBlur(): void {
    void validateDir(path);
  }

  async function handleBrowse(): Promise<void> {
    setBrowsing(true);
    try {
      const result = await window.openbridge.selectDirectory();
      if (result.path) {
        setPath(result.path);
        await validateDir(result.path);
      }
    } catch {
      // IPC unavailable (browser dev preview)
    } finally {
      setBrowsing(false);
    }
  }

  const inputValidation =
    validation === 'valid' ? 'valid' : validation === 'invalid' ? 'invalid' : 'default';

  // Adjust bottom margin of Browse button to align with input when error is shown
  const browseMarginBottom = validation === 'invalid' && errorMsg ? 22 : 0;

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
        Choose Workspace
      </h2>

      <p
        style={{
          color: 'var(--color-text-muted)',
          fontSize: 'var(--font-size-base)',
          lineHeight: 1.6,
          marginBottom: 'var(--space-6)',
        }}
      >
        Select the project directory that OpenBridge will explore and work in. The Master AI will
        run inside this folder with full access to its files.
      </p>

      {/* Path input + Browse button */}
      <div
        style={{
          display: 'flex',
          gap: 'var(--space-2)',
          alignItems: 'flex-end',
        }}
      >
        <div style={{ flex: 1 }}>
          <Input
            label="Workspace Directory"
            placeholder="/path/to/your/project"
            value={path}
            onChange={handleChange}
            onBlur={handleBlur}
            validationState={inputValidation}
            errorMessage={errorMsg}
            hint={validation === 'validating' ? 'Checking directory…' : undefined}
          />
        </div>

        <Button
          variant="secondary"
          onClick={() => {
            void handleBrowse();
          }}
          disabled={browsing}
          style={{ flexShrink: 0, marginBottom: browseMarginBottom }}
        >
          {browsing ? 'Opening…' : 'Browse'}
        </Button>
      </div>

      {/* Resolved absolute path confirmation */}
      {validation === 'valid' && path && (
        <div
          style={{
            marginTop: 'var(--space-3)',
            padding: 'var(--space-2) var(--space-3)',
            backgroundColor: 'rgba(34,197,94,0.08)',
            borderRadius: 'var(--radius-md)',
            fontSize: 'var(--font-size-sm)',
            color: 'var(--color-success)',
            display: 'flex',
            alignItems: 'center',
            gap: 'var(--space-2)',
            fontWeight: 500,
          }}
        >
          <span>✓</span>
          <span
            style={{
              flex: 1,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
              fontFamily: 'monospace',
              fontWeight: 400,
              color: 'var(--color-text)',
            }}
          >
            {path}
          </span>
        </div>
      )}

      {/* Explanatory note */}
      <p
        style={{
          marginTop: 'var(--space-5)',
          fontSize: 'var(--font-size-sm)',
          color: 'var(--color-text-muted)',
          lineHeight: 1.5,
        }}
      >
        OpenBridge creates a <code style={{ fontFamily: 'monospace' }}>.openbridge/</code> folder
        inside this directory to store exploration data and memory. Your existing project files are
        not modified.
      </p>
    </div>
  );
}
