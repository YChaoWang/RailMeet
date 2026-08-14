import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { randomUUID } from 'node:crypto';

import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createDatabase, type Database } from '@railmeet/database';
import { createLogger } from '@railmeet/observability';
import { createTransitousJourneyPlanner } from '@railmeet/routing';
import { sql } from 'drizzle-orm';

import { createRoutingWorkProcessor } from './routing-work.js';

const POSTGIS_IMAGE = 'ghcr.io/baosystems/postgis:16-3.5';

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

describe('routing worker persists provider itinerary document', () => {
  let pg: StartedPostgreSqlContainer;
  let database: Database;

  beforeAll(async () => {
    pg = await new PostgreSqlContainer(POSTGIS_IMAGE)
      .withDatabase('railmeet_provider_persist')
      .withUsername('railmeet')
      .withPassword('railmeet')
      .start();
    database = createDatabase({
      connectionString: pg.getConnectionUri(),
      maxConnections: 8,
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
  }, 120_000);

  afterAll(async () => {
    await database?.close();
    await pg?.stop();
  }, 60_000);

  it('stores motis-plan-itinerary-v1 via createRoutingWorkProcessor', async () => {
    const created = await database.meetingSearches.create({
      participants: [
        {
          participantId: 'a',
          displayName: 'A',
          origin: { kind: 'existing', placeId: 'place:berlin' },
          position: 0,
        },
      ],
      travelDate: '2026-09-15',
      earliestDepartureTime: '08:00',
      latestArrivalTime: '22:00',
      arrivalDayOffset: 0,
      maxJourneyDurationMinutes: 480,
      maxTransfers: 2,
      minTransferDurationMinutes: 5,
      allowedTransportModes: ['train'],
      rankingMode: 'fairest',
    });
    expect(created.ok).toBe(true);
    if (!created.ok) {
      throw new Error('create failed');
    }
    const searchId = created.value.id;
    await database.meetingSearches.tryKickoff(searchId);
    await database.searchPipeline.claimCandidateGeneration(searchId);
    await database.searchPipeline.persistCandidatesAndFanOut({
      searchId,
      candidates: [{ destinationPlaceId: 'place:munich', ordinal: 0, distanceMeters: 1 }],
      participantIds: ['a'],
    });
    const event = (await database.outbox.findByAggregateId(searchId)).find(
      (row) => row.eventType === 'routing.requested',
    );
    const routingWorkId = (event!.payload as { routingWorkId: string }).routingWorkId;

    const { server, baseUrl } = await startMockServer((_req, res) => {
      res.setHeader('content-type', 'application/json');
      res.end(
        JSON.stringify({
          itineraries: [
            {
              duration: 7200,
              startTime: '2026-09-15T08:00:00Z',
              endTime: '2026-09-15T10:00:00Z',
              transfers: 0,
              id: `itinerary:worker:${randomUUID()}`,
              legs: [
                {
                  mode: 'HIGHSPEED_RAIL',
                  displayName: 'ICE 148',
                  agencyName: 'DB Fernverkehr AG',
                  routeShortName: '77',
                  headsign: 'München Hbf',
                  startTime: '2026-09-15T08:00:00Z',
                  endTime: '2026-09-15T10:00:00Z',
                  duration: 7200,
                  tripId: 'trip:ice148',
                  from: { name: 'Berlin Hbf', track: '1' },
                  to: { name: 'München Hbf', track: '12' },
                  intermediateStops: [{ name: 'Erfurt Hbf', track: '3' }],
                  routeColor: '9c27b0',
                },
              ],
            },
          ],
        }),
      );
    });

    try {
      const processor = createRoutingWorkProcessor({
        meetingSearches: database.meetingSearches,
        places: database.places,
        searchPipeline: database.searchPipeline,
        journeyPlanner: createTransitousJourneyPlanner({
          baseUrl,
          userAgent: 'RailMeet/0.0.0 (+https://example.com/contact)',
          timeoutMs: 5_000,
          maxResponseBytes: 1_048_576,
        }),
        logger: createLogger({ name: 'provider-persist', level: 'silent', pretty: false }),
      });

      const result = await processor({
        searchId,
        routingWorkId,
        jobId: `job-${routingWorkId}`,
        attemptsMade: 0,
        attemptsTotal: 3,
      });
      expect(result.outcome).toBe('succeeded');
      expect(result.journeyCount).toBe(1);

      const rows = await database.db.execute(sql`
        SELECT id, legs, jsonb_typeof(legs) AS legs_type
        FROM meeting_search_journeys
        WHERE routing_work_id = ${routingWorkId}::uuid
      `);
      const row = rows[0] as {
        id: string;
        legs: unknown;
        legs_type: string;
      };
      expect(row.legs_type).toBe('object');
      const legs = row.legs as {
        format?: string;
        itinerary?: { id?: string; legs?: { displayName?: string; agencyName?: string; mode?: string }[] };
        rankingLegs?: { mode?: string; motisMode?: string; displayName?: string }[];
      };
      expect(legs.format).toBe('motis-plan-itinerary-v1');
      expect(legs.itinerary?.id).toBeTruthy();
      expect(legs.itinerary?.legs?.[0]?.displayName).toBe('ICE 148');
      expect(legs.itinerary?.legs?.[0]?.agencyName).toBe('DB Fernverkehr AG');
      expect(legs.itinerary?.legs?.[0]?.mode).toBe('HIGHSPEED_RAIL');
      expect(legs.rankingLegs?.[0]).toMatchObject({
        mode: 'train',
        motisMode: 'HIGHSPEED_RAIL',
        displayName: 'ICE 148',
      });
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  }, 90_000);
});
