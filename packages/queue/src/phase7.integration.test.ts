import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { randomUUID } from 'node:crypto';

import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { RedisContainer, type StartedRedisContainer } from '@testcontainers/redis';
import { Queue, UnrecoverableError } from 'bullmq';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createDatabase, type Database } from '@railmeet/database';
import { createLogger } from '@railmeet/observability';
import { createTransitousJourneyPlanner } from '@railmeet/routing';

import {
  MEETING_SEARCH_CANDIDATES_QUEUE_NAME,
  MEETING_SEARCH_CANDIDATES_REQUESTED_JOB_NAME,
  MEETING_SEARCH_ROUTING_QUEUE_NAME,
  ROUTING_REQUESTED_JOB_NAME,
} from './contract.js';
import { createCandidateConsumer } from './candidate-consumer.js';
import { createMeetingSearchConsumer } from './consumer.js';
import { createOutboxDispatcher } from './dispatcher.js';
import { createMeetingSearchQueuePublisher } from './publisher.js';
import { createRoutingConsumer } from './routing-consumer.js';
import { closeRedisConnection, createRedisConnection } from './redis.js';

const POSTGIS_IMAGE = 'ghcr.io/baosystems/postgis:16-3.5';

async function attachEligibleHub(database: Database, cityId: string, hubId: string): Promise<void> {
  await database.db.execute(sql`
    UPDATE places
    SET
      ownership = 'catalog:geonames',
      population = 500000,
      feature_code = 'PPLC',
      provider = 'geonames',
      provider_place_id = ${cityId},
      active = true
    WHERE id = ${cityId}
  `);
  await database.db.execute(sql`
    INSERT INTO places (
      id, name, kind, country_code, timezone, location,
      ownership, provider, provider_place_id, active
    )
    SELECT
      ${hubId},
      ${`${cityId} hub`},
      'station',
      country_code,
      timezone,
      location,
      'catalog:transitous',
      'motis',
      ${`motis-${hubId}`},
      true
    FROM places
    WHERE id = ${cityId}
    ON CONFLICT (id) DO UPDATE SET
      ownership = EXCLUDED.ownership,
      provider = EXCLUDED.provider,
      provider_place_id = EXCLUDED.provider_place_id,
      active = true
  `);
  await database.db.execute(sql`
    INSERT INTO meeting_city_hubs (
      city_place_id, hub_place_id, priority, distance_meters, match_method, source, regional, active
    )
    VALUES (${cityId}, ${hubId}, 0, 0, 'test-fixture', 'test', false, true)
    ON CONFLICT (city_place_id, hub_place_id) DO UPDATE SET active = true, priority = 0
  `);
}

const testJobOptions = {
  attempts: 3,
  backoffDelayMs: 100,
  backoffJitter: 0.1,
  removeOnCompleteAgeSeconds: 3_600,
  removeOnCompleteCount: 1_000,
  removeOnFailAgeSeconds: 86_400,
  removeOnFailCount: 5_000,
} as const;

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
    },
  ],
};

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

describe('Phase 7 candidate fan-out and routing integration', () => {
  let pg: StartedPostgreSqlContainer;
  let redisContainer: StartedRedisContainer;
  let database: Database;
  let redis: ReturnType<typeof createRedisConnection>;
  let kickoffRedis: ReturnType<typeof createRedisConnection>;
  let candidateRedis: ReturnType<typeof createRedisConnection>;
  let routingRedis: ReturnType<typeof createRedisConnection>;
  let routingRedisB: ReturnType<typeof createRedisConnection>;

  beforeAll(async () => {
    pg = await new PostgreSqlContainer(POSTGIS_IMAGE)
      .withDatabase('railmeet_phase7')
      .withUsername('railmeet')
      .withPassword('railmeet')
      .start();
    redisContainer = await new RedisContainer('redis:7-alpine').start();
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
    ]) {
      await database.places.create(place);
    }
    await attachEligibleHub(database, 'place:berlin', 'place:berlin-hub');
    await attachEligibleHub(database, 'place:paris', 'place:paris-hub');
    await attachEligibleHub(database, 'place:munich', 'place:munich-hub');

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
    kickoffRedis = createRedisConnection(workerOpts);
    candidateRedis = createRedisConnection(workerOpts);
    routingRedis = createRedisConnection(workerOpts);
    routingRedisB = createRedisConnection(workerOpts);
  }, 180_000);

  afterAll(async () => {
    await closeRedisConnection(redis);
    await closeRedisConnection(kickoffRedis);
    await closeRedisConnection(candidateRedis);
    await closeRedisConnection(routingRedis);
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

  it('runs kickoff → candidates → routing fan-out → normalized journeys and stays running', async () => {
    const search = await createSearch();
    const logger = createLogger({ name: 'phase7-it', level: 'silent', pretty: false });
    let planCalls = 0;
    const { server, baseUrl } = await startMockServer((_req, res) => {
      planCalls += 1;
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({ itineraries: [sampleItinerary, sampleItinerary] }));
    });

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

    const kickoff = createMeetingSearchConsumer({
      connection: kickoffRedis,
      logger,
      concurrency: 1,
      processKickoff: async ({ searchId }) => {
        const result = await database.meetingSearches.tryKickoff(searchId);
        if (result.outcome === 'not_found') {
          throw new UnrecoverableError('not found');
        }
        return {
          searchId,
          transition:
            result.outcome === 'started'
              ? 'started'
              : result.outcome === 'already_started'
                ? 'already_started'
                : 'already_terminal',
        };
      },
    });

    const candidateConsumer = createCandidateConsumer({
      connection: candidateRedis,
      logger,
      concurrency: 1,
      processCandidates: async ({ searchId }) => {
        const claim = await database.searchPipeline.claimCandidateGeneration(searchId);
        if (claim.outcome === 'already_succeeded') {
          const candidates = await database.searchPipeline.listCandidates(searchId);
          return {
            searchId,
            outcome: 'already_generated',
            candidateCount: candidates.length,
            routingWorkCount: await database.searchPipeline.countRoutingWorkForSearch(searchId),
          };
        }
        if (claim.outcome === 'not_found' || claim.outcome === 'already_failed') {
          throw new UnrecoverableError('unexpected claim');
        }
        const searchRow = await database.meetingSearches.findById(searchId);
        const nearest = await database.searchPipeline.findNearestCityCandidates(
          searchRow!.participants.map((p) => p.originPlaceId),
          2,
        );
        const fanOut = await database.searchPipeline.persistCandidatesAndFanOut({
          searchId,
          candidates: nearest.map((row, ordinal) => ({
            destinationPlaceId: row.placeId,
            ordinal,
            distanceMeters: row.distanceMeters,
          })),
          participantIds: searchRow!.participants.map((p) => p.participantId),
        });
        return {
          searchId,
          outcome: 'generated',
          candidateCount: fanOut.candidateCount,
          routingWorkCount: fanOut.routingWorkCount,
        };
      },
    });

    const planner = createTransitousJourneyPlanner({
      baseUrl,
      userAgent: 'RailMeet/0.0.0 (+https://example.com/contact)',
      timeoutMs: 5_000,
      maxResponseBytes: 1_048_576,
    });

    const routingConsumer = createRoutingConsumer({
      connection: routingRedis,
      logger,
      concurrency: 4,
      processRouting: async ({ searchId, routingWorkId }) => {
        const claim = await database.searchPipeline.claimRoutingWork(routingWorkId);
        if (claim.outcome === 'already_terminal') {
          const journeys = await database.searchPipeline.listJourneysForRoutingWork(routingWorkId);
          return {
            searchId,
            routingWorkId,
            outcome: 'already_terminal',
            journeyCount: journeys.length,
          };
        }
        if (claim.outcome === 'not_found') {
          throw new UnrecoverableError('missing work');
        }
        const searchRow = await database.meetingSearches.findById(searchId);
        const participant = searchRow!.participants.find(
          (p) => p.participantId === claim.work.participantId,
        )!;
        const origin = await database.places.findById(participant.originPlaceId);
        const destination = await database.places.findById(claim.work.destinationPlaceId);
        const plan = await planner.planJourney({
          origin: {
            latitude: origin!.location.latitude,
            longitude: origin!.location.longitude,
          },
          destination: {
            latitude: destination!.location.latitude,
            longitude: destination!.location.longitude,
          },
          departureAt: new Date('2026-06-15T06:00:00.000Z'),
          maxTransfers: 1,
        });
        const journeys = plan.journeys.map((journey, journeyOrdinal) => ({
          journeyOrdinal,
          departureAt: journey.departureAt,
          arrivalAt: journey.arrivalAt,
          durationMinutes: journey.durationMinutes,
          transfers: journey.transfers,
          transportModes: ['train'],
          legs: journey.legs.map((leg) => ({
            mode: leg.mode,
            departureAt: leg.departureAt,
            arrivalAt: leg.arrivalAt,
            durationMinutes: leg.durationMinutes,
          })),
        }));
        const status = journeys.length === 0 ? ('no_journeys' as const) : ('succeeded' as const);
        await database.searchPipeline.completeRoutingWorkWithJourneys({
          routingWorkId,
          status,
          journeys,
        });
        return {
          searchId,
          routingWorkId,
          outcome: status,
          journeyCount: journeys.length,
        };
      },
    });

    void kickoff.worker.run();
    void candidateConsumer.worker.run();
    void routingConsumer.worker.run();

    try {
      await waitFor(async () => {
        await dispatcher.runOnce();
        const routingEvents = (await database.outbox.findByAggregateId(search.id)).filter(
          (event) => event.eventType === 'routing.requested',
        );
        if (routingEvents.length === 0) {
          return false;
        }
        for (const event of routingEvents) {
          const workId = (event.payload as { routingWorkId: string }).routingWorkId;
          const work = await database.searchPipeline.findRoutingWorkById(workId);
          if (!work || (work.status !== 'succeeded' && work.status !== 'no_journeys')) {
            return false;
          }
        }
        return true;
      }, 45_000);

      const candidates = await database.searchPipeline.listCandidates(search.id);
      expect(candidates.length).toBeGreaterThan(0);
      expect(planCalls).toBeGreaterThan(0);

      const workCount = await database.searchPipeline.countRoutingWorkForSearch(search.id);
      expect(workCount).toBe(candidates.length * 2);

      const routingEvents = (await database.outbox.findByAggregateId(search.id)).filter(
        (event) => event.eventType === 'routing.requested',
      );
      const persisted = [];
      for (const event of routingEvents) {
        const workId = (event.payload as { routingWorkId: string }).routingWorkId;
        persisted.push(...(await database.searchPipeline.listJourneysForRoutingWork(workId)));
      }
      expect(persisted.length).toBeGreaterThan(0);
      assertNormalizedJourneyPersistence(persisted);

      expect((await database.meetingSearches.findById(search.id))?.status).toBe('running');
    } finally {
      await kickoff.close(5_000);
      await candidateConsumer.close(5_000);
      await routingConsumer.close(5_000);
      await publisher.close();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  }, 90_000);

  it('marks empty Transitous responses as no_journeys without failing the search', async () => {
    const search = await createSearch();
    await database.meetingSearches.tryKickoff(search.id);
    await database.searchPipeline.claimCandidateGeneration(search.id);
    await database.searchPipeline.persistCandidatesAndFanOut({
      searchId: search.id,
      candidates: [{ destinationPlaceId: 'place:munich', ordinal: 0, distanceMeters: 1000 }],
      participantIds: ['a'],
    });
    const events = (await database.outbox.findByAggregateId(search.id)).filter(
      (event) => event.eventType === 'routing.requested',
    );
    const routingWorkId = (events[0]!.payload as { routingWorkId: string }).routingWorkId;

    const { server, baseUrl } = await startMockServer((_req, res) => {
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({ itineraries: [] }));
    });
    const logger = createLogger({ name: 'phase7-empty', level: 'silent', pretty: false });
    const planner = createTransitousJourneyPlanner({
      baseUrl,
      userAgent: 'RailMeet/0.0.0 (+https://example.com/contact)',
      timeoutMs: 5_000,
      maxResponseBytes: 1_048_576,
    });
    const queueName = `${MEETING_SEARCH_ROUTING_QUEUE_NAME}-${randomUUID()}`;
    const consumer = createRoutingConsumer({
      connection: routingRedis,
      logger,
      concurrency: 1,
      queueName,
      processRouting: async ({ searchId, routingWorkId: workId }) => {
        await database.searchPipeline.claimRoutingWork(workId);
        const plan = await planner.planJourney({
          origin: { latitude: 52.52, longitude: 13.405 },
          destination: { latitude: 48.1351, longitude: 11.582 },
          departureAt: new Date('2026-06-15T06:00:00.000Z'),
        });
        await database.searchPipeline.completeRoutingWorkWithJourneys({
          routingWorkId: workId,
          status: plan.journeys.length === 0 ? 'no_journeys' : 'succeeded',
          journeys: [],
        });
        return {
          searchId,
          routingWorkId: workId,
          outcome: 'no_journeys',
          journeyCount: 0,
        };
      },
    });
    void consumer.worker.run();
    const queue = new Queue(queueName, { connection: redis });
    await queue.add(
      ROUTING_REQUESTED_JOB_NAME,
      { schemaVersion: 1, searchId: search.id, routingWorkId },
      { jobId: `route-${routingWorkId}` },
    );
    await waitFor(async () => {
      const work = await database.searchPipeline.findRoutingWorkById(routingWorkId);
      return work?.status === 'no_journeys';
    }, 15_000);
    expect((await database.meetingSearches.findById(search.id))?.status).toBe('running');
    await consumer.close(5_000);
    await queue.close();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }, 60_000);

  it('lets two routing workers compete with a single CAS winner', async () => {
    const search = await createSearch();
    await database.meetingSearches.tryKickoff(search.id);
    await database.searchPipeline.claimCandidateGeneration(search.id);
    await database.searchPipeline.persistCandidatesAndFanOut({
      searchId: search.id,
      candidates: [{ destinationPlaceId: 'place:munich', ordinal: 0, distanceMeters: 1 }],
      participantIds: ['a'],
    });
    const workId = (
      (await database.outbox.findByAggregateId(search.id)).find(
        (event) => event.eventType === 'routing.requested',
      )!.payload as { routingWorkId: string }
    ).routingWorkId;

    const logger = createLogger({ name: 'phase7-two', level: 'silent', pretty: false });
    const queueName = `${MEETING_SEARCH_ROUTING_QUEUE_NAME}-${randomUUID()}`;
    const outcomes: string[] = [];
    const makeProcessor =
      () =>
      async ({ searchId, routingWorkId }: { searchId: string; routingWorkId: string }) => {
        const claim = await database.searchPipeline.claimRoutingWork(routingWorkId);
        outcomes.push(claim.outcome);
        if (claim.outcome === 'claimed' || claim.outcome === 'already_running') {
          await database.searchPipeline.completeRoutingWorkWithJourneys({
            routingWorkId,
            status: 'succeeded',
            journeys: [
              {
                journeyOrdinal: 0,
                departureAt: new Date('2026-06-15T08:00:00.000Z'),
                arrivalAt: new Date('2026-06-15T10:00:00.000Z'),
                durationMinutes: 120,
                transfers: 0,
                transportModes: ['train'],
                legs: [
                  {
                    mode: 'train',
                    departureAt: new Date('2026-06-15T08:00:00.000Z'),
                    arrivalAt: new Date('2026-06-15T10:00:00.000Z'),
                    durationMinutes: 120,
                  },
                ],
              },
            ],
          });
          return { searchId, routingWorkId, outcome: 'succeeded' as const, journeyCount: 1 };
        }
        return { searchId, routingWorkId, outcome: 'already_terminal' as const, journeyCount: 1 };
      };

    const a = createRoutingConsumer({
      connection: routingRedis,
      logger,
      concurrency: 1,
      queueName,
      processRouting: makeProcessor(),
    });
    const b = createRoutingConsumer({
      connection: routingRedisB,
      logger,
      concurrency: 1,
      queueName,
      processRouting: makeProcessor(),
    });
    void a.worker.run();
    void b.worker.run();
    const queue = new Queue(queueName, { connection: redis });
    await queue.add(
      ROUTING_REQUESTED_JOB_NAME,
      { schemaVersion: 1, searchId: search.id, routingWorkId: workId },
      { jobId: `a-${workId}` },
    );
    await queue.add(
      ROUTING_REQUESTED_JOB_NAME,
      { schemaVersion: 1, searchId: search.id, routingWorkId: workId },
      { jobId: `b-${workId}` },
    );
    await waitFor(() => outcomes.length >= 2, 15_000);
    expect(outcomes.filter((o) => o === 'claimed')).toHaveLength(1);
    expect(await database.searchPipeline.listJourneysForRoutingWork(workId)).toHaveLength(1);
    expect((await database.meetingSearches.findById(search.id))?.status).toBe('running');
    await a.close(5_000);
    await b.close(5_000);
    await queue.close();
  }, 60_000);

  it('rejects malformed candidate jobs as unrecoverable', async () => {
    const logger = createLogger({ name: 'phase7-bad', level: 'silent', pretty: false });
    let failed = false;
    const consumer = createCandidateConsumer({
      connection: candidateRedis,
      logger,
      concurrency: 1,
      processCandidates: async () => {
        throw new Error('should not run');
      },
    });
    consumer.worker.on('failed', () => {
      failed = true;
    });
    void consumer.worker.run();
    const queue = new Queue(MEETING_SEARCH_CANDIDATES_QUEUE_NAME, { connection: redis });
    await queue.add(MEETING_SEARCH_CANDIDATES_REQUESTED_JOB_NAME, {
      schemaVersion: 1,
      searchId: 'not-a-uuid',
    });
    await waitFor(() => failed, 10_000);
    expect(failed).toBe(true);
    await consumer.close(5_000);
    await queue.close();
  }, 30_000);
});
