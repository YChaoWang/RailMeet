import type {
  OutboxEventRecord,
  OutboxRepository,
  SearchPipelineRepository,
  StalePipelineWork,
} from '@railmeet/database';
import {
  MEETING_SEARCH_CANDIDATES_REQUESTED_EVENT_TYPE,
  MEETING_SEARCH_FINALIZATION_REQUESTED_EVENT_TYPE,
  MEETING_SEARCH_REQUESTED_EVENT_TYPE,
  ROUTING_REQUESTED_EVENT_TYPE,
} from '@railmeet/database';
import type { Logger } from '@railmeet/observability';
import {
  mapOutboxEventToJob,
  type MeetingSearchQueuePublisher,
  type PublishResult,
} from '@railmeet/queue';

export const PIPELINE_RECOVERY_STALE_AFTER_MS = 120_000;
export const PIPELINE_RECOVERY_ABANDON_AFTER_MS = 24 * 60 * 60 * 1000;
export const PIPELINE_RECOVERY_INTERVAL_MS = 45_000;

export type PipelineRecoveryStats = {
  readonly republished: number;
  readonly skipped: number;
  readonly abandoned: number;
  readonly failed: number;
};

export type PipelineRecovery = {
  start: () => void;
  stop: () => Promise<void>;
  recoverOnce: () => Promise<PipelineRecoveryStats>;
};

export type CreatePipelineRecoveryOptions = {
  readonly searchPipeline: SearchPipelineRepository;
  readonly outbox: OutboxRepository;
  readonly publisher: MeetingSearchQueuePublisher;
  readonly logger: Logger;
  readonly staleAfterMs?: number;
  readonly abandonAfterMs?: number;
  readonly intervalMs?: number;
  readonly now?: () => Date;
};

export function isAbandonedPipelineWork(
  updatedAt: Date,
  now: Date,
  abandonAfterMs = PIPELINE_RECOVERY_ABANDON_AFTER_MS,
): boolean {
  return now.getTime() - updatedAt.getTime() >= abandonAfterMs;
}

export function selectPipelineRecoveryEvents(
  work: StalePipelineWork,
  events: readonly OutboxEventRecord[],
): readonly OutboxEventRecord[] {
  const queued = new Set(work.queuedSearchIds);
  const candidates = new Set(work.candidateGenerations.map((row) => row.searchId));
  const routingIds = new Set(work.routingWork.map((row) => row.routingWorkId));
  const finalization = new Set(work.finalizationSearchIds);
  const selected: OutboxEventRecord[] = [];

  for (const event of events) {
    if (event.publishedAt == null || event.deadLetteredAt != null) {
      continue;
    }
    if (event.eventType === MEETING_SEARCH_REQUESTED_EVENT_TYPE && queued.has(event.aggregateId)) {
      selected.push(event);
      continue;
    }
    if (
      event.eventType === MEETING_SEARCH_CANDIDATES_REQUESTED_EVENT_TYPE &&
      candidates.has(event.aggregateId)
    ) {
      selected.push(event);
      continue;
    }
    if (event.eventType === ROUTING_REQUESTED_EVENT_TYPE) {
      const routingWorkId =
        'routingWorkId' in event.payload ? event.payload.routingWorkId : undefined;
      if (typeof routingWorkId === 'string' && routingIds.has(routingWorkId)) {
        selected.push(event);
      }
      continue;
    }
    if (
      event.eventType === MEETING_SEARCH_FINALIZATION_REQUESTED_EVENT_TYPE &&
      finalization.has(event.aggregateId)
    ) {
      selected.push(event);
    }
  }

  return selected;
}

export function createPipelineRecovery(options: CreatePipelineRecoveryOptions): PipelineRecovery {
  const staleAfterMs = options.staleAfterMs ?? PIPELINE_RECOVERY_STALE_AFTER_MS;
  const abandonAfterMs = options.abandonAfterMs ?? PIPELINE_RECOVERY_ABANDON_AFTER_MS;
  const intervalMs = options.intervalMs ?? PIPELINE_RECOVERY_INTERVAL_MS;
  const now = options.now ?? (() => new Date());

  let timer: ReturnType<typeof setInterval> | undefined;
  let inFlight: Promise<unknown> | undefined;
  let stopped = false;

  async function recoverOnce(): Promise<PipelineRecoveryStats> {
    const at = now();
    const staleBefore = new Date(at.getTime() - staleAfterMs);
    const stale = await options.searchPipeline.listStalePipelineWork(staleBefore);
    const stats = { republished: 0, skipped: 0, abandoned: 0, failed: 0 };

    const candidateGenerations: StalePipelineWork['candidateGenerations'][number][] = [];
    const routingWork: StalePipelineWork['routingWork'][number][] = [];

    for (const generation of stale.candidateGenerations) {
      if (isAbandonedPipelineWork(generation.updatedAt, at, abandonAfterMs)) {
        await options.searchPipeline.completeCandidateGeneration(
          generation.searchId,
          'failed_permanent',
          'PIPELINE_STALLED',
        );
        stats.abandoned += 1;
        continue;
      }
      candidateGenerations.push(generation);
    }

    for (const work of stale.routingWork) {
      if (isAbandonedPipelineWork(work.updatedAt, at, abandonAfterMs)) {
        await options.searchPipeline.markRoutingWorkExhausted(work.routingWorkId, 'PIPELINE_STALLED');
        stats.abandoned += 1;
        continue;
      }
      routingWork.push(work);
    }

    const republishWork: StalePipelineWork = {
      queuedSearchIds: stale.queuedSearchIds,
      candidateGenerations,
      routingWork,
      finalizationSearchIds: stale.finalizationSearchIds,
    };

    const searchIds = new Set<string>([
      ...republishWork.queuedSearchIds,
      ...republishWork.candidateGenerations.map((row) => row.searchId),
      ...republishWork.routingWork.map((row) => row.searchId),
      ...republishWork.finalizationSearchIds,
    ]);

    const events: OutboxEventRecord[] = [];
    for (const searchId of searchIds) {
      events.push(...(await options.outbox.findByAggregateId(searchId)));
    }

    const selected = selectPipelineRecoveryEvents(republishWork, events);
    for (const event of selected) {
      const mapped = mapOutboxEventToJob(event);
      if (!mapped.ok) {
        stats.failed += 1;
        options.logger.warn(
          {
            event: 'pipeline_recovery_unmapped_event',
            eventId: event.id,
            searchId: event.aggregateId,
            errorCode: mapped.errorCode,
          },
          'Stale pipeline event could not be mapped back to a job',
        );
        continue;
      }

      let result: PublishResult;
      try {
        result = await options.publisher.republishMappedJob(mapped.job);
      } catch (error) {
        stats.failed += 1;
        options.logger.error(
          {
            err: error,
            event: 'pipeline_recovery_republish_failed',
            eventId: event.id,
            searchId: event.aggregateId,
            jobId: mapped.job.jobId,
          },
          'Failed to re-enqueue stale pipeline work',
        );
        continue;
      }

      if (result === 'added') {
        stats.republished += 1;
        options.logger.info(
          {
            event: 'pipeline_recovery_republished',
            eventId: event.id,
            searchId: event.aggregateId,
            jobId: mapped.job.jobId,
            jobName: mapped.job.jobName,
          },
          'Re-enqueued vanished pipeline job',
        );
      } else {
        stats.skipped += 1;
      }
    }

    if (stats.republished > 0 || stats.abandoned > 0 || stats.failed > 0) {
      options.logger.info(
        {
          event: 'pipeline_recovery_cycle',
          ...stats,
        },
        'Pipeline recovery cycle finished',
      );
    }

    return stats;
  }

  function runCycle(): void {
    if (stopped || inFlight) {
      return;
    }
    inFlight = recoverOnce()
      .catch((error: unknown) => {
        options.logger.error(
          { err: error, event: 'pipeline_recovery_cycle_failed' },
          'Pipeline recovery cycle failed',
        );
      })
      .finally(() => {
        inFlight = undefined;
      });
  }

  return {
    recoverOnce,
    start() {
      stopped = false;
      runCycle();
      timer = setInterval(runCycle, intervalMs);
      timer.unref?.();
    },
    async stop() {
      stopped = true;
      if (timer) {
        clearInterval(timer);
        timer = undefined;
      }
      await inFlight;
    },
  };
}
