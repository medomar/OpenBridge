import { useEffect, useRef, useState } from 'react';
import { Button } from '../components/Button';
import { StatusBadge } from '../components/StatusBadge';
import type { StatusBadgeStatus } from '../components/StatusBadge';

// --- Types ---

type BridgeRunState = 'starting' | 'running' | 'stopping' | 'stopped' | 'error';

interface WorkerUpdate {
  workerId: string;
  task?: string;
  model?: string;
  toolProfile?: string;
  status: 'running' | 'completed' | 'failed';
  turnCount?: number;
  startedAt?: number;
}

interface ChatMessage {
  id?: string;
  sender?: string;
  channel?: string;
  text?: string;
  isFromUser?: boolean;
  timestamp?: number;
}

interface ChannelConfig {
  type: string;
  enabled?: boolean;
}

// --- Display helpers ---

const CHANNEL_NAMES: Record<string, string> = {
  whatsapp: 'WhatsApp',
  telegram: 'Telegram',
  discord: 'Discord',
  webchat: 'WebChat',
  console: 'Console',
};

const CHANNEL_ICONS: Record<string, string> = {
  whatsapp: '📱',
  telegram: '✈️',
  discord: '🎮',
  webchat: '🌐',
  console: '⌨️',
};

function bridgeStateToStatus(state: BridgeRunState): StatusBadgeStatus {
  if (state === 'running') return 'healthy';
  if (state === 'error') return 'error';
  if (state === 'starting' || state === 'stopping') return 'warning';
  return 'offline';
}

function bridgeStateLabel(state: BridgeRunState): string {
  switch (state) {
    case 'starting':
      return 'Starting…';
    case 'stopping':
      return 'Stopping…';
    case 'running':
      return 'Running';
    case 'error':
      return 'Error';
    default:
      return 'Stopped';
  }
}

function formatElapsed(startedAt: number): string {
  const secs = Math.floor((Date.now() - startedAt) / 1000);
  if (secs < 60) return `${secs}s`;
  const mins = Math.floor(secs / 60);
  if (mins < 60) return `${mins}m ${secs % 60}s`;
  return `${Math.floor(mins / 60)}h ${mins % 60}m`;
}

function formatTime(ts: number): string {
  return new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

// --- Panel: Card-like container with flex layout for scrollable content ---

interface PanelProps {
  title?: string;
  children: React.ReactNode;
  style?: React.CSSProperties;
}

function Panel({ title, children, style }: PanelProps) {
  return (
    <div
      style={{
        backgroundColor: 'var(--color-surface)',
        border: '1px solid var(--color-border)',
        borderRadius: 'var(--radius-lg)',
        boxShadow: 'var(--shadow-md)',
        display: 'flex',
        flexDirection: 'column',
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
            flexShrink: 0,
          }}
        >
          {title}
        </div>
      )}
      <div
        style={{
          padding: 'var(--space-4) var(--space-6)',
          flex: 1,
          overflowY: 'auto',
          minHeight: 0,
        }}
      >
        {children}
      </div>
    </div>
  );
}

// --- Dashboard ---

export default function Dashboard() {
  const [bridgeStatus, setBridgeStatus] = useState<BridgeRunState>('stopped');
  const [isToggling, setIsToggling] = useState(false);
  const [channels, setChannels] = useState<ChannelConfig[]>([]);
  const [workers, setWorkers] = useState<Map<string, WorkerUpdate>>(new Map());
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  // Drives periodic re-render so elapsed times on worker cards stay current
  const [, setTick] = useState(0);

  // Poll bridge status every 5 s
  useEffect(() => {
    const poll = () => {
      window.openbridge
        .getBridgeStatus()
        .then(({ status }) => setBridgeStatus(status as BridgeRunState))
        .catch(() => setBridgeStatus('error'));
    };
    poll();
    const id = setInterval(poll, 5000);
    return () => clearInterval(id);
  }, []);

  // Load channel list from config
  useEffect(() => {
    window.openbridge
      .getConfig()
      .then((cfg) => {
        if (cfg != null && typeof cfg === 'object' && 'channels' in cfg) {
          const raw = (cfg as { channels: unknown }).channels;
          if (Array.isArray(raw)) setChannels(raw as ChannelConfig[]);
        }
      })
      .catch(() => {});
  }, []);

  // Subscribe to worker updates from the bridge
  useEffect(() => {
    window.openbridge.onWorkerUpdate((raw) => {
      const w = raw as WorkerUpdate;
      if (!w?.workerId) return;
      setWorkers((prev) => {
        const next = new Map(prev);
        next.set(w.workerId, w);
        // Remove completed/failed workers after 3 s so they fade out naturally
        if (w.status === 'completed' || w.status === 'failed') {
          setTimeout(() => {
            setWorkers((m) => {
              const updated = new Map(m);
              updated.delete(w.workerId);
              return updated;
            });
          }, 3000);
        }
        return next;
      });
    });
  }, []);

  // Subscribe to incoming messages
  useEffect(() => {
    window.openbridge.onMessageReceived((raw) => {
      const m = raw as ChatMessage;
      if (m == null) return;
      const msg: ChatMessage = { ...m, id: m.id ?? `${Date.now()}-${Math.random()}` };
      setMessages((prev) => [...prev, msg].slice(-100)); // keep last 100
    });
  }, []);

  // Auto-scroll messages panel to bottom on new message
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // 1 s tick to keep elapsed times fresh without additional subscriptions
  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), 1000);
    return () => clearInterval(id);
  }, []);

  const handleToggleBridge = async () => {
    setIsToggling(true);
    try {
      if (bridgeStatus === 'running') {
        await window.openbridge.stopBridge();
        setBridgeStatus('stopping');
      } else {
        await window.openbridge.startBridge();
        setBridgeStatus('starting');
      }
    } finally {
      setIsToggling(false);
    }
  };

  const isRunning = bridgeStatus === 'running';
  const isTransitioning = bridgeStatus === 'starting' || bridgeStatus === 'stopping';
  const activeWorkerCount = Array.from(workers.values()).filter(
    (w) => w.status === 'running',
  ).length;

  return (
    <div
      style={{
        display: 'grid',
        gridTemplateRows: 'auto 1fr',
        height: '100%',
        gap: 'var(--space-4)',
        minHeight: 0,
      }}
    >
      {/* ── Top bar ── bridge status + start/stop control */}
      <div
        style={{
          backgroundColor: 'var(--color-surface)',
          border: '1px solid var(--color-border)',
          borderRadius: 'var(--radius-lg)',
          boxShadow: 'var(--shadow-md)',
          padding: 'var(--space-3) var(--space-6)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 'var(--space-4)',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-4)' }}>
          <StatusBadge
            status={bridgeStateToStatus(bridgeStatus)}
            label={bridgeStateLabel(bridgeStatus)}
          />
          <span style={{ color: 'var(--color-text-muted)', fontSize: 'var(--font-size-sm)' }}>
            {activeWorkerCount > 0
              ? `${activeWorkerCount} worker${activeWorkerCount === 1 ? '' : 's'} active`
              : isRunning
                ? 'Idle'
                : 'Bridge is not running'}
          </span>
        </div>
        <Button
          variant={isRunning ? 'danger' : 'primary'}
          onClick={() => void handleToggleBridge()}
          disabled={isToggling || isTransitioning}
        >
          {isTransitioning
            ? bridgeStatus === 'stopping'
              ? 'Stopping…'
              : 'Starting…'
            : isRunning
              ? 'Stop Bridge'
              : 'Start Bridge'}
        </Button>
      </div>

      {/* ── 3-column body: channels | messages | workers ── */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: '220px 1fr 260px',
          gap: 'var(--space-4)',
          minHeight: 0,
          overflow: 'hidden',
        }}
      >
        {/* Left — connected channels */}
        <Panel title="Channels">
          {channels.length === 0 ? (
            <p
              style={{
                margin: 0,
                color: 'var(--color-text-muted)',
                fontSize: 'var(--font-size-sm)',
              }}
            >
              No channels configured.
            </p>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
              {channels.map((ch) => (
                <div
                  key={ch.type}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 'var(--space-3)',
                    padding: 'var(--space-3) 0',
                    borderBottom: '1px solid var(--color-border)',
                  }}
                >
                  <span style={{ fontSize: 20, lineHeight: 1 }}>
                    {CHANNEL_ICONS[ch.type] ?? '📡'}
                  </span>
                  <div>
                    <div
                      style={{
                        fontWeight: 500,
                        fontSize: 'var(--font-size-sm)',
                        color: 'var(--color-text)',
                        marginBottom: 'var(--space-1)',
                      }}
                    >
                      {CHANNEL_NAMES[ch.type] ?? ch.type}
                    </div>
                    <StatusBadge
                      status={isRunning && ch.enabled !== false ? 'healthy' : 'offline'}
                      label={isRunning && ch.enabled !== false ? 'Connected' : 'Disconnected'}
                    />
                  </div>
                </div>
              ))}
            </div>
          )}
        </Panel>

        {/* Center — recent messages */}
        <Panel title="Messages">
          {messages.length === 0 ? (
            <p
              style={{
                margin: 0,
                color: 'var(--color-text-muted)',
                fontSize: 'var(--font-size-sm)',
                textAlign: 'center',
                paddingTop: 'var(--space-8)',
              }}
            >
              No messages yet. Start the bridge and send a message.
            </p>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
              {messages.map((msg) => {
                const id = msg.id ?? '';
                const isExpanded = expandedId === id;
                const text = msg.text ?? '';
                const preview = text.length > 200 ? `${text.slice(0, 200)}…` : text;
                const isUser = msg.isFromUser ?? false;
                return (
                  <div
                    key={id}
                    onClick={() => text.length > 200 && setExpandedId(isExpanded ? null : id)}
                    style={{
                      padding: 'var(--space-3)',
                      borderRadius: 'var(--radius-md)',
                      borderLeft: `3px solid ${isUser ? 'var(--color-accent)' : 'var(--color-success)'}`,
                      background: isUser ? 'rgba(59,130,246,0.06)' : 'rgba(34,197,94,0.06)',
                      cursor: text.length > 200 ? 'pointer' : 'default',
                    }}
                  >
                    <div
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: 'var(--space-2)',
                        marginBottom: 'var(--space-1)',
                      }}
                    >
                      <span
                        style={{
                          fontSize: 'var(--font-size-sm)',
                          color: 'var(--color-text-muted)',
                        }}
                      >
                        {CHANNEL_ICONS[msg.channel ?? ''] ?? '💬'} {msg.sender ?? 'Unknown'}
                      </span>
                      <span
                        style={{
                          marginLeft: 'auto',
                          fontSize: 'var(--font-size-sm)',
                          color: 'var(--color-text-muted)',
                        }}
                      >
                        {msg.timestamp != null ? formatTime(msg.timestamp) : ''}
                      </span>
                    </div>
                    <p
                      style={{
                        margin: 0,
                        fontSize: 'var(--font-size-sm)',
                        color: 'var(--color-text)',
                        whiteSpace: 'pre-wrap',
                        wordBreak: 'break-word',
                      }}
                    >
                      {isExpanded ? text : preview}
                    </p>
                  </div>
                );
              })}
              <div ref={messagesEndRef} />
            </div>
          )}
        </Panel>

        {/* Right — active workers with live progress */}
        <Panel title="Active Workers">
          {workers.size === 0 ? (
            <p
              style={{
                margin: 0,
                color: 'var(--color-text-muted)',
                fontSize: 'var(--font-size-sm)',
              }}
            >
              No active workers.
            </p>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
              {Array.from(workers.values()).map((w) => {
                const workerStatusBadge: StatusBadgeStatus =
                  w.status === 'running'
                    ? 'warning'
                    : w.status === 'completed'
                      ? 'healthy'
                      : 'error';
                const workerLabel =
                  w.status === 'running' ? 'Running' : w.status === 'completed' ? 'Done' : 'Failed';
                return (
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
                    <div
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        marginBottom: 'var(--space-2)',
                      }}
                    >
                      <StatusBadge status={workerStatusBadge} label={workerLabel} />
                      {w.startedAt != null && (
                        <span
                          style={{
                            fontSize: 'var(--font-size-sm)',
                            color: 'var(--color-text-muted)',
                          }}
                        >
                          {formatElapsed(w.startedAt)}
                        </span>
                      )}
                    </div>
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
                );
              })}
            </div>
          )}
        </Panel>
      </div>
    </div>
  );
}
