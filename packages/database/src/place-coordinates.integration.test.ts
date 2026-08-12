import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createDatabase, type Database } from './client.js';

const POSTGIS_IMAGE = 'ghcr.io/baosystems/postgis:16-3.5';

function errorText(error: unknown): string {
  if (!(error instanceof Error)) {
    return String(error);
  }
  const cause =
    error.cause instanceof Error
      ? error.cause.message
      : error.cause !== undefined
        ? String(error.cause)
        : '';
  return `${error.message}\n${cause}`;
}

async function expectRejectedWith(promise: Promise<unknown>, pattern: RegExp): Promise<void> {
  try {
    await promise;
    expect.fail('expected database write to reject');
  } catch (error) {
    expect(errorText(error)).toMatch(pattern);
  }
}

describe('place coordinate invariants (direct SQL)', () => {
  let container: StartedPostgreSqlContainer;
  let database: Database;

  beforeAll(async () => {
    container = await new PostgreSqlContainer(POSTGIS_IMAGE)
      .withDatabase('railmeet_place_coords')
      .withUsername('railmeet')
      .withPassword('railmeet')
      .start();

    database = createDatabase({
      connectionString: container.getConnectionUri(),
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
    await database.places.create({
      id: 'place:munich',
      name: 'Munich',
      kind: 'city',
      countryCode: 'DE',
      timezone: 'Europe/Berlin',
      location: { longitude: 11.582, latitude: 48.1351 },
    });

    for (const [cityId, hubId] of [
      ['place:berlin', 'place:hub:berlin'],
      ['place:paris', 'place:hub:paris'],
      ['place:munich', 'place:hub:munich'],
    ] as const) {
      await database.db.execute(sql`
        UPDATE places
        SET ownership = 'catalog:geonames', population = 500000, feature_code = 'PPLC', active = true
        WHERE id = ${cityId}
      `);
      await database.db.execute(sql`
        INSERT INTO places (
          id, name, kind, country_code, timezone, location,
          ownership, provider, provider_place_id, active
        )
        SELECT
          ${hubId}, ${`${cityId} hub`}, 'station', country_code, timezone, location,
          'catalog:transitous', 'motis', ${`motis-${hubId}`}, true
        FROM places WHERE id = ${cityId}
        ON CONFLICT (id) DO UPDATE SET active = true
      `);
      await database.db.execute(sql`
        INSERT INTO meeting_city_hubs (
          city_place_id, hub_place_id, priority, distance_meters, match_method, source, regional, active
        )
        VALUES (${cityId}, ${hubId}, 0, 0, 'test-fixture', 'test', false, true)
        ON CONFLICT (city_place_id, hub_place_id) DO UPDATE SET active = true
      `);
    }
  }, 180_000);

  afterAll(async () => {
    await database?.close();
    await container?.stop();
  }, 60_000);

  async function insertPlaceRaw(options: {
    readonly id: string;
    readonly locationSql: ReturnType<typeof sql>;
  }): Promise<void> {
    await database.db.execute(sql`
      INSERT INTO places (id, name, kind, country_code, timezone, location)
      VALUES (
        ${options.id},
        ${`Place ${options.id}`},
        'city',
        'DE',
        'UTC',
        ${options.locationSql}
      )
    `);
  }

  it('accepts a valid coordinate via direct SQL insert', async () => {
    await insertPlaceRaw({
      id: 'place:valid-mid',
      locationSql: sql`ST_SetSRID(ST_MakePoint(10.0, 50.0), 4326)`,
    });
    const loaded = await database.places.findById('place:valid-mid');
    expect(loaded?.location.longitude).toBeCloseTo(10, 5);
    expect(loaded?.location.latitude).toBeCloseTo(50, 5);
  });

  it.each([
    {
      name: 'longitude -180 and latitude -90',
      id: 'place:bound-sw',
      lon: -180,
      lat: -90,
    },
    {
      name: 'longitude 180 and latitude 90',
      id: 'place:bound-ne',
      lon: 180,
      lat: 90,
    },
    {
      name: 'longitude -180 and latitude 90',
      id: 'place:bound-nw',
      lon: -180,
      lat: 90,
    },
    {
      name: 'longitude 180 and latitude -90',
      id: 'place:bound-se',
      lon: 180,
      lat: -90,
    },
  ] as const)('accepts exact geographic boundary coordinates: $name', async ({ id, lon, lat }) => {
    await insertPlaceRaw({
      id,
      locationSql: sql`ST_SetSRID(ST_MakePoint(${lon}, ${lat}), 4326)`,
    });
    const loaded = await database.places.findById(id);
    expect(loaded?.location.longitude).toBeCloseTo(lon, 5);
    expect(loaded?.location.latitude).toBeCloseTo(lat, 5);
  });

  it('rejects a null location', async () => {
    await expectRejectedWith(
      database.db.execute(sql`
        INSERT INTO places (id, name, kind, country_code, timezone, location)
        VALUES ('place:null-location', 'Null', 'city', 'DE', 'UTC', NULL)
      `),
      /null value in column "location"|not-null/i,
    );
  });

  it.each([
    {
      name: 'longitude below -180',
      id: 'place:lon-low',
      locationSql: sql`ST_SetSRID(ST_MakePoint(-180.0001, 0), 4326)`,
      constraint: 'places_location_longitude_chk',
    },
    {
      name: 'longitude above 180',
      id: 'place:lon-high',
      locationSql: sql`ST_SetSRID(ST_MakePoint(180.0001, 0), 4326)`,
      constraint: 'places_location_longitude_chk',
    },
    {
      name: 'latitude below -90',
      id: 'place:lat-low',
      locationSql: sql`ST_SetSRID(ST_MakePoint(0, -90.0001), 4326)`,
      constraint: 'places_location_latitude_chk',
    },
    {
      name: 'latitude above 90',
      id: 'place:lat-high',
      locationSql: sql`ST_SetSRID(ST_MakePoint(0, 90.0001), 4326)`,
      constraint: 'places_location_latitude_chk',
    },
  ] as const)(
    'rejects out-of-range coordinates: $name',
    async ({ id, locationSql, constraint }) => {
      await expectRejectedWith(insertPlaceRaw({ id, locationSql }), new RegExp(constraint, 'i'));
    },
  );

  it('rejects empty Point geometry when PostGIS can construct it', async () => {
    await expectRejectedWith(
      insertPlaceRaw({
        id: 'place:empty-point',
        locationSql: sql`ST_GeomFromText('POINT EMPTY', 4326)`,
      }),
      /places_location_not_empty_chk|places_location_longitude_chk|places_location_latitude_chk/i,
    );
  });

  it('rejects non-finite longitude values', async () => {
    await expectRejectedWith(
      insertPlaceRaw({
        id: 'place:nan-lon',
        locationSql: sql`ST_SetSRID(ST_MakePoint('NaN'::float8, 0), 4326)`,
      }),
      /places_location_longitude_chk/i,
    );

    await expectRejectedWith(
      insertPlaceRaw({
        id: 'place:inf-lon',
        locationSql: sql`ST_SetSRID(ST_MakePoint('Infinity'::float8, 0), 4326)`,
      }),
      /places_location_longitude_chk/i,
    );
  });

  it('rejects non-finite latitude values', async () => {
    await expectRejectedWith(
      insertPlaceRaw({
        id: 'place:nan-lat',
        locationSql: sql`ST_SetSRID(ST_MakePoint(0, 'NaN'::float8), 4326)`,
      }),
      /places_location_latitude_chk/i,
    );

    await expectRejectedWith(
      insertPlaceRaw({
        id: 'place:inf-lat',
        locationSql: sql`ST_SetSRID(ST_MakePoint(0, '-Infinity'::float8), 4326)`,
      }),
      /places_location_latitude_chk/i,
    );
  });

  it('rejects a participant that references a missing origin place', async () => {
    const result = await database.meetingSearches.create({
      participants: [
        {
          participantId: 'a',
          displayName: 'A',
          origin: { kind: 'existing', placeId: 'place:does-not-exist' },
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
    expect(result.ok).toBe(false);
    if (result.ok) {
      return;
    }
    expect(result.error.code).toBe('PLACE_NOT_FOUND');
  });

  it('rejects deleting a place referenced as a participant origin', async () => {
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
    await expect(database.places.deleteById('place:berlin')).rejects.toThrow();
    await expect(database.places.findById('place:berlin')).resolves.not.toBeNull();
  });

  it('loads every participant origin for candidate generation without silent omission', async () => {
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
      return;
    }

    const search = await database.meetingSearches.findById(created.value.id);
    expect(search).toBeTruthy();
    const originIds = search!.participants.map((participant) => participant.originPlaceId);
    expect(originIds).toEqual(['place:berlin', 'place:paris']);

    const origins = await database.places.findManyByIds(originIds);
    expect(origins).toHaveLength(originIds.length);
    expect(origins.every((place) => Number.isFinite(place.location.longitude))).toBe(true);
    expect(origins.every((place) => Number.isFinite(place.location.latitude))).toBe(true);
    expect(origins.every((place) => place.location.longitude >= -180)).toBe(true);
    expect(origins.every((place) => place.location.longitude <= 180)).toBe(true);
    expect(origins.every((place) => place.location.latitude >= -90)).toBe(true);
    expect(origins.every((place) => place.location.latitude <= 90)).toBe(true);

    const first = await database.searchPipeline.findNearestCityCandidates(originIds, 3);
    const second = await database.searchPipeline.findNearestCityCandidates(originIds, 3);
    expect(first.map((row) => row.placeId)).toEqual(second.map((row) => row.placeId));
    expect(first.length).toBeGreaterThan(0);
    // Candidate generation stays on a queued/running search; this suite does not complete it.
    expect((await database.meetingSearches.findById(created.value.id))?.status).toBe('queued');
  });
});
