import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createDatabase, type Database } from './client.js';

const POSTGIS_IMAGE = 'ghcr.io/baosystems/postgis:16-3.5';

describe('Phase 8 finalization persistence', () => {
  let container: StartedPostgreSqlContainer;
  let database: Database;

  beforeAll(async () => {
    container = await new PostgreSqlContainer(POSTGIS_IMAGE)
      .withDatabase('railmeet_finalization')
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
    ]) {
      await database.places.create(place);
    }
  }, 180_000);

  afterAll(async () => {
    await database?.close();
    await container?.stop();
  }, 60_000);

  async function createRunningSearch(rankingMode: 'fairest' | 'fastest-overall' = 'fairest') {
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
  ): Promise<string[]> {
    await database.searchPipeline.claimCandidateGeneration(searchId);
    await database.searchPipeline.persistCandidatesAndFanOut({
      searchId,
      candidates: destinations.map((destinationPlaceId, ordinal) => ({
        destinationPlaceId,
        ordinal,
        distanceMeters: 1000 + ordinal,
      })),
      participantIds: ['a', 'b'],
    });
    const events = (await database.outbox.findByAggregateId(searchId)).filter(
      (event) => event.eventType === 'routing.requested',
    );
    return events.map((event) => (event.payload as { routingWorkId: string }).routingWorkId);
  }

  async function completeSucceeded(workId: string, durationMinutes: number, arrivalIso: string) {
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
          transfers: 0,
          transportModes: ['train'],
          legs: [
            {
              mode: 'train',
              departureAt: departure,
              arrivalAt: arrival,
              durationMinutes,
            },
          ],
        },
      ],
    });
  }

  it('returns not_ready while routing work remains incomplete and leaves search running', async () => {
    const search = await createRunningSearch();
    const workIds = await seedCandidateAndWork(search.id, ['place:munich']);
    await completeSucceeded(workIds[0]!, 60, '2026-06-15T09:00:00.000Z');

    const result = await database.finalization.finalizeMeetingSearch(search.id);
    expect(result.outcome).toBe('not_ready');
    const loaded = await database.meetingSearches.findById(search.id);
    expect(loaded?.status).toBe('running');
    expect(loaded?.completedAt).toBeNull();
    expect(await database.finalization.listCandidateRankings(search.id)).toHaveLength(0);
  });

  it('completes with no_candidates when candidate generation yields zero cities', async () => {
    const search = await createRunningSearch();
    await database.searchPipeline.claimCandidateGeneration(search.id);
    await database.searchPipeline.persistCandidatesAndFanOut({
      searchId: search.id,
      candidates: [],
      participantIds: ['a', 'b'],
    });
    const events = (await database.outbox.findByAggregateId(search.id)).filter(
      (event) => event.eventType === 'meeting-search.finalization-requested',
    );
    expect(events.length).toBeGreaterThan(0);

    const startedAt = (await database.meetingSearches.findById(search.id))!.startedAt!;
    const result = await database.finalization.finalizeMeetingSearch(search.id);
    expect(result).toMatchObject({
      outcome: 'completed',
      completionOutcome: 'no_candidates',
    });
    const loaded = await database.meetingSearches.findById(search.id);
    expect(loaded?.status).toBe('completed');
    expect(loaded?.completionOutcome).toBe('no_candidates');
    expect(loaded?.startedAt?.getTime()).toBe(startedAt.getTime());
    expect(loaded?.completedAt).toBeTruthy();
  });

  it('completes with no_feasible_candidates when every candidate has no_journeys', async () => {
    const search = await createRunningSearch();
    const workIds = await seedCandidateAndWork(search.id, ['place:munich', 'place:cologne']);
    for (const workId of workIds) {
      await database.searchPipeline.completeRoutingWorkWithJourneys({
        routingWorkId: workId,
        status: 'no_journeys',
        journeys: [],
      });
    }
    const result = await database.finalization.finalizeMeetingSearch(search.id);
    expect(result).toMatchObject({
      outcome: 'completed',
      completionOutcome: 'no_feasible_candidates',
    });
    expect((await database.meetingSearches.findById(search.id))?.status).toBe('completed');
    expect(await database.finalization.listCandidateRankings(search.id)).toHaveLength(0);
    expect(await database.finalization.listRankingJourneys(search.id)).toHaveLength(0);
    const evaluations = await database.finalization.listCandidateEvaluations(search.id);
    expect(evaluations).toHaveLength(2);
    expect(evaluations.map((row) => row.destinationPlaceId).sort()).toEqual([
      'place:cologne',
      'place:munich',
    ]);
    expect(evaluations.every((row) => row.feasibility === 'participant_no_journeys')).toBe(true);
  });

  it('completes with ranked results for all modes and primary recommendation', async () => {
    const search = await createRunningSearch('fastest-overall');
    const workIds = await seedCandidateAndWork(search.id, ['place:munich', 'place:cologne']);
    // munich: short journeys; cologne: longer
    const byDest = new Map<string, string[]>();
    for (const workId of workIds) {
      const work = await database.searchPipeline.findRoutingWorkById(workId);
      const list = byDest.get(work!.destinationPlaceId) ?? [];
      list.push(workId);
      byDest.set(work!.destinationPlaceId, list);
    }
    for (const workId of byDest.get('place:munich')!) {
      await completeSucceeded(workId, 60, '2026-06-15T09:00:00.000Z');
    }
    for (const workId of byDest.get('place:cologne')!) {
      await completeSucceeded(workId, 180, '2026-06-15T11:00:00.000Z');
    }

    const startedAt = (await database.meetingSearches.findById(search.id))!.startedAt!;
    const first = await database.finalization.finalizeMeetingSearch(search.id);
    expect(first.outcome).toBe('completed');
    if (first.outcome !== 'completed') {
      return;
    }
    expect(first.completionOutcome).toBe('ranked');
    expect(first.recommendedDestinationPlaceId).toBe('place:munich');

    const rankings = await database.finalization.listCandidateRankings(search.id);
    const modes = new Set(rankings.map((row) => row.rankingMode));
    expect(modes).toEqual(
      new Set(['fairest', 'fastest-overall', 'fewest-transfers', 'arrive-together']),
    );
    expect(rankings.every((row) => row.rank >= 1)).toBe(true);

    const journeys = await database.finalization.listRankingJourneys(search.id);
    for (const ranking of rankings) {
      const selected = journeys.filter(
        (row) =>
          row.rankingMode === ranking.rankingMode &&
          row.destinationPlaceId === ranking.destinationPlaceId,
      );
      expect(selected.map((row) => row.participantId).sort()).toEqual(['a', 'b']);
    }

    expect(JSON.stringify(rankings)).not.toContain('itineraries');
    expect(JSON.stringify(rankings)).not.toContain('tripId');

    const evaluations = await database.finalization.listCandidateEvaluations(search.id);
    expect(evaluations).toHaveLength(2);
    expect(new Set(evaluations.map((row) => row.destinationPlaceId)).size).toBe(evaluations.length);
    expect(
      new Set(rankings.map((row) => `${row.rankingMode}:${row.destinationPlaceId}`)).size,
    ).toBe(rankings.length);
    expect(
      new Set(
        journeys.map((row) => `${row.rankingMode}:${row.destinationPlaceId}:${row.participantId}`),
      ).size,
    ).toBe(journeys.length);

    const second = await database.finalization.finalizeMeetingSearch(search.id);
    expect(second.outcome).toBe('already_terminal');
    const loaded = await database.meetingSearches.findById(search.id);
    expect(loaded?.startedAt?.getTime()).toBe(startedAt.getTime());
    expect(loaded?.completedAt).toBeTruthy();
    const completedAt = loaded!.completedAt!;
    await database.finalization.finalizeMeetingSearch(search.id);
    expect((await database.meetingSearches.findById(search.id))?.completedAt?.getTime()).toBe(
      completedAt.getTime(),
    );
    expect(await database.finalization.listCandidateEvaluations(search.id)).toHaveLength(
      evaluations.length,
    );
    expect(await database.finalization.listCandidateRankings(search.id)).toHaveLength(
      rankings.length,
    );
    expect(await database.finalization.listRankingJourneys(search.id)).toHaveLength(
      journeys.length,
    );
  });

  it('excludes infeasible candidates from rankings while completing ranked searches', async () => {
    const search = await createRunningSearch('fastest-overall');
    const workIds = await seedCandidateAndWork(search.id, ['place:munich', 'place:cologne']);
    const byDest = new Map<string, string[]>();
    for (const workId of workIds) {
      const work = await database.searchPipeline.findRoutingWorkById(workId);
      const list = byDest.get(work!.destinationPlaceId) ?? [];
      list.push(workId);
      byDest.set(work!.destinationPlaceId, list);
    }
    for (const workId of byDest.get('place:munich')!) {
      await completeSucceeded(workId, 60, '2026-06-15T09:00:00.000Z');
    }
    for (const workId of byDest.get('place:cologne')!) {
      await database.searchPipeline.completeRoutingWorkWithJourneys({
        routingWorkId: workId,
        status: 'no_journeys',
        journeys: [],
      });
    }

    const result = await database.finalization.finalizeMeetingSearch(search.id);
    expect(result).toMatchObject({
      outcome: 'completed',
      completionOutcome: 'ranked',
      recommendedDestinationPlaceId: 'place:munich',
    });
    const evaluations = await database.finalization.listCandidateEvaluations(search.id);
    expect(evaluations).toEqual(
      expect.arrayContaining([
        { destinationPlaceId: 'place:munich', feasibility: 'feasible' },
        { destinationPlaceId: 'place:cologne', feasibility: 'participant_no_journeys' },
      ]),
    );
    const rankings = await database.finalization.listCandidateRankings(search.id);
    expect(rankings.every((row) => row.destinationPlaceId === 'place:munich')).toBe(true);
    expect(rankings).toHaveLength(4);
    const primary = rankings.find((row) => row.rankingMode === 'fastest-overall' && row.rank === 1);
    expect(primary?.totalDurationMinutes).toBe(120);
    expect(primary?.maxDurationMinutes).toBe(60);
    expect(primary?.totalTransfers).toBe(0);
  });

  it('produces identical rankings when routing work completes in reverse order', async () => {
    async function finalizeWithOrder(reverse: boolean) {
      const search = await createRunningSearch('fastest-overall');
      const workIds = await seedCandidateAndWork(search.id, ['place:munich', 'place:cologne']);
      const ordered = reverse ? [...workIds].reverse() : [...workIds];
      for (const workId of ordered) {
        const work = await database.searchPipeline.findRoutingWorkById(workId);
        const duration = work!.destinationPlaceId === 'place:munich' ? 60 : 180;
        const arrival =
          work!.destinationPlaceId === 'place:munich'
            ? '2026-06-15T09:00:00.000Z'
            : '2026-06-15T11:00:00.000Z';
        await completeSucceeded(workId, duration, arrival);
      }
      await database.finalization.finalizeMeetingSearch(search.id);
      return database.finalization.listCandidateRankings(search.id);
    }

    const forward = await finalizeWithOrder(false);
    const reverse = await finalizeWithOrder(true);
    expect(reverse).toEqual(forward);
  });

  it('fails the search on exhausted routing work without persisting rankings', async () => {
    const search = await createRunningSearch();
    const startedAt = (await database.meetingSearches.findById(search.id))!.startedAt!;
    const workIds = await seedCandidateAndWork(search.id, ['place:munich']);
    await database.searchPipeline.markRoutingWorkExhausted(workIds[0]!, 'PROVIDER_UNAVAILABLE');
    await completeSucceeded(workIds[1]!, 60, '2026-06-15T09:00:00.000Z');
    const result = await database.finalization.finalizeMeetingSearch(search.id);
    expect(result).toMatchObject({
      outcome: 'failed',
      failureCode: 'ROUTING_TECHNICAL_FAILURE',
    });
    const loaded = await database.meetingSearches.findById(search.id);
    expect(loaded?.status).toBe('failed');
    expect(loaded?.failureCode).toBe('ROUTING_TECHNICAL_FAILURE');
    expect(loaded?.completionOutcome).toBeNull();
    expect(loaded?.failedAt).toBeTruthy();
    expect(loaded?.startedAt?.getTime()).toBe(startedAt.getTime());
    // Search-wide technical failure skips candidate evaluation persistence.
    expect(await database.finalization.listCandidateEvaluations(search.id)).toHaveLength(0);
    expect(await database.finalization.listCandidateRankings(search.id)).toHaveLength(0);
    expect(await database.finalization.listRankingJourneys(search.id)).toHaveLength(0);
    const failedAt = loaded!.failedAt!;
    await database.finalization.finalizeMeetingSearch(search.id);
    const again = await database.meetingSearches.findById(search.id);
    expect(again?.failedAt?.getTime()).toBe(failedAt.getTime());
    expect(again?.startedAt?.getTime()).toBe(startedAt.getTime());
    expect(await database.finalization.listCandidateEvaluations(search.id)).toHaveLength(0);
  });

  it('fails on invariant violation without partial rankings', async () => {
    const search = await createRunningSearch();
    const startedAt = (await database.meetingSearches.findById(search.id))!.startedAt!;
    await database.searchPipeline.claimCandidateGeneration(search.id);
    await database.searchPipeline.persistCandidatesAndFanOut({
      searchId: search.id,
      candidates: [{ destinationPlaceId: 'place:munich', ordinal: 0, distanceMeters: 1 }],
      participantIds: ['a'], // incomplete fan-out vs two participants on search
    });
    const workIds = (await database.outbox.findByAggregateId(search.id))
      .filter((event) => event.eventType === 'routing.requested')
      .map((event) => (event.payload as { routingWorkId: string }).routingWorkId);
    for (const workId of workIds) {
      await completeSucceeded(workId, 60, '2026-06-15T09:00:00.000Z');
    }
    const result = await database.finalization.finalizeMeetingSearch(search.id);
    expect(result).toMatchObject({
      outcome: 'failed',
      failureCode: 'INVARIANT_VIOLATION',
    });
    const loaded = await database.meetingSearches.findById(search.id);
    expect(loaded?.status).toBe('failed');
    expect(loaded?.failureCode).toBe('INVARIANT_VIOLATION');
    expect(loaded?.startedAt?.getTime()).toBe(startedAt.getTime());
    expect(await database.finalization.listCandidateEvaluations(search.id)).toHaveLength(0);
    expect(await database.finalization.listCandidateRankings(search.id)).toHaveLength(0);
    expect(await database.finalization.listRankingJourneys(search.id)).toHaveLength(0);
  });

  it('fails when succeeded routing work has zero journeys without persisting evaluations', async () => {
    const search = await createRunningSearch();
    const startedAt = (await database.meetingSearches.findById(search.id))!.startedAt!;
    const workIds = await seedCandidateAndWork(search.id, ['place:munich']);
    for (const workId of workIds) {
      await database.searchPipeline.completeRoutingWorkWithJourneys({
        routingWorkId: workId,
        status: 'succeeded',
        journeys: [],
      });
    }
    const result = await database.finalization.finalizeMeetingSearch(search.id);
    expect(result).toMatchObject({
      outcome: 'failed',
      failureCode: 'INVARIANT_VIOLATION',
    });
    const loaded = await database.meetingSearches.findById(search.id);
    expect(loaded?.status).toBe('failed');
    expect(loaded?.startedAt?.getTime()).toBe(startedAt.getTime());
    expect(await database.finalization.listCandidateEvaluations(search.id)).toHaveLength(0);
    expect(await database.finalization.listCandidateRankings(search.id)).toHaveLength(0);
    expect(await database.finalization.listRankingJourneys(search.id)).toHaveLength(0);
  });
});
