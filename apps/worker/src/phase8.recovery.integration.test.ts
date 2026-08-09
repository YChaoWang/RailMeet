import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { promisify } from 'node:util';

import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { Queue } from 'bullmq';
import type { StartedTestContainer } from 'testcontainers';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createDatabase, type Database } from '@railmeet/database';
import { createLogger } from '@railmeet/observability';
import {
  MEETING_SEARCH_FINALIZATION_QUEUE_NAME,
  MEETING_SEARCH_FINALIZATION_REQUESTED_JOB_NAME,
  closeRedisConnection,
  createFinalizationConsumer,
  createRedisConnection,
} from '@railmeet/queue';

import {
  assertRedisMaxmemoryPolicyNoeviction,
  startNoevictionRedisContainer,
} from '../../../packages/queue/src/redis-noeviction.integration-util.js';
import { createFinalizationProcessor } from './finalization.js';

const POSTGIS_IMAGE = 'ghcr.io/baosystems/postgis:16-3.5';
const execFileAsync = promisify(execFile);

function deferred<T = void>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

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

describe('Phase 8 finalization recovery (real processor)', () => {
  let pg: StartedPostgreSqlContainer;
  let redisContainer: StartedTestContainer;
  let database: Database;
  let redis: ReturnType<typeof createRedisConnection>;
  let workerRedisA: ReturnType<typeof createRedisConnection>;
  let workerRedisB: ReturnType<typeof createRedisConnection>;

  beforeAll(async () => {
    pg = await new PostgreSqlContainer(POSTGIS_IMAGE)
      .withDatabase('railmeet_phase8')
      .withUsername('railmeet')
      .withPassword('railmeet')
      .start();
    const startedRedis = await startNoevictionRedisContainer();
    redisContainer = startedRedis.container;
    database = createDatabase({
      connectionString: pg.getConnectionUri(),
      maxConnections: 12,
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
    const workerOpts = {
      url: redisUrl,
      commandTimeoutMs: null,
      connectTimeoutMs: 5_000,
      maxRetriesPerRequest: null as null,
      enableOfflineQueue: true,
    };
    workerRedisA = createRedisConnection(workerOpts);
    workerRedisB = createRedisConnection(workerOpts);
  }, 180_000);

  afterAll(async () => {
    try {
      await execFileAsync('docker', ['unpause', redisContainer.getId()]);
    } catch {
      // already running
    }
    if (redis) {
      await closeRedisConnection(redis);
    }
    if (workerRedisA) {
      await closeRedisConnection(workerRedisA);
    }
    if (workerRedisB) {
      await closeRedisConnection(workerRedisB);
    }
    await database?.close();
    await redisContainer?.stop();
    await pg?.stop();
  }, 60_000);

  async function createReadySearch() {
    const created = await database.meetingSearches.create({
      participants: [
        {
          participantId: 'a',
          displayName: 'A',
          origin: { kind: 'existing', placeId: 'place:berlin' },
          position: 0,
        },
        {
          participantId: 'b',
          displayName: 'B',
          origin: { kind: 'existing', placeId: 'place:paris' },
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
      rankingMode: 'fairest',
    });
    expect(created.ok).toBe(true);
    if (!created.ok) {
      throw new Error('create failed');
    }
    await database.meetingSearches.tryKickoff(created.value.id);
    await database.searchPipeline.claimCandidateGeneration(created.value.id);
    await database.searchPipeline.persistCandidatesAndFanOut({
      searchId: created.value.id,
      candidates: [{ destinationPlaceId: 'place:munich', ordinal: 0, distanceMeters: 1 }],
      participantIds: ['a', 'b'],
    });
    const workIds = (await database.outbox.findByAggregateId(created.value.id))
      .filter((event) => event.eventType === 'routing.requested')
      .map((event) => (event.payload as { routingWorkId: string }).routingWorkId);
    for (const workId of workIds) {
      const departure = new Date('2026-06-15T08:00:00.000Z');
      const arrival = new Date('2026-06-15T10:00:00.000Z');
      await database.searchPipeline.completeRoutingWorkWithJourneys({
        routingWorkId: workId,
        status: 'succeeded',
        journeys: [
          {
            journeyOrdinal: 0,
            departureAt: departure,
            arrivalAt: arrival,
            durationMinutes: 120,
            transfers: 0,
            transportModes: ['train'],
            legs: [
              {
                mode: 'train',
                departureAt: departure,
                arrivalAt: arrival,
                durationMinutes: 120,
              },
            ],
          },
        ],
      });
    }
    return created.value;
  }

  function processor() {
    return createFinalizationProcessor({
      finalization: database.finalization,
      logger: createLogger({ name: 'phase8-fin', level: 'silent', pretty: false }),
    });
  }

  it('lets two real finalization workers compete with a single completion winner', async () => {
    const search = await createReadySearch();
    const logger = createLogger({ name: 'p8-race', level: 'silent', pretty: false });
    const queueName = `${MEETING_SEARCH_FINALIZATION_QUEUE_NAME}-${randomUUID()}`;
    const outcomes: string[] = [];
    const bothEntered = deferred();
    const release = deferred();
    let inFlight = 0;

    const makeProcess = () => {
      const inner = processor();
      return async (input: {
        searchId: string;
        jobId: string | undefined;
        attemptsMade: number;
      }) => {
        inFlight += 1;
        if (inFlight >= 2) {
          bothEntered.resolve();
        }
        await bothEntered.promise;
        await release.promise;
        const result = await inner(input);
        outcomes.push(result.outcome);
        inFlight -= 1;
        return result;
      };
    };

    const a = createFinalizationConsumer({
      connection: workerRedisA,
      logger,
      concurrency: 1,
      queueName,
      processFinalization: makeProcess(),
    });
    const b = createFinalizationConsumer({
      connection: workerRedisB,
      logger,
      concurrency: 1,
      queueName,
      processFinalization: makeProcess(),
    });
    void a.worker.run();
    void b.worker.run();
    const queue = new Queue(queueName, { connection: redis });
    await queue.add(
      MEETING_SEARCH_FINALIZATION_REQUESTED_JOB_NAME,
      { schemaVersion: 1, searchId: search.id },
      { jobId: `fin-a-${search.id}` },
    );
    await queue.add(
      MEETING_SEARCH_FINALIZATION_REQUESTED_JOB_NAME,
      { schemaVersion: 1, searchId: search.id },
      { jobId: `fin-b-${search.id}` },
    );
    await bothEntered.promise;
    release.resolve();
    await waitFor(() => outcomes.length >= 2, 20_000);
    expect(outcomes.filter((o) => o === 'completed')).toHaveLength(1);
    expect(outcomes.some((o) => o === 'already_terminal')).toBe(true);
    expect((await database.meetingSearches.findById(search.id))?.status).toBe('completed');
    expect(await database.finalization.listCandidateRankings(search.id)).not.toHaveLength(0);
    await a.close(5_000);
    await b.close(5_000);
    await queue.close();
  }, 90_000);

  it('retries finalization commit-before-ack without duplicating rankings', async () => {
    const search = await createReadySearch();
    const logger = createLogger({ name: 'p8-cba', level: 'silent', pretty: false });
    const queueName = `${MEETING_SEARCH_FINALIZATION_QUEUE_NAME}-${randomUUID()}`;
    let failAfterCommit = true;
    const inner = processor();
    const consumer = createFinalizationConsumer({
      connection: workerRedisA,
      logger,
      concurrency: 1,
      queueName,
      processFinalization: async (input) => {
        const result = await inner(input);
        if (result.outcome === 'completed' && failAfterCommit) {
          failAfterCommit = false;
          throw Object.assign(new Error('injected after finalization commit'), {
            code: 'ECONNRESET',
          });
        }
        return result;
      },
    });
    void consumer.worker.run();
    const queue = new Queue(queueName, {
      connection: redis,
      defaultJobOptions: { attempts: 3, backoff: { type: 'fixed', delay: 50 } },
    });
    const job = await queue.add(
      MEETING_SEARCH_FINALIZATION_REQUESTED_JOB_NAME,
      { schemaVersion: 1, searchId: search.id },
      { jobId: `fin-cba-${search.id}` },
    );
    await waitFor(async () => (await job.getState()) === 'completed', 20_000);
    expect(failAfterCommit).toBe(false);
    const rankings = await database.finalization.listCandidateRankings(search.id);
    const journeys = await database.finalization.listRankingJourneys(search.id);
    expect(rankings.length).toBeGreaterThan(0);
    expect(new Set(rankings.map((r) => `${r.rankingMode}:${r.destinationPlaceId}`)).size).toBe(
      rankings.length,
    );
    expect(
      new Set(journeys.map((j) => `${j.rankingMode}:${j.destinationPlaceId}:${j.participantId}`))
        .size,
    ).toBe(journeys.length);
    await consumer.close(5_000);
    await queue.close();
  }, 60_000);

  it('retries temporary PostgreSQL failure through a real finalization consumer', async () => {
    const search = await createReadySearch();
    const logger = createLogger({ name: 'p8-pg', level: 'silent', pretty: false });
    const queueName = `${MEETING_SEARCH_FINALIZATION_QUEUE_NAME}-${randomUUID()}`;
    let failOnce = true;
    const consumer = createFinalizationConsumer({
      connection: workerRedisA,
      logger,
      concurrency: 1,
      queueName,
      processFinalization: async (input) => {
        if (failOnce) {
          failOnce = false;
          throw Object.assign(new Error('temporary postgres unavailable'), {
            code: 'ECONNREFUSED',
          });
        }
        return processor()(input);
      },
    });
    void consumer.worker.run();
    const queue = new Queue(queueName, {
      connection: redis,
      defaultJobOptions: { attempts: 3, backoff: { type: 'fixed', delay: 50 } },
    });
    const job = await queue.add(
      MEETING_SEARCH_FINALIZATION_REQUESTED_JOB_NAME,
      { schemaVersion: 1, searchId: search.id },
      { jobId: `fin-pg-${search.id}` },
    );
    await waitFor(async () => (await job.getState()) === 'completed', 20_000);
    expect((await database.meetingSearches.findById(search.id))?.status).toBe('completed');
    await consumer.close(5_000);
    await queue.close();
  }, 60_000);

  it('keeps a Phase 8 finalization consumer alive across Redis pause/unpause', async () => {
    const search = await createReadySearch();
    const logger = createLogger({ name: 'p8-pause', level: 'silent', pretty: false });
    const queueName = `${MEETING_SEARCH_FINALIZATION_QUEUE_NAME}-${randomUUID()}`;
    const consumer = createFinalizationConsumer({
      connection: workerRedisA,
      logger,
      concurrency: 1,
      queueName,
      processFinalization: processor(),
    });
    void consumer.worker.run();
    await execFileAsync('docker', ['pause', redisContainer.getId()]);
    await new Promise((r) => setTimeout(r, 500));
    expect(consumer.worker.isRunning()).toBe(true);
    await execFileAsync('docker', ['unpause', redisContainer.getId()]);
    await new Promise((r) => setTimeout(r, 1_000));
    const queue = new Queue(queueName, { connection: redis });
    const job = await queue.add(
      MEETING_SEARCH_FINALIZATION_REQUESTED_JOB_NAME,
      { schemaVersion: 1, searchId: search.id },
      { jobId: `fin-pause-${search.id}` },
    );
    await waitFor(async () => (await job.getState()) === 'completed', 30_000);
    expect((await database.meetingSearches.findById(search.id))?.status).toBe('completed');
    await consumer.close(5_000);
    await queue.close();
  }, 90_000);

  it('re-adds a completed finalization job deterministically after BullMQ removal', async () => {
    const search = await createReadySearch();
    const logger = createLogger({ name: 'p8-readd', level: 'silent', pretty: false });
    const queueName = `${MEETING_SEARCH_FINALIZATION_QUEUE_NAME}-${randomUUID()}`;
    const consumer = createFinalizationConsumer({
      connection: workerRedisA,
      logger,
      concurrency: 1,
      queueName,
      processFinalization: processor(),
    });
    void consumer.worker.run();
    const jobId = `fin-readd-${search.id}`;
    const queue = new Queue(queueName, { connection: redis });
    const first = await queue.add(
      MEETING_SEARCH_FINALIZATION_REQUESTED_JOB_NAME,
      { schemaVersion: 1, searchId: search.id },
      { jobId },
    );
    await waitFor(async () => (await first.getState()) === 'completed', 20_000);
    const rankingCount = (await database.finalization.listCandidateRankings(search.id)).length;
    await first.remove();
    const second = await queue.add(
      MEETING_SEARCH_FINALIZATION_REQUESTED_JOB_NAME,
      { schemaVersion: 1, searchId: search.id },
      { jobId },
    );
    await waitFor(async () => (await second.getState()) === 'completed', 20_000);
    expect((await queue.getJob(jobId))?.returnvalue).toMatchObject({
      outcome: 'already_terminal',
    });
    expect(await database.finalization.listCandidateRankings(search.id)).toHaveLength(rankingCount);
    await consumer.close(5_000);
    await queue.close();
  }, 60_000);

  it('rejects malformed finalization jobs as unrecoverable without mutating the search', async () => {
    const search = await createReadySearch();
    const before = await database.meetingSearches.findById(search.id);
    const logger = createLogger({ name: 'p8-bad', level: 'silent', pretty: false });
    let failed = false;
    const consumer = createFinalizationConsumer({
      connection: workerRedisA,
      logger,
      concurrency: 1,
      processFinalization: async () => {
        throw new Error('should not run');
      },
    });
    consumer.worker.on('failed', () => {
      failed = true;
    });
    void consumer.worker.run();
    const queue = new Queue(MEETING_SEARCH_FINALIZATION_QUEUE_NAME, { connection: redis });
    await queue.add(MEETING_SEARCH_FINALIZATION_REQUESTED_JOB_NAME, {
      schemaVersion: 1,
      searchId: 'not-a-uuid',
    });
    await waitFor(() => failed, 10_000);
    const after = await database.meetingSearches.findById(search.id);
    expect(after?.status).toBe(before?.status);
    expect(after?.updatedAt.getTime()).toBe(before?.updatedAt.getTime());
    await consumer.close(5_000);
    await queue.close();
  }, 30_000);

  it('gracefully shuts down a finalization consumer with in-flight work and leaves later jobs for another worker', async () => {
    const first = await createReadySearch();
    const second = await createReadySearch();
    const logger = createLogger({ name: 'p8-sd', level: 'silent', pretty: false });
    const queueName = `${MEETING_SEARCH_FINALIZATION_QUEUE_NAME}-${randomUUID()}`;
    const firstEntered = deferred();
    const releaseFirst = deferred();
    let processedSecondOnClosingWorker = false;
    const inner = processor();

    const consumer = createFinalizationConsumer({
      connection: workerRedisA,
      logger,
      concurrency: 1,
      queueName,
      processFinalization: async (input) => {
        if (input.searchId === first.id) {
          firstEntered.resolve();
          await releaseFirst.promise;
          return inner(input);
        }
        processedSecondOnClosingWorker = true;
        return inner(input);
      },
    });
    void consumer.worker.run();
    const queue = new Queue(queueName, { connection: redis });
    const job1 = await queue.add(
      MEETING_SEARCH_FINALIZATION_REQUESTED_JOB_NAME,
      { schemaVersion: 1, searchId: first.id },
      { jobId: `fin-sd-1-${first.id}` },
    );
    await firstEntered.promise;
    const job2 = await queue.add(
      MEETING_SEARCH_FINALIZATION_REQUESTED_JOB_NAME,
      { schemaVersion: 1, searchId: second.id },
      { jobId: `fin-sd-2-${second.id}` },
    );
    const closing = consumer.close(10_000);
    await new Promise((r) => setTimeout(r, 150));
    expect(await job2.getState()).not.toBe('completed');
    releaseFirst.resolve();
    expect(await closing).toBe('closed');
    expect(processedSecondOnClosingWorker).toBe(false);
    expect(await job1.getState()).toBe('completed');

    const takeover = createFinalizationConsumer({
      connection: workerRedisB,
      logger,
      concurrency: 1,
      queueName,
      processFinalization: processor(),
    });
    void takeover.worker.run();
    await waitFor(async () => (await job2.getState()) === 'completed', 20_000);
    expect((await database.meetingSearches.findById(second.id))?.status).toBe('completed');
    await takeover.close(5_000);
    await queue.close();
  }, 90_000);
});
