import { describe, expect, it, vi } from 'vitest';

import type { OutboxEventRecord, StalePipelineWork } from '@railmeet/database';
import { createLogger } from '@railmeet/observability';
import { UnrecoverableError } from '@railmeet/queue';

import { createCandidateGenerationProcessor } from './candidate-generation.js';
import {
  createPipelineRecovery,
  isAbandonedPipelineWork,
  selectPipelineRecoveryEvents,
} from './pipeline-recovery.js';
import { createRoutingWorkProcessor } from './routing-work.js';

const searchId = '11111111-1111-4111-8111-111111111111';
const routingWorkId = '22222222-2222-4222-8222-222222222222';
const publishedAt = new Date('2026-06-15T08:00:00.000Z');

function event(overrides: Partial<OutboxEventRecord>): OutboxEventRecord {
  return {
    id: overrides.id ?? '33333333-3333-4333-8333-333333333333',
    eventType: overrides.eventType ?? 'meeting-search.candidates-requested',
    aggregateType: 'meeting-search',
    aggregateId: overrides.aggregateId ?? searchId,
    schemaVersion: 1,
    dedupeKey: overrides.dedupeKey ?? 'default',
    payload: overrides.payload ?? { searchId },
    createdAt: publishedAt,
    publishedAt: overrides.publishedAt === undefined ? publishedAt : overrides.publishedAt,
    failureCount: 0,
    nextAttemptAt: null,
    leaseToken: null,
    leasedUntil: null,
    lastErrorCode: null,
    deadLetteredAt: overrides.deadLetteredAt ?? null,
  };
}

const emptyWork: StalePipelineWork = {
  queuedSearchIds: [],
  candidateGenerations: [],
  routingWork: [],
  finalizationSearchIds: [],
};

describe('selectPipelineRecoveryEvents', () => {
  it('re-selects published candidate, routing, kickoff, and finalization events', () => {
    const work: StalePipelineWork = {
      queuedSearchIds: ['queued-search'],
      candidateGenerations: [{ searchId, updatedAt: publishedAt }],
      routingWork: [{ searchId, routingWorkId, updatedAt: publishedAt }],
      finalizationSearchIds: [searchId],
    };

    const selected = selectPipelineRecoveryEvents(work, [
      event({
        id: 'kickoff',
        eventType: 'meeting-search.requested',
        aggregateId: 'queued-search',
        payload: { searchId: 'queued-search' },
      }),
      event({ id: 'candidates', eventType: 'meeting-search.candidates-requested' }),
      event({
        id: 'routing',
        eventType: 'routing.requested',
        payload: { searchId, routingWorkId },
      }),
      event({ id: 'finalize', eventType: 'meeting-search.finalization-requested' }),
      event({
        id: 'unpublished',
        publishedAt: null,
      }),
      event({
        id: 'dead',
        deadLetteredAt: publishedAt,
      }),
      event({
        id: 'other-routing',
        eventType: 'routing.requested',
        payload: { searchId, routingWorkId: '99999999-9999-4999-8999-999999999999' },
      }),
    ]);

    expect(selected.map((row) => row.id)).toEqual(['kickoff', 'candidates', 'routing', 'finalize']);
  });

  it('ignores unpublished events so the dispatcher remains the publisher', () => {
    const selected = selectPipelineRecoveryEvents(
      { ...emptyWork, candidateGenerations: [{ searchId, updatedAt: publishedAt }] },
      [event({ publishedAt: null })],
    );
    expect(selected).toEqual([]);
  });
});

describe('isAbandonedPipelineWork', () => {
  it('abandons work that has been stale for the configured window', () => {
    const now = new Date('2026-06-16T09:00:00.000Z');
    expect(isAbandonedPipelineWork(new Date('2026-06-15T08:59:00.000Z'), now)).toBe(true);
    expect(isAbandonedPipelineWork(new Date('2026-06-15T09:01:00.000Z'), now)).toBe(false);
  });
});

describe('createPipelineRecovery', () => {
  it('abandons work that has been stuck longer than the abandon window', async () => {
    const completeCandidateGeneration = vi.fn().mockResolvedValue(undefined);
    const markRoutingWorkExhausted = vi.fn().mockResolvedValue(undefined);
    const republishMappedJob = vi.fn();
    const recovery = createPipelineRecovery({
      searchPipeline: {
        listStalePipelineWork: vi.fn().mockResolvedValue({
          queuedSearchIds: [],
          candidateGenerations: [{ searchId, updatedAt: new Date('2026-06-15T08:00:00.000Z') }],
          routingWork: [
            {
              searchId,
              routingWorkId,
              updatedAt: new Date('2026-06-15T08:00:00.000Z'),
            },
          ],
          finalizationSearchIds: [],
        }),
        completeCandidateGeneration,
        markRoutingWorkExhausted,
      } as never,
      outbox: {
        findByAggregateId: vi.fn().mockResolvedValue([]),
      } as never,
      publisher: {
        republishMappedJob,
      } as never,
      logger: createLogger({ name: 'pipeline-recovery-test', level: 'silent', pretty: false }),
      now: () => new Date('2026-06-16T09:00:00.000Z'),
    });

    const stats = await recovery.recoverOnce();
    expect(stats.abandoned).toBe(2);
    expect(completeCandidateGeneration).toHaveBeenCalledWith(
      searchId,
      'failed_permanent',
      'PIPELINE_STALLED',
    );
    expect(markRoutingWorkExhausted).toHaveBeenCalledWith(routingWorkId, 'PIPELINE_STALLED');
    expect(republishMappedJob).not.toHaveBeenCalled();
  });

  it('re-enqueues published candidate jobs that are stale but not abandoned', async () => {
    const republishMappedJob = vi.fn().mockResolvedValue('added');
    const recovery = createPipelineRecovery({
      searchPipeline: {
        listStalePipelineWork: vi.fn().mockResolvedValue({
          queuedSearchIds: [],
          candidateGenerations: [{ searchId, updatedAt: new Date('2026-06-15T08:57:00.000Z') }],
          routingWork: [],
          finalizationSearchIds: [],
        }),
        completeCandidateGeneration: vi.fn(),
        markRoutingWorkExhausted: vi.fn(),
      } as never,
      outbox: {
        findByAggregateId: vi.fn().mockResolvedValue([
          event({ id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' }),
        ]),
      } as never,
      publisher: {
        republishMappedJob,
      } as never,
      logger: createLogger({ name: 'pipeline-recovery-test', level: 'silent', pretty: false }),
      now: () => new Date('2026-06-15T09:00:00.000Z'),
    });

    const stats = await recovery.recoverOnce();
    expect(stats.republished).toBe(1);
    expect(republishMappedJob).toHaveBeenCalledTimes(1);
    expect(republishMappedJob.mock.calls[0]![0]).toMatchObject({
      jobName: 'meeting-search.candidates-requested',
    });
  });
});

describe('unexpected pipeline errors stay retryable', () => {
  it('does not wrap candidate generation surprises as UnrecoverableError', async () => {
    const processor = createCandidateGenerationProcessor({
      meetingSearches: {
        findById: vi.fn().mockResolvedValue({
          id: searchId,
          participants: [{ originPlaceId: 'place:berlin' }],
        }),
      } as never,
      places: {} as never,
      searchPipeline: {
        claimCandidateGeneration: vi.fn().mockResolvedValue({
          outcome: 'claimed',
          generation: { searchId, status: 'running' },
        }),
        getMeetingCityCatalogStatus: vi.fn().mockRejectedValue(new Error('catalog exploded')),
      } as never,
      candidateLimit: 8,
      logger: createLogger({ name: 'candidate-retry-test', level: 'silent', pretty: false }),
    });

    await expect(processor({ searchId, jobId: 'job-1', attemptsMade: 0 })).rejects.toThrow(
      'catalog exploded',
    );
    await expect(processor({ searchId, jobId: 'job-1', attemptsMade: 0 })).rejects.not.toBeInstanceOf(
      UnrecoverableError,
    );
  });

  it('does not wrap routing surprises as UnrecoverableError', async () => {
    const processor = createRoutingWorkProcessor({
      meetingSearches: {
        findById: vi.fn().mockResolvedValue({
          id: searchId,
          maxTransfers: 2,
          travelDate: '2026-09-15',
          earliestDepartureTime: '08:00',
          participants: [{ participantId: 'p1', originPlaceId: 'place:berlin' }],
        }),
      } as never,
      places: {
        findById: vi.fn().mockResolvedValue({
          id: 'place:berlin',
          timezone: 'Europe/Berlin',
          location: { latitude: 52.52, longitude: 13.4 },
        }),
      } as never,
      searchPipeline: {
        claimRoutingWork: vi.fn().mockResolvedValue({
          outcome: 'claimed',
          work: { id: routingWorkId, searchId, participantId: 'p1', destinationPlaceId: 'place:hengelo' },
        }),
        listCandidates: vi.fn().mockResolvedValue([
          { destinationPlaceId: 'place:hengelo', routingHubPlaceId: null },
        ]),
        countRoutingWorkForSearch: vi.fn().mockResolvedValue(1),
      } as never,
      journeyPlanner: {
        planJourney: vi.fn().mockRejectedValue(new Error('planner exploded')),
      },
      logger: createLogger({ name: 'routing-retry-test', level: 'silent', pretty: false }),
    });

    await expect(
      processor({
        searchId,
        routingWorkId,
        jobId: 'job-1',
        attemptsMade: 0,
        attemptsTotal: 3,
      }),
    ).rejects.toThrow('planner exploded');
    await expect(
      processor({
        searchId,
        routingWorkId,
        jobId: 'job-1',
        attemptsMade: 0,
        attemptsTotal: 3,
      }),
    ).rejects.not.toBeInstanceOf(UnrecoverableError);
  });
});
