import { Queue } from 'bullmq';
import type { Redis } from 'ioredis';

import {
  MEETING_SEARCH_CANDIDATES_QUEUE_NAME,
  MEETING_SEARCH_FINALIZATION_QUEUE_NAME,
  MEETING_SEARCH_REQUESTED_JOB_NAME,
  MEETING_SEARCHES_QUEUE_NAME,
  MEETING_SEARCH_ROUTING_QUEUE_NAME,
  type MeetingSearchRequestedJobData,
  type OutboxMappedJobData,
} from './contract.js';
import {
  buildMeetingSearchJobOptions,
  type MeetingSearchJobRetentionOptions,
} from './job-options.js';
import type { MappedOutboxJob } from './map-event.js';

export type PublishMeetingSearchRequestedInput = {
  readonly jobId: string;
  readonly data: MeetingSearchRequestedJobData;
};

export type PublishResult = 'added' | 'already_exists';

/**
 * Infrastructure boundary for enqueueing outbox-mapped jobs.
 * Does not expose BullMQ types to callers.
 */
export type MeetingSearchQueuePublisher = {
  publishMeetingSearchRequested: (
    input: PublishMeetingSearchRequestedInput,
  ) => Promise<PublishResult>;
  publishMappedJob: (job: MappedOutboxJob) => Promise<PublishResult>;
  close: () => Promise<void>;
};

export type CreateMeetingSearchQueuePublisherOptions = {
  readonly connection: Redis;
  readonly jobOptions: MeetingSearchJobRetentionOptions;
  /** Optional override for tests (kickoff queue only). */
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
 * BullMQ Queue producer for outbox-mapped jobs across kickoff/candidates/routing queues.
 *
 * Uses `queue.add()` with a deterministic job ID only — no check-then-add race.
 */
export function createMeetingSearchQueuePublisher(
  options: CreateMeetingSearchQueuePublisherOptions,
): MeetingSearchQueuePublisher {
  const defaultJobOptions = buildMeetingSearchJobOptions(options.jobOptions);
  const kickoffQueueName = options.queueName ?? MEETING_SEARCHES_QUEUE_NAME;

  const queues = new Map<string, Queue<OutboxMappedJobData>>();

  function getQueue(queueName: string): Queue<OutboxMappedJobData> {
    const existing = queues.get(queueName);
    if (existing) {
      return existing;
    }
    const queue = new Queue<OutboxMappedJobData>(queueName, {
      connection: options.connection,
      defaultJobOptions,
    });
    queue.on('error', () => undefined);
    queues.set(queueName, queue);
    return queue;
  }

  // Ensure default queues exist for close() even if unused.
  getQueue(kickoffQueueName);
  getQueue(MEETING_SEARCH_CANDIDATES_QUEUE_NAME);
  getQueue(MEETING_SEARCH_ROUTING_QUEUE_NAME);
  getQueue(MEETING_SEARCH_FINALIZATION_QUEUE_NAME);

  let closed = false;

  async function publishMappedJob(job: MappedOutboxJob): Promise<PublishResult> {
    try {
      const queue = getQueue(job.queueName);
      await queue.add(job.jobName, job.data, { jobId: job.jobId });
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
  }

  return {
    async publishMeetingSearchRequested(input) {
      return publishMappedJob({
        queueName: kickoffQueueName,
        jobName: MEETING_SEARCH_REQUESTED_JOB_NAME,
        jobId: input.jobId,
        data: input.data,
      });
    },

    publishMappedJob,

    async close() {
      if (closed) {
        return;
      }
      closed = true;
      await Promise.all([...queues.values()].map((queue) => queue.close()));
      queues.clear();
    },
  };
}
