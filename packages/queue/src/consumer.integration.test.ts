import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { promisify } from 'node:util';

import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { RedisContainer, type StartedRedisContainer } from '@testcontainers/redis';
import { Queue, UnrecoverableError } from 'bullmq';
import { Redis } from 'ioredis';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { createDatabase, type Database } from '@railmeet/database';
import { createLogger } from '@railmeet/observability';

import {
  MEETING_SEARCH_REQUESTED_JOB_NAME,
  MEETING_SEARCHES_QUEUE_NAME,
  meetingSearchRequestedJobId,
} from './contract.js';
import { createMeetingSearchConsumer } from './consumer.js';
import { createOutboxDispatcher } from './dispatcher.js';
import { createMeetingSearchQueuePublisher } from './publisher.js';
import { closeRedisConnection, createRedisConnection } from './redis.js';

const POSTGIS_IMAGE = 'ghcr.io/baosystems/postgis:16-3.5';
const execFileAsync = promisify(execFile);

const testJobOptions = {
  attempts: 3,
  backoffDelayMs: 200,
  backoffJitter: 0.2,
  removeOnCompleteAgeSeconds: 3_600,
  removeOnCompleteCount: 1_000,
  removeOnFailAgeSeconds: 86_400,
  removeOnFailCount: 5_000,
} as const;

function deferred<T = void>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

async function waitFor(
  predicate: () => Promise<boolean> | boolean,
  timeoutMs: number,
  intervalMs = 50,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await predicate()) {
      return;
    }
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  throw new Error(`waitFor timed out after ${timeoutMs}ms`);
}

describe('meeting-search kickoff consumer integration', () => {
  let pg: StartedPostgreSqlContainer;
  let redisContainer: StartedRedisContainer;
  let database: Database;
  let redis: Redis;
  let workerRedis: Redis;
  let workerRedisB: Redis;
  let inspectionRedis: Redis;

  beforeAll(async () => {
    pg = await new PostgreSqlContainer(POSTGIS_IMAGE)
      .withDatabase('railmeet_consumer')
      .withUsername('railmeet')
      .withPassword('railmeet')
      .start();
    redisContainer = await new RedisContainer('redis:7-alpine').start();

    database = createDatabase({
      connectionString: pg.getConnectionUri(),
      maxConnections: 8,
    });
    await database.migrate();
    await database.places.create({
      id: 'place:berlin',
      name: 'Berlin',
      kind: 'city',
      countryCode: 'DE',
      timezone: 'Europe/Berlin',
      location: { longitude: 13.405, latitude: 52.52 },
    });
    await database.places.create({
      id: 'place:paris',
      name: 'Paris',
      kind: 'city',
      countryCode: 'FR',
      timezone: 'Europe/Paris',
      location: { longitude: 2.3522, latitude: 48.8566 },
    });

    redis = createRedisConnection({
      url: redisContainer.getConnectionUrl(),
      commandTimeoutMs: 5_000,
      connectTimeoutMs: 5_000,
    });
    workerRedis = createRedisConnection({
      url: redisContainer.getConnectionUrl(),
      commandTimeoutMs: 5_000,
      connectTimeoutMs: 5_000,
      maxRetriesPerRequest: null,
      enableOfflineQueue: true,
    });
    workerRedisB = createRedisConnection({
      url: redisContainer.getConnectionUrl(),
      commandTimeoutMs: 5_000,
      connectTimeoutMs: 5_000,
      maxRetriesPerRequest: null,
      enableOfflineQueue: true,
    });
    inspectionRedis = new Redis(redisContainer.getConnectionUrl(), {
      maxRetriesPerRequest: 1,
    });
  }, 180_000);

  afterAll(async () => {
    try {
      await execFileAsync('docker', ['unpause', redisContainer.getId()]);
    } catch {
      // already running
    }
    await closeRedisConnection(redis);
    await closeRedisConnection(workerRedis);
    await closeRedisConnection(workerRedisB);
    try {
      await inspectionRedis.quit();
    } catch {
      inspectionRedis.disconnect();
    }
    await database?.close();
    await redisContainer?.stop();
    await pg?.stop();
  }, 60_000);

  async function createSearch() {
    const result = await database.meetingSearches.create({
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
      rankingMode: 'fairest',
    });
    expect(result.ok).toBe(true);
    if (!result.ok) {
      throw new Error('failed');
    }
    return result.value;
  }

  function kickoffProcessor() {
    return async ({
      searchId,
    }: {
      searchId: string;
      jobId: string | undefined;
      attemptsMade: number;
    }) => {
      const result = await database.meetingSearches.tryKickoff(searchId);
      if (result.outcome === 'not_found') {
        throw new UnrecoverableError(`Meeting search not found: ${searchId}`);
      }
      if (result.outcome === 'started') {
        return { searchId, transition: 'started' as const };
      }
      if (result.outcome === 'already_started') {
        return { searchId, transition: 'already_started' as const };
      }
      return { searchId, transition: 'already_terminal' as const };
    };
  }

  async function countExtraOutboxForSearch(searchId: string): Promise<number> {
    const events = await database.outbox.findByAggregateId(searchId);
    return events.length;
  }

  it('dispatches, consumes, and leaves the search running without fabricated results', async () => {
    const search = await createSearch();
    const [event] = await database.outbox.findByAggregateId(search.id);
    const logger = createLogger({ name: 'consumer-it', level: 'silent', pretty: false });
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
        batchSize: 10,
        leaseMs: 60_000,
        retryBaseMs: 1_000,
        retryMaxMs: 60_000,
        publishConcurrency: 1,
      },
    });
    const consumer = createMeetingSearchConsumer({
      connection: workerRedis,
      logger,
      concurrency: 2,
      processKickoff: kickoffProcessor(),
    });

    void consumer.worker.run();
    await dispatcher.runOnce();

    await waitFor(async () => {
      const loaded = await database.meetingSearches.findById(search.id);
      return loaded?.status === 'running';
    }, 15_000);

    const running = await database.meetingSearches.findById(search.id);
    expect(running?.status).toBe('running');
    expect(running?.startedAt).not.toBeNull();
    const startedAt = running!.startedAt!;

    const outbox = await database.outbox.findById(event!.id);
    expect(outbox?.publishedAt).not.toBeNull();

    const queue = new Queue(MEETING_SEARCHES_QUEUE_NAME, { connection: inspectionRedis });
    const job = await queue.getJob(meetingSearchRequestedJobId(event!.id));
    expect(job).toBeTruthy();
    expect(job?.name).toBe(MEETING_SEARCH_REQUESTED_JOB_NAME);
    expect(job?.data).toEqual({ schemaVersion: 1, searchId: search.id });
    expect(job?.opts.attempts).toBe(testJobOptions.attempts);
    expect(job?.opts.backoff).toMatchObject({
      type: 'exponential',
      delay: testJobOptions.backoffDelayMs,
      jitter: testJobOptions.backoffJitter,
    });
    expect(job?.opts.removeOnComplete).toMatchObject({
      age: testJobOptions.removeOnCompleteAgeSeconds,
      count: testJobOptions.removeOnCompleteCount,
    });
    expect(job?.opts.removeOnFail).toMatchObject({
      age: testJobOptions.removeOnFailAgeSeconds,
      count: testJobOptions.removeOnFailCount,
    });

    await waitFor(async () => (await job!.getState()) === 'completed', 10_000);
    expect(await job!.getState()).toBe('completed');

    const again = await database.meetingSearches.tryKickoff(search.id);
    expect(again.outcome).toBe('already_started');
    expect((await database.meetingSearches.findById(search.id))?.startedAt?.getTime()).toBe(
      startedAt.getTime(),
    );
    expect((await database.meetingSearches.findById(search.id))?.status).toBe('running');
    // kickoff now also schedules candidates-requested in the same transaction
    expect(await countExtraOutboxForSearch(search.id)).toBe(2);

    await consumer.close(5_000);
    await publisher.close();
    await queue.close();
  }, 60_000);

  it('rejects malformed jobs as unrecoverable without marking searches failed', async () => {
    const logger = createLogger({ name: 'consumer-it', level: 'silent', pretty: false });
    let sawUnrecoverable = false;
    const consumer = createMeetingSearchConsumer({
      connection: workerRedis,
      logger,
      concurrency: 1,
      processKickoff: async () => {
        throw new Error('should not process');
      },
    });
    consumer.worker.on('failed', (_job, error) => {
      if (error instanceof UnrecoverableError || error.name === 'UnrecoverableError') {
        sawUnrecoverable = true;
      }
    });
    void consumer.worker.run();

    const queue = new Queue(MEETING_SEARCHES_QUEUE_NAME, { connection: redis });
    await queue.add('wrong-name', { schemaVersion: 1, searchId: 'not-a-uuid' });

    await waitFor(() => sawUnrecoverable, 10_000);
    expect(sawUnrecoverable).toBe(true);

    await consumer.close(5_000);
    await queue.close();
  }, 30_000);

  it('keeps the consumer alive across Redis pause and does not mark searches failed', async () => {
    const search = await createSearch();
    const logger = createLogger({ name: 'consumer-it', level: 'silent', pretty: false });
    const publisher = createMeetingSearchQueuePublisher({
      connection: redis,
      jobOptions: testJobOptions,
    });
    const dispatcher = createOutboxDispatcher({
      outbox: database.outbox,
      publisher,
      logger,
      config: {
        pollIntervalMs: 200,
        batchSize: 10,
        leaseMs: 60_000,
        retryBaseMs: 100,
        retryMaxMs: 500,
        publishConcurrency: 1,
      },
    });
    const consumer = createMeetingSearchConsumer({
      connection: workerRedis,
      logger,
      concurrency: 1,
      processKickoff: kickoffProcessor(),
    });
    void consumer.worker.run();

    await execFileAsync('docker', ['pause', redisContainer.getId()]);
    await new Promise((r) => setTimeout(r, 500));
    expect(consumer.worker.isRunning()).toBe(true);

    await execFileAsync('docker', ['unpause', redisContainer.getId()]);
    await new Promise((r) => setTimeout(r, 1_000));

    await dispatcher.runOnce();
    await waitFor(async () => {
      const loaded = await database.meetingSearches.findById(search.id);
      if (loaded?.status === 'running') {
        return true;
      }
      await dispatcher.runOnce();
      return false;
    }, 20_000);
    const loaded = await database.meetingSearches.findById(search.id);
    expect(loaded?.status).toBe('running');
    expect(loaded?.status).not.toBe('failed');

    await consumer.close(5_000);
    await publisher.close();
  }, 60_000);

  it('reprocesses the same logical search after completed-job removal without resetting started_at', async () => {
    const queueName = `meeting-searches-a1-${randomUUID()}`;
    const search = await createSearch();
    const logger = createLogger({ name: 'consumer-a1', level: 'silent', pretty: false });
    const jobOptions = {
      ...testJobOptions,
      attempts: 2,
      backoffDelayMs: 100,
      removeOnCompleteAgeSeconds: 60,
      removeOnCompleteCount: 1,
    };
    const queue = new Queue(queueName, {
      connection: redis,
      defaultJobOptions: {
        attempts: jobOptions.attempts,
        backoff: {
          type: 'exponential',
          delay: jobOptions.backoffDelayMs,
          jitter: jobOptions.backoffJitter,
        },
        removeOnComplete: {
          age: jobOptions.removeOnCompleteAgeSeconds,
          count: jobOptions.removeOnCompleteCount,
        },
        removeOnFail: {
          age: jobOptions.removeOnFailAgeSeconds,
          count: jobOptions.removeOnFailCount,
        },
      },
    });
    const consumer = createMeetingSearchConsumer({
      connection: workerRedis,
      logger,
      concurrency: 1,
      queueName,
      processKickoff: kickoffProcessor(),
    });
    void consumer.worker.run();

    const jobId = `kickoff-${search.id}`;
    const job = await queue.add(
      MEETING_SEARCH_REQUESTED_JOB_NAME,
      { schemaVersion: 1, searchId: search.id },
      { jobId },
    );
    await waitFor(async () => (await job.getState()) === 'completed', 15_000);

    const afterFirst = await database.meetingSearches.findById(search.id);
    expect(afterFirst?.status).toBe('running');
    expect(afterFirst?.startedAt).not.toBeNull();
    const startedAt = afterFirst!.startedAt!;
    const outboxBefore = await countExtraOutboxForSearch(search.id);

    await job.remove();
    expect(await queue.getJob(jobId)).toBeUndefined();

    const second = await queue.add(
      MEETING_SEARCH_REQUESTED_JOB_NAME,
      { schemaVersion: 1, searchId: search.id },
      { jobId },
    );
    await waitFor(async () => (await second.getState()) === 'completed', 15_000);
    const secondFinished = await queue.getJob(jobId);
    expect(await secondFinished!.getState()).toBe('completed');
    expect(secondFinished?.returnvalue).toMatchObject({
      searchId: search.id,
      transition: 'already_started',
    });

    const afterSecond = await database.meetingSearches.findById(search.id);
    expect(afterSecond?.status).toBe('running');
    expect(afterSecond?.startedAt?.getTime()).toBe(startedAt.getTime());
    expect(await countExtraOutboxForSearch(search.id)).toBe(outboxBefore);

    await consumer.close(5_000);
    await queue.close();
  }, 60_000);

  it('runs two real BullMQ workers with only one PostgreSQL CAS kickoff winner', async () => {
    const queueName = `meeting-searches-a2-${randomUUID()}`;
    const search = await createSearch();
    const logger = createLogger({ name: 'consumer-a2', level: 'silent', pretty: false });
    const bothEntered = deferred();
    let inFlight = 0;
    let maxInFlight = 0;
    const release = deferred();
    const processedBy: string[] = [];
    const outcomes: string[] = [];

    const makeProcessor = (label: string) => {
      return async ({ searchId }: { searchId: string }) => {
        processedBy.push(label);
        inFlight += 1;
        maxInFlight = Math.max(maxInFlight, inFlight);
        if (processedBy.length >= 2) {
          bothEntered.resolve();
        }
        await bothEntered.promise;
        await release.promise;
        const result = await database.meetingSearches.tryKickoff(searchId);
        inFlight -= 1;
        outcomes.push(result.outcome);
        if (result.outcome === 'not_found') {
          throw new UnrecoverableError(`Meeting search not found: ${searchId}`);
        }
        if (result.outcome === 'started') {
          return { searchId, transition: 'started' as const };
        }
        if (result.outcome === 'already_started') {
          return { searchId, transition: 'already_started' as const };
        }
        return { searchId, transition: 'already_terminal' as const };
      };
    };

    const consumerA = createMeetingSearchConsumer({
      connection: workerRedis,
      logger,
      concurrency: 1,
      queueName,
      processKickoff: makeProcessor('A'),
    });
    const consumerB = createMeetingSearchConsumer({
      connection: workerRedisB,
      logger,
      concurrency: 1,
      queueName,
      processKickoff: makeProcessor('B'),
    });
    void consumerA.worker.run();
    void consumerB.worker.run();

    const queue = new Queue(queueName, { connection: redis });
    const jobA = await queue.add(
      MEETING_SEARCH_REQUESTED_JOB_NAME,
      { schemaVersion: 1, searchId: search.id },
      { jobId: `a2-a-${search.id}` },
    );
    const jobB = await queue.add(
      MEETING_SEARCH_REQUESTED_JOB_NAME,
      { schemaVersion: 1, searchId: search.id },
      { jobId: `a2-b-${search.id}` },
    );

    await waitFor(() => processedBy.length >= 2, 15_000);
    expect(new Set(processedBy).size).toBe(2);
    expect(maxInFlight).toBeGreaterThanOrEqual(2);
    release.resolve();

    await waitFor(async () => {
      return (await jobA.getState()) === 'completed' && (await jobB.getState()) === 'completed';
    }, 15_000);

    expect(outcomes.filter((o) => o === 'started')).toHaveLength(1);
    expect(outcomes.filter((o) => o === 'already_started')).toHaveLength(1);

    const loaded = await database.meetingSearches.findById(search.id);
    expect(loaded?.status).toBe('running');
    expect(loaded?.startedAt).not.toBeNull();
    expect(await countExtraOutboxForSearch(search.id)).toBe(2);

    await consumerA.close(5_000);
    await consumerB.close(5_000);
    await queue.close();
  }, 60_000);

  it('retries after commit-before-ack failure without resetting started_at', async () => {
    const queueName = `meeting-searches-a3-${randomUUID()}`;
    const search = await createSearch();
    const logger = createLogger({ name: 'consumer-a3', level: 'silent', pretty: false });
    let failAfterCommit = true;
    let attemptsSeen = 0;
    let startedAtAfterCommit: Date | undefined;

    const consumer = createMeetingSearchConsumer({
      connection: workerRedis,
      logger,
      concurrency: 1,
      queueName,
      processKickoff: async (input) => {
        attemptsSeen = input.attemptsMade + 1;
        const result = await kickoffProcessor()(input);
        if (result.transition === 'started' && failAfterCommit) {
          failAfterCommit = false;
          const loaded = await database.meetingSearches.findById(search.id);
          startedAtAfterCommit = loaded?.startedAt ?? undefined;
          expect(loaded?.status).toBe('running');
          const err = Object.assign(new Error('injected after kickoff commit'), {
            code: 'ECONNRESET',
          });
          throw err;
        }
        return result;
      },
    });
    void consumer.worker.run();

    const queue = new Queue(queueName, {
      connection: redis,
      defaultJobOptions: {
        attempts: 3,
        backoff: { type: 'fixed', delay: 50 },
      },
    });
    const job = await queue.add(
      MEETING_SEARCH_REQUESTED_JOB_NAME,
      { schemaVersion: 1, searchId: search.id },
      { jobId: `a3-${search.id}` },
    );

    await waitFor(async () => (await job.getState()) === 'completed', 20_000);
    const finished = await queue.getJob(`a3-${search.id}`);
    expect(await finished!.getState()).toBe('completed');
    expect(failAfterCommit).toBe(false);
    expect(attemptsSeen).toBeGreaterThanOrEqual(2);
    // BullMQ reports attemptsMade as zero-based failures before the successful attempt.
    expect(finished?.attemptsMade ?? 0).toBeGreaterThanOrEqual(1);
    expect(finished?.returnvalue).toMatchObject({
      searchId: search.id,
      transition: 'already_started',
    });

    const loaded = await database.meetingSearches.findById(search.id);
    expect(loaded?.status).toBe('running');
    expect(startedAtAfterCommit).toBeTruthy();
    expect(loaded?.startedAt?.getTime()).toBe(startedAtAfterCommit!.getTime());
    expect(await countExtraOutboxForSearch(search.id)).toBe(2);

    await consumer.close(5_000);
    await queue.close();
  }, 60_000);

  it('retries through a temporary PostgreSQL unavailable failure', async () => {
    const queueName = `meeting-searches-a4-${randomUUID()}`;
    const search = await createSearch();
    const logger = createLogger({ name: 'consumer-a4', level: 'silent', pretty: false });
    let failOnce = true;
    let attemptsSeen = 0;

    const consumer = createMeetingSearchConsumer({
      connection: workerRedis,
      logger,
      concurrency: 1,
      queueName,
      processKickoff: async (input) => {
        attemptsSeen = input.attemptsMade + 1;
        if (failOnce) {
          failOnce = false;
          throw Object.assign(new Error('temporary postgres unavailable'), {
            code: 'ECONNREFUSED',
          });
        }
        return kickoffProcessor()(input);
      },
    });
    void consumer.worker.run();

    const queue = new Queue(queueName, {
      connection: redis,
      defaultJobOptions: {
        attempts: 3,
        backoff: { type: 'fixed', delay: 50 },
      },
    });
    const job = await queue.add(
      MEETING_SEARCH_REQUESTED_JOB_NAME,
      { schemaVersion: 1, searchId: search.id },
      { jobId: `a4-${search.id}` },
    );

    await waitFor(async () => (await job.getState()) === 'completed', 20_000);
    expect(await job.getState()).toBe('completed');
    expect(failOnce).toBe(false);
    expect(attemptsSeen).toBeGreaterThanOrEqual(2);
    expect(attemptsSeen).toBeLessThanOrEqual(3);

    const loaded = await database.meetingSearches.findById(search.id);
    expect(loaded?.status).toBe('running');
    expect(loaded?.status).not.toBe('failed');
    expect(loaded?.startedAt).not.toBeNull();

    await consumer.close(5_000);
    await queue.close();
  }, 60_000);

  it('gracefully shuts down with in-flight work and leaves later jobs for another worker', async () => {
    const queueName = `meeting-searches-a5-${randomUUID()}`;
    const search1 = await createSearch();
    const search2 = await createSearch();
    const logger = createLogger({ name: 'consumer-a5', level: 'silent', pretty: false });
    const firstEntered = deferred();
    const releaseFirst = deferred();
    let processedSecondOnClosingWorker = false;

    const consumer = createMeetingSearchConsumer({
      connection: workerRedis,
      logger,
      concurrency: 1,
      queueName,
      processKickoff: async (input) => {
        if (input.searchId === search1.id) {
          firstEntered.resolve();
          await releaseFirst.promise;
          return kickoffProcessor()(input);
        }
        processedSecondOnClosingWorker = true;
        return kickoffProcessor()(input);
      },
    });
    void consumer.worker.run();

    const queue = new Queue(queueName, { connection: redis });
    const job1 = await queue.add(
      MEETING_SEARCH_REQUESTED_JOB_NAME,
      { schemaVersion: 1, searchId: search1.id },
      { jobId: `a5-1-${search1.id}` },
    );
    await firstEntered.promise;

    const job2 = await queue.add(
      MEETING_SEARCH_REQUESTED_JOB_NAME,
      { schemaVersion: 1, searchId: search2.id },
      { jobId: `a5-2-${search2.id}` },
    );

    const closing = consumer.close(10_000);
    // Allow BullMQ to begin close (stop accepting) while job1 remains held.
    await new Promise((r) => setTimeout(r, 150));
    expect(await job2.getState()).not.toBe('completed');
    releaseFirst.resolve();
    expect(await closing).toBe('closed');
    expect(processedSecondOnClosingWorker).toBe(false);
    expect(await job1.getState()).toBe('completed');
    expect(await job2.getState()).not.toBe('completed');

    const takeover = createMeetingSearchConsumer({
      connection: workerRedisB,
      logger,
      concurrency: 1,
      queueName,
      processKickoff: kickoffProcessor(),
    });
    void takeover.worker.run();
    await waitFor(async () => (await job2.getState()) === 'completed', 15_000);
    expect(await job2.getState()).toBe('completed');
    expect((await database.meetingSearches.findById(search2.id))?.status).toBe('running');

    await takeover.close(5_000);
    await queue.close();
  }, 60_000);

  it('logs shutdown timeout safely and leaves unfinished work recoverable', async () => {
    const queueName = `meeting-searches-a6-${randomUUID()}`;
    const search = await createSearch();
    const warn = vi.fn();
    const logger = {
      ...createLogger({ name: 'consumer-a6', level: 'silent', pretty: false }),
      warn,
    };
    const entered = deferred();
    const release = deferred();
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation((() => undefined) as never);

    const consumer = createMeetingSearchConsumer({
      connection: workerRedis,
      logger,
      concurrency: 1,
      queueName,
      processKickoff: async (input) => {
        entered.resolve();
        await release.promise;
        return kickoffProcessor()(input);
      },
    });
    void consumer.worker.run();

    const queue = new Queue(queueName, { connection: redis });
    const job = await queue.add(
      MEETING_SEARCH_REQUESTED_JOB_NAME,
      { schemaVersion: 1, searchId: search.id },
      { jobId: `a6-${search.id}` },
    );
    await entered.promise;

    const firstClose = await consumer.close(50);
    expect(firstClose).toBe('timed_out');
    expect(
      warn.mock.calls.some((call) => {
        const payload = call[0] as { event?: string };
        return payload?.event === 'search_consumer_close_timeout';
      }),
    ).toBe(true);
    expect(exitSpy).not.toHaveBeenCalled();

    const mid = await database.meetingSearches.findById(search.id);
    expect(mid?.status).not.toBe('failed');

    release.resolve();
    expect(await consumer.close(5_000)).toBe('closed');
    expect(exitSpy).not.toHaveBeenCalled();

    await waitFor(async () => {
      const state = await job.getState();
      return (
        state === 'completed' || state === 'failed' || state === 'waiting' || state === 'delayed'
      );
    }, 15_000);
    const finalState = await job.getState();
    expect(['completed', 'waiting', 'delayed', 'active']).toContain(finalState);

    const loaded = await database.meetingSearches.findById(search.id);
    expect(loaded?.status).not.toBe('failed');
    if (finalState === 'completed') {
      expect(loaded?.status).toBe('running');
    }

    exitSpy.mockRestore();
    await queue.close();
  }, 60_000);
});
