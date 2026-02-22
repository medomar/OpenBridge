import pino from 'pino';

// Single root logger with one transport shared across the entire app.
// Using child() for each module avoids the MaxListenersExceededWarning:
// each pino instance with transport registers a process.on('exit') handler,
// so N modules × N loggers = N handlers (exceeds the default limit of 10).
// With a singleton + child(), only one transport exists → one handler total.
const rootLogger = pino({
  level: 'info',
  transport:
    process.env['NODE_ENV'] !== 'production'
      ? { target: 'pino-pretty', options: { colorize: true } }
      : undefined,
});

export function createLogger(name: string, _level = 'info'): pino.Logger {
  return rootLogger.child({ name });
}
