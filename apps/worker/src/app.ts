import type { WorkerConfig } from '@railmeet/config';
import { createDatabase, type Database } from '@railmeet/database';
import { createLogger, type Logger } from '@railmeet/observability';
import {
  closeRedisConnection,
  createCandidateConsumer,
  createFinalizationConsumer,
  createMeetingSearchConsumer,
  createMeetingSearchQueuePublisher,
  createOutboxDispatcher,
  createRedisConnection,
  createRoutingConsumer,
  type CandidateConsumer,
  type FinalizationConsumer,
  type MeetingSearchConsumer,
  type MeetingSearchQueuePublisher,
  type OutboxDispatcher,
  type RoutingConsumer,
} from '@railmeet/queue';
import {
  createCachedJourneyPlanner,
  createConcurrencyLimitedJourneyPlanner,
  createTransitousJourneyPlanner,
  type JourneyPlanner,
  type PlanCacheRedis,
} from '@railmeet/routing';
import { buildReleaseIdentity, SEARCH_LIMITS } from '@railmeet/shared';

import { createCandidateGenerationProcessor } from './candidate-generation.js';
import { createFinalizationProcessor } from './finalization.js';
import { createMeetingSearchKickoffProcessor } from './meeting-search-kickoff.js';
import { createRoutingWorkProcessor } from './routing-work.js';

export type WorkerRuntime = {
  readonly logger: Logger;
  readonly database: Database;
  readonly publisher: MeetingSearchQueuePublisher;
  readonly dispatcher: OutboxDispatcher;
  readonly consumer: MeetingSearchConsumer;
  readonly candidateConsumer: CandidateConsumer;
  readonly routingConsumer: RoutingConsumer;
  readonly finalizationConsumer: FinalizationConsumer;
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
 * Redis options for BullMQ Workers.
 * Dedicated connections per consumer; never inherit the outbox commandTimeout —
 * blocking queue pops must wait longer than OUTBOX redisCommandTimeoutMs.
 */
function workerRedis(url: string, connectTimeoutMs: number) {
  return createRedisConnection({
    url,
    connectTimeoutMs,
    commandTimeoutMs: null,
    enableOfflineQueue: true,
    maxRetriesPerRequest: null,
  });
}

/**
 * Composition root for outbox dispatcher + kickoff/candidate/routing/finalization consumers.
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

  const kickoffRedis = workerRedis(
    options.config.redisUrl,
    options.config.outbox.redisCommandTimeoutMs,
  );
  const candidateRedis = workerRedis(
    options.config.redisUrl,
    options.config.outbox.redisCommandTimeoutMs,
  );
  const routingRedis = workerRedis(
    options.config.redisUrl,
    options.config.outbox.redisCommandTimeoutMs,
  );
  const finalizationRedis = workerRedis(
    options.config.redisUrl,
    options.config.outbox.redisCommandTimeoutMs,
  );

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

  const planCacheRedis = createRedisConnection({
    url: options.config.redisUrl,
    commandTimeoutMs: options.config.outbox.redisCommandTimeoutMs,
    connectTimeoutMs: options.config.outbox.redisCommandTimeoutMs,
    enableOfflineQueue: false,
    maxRetriesPerRequest: 1,
  });

  const planCacheAdapter: PlanCacheRedis = {
    get: (key) => planCacheRedis.get(key),
    set: (key, value, mode, ttlSeconds) => planCacheRedis.set(key, value, mode, ttlSeconds),
  };

  const transitousPlanner = createTransitousJourneyPlanner({
    baseUrl: options.config.transitous.baseUrl,
    userAgent: options.config.transitous.userAgent,
    timeoutMs: options.config.transitous.timeoutMs,
    maxResponseBytes: options.config.transitous.maxResponseBytes,
    logger,
  });

  const journeyPlanner: JourneyPlanner = createCachedJourneyPlanner({
    inner: createConcurrencyLimitedJourneyPlanner({
      inner: transitousPlanner,
      maxConcurrent: SEARCH_LIMITS.maximumConcurrentTransitousRequests,
    }),
    redis: planCacheAdapter,
    logger,
  });

  const consumer = createMeetingSearchConsumer({
    connection: kickoffRedis,
    logger,
    concurrency: options.config.searchJobs.consumerConcurrency,
    processKickoff: createMeetingSearchKickoffProcessor({
      meetingSearches: database.meetingSearches,
      logger,
    }),
  });

  const candidateConsumer = createCandidateConsumer({
    connection: candidateRedis,
    logger,
    concurrency: options.config.searchJobs.candidateConsumerConcurrency,
    processCandidates: createCandidateGenerationProcessor({
      meetingSearches: database.meetingSearches,
      places: database.places,
      searchPipeline: database.searchPipeline,
      candidateLimit: options.config.searchJobs.candidateLimit,
      logger,
    }),
  });

  const routingConsumer = createRoutingConsumer({
    connection: routingRedis,
    logger,
    concurrency: options.config.searchJobs.routingConsumerConcurrency,
    processRouting: createRoutingWorkProcessor({
      meetingSearches: database.meetingSearches,
      places: database.places,
      searchPipeline: database.searchPipeline,
      journeyPlanner,
      logger,
    }),
  });

  const finalizationConsumer = createFinalizationConsumer({
    connection: finalizationRedis,
    logger,
    concurrency: options.config.searchJobs.finalizationConsumerConcurrency,
    processFinalization: createFinalizationProcessor({
      finalization: database.finalization,
      logger,
    }),
  });

  let stopping = false;

  const runtime: WorkerRuntime = {
    logger,
    database,
    publisher,
    dispatcher,
    consumer,
    candidateConsumer,
    routingConsumer,
    finalizationConsumer,
    journeyPlanner,
    start() {
      dispatcher.start();
      void consumer.worker.run();
      void candidateConsumer.worker.run();
      void routingConsumer.worker.run();
      void finalizationConsumer.worker.run();
      const release = buildReleaseIdentity('railmeet-worker');
      logger.info(
        {
          event: 'worker_ready',
          ...release,
          nodeEnv: options.config.nodeEnv,
          hasDatabaseUrl: options.config.databaseUrl.length > 0,
          hasRedisUrl: options.config.redisUrl.length > 0,
          consumerConcurrency: options.config.searchJobs.consumerConcurrency,
          candidateConsumerConcurrency: options.config.searchJobs.candidateConsumerConcurrency,
          routingConsumerConcurrency: options.config.searchJobs.routingConsumerConcurrency,
          finalizationConsumerConcurrency:
            options.config.searchJobs.finalizationConsumerConcurrency,
          candidateLimit: options.config.searchJobs.candidateLimit,
        },
        'Worker ready (dispatcher + kickoff + candidate + routing + finalization consumers active)',
      );
    },
    async stop() {
      if (stopping) {
        return;
      }
      stopping = true;
      logger.info('Shutting down worker');
      const timeoutMs = options.config.searchJobs.shutdownTimeoutMs;
      await Promise.all([
        consumer.close(timeoutMs),
        candidateConsumer.close(timeoutMs),
        routingConsumer.close(timeoutMs),
        finalizationConsumer.close(timeoutMs),
      ]);
      await dispatcher.stop();
      await publisher.close();
      await closeRedisConnection(publisherRedis);
      await closeRedisConnection(kickoffRedis);
      await closeRedisConnection(candidateRedis);
      await closeRedisConnection(routingRedis);
      await closeRedisConnection(finalizationRedis);
      await closeRedisConnection(planCacheRedis);
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
