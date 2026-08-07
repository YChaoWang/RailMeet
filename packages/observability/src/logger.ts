import { pino, type Logger, type LoggerOptions } from 'pino';

export type LogLevel = 'fatal' | 'error' | 'warn' | 'info' | 'debug' | 'trace' | 'silent';

export type CreateLoggerOptions = {
  name: string;
  level?: LogLevel;
  /** Pretty-print in development when true. Defaults to NODE_ENV !== 'production'. */
  pretty?: boolean;
};

export type { Logger };

export function createLogger(options: CreateLoggerOptions): Logger {
  const level = options.level ?? 'info';
  const usePretty =
    options.pretty ??
    (process.env['NODE_ENV'] !== 'production' && process.env['NODE_ENV'] !== 'test');

  const loggerOptions: LoggerOptions = {
    name: options.name,
    level,
    base: {
      service: options.name,
    },
    redact: {
      paths: [
        'password',
        'secret',
        'token',
        'authorization',
        'cookie',
        'DATABASE_URL',
        'REDIS_URL',
        '*.password',
        '*.secret',
        '*.token',
        '*.authorization',
      ],
      remove: true,
    },
  };

  if (usePretty) {
    return pino({
      ...loggerOptions,
      transport: {
        target: 'pino-pretty',
        options: {
          colorize: true,
          translateTime: 'SYS:standard',
          ignore: 'pid,hostname',
        },
      },
    });
  }

  return pino(loggerOptions);
}
