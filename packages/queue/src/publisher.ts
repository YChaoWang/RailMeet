import { Queue } from 'bullmq';
import type { Redis } from 'ioredis';

import {
  MEETING_SEARCH_REQUESTED_JOB_NAME,
  MEETING_SEARCHES_QUEUE_NAME,
  type MeetingSearchRequestedJobData,
} from './contract.js';

export type PublishMeetingSearchRequestedInput = {
  readonly jobId: string;
  readonly data: MeetingSearchRequestedJobData;
};

export type PublishResult = 'added' | 'already_exists';

/**
 * Infrastructure boundary for enqueueing meeting-search jobs.
 * Does not expose BullMQ types to callers.
 */
export type MeetingSearchQueuePublisher = {
  publishMeetingSearchRequested: (
    input: PublishMeetingSearchRequestedInput,
  ) => Promise<PublishResult>;
  close: () => Promise<void>;
};

export type CreateMeetingSearchQueuePublisherOptions = {
  readonly connection: Redis;
  /** Optional override for tests. */
  readonly queueName?: string;
};

function isDuplicateJobError(error: unknown): boolean {
  if (!error || typeof error !== 'object') {
    return false;
  }
  const message = 'message' in error ? String((error as { message: unknown }).message) : '';
  return /job.*exist|already exists|duplicat/i.test(message);
}

function isTransientQueueError(error: unknown): boolean {
  if (!error || typeof error !== 'object') {
    return false;
  }
  const code =
    'code' in error && typeof (error as { code: unknown }).code === 'string'
      ? (error as { code: string }).code
      : undefined;
  if (
    code &&
    ['ECONNREFUSED', 'ENOTFOUND', 'ETIMEDOUT', 'ECONNRESET', 'EPIPE', 'NR_CLOSED'].includes(code)
  ) {
    return true;
  }
  const message = 'message' in error ? String((error as { message: unknown }).message) : '';
  return /econnrefused|timed out|timeout|connection is closed|stream isn't writeable|readonly/i.test(
    message,
  );
}

export class QueueTransientError extends Error {
  readonly code: 'REDIS_UNAVAILABLE' | 'QUEUE_TIMEOUT' | 'QUEUE_TRANSIENT_FAILURE';

  constructor(
    code: 'REDIS_UNAVAILABLE' | 'QUEUE_TIMEOUT' | 'QUEUE_TRANSIENT_FAILURE',
    message: string,
    cause?: unknown,
  ) {
    super(message, cause !== undefined ? { cause } : undefined);
    this.name = 'QueueTransientError';
    this.code = code;
  }
}

/**
 * BullMQ Queue producer for meeting-search.requested jobs.
 *
 * Uses `queue.add()` with a deterministic job ID only — no check-then-add race.
 * An already-existing job ID is treated as successful delivery (at-least-once recovery).
 * Jobs are retained so deduplication survives dispatcher restarts until Phase 6 chooses
 * a retention policy with worker-level idempotency.
 */
export function createMeetingSearchQueuePublisher(
  options: CreateMeetingSearchQueuePublisherOptions,
): MeetingSearchQueuePublisher {
  const queueName = options.queueName ?? MEETING_SEARCHES_QUEUE_NAME;
  const queue = new Queue<MeetingSearchRequestedJobData>(queueName, {
    connection: options.connection,
    defaultJobOptions: {
      removeOnComplete: false,
      removeOnFail: false,
    },
  });

  queue.on('error', () => undefined);

  let closed = false;

  return {
    async publishMeetingSearchRequested(input) {
      try {
        await queue.add(MEETING_SEARCH_REQUESTED_JOB_NAME, input.data, {
          jobId: input.jobId,
        });
        // BullMQ deduplicates custom job IDs atomically inside add(). A successful
        // return means the deterministic job is present (new or already retained).
        return 'added';
      } catch (error) {
        if (isDuplicateJobError(error)) {
          return 'already_exists';
        }
        if (isTransientQueueError(error)) {
          const code =
            error &&
            typeof error === 'object' &&
            'code' in error &&
            (error as { code: string }).code === 'ETIMEDOUT'
              ? 'QUEUE_TIMEOUT'
              : 'REDIS_UNAVAILABLE';
          throw new QueueTransientError(code, 'Queue enqueue failed transiently', error);
        }
        throw new QueueTransientError('QUEUE_TRANSIENT_FAILURE', 'Queue enqueue failed', error);
      }
    },

    async close() {
      if (closed) {
        return;
      }
      closed = true;
      await queue.close();
    },
  };
}
