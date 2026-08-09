import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { RedisContainer, type StartedRedisContainer } from '@testcontainers/redis';
import { Queue } from 'bullmq';
import { Redis } from 'ioredis';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createDatabase, type Database } from '@railmeet/database';
import { createLogger } from '@railmeet/observability';

import {
  MEETING_SEARCH_REQUESTED_JOB_NAME,
  MEETING_SEARCHES_QUEUE_NAME,
  meetingSearchRequestedJobId,
} from './contract.js';
import { createOutboxDispatcher } from './dispatcher.js';
import { createMeetingSearchQueuePublisher } from './publisher.js';
import { closeRedisConnection, createRedisConnection } from './redis.js';

const POSTGIS_IMAGE = 'ghcr.io/baosystems/postgis:16-3.5';

const testJobOptions = {
  attempts: 5,
  backoffDelayMs: 1_000,
  backoffJitter: 0.2,
  removeOnCompleteAgeSeconds: 3_600,
  removeOnCompleteCount: 1_000,
  removeOnFailAgeSeconds: 86_400,
  removeOnFailCount: 5_000,
} as const;
const execFileAsync = promisify(execFile);

async function pauseContainer(containerId: string): Promise<void> {
  await execFileAsync('docker', ['pause', containerId]);
}

async function unpauseContainer(containerId: string): Promise<void> {
  await execFileAsync('docker', ['unpause', containerId]);
}

async function waitForRedisReady(redis: Redis, timeoutMs = 20_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const pong = await redis.ping();
      if (pong === 'PONG') {
        return;
      }
    } catch {
      // reconnecting
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error('Redis did not become ready in time');
}

describe('outbox to BullMQ integration', () => {
  let pg: StartedPostgreSqlContainer;
  let redisContainer: StartedRedisContainer;
  let database: Database;
  let redis: Redis;
  let inspectionRedis: Redis;

  beforeAll(async () => {
    pg = await new PostgreSqlContainer(POSTGIS_IMAGE)
      .withDatabase('railmeet_queue')
      .withUsername('railmeet')
      .withPassword('railmeet')
      .start();
    redisContainer = await new RedisContainer('redis:7-alpine').start();

    database = createDatabase({
      connectionString: pg.getConnectionUri(),
      maxConnections: 5,
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
    inspectionRedis = new Redis(redisContainer.getConnectionUrl(), {
      maxRetriesPerRequest: 1,
    });
  }, 180_000);

  afterAll(async () => {
    try {
      await unpauseContainer(redisContainer.getId());
    } catch {
      // may already be running
    }
    await closeRedisConnection(redis);
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
    expect(result.ok).toBe(true);
    if (!result.ok) {
      throw new Error('failed');
    }
    return result.value;
  }

  it('publishes exactly one waiting BullMQ job and marks the outbox published', async () => {
    const search = await createSearch();
    const [event] = await database.outbox.findByAggregateId(search.id);
    expect(event?.publishedAt).toBeNull();

    const publisher = createMeetingSearchQueuePublisher({
      connection: redis,
      jobOptions: testJobOptions,
    });
    const dispatcher = createOutboxDispatcher({
      outbox: database.outbox,
      publisher,
      logger: createLogger({ name: 'queue-it', level: 'silent', pretty: false }),
      config: {
        pollIntervalMs: 60_000,
        batchSize: 10,
        leaseMs: 60_000,
        retryBaseMs: 1_000,
        retryMaxMs: 60_000,
        publishConcurrency: 2,
      },
    });

    const stats = await dispatcher.runOnce();
    expect(stats.published).toBeGreaterThanOrEqual(1);

    const loaded = await database.outbox.findById(event!.id);
    expect(loaded?.publishedAt).not.toBeNull();
    expect(loaded?.leaseToken).toBeNull();
    expect(search.status).toBe('queued');
    const stillQueued = await database.meetingSearches.findById(search.id);
    expect(stillQueued?.status).toBe('queued');

    const queue = new Queue(MEETING_SEARCHES_QUEUE_NAME, { connection: inspectionRedis });
    const job = await queue.getJob(meetingSearchRequestedJobId(event!.id));
    expect(job).toBeTruthy();
    expect(job?.name).toBe(MEETING_SEARCH_REQUESTED_JOB_NAME);
    expect(job?.id).toBe(meetingSearchRequestedJobId(event!.id));
    expect(job?.data).toEqual({ schemaVersion: 1, searchId: search.id });
    expect(await job?.getState()).toBe('waiting');

    const second = await dispatcher.runOnce();
    expect(second.published).toBe(0);
    const again = await queue.getJob(meetingSearchRequestedJobId(event!.id));
    expect(again?.id).toBe(meetingSearchRequestedJobId(event!.id));
    expect(await queue.getWaitingCount()).toBeGreaterThanOrEqual(1);

    await queue.close();
    await publisher.close();
  });

  it('recovers crash-after-enqueue with claim, same job ID, and a single retained job', async () => {
    const search = await createSearch();
    const [event] = await database.outbox.findByAggregateId(search.id);
    const jobId = meetingSearchRequestedJobId(event!.id);
    const publisher = createMeetingSearchQueuePublisher({
      connection: redis,
      jobOptions: testJobOptions,
    });

    // Explicit crash window: claim → enqueue → skip mark-published → expire lease → reclaim.
    const leaseToken = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
    const claimed = await database.outbox.claimDue({
      batchSize: 50,
      leaseMs: 300,
      leaseToken,
    });
    expect(claimed.some((e) => e.id === event!.id)).toBe(true);

    const enqueueResult = await publisher.publishMeetingSearchRequested({
      jobId,
      data: { schemaVersion: 1, searchId: search.id },
    });
    expect(enqueueResult === 'added' || enqueueResult === 'already_exists').toBe(true);
    expect((await database.outbox.findById(event!.id))?.publishedAt).toBeNull();

    await new Promise((resolve) => setTimeout(resolve, 450));

    const dispatcher = createOutboxDispatcher({
      outbox: database.outbox,
      publisher,
      logger: createLogger({ name: 'queue-it', level: 'silent', pretty: false }),
      config: {
        pollIntervalMs: 60_000,
        batchSize: 20,
        leaseMs: 60_000,
        retryBaseMs: 1_000,
        retryMaxMs: 60_000,
        publishConcurrency: 1,
      },
    });
    await dispatcher.runOnce();

    const after = await database.outbox.findById(event!.id);
    expect(after?.publishedAt).not.toBeNull();
    expect(after?.leaseToken).toBeNull();

    const queue = new Queue(MEETING_SEARCHES_QUEUE_NAME, { connection: inspectionRedis });
    const job = await queue.getJob(jobId);
    expect(job).toBeTruthy();
    expect(job?.id).toBe(jobId);
    expect(job?.name).toBe(MEETING_SEARCH_REQUESTED_JOB_NAME);
    expect(job?.data).toEqual({ schemaVersion: 1, searchId: search.id });

    const waitingBefore = await queue.getWaitingCount();
    const duplicate = await publisher.publishMeetingSearchRequested({
      jobId,
      data: { schemaVersion: 1, searchId: search.id },
    });
    // BullMQ may return successfully without throwing on a retained jobId; delivery
    // success is the retained single job, not the added vs already_exists label.
    expect(duplicate === 'added' || duplicate === 'already_exists').toBe(true);
    expect(await queue.getJob(jobId)).toBeTruthy();
    expect(await queue.getWaitingCount()).toBe(waitingBefore);

    await queue.close();
    await publisher.close();
  });

  it('lets two dispatcher instances process the same backlog without duplicate jobs', async () => {
    const searches = await Promise.all([createSearch(), createSearch(), createSearch()]);
    const events = await Promise.all(
      searches.map(async (search) => {
        const [event] = await database.outbox.findByAggregateId(search.id);
        return event!;
      }),
    );

    const publisherA = createMeetingSearchQueuePublisher({
      connection: redis,
      jobOptions: testJobOptions,
    });
    const publisherB = createMeetingSearchQueuePublisher({
      connection: redis,
      jobOptions: testJobOptions,
    });
    const config = {
      pollIntervalMs: 60_000,
      batchSize: 10,
      leaseMs: 60_000,
      retryBaseMs: 1_000,
      retryMaxMs: 60_000,
      publishConcurrency: 2,
    } as const;
    const dispatcherA = createOutboxDispatcher({
      outbox: database.outbox,
      publisher: publisherA,
      logger: createLogger({ name: 'queue-a', level: 'silent', pretty: false }),
      config,
    });
    const dispatcherB = createOutboxDispatcher({
      outbox: database.outbox,
      publisher: publisherB,
      logger: createLogger({ name: 'queue-b', level: 'silent', pretty: false }),
      config,
    });

    const [statsA, statsB] = await Promise.all([dispatcherA.runOnce(), dispatcherB.runOnce()]);
    expect(statsA.published + statsB.published).toBeGreaterThanOrEqual(3);

    const queue = new Queue(MEETING_SEARCHES_QUEUE_NAME, { connection: inspectionRedis });
    for (const event of events) {
      const loaded = await database.outbox.findById(event.id);
      expect(loaded?.publishedAt).not.toBeNull();
      const job = await queue.getJob(meetingSearchRequestedJobId(event.id));
      expect(job).toBeTruthy();
      expect(job?.id).toBe(meetingSearchRequestedJobId(event.id));
    }
    await queue.close();
    await publisherA.close();
    await publisherB.close();
  });

  it('keeps the same dispatcher alive across Redis pause and publishes after unpause', async () => {
    const search = await createSearch();
    const [event] = await database.outbox.findByAggregateId(search.id);

    const publisher = createMeetingSearchQueuePublisher({
      connection: redis,
      jobOptions: testJobOptions,
    });
    const dispatcher = createOutboxDispatcher({
      outbox: database.outbox,
      publisher,
      logger: createLogger({ name: 'queue-it', level: 'silent', pretty: false }),
      config: {
        pollIntervalMs: 200,
        batchSize: 20,
        leaseMs: 60_000,
        retryBaseMs: 100,
        retryMaxMs: 500,
        publishConcurrency: 1,
      },
    });

    await pauseContainer(redisContainer.getId());
    const duringOutage = await dispatcher.runOnce();
    expect(duringOutage.retried).toBeGreaterThanOrEqual(1);
    const unpublished = await database.outbox.findById(event!.id);
    expect(unpublished?.publishedAt).toBeNull();
    expect(unpublished?.deadLetteredAt).toBeNull();
    expect(unpublished?.failureCount).toBeGreaterThan(0);

    await unpauseContainer(redisContainer.getId());
    await waitForRedisReady(redis);
    try {
      await waitForRedisReady(inspectionRedis);
    } catch {
      inspectionRedis.disconnect();
      await inspectionRedis.connect();
      await waitForRedisReady(inspectionRedis);
    }

    const deadline = Date.now() + 15_000;
    let published = 0;
    while (Date.now() < deadline) {
      const row = await database.outbox.findById(event!.id);
      if (row?.publishedAt) {
        published = 1;
        break;
      }
      if (row?.nextAttemptAt && row.nextAttemptAt.getTime() > Date.now()) {
        await new Promise((resolve) =>
          setTimeout(resolve, Math.min(250, row?.nextAttemptAt?.getTime() ?? 0 - Date.now() + 20)),
        );
      }
      const cycle = await dispatcher.runOnce();
      published += cycle.published;
      if (cycle.published > 0) {
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 100));
    }

    const done = await database.outbox.findById(event!.id);
    expect(done?.publishedAt).not.toBeNull();
    expect(published).toBeGreaterThanOrEqual(1);

    const stillQueued = await database.meetingSearches.findById(search.id);
    expect(stillQueued?.status).toBe('queued');

    const queue = new Queue(MEETING_SEARCHES_QUEUE_NAME, { connection: inspectionRedis });
    const job = await queue.getJob(meetingSearchRequestedJobId(event!.id));
    expect(job).toBeTruthy();
    expect(job?.id).toBe(meetingSearchRequestedJobId(event!.id));
    await queue.close();
    await publisher.close();
  }, 60_000);
});
