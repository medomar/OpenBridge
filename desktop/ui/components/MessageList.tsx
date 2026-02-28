import { useEffect, useRef, useState } from 'react';

// --- Types ---

interface Message {
  id: string;
  sender?: string;
  channel?: string;
  text?: string;
  isFromUser?: boolean;
  timestamp?: number;
}

// --- Display helpers ---

const CHANNEL_ICONS: Record<string, string> = {
  whatsapp: '📱',
  telegram: '✈️',
  discord: '🎮',
  webchat: '🌐',
  console: '⌨️',
};

function formatTime(ts: number): string {
  return new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

const MAX_MESSAGES = 100;
const PREVIEW_LENGTH = 200;

// --- MessageList ---

/**
 * MessageList — scrollable list of recent messages across all channels.
 *
 * Each row shows: channel icon, sender (user or AI), timestamp, and a
 * message preview truncated at 200 characters. Clicking a truncated message
 * expands it to reveal the full text.
 *
 * Auto-scrolls to the bottom on new messages. Caps in-memory storage at
 * the last 100 messages.
 *
 * Data source: onMessageReceived() IPC event from bridge-process.ts.
 */
export function MessageList() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  // Subscribe to incoming messages from the bridge via IPC
  useEffect(() => {
    window.openbridge.onMessageReceived((raw) => {
      const m = raw as Partial<Message>;
      if (m == null) return;
      const msg: Message = {
        id: m.id ?? `${Date.now()}-${Math.random()}`,
        sender: m.sender,
        channel: m.channel,
        text: m.text,
        isFromUser: m.isFromUser,
        timestamp: m.timestamp,
      };
      setMessages((prev) => [...prev, msg].slice(-MAX_MESSAGES));
    });
  }, []);

  // Auto-scroll to bottom whenever the message list grows
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  if (messages.length === 0) {
    return (
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
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
      {messages.map((msg) => {
        const isExpanded = expandedId === msg.id;
        const text = msg.text ?? '';
        const isTruncated = text.length > PREVIEW_LENGTH;
        const preview = isTruncated ? `${text.slice(0, PREVIEW_LENGTH)}…` : text;
        const isUser = msg.isFromUser ?? false;
        const channelIcon = CHANNEL_ICONS[msg.channel ?? ''] ?? '💬';

        return (
          <div
            key={msg.id}
            role={isTruncated ? 'button' : undefined}
            tabIndex={isTruncated ? 0 : undefined}
            onClick={() => {
              if (isTruncated) setExpandedId(isExpanded ? null : msg.id);
            }}
            onKeyDown={(e) => {
              if (isTruncated && (e.key === 'Enter' || e.key === ' ')) {
                e.preventDefault();
                setExpandedId(isExpanded ? null : msg.id);
              }
            }}
            style={{
              padding: 'var(--space-3)',
              borderRadius: 'var(--radius-md)',
              borderLeft: `3px solid ${isUser ? 'var(--color-accent)' : 'var(--color-success)'}`,
              background: isUser ? 'rgba(59,130,246,0.06)' : 'rgba(34,197,94,0.06)',
              cursor: isTruncated ? 'pointer' : 'default',
            }}
          >
            {/* Header row: channel icon + sender + timestamp */}
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
                {channelIcon} {msg.sender ?? (isUser ? 'User' : 'AI')}
              </span>
              {msg.timestamp != null && (
                <span
                  style={{
                    marginLeft: 'auto',
                    fontSize: 'var(--font-size-sm)',
                    color: 'var(--color-text-muted)',
                  }}
                >
                  {formatTime(msg.timestamp)}
                </span>
              )}
            </div>

            {/* Message body — preview or full text */}
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

      {/* Scroll anchor */}
      <div ref={bottomRef} />
    </div>
  );
}
