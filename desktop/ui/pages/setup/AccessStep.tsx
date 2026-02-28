import { useEffect, useState } from 'react';
import { type WizardStepProps } from '../Setup';

/** Loose phone-number validation: optional leading +, then 7–15 digits. */
function isValidPhone(raw: string): boolean {
  return /^\+?\d{7,15}$/.test(raw.trim());
}

/** Parse a comma-separated phone number string into a deduplicated, trimmed array. */
function parseNumbers(raw: string): string[] {
  return [
    ...new Set(
      raw
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean),
    ),
  ];
}

/** Validate each number in the parsed list, returning an array of invalid entries. */
function findInvalid(numbers: string[]): string[] {
  return numbers.filter((n) => !isValidPhone(n));
}

function isStepValid(allowAll: boolean, numbers: string[], rawInput: string): boolean {
  if (allowAll) return true;
  if (!rawInput.trim()) return false; // at least one number required when not allowing all
  return numbers.length > 0 && findInvalid(numbers).length === 0;
}

export default function AccessStep({ wizardData, onUpdate, onValidChange }: WizardStepProps) {
  const [allowAll, setAllowAll] = useState<boolean>(wizardData.allowAll ?? false);
  const [rawInput, setRawInput] = useState<string>(
    wizardData.whitelist ? wizardData.whitelist.join(', ') : '',
  );
  const [dirty, setDirty] = useState(false);

  const numbers = parseNumbers(rawInput);
  const invalidNumbers = dirty ? findInvalid(numbers) : [];
  const stepValid = isStepValid(allowAll, numbers, rawInput);

  // Notify parent of validity on every change
  useEffect(() => {
    onValidChange(stepValid);
  }, [stepValid, onValidChange]);

  function handleAllowAllToggle() {
    const next = !allowAll;
    setAllowAll(next);
    onUpdate({
      allowAll: next,
      whitelist: next ? [] : numbers,
    });
  }

  function handleInputChange(e: React.ChangeEvent<HTMLTextAreaElement>) {
    const value = e.target.value;
    setRawInput(value);
    setDirty(false); // reset error display while typing
    const parsed = parseNumbers(value);
    onUpdate({ whitelist: parsed, allowAll: false });
  }

  function handleInputBlur() {
    setDirty(true);
  }

  const hasInvalid = invalidNumbers.length > 0;

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
        Access Control
      </h2>

      <p
        style={{
          color: 'var(--color-text-muted)',
          fontSize: 'var(--font-size-base)',
          lineHeight: 1.6,
          marginBottom: 'var(--space-6)',
        }}
      >
        Restrict which phone numbers can send commands to OpenBridge. Only whitelisted numbers will
        get a response.
      </p>

      {/* Allow Everyone toggle */}
      <div
        style={{
          display: 'flex',
          alignItems: 'flex-start',
          gap: 'var(--space-3)',
          padding: 'var(--space-4)',
          borderRadius: 'var(--radius-lg)',
          border: `2px solid ${allowAll ? 'var(--color-warning)' : 'var(--color-border)'}`,
          backgroundColor: allowAll ? 'rgba(234,179,8,0.06)' : 'var(--color-surface)',
          marginBottom: 'var(--space-5)',
          cursor: 'pointer',
        }}
        onClick={handleAllowAllToggle}
        role="checkbox"
        aria-checked={allowAll}
        tabIndex={0}
        onKeyDown={(e) => {
          if (e.key === ' ' || e.key === 'Enter') handleAllowAllToggle();
        }}
      >
        {/* Custom toggle */}
        <div
          style={{
            flexShrink: 0,
            marginTop: 2,
            width: 40,
            height: 22,
            borderRadius: 11,
            backgroundColor: allowAll ? 'var(--color-warning)' : 'var(--color-border)',
            position: 'relative',
            transition: 'background-color 0.2s',
          }}
        >
          <div
            style={{
              position: 'absolute',
              top: 3,
              left: allowAll ? 21 : 3,
              width: 16,
              height: 16,
              borderRadius: '50%',
              backgroundColor: '#ffffff',
              transition: 'left 0.2s',
              boxShadow: '0 1px 3px rgba(0,0,0,0.2)',
            }}
          />
        </div>

        <div>
          <div
            style={{
              fontSize: 'var(--font-size-base)',
              fontWeight: 600,
              color: allowAll ? 'var(--color-warning)' : 'var(--color-text)',
            }}
          >
            Allow everyone
          </div>
          <div
            style={{
              fontSize: 'var(--font-size-sm)',
              color: 'var(--color-text-muted)',
              lineHeight: 1.4,
              marginTop: 'var(--space-1)',
            }}
          >
            Any phone number can send commands — not recommended for production
          </div>
        </div>
      </div>

      {/* Security warning when Allow All is on */}
      {allowAll && (
        <div
          style={{
            display: 'flex',
            gap: 'var(--space-2)',
            alignItems: 'flex-start',
            padding: 'var(--space-3) var(--space-4)',
            marginBottom: 'var(--space-5)',
            borderRadius: 'var(--radius-md)',
            backgroundColor: 'rgba(234,179,8,0.12)',
            border: '1px solid rgba(234,179,8,0.4)',
          }}
        >
          <span style={{ fontSize: 16, flexShrink: 0 }}>⚠️</span>
          <div
            style={{
              fontSize: 'var(--font-size-sm)',
              color: 'var(--color-text)',
              lineHeight: 1.5,
            }}
          >
            <strong>Security warning:</strong> Anyone who knows your phone number (or bot handle)
            can control your AI bridge and access your workspace. Enable whitelist if this is a
            shared or public environment.
          </div>
        </div>
      )}

      {/* Phone whitelist input — shown when Allow All is off */}
      {!allowAll && (
        <>
          <label
            htmlFor="whitelist-input"
            style={{
              display: 'block',
              fontSize: 'var(--font-size-sm)',
              fontWeight: 600,
              color: 'var(--color-text)',
              marginBottom: 'var(--space-1)',
            }}
          >
            Allowed Phone Numbers
          </label>

          <p
            style={{
              fontSize: 'var(--font-size-sm)',
              color: 'var(--color-text-muted)',
              marginBottom: 'var(--space-2)',
            }}
          >
            Enter phone numbers separated by commas. Include the country code (e.g.{' '}
            <code style={{ fontFamily: 'monospace' }}>+15551234567</code>).
          </p>

          <textarea
            id="whitelist-input"
            value={rawInput}
            onChange={handleInputChange}
            onBlur={handleInputBlur}
            placeholder="+15551234567, +447911123456, +33612345678"
            rows={4}
            style={{
              width: '100%',
              boxSizing: 'border-box',
              padding: 'var(--space-3)',
              borderRadius: 'var(--radius-md)',
              border: `1.5px solid ${hasInvalid ? 'var(--color-error)' : 'var(--color-border)'}`,
              backgroundColor: 'var(--color-surface)',
              color: 'var(--color-text)',
              fontFamily: 'monospace',
              fontSize: 'var(--font-size-sm)',
              lineHeight: 1.6,
              resize: 'vertical',
              outline: 'none',
            }}
          />

          {/* Validation error */}
          {hasInvalid && (
            <p
              style={{
                marginTop: 'var(--space-1)',
                fontSize: 'var(--font-size-sm)',
                color: 'var(--color-error)',
              }}
            >
              Invalid number{invalidNumbers.length > 1 ? 's' : ''}:{' '}
              {invalidNumbers.map((n) => `"${n}"`).join(', ')} — use digits with optional + prefix
            </p>
          )}

          {/* Formatted preview */}
          {numbers.length > 0 && !hasInvalid && (
            <div
              style={{
                marginTop: 'var(--space-4)',
                padding: 'var(--space-3) var(--space-4)',
                borderRadius: 'var(--radius-md)',
                backgroundColor: 'rgba(34,197,94,0.08)',
                border: '1px solid rgba(34,197,94,0.2)',
              }}
            >
              <div
                style={{
                  fontSize: 'var(--font-size-sm)',
                  fontWeight: 600,
                  color: 'var(--color-success)',
                  marginBottom: 'var(--space-2)',
                }}
              >
                ✓ {numbers.length} number{numbers.length !== 1 ? 's' : ''} whitelisted
              </div>
              <ul style={{ margin: 0, padding: '0 0 0 var(--space-4)' }}>
                {numbers.map((n) => (
                  <li
                    key={n}
                    style={{
                      fontFamily: 'monospace',
                      fontSize: 'var(--font-size-sm)',
                      color: 'var(--color-text)',
                      lineHeight: 1.7,
                    }}
                  >
                    {n}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Empty state hint */}
          {rawInput.trim() === '' && (
            <p
              style={{
                marginTop: 'var(--space-2)',
                fontSize: 'var(--font-size-sm)',
                color: 'var(--color-text-muted)',
              }}
            >
              Add at least one phone number to proceed, or enable "Allow everyone" above.
            </p>
          )}
        </>
      )}
    </div>
  );
}
