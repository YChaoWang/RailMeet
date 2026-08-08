import type { WorkerConfig } from '@railmeet/config';
import { createDatabase, type Database } from '@railmeet/database';
import { createLogger, type Logger } from '@railmeet/observability';
import {
  closeRedisConnection,
  createMeetingSearchConsumer,
  createMeetingSearchQueuePublisher,
  createOutboxDispatcher,
  createRedisConnection,
  type MeetingSearchConsumer,
  type MeetingSearchQueuePublisher,
  type OutboxDispatcher,
} from '@railmeet/queue';
import { createTransitousJourneyPlanner, type JourneyPlanner } from '@railmeet/routing';

import { createMeetingSearchKickoffProcessor } from './meeting-search-kickoff.js';

export type WorkerRuntime = {
  readonly logger: Logger;
  readonly database: Database;
  readonly publisher: MeetingSearchQueuePublisher;
  readonly dispatcher: OutboxDispatcher;
  readonly consumer: MeetingSearchConsumer;
  readonly journeyPlanner: JourneyPlanner;
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
 * Composition root for outbox dispatcher + BullMQ search kickoff consumer.
 * Constructs Transitous planner for Phase 7 readiness; kickoff does not call it.
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

  const publisherRedis = createRedisConnection({
    url: options.config.redisUrl,
    commandTimeoutMs: options.config.outbox.redisCommandTimeoutMs,
    connectTimeoutMs: options.config.outbox.redisCommandTimeoutMs,
  });

  const consumerRedis = createRedisConnection({
    url: options.config.redisUrl,
    commandTimeoutMs: options.config.outbox.redisCommandTimeoutMs,
    connectTimeoutMs: options.config.outbox.redisCommandTimeoutMs,
    // BullMQ Worker manages blocking commands; allow offline queue while reconnecting.
    enableOfflineQueue: true,
    maxRetriesPerRequest: null,
  });

  const publisher = createMeetingSearchQueuePublisher({
    connection: publisherRedis,
    jobOptions: options.config.searchJobs,
  });

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

  const processKickoff = createMeetingSearchKickoffProcessor({
    meetingSearches: database.meetingSearches,
    logger,
  });

  const consumer = createMeetingSearchConsumer({
    connection: consumerRedis,
    logger,
    concurrency: options.config.searchJobs.consumerConcurrency,
    processKickoff,
  });

  const journeyPlanner = createTransitousJourneyPlanner({
    baseUrl: options.config.transitous.baseUrl,
    userAgent: options.config.transitous.userAgent,
    timeoutMs: options.config.transitous.timeoutMs,
    maxResponseBytes: options.config.transitous.maxResponseBytes,
    logger,
  });

  let stopping = false;

  const runtime: WorkerRuntime = {
    logger,
    database,
    publisher,
    dispatcher,
    consumer,
    journeyPlanner,
    start() {
      dispatcher.start();
      void consumer.worker.run();
      logger.info(
        {
          event: 'worker_ready',
          nodeEnv: options.config.nodeEnv,
          hasDatabaseUrl: options.config.databaseUrl.length > 0,
          hasRedisUrl: options.config.redisUrl.length > 0,
          consumerConcurrency: options.config.searchJobs.consumerConcurrency,
        },
        'Worker ready (outbox dispatcher + search kickoff consumer active)',
      );
    },
    async stop() {
      if (stopping) {
        return;
      }
      stopping = true;
      logger.info('Shutting down worker');
      await consumer.close(options.config.searchJobs.shutdownTimeoutMs);
      await dispatcher.stop();
      await publisher.close();
      await closeRedisConnection(publisherRedis);
      await closeRedisConnection(consumerRedis);
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
