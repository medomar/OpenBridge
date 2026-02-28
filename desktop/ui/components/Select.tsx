import { type SelectHTMLAttributes } from 'react';

interface SelectOption {
  value: string;
  label: string;
}

interface SelectProps extends SelectHTMLAttributes<HTMLSelectElement> {
  label: string;
  options: SelectOption[];
  placeholder?: string;
}

export function Select({ label, options, placeholder, id, style, ...rest }: SelectProps) {
  const selectId = id ?? label.toLowerCase().replace(/\s+/g, '-');

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-1)' }}>
      <label
        htmlFor={selectId}
        style={{
          fontSize: 'var(--font-size-sm)',
          fontWeight: 500,
          color: 'var(--color-text)',
        }}
      >
        {label}
      </label>
      <select
        id={selectId}
        style={{
          padding: 'var(--space-2) var(--space-3)',
          borderRadius: 'var(--radius-md)',
          border: '1px solid var(--color-border)',
          backgroundColor: 'var(--color-surface)',
          color: 'var(--color-text)',
          fontSize: 'var(--font-size-base)',
          outline: 'none',
          width: '100%',
          cursor: 'pointer',
          appearance: 'auto',
          ...style,
        }}
        {...rest}
      >
        {placeholder != null && (
          <option value="" disabled>
            {placeholder}
          </option>
        )}
        {options.map((opt) => (
          <option key={opt.value} value={opt.value}>
            {opt.label}
          </option>
        ))}
      </select>
    </div>
  );
}
