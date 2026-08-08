import { UnrecoverableError, Worker, type Job } from 'bullmq';
import type { Redis } from 'ioredis';

import type { Logger } from '@railmeet/observability';

import {
  MEETING_SEARCH_ROUTING_QUEUE_NAME,
  ROUTING_REQUESTED_JOB_NAME,
  type RoutingRequestedJobData,
} from './contract.js';
import { validateRoutingRequestedJob } from './job-validation.js';
import { classifyConsumerError, createWorkerCloseHandle } from './worker-close.js';

export type RoutingJobResult = {
  readonly searchId: string;
  readonly routingWorkId: string;
  readonly outcome: 'succeeded' | 'no_journeys' | 'already_terminal' | 'exhausted';
  readonly journeyCount: number;
};

export type RoutingProcessor = (input: {
  readonly searchId: string;
  readonly routingWorkId: string;
  readonly jobId: string | undefined;
  readonly attemptsMade: number;
  readonly attemptsTotal: number | undefined;
}) => Promise<RoutingJobResult>;

export type RoutingConsumer = {
  readonly worker: Worker<RoutingRequestedJobData, RoutingJobResult>;
  close: (timeoutMs: number) => Promise<'closed' | 'timed_out'>;
};

export type CreateRoutingConsumerOptions = {
  readonly connection: Redis;
  readonly logger: Logger;
  readonly concurrency: number;
  readonly processRouting: RoutingProcessor;
  readonly queueName?: string;
};

export function createRoutingConsumer(options: CreateRoutingConsumerOptions): RoutingConsumer {
  const queueName = options.queueName ?? MEETING_SEARCH_ROUTING_QUEUE_NAME;

  const worker = new Worker<RoutingRequestedJobData, RoutingJobResult>(
    queueName,
    async (job: Job<RoutingRequestedJobData, RoutingJobResult>) => {
      options.logger.info(
        {
          event: 'routing_job_received',
          jobId: job.id,
          attemptsMade: job.attemptsMade,
        },
        'Routing job received',
      );

      const validated = validateRoutingRequestedJob({
        name: job.name,
        data: job.data,
      });
      if (!validated.ok) {
        options.logger.error(
          {
            event: 'invalid_routing_job_rejected',
            jobId: job.id,
            code: validated.code,
          },
          'Invalid routing job rejected',
        );
        throw new UnrecoverableError(validated.message);
      }

      try {
        const result = await options.processRouting({
          searchId: validated.data.searchId,
          routingWorkId: validated.data.routingWorkId,
          jobId: job.id,
          attemptsMade: job.attemptsMade,
          attemptsTotal: job.opts.attempts,
        });
        options.logger.info(
          {
            event: 'routing_job_completed',
            jobId: job.id,
            searchId: result.searchId,
            routingWorkId: result.routingWorkId,
            outcome: result.outcome,
            journeyCount: result.journeyCount,
          },
          'Routing job completed',
        );
        return result;
      } catch (error) {
        if (error instanceof UnrecoverableError) {
          throw error;
        }
        options.logger.warn(
          {
            event: 'routing_job_retry_scheduled',
            jobId: job.id,
            searchId: validated.data.searchId,
            routingWorkId: validated.data.routingWorkId,
            attemptsMade: job.attemptsMade,
            errorCode: classifyConsumerError(error),
          },
          'Routing transient failure; BullMQ may retry',
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
        event: 'routing_consumer_started',
        queueName,
        concurrency: options.concurrency,
        jobName: ROUTING_REQUESTED_JOB_NAME,
      },
      'Routing consumer started',
    );
  });

  worker.on('error', (error) => {
    options.logger.error(
      {
        event: 'routing_consumer_error',
        errorCode: classifyConsumerError(error),
      },
      'Routing consumer error',
    );
  });

  const closeHandle = createWorkerCloseHandle({
    worker,
    logger: options.logger,
    stoppingEvent: 'routing_consumer_stopping',
    stoppedEvent: 'routing_consumer_stopped',
    timeoutEvent: 'routing_consumer_close_timeout',
  });

  return {
    worker,
    close: closeHandle.close,
  };
}
