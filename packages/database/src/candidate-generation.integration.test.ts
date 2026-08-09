import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createDatabase, type Database } from './client.js';

function withOrdinals<T extends { placeId: string; distanceMeters: number }>(
  rows: readonly T[],
  limit: number,
) {
  return rows.slice(0, limit).map((row, ordinal) => ({ ...row, ordinal }));
}

const POSTGIS_IMAGE = 'ghcr.io/baosystems/postgis:16-3.5';

describe('candidate generation persistence', () => {
  let container: StartedPostgreSqlContainer;
  let database: Database;

  beforeAll(async () => {
    container = await new PostgreSqlContainer(POSTGIS_IMAGE)
      .withDatabase('railmeet_candidates')
      .withUsername('railmeet')
      .withPassword('railmeet')
      .start();
    database = createDatabase({
      connectionString: container.getConnectionUri(),
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
      {
        id: 'place:berlin-hbf',
        name: 'Berlin Hbf',
        kind: 'station' as const,
        countryCode: 'DE',
        timezone: 'Europe/Berlin',
        location: { longitude: 13.3694, latitude: 52.5256 },
        parentCityId: 'place:berlin',
      },
      {
        id: 'place:remote',
        name: 'Remoteville',
        kind: 'city' as const,
        countryCode: 'IS',
        timezone: 'Atlantic/Reykjavik',
        location: { longitude: -21.8277, latitude: 64.1283 },
      },
    ]) {
      await database.places.create(place);
    }
  }, 180_000);

  afterAll(async () => {
    await database?.close();
    await container?.stop();
  }, 60_000);

  async function createSearch(originA: string, originB: string) {
    const result = await database.meetingSearches.create({
      participants: [
        {
          participantId: 'a',
          displayName: 'A',
          origin: { kind: 'existing', placeId: originA },
          position: 0,
        },
        {
          participantId: 'b',
          displayName: 'B',
          origin: { kind: 'existing', placeId: originB },
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
    await database.meetingSearches.tryKickoff(result.value.id);
    return result.value;
  }

  it('selects only city places near the origin centroid with stable ordering', async () => {
    const first = await database.searchPipeline.findNearestCityCandidates(
      ['place:berlin', 'place:paris'],
      3,
    );
    const second = await database.searchPipeline.findNearestCityCandidates(
      ['place:berlin', 'place:paris'],
      3,
    );
    expect(first.map((row) => row.placeId)).toEqual(second.map((row) => row.placeId));
    expect(first.every((row) => !row.placeId.includes('hbf'))).toBe(true);
    expect(first.some((row) => row.placeId === 'place:remote')).toBe(false);

    const ranked = withOrdinals(
      first.map((row) => ({ placeId: row.placeId, distanceMeters: row.distanceMeters })),
      3,
    );
    expect(ranked.map((row) => row.ordinal)).toEqual([0, 1, 2]);
  });

  it('supports one-origin centroid queries and fewer cities than the limit', async () => {
    const nearest = await database.searchPipeline.findNearestCityCandidates(['place:berlin'], 100);
    expect(nearest.length).toBeGreaterThan(0);
    expect(nearest.length).toBeLessThan(100);
    expect(nearest[0]?.placeId).toBe('place:berlin');
  });

  it('persists candidates and routing fan-out idempotently without Transitous', async () => {
    const search = await createSearch('place:berlin', 'place:paris');
    const claim = await database.searchPipeline.claimCandidateGeneration(search.id);
    expect(claim.outcome).toBe('claimed');

    const nearest = await database.searchPipeline.findNearestCityCandidates(
      ['place:berlin', 'place:paris'],
      2,
    );
    const ranked = withOrdinals(
      nearest.map((row) => ({ placeId: row.placeId, distanceMeters: row.distanceMeters })),
      2,
    );

    const first = await database.searchPipeline.persistCandidatesAndFanOut({
      searchId: search.id,
      candidates: ranked.map((row) => ({
        destinationPlaceId: row.placeId,
        ordinal: row.ordinal,
        distanceMeters: row.distanceMeters,
      })),
      participantIds: ['a', 'b'],
    });
    expect(first.candidateCount).toBe(2);
    expect(first.routingWorkCount).toBe(4);

    const second = await database.searchPipeline.persistCandidatesAndFanOut({
      searchId: search.id,
      candidates: ranked.map((row) => ({
        destinationPlaceId: row.placeId,
        ordinal: row.ordinal,
        distanceMeters: row.distanceMeters,
      })),
      participantIds: ['a', 'b'],
    });
    expect(second.candidateCount).toBe(2);
    expect(second.routingWorkCount).toBe(4);

    const candidates = await database.searchPipeline.listCandidates(search.id);
    expect(candidates).toHaveLength(2);
    expect(candidates[0]?.ordinal).toBe(0);

    const routingEvents = (await database.outbox.findByAggregateId(search.id)).filter(
      (event) => event.eventType === 'routing.requested',
    );
    expect(routingEvents).toHaveLength(4);
    expect((await database.meetingSearches.findById(search.id))?.status).toBe('running');
  });

  it('represents zero usable candidates durably while keeping the search running', async () => {
    // Isolate: delete non-origin cities temporarily is hard; use empty DB query via impossible limit + no cities around a unique point by using only remote after deleting others is messy.
    // Instead persist an empty fan-out after claim.
    const search = await createSearch('place:berlin', 'place:paris');
    await database.searchPipeline.claimCandidateGeneration(search.id);
    const result = await database.searchPipeline.persistCandidatesAndFanOut({
      searchId: search.id,
      candidates: [],
      participantIds: ['a', 'b'],
    });
    expect(result.candidateCount).toBe(0);
    expect(result.routingWorkCount).toBe(0);
    expect((await database.searchPipeline.findCandidateGeneration(search.id))?.status).toBe(
      'succeeded',
    );
    expect((await database.meetingSearches.findById(search.id))?.status).toBe('running');
    const finalizationEvents = (await database.outbox.findByAggregateId(search.id)).filter(
      (event) => event.eventType === 'meeting-search.finalization-requested',
    );
    expect(finalizationEvents.length).toBe(1);
  });

  it('handles duplicate candidate-generation claims without resetting started_at', async () => {
    const search = await createSearch('place:berlin', 'place:paris');
    const first = await database.searchPipeline.claimCandidateGeneration(search.id);
    expect(first.outcome).toBe('claimed');
    if (first.outcome !== 'claimed') {
      return;
    }
    const startedAt = first.generation.startedAt;
    const second = await database.searchPipeline.claimCandidateGeneration(search.id);
    expect(second.outcome).toBe('already_running');
    if (second.outcome !== 'already_running') {
      return;
    }
    expect(second.generation.startedAt?.getTime()).toBe(startedAt?.getTime());
  });

  it('rejects meeting-search create when an origin place is missing (FK / place check)', async () => {
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

  it('refuses place deletion while referenced as a participant origin', async () => {
    await createSearch('place:berlin', 'place:paris');
    await expect(database.places.deleteById('place:berlin')).rejects.toBeTruthy();
  });
});
