import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createDatabase, type Database } from './client.js';
import {
  MEETING_SEARCH_AGGREGATE_TYPE,
  MEETING_SEARCH_REQUESTED_EVENT_TYPE,
  MEETING_SEARCH_REQUESTED_SCHEMA_VERSION,
} from './outbox.js';
import { assertPostgisInstalled } from './repositories/place-repository.js';
import {
  meetingSearchAllowedCountries,
  meetingSearchParticipants,
  meetingSearchTransportModes,
  meetingSearches,
  outboxEvents,
} from './schema/tables.js';

const POSTGIS_IMAGE = 'ghcr.io/baosystems/postgis:16-3.5';

async function countRows(
  database: Database,
  table:
    | typeof meetingSearches
    | typeof meetingSearchParticipants
    | typeof meetingSearchTransportModes
    | typeof meetingSearchAllowedCountries
    | typeof outboxEvents,
): Promise<number> {
  const [row] = await database.db.select({ count: sql<number>`count(*)::int` }).from(table);
  return row?.count ?? 0;
}

describe('database integration', () => {
  let container: StartedPostgreSqlContainer;
  let database: Database;

  beforeAll(async () => {
    container = await new PostgreSqlContainer(POSTGIS_IMAGE)
      .withDatabase('railmeet_test')
      .withUsername('railmeet')
      .withPassword('railmeet')
      .start();

    database = createDatabase({
      connectionString: container.getConnectionUri(),
      maxConnections: 5,
    });
    await database.migrate();
  }, 180_000);

  afterAll(async () => {
    if (database) {
      await database.close();
    }
    if (container) {
      await container.stop();
    }
  }, 60_000);

  it('installs PostGIS via migration', async () => {
    await expect(assertPostgisInstalled(database.db)).resolves.toBe(true);
  });

  it('creates and retrieves a canonical place with lon/lat round-trip', async () => {
    const created = await database.places.create({
      id: 'place:berlin',
      name: 'Berlin',
      kind: 'city',
      countryCode: 'DE',
      timezone: 'Europe/Berlin',
      location: { longitude: 13.405, latitude: 52.52 },
    });

    expect(created.id).toBe('place:berlin');
    expect(created.location.longitude).toBeCloseTo(13.405, 5);
    expect(created.location.latitude).toBeCloseTo(52.52, 5);

    const loaded = await database.places.findById('place:berlin');
    expect(loaded?.location.longitude).toBeCloseTo(13.405, 5);
    expect(loaded?.location.latitude).toBeCloseTo(52.52, 5);
  });

  it('creates and retrieves a complete meeting-search aggregate with ordering', async () => {
    await database.places.create({
      id: 'place:paris',
      name: 'Paris',
      kind: 'city',
      countryCode: 'FR',
      timezone: 'Europe/Paris',
      location: { longitude: 2.3522, latitude: 48.8566 },
    });
    await database.places.create({
      id: 'place:brussels',
      name: 'Brussels',
      kind: 'city',
      countryCode: 'BE',
      timezone: 'Europe/Brussels',
      location: { longitude: 4.3517, latitude: 50.8503 },
    });

    const result = await database.meetingSearches.create({
      participants: [
        {
          participantId: 'p-b',
          displayName: 'Blake',
          originPlaceId: 'place:paris',
          position: 1,
        },
        {
          participantId: 'p-a',
          displayName: 'Alex',
          originPlaceId: 'place:berlin',
          position: 0,
        },
        {
          participantId: 'p-c',
          displayName: 'Casey',
          originPlaceId: 'place:brussels',
          position: 2,
        },
      ],
      travelDate: '2026-06-15',
      earliestDepartureTime: '08:00',
      latestArrivalTime: '22:30',
      arrivalDayOffset: 0,
      maxJourneyDurationMinutes: 480,
      maxTransfers: 2,
      minTransferDurationMinutes: 5,
      allowedTransportModes: ['bus', 'train'],
      allowedCountryCodes: ['FR', 'DE', 'BE'],
      rankingMode: 'fairest',
    });

    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }

    expect(result.value.participants.map((p) => p.participantId)).toEqual(['p-a', 'p-b', 'p-c']);
    expect(result.value.allowedTransportModes).toEqual(['bus', 'train']);
    expect(result.value.allowedCountryCodes).toEqual(['BE', 'DE', 'FR']);
    expect(result.value.earliestDepartureTime).toBe('08:00');
    expect(result.value.latestArrivalTime).toBe('22:30');
    expect(result.value.travelDate).toBe('2026-06-15');
    expect(result.value.status).toBe('queued');

    const loaded = await database.meetingSearches.findById(result.value.id);
    expect(loaded?.participants.map((p) => p.position)).toEqual([0, 1, 2]);

    const events = await database.outbox.findByAggregateId(result.value.id);
    expect(events).toHaveLength(1);
    expect(events[0]?.eventType).toBe(MEETING_SEARCH_REQUESTED_EVENT_TYPE);
    expect(events[0]?.aggregateType).toBe(MEETING_SEARCH_AGGREGATE_TYPE);
    expect(events[0]?.aggregateId).toBe(result.value.id);
    expect(events[0]?.schemaVersion).toBe(MEETING_SEARCH_REQUESTED_SCHEMA_VERSION);
    expect(events[0]?.payload).toEqual({ searchId: result.value.id });
    expect(events[0]?.publishedAt).toBeNull();
    expect(Object.keys(events[0]?.payload ?? {})).toEqual(['searchId']);
  });

  it('rejects duplicate initial outbox events for the same search', async () => {
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
      travelDate: '2026-06-20',
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
      return;
    }

    await expect(
      database.db.insert(outboxEvents).values({
        eventType: MEETING_SEARCH_REQUESTED_EVENT_TYPE,
        aggregateType: MEETING_SEARCH_AGGREGATE_TYPE,
        aggregateId: created.value.id,
        schemaVersion: MEETING_SEARCH_REQUESTED_SCHEMA_VERSION,
        payload: { searchId: created.value.id },
      }),
    ).rejects.toThrow();
  });

  it('rolls back the whole aggregate and outbox when an origin place is missing', async () => {
    const searchesBefore = await countRows(database, meetingSearches);
    const participantsBefore = await countRows(database, meetingSearchParticipants);
    const modesBefore = await countRows(database, meetingSearchTransportModes);
    const countriesBefore = await countRows(database, meetingSearchAllowedCountries);
    const outboxBefore = await countRows(database, outboxEvents);

    const before = await database.meetingSearches.create({
      participants: [
        {
          participantId: 'ok',
          displayName: 'Ok',
          originPlaceId: 'place:berlin',
          position: 0,
        },
        {
          participantId: 'bad',
          displayName: 'Bad',
          originPlaceId: 'place:does-not-exist',
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
      allowedCountryCodes: ['DE'],
      rankingMode: 'fastest-overall',
    });

    expect(before.ok).toBe(false);
    if (before.ok) {
      return;
    }
    expect(before.error.code).toBe('PLACE_NOT_FOUND');
    expect(before.error.placeIds).toContain('place:does-not-exist');

    expect(await countRows(database, meetingSearches)).toBe(searchesBefore);
    expect(await countRows(database, meetingSearchParticipants)).toBe(participantsBefore);
    expect(await countRows(database, meetingSearchTransportModes)).toBe(modesBefore);
    expect(await countRows(database, meetingSearchAllowedCountries)).toBe(countriesBefore);
    expect(await countRows(database, outboxEvents)).toBe(outboxBefore);
  });

  it('rejects duplicate participant IDs at the database boundary', async () => {
    await expect(
      database.meetingSearches.create({
        participants: [
          {
            participantId: 'dup',
            displayName: 'One',
            originPlaceId: 'place:berlin',
            position: 0,
          },
          {
            participantId: 'dup',
            displayName: 'Two',
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
      }),
    ).rejects.toThrow();
  });

  it('rejects duplicate participant positions', async () => {
    await expect(
      database.meetingSearches.create({
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
            position: 0,
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
      }),
    ).rejects.toThrow();
  });

  it('rejects duplicate transport modes', async () => {
    await expect(
      database.meetingSearches.create({
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
        allowedTransportModes: ['train', 'train'],
        rankingMode: 'fairest',
      }),
    ).rejects.toThrow();
  });

  it('rejects duplicate allowed countries', async () => {
    await expect(
      database.meetingSearches.create({
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
        allowedCountryCodes: ['DE', 'DE'],
        rankingMode: 'fairest',
      }),
    ).rejects.toThrow();
  });

  it('rejects invalid numeric bounds', async () => {
    await expect(
      database.meetingSearches.create({
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
        maxJourneyDurationMinutes: 0,
        maxTransfers: 1,
        minTransferDurationMinutes: 5,
        allowedTransportModes: ['train'],
        rankingMode: 'fairest',
      }),
    ).rejects.toThrow();
  });

  it('rejects lowercase or malformed country codes', async () => {
    await expect(
      database.meetingSearches.create({
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
        allowedCountryCodes: ['de'],
        rankingMode: 'fairest',
      }),
    ).rejects.toThrow();
  });

  it('cascades search deletion to child rows, outbox events, and restricts place deletion', async () => {
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
      travelDate: '2026-06-16',
      earliestDepartureTime: '09:00',
      latestArrivalTime: '21:00',
      arrivalDayOffset: 1,
      maxJourneyDurationMinutes: 500,
      maxTransfers: 3,
      minTransferDurationMinutes: 8,
      allowedTransportModes: ['train', 'metro'],
      allowedCountryCodes: ['DE', 'FR'],
      rankingMode: 'arrive-together',
    });
    expect(created.ok).toBe(true);
    if (!created.ok) {
      return;
    }

    expect(await database.outbox.findByAggregateId(created.value.id)).toHaveLength(1);

    await expect(database.places.deleteById('place:berlin')).rejects.toThrow();

    const deleted = await database.meetingSearches.deleteById(created.value.id);
    expect(deleted).toBe(true);
    await expect(database.meetingSearches.findById(created.value.id)).resolves.toBeNull();
    expect(await database.outbox.findByAggregateId(created.value.id)).toHaveLength(0);

    // Place remains after search cascade.
    await expect(database.places.findById('place:berlin')).resolves.not.toBeNull();
  });

  it('supports conditional status updates', async () => {
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
      travelDate: '2026-07-01',
      earliestDepartureTime: '07:00',
      latestArrivalTime: '20:00',
      arrivalDayOffset: 0,
      maxJourneyDurationMinutes: 450,
      maxTransfers: 2,
      minTransferDurationMinutes: 5,
      allowedTransportModes: ['train'],
      rankingMode: 'fewest-transfers',
    });
    expect(created.ok).toBe(true);
    if (!created.ok) {
      return;
    }

    const updated = await database.meetingSearches.updateStatusIf(
      created.value.id,
      ['queued'],
      'running',
    );
    expect(updated.outcome).toBe('updated');
    if (updated.outcome === 'updated') {
      expect(updated.search.status).toBe('running');
    }

    const conflict = await database.meetingSearches.updateStatusIf(
      created.value.id,
      ['queued'],
      'completed',
    );
    expect(conflict.outcome).toBe('conflict');
    if (conflict.outcome === 'conflict') {
      expect(conflict.currentStatus).toBe('running');
    }

    const missing = await database.meetingSearches.updateStatusIf(
      '00000000-0000-4000-8000-000000000000',
      ['queued'],
      'running',
    );
    expect(missing.outcome).toBe('not_found');
  });

  it('has a spatial GiST index on places.location', async () => {
    await expect(database.places.hasSpatialIndex()).resolves.toBe(true);
  });
});
