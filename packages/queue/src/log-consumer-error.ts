import type { Logger } from '@railmeet/observability';

/**
 * Normalize unknown thrown values for Pino's `err` serializer.
 * Never attach connection URLs or credentials.
 */
export function toLoggedError(error: unknown): Error {
  if (error instanceof Error) {
    return error;
  }
  return new Error(typeof error === 'string' ? error : String(error));
}

/**
 * Log a BullMQ Worker `error` event with a serialized exception.
 */
export function logConsumerError(
  logger: Logger,
  options: {
    readonly event: string;
    readonly message: string;
    readonly error: unknown;
    readonly errorCode: string;
  },
): void {
  logger.error(
    {
      err: toLoggedError(options.error),
      event: options.event,
      errorCode: options.errorCode,
    },
    options.message,
  );
}
