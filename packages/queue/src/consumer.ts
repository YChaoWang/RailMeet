import { UnrecoverableError, Worker, type Job } from 'bullmq';
import type { Redis } from 'ioredis';

import type { Logger } from '@railmeet/observability';

import {
  MEETING_SEARCH_REQUESTED_JOB_NAME,
  MEETING_SEARCHES_QUEUE_NAME,
  type MeetingSearchRequestedJobData,
} from './contract.js';
import { validateMeetingSearchRequestedJob } from './job-validation.js';
import { classifyConsumerError, createWorkerCloseHandle } from './worker-close.js';
import { logConsumerError } from './log-consumer-error.js';

export type MeetingSearchKickoffTransition = 'started' | 'already_started' | 'already_terminal';

export type MeetingSearchKickoffJobResult = {
  readonly searchId: string;
  readonly transition: MeetingSearchKickoffTransition;
};

export type MeetingSearchKickoffProcessor = (input: {
  readonly searchId: string;
  readonly jobId: string | undefined;
  readonly attemptsMade: number;
}) => Promise<MeetingSearchKickoffJobResult>;

export type MeetingSearchConsumer = {
  readonly worker: Worker<MeetingSearchRequestedJobData, MeetingSearchKickoffJobResult>;
  close: (timeoutMs: number) => Promise<'closed' | 'timed_out'>;
};

export type CreateMeetingSearchConsumerOptions = {
  readonly connection: Redis;
  readonly logger: Logger;
  readonly concurrency: number;
  readonly processKickoff: MeetingSearchKickoffProcessor;
  /** Optional override for tests. */
  readonly queueName?: string;
};

/**
 * BullMQ Worker for meeting-search.requested kickoff jobs.
 * Constructed explicitly by the worker composition root — not an import-time singleton.
 */
export function createMeetingSearchConsumer(
  options: CreateMeetingSearchConsumerOptions,
): MeetingSearchConsumer {
  const queueName = options.queueName ?? MEETING_SEARCHES_QUEUE_NAME;

  const worker = new Worker<MeetingSearchRequestedJobData, MeetingSearchKickoffJobResult>(
    queueName,
    async (job: Job<MeetingSearchRequestedJobData, MeetingSearchKickoffJobResult>) => {
      options.logger.info(
        {
          event: 'search_job_received',
          jobId: job.id,
          jobName: job.name,
          attemptsMade: job.attemptsMade,
        },
        'Search job received',
      );

      const validated = validateMeetingSearchRequestedJob({
        name: job.name,
        data: job.data,
      });
      if (!validated.ok) {
        options.logger.error(
          {
            event: 'invalid_job_rejected',
            jobId: job.id,
            code: validated.code,
          },
          'Invalid search job rejected',
        );
        throw new UnrecoverableError(validated.message);
      }

      try {
        const result = await options.processKickoff({
          searchId: validated.data.searchId,
          jobId: job.id,
          attemptsMade: job.attemptsMade,
        });
        options.logger.info(
          {
            event: 'search_job_completed',
            jobId: job.id,
            searchId: result.searchId,
            transition: result.transition,
            attemptsMade: job.attemptsMade,
          },
          'Search kickoff job completed',
        );
        return result;
      } catch (error) {
        if (error instanceof UnrecoverableError) {
          options.logger.error(
            {
              event: 'search_job_failed',
              jobId: job.id,
              searchId: validated.data.searchId,
              permanent: true,
              attemptsMade: job.attemptsMade,
            },
            'Search kickoff permanently failed',
          );
          throw error;
        }
        options.logger.warn(
          {
            event: 'search_job_retry_scheduled',
            jobId: job.id,
            searchId: validated.data.searchId,
            attemptsMade: job.attemptsMade,
            errorCode: classifyConsumerError(error),
          },
          'Search kickoff transient failure; BullMQ may retry',
        );
        throw error;
      }
    },
    {
      connection: options.connection,
      concurrency: options.concurrency,
      // Only process the Phase 6 kickoff job name.
      autorun: false,
    },
  );

  worker.on('ready', () => {
    options.logger.info(
      {
        event: 'search_consumer_started',
        queueName,
        concurrency: options.concurrency,
        jobName: MEETING_SEARCH_REQUESTED_JOB_NAME,
      },
      'Search consumer started',
    );
  });

  worker.on('error', (error) => {
    logConsumerError(options.logger, {
      event: 'search_consumer_error',
      message: 'Search consumer error',
      error,
      errorCode: classifyConsumerError(error),
    });
  });

  worker.on('failed', (job, error) => {
    if (!job) {
      return;
    }
    options.logger.error(
      {
        event: 'search_job_failed',
        jobId: job.id,
        attemptsMade: job.attemptsMade,
        permanent: error instanceof UnrecoverableError,
        errorCode: classifyConsumerError(error),
      },
      'Search job failed',
    );
  });

  const closeHandle = createWorkerCloseHandle({
    worker,
    logger: options.logger,
    stoppingEvent: 'search_consumer_stopping',
    stoppedEvent: 'search_consumer_stopped',
    timeoutEvent: 'search_consumer_close_timeout',
  });

  return {
    worker,
    close: closeHandle.close,
  };
}

export { UnrecoverableError };
