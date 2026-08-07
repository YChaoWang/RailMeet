import type { WorkerConfig } from '@railmeet/config';
import { createDatabase, type Database } from '@railmeet/database';
import { createLogger, type Logger } from '@railmeet/observability';
import {
  closeRedisConnection,
  createMeetingSearchQueuePublisher,
  createOutboxDispatcher,
  createRedisConnection,
  type MeetingSearchQueuePublisher,
  type OutboxDispatcher,
} from '@railmeet/queue';

export type WorkerRuntime = {
  readonly logger: Logger;
  readonly database: Database;
  readonly publisher: MeetingSearchQueuePublisher;
  readonly dispatcher: OutboxDispatcher;
  start: () => void;
  stop: () => Promise<void>;
};

export type BuildWorkerOptions = {
  readonly config: WorkerConfig;
  readonly logger?: Logger;
  /** When false, skip signal handlers (tests). Defaults to true. */
  readonly registerSignalHandlers?: boolean;
};

/**
 * Composition root for the outbox dispatcher process.
 * Does not create a BullMQ Worker consumer.
 */
export async function buildWorker(options: BuildWorkerOptions): Promise<WorkerRuntime> {
  const logger =
    options.logger ??
    createLogger({
      name: 'railmeet-worker',
      level: options.config.logLevel,
      pretty: options.config.nodeEnv === 'development',
    });

  const database = createDatabase({
    connectionString: options.config.databaseUrl,
  });

  const redis = createRedisConnection({
    url: options.config.redisUrl,
    commandTimeoutMs: options.config.outbox.redisCommandTimeoutMs,
    connectTimeoutMs: options.config.outbox.redisCommandTimeoutMs,
  });

  const publisher = createMeetingSearchQueuePublisher({ connection: redis });

  const dispatcher = createOutboxDispatcher({
    outbox: database.outbox,
    publisher,
    logger,
    config: {
      pollIntervalMs: options.config.outbox.pollIntervalMs,
      batchSize: options.config.outbox.batchSize,
      leaseMs: options.config.outbox.leaseMs,
      retryBaseMs: options.config.outbox.retryBaseMs,
      retryMaxMs: options.config.outbox.retryMaxMs,
      publishConcurrency: options.config.outbox.publishConcurrency,
    },
  });

  let stopping = false;

  const runtime: WorkerRuntime = {
    logger,
    database,
    publisher,
    dispatcher,
    start() {
      dispatcher.start();
      logger.info(
        {
          nodeEnv: options.config.nodeEnv,
          hasDatabaseUrl: options.config.databaseUrl.length > 0,
          hasRedisUrl: options.config.redisUrl.length > 0,
        },
        'Worker started (outbox dispatcher active; no BullMQ consumer)',
      );
    },
    async stop() {
      if (stopping) {
        return;
      }
      stopping = true;
      logger.info('Shutting down worker');
      await dispatcher.stop();
      await publisher.close();
      await closeRedisConnection(redis);
      await database.close();
      logger.info('Worker closed cleanly');
    },
  };

  if (options.registerSignalHandlers !== false) {
    const onSignal = (signal: string): void => {
      logger.info({ signal }, 'Received shutdown signal');
      void runtime.stop().then(
        () => process.exit(0),
        (error: unknown) => {
          logger.error({ err: error }, 'Error during worker shutdown');
          process.exit(1);
        },
      );
    };
    process.once('SIGTERM', () => onSignal('SIGTERM'));
    process.once('SIGINT', () => onSignal('SIGINT'));
  }

  return runtime;
}
