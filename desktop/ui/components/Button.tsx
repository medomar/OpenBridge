import { type ButtonHTMLAttributes } from 'react';

export type ButtonVariant = 'primary' | 'secondary' | 'danger';

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
}

const VARIANT_STYLES: Record<ButtonVariant, React.CSSProperties> = {
  primary: {
    backgroundColor: 'var(--color-accent)',
    color: '#ffffff',
    border: '1px solid transparent',
  },
  secondary: {
    backgroundColor: 'transparent',
    color: 'var(--color-text)',
    border: '1px solid var(--color-border)',
  },
  danger: {
    backgroundColor: 'var(--color-error)',
    color: '#ffffff',
    border: '1px solid transparent',
  },
};

export function Button({ variant = 'primary', style, disabled, children, ...rest }: ButtonProps) {
  const variantStyle = VARIANT_STYLES[variant];

  return (
    <button
      disabled={disabled}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 'var(--space-2)',
        padding: 'var(--space-2) var(--space-4)',
        borderRadius: 'var(--radius-md)',
        fontSize: 'var(--font-size-sm)',
        fontWeight: 500,
        cursor: disabled ? 'not-allowed' : 'pointer',
        opacity: disabled ? 0.5 : 1,
        transition: 'opacity 0.15s, background-color 0.15s',
        lineHeight: 1.5,
        ...variantStyle,
        ...style,
      }}
      {...rest}
    >
      {children}
    </button>
  );
}
