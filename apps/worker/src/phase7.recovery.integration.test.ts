import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { promisify } from 'node:util';

import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { RedisContainer, type StartedRedisContainer } from '@testcontainers/redis';
import { Queue } from 'bullmq';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createDatabase, type Database, type SearchPipelineRepository } from '@railmeet/database';
import { createLogger } from '@railmeet/observability';
import {
  MEETING_SEARCH_CANDIDATES_QUEUE_NAME,
  MEETING_SEARCH_CANDIDATES_REQUESTED_JOB_NAME,
  MEETING_SEARCH_ROUTING_QUEUE_NAME,
  ROUTING_REQUESTED_JOB_NAME,
  closeRedisConnection,
  createCandidateConsumer,
  createRedisConnection,
  createRoutingConsumer,
} from '@railmeet/queue';
import { createTransitousJourneyPlanner } from '@railmeet/routing';

import { createCandidateGenerationProcessor } from './candidate-generation.js';
import { createRoutingWorkProcessor } from './routing-work.js';

const POSTGIS_IMAGE = 'ghcr.io/baosystems/postgis:16-3.5';
const execFileAsync = promisify(execFile);

const sampleItinerary = {
  duration: 7200,
  startTime: '2026-06-15T08:00:00Z',
  endTime: '2026-06-15T10:00:00Z',
  transfers: 0,
  legs: [
    {
      mode: 'RAIL',
      startTime: '2026-06-15T08:00:00Z',
      endTime: '2026-06-15T10:00:00Z',
      duration: 7200,
      tripId: 'trip:1',
      from: { name: 'Berlin' },
      to: { name: 'Munich' },
      intermediateStops: [],
      realtime: false,
      agencyId: 'db',
      routeId: 'ice',
    },
  ],
};

const PROVIDER_ONLY_KEYS = new Set([
  'itineraries',
  'tripId',
  'startTime',
  'endTime',
  'from',
  'to',
  'intermediateStops',
  'realtime',
  'agencyId',
  'routeId',
]);

const ALLOWED_LEG_KEYS = new Set([
  'mode',
  'departureAt',
  'arrivalAt',
  'durationMinutes',
  'providerReference',
]);

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

function startMockServer(
  handler: (req: IncomingMessage, res: ServerResponse) => void | Promise<void>,
): Promise<{ server: ReturnType<typeof createServer>; baseUrl: string }> {
  const server = createServer((req, res) => {
    void Promise.resolve(handler(req, res)).catch(() => {
      res.statusCode = 500;
      res.end('error');
    });
  });
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const address = server.address() as AddressInfo;
      resolve({ server, baseUrl: `http://127.0.0.1:${address.port}` });
    });
  });
}

function assertNormalizedJourneyPersistence(value: unknown, path = 'root'): void {
  if (value === null || value === undefined) {
    return;
  }
  if (Array.isArray(value)) {
    for (const [index, entry] of value.entries()) {
      assertNormalizedJourneyPersistence(entry, `${path}[${index}]`);
    }
    return;
  }
  if (typeof value !== 'object') {
    return;
  }

  const record = value as Record<string, unknown>;
  if (Object.prototype.hasOwnProperty.call(record, 'itineraries')) {
    throw new Error(`Persisted journey graph must not embed raw Transitous response at ${path}`);
  }

  for (const key of Object.keys(record)) {
    if (PROVIDER_ONLY_KEYS.has(key)) {
      throw new Error(`Provider-only field "${key}" found at ${path}.${key}`);
    }
  }

  if (path.endsWith('.legs') || /\[legs\]|\.legs\[\d+\]$/.test(path)) {
    // handled below via leg objects
  }

  if (
    typeof record.mode === 'string' &&
    (record.departureAt instanceof Date || typeof record.departureAt === 'string') &&
    typeof record.durationMinutes === 'number'
  ) {
    for (const key of Object.keys(record)) {
      if (!ALLOWED_LEG_KEYS.has(key)) {
        throw new Error(`Unexpected leg field "${key}" at ${path}`);
      }
    }
  }

  for (const [key, child] of Object.entries(record)) {
    assertNormalizedJourneyPersistence(child, `${path}.${key}`);
  }
}

describe('Phase 7 recovery integration (real candidate/routing processors)', () => {
  let pg: StartedPostgreSqlContainer;
  let redisContainer: StartedRedisContainer;
  let database: Database;
  let redis: ReturnType<typeof createRedisConnection>;
  let candidateRedisA: ReturnType<typeof createRedisConnection>;
  let candidateRedisB: ReturnType<typeof createRedisConnection>;
  let routingRedisA: ReturnType<typeof createRedisConnection>;
  let routingRedisB: ReturnType<typeof createRedisConnection>;

  beforeAll(async () => {
    pg = await new PostgreSqlContainer(POSTGIS_IMAGE)
      .withDatabase('railmeet_phase7_recovery')
      .withUsername('railmeet')
      .withPassword('railmeet')
      .start();
    redisContainer = await new RedisContainer('redis:7-alpine').start();
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

    const redisUrl = redisContainer.getConnectionUrl();
    redis = createRedisConnection({
      url: redisUrl,
      commandTimeoutMs: 5_000,
      connectTimeoutMs: 5_000,
    });
    const workerOpts = {
      url: redisUrl,
      commandTimeoutMs: null,
      connectTimeoutMs: 5_000,
      maxRetriesPerRequest: null as null,
      enableOfflineQueue: true,
    };
    candidateRedisA = createRedisConnection(workerOpts);
    candidateRedisB = createRedisConnection(workerOpts);
    routingRedisA = createRedisConnection(workerOpts);
    routingRedisB = createRedisConnection(workerOpts);
  }, 180_000);

  afterAll(async () => {
    try {
      await execFileAsync('docker', ['unpause', redisContainer.getId()]);
    } catch {
      // already running
    }
    await closeRedisConnection(redis);
    await closeRedisConnection(candidateRedisA);
    await closeRedisConnection(candidateRedisB);
    await closeRedisConnection(routingRedisA);
    await closeRedisConnection(routingRedisB);
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
      throw new Error('create failed');
    }
    return result.value;
  }

  function wrapPipeline(overrides: Partial<SearchPipelineRepository>): SearchPipelineRepository {
    return { ...database.searchPipeline, ...overrides };
  }

  function candidateProcessor(pipeline: SearchPipelineRepository = database.searchPipeline) {
    return createCandidateGenerationProcessor({
      meetingSearches: database.meetingSearches,
      places: database.places,
      searchPipeline: pipeline,
      candidateLimit: 2,
      logger: createLogger({ name: 'phase7-candidate', level: 'silent', pretty: false }),
    });
  }

  function routingProcessor(
    baseUrl: string,
    pipeline: SearchPipelineRepository = database.searchPipeline,
  ) {
    return createRoutingWorkProcessor({
      meetingSearches: database.meetingSearches,
      places: database.places,
      searchPipeline: pipeline,
      journeyPlanner: createTransitousJourneyPlanner({
        baseUrl,
        userAgent: 'RailMeet/0.0.0 (+https://example.com/contact)',
        timeoutMs: 5_000,
        maxResponseBytes: 1_048_576,
      }),
      logger: createLogger({ name: 'phase7-routing', level: 'silent', pretty: false }),
    });
  }

  async function seedPendingCandidateGeneration() {
    const search = await createSearch();
    const kickoff = await database.meetingSearches.tryKickoff(search.id);
    expect(kickoff.outcome).toBe('started');
    const generation = await database.searchPipeline.findCandidateGeneration(search.id);
    expect(generation?.status).toBe('pending');
    return search;
  }

  async function seedPendingRoutingWork() {
    const search = await seedPendingCandidateGeneration();
    await database.searchPipeline.claimCandidateGeneration(search.id);
    await database.searchPipeline.persistCandidatesAndFanOut({
      searchId: search.id,
      candidates: [{ destinationPlaceId: 'place:munich', ordinal: 0, distanceMeters: 1 }],
      participantIds: ['a'],
    });
    const event = (await database.outbox.findByAggregateId(search.id)).find(
      (row) => row.eventType === 'routing.requested',
    );
    expect(event).toBeTruthy();
    const routingWorkId = (event!.payload as { routingWorkId: string }).routingWorkId;
    return { search, routingWorkId };
  }

  it('lets two real candidate workers compete with a single generation claim winner', async () => {
    const search = await seedPendingCandidateGeneration();
    const logger = createLogger({ name: 'p7-cand-race', level: 'silent', pretty: false });
    const claims: string[] = [];
    const bothEntered = deferred();
    const release = deferred();
    let inFlight = 0;

    const pipeline = wrapPipeline({
      claimCandidateGeneration: async (searchId) => {
        inFlight += 1;
        if (inFlight >= 2) {
          bothEntered.resolve();
        }
        await bothEntered.promise;
        await release.promise;
        const result = await database.searchPipeline.claimCandidateGeneration(searchId);
        claims.push(result.outcome);
        inFlight -= 1;
        return result;
      },
    });

    const queueName = `${MEETING_SEARCH_CANDIDATES_QUEUE_NAME}-${randomUUID()}`;
    const processCandidates = candidateProcessor(pipeline);
    const a = createCandidateConsumer({
      connection: candidateRedisA,
      logger,
      concurrency: 1,
      queueName,
      processCandidates,
    });
    const b = createCandidateConsumer({
      connection: candidateRedisB,
      logger,
      concurrency: 1,
      queueName,
      processCandidates,
    });
    void a.worker.run();
    void b.worker.run();

    const queue = new Queue(queueName, { connection: redis });
    await queue.add(
      MEETING_SEARCH_CANDIDATES_REQUESTED_JOB_NAME,
      { schemaVersion: 1, searchId: search.id },
      { jobId: `cand-a-${search.id}` },
    );
    await queue.add(
      MEETING_SEARCH_CANDIDATES_REQUESTED_JOB_NAME,
      { schemaVersion: 1, searchId: search.id },
      { jobId: `cand-b-${search.id}` },
    );

    await bothEntered.promise;
    const before = await database.searchPipeline.findCandidateGeneration(search.id);
    release.resolve();

    await waitFor(async () => {
      const generation = await database.searchPipeline.findCandidateGeneration(search.id);
      return generation?.status === 'succeeded' && claims.length >= 2;
    }, 30_000);

    expect(claims.filter((outcome) => outcome === 'claimed')).toHaveLength(1);
    expect(
      claims.some((outcome) => outcome === 'already_running' || outcome === 'already_succeeded'),
    ).toBe(true);

    const candidates = await database.searchPipeline.listCandidates(search.id);
    const workCount = await database.searchPipeline.countRoutingWorkForSearch(search.id);
    const routingEvents = (await database.outbox.findByAggregateId(search.id)).filter(
      (event) => event.eventType === 'routing.requested',
    );
    expect(candidates.length).toBeGreaterThan(0);
    expect(workCount).toBe(candidates.length * 2);
    expect(routingEvents).toHaveLength(workCount);

    const after = await database.searchPipeline.findCandidateGeneration(search.id);
    expect(after?.startedAt).toBeTruthy();
    expect(before?.startedAt).toBeNull();
    expect(after!.startedAt!.getTime()).toBeGreaterThan(0);
    // started_at set once by the claim winner and never reset on the loser/retry path
    const startedAt = after!.startedAt!;
    const recheck = await database.searchPipeline.findCandidateGeneration(search.id);
    expect(recheck?.startedAt?.getTime()).toBe(startedAt.getTime());

    await a.close(5_000);
    await b.close(5_000);
    await queue.close();
  }, 90_000);

  it('retries candidate commit-before-ack without duplicating candidates, work, or outbox', async () => {
    const search = await seedPendingCandidateGeneration();
    const logger = createLogger({ name: 'p7-cand-cba', level: 'silent', pretty: false });
    const queueName = `${MEETING_SEARCH_CANDIDATES_QUEUE_NAME}-${randomUUID()}`;
    let failAfterCommit = true;
    const inner = candidateProcessor();

    const consumer = createCandidateConsumer({
      connection: candidateRedisA,
      logger,
      concurrency: 1,
      queueName,
      processCandidates: async (input) => {
        const result = await inner(input);
        if (result.outcome === 'generated' && failAfterCommit) {
          failAfterCommit = false;
          throw Object.assign(new Error('injected after candidate commit'), { code: 'ECONNRESET' });
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
      MEETING_SEARCH_CANDIDATES_REQUESTED_JOB_NAME,
      { schemaVersion: 1, searchId: search.id },
      { jobId: `cand-cba-${search.id}` },
    );

    await waitFor(async () => (await job.getState()) === 'completed', 20_000);
    expect(failAfterCommit).toBe(false);

    const candidates = await database.searchPipeline.listCandidates(search.id);
    const workCount = await database.searchPipeline.countRoutingWorkForSearch(search.id);
    const routingEvents = (await database.outbox.findByAggregateId(search.id)).filter(
      (event) => event.eventType === 'routing.requested',
    );
    expect(candidates.length).toBeGreaterThan(0);
    expect(workCount).toBe(candidates.length * 2);
    expect(routingEvents).toHaveLength(workCount);
    expect(new Set(candidates.map((c) => c.destinationPlaceId)).size).toBe(candidates.length);
    expect(new Set(routingEvents.map((e) => e.dedupeKey)).size).toBe(routingEvents.length);

    const generation = await database.searchPipeline.findCandidateGeneration(search.id);
    expect(generation?.status).toBe('succeeded');
    expect(generation?.startedAt).toBeTruthy();

    await consumer.close(5_000);
    await queue.close();
  }, 60_000);

  it('treats duplicate routing delivery after terminal completion as already_terminal without Transitous', async () => {
    const { search, routingWorkId } = await seedPendingRoutingWork();
    let planCalls = 0;
    const { server, baseUrl } = await startMockServer((_req, res) => {
      planCalls += 1;
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({ itineraries: [sampleItinerary] }));
    });

    const logger = createLogger({ name: 'p7-route-dup', level: 'silent', pretty: false });
    const queueName = `${MEETING_SEARCH_ROUTING_QUEUE_NAME}-${randomUUID()}`;
    const processRouting = routingProcessor(baseUrl);
    const consumer = createRoutingConsumer({
      connection: routingRedisA,
      logger,
      concurrency: 1,
      queueName,
      processRouting,
    });
    void consumer.worker.run();

    const queue = new Queue(queueName, { connection: redis });
    const first = await queue.add(
      ROUTING_REQUESTED_JOB_NAME,
      { schemaVersion: 1, searchId: search.id, routingWorkId },
      { jobId: `route-dup-1-${routingWorkId}` },
    );
    await waitFor(async () => (await first.getState()) === 'completed', 20_000);
    const journeysAfterFirst =
      await database.searchPipeline.listJourneysForRoutingWork(routingWorkId);
    expect(journeysAfterFirst.length).toBeGreaterThan(0);
    assertNormalizedJourneyPersistence(journeysAfterFirst);
    expect(planCalls).toBe(1);

    const second = await queue.add(
      ROUTING_REQUESTED_JOB_NAME,
      { schemaVersion: 1, searchId: search.id, routingWorkId },
      { jobId: `route-dup-2-${routingWorkId}` },
    );
    await waitFor(async () => (await second.getState()) === 'completed', 20_000);
    const finished = await queue.getJob(`route-dup-2-${routingWorkId}`);
    expect(finished?.returnvalue).toMatchObject({
      routingWorkId,
      outcome: 'already_terminal',
    });
    expect(planCalls).toBe(1);
    const journeysAfterSecond =
      await database.searchPipeline.listJourneysForRoutingWork(routingWorkId);
    expect(journeysAfterSecond).toHaveLength(journeysAfterFirst.length);
    expect(JSON.stringify(journeysAfterSecond)).toBe(JSON.stringify(journeysAfterFirst));

    await consumer.close(5_000);
    await queue.close();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }, 60_000);

  it('retries journey persistence commit-before-ack without duplicating journeys or re-calling Transitous', async () => {
    const { search, routingWorkId } = await seedPendingRoutingWork();
    let planCalls = 0;
    const { server, baseUrl } = await startMockServer((_req, res) => {
      planCalls += 1;
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({ itineraries: [sampleItinerary, sampleItinerary] }));
    });

    const logger = createLogger({ name: 'p7-journey-cba', level: 'silent', pretty: false });
    const queueName = `${MEETING_SEARCH_ROUTING_QUEUE_NAME}-${randomUUID()}`;
    let failAfterPersist = true;
    const inner = routingProcessor(baseUrl);

    const consumer = createRoutingConsumer({
      connection: routingRedisA,
      logger,
      concurrency: 1,
      queueName,
      processRouting: async (input) => {
        const result = await inner(input);
        if (result.outcome === 'succeeded' && failAfterPersist) {
          failAfterPersist = false;
          throw Object.assign(new Error('injected after journey persist'), { code: 'ECONNRESET' });
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
      ROUTING_REQUESTED_JOB_NAME,
      { schemaVersion: 1, searchId: search.id, routingWorkId },
      { jobId: `route-cba-${routingWorkId}` },
    );

    await waitFor(async () => (await job.getState()) === 'completed', 20_000);
    expect(failAfterPersist).toBe(false);
    // First attempt persists + Transitous; retry is terminal/reclaim without another provider call.
    expect(planCalls).toBe(1);

    const work = await database.searchPipeline.findRoutingWorkById(routingWorkId);
    expect(work?.status).toBe('succeeded');
    const journeys = await database.searchPipeline.listJourneysForRoutingWork(routingWorkId);
    expect(journeys).toHaveLength(2);
    assertNormalizedJourneyPersistence(journeys);

    await consumer.close(5_000);
    await queue.close();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }, 60_000);

  it('retries temporary PostgreSQL failure through a real Phase 7 candidate consumer', async () => {
    const search = await seedPendingCandidateGeneration();
    const logger = createLogger({ name: 'p7-pg-fail', level: 'silent', pretty: false });
    const queueName = `${MEETING_SEARCH_CANDIDATES_QUEUE_NAME}-${randomUUID()}`;
    let failOnce = true;
    const pipeline = wrapPipeline({
      claimCandidateGeneration: async (searchId) => {
        if (failOnce) {
          failOnce = false;
          throw Object.assign(new Error('temporary postgres unavailable'), {
            code: 'ECONNREFUSED',
          });
        }
        return database.searchPipeline.claimCandidateGeneration(searchId);
      },
    });

    const consumer = createCandidateConsumer({
      connection: candidateRedisA,
      logger,
      concurrency: 1,
      queueName,
      processCandidates: candidateProcessor(pipeline),
    });
    void consumer.worker.run();

    const queue = new Queue(queueName, {
      connection: redis,
      defaultJobOptions: { attempts: 3, backoff: { type: 'fixed', delay: 50 } },
    });
    const job = await queue.add(
      MEETING_SEARCH_CANDIDATES_REQUESTED_JOB_NAME,
      { schemaVersion: 1, searchId: search.id },
      { jobId: `cand-pg-${search.id}` },
    );

    await waitFor(async () => (await job.getState()) === 'completed', 20_000);
    expect(failOnce).toBe(false);
    const candidates = await database.searchPipeline.listCandidates(search.id);
    const workCount = await database.searchPipeline.countRoutingWorkForSearch(search.id);
    expect(candidates.length).toBeGreaterThan(0);
    expect(workCount).toBe(candidates.length * 2);
    expect((await database.searchPipeline.findCandidateGeneration(search.id))?.status).toBe(
      'succeeded',
    );

    await consumer.close(5_000);
    await queue.close();
  }, 60_000);

  it('recovers from transient Transitous failure without sticking routing work in running', async () => {
    const { search, routingWorkId } = await seedPendingRoutingWork();
    let planCalls = 0;
    const { server, baseUrl } = await startMockServer((_req, res) => {
      planCalls += 1;
      if (planCalls === 1) {
        res.statusCode = 503;
        res.end('unavailable');
        return;
      }
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({ itineraries: [sampleItinerary] }));
    });

    const logger = createLogger({ name: 'p7-transitous-retry', level: 'silent', pretty: false });
    const queueName = `${MEETING_SEARCH_ROUTING_QUEUE_NAME}-${randomUUID()}`;
    const consumer = createRoutingConsumer({
      connection: routingRedisA,
      logger,
      concurrency: 1,
      queueName,
      processRouting: routingProcessor(baseUrl),
    });
    void consumer.worker.run();

    const queue = new Queue(queueName, {
      connection: redis,
      defaultJobOptions: { attempts: 3, backoff: { type: 'fixed', delay: 50 } },
    });
    const job = await queue.add(
      ROUTING_REQUESTED_JOB_NAME,
      { schemaVersion: 1, searchId: search.id, routingWorkId },
      { jobId: `route-tr-${routingWorkId}` },
    );

    await waitFor(async () => {
      const work = await database.searchPipeline.findRoutingWorkById(routingWorkId);
      return work?.status === 'succeeded' && (await job.getState()) === 'completed';
    }, 30_000);

    expect(planCalls).toBe(2);
    const work = await database.searchPipeline.findRoutingWorkById(routingWorkId);
    expect(work?.status).toBe('succeeded');
    expect(work?.startedAt).toBeTruthy();
    const journeys = await database.searchPipeline.listJourneysForRoutingWork(routingWorkId);
    expect(journeys).toHaveLength(1);
    assertNormalizedJourneyPersistence(journeys);
    // started_at stable across reclaim
    const startedAt = work!.startedAt!;
    expect(
      (await database.searchPipeline.findRoutingWorkById(routingWorkId))?.startedAt?.getTime(),
    ).toBe(startedAt.getTime());

    await consumer.close(5_000);
    await queue.close();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }, 60_000);

  it('keeps a Phase 7 routing consumer alive across same-process Redis pause/unpause', async () => {
    const { search, routingWorkId } = await seedPendingRoutingWork();
    let planCalls = 0;
    const { server, baseUrl } = await startMockServer((_req, res) => {
      planCalls += 1;
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({ itineraries: [sampleItinerary] }));
    });

    const logger = createLogger({ name: 'p7-redis-pause', level: 'silent', pretty: false });
    const queueName = `${MEETING_SEARCH_ROUTING_QUEUE_NAME}-${randomUUID()}`;
    const consumer = createRoutingConsumer({
      connection: routingRedisA,
      logger,
      concurrency: 1,
      queueName,
      processRouting: routingProcessor(baseUrl),
    });
    void consumer.worker.run();

    await execFileAsync('docker', ['pause', redisContainer.getId()]);
    await new Promise((r) => setTimeout(r, 500));
    expect(consumer.worker.isRunning()).toBe(true);
    await execFileAsync('docker', ['unpause', redisContainer.getId()]);
    await new Promise((r) => setTimeout(r, 1_000));

    const queue = new Queue(queueName, { connection: redis });
    const job = await queue.add(
      ROUTING_REQUESTED_JOB_NAME,
      { schemaVersion: 1, searchId: search.id, routingWorkId },
      { jobId: `route-pause-${routingWorkId}` },
    );
    await waitFor(async () => (await job.getState()) === 'completed', 30_000);
    expect(planCalls).toBe(1);
    expect((await database.searchPipeline.findRoutingWorkById(routingWorkId))?.status).toBe(
      'succeeded',
    );
    expect((await database.meetingSearches.findById(search.id))?.status).toBe('running');

    await consumer.close(5_000);
    await queue.close();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }, 90_000);

  it('re-adds a completed routing job deterministically after BullMQ removal', async () => {
    const { search, routingWorkId } = await seedPendingRoutingWork();
    let planCalls = 0;
    const { server, baseUrl } = await startMockServer((_req, res) => {
      planCalls += 1;
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({ itineraries: [sampleItinerary] }));
    });

    const logger = createLogger({ name: 'p7-readd', level: 'silent', pretty: false });
    const queueName = `${MEETING_SEARCH_ROUTING_QUEUE_NAME}-${randomUUID()}`;
    const consumer = createRoutingConsumer({
      connection: routingRedisA,
      logger,
      concurrency: 1,
      queueName,
      processRouting: routingProcessor(baseUrl),
    });
    void consumer.worker.run();

    const jobId = `route-readd-${routingWorkId}`;
    const queue = new Queue(queueName, { connection: redis });
    const first = await queue.add(
      ROUTING_REQUESTED_JOB_NAME,
      { schemaVersion: 1, searchId: search.id, routingWorkId },
      { jobId },
    );
    await waitFor(async () => (await first.getState()) === 'completed', 20_000);
    const journeys = await database.searchPipeline.listJourneysForRoutingWork(routingWorkId);
    expect(journeys).toHaveLength(1);
    expect(planCalls).toBe(1);

    await first.remove();
    expect(await queue.getJob(jobId)).toBeUndefined();

    const second = await queue.add(
      ROUTING_REQUESTED_JOB_NAME,
      { schemaVersion: 1, searchId: search.id, routingWorkId },
      { jobId },
    );
    await waitFor(async () => (await second.getState()) === 'completed', 20_000);
    const finished = await queue.getJob(jobId);
    expect(finished?.returnvalue).toMatchObject({
      outcome: 'already_terminal',
      journeyCount: 1,
    });
    expect(planCalls).toBe(1);
    expect(await database.searchPipeline.listJourneysForRoutingWork(routingWorkId)).toHaveLength(1);

    await consumer.close(5_000);
    await queue.close();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }, 60_000);

  it('gracefully shuts down a routing consumer with in-flight Transitous and leaves later work for another worker', async () => {
    const first = await seedPendingRoutingWork();
    const second = await seedPendingRoutingWork();
    const firstEntered = deferred();
    const releaseFirst = deferred();
    let processedSecondOnClosingWorker = false;
    let planCalls = 0;

    const { server, baseUrl } = await startMockServer(async (req, res) => {
      planCalls += 1;
      // Hold only the first in-flight Transitous request.
      if (planCalls === 1) {
        firstEntered.resolve();
        await releaseFirst.promise;
      }
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({ itineraries: [sampleItinerary] }));
      void req;
    });

    const logger = createLogger({ name: 'p7-shutdown', level: 'silent', pretty: false });
    const queueName = `${MEETING_SEARCH_ROUTING_QUEUE_NAME}-${randomUUID()}`;
    const processRouting = routingProcessor(baseUrl);

    const consumer = createRoutingConsumer({
      connection: routingRedisA,
      logger,
      concurrency: 1,
      queueName,
      processRouting: async (input) => {
        if (input.routingWorkId === second.routingWorkId) {
          processedSecondOnClosingWorker = true;
        }
        return processRouting(input);
      },
    });
    void consumer.worker.run();

    const queue = new Queue(queueName, { connection: redis });
    const job1 = await queue.add(
      ROUTING_REQUESTED_JOB_NAME,
      {
        schemaVersion: 1,
        searchId: first.search.id,
        routingWorkId: first.routingWorkId,
      },
      { jobId: `route-sd-1-${first.routingWorkId}` },
    );
    await firstEntered.promise;

    const job2 = await queue.add(
      ROUTING_REQUESTED_JOB_NAME,
      {
        schemaVersion: 1,
        searchId: second.search.id,
        routingWorkId: second.routingWorkId,
      },
      { jobId: `route-sd-2-${second.routingWorkId}` },
    );

    const closing = consumer.close(10_000);
    await new Promise((r) => setTimeout(r, 150));
    expect(await job2.getState()).not.toBe('completed');
    releaseFirst.resolve();
    expect(await closing).toBe('closed');
    expect(processedSecondOnClosingWorker).toBe(false);
    expect(await job1.getState()).toBe('completed');
    expect(await job2.getState()).not.toBe('completed');

    const takeover = createRoutingConsumer({
      connection: routingRedisB,
      logger,
      concurrency: 1,
      queueName,
      processRouting,
    });
    void takeover.worker.run();
    await waitFor(async () => (await job2.getState()) === 'completed', 20_000);
    expect((await database.searchPipeline.findRoutingWorkById(second.routingWorkId))?.status).toBe(
      'succeeded',
    );

    await takeover.close(5_000);
    await queue.close();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }, 90_000);

  it('rejects malformed routing jobs as unrecoverable without mutating routing work or the search', async () => {
    const { search, routingWorkId } = await seedPendingRoutingWork();
    const beforeWork = await database.searchPipeline.findRoutingWorkById(routingWorkId);
    const beforeSearch = await database.meetingSearches.findById(search.id);
    const logger = createLogger({ name: 'p7-bad-route', level: 'silent', pretty: false });
    let failed = false;

    const consumer = createRoutingConsumer({
      connection: routingRedisA,
      logger,
      concurrency: 1,
      processRouting: async () => {
        throw new Error('should not run processor for malformed routing job');
      },
    });
    consumer.worker.on('failed', () => {
      failed = true;
    });
    void consumer.worker.run();

    const queue = new Queue(MEETING_SEARCH_ROUTING_QUEUE_NAME, { connection: redis });
    await queue.add(ROUTING_REQUESTED_JOB_NAME, {
      schemaVersion: 1,
      searchId: 'not-a-uuid',
      routingWorkId: 'also-not-a-uuid',
    });

    await waitFor(() => failed, 10_000);
    expect(failed).toBe(true);
    const afterWork = await database.searchPipeline.findRoutingWorkById(routingWorkId);
    const afterSearch = await database.meetingSearches.findById(search.id);
    expect(afterWork?.status).toBe(beforeWork?.status);
    expect(afterWork?.updatedAt.getTime()).toBe(beforeWork?.updatedAt.getTime());
    expect(afterSearch?.status).toBe(beforeSearch?.status);
    expect(await database.searchPipeline.listJourneysForRoutingWork(routingWorkId)).toHaveLength(0);

    await consumer.close(5_000);
    await queue.close();
  }, 30_000);
});
