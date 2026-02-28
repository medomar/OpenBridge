import { type InputHTMLAttributes } from 'react';

export type InputValidationState = 'default' | 'valid' | 'invalid';

interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  label: string;
  validationState?: InputValidationState;
  errorMessage?: string;
  hint?: string;
}

const BORDER_COLORS: Record<InputValidationState, string> = {
  default: 'var(--color-border)',
  valid: 'var(--color-success)',
  invalid: 'var(--color-error)',
};

export function Input({
  label,
  validationState = 'default',
  errorMessage,
  hint,
  id,
  style,
  ...rest
}: InputProps) {
  const inputId = id ?? label.toLowerCase().replace(/\s+/g, '-');
  const borderColor = BORDER_COLORS[validationState];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-1)' }}>
      <label
        htmlFor={inputId}
        style={{
          fontSize: 'var(--font-size-sm)',
          fontWeight: 500,
          color: 'var(--color-text)',
        }}
      >
        {label}
      </label>
      <input
        id={inputId}
        style={{
          padding: 'var(--space-2) var(--space-3)',
          borderRadius: 'var(--radius-md)',
          border: `1px solid ${borderColor}`,
          backgroundColor: 'var(--color-surface)',
          color: 'var(--color-text)',
          fontSize: 'var(--font-size-base)',
          outline: 'none',
          width: '100%',
          transition: 'border-color 0.15s',
          ...style,
        }}
        {...rest}
      />
      {validationState === 'invalid' && errorMessage != null && (
        <span style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-error)' }}>
          {errorMessage}
        </span>
      )}
      {hint != null && validationState !== 'invalid' && (
        <span style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-text-muted)' }}>
          {hint}
        </span>
      )}
    </div>
  );
}
