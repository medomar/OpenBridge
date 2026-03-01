import { mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import pino from 'pino';

// Single root logger with one transport shared across the entire app.
// Using child() for each module avoids the MaxListenersExceededWarning:
// each pino instance with transport registers a process.on('exit') handler,
// so N modules × N loggers = N handlers (exceeds the default limit of 10).
// With a singleton + child(), only one transport exists → one handler total.
const initialLevel = process.env['LOG_LEVEL'] ?? 'info';

/** Returns true when running inside a pkg-compiled binary. */
function isPackagedMode(): boolean {
  return (process as { pkg?: unknown }).pkg !== undefined;
}

/**
 * Returns the logs directory for file transport.
 * In packaged mode: ~/.openbridge/logs/
 * In dev/production mode: not used (logs go to stdout).
 */
function getLogDir(): string {
  const logsDir = join(homedir(), '.openbridge', 'logs');
  mkdirSync(logsDir, { recursive: true });
  return logsDir;
}

function createRootLogger(): pino.Logger {
  if (isPackagedMode()) {
    const logFile = join(getLogDir(), 'openbridge.log');
    return pino({ level: initialLevel }, pino.destination({ dest: logFile, sync: false }));
  }
  if (process.env['NODE_ENV'] === 'production') {
    return pino({ level: initialLevel });
  }
  try {
    return pino({
      level: initialLevel,
      transport: { target: 'pino-pretty', options: { colorize: true } },
    });
  } catch {
    // pino-pretty not installed — fall back to plain JSON logs
    return pino({ level: initialLevel });
  }
}

const rootLogger = createRootLogger();

export function createLogger(name: string): pino.Logger {
  return rootLogger.child({ name });
}

/** Apply a log level from config or env at runtime (call after loadConfig). */
export function setLogLevel(level: string): void {
  rootLogger.level = level;
}
