export type StatusBadgeStatus = 'healthy' | 'error' | 'offline' | 'warning';

interface StatusBadgeProps {
  status: StatusBadgeStatus;
  label?: string;
}

const STATUS_COLORS: Record<StatusBadgeStatus, string> = {
  healthy: 'var(--color-success)',
  error: 'var(--color-error)',
  offline: 'var(--color-text-muted)',
  warning: 'var(--color-warning)',
};

const STATUS_LABELS: Record<StatusBadgeStatus, string> = {
  healthy: 'Healthy',
  error: 'Error',
  offline: 'Offline',
  warning: 'Warning',
};

export function StatusBadge({ status, label }: StatusBadgeProps) {
  const color = STATUS_COLORS[status];
  const displayLabel = label ?? STATUS_LABELS[status];

  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 'var(--space-1)',
        fontSize: 'var(--font-size-sm)',
        color: 'var(--color-text)',
      }}
    >
      <span
        style={{
          width: 8,
          height: 8,
          borderRadius: 'var(--radius-full)',
          backgroundColor: color,
          flexShrink: 0,
        }}
      />
      {displayLabel}
    </span>
  );
}
