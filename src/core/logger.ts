import pino from 'pino';

// Single root logger with one transport shared across the entire app.
// Using child() for each module avoids the MaxListenersExceededWarning:
// each pino instance with transport registers a process.on('exit') handler,
// so N modules × N loggers = N handlers (exceeds the default limit of 10).
// With a singleton + child(), only one transport exists → one handler total.
const initialLevel = process.env['LOG_LEVEL'] ?? 'info';

function createRootLogger(): pino.Logger {
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

export function createLogger(name: string, _level = 'info'): pino.Logger {
  return rootLogger.child({ name });
}

/** Apply a log level from config or env at runtime (call after loadConfig). */
export function setLogLevel(level: string): void {
  rootLogger.level = level;
}
