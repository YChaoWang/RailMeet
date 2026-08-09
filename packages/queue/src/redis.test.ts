import { describe, expect, it } from 'vitest';

import { createRedisConnection, closeRedisConnection } from './redis.js';

describe('createRedisConnection', () => {
  it('applies a commandTimeout for publisher-style connections by default', async () => {
    const redis = createRedisConnection({
      url: 'redis://127.0.0.1:9',
      disableReconnect: true,
      connectTimeoutMs: 50,
    });
    try {
      expect((redis.options as { commandTimeout?: number }).commandTimeout).toBe(5_000);
    } finally {
      await closeRedisConnection(redis);
    }
  });

  it('omits commandTimeout for BullMQ worker connections when null', async () => {
    const redis = createRedisConnection({
      url: 'redis://127.0.0.1:9',
      disableReconnect: true,
      connectTimeoutMs: 50,
      commandTimeoutMs: null,
      maxRetriesPerRequest: null,
      enableOfflineQueue: true,
    });
    try {
      expect((redis.options as { commandTimeout?: number }).commandTimeout).toBeUndefined();
      expect(redis.options.maxRetriesPerRequest).toBeNull();
    } finally {
      await closeRedisConnection(redis);
    }
  });
});
