import { useEffect, useRef, useState } from 'react';

// --- Types ---

type LogLevel = 'info' | 'warn' | 'error';
type LevelFilter = LogLevel | 'all';

interface LogLine {
  id: string;
  raw: string;
  level: LogLevel;
}

// --- Helpers ---

const MAX_LINES = 500;

function parseLevel(raw: string): LogLevel {
  // Try to parse as Pino JSON log (e.g. {"level":30,"msg":"..."})
  try {
    const obj = JSON.parse(raw) as { level?: number | string };
    const lvl = obj.level;
    if (typeof lvl === 'number') {
      if (lvl >= 50) return 'error';
      if (lvl >= 40) return 'warn';
      return 'info';
    }
    if (typeof lvl === 'string') {
      if (lvl === 'error' || lvl === 'fatal') return 'error';
      if (lvl === 'warn') return 'warn';
      return 'info';
    }
  } catch {
    // not JSON — fall through to keyword scan
  }
  // Plain-text heuristic
  const lower = raw.toLowerCase();
  if (lower.includes('error') || lower.includes('fatal')) return 'error';
  if (lower.includes('warn')) return 'warn';
  return 'info';
}

const LEVEL_COLOR: Record<LogLevel, string> = {
  info: 'var(--color-text)',
  warn: 'var(--color-warning)',
  error: 'var(--color-error)',
};

const LEVEL_LABELS: Record<LevelFilter, string> = {
  all: 'All',
  info: 'Info',
  warn: 'Warn',
  error: 'Error',
};

const FILTER_OPTIONS: LevelFilter[] = ['all', 'info', 'warn', 'error'];

// --- LogViewer ---

/**
 * LogViewer — collapsible panel at the bottom of the dashboard showing live
 * bridge logs streamed via IPC (onBridgeLog / bridge-log events).
 *
 * Features:
 *   - Collapse / expand toggle
 *   - Level filter: All / Info / Warn / Error
 *   - Auto-scroll to the bottom on new lines (unless paused by user scroll)
 *   - "Pause" button to stop auto-scroll; "↓" button to resume and jump to bottom
 *   - Capped at the last 500 lines in memory
 */
export function LogViewer() {
  const [isCollapsed, setIsCollapsed] = useState(false);
  const [lines, setLines] = useState<LogLine[]>([]);
  const [filter, setFilter] = useState<LevelFilter>('all');
  const [isPaused, setIsPaused] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  // Subscribe to bridge logs from the main process
  useEffect(() => {
    window.openbridge.onBridgeLog((raw: string) => {
      const line: LogLine = {
        id: `${Date.now()}-${Math.random()}`,
        raw,
        level: parseLevel(raw),
      };
      setLines((prev) => [...prev, line].slice(-MAX_LINES));
    });
  }, []);

  // Auto-scroll to bottom when new lines arrive (unless user paused it)
  useEffect(() => {
    if (!isPaused && !isCollapsed) {
      bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [lines, isPaused, isCollapsed]);

  // Detect manual scroll-up → pause auto-scroll
  const handleScroll = () => {
    const el = scrollRef.current;
    if (el == null) return;
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 32;
    if (!atBottom) setIsPaused(true);
  };

  const resumeAndScrollToBottom = () => {
    setIsPaused(false);
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  const filteredLines = filter === 'all' ? lines : lines.filter((l) => l.level === filter);

  const errorCount = lines.filter((l) => l.level === 'error').length;
  const warnCount = lines.filter((l) => l.level === 'warn').length;

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
      }}
    >
      {/* ── Header bar ── */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 'var(--space-3)',
          padding: 'var(--space-2) var(--space-4)',
          borderBottom: isCollapsed ? 'none' : '1px solid var(--color-border)',
          flexShrink: 0,
        }}
      >
        {/* Collapse toggle */}
        <button
          onClick={() => setIsCollapsed((c) => !c)}
          style={{
            background: 'none',
            border: 'none',
            cursor: 'pointer',
            padding: 'var(--space-1)',
            color: 'var(--color-text-muted)',
            fontSize: 'var(--font-size-sm)',
            display: 'flex',
            alignItems: 'center',
            gap: 'var(--space-2)',
          }}
          aria-expanded={!isCollapsed}
        >
          <span style={{ fontSize: 10 }}>{isCollapsed ? '▶' : '▼'}</span>
          <span style={{ fontWeight: 600, color: 'var(--color-text)' }}>Logs</span>
          <span style={{ color: 'var(--color-text-muted)', fontWeight: 400 }}>
            ({lines.length})
          </span>
          {errorCount > 0 && (
            <span
              style={{
                color: 'var(--color-error)',
                fontSize: 'var(--font-size-sm)',
              }}
            >
              {errorCount} error{errorCount !== 1 ? 's' : ''}
            </span>
          )}
          {warnCount > 0 && errorCount === 0 && (
            <span
              style={{
                color: 'var(--color-warning)',
                fontSize: 'var(--font-size-sm)',
              }}
            >
              {warnCount} warn{warnCount !== 1 ? 'ings' : 'ing'}
            </span>
          )}
        </button>

        {/* Level filter buttons — only shown when expanded */}
        {!isCollapsed && (
          <div
            style={{
              display: 'flex',
              gap: 'var(--space-1)',
              marginLeft: 'auto',
            }}
          >
            {FILTER_OPTIONS.map((lvl) => (
              <button
                key={lvl}
                onClick={() => setFilter(lvl)}
                style={{
                  background: filter === lvl ? 'var(--color-accent)' : 'transparent',
                  color:
                    filter === lvl
                      ? '#fff'
                      : lvl === 'error'
                        ? 'var(--color-error)'
                        : lvl === 'warn'
                          ? 'var(--color-warning)'
                          : 'var(--color-text-muted)',
                  border:
                    filter === lvl
                      ? '1px solid var(--color-accent)'
                      : '1px solid var(--color-border)',
                  borderRadius: 'var(--radius-md)',
                  padding: '2px var(--space-2)',
                  fontSize: 'var(--font-size-sm)',
                  cursor: 'pointer',
                  fontWeight: filter === lvl ? 600 : 400,
                  lineHeight: 1.5,
                }}
              >
                {LEVEL_LABELS[lvl]}
              </button>
            ))}
          </div>
        )}

        {/* Pause / resume scroll — only shown when expanded */}
        {!isCollapsed && (
          <div style={{ display: 'flex', gap: 'var(--space-1)' }}>
            {isPaused ? (
              <button
                onClick={resumeAndScrollToBottom}
                title="Resume auto-scroll and jump to bottom"
                style={{
                  background: 'transparent',
                  border: '1px solid var(--color-border)',
                  borderRadius: 'var(--radius-md)',
                  padding: '2px var(--space-2)',
                  fontSize: 'var(--font-size-sm)',
                  cursor: 'pointer',
                  color: 'var(--color-text-muted)',
                }}
              >
                ↓ Resume
              </button>
            ) : (
              <button
                onClick={() => setIsPaused(true)}
                title="Pause auto-scroll"
                style={{
                  background: 'transparent',
                  border: '1px solid var(--color-border)',
                  borderRadius: 'var(--radius-md)',
                  padding: '2px var(--space-2)',
                  fontSize: 'var(--font-size-sm)',
                  cursor: 'pointer',
                  color: 'var(--color-text-muted)',
                }}
              >
                ⏸ Pause
              </button>
            )}
          </div>
        )}
      </div>

      {/* ── Log output ── */}
      {!isCollapsed && (
        <div
          ref={scrollRef}
          onScroll={handleScroll}
          style={{
            height: 200,
            overflowY: 'auto',
            padding: 'var(--space-2) var(--space-4)',
            fontFamily: 'monospace',
            fontSize: 12,
            lineHeight: 1.5,
            background: 'rgba(0,0,0,0.03)',
          }}
        >
          {filteredLines.length === 0 ? (
            <span style={{ color: 'var(--color-text-muted)' }}>
              {lines.length === 0
                ? 'No logs yet. Start the bridge to see output.'
                : 'No log lines match the selected filter.'}
            </span>
          ) : (
            filteredLines.map((line) => (
              <div
                key={line.id}
                style={{
                  color: LEVEL_COLOR[line.level],
                  whiteSpace: 'pre-wrap',
                  wordBreak: 'break-all',
                  marginBottom: 1,
                }}
              >
                {line.raw}
              </div>
            ))
          )}
          <div ref={bottomRef} />
        </div>
      )}
    </div>
  );
}
