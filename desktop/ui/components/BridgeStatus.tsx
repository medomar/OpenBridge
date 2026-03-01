import { useEffect, useState } from 'react';
import { Button } from './Button';

type BridgeRunState = 'starting' | 'running' | 'stopping' | 'stopped' | 'error';

interface WorkerEvent {
  workerId: string;
  status: 'running' | 'completed' | 'failed';
}

const STATE_DOT_COLOR: Record<BridgeRunState, string> = {
  running: 'var(--color-success)',
  error: 'var(--color-error)',
  starting: 'var(--color-warning)',
  stopping: 'var(--color-warning)',
  stopped: 'var(--color-text-muted)',
};

const STATE_LABEL: Record<BridgeRunState, string> = {
  running: 'Running',
  error: 'Error',
  starting: 'Starting…',
  stopping: 'Stopping…',
  stopped: 'Stopped',
};

function formatUptime(elapsedMs: number): string {
  const secs = Math.floor(elapsedMs / 1000);
  if (secs < 60) return `${secs}s`;
  const mins = Math.floor(secs / 60);
  if (mins < 60) return `${mins}m ${secs % 60}s`;
  return `${Math.floor(mins / 60)}h ${mins % 60}m`;
}

/**
 * BridgeStatus — displays bridge running state with a pulsing indicator,
 * uptime, connected channels count, active workers count, and
 * Start / Restart / Stop control buttons.
 *
 * Receives live data via IPC events from bridge-process.ts:
 *   - polls getBridgeStatus() every 5 s for the current state
 *   - subscribes to onWorkerUpdate() for active worker tracking
 */
export function BridgeStatus() {
  const [status, setStatus] = useState<BridgeRunState>('stopped');
  const [isActionPending, setIsActionPending] = useState(false);
  const [startedAt, setStartedAt] = useState<number | null>(null);
  const [activeWorkerCount, setActiveWorkerCount] = useState(0);
  const [channelCount, setChannelCount] = useState(0);
  // Triggers re-render every second so the uptime display stays current
  const [, setTick] = useState(0);

  // Poll bridge status every 5 s
  useEffect(() => {
    const poll = () => {
      window.openbridge
        .getBridgeStatus()
        .then(({ status: s }) => setStatus(s as BridgeRunState))
        .catch(() => setStatus('error'));
    };
    poll();
    const id = setInterval(poll, 5000);
    return () => clearInterval(id);
  }, []);

  // Track uptime — record start time when bridge transitions to 'running'
  useEffect(() => {
    if (status === 'running') {
      setStartedAt((prev) => prev ?? Date.now());
    } else {
      setStartedAt(null);
    }
  }, [status]);

  // Load channel count from config once on mount
  useEffect(() => {
    window.openbridge
      .getConfig()
      .then((cfg) => {
        if (cfg != null && typeof cfg === 'object' && 'channels' in cfg) {
          const raw = (cfg as { channels: unknown }).channels;
          if (Array.isArray(raw)) setChannelCount(raw.length);
        }
      })
      .catch(() => {});
  }, []);

  // Count active workers via IPC events from the bridge
  useEffect(() => {
    const workers = new Map<string, WorkerEvent['status']>();

    window.openbridge.onWorkerUpdate((raw) => {
      const w = raw as WorkerEvent;
      if (!w?.workerId) return;

      workers.set(w.workerId, w.status);

      if (w.status === 'completed' || w.status === 'failed') {
        const id = w.workerId;
        setTimeout(() => {
          workers.delete(id);
          setActiveWorkerCount(Array.from(workers.values()).filter((s) => s === 'running').length);
        }, 3000);
      }

      setActiveWorkerCount(Array.from(workers.values()).filter((s) => s === 'running').length);
    });
  }, []);

  // 1 s tick to keep the uptime counter fresh
  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), 1000);
    return () => clearInterval(id);
  }, []);

  const isRunning = status === 'running';
  const isTransitioning = status === 'starting' || status === 'stopping';
  const controlsDisabled = isActionPending || isTransitioning;

  const uptime = isRunning && startedAt != null ? formatUptime(Date.now() - startedAt) : null;

  const handleStart = async () => {
    setIsActionPending(true);
    try {
      await window.openbridge.startBridge();
      setStatus('starting');
    } finally {
      setIsActionPending(false);
    }
  };

  const handleStop = async () => {
    setIsActionPending(true);
    try {
      await window.openbridge.stopBridge();
      setStatus('stopping');
    } finally {
      setIsActionPending(false);
    }
  };

  const handleRestart = async () => {
    setIsActionPending(true);
    try {
      await window.openbridge.stopBridge();
      setStatus('stopped');
      await window.openbridge.startBridge();
      setStatus('starting');
    } finally {
      setIsActionPending(false);
    }
  };

  return (
    <>
      {/* Keyframe injected once — scoped name avoids conflicts with other components */}
      <style>{`
        @keyframes ob-bridge-pulse {
          0%, 100% { opacity: 1; transform: scale(1); }
          50%       { opacity: 0.5; transform: scale(1.35); }
        }
      `}</style>

      <div
        style={{
          backgroundColor: 'var(--color-surface)',
          border: '1px solid var(--color-border)',
          borderRadius: 'var(--radius-lg)',
          boxShadow: 'var(--shadow-md)',
          padding: 'var(--space-4) var(--space-6)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 'var(--space-6)',
        }}
      >
        {/* Left section — indicator dot, state label, uptime, counts */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-6)' }}>
          {/* Pulsing dot + state label */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
            <span
              style={{
                width: 10,
                height: 10,
                borderRadius: 'var(--radius-full)',
                backgroundColor: STATE_DOT_COLOR[status],
                display: 'inline-block',
                flexShrink: 0,
                animation: isRunning ? 'ob-bridge-pulse 2s ease-in-out infinite' : 'none',
              }}
            />
            <span
              style={{
                fontWeight: 600,
                fontSize: 'var(--font-size-base)',
                color: 'var(--color-text)',
              }}
            >
              {STATE_LABEL[status]}
            </span>
          </div>

          {/* Uptime — only shown while running */}
          {uptime != null && (
            <span style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-text-muted)' }}>
              up {uptime}
            </span>
          )}

          {/* Channels + active workers */}
          <div
            style={{
              display: 'flex',
              gap: 'var(--space-4)',
              fontSize: 'var(--font-size-sm)',
              color: 'var(--color-text-muted)',
            }}
          >
            <span>
              {channelCount} channel{channelCount !== 1 ? 's' : ''}
            </span>
            <span>
              {activeWorkerCount} worker{activeWorkerCount !== 1 ? 's' : ''} active
            </span>
          </div>
        </div>

        {/* Right section — Start / Restart / Stop buttons */}
        <div style={{ display: 'flex', gap: 'var(--space-2)' }}>
          <Button
            variant="primary"
            onClick={() => void handleStart()}
            disabled={controlsDisabled || isRunning}
          >
            Start
          </Button>
          <Button
            variant="secondary"
            onClick={() => void handleRestart()}
            disabled={controlsDisabled || !isRunning}
          >
            Restart
          </Button>
          <Button
            variant="danger"
            onClick={() => void handleStop()}
            disabled={controlsDisabled || !isRunning}
          >
            Stop
          </Button>
        </div>
      </div>
    </>
  );
}
