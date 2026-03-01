import { type ReactNode } from 'react';

interface CardProps {
  title?: string;
  children: ReactNode;
  style?: React.CSSProperties;
}

export function Card({ title, children, style }: CardProps) {
  return (
    <div
      style={{
        backgroundColor: 'var(--color-surface)',
        border: '1px solid var(--color-border)',
        borderRadius: 'var(--radius-lg)',
        boxShadow: 'var(--shadow-md)',
        overflow: 'hidden',
        ...style,
      }}
    >
      {title != null && (
        <div
          style={{
            padding: 'var(--space-4) var(--space-6)',
            borderBottom: '1px solid var(--color-border)',
            fontWeight: 600,
            fontSize: 'var(--font-size-base)',
            color: 'var(--color-text)',
          }}
        >
          {title}
        </div>
      )}
      <div style={{ padding: 'var(--space-6)' }}>{children}</div>
    </div>
  );
}
