import type { OutboxEventRecord, OutboxRepository } from '@railmeet/database';
import type { Logger } from '@railmeet/observability';

import { computeRetryDelayMs, jitterUnitFromEventId } from './backoff.js';
import { mapOutboxEventToJob } from './map-event.js';
import { QueueTransientError, type MeetingSearchQueuePublisher } from './publisher.js';

export type OutboxDispatcherConfig = {
  readonly pollIntervalMs: number;
  readonly batchSize: number;
  readonly leaseMs: number;
  readonly retryBaseMs: number;
  readonly retryMaxMs: number;
  /** Max concurrent enqueue operations within a claimed batch. */
  readonly publishConcurrency: number;
};

export type OutboxDispatcherDeps = {
  readonly outbox: OutboxRepository;
  readonly publisher: MeetingSearchQueuePublisher;
  readonly logger: Logger;
  readonly config: OutboxDispatcherConfig;
  readonly sleep?: (ms: number, signal: AbortSignal) => Promise<void>;
  readonly createLeaseToken?: () => string;
};

export type OutboxDispatcher = {
  start: () => void;
  stop: () => Promise<void>;
  /** Runs a single claim→publish cycle (for tests and immediate startup). */
  runOnce: () => Promise<DispatchCycleStats>;
};

export type DispatchCycleStats = {
  readonly claimed: number;
  readonly published: number;
  readonly retried: number;
  readonly deadLettered: number;
};

function defaultSleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(new Error('aborted'));
      return;
    }
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    const onAbort = (): void => {
      clearTimeout(timer);
      reject(new Error('aborted'));
    };
    signal.addEventListener('abort', onAbort, { once: true });
  });
}

async function mapPool<T, R>(
  items: readonly T[],
  concurrency: number,
  mapper: (item: T) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let nextIndex = 0;

  async function worker(): Promise<void> {
    for (;;) {
      const index = nextIndex;
      nextIndex += 1;
      if (index >= items.length) {
        return;
      }
      results[index] = await mapper(items[index]!);
    }
  }

  const workers = Array.from({ length: Math.min(concurrency, items.length) }, () => worker());
  await Promise.all(workers);
  return results;
}

/**
 * Non-overlapping outbox → BullMQ dispatcher loop.
 * Does not open PostgreSQL transactions across Redis calls.
 */
export function createOutboxDispatcher(deps: OutboxDispatcherDeps): OutboxDispatcher {
  const sleep = deps.sleep ?? defaultSleep;
  const createLeaseToken = deps.createLeaseToken ?? (() => crypto.randomUUID());

  let running = false;
  let stopping = false;
  let cyclePromise: Promise<void> | null = null;
  let abortController: AbortController | null = null;

  async function processEvent(
    event: OutboxEventRecord,
    leaseToken: string,
    stats: { published: number; retried: number; deadLettered: number },
  ): Promise<void> {
    const mapped = mapOutboxEventToJob(event);
    if (!mapped.ok) {
      const result = await deps.outbox.markDeadLettered({
        eventId: event.id,
        leaseToken,
        errorCode: mapped.errorCode,
      });
      if (result.outcome === 'updated') {
        stats.deadLettered += 1;
        deps.logger.error(
          { eventId: event.id, errorCode: mapped.errorCode },
          'Outbox poison event dead-lettered',
        );
      }
      return;
    }

    try {
      await deps.publisher.publishMeetingSearchRequested({
        jobId: mapped.job.jobId,
        data: mapped.job.data,
      });
      const published = await deps.outbox.markPublished({
        eventId: event.id,
        leaseToken,
      });
      if (published.outcome === 'updated') {
        stats.published += 1;
        deps.logger.info(
          { eventId: event.id, searchId: mapped.job.data.searchId, jobId: mapped.job.jobId },
          'Outbox event published to queue',
        );
      } else {
        deps.logger.warn({ eventId: event.id }, 'Outbox mark-published skipped (stale lease)');
      }
    } catch (error) {
      const errorCode =
        error instanceof QueueTransientError ? error.code : 'QUEUE_TRANSIENT_FAILURE';
      const delayMs = computeRetryDelayMs({
        failureCount: event.failureCount,
        baseMs: deps.config.retryBaseMs,
        maxMs: deps.config.retryMaxMs,
        jitterUnit: jitterUnitFromEventId(event.id),
      });
      const retried = await deps.outbox.markRetry({
        eventId: event.id,
        leaseToken,
        errorCode,
        nextAttemptDelayMs: delayMs,
      });
      if (retried.outcome === 'updated') {
        stats.retried += 1;
        deps.logger.warn(
          { eventId: event.id, errorCode, nextAttemptDelayMs: delayMs },
          'Outbox publish retry scheduled',
        );
      }
    }
  }

  async function runOnce(): Promise<DispatchCycleStats> {
    const leaseToken = createLeaseToken();
    const claimed = await deps.outbox.claimDue({
      batchSize: deps.config.batchSize,
      leaseMs: deps.config.leaseMs,
      leaseToken,
    });

    const stats = { published: 0, retried: 0, deadLettered: 0 };
    if (claimed.length > 0) {
      await mapPool(claimed, deps.config.publishConcurrency, async (event) => {
        await processEvent(event, leaseToken, stats);
      });
    }

    const cycleStats: DispatchCycleStats = {
      claimed: claimed.length,
      published: stats.published,
      retried: stats.retried,
      deadLettered: stats.deadLettered,
    };
    deps.logger.info(cycleStats, 'Outbox dispatch cycle completed');
    return cycleStats;
  }

  async function loop(signal: AbortSignal): Promise<void> {
    // Immediate first cycle on startup.
    while (!signal.aborted && !stopping) {
      try {
        await runOnce();
      } catch (error) {
        deps.logger.error({ err: error }, 'Outbox dispatch cycle failed');
      }
      if (signal.aborted || stopping) {
        break;
      }
      try {
        await sleep(deps.config.pollIntervalMs, signal);
      } catch {
        break;
      }
    }
  }

  return {
    start() {
      if (running) {
        return;
      }
      running = true;
      stopping = false;
      abortController = new AbortController();
      deps.logger.info(
        {
          pollIntervalMs: deps.config.pollIntervalMs,
          batchSize: deps.config.batchSize,
          leaseMs: deps.config.leaseMs,
        },
        'Outbox dispatcher started',
      );
      cyclePromise = loop(abortController.signal).finally(() => {
        running = false;
        cyclePromise = null;
      });
    },

    async stop() {
      if (!running && !cyclePromise) {
        return;
      }
      stopping = true;
      deps.logger.info('Outbox dispatcher stopping');
      abortController?.abort();
      if (cyclePromise) {
        await cyclePromise.catch(() => undefined);
      }
      running = false;
      stopping = false;
      abortController = null;
      deps.logger.info('Outbox dispatcher stopped');
    },

    runOnce,
  };
}
