import { Redis } from 'ioredis';

export type CreateRedisConnectionOptions = {
  readonly url: string;
  /**
   * Bound Redis command retries so enqueue failures surface for outbox retry.
   * Pass `null` for BullMQ Worker connections (required by BullMQ blocking commands).
   */
  readonly maxRetriesPerRequest?: number | null;
  readonly connectTimeoutMs?: number;
  readonly commandTimeoutMs?: number;
  /** When false (default), commands fail immediately if the connection is down. */
  readonly enableOfflineQueue?: boolean;
  /** When true, do not reconnect after a connection failure (tests / fail-fast probes). */
  readonly disableReconnect?: boolean;
};

/**
 * Creates an ioredis client for BullMQ Queue producers.
 * Fail-fast command settings let the outbox retry scheduler take over when Redis is down.
 * Callers own close(); do not log the URL.
 */
export function createRedisConnection(options: CreateRedisConnectionOptions): Redis {
  const redis = new Redis(options.url, {
    maxRetriesPerRequest:
      options.maxRetriesPerRequest === undefined ? 1 : options.maxRetriesPerRequest,
    connectTimeout: options.connectTimeoutMs ?? 5_000,
    commandTimeout: options.commandTimeoutMs ?? 5_000,
    enableReadyCheck: true,
    enableOfflineQueue: options.enableOfflineQueue ?? false,
    retryStrategy: options.disableReconnect ? () => null : (times) => Math.min(times * 50, 500),
    lazyConnect: false,
  });

  // Prevent unhandled 'error' emitter crashes; callers still observe failures on commands.
  redis.on('error', () => undefined);

  return redis;
}

export async function closeRedisConnection(redis: Redis): Promise<void> {
  if (redis.status === 'end') {
    return;
  }
  try {
    await redis.quit();
  } catch {
    try {
      redis.disconnect();
    } catch {
      // Already closed during shutdown races.
    }
  }
}
