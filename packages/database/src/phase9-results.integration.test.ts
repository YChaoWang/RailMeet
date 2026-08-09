import { RANKING_MODES } from '@railmeet/shared';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { asc, eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createDatabase, type Database } from './client.js';
import {
  meetingSearchCandidateRankingJourneys,
  meetingSearchCandidateRankings,
} from './schema/tables.js';

const POSTGIS_IMAGE = 'ghcr.io/baosystems/postgis:16-3.5';

describe('Phase 9 ranked results read model', () => {
  let container: StartedPostgreSqlContainer;
  let database: Database;

  beforeAll(async () => {
    container = await new PostgreSqlContainer(POSTGIS_IMAGE)
      .withDatabase('railmeet_phase9_results')
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
        id: 'place:hamburg',
        name: 'Hamburg',
        kind: 'city' as const,
        countryCode: 'DE',
        timezone: 'Europe/Berlin',
        location: { longitude: 9.9937, latitude: 53.5511 },
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
    ]) {
      await database.places.create(place);
    }
  }, 180_000);

  afterAll(async () => {
    await database?.close();
    await container?.stop();
  }, 60_000);

  async function createRunningSearch(
    rankingMode: 'fairest' | 'fastest-overall' = 'fairest',
    participantCount: 2 | 3 = 2,
  ) {
    const participants =
      participantCount === 3
        ? [
            {
              participantId: 'c',
              displayName: 'C',
              origin: { kind: 'existing', placeId: 'place:hamburg' },
              position: 2,
            },
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
          ]
        : [
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
          ];
    // Persist participants intentionally out of position order for count=3.
    const result = await database.meetingSearches.create({
      participants,
      travelDate: '2026-06-15',
      earliestDepartureTime: '08:00',
      latestArrivalTime: '22:00',
      arrivalDayOffset: 0,
      maxJourneyDurationMinutes: 400,
      maxTransfers: 2,
      minTransferDurationMinutes: 5,
      allowedTransportModes: ['train'],
      rankingMode,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) {
      throw new Error('create failed');
    }
    await database.meetingSearches.tryKickoff(result.value.id);
    return result.value;
  }

  async function seedCandidateAndWork(
    searchId: string,
    destinations: readonly string[],
    participantIds: readonly string[],
  ): Promise<string[]> {
    await database.searchPipeline.claimCandidateGeneration(searchId);
    await database.searchPipeline.persistCandidatesAndFanOut({
      searchId,
      candidates: destinations.map((destinationPlaceId, ordinal) => ({
        destinationPlaceId,
        ordinal,
        distanceMeters: 1000 + ordinal,
      })),
      participantIds,
    });
    const events = (await database.outbox.findByAggregateId(searchId)).filter(
      (event) => event.eventType === 'routing.requested',
    );
    return events.map((event) => (event.payload as { routingWorkId: string }).routingWorkId);
  }

  async function completeSucceeded(
    workId: string,
    durationMinutes: number,
    arrivalIso: string,
    transfers = 0,
  ) {
    const departure = new Date('2026-06-15T08:00:00.000Z');
    const arrival = new Date(arrivalIso);
    await database.searchPipeline.completeRoutingWorkWithJourneys({
      routingWorkId: workId,
      status: 'succeeded',
      journeys: [
        {
          journeyOrdinal: 0,
          departureAt: departure,
          arrivalAt: arrival,
          durationMinutes,
          transfers,
          transportModes: ['train'],
          legs: [
            {
              mode: 'train',
              departureAt: departure,
              arrivalAt: arrival,
              durationMinutes,
              geometry: {
                points: '_p~iF~ps|U_ulLnnqC_mqNvxq`@',
                precision: 6,
                length: 3,
              },
            },
          ],
        },
      ],
    });
  }

  it('orders by RANKING_MODES then persisted rank then participant ordinal despite shuffled inserts', async () => {
    const search = await createRunningSearch('fairest', 3);
    const participantIds = ['c', 'b', 'a']; // fan-out order ≠ ordinal
    const destinations = ['place:cologne', 'place:munich']; // cologne first in fan-out
    const workIds = await seedCandidateAndWork(search.id, destinations, participantIds);

    // Complete in reverse destination / participant order vs ordinal.
    for (const workId of [...workIds].reverse()) {
      await completeSucceeded(workId, 70, '2026-06-15T09:30:00.000Z');
    }

    const finalized = await database.finalization.finalizeMeetingSearch(search.id);
    expect(finalized.outcome).toBe('completed');

    // Reshuffle ranking_journeys insert order: delete and reinsert descending rank/position.
    const rankingRows = await database.db
      .select()
      .from(meetingSearchCandidateRankings)
      .where(eq(meetingSearchCandidateRankings.searchId, search.id))
      .orderBy(
        asc(meetingSearchCandidateRankings.rankingMode),
        asc(meetingSearchCandidateRankings.rank),
      );
    const journeyLinks = await database.db
      .select()
      .from(meetingSearchCandidateRankingJourneys)
      .where(eq(meetingSearchCandidateRankingJourneys.searchId, search.id));

    await database.db
      .delete(meetingSearchCandidateRankingJourneys)
      .where(eq(meetingSearchCandidateRankingJourneys.searchId, search.id));

    const reshuffled = [...journeyLinks].sort((left, right) => {
      if (left.rankingMode !== right.rankingMode) {
        return left.rankingMode < right.rankingMode ? 1 : -1;
      }
      if (left.destinationPlaceId !== right.destinationPlaceId) {
        return left.destinationPlaceId < right.destinationPlaceId ? 1 : -1;
      }
      return left.participantId < right.participantId ? 1 : -1;
    });
    await database.db.insert(meetingSearchCandidateRankingJourneys).values(
      reshuffled.map((row) => ({
        searchId: row.searchId,
        rankingMode: row.rankingMode,
        destinationPlaceId: row.destinationPlaceId,
        participantId: row.participantId,
        journeyId: row.journeyId,
        rankingId: row.rankingId,
      })),
    );

    expect(rankingRows.length).toBeGreaterThanOrEqual(RANKING_MODES.length * 2);

    const first = await database.finalization.loadRankedResults(search.id);
    expect(first.kind).toBe('completed');
    if (first.kind !== 'completed') {
      return;
    }
    expect(first.queryCount).toBe(4);
    expect(first.completionOutcome).toBe('ranked');

    const modeSequence = [...new Set(first.rankings.map((row) => row.rankingMode))];
    expect(modeSequence).toEqual([...RANKING_MODES]);

    for (const mode of RANKING_MODES) {
      const modeRows = first.rankings.filter((row) => row.rankingMode === mode);
      expect(modeRows.length).toBeGreaterThanOrEqual(2);
      expect(modeRows.map((row) => row.rank)).toEqual(
        Array.from({ length: modeRows.length }, (_, index) => index + 1),
      );
      for (const candidate of modeRows) {
        expect(candidate.journeys.map((journey) => journey.participantPosition)).toEqual([0, 1, 2]);
        expect(candidate.journeys.map((journey) => journey.participantId)).toEqual(['a', 'b', 'c']);
        expect(candidate.journeys[0]?.legs.length).toBeGreaterThan(0);
        expect(candidate.journeys[0]?.legs[0]?.geometry).toEqual({
          points: '_p~iF~ps|U_ulLnnqC_mqNvxq`@',
          precision: 6,
          length: 3,
        });
      }
    }

    const second = await database.finalization.loadRankedResults(search.id);
    expect(second).toEqual(first);
  });

  it('does not expose rankings for pending, failed, or cancelled searches', async () => {
    const pending = await createRunningSearch();
    const pendingRead = await database.finalization.loadRankedResults(pending.id);
    expect(pendingRead.kind).toBe('not_ready');

    const failing = await createRunningSearch();
    const workIds = await seedCandidateAndWork(failing.id, ['place:munich'], ['a', 'b']);
    await database.searchPipeline.markRoutingWorkExhausted(workIds[0]!, 'PROVIDER_UNAVAILABLE');
    await completeSucceeded(workIds[1]!, 60, '2026-06-15T09:00:00.000Z');
    const failed = await database.finalization.finalizeMeetingSearch(failing.id);
    expect(failed.outcome).toBe('failed');
    const failedRead = await database.finalization.loadRankedResults(failing.id);
    expect(failedRead.kind).toBe('failed');
    expect(await database.finalization.listCandidateRankings(failing.id)).toHaveLength(0);

    const cancelled = await createRunningSearch();
    await database.meetingSearches.updateStatusIf(cancelled.id, ['running'], 'cancelled');
    const cancelledRead = await database.finalization.loadRankedResults(cancelled.id);
    expect(cancelledRead.kind).toBe('failed');
  });

  it('returns empty rankings for completed no_feasible_candidates and no_candidates', async () => {
    const noFeasible = await createRunningSearch();
    const workIds = await seedCandidateAndWork(noFeasible.id, ['place:munich'], ['a', 'b']);
    for (const workId of workIds) {
      await database.searchPipeline.completeRoutingWorkWithJourneys({
        routingWorkId: workId,
        status: 'no_journeys',
        journeys: [],
      });
    }
    expect(await database.finalization.finalizeMeetingSearch(noFeasible.id)).toMatchObject({
      outcome: 'completed',
      completionOutcome: 'no_feasible_candidates',
    });
    const noFeasibleRead = await database.finalization.loadRankedResults(noFeasible.id);
    expect(noFeasibleRead).toMatchObject({
      kind: 'completed',
      completionOutcome: 'no_feasible_candidates',
      rankings: [],
      recommendedDestination: null,
    });

    const noCandidates = await createRunningSearch();
    await database.searchPipeline.claimCandidateGeneration(noCandidates.id);
    await database.searchPipeline.persistCandidatesAndFanOut({
      searchId: noCandidates.id,
      candidates: [],
      participantIds: ['a', 'b'],
    });
    expect(await database.finalization.finalizeMeetingSearch(noCandidates.id)).toMatchObject({
      outcome: 'completed',
      completionOutcome: 'no_candidates',
    });
    const noCandidatesRead = await database.finalization.loadRankedResults(noCandidates.id);
    expect(noCandidatesRead).toMatchObject({
      kind: 'completed',
      completionOutcome: 'no_candidates',
      rankings: [],
      recommendedDestination: null,
    });
    if (noCandidatesRead.kind === 'completed') {
      expect(noCandidatesRead.queryCount).toBeLessThanOrEqual(4);
    }
  });

  it('returns not_found for unknown search IDs', async () => {
    const read = await database.finalization.loadRankedResults(
      '99999999-9999-4999-8999-999999999999',
    );
    expect(read.kind).toBe('not_found');
  });

  it('keeps queryCount fixed when result cardinality grows', async () => {
    const search = await createRunningSearch('fairest', 3);
    const workIds = await seedCandidateAndWork(
      search.id,
      ['place:munich', 'place:cologne'],
      ['a', 'b', 'c'],
    );
    for (const workId of workIds) {
      await completeSucceeded(workId, 65, '2026-06-15T09:20:00.000Z');
    }
    await database.finalization.finalizeMeetingSearch(search.id);
    const read = await database.finalization.loadRankedResults(search.id);
    expect(read.kind).toBe('completed');
    if (read.kind === 'completed') {
      expect(read.rankings.length).toBeGreaterThan(4);
      expect(read.queryCount).toBe(4);
    }
  });
});
