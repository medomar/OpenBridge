import { useEffect, useState } from 'react';
import { StatusBadge } from './StatusBadge';
import type { StatusBadgeStatus } from './StatusBadge';

// --- Types ---

type BridgeRunState = 'starting' | 'running' | 'stopping' | 'stopped' | 'error';

interface ChannelConfig {
  type: string;
  enabled?: boolean;
}

interface ChannelMessage {
  id: string;
  sender?: string;
  channel?: string;
  text?: string;
  isFromUser?: boolean;
  timestamp?: number;
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

function channelStatus(
  type: string,
  enabled: boolean | undefined,
  bridgeState: BridgeRunState,
): StatusBadgeStatus {
  if (bridgeState === 'error') return 'error';
  if (bridgeState === 'running' && enabled !== false) return 'healthy';
  if (bridgeState === 'starting' || bridgeState === 'stopping') return 'warning';
  return 'offline';
}

function channelLabel(
  type: string,
  enabled: boolean | undefined,
  bridgeState: BridgeRunState,
): string {
  if (bridgeState === 'error') return 'Error';
  if (bridgeState === 'running' && enabled !== false) return 'Connected';
  if (bridgeState === 'starting') return 'Connecting…';
  if (bridgeState === 'stopping') return 'Disconnecting…';
  return 'Disconnected';
}

function formatTime(ts: number): string {
  return new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

// --- ChannelList ---

/**
 * ChannelList — list of configured connectors showing connection status,
 * message count, and an expandable recent-messages panel per channel.
 *
 * Data sources:
 *   - Channel list: getConfig() on mount
 *   - Bridge state: getBridgeStatus() polled every 5 s
 *   - Message tracking: onMessageReceived() IPC event, bucketed per channel
 */
export function ChannelList() {
  const [channels, setChannels] = useState<ChannelConfig[]>([]);
  const [bridgeState, setBridgeState] = useState<BridgeRunState>('stopped');
  const [messagesByChannel, setMessagesByChannel] = useState<Map<string, ChannelMessage[]>>(
    new Map(),
  );
  const [expandedChannel, setExpandedChannel] = useState<string | null>(null);

  // Load channel config once on mount
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

  // Poll bridge status every 5 s
  useEffect(() => {
    const poll = () => {
      window.openbridge
        .getBridgeStatus()
        .then(({ status }) => setBridgeState(status as BridgeRunState))
        .catch(() => setBridgeState('error'));
    };
    poll();
    const id = setInterval(poll, 5000);
    return () => clearInterval(id);
  }, []);

  // Bucket incoming messages by channel type — keep last 20 per channel
  useEffect(() => {
    window.openbridge.onMessageReceived((raw) => {
      const m = raw as Partial<ChannelMessage>;
      if (m == null || m.channel == null) return;
      const msg: ChannelMessage = {
        id: m.id ?? `${Date.now()}-${Math.random()}`,
        sender: m.sender,
        channel: m.channel,
        text: m.text,
        isFromUser: m.isFromUser,
        timestamp: m.timestamp,
      };
      setMessagesByChannel((prev) => {
        const next = new Map(prev);
        const existing = next.get(msg.channel!) ?? [];
        next.set(msg.channel!, [...existing, msg].slice(-20));
        return next;
      });
    });
  }, []);

  if (channels.length === 0) {
    return (
      <p style={{ margin: 0, color: 'var(--color-text-muted)', fontSize: 'var(--font-size-sm)' }}>
        No channels configured.
      </p>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-1)' }}>
      {channels.map((ch) => {
        const msgs = messagesByChannel.get(ch.type) ?? [];
        const isExpanded = expandedChannel === ch.type;
        const badgeStatus = channelStatus(ch.type, ch.enabled, bridgeState);
        const badgeLabel = channelLabel(ch.type, ch.enabled, bridgeState);

        return (
          <div key={ch.type}>
            {/* Channel row */}
            <div
              role="button"
              tabIndex={0}
              onClick={() => setExpandedChannel(isExpanded ? null : ch.type)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  setExpandedChannel(isExpanded ? null : ch.type);
                }
              }}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 'var(--space-3)',
                padding: 'var(--space-3) var(--space-2)',
                borderRadius: 'var(--radius-md)',
                cursor: 'pointer',
                background: isExpanded ? 'rgba(59,130,246,0.06)' : 'transparent',
                transition: 'background 0.15s',
              }}
            >
              {/* Connector icon */}
              <span style={{ fontSize: 20, lineHeight: 1, flexShrink: 0 }}>
                {CHANNEL_ICONS[ch.type] ?? '📡'}
              </span>

              {/* Name + status */}
              <div style={{ flex: 1, minWidth: 0 }}>
                <div
                  style={{
                    fontWeight: 500,
                    fontSize: 'var(--font-size-sm)',
                    color: 'var(--color-text)',
                    marginBottom: 'var(--space-1)',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {CHANNEL_NAMES[ch.type] ?? ch.type}
                </div>
                <StatusBadge status={badgeStatus} label={badgeLabel} />
              </div>

              {/* Message count badge */}
              {msgs.length > 0 && (
                <span
                  style={{
                    flexShrink: 0,
                    minWidth: 20,
                    height: 20,
                    borderRadius: 'var(--radius-full)',
                    background: 'var(--color-accent)',
                    color: '#fff',
                    fontSize: 'var(--font-size-sm)',
                    fontWeight: 600,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    padding: '0 var(--space-1)',
                  }}
                >
                  {msgs.length}
                </span>
              )}

              {/* Chevron */}
              <span
                style={{
                  flexShrink: 0,
                  color: 'var(--color-text-muted)',
                  fontSize: 10,
                  transform: isExpanded ? 'rotate(180deg)' : 'none',
                  transition: 'transform 0.15s',
                }}
              >
                ▼
              </span>
            </div>

            {/* Expanded: recent messages for this channel */}
            {isExpanded && (
              <div
                style={{
                  margin: '0 var(--space-2) var(--space-2)',
                  borderLeft: '2px solid var(--color-border)',
                  paddingLeft: 'var(--space-3)',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 'var(--space-2)',
                }}
              >
                {msgs.length === 0 ? (
                  <p
                    style={{
                      margin: 0,
                      fontSize: 'var(--font-size-sm)',
                      color: 'var(--color-text-muted)',
                      padding: 'var(--space-2) 0',
                    }}
                  >
                    No messages yet.
                  </p>
                ) : (
                  msgs.map((msg) => {
                    const isUser = msg.isFromUser ?? false;
                    const text = msg.text ?? '';
                    return (
                      <div
                        key={msg.id}
                        style={{
                          padding: 'var(--space-2) var(--space-3)',
                          borderRadius: 'var(--radius-md)',
                          borderLeft: `3px solid ${isUser ? 'var(--color-accent)' : 'var(--color-success)'}`,
                          background: isUser ? 'rgba(59,130,246,0.06)' : 'rgba(34,197,94,0.06)',
                        }}
                      >
                        <div
                          style={{
                            display: 'flex',
                            justifyContent: 'space-between',
                            marginBottom: 'var(--space-1)',
                          }}
                        >
                          <span
                            style={{
                              fontSize: 'var(--font-size-sm)',
                              color: 'var(--color-text-muted)',
                              fontWeight: 500,
                            }}
                          >
                            {msg.sender ?? (isUser ? 'User' : 'AI')}
                          </span>
                          {msg.timestamp != null && (
                            <span
                              style={{
                                fontSize: 'var(--font-size-sm)',
                                color: 'var(--color-text-muted)',
                              }}
                            >
                              {formatTime(msg.timestamp)}
                            </span>
                          )}
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
                          {text}
                        </p>
                      </div>
                    );
                  })
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
