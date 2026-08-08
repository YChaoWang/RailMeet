import { UnrecoverableError, Worker, type Job } from 'bullmq';
import type { Redis } from 'ioredis';

import type { Logger } from '@railmeet/observability';

import {
  MEETING_SEARCH_CANDIDATES_QUEUE_NAME,
  MEETING_SEARCH_CANDIDATES_REQUESTED_JOB_NAME,
  type MeetingSearchCandidatesRequestedJobData,
} from './contract.js';
import { validateCandidatesRequestedJob } from './job-validation.js';
import { classifyConsumerError, createWorkerCloseHandle } from './worker-close.js';

export type CandidateGenerationJobResult = {
  readonly searchId: string;
  readonly outcome: 'generated' | 'already_generated' | 'failed_permanent';
  readonly candidateCount: number;
  readonly routingWorkCount: number;
};

export type CandidateGenerationProcessor = (input: {
  readonly searchId: string;
  readonly jobId: string | undefined;
  readonly attemptsMade: number;
}) => Promise<CandidateGenerationJobResult>;

export type CandidateConsumer = {
  readonly worker: Worker<MeetingSearchCandidatesRequestedJobData, CandidateGenerationJobResult>;
  close: (timeoutMs: number) => Promise<'closed' | 'timed_out'>;
};

export type CreateCandidateConsumerOptions = {
  readonly connection: Redis;
  readonly logger: Logger;
  readonly concurrency: number;
  readonly processCandidates: CandidateGenerationProcessor;
  readonly queueName?: string;
};

export function createCandidateConsumer(
  options: CreateCandidateConsumerOptions,
): CandidateConsumer {
  const queueName = options.queueName ?? MEETING_SEARCH_CANDIDATES_QUEUE_NAME;

  const worker = new Worker<MeetingSearchCandidatesRequestedJobData, CandidateGenerationJobResult>(
    queueName,
    async (job: Job<MeetingSearchCandidatesRequestedJobData, CandidateGenerationJobResult>) => {
      options.logger.info(
        {
          event: 'candidate_job_received',
          jobId: job.id,
          attemptsMade: job.attemptsMade,
        },
        'Candidate generation job received',
      );

      const validated = validateCandidatesRequestedJob({
        name: job.name,
        data: job.data,
      });
      if (!validated.ok) {
        options.logger.error(
          {
            event: 'invalid_candidate_job_rejected',
            jobId: job.id,
            code: validated.code,
          },
          'Invalid candidate job rejected',
        );
        throw new UnrecoverableError(validated.message);
      }

      try {
        const result = await options.processCandidates({
          searchId: validated.data.searchId,
          jobId: job.id,
          attemptsMade: job.attemptsMade,
        });
        options.logger.info(
          {
            event: 'candidate_job_completed',
            jobId: job.id,
            searchId: result.searchId,
            outcome: result.outcome,
            candidateCount: result.candidateCount,
            routingWorkCount: result.routingWorkCount,
          },
          'Candidate generation job completed',
        );
        return result;
      } catch (error) {
        if (error instanceof UnrecoverableError) {
          throw error;
        }
        options.logger.warn(
          {
            event: 'candidate_job_retry_scheduled',
            jobId: job.id,
            searchId: validated.data.searchId,
            attemptsMade: job.attemptsMade,
            errorCode: classifyConsumerError(error),
          },
          'Candidate generation transient failure; BullMQ may retry',
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
        event: 'candidate_consumer_started',
        queueName,
        concurrency: options.concurrency,
        jobName: MEETING_SEARCH_CANDIDATES_REQUESTED_JOB_NAME,
      },
      'Candidate consumer started',
    );
  });

  worker.on('error', (error) => {
    options.logger.error(
      {
        event: 'candidate_consumer_error',
        errorCode: classifyConsumerError(error),
      },
      'Candidate consumer error',
    );
  });

  const closeHandle = createWorkerCloseHandle({
    worker,
    logger: options.logger,
    stoppingEvent: 'candidate_consumer_stopping',
    stoppedEvent: 'candidate_consumer_stopped',
    timeoutEvent: 'candidate_consumer_close_timeout',
  });

  return {
    worker,
    close: closeHandle.close,
  };
}
