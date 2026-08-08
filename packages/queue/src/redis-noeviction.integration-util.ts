import { GenericContainer, Wait, type StartedTestContainer } from 'testcontainers';
import type { Redis } from 'ioredis';

/**
 * Start Redis with production maxmemory-policy (auto-assigned host port).
 * Used only by Phase 8 integration tests — not part of the published package build.
 */
export async function startNoevictionRedisContainer(): Promise<{
  readonly container: StartedTestContainer;
  readonly connectionUrl: string;
}> {
  const container = await new GenericContainer('redis:7-alpine')
    .withExposedPorts(6379)
    .withCommand(['redis-server', '--maxmemory-policy', 'noeviction'])
    .withWaitStrategy(Wait.forLogMessage(/Ready to accept connections/))
    .start();
  const host = container.getHost();
  const port = container.getMappedPort(6379);
  return {
    container,
    connectionUrl: `redis://${host}:${port}`,
  };
}

export async function assertRedisMaxmemoryPolicyNoeviction(redis: Redis): Promise<void> {
  if (redis.status !== 'ready') {
    await new Promise<void>((resolve, reject) => {
      const onReady = () => {
        cleanup();
        resolve();
      };
      const onError = (error: Error) => {
        cleanup();
        reject(error);
      };
      const cleanup = () => {
        redis.off('ready', onReady);
        redis.off('error', onError);
      };
      redis.once('ready', onReady);
      redis.once('error', onError);
      if (redis.status === 'ready') {
        cleanup();
        resolve();
      }
    });
  }
  const result = await redis.config('GET', 'maxmemory-policy');
  const policy = Array.isArray(result) ? result[1] : undefined;
  if (policy !== 'noeviction') {
    throw new Error(`Expected Redis maxmemory-policy=noeviction, got ${String(policy)}`);
  }
}
