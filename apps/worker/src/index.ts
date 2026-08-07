import { loadWorkerConfig } from '@railmeet/config';
import { createLogger } from '@railmeet/observability';

/**
 * Phase 1 worker skeleton.
 * Starts, logs readiness, and shuts down cleanly on SIGTERM/SIGINT.
 * BullMQ job processing is deferred to Phase 5.
 */
async function main(): Promise<void> {
  const config = loadWorkerConfig();
  const logger = createLogger({
    name: 'railmeet-worker',
    level: config.logLevel,
    pretty: config.nodeEnv === 'development',
  });

  let shuttingDown = false;

  const heartbeat = setInterval(() => {
    logger.debug('Worker heartbeat');
  }, 60_000);

  const shutdown = (signal: string): void => {
    if (shuttingDown) {
      return;
    }
    shuttingDown = true;
    logger.info({ signal }, 'Shutting down worker');
    clearInterval(heartbeat);
    logger.info('Worker closed cleanly');
    process.exit(0);
  };

  process.on('SIGTERM', () => {
    shutdown('SIGTERM');
  });
  process.on('SIGINT', () => {
    shutdown('SIGINT');
  });

  logger.info(
    {
      nodeEnv: config.nodeEnv,
      // Confirm config loaded without logging secret connection strings.
      hasDatabaseUrl: config.databaseUrl.length > 0,
      hasRedisUrl: config.redisUrl.length > 0,
    },
    'Worker started (job processing not enabled yet)',
  );
}

void main();
