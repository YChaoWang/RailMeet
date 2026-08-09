import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createDatabase, type Database } from './client.js';
import { placeIdForProviderPlace } from './place-identity.js';

const POSTGIS_IMAGE = 'ghcr.io/baosystems/postgis:16-3.5';

describe('provider place upsert', () => {
  let container: StartedPostgreSqlContainer;
  let database: Database;

  beforeAll(async () => {
    container = await new PostgreSqlContainer(POSTGIS_IMAGE)
      .withDatabase('railmeet_place_upsert')
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

  it('reuses the same place for repeated provider locations and search create', async () => {
    const first = await database.places.upsertFromProvider({
      provider: 'motis',
      providerPlaceId: 'de:11000:900003200:1:51',
      name: 'Berlin Hbf',
      kind: 'station',
      countryCode: 'DE',
      timezone: 'Europe/Berlin',
      location: { longitude: 13.369, latitude: 52.525 },
    });
    const second = await database.places.upsertFromProvider({
      provider: 'motis',
      providerPlaceId: 'de:11000:900003200:1:51',
      name: 'Berlin Hauptbahnhof',
      kind: 'station',
      countryCode: 'DE',
      timezone: 'Europe/Berlin',
      location: { longitude: 13.3691, latitude: 52.5251 },
    });
    expect(second.id).toBe(first.id);
    expect(second.id).toBe(placeIdForProviderPlace('motis', 'de:11000:900003200:1:51'));
    expect(second.name).toBe('Berlin Hauptbahnhof');

    const search = await database.meetingSearches.create({
      participants: [
        {
          participantId: 'p1',
          displayName: 'Alex',
          origin: {
            kind: 'providerSelection',
            selection: {
              provider: 'motis',
              providerPlaceId: 'de:11000:900003200:1:51',
              name: 'Berlin Hbf',
              kind: 'station',
              countryCode: 'DE',
              timezone: 'Europe/Berlin',
              location: { longitude: 13.369, latitude: 52.525 },
            },
          },
          position: 0,
        },
        {
          participantId: 'p2',
          displayName: 'Blake',
          origin: {
            kind: 'providerSelection',
            selection: {
              provider: 'motis',
              providerPlaceId: 'fr:paris-nord',
              name: 'Paris Nord',
              kind: 'station',
              countryCode: 'FR',
              timezone: 'Europe/Paris',
              location: { longitude: 2.355, latitude: 48.88 },
            },
          },
          position: 1,
        },
      ],
      travelDate: '2026-06-15',
      earliestDepartureTime: '08:00',
      latestArrivalTime: '22:00',
      arrivalDayOffset: 0,
      maxJourneyDurationMinutes: 480,
      maxTransfers: 2,
      minTransferDurationMinutes: 5,
      allowedTransportModes: ['train'],
      rankingMode: 'fairest',
    });
    expect(search.ok).toBe(true);
    if (!search.ok) {
      return;
    }
    expect(search.value.participants[0]?.originPlaceId).toBe(first.id);
  });
});
