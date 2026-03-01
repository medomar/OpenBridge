import { useEffect, useState } from 'react';
import { StatusBadge } from './StatusBadge';
import type { StatusBadgeStatus } from './StatusBadge';

// --- Types ---

interface WorkerData {
  workerId: string;
  task?: string;
  model?: string;
  toolProfile?: string;
  status: 'running' | 'completed' | 'failed';
  turnCount?: number;
  startedAt?: number;
}

// --- Display helpers ---

function formatElapsed(startedAt: number): string {
  const secs = Math.floor((Date.now() - startedAt) / 1000);
  if (secs < 60) return `${secs}s`;
  const mins = Math.floor(secs / 60);
  if (mins < 60) return `${mins}m ${secs % 60}s`;
  return `${Math.floor(mins / 60)}h ${mins % 60}m`;
}

function workerBadgeStatus(status: WorkerData['status']): StatusBadgeStatus {
  if (status === 'running') return 'warning';
  if (status === 'completed') return 'healthy';
  return 'error';
}

function workerBadgeLabel(status: WorkerData['status']): string {
  if (status === 'running') return 'Running';
  if (status === 'completed') return 'Done';
  return 'Failed';
}

// --- WorkerCard ---

/**
 * WorkerCard — live list of active worker agents, each showing task description,
 * model, tool profile, elapsed time, status (running / completed / failed), and turn count.
 *
 * Workers appear/disappear as Master spawns/completes them.
 * Data comes from IPC events (onWorkerUpdate) that relay agent_activity from the bridge.
 * Completed or failed workers are automatically removed after a 3 s grace period.
 */
export function WorkerCard() {
  const [workers, setWorkers] = useState<Map<string, WorkerData>>(new Map());
  // Periodic tick so elapsed times re-render without additional subscriptions
  const [, setTick] = useState(0);

  // Subscribe to worker updates from the bridge via IPC
  useEffect(() => {
    window.openbridge.onWorkerUpdate((raw) => {
      const w = raw as WorkerData;
      if (!w?.workerId) return;

      setWorkers((prev) => {
        const next = new Map(prev);
        next.set(w.workerId, w);
        return next;
      });

      // Remove completed / failed workers after 3 s so they visually fade out
      if (w.status === 'completed' || w.status === 'failed') {
        const id = w.workerId;
        setTimeout(() => {
          setWorkers((m) => {
            const updated = new Map(m);
            updated.delete(id);
            return updated;
          });
        }, 3000);
      }
    });
  }, []);

  // 1 s tick keeps the elapsed-time display current
  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), 1000);
    return () => clearInterval(id);
  }, []);

  if (workers.size === 0) {
    return (
      <p style={{ margin: 0, color: 'var(--color-text-muted)', fontSize: 'var(--font-size-sm)' }}>
        No active workers.
      </p>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
      {Array.from(workers.values()).map((w) => (
        <div
          key={w.workerId}
          style={{
            padding: 'var(--space-3)',
            borderRadius: 'var(--radius-md)',
            border: '1px solid var(--color-border)',
            background:
              w.status === 'completed'
                ? 'rgba(34,197,94,0.06)'
                : w.status === 'failed'
                  ? 'rgba(239,68,68,0.06)'
                  : 'transparent',
          }}
        >
          {/* Status badge + elapsed time */}
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              marginBottom: 'var(--space-2)',
            }}
          >
            <StatusBadge status={workerBadgeStatus(w.status)} label={workerBadgeLabel(w.status)} />
            {w.startedAt != null && (
              <span style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-text-muted)' }}>
                {formatElapsed(w.startedAt)}
              </span>
            )}
          </div>

          {/* Task description — truncated with full text on hover */}
          <p
            style={{
              margin: '0 0 var(--space-1)',
              fontSize: 'var(--font-size-sm)',
              color: 'var(--color-text)',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
            title={w.task}
          >
            {w.task ?? '(no description)'}
          </p>

          {/* Model · tool profile · turn count */}
          <div
            style={{
              display: 'flex',
              gap: 'var(--space-2)',
              fontSize: 'var(--font-size-sm)',
              color: 'var(--color-text-muted)',
              flexWrap: 'wrap',
            }}
          >
            {w.model != null && <span>{w.model}</span>}
            {w.toolProfile != null && <span>· {w.toolProfile}</span>}
            {w.turnCount != null && <span>· turn {w.turnCount}</span>}
          </div>
        </div>
      ))}
    </div>
  );
}
