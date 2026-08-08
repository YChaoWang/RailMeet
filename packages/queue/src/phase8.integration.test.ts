import { randomUUID } from 'node:crypto';

import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { Queue, UnrecoverableError } from 'bullmq';
import type { StartedTestContainer } from 'testcontainers';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createDatabase, type Database } from '@railmeet/database';
import { createLogger } from '@railmeet/observability';

import {
  MEETING_SEARCH_FINALIZATION_QUEUE_NAME,
  MEETING_SEARCH_FINALIZATION_REQUESTED_JOB_NAME,
} from './contract.js';
import { createFinalizationConsumer } from './finalization-consumer.js';
import { createOutboxDispatcher } from './dispatcher.js';
import { createMeetingSearchQueuePublisher } from './publisher.js';
import { closeRedisConnection, createRedisConnection } from './redis.js';
import {
  assertRedisMaxmemoryPolicyNoeviction,
  startNoevictionRedisContainer,
} from './redis-noeviction.integration-util.js';

const POSTGIS_IMAGE = 'ghcr.io/baosystems/postgis:16-3.5';

const testJobOptions = {
  attempts: 3,
  backoffDelayMs: 100,
  backoffJitter: 0.1,
  removeOnCompleteAgeSeconds: 3_600,
  removeOnCompleteCount: 1_000,
  removeOnFailAgeSeconds: 86_400,
  removeOnFailCount: 5_000,
} as const;

async function waitFor(predicate: () => Promise<boolean> | boolean, timeoutMs: number) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await predicate()) {
      return;
    }
    await new Promise((r) => setTimeout(r, 50));
  }
  throw new Error(`waitFor timed out after ${timeoutMs}ms`);
}

describe('Phase 8 finalization queue integration', () => {
  let pg: StartedPostgreSqlContainer;
  let redisContainer: StartedTestContainer;
  let database: Database;
  let redis: ReturnType<typeof createRedisConnection>;
  let workerRedis: ReturnType<typeof createRedisConnection>;

  beforeAll(async () => {
    pg = await new PostgreSqlContainer(POSTGIS_IMAGE)
      .withDatabase('railmeet_phase8_queue')
      .withUsername('railmeet')
      .withPassword('railmeet')
      .start();
    const startedRedis = await startNoevictionRedisContainer();
    redisContainer = startedRedis.container;
    database = createDatabase({
      connectionString: pg.getConnectionUri(),
      maxConnections: 10,
    });
    await database.migrate();

    for (const place of [
      {
        id: 'place:berlin',
        name: 'Berlin',
        kind: 'city' as const,
        countryCode: 'DE',
        timezone: 'Europe/Berlin',
        location: { longitude: 13.405, latitude: 52.52 },
      },
      {
        id: 'place:paris',
        name: 'Paris',
        kind: 'city' as const,
        countryCode: 'FR',
        timezone: 'Europe/Paris',
        location: { longitude: 2.3522, latitude: 48.8566 },
      },
      {
        id: 'place:munich',
        name: 'Munich',
        kind: 'city' as const,
        countryCode: 'DE',
        timezone: 'Europe/Berlin',
        location: { longitude: 11.582, latitude: 48.1351 },
      },
      {
        id: 'place:cologne',
        name: 'Cologne',
        kind: 'city' as const,
        countryCode: 'DE',
        timezone: 'Europe/Berlin',
        location: { longitude: 6.9603, latitude: 50.9375 },
      },
    ]) {
      await database.places.create(place);
    }

    const redisUrl = startedRedis.connectionUrl;
    redis = createRedisConnection({
      url: redisUrl,
      commandTimeoutMs: 5_000,
      connectTimeoutMs: 5_000,
    });
    await assertRedisMaxmemoryPolicyNoeviction(redis);
    workerRedis = createRedisConnection({
      url: redisUrl,
      commandTimeoutMs: 5_000,
      connectTimeoutMs: 5_000,
      maxRetriesPerRequest: null,
      enableOfflineQueue: true,
    });
  }, 180_000);

  afterAll(async () => {
    if (redis) {
      await closeRedisConnection(redis);
    }
    if (workerRedis) {
      await closeRedisConnection(workerRedis);
    }
    await database?.close();
    await redisContainer?.stop();
    await pg?.stop();
  }, 60_000);

  async function createRunningSearch(rankingMode: 'fairest' | 'fastest-overall' = 'fairest') {
    const created = await database.meetingSearches.create({
      participants: [
        {
          participantId: 'a',
          displayName: 'A',
          originPlaceId: 'place:berlin',
          position: 0,
        },
        {
          participantId: 'b',
          displayName: 'B',
          originPlaceId: 'place:paris',
          position: 1,
        },
      ],
      travelDate: '2026-06-15',
      earliestDepartureTime: '08:00',
      latestArrivalTime: '22:00',
      arrivalDayOffset: 0,
      maxJourneyDurationMinutes: 400,
      maxTransfers: 1,
      minTransferDurationMinutes: 5,
      allowedTransportModes: ['train'],
      rankingMode,
    });
    expect(created.ok).toBe(true);
    if (!created.ok) {
      throw new Error('create failed');
    }
    await database.meetingSearches.tryKickoff(created.value.id);
    return created.value;
  }

  async function seedAndCompleteReady(searchId: string, rankingModeWinner = 'place:munich') {
    await database.searchPipeline.claimCandidateGeneration(searchId);
    await database.searchPipeline.persistCandidatesAndFanOut({
      searchId,
      candidates: [
        { destinationPlaceId: 'place:munich', ordinal: 0, distanceMeters: 1 },
        { destinationPlaceId: 'place:cologne', ordinal: 1, distanceMeters: 2 },
      ],
      participantIds: ['a', 'b'],
    });
    const workIds = (await database.outbox.findByAggregateId(searchId))
      .filter((event) => event.eventType === 'routing.requested')
      .map((event) => (event.payload as { routingWorkId: string }).routingWorkId);

    for (const workId of workIds) {
      const work = await database.searchPipeline.findRoutingWorkById(workId);
      const isWinner = work!.destinationPlaceId === rankingModeWinner;
      const departure = new Date('2026-06-15T08:00:00.000Z');
      const arrival = new Date(isWinner ? '2026-06-15T09:00:00.000Z' : '2026-06-15T11:00:00.000Z');
      const durationMinutes = isWinner ? 60 : 180;
      await database.searchPipeline.completeRoutingWorkWithJourneys({
        routingWorkId: workId,
        status: 'succeeded',
        journeys: [
          {
            journeyOrdinal: 0,
            departureAt: departure,
            arrivalAt: arrival,
            durationMinutes,
            transfers: 0,
            transportModes: ['train'],
            legs: [
              {
                mode: 'train',
                departureAt: departure,
                arrivalAt: arrival,
                durationMinutes,
              },
            ],
          },
        ],
      });
    }
    return workIds;
  }

  it('dispatches the last terminal routing finalization request into a ranked completion', async () => {
    const search = await createRunningSearch('fastest-overall');
    const startedAt = (await database.meetingSearches.findById(search.id))!.startedAt!;
    await seedAndCompleteReady(search.id);

    const finalizationEvents = (await database.outbox.findByAggregateId(search.id)).filter(
      (event) => event.eventType === 'meeting-search.finalization-requested',
    );
    expect(finalizationEvents.length).toBeGreaterThan(0);

    const logger = createLogger({ name: 'phase8-queue', level: 'silent', pretty: false });
    const publisher = createMeetingSearchQueuePublisher({
      connection: redis,
      jobOptions: testJobOptions,
    });
    const dispatcher = createOutboxDispatcher({
      outbox: database.outbox,
      publisher,
      logger,
      config: {
        pollIntervalMs: 60_000,
        batchSize: 50,
        leaseMs: 60_000,
        retryBaseMs: 100,
        retryMaxMs: 1_000,
        publishConcurrency: 4,
      },
    });

    const outcomes: string[] = [];
    const consumer = createFinalizationConsumer({
      connection: workerRedis,
      logger,
      concurrency: 1,
      processFinalization: async ({ searchId }) => {
        const result = await database.finalization.finalizeMeetingSearch(searchId);
        outcomes.push(result.outcome);
        if (result.outcome === 'not_found') {
          throw new UnrecoverableError('missing search');
        }
        if (result.outcome === 'completed') {
          return {
            searchId,
            outcome: 'completed',
            completionOutcome: result.completionOutcome,
          };
        }
        if (result.outcome === 'failed') {
          return {
            searchId,
            outcome: 'failed',
            failureCode: result.failureCode,
          };
        }
        return { searchId, outcome: result.outcome };
      },
    });
    void consumer.worker.run();

    for (let i = 0; i < 12; i += 1) {
      await dispatcher.runOnce();
      await new Promise((r) => setTimeout(r, 100));
    }

    await waitFor(async () => {
      const loaded = await database.meetingSearches.findById(search.id);
      return loaded?.status === 'completed';
    }, 20_000);

    const loaded = await database.meetingSearches.findById(search.id);
    expect(loaded?.status).toBe('completed');
    expect(loaded?.completionOutcome).toBe('ranked');
    expect(loaded?.recommendedDestinationPlaceId).toBe('place:munich');
    expect(loaded?.startedAt?.getTime()).toBe(startedAt.getTime());
    expect(outcomes).toContain('completed');

    const rankings = await database.finalization.listCandidateRankings(search.id);
    expect(new Set(rankings.map((row) => row.rankingMode)).size).toBe(4);
    const journeys = await database.finalization.listRankingJourneys(search.id);
    expect(journeys.length).toBe(rankings.length * 2);

    await consumer.close(5_000);
    await publisher.close();
  }, 90_000);

  it('returns not_ready for early finalization while leaving the search running', async () => {
    const search = await createRunningSearch();
    await database.searchPipeline.claimCandidateGeneration(search.id);
    await database.searchPipeline.persistCandidatesAndFanOut({
      searchId: search.id,
      candidates: [{ destinationPlaceId: 'place:munich', ordinal: 0, distanceMeters: 1 }],
      participantIds: ['a', 'b'],
    });

    const logger = createLogger({ name: 'phase8-early', level: 'silent', pretty: false });
    const queueName = `${MEETING_SEARCH_FINALIZATION_QUEUE_NAME}-${randomUUID()}`;
    let outcome = '';
    const consumer = createFinalizationConsumer({
      connection: workerRedis,
      logger,
      concurrency: 1,
      queueName,
      processFinalization: async ({ searchId }) => {
        const result = await database.finalization.finalizeMeetingSearch(searchId);
        outcome = result.outcome;
        return { searchId, outcome: result.outcome as 'not_ready' };
      },
    });
    void consumer.worker.run();
    const queue = new Queue(queueName, { connection: redis });
    await queue.add(
      MEETING_SEARCH_FINALIZATION_REQUESTED_JOB_NAME,
      { schemaVersion: 1, searchId: search.id },
      { jobId: `early-${search.id}` },
    );
    await waitFor(() => outcome === 'not_ready', 15_000);
    expect((await database.meetingSearches.findById(search.id))?.status).toBe('running');
    expect(await database.finalization.listCandidateRankings(search.id)).toHaveLength(0);
    await consumer.close(5_000);
    await queue.close();
  }, 60_000);
});
