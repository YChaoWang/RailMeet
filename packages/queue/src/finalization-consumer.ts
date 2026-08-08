import { UnrecoverableError, Worker, type Job } from 'bullmq';
import type { Redis } from 'ioredis';

import type { Logger } from '@railmeet/observability';

import {
  MEETING_SEARCH_FINALIZATION_QUEUE_NAME,
  MEETING_SEARCH_FINALIZATION_REQUESTED_JOB_NAME,
  type MeetingSearchFinalizationRequestedJobData,
} from './contract.js';
import { validateFinalizationRequestedJob } from './job-validation.js';
import { classifyConsumerError, createWorkerCloseHandle } from './worker-close.js';

export type FinalizationJobResult = {
  readonly searchId: string;
  readonly outcome: 'not_ready' | 'completed' | 'failed' | 'already_terminal';
  readonly completionOutcome?: string;
  readonly failureCode?: string;
};

export type FinalizationProcessor = (input: {
  readonly searchId: string;
  readonly jobId: string | undefined;
  readonly attemptsMade: number;
}) => Promise<FinalizationJobResult>;

export type FinalizationConsumer = {
  readonly worker: Worker<MeetingSearchFinalizationRequestedJobData, FinalizationJobResult>;
  close: (timeoutMs: number) => Promise<'closed' | 'timed_out'>;
};

export type CreateFinalizationConsumerOptions = {
  readonly connection: Redis;
  readonly logger: Logger;
  readonly concurrency: number;
  readonly processFinalization: FinalizationProcessor;
  readonly queueName?: string;
};

export function createFinalizationConsumer(
  options: CreateFinalizationConsumerOptions,
): FinalizationConsumer {
  const queueName = options.queueName ?? MEETING_SEARCH_FINALIZATION_QUEUE_NAME;

  const worker = new Worker<MeetingSearchFinalizationRequestedJobData, FinalizationJobResult>(
    queueName,
    async (job: Job<MeetingSearchFinalizationRequestedJobData, FinalizationJobResult>) => {
      options.logger.info(
        {
          event: 'finalization_job_received',
          jobId: job.id,
          attemptsMade: job.attemptsMade,
        },
        'Finalization job received',
      );

      const validated = validateFinalizationRequestedJob({
        name: job.name,
        data: job.data,
      });
      if (!validated.ok) {
        options.logger.error(
          {
            event: 'invalid_finalization_job_rejected',
            jobId: job.id,
            code: validated.code,
          },
          'Invalid finalization job rejected',
        );
        throw new UnrecoverableError(validated.message);
      }

      try {
        const result = await options.processFinalization({
          searchId: validated.data.searchId,
          jobId: job.id,
          attemptsMade: job.attemptsMade,
        });
        options.logger.info(
          {
            event: 'finalization_job_completed',
            jobId: job.id,
            searchId: result.searchId,
            outcome: result.outcome,
            completionOutcome: result.completionOutcome,
            failureCode: result.failureCode,
          },
          'Finalization job completed',
        );
        return result;
      } catch (error) {
        if (error instanceof UnrecoverableError) {
          throw error;
        }
        options.logger.warn(
          {
            event: 'finalization_job_retry_scheduled',
            jobId: job.id,
            searchId: validated.data.searchId,
            attemptsMade: job.attemptsMade,
            errorCode: classifyConsumerError(error),
          },
          'Finalization transient failure; BullMQ may retry',
        );
        throw error;
      }
    },
    {
      connection: options.connection,
      concurrency: options.concurrency,
      autorun: false,
    },
  );

  worker.on('ready', () => {
    options.logger.info(
      {
        event: 'finalization_consumer_started',
        queueName,
        concurrency: options.concurrency,
        jobName: MEETING_SEARCH_FINALIZATION_REQUESTED_JOB_NAME,
      },
      'Finalization consumer started',
    );
  });

  worker.on('error', (error) => {
    options.logger.error(
      {
        event: 'finalization_consumer_error',
        errorCode: classifyConsumerError(error),
      },
      'Finalization consumer error',
    );
  });

  const closeHandle = createWorkerCloseHandle({
    worker,
    logger: options.logger,
    stoppingEvent: 'finalization_consumer_stopping',
    stoppedEvent: 'finalization_consumer_stopped',
    timeoutEvent: 'finalization_consumer_close_timeout',
  });

  return {
    worker,
    close: closeHandle.close,
  };
}
