import { describe, expect, it } from 'vitest';

import { rankAllModes } from './ranking.js';
import { compareJourneyIdTuples, selectArriveTogetherJourneys } from './journey-selection.js';
import type { RankingJourneyInput, RankingRoutingWorkInput } from './ranking-types.js';

function j(
  journeyId: string,
  participantId: string,
  destinationPlaceId: string,
  durationMinutes: number,
  transfers: number,
  departureAt: string,
  arrivalAt: string,
): RankingJourneyInput {
  return {
    journeyId,
    participantId,
    destinationPlaceId,
    durationMinutes,
    transfers,
    departureAt: new Date(departureAt),
    arrivalAt: new Date(arrivalAt),
  };
}

function succeeded(
  routingWorkId: string,
  participantId: string,
  destinationPlaceId: string,
  journeys: readonly RankingJourneyInput[],
): RankingRoutingWorkInput {
  return {
    routingWorkId,
    participantId,
    destinationPlaceId,
    status: 'succeeded',
    journeys,
  };
}

/**
 * Fixtures designed so each mode can pick a different winner:
 * - munich: lowest total duration (fastest-overall), higher max duration / wider arrivals
 * - cologne: zero transfers (fewest-transfers)
 * - frankfurt: lowest max duration and tight arrivals (fairest + arrive-together)
 */
function buildFixture() {
  const munich = 'place:munich';
  const cologne = 'place:cologne';
  const frankfurt = 'place:frankfurt';
  return {
    participantIds: ['a', 'b'],
    candidates: [
      { candidateId: munich, destinationPlaceId: munich, ordinal: 0 },
      { candidateId: cologne, destinationPlaceId: cologne, ordinal: 1 },
      { candidateId: frankfurt, destinationPlaceId: frankfurt, ordinal: 2 },
    ],
    routingWork: [
      succeeded('wm-a', 'a', munich, [
        j('wm-a-0', 'a', munich, 30, 1, '2026-06-15T08:00:00.000Z', '2026-06-15T08:30:00.000Z'),
        j('wm-a-1', 'a', munich, 90, 0, '2026-06-15T08:00:00.000Z', '2026-06-15T09:30:00.000Z'),
      ]),
      succeeded('wm-b', 'b', munich, [
        j('wm-b-0', 'b', munich, 80, 1, '2026-06-15T08:00:00.000Z', '2026-06-15T10:00:00.000Z'),
      ]),
      succeeded('wc-a', 'a', cologne, [
        j('wc-a-0', 'a', cologne, 150, 0, '2026-06-15T08:00:00.000Z', '2026-06-15T10:30:00.000Z'),
        j('wc-a-1', 'a', cologne, 120, 2, '2026-06-15T08:00:00.000Z', '2026-06-15T10:00:00.000Z'),
      ]),
      succeeded('wc-b', 'b', cologne, [
        j('wc-b-0', 'b', cologne, 160, 0, '2026-06-15T08:30:00.000Z', '2026-06-15T11:10:00.000Z'),
        j('wc-b-1', 'b', cologne, 130, 2, '2026-06-15T08:00:00.000Z', '2026-06-15T10:10:00.000Z'),
      ]),
      succeeded('wf-a', 'a', frankfurt, [
        j('wf-a-0', 'a', frankfurt, 70, 1, '2026-06-15T08:00:00.000Z', '2026-06-15T09:10:00.000Z'),
      ]),
      succeeded('wf-b', 'b', frankfurt, [
        j('wf-b-0', 'b', frankfurt, 75, 1, '2026-06-15T08:05:00.000Z', '2026-06-15T09:20:00.000Z'),
      ]),
    ],
  };
}

describe('rankAllModes', () => {
  it('separates all four mode winners with three participants and four candidates', () => {
    /**
     * Metrics (single journey per participant → selection forced):
     * | Cand | Durations   | Total | Max | Transfers | Spread |
     * | A    | 20,20,100   | 140   | 100 | 3         | 80 min |
     * | B    | 50,50,50    | 150   | 50  | 6         | 90 min |
     * | C    | 70,70,70    | 210   | 70  | 0         | 30 min |
     * | D    | 55,55,55    | 165   | 55  | 3         | 10 min |
     * Expected winners: fastest→A, fairest→B, fewest→C, arrive-together→D
     */
    const A = 'cand:A';
    const B = 'cand:B';
    const C = 'cand:C';
    const D = 'cand:D';
    const result = rankAllModes({
      participantIds: ['p1', 'p2', 'p3'],
      candidates: [
        { candidateId: A, destinationPlaceId: A, ordinal: 0 },
        { candidateId: B, destinationPlaceId: B, ordinal: 1 },
        { candidateId: C, destinationPlaceId: C, ordinal: 2 },
        { candidateId: D, destinationPlaceId: D, ordinal: 3 },
      ],
      routingWork: [
        succeeded('a1', 'p1', A, [
          j('a-p1', 'p1', A, 20, 1, '2026-06-15T08:00:00.000Z', '2026-06-15T08:20:00.000Z'),
        ]),
        succeeded('a2', 'p2', A, [
          j('a-p2', 'p2', A, 20, 1, '2026-06-15T08:00:00.000Z', '2026-06-15T08:20:00.000Z'),
        ]),
        succeeded('a3', 'p3', A, [
          j('a-p3', 'p3', A, 100, 1, '2026-06-15T08:00:00.000Z', '2026-06-15T09:40:00.000Z'),
        ]),
        succeeded('b1', 'p1', B, [
          j('b-p1', 'p1', B, 50, 2, '2026-06-15T08:00:00.000Z', '2026-06-15T08:50:00.000Z'),
        ]),
        succeeded('b2', 'p2', B, [
          j('b-p2', 'p2', B, 50, 2, '2026-06-15T08:30:00.000Z', '2026-06-15T09:20:00.000Z'),
        ]),
        succeeded('b3', 'p3', B, [
          j('b-p3', 'p3', B, 50, 2, '2026-06-15T09:30:00.000Z', '2026-06-15T10:20:00.000Z'),
        ]),
        succeeded('c1', 'p1', C, [
          j('c-p1', 'p1', C, 70, 0, '2026-06-15T08:00:00.000Z', '2026-06-15T09:10:00.000Z'),
        ]),
        succeeded('c2', 'p2', C, [
          j('c-p2', 'p2', C, 70, 0, '2026-06-15T08:15:00.000Z', '2026-06-15T09:25:00.000Z'),
        ]),
        succeeded('c3', 'p3', C, [
          j('c-p3', 'p3', C, 70, 0, '2026-06-15T08:30:00.000Z', '2026-06-15T09:40:00.000Z'),
        ]),
        succeeded('d1', 'p1', D, [
          j('d-p1', 'p1', D, 55, 1, '2026-06-15T08:00:00.000Z', '2026-06-15T08:55:00.000Z'),
        ]),
        succeeded('d2', 'p2', D, [
          j('d-p2', 'p2', D, 55, 1, '2026-06-15T08:05:00.000Z', '2026-06-15T09:00:00.000Z'),
        ]),
        succeeded('d3', 'p3', D, [
          j('d-p3', 'p3', D, 55, 1, '2026-06-15T08:10:00.000Z', '2026-06-15T09:05:00.000Z'),
        ]),
      ],
    });
    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }

    const order = (modeName: string) =>
      result.modes
        .find((entry) => entry.rankingMode === modeName)!
        .rankings.map((row) => row.candidateId);

    expect(order('fastest-overall')).toEqual([A, B, D, C]);
    expect(order('fairest')).toEqual([B, D, C, A]);
    expect(order('fewest-transfers')).toEqual([C, A, D, B]);
    expect(order('arrive-together')).toEqual([D, C, A, B]);

    const summarize = (modeName: string, candidateId: string) => {
      const row = result.modes
        .find((entry) => entry.rankingMode === modeName)!
        .rankings.find((entry) => entry.candidateId === candidateId)!;
      return {
        rank: row.rank,
        journeys: Object.fromEntries(
          row.selectedJourneys.map((selected) => [selected.participantId, selected.journeyId]),
        ),
        totalDur: row.totalDurationMinutes,
        maxDur: row.maxDurationMinutes,
        range: row.durationRangeMinutes,
        totalXfer: row.totalTransfers,
        maxXfer: row.maxTransfers,
        earliest: row.earliestArrivalAt.toISOString(),
        latest: row.latestArrivalAt.toISOString(),
        spreadMs: row.arrivalSpreadMs,
        penaltyMs: row.arrivalPenaltyMs,
      };
    };

    expect(summarize('fastest-overall', A)).toMatchObject({
      rank: 1,
      journeys: { p1: 'a-p1', p2: 'a-p2', p3: 'a-p3' },
      totalDur: 140,
      maxDur: 100,
      totalXfer: 3,
      spreadMs: 80 * 60_000,
    });
    expect(summarize('fairest', B)).toMatchObject({
      rank: 1,
      journeys: { p1: 'b-p1', p2: 'b-p2', p3: 'b-p3' },
      totalDur: 150,
      maxDur: 50,
      totalXfer: 6,
      spreadMs: 90 * 60_000,
      penaltyMs: 30 * 60_000,
    });
    expect(summarize('fewest-transfers', C)).toMatchObject({
      rank: 1,
      journeys: { p1: 'c-p1', p2: 'c-p2', p3: 'c-p3' },
      totalDur: 210,
      maxDur: 70,
      totalXfer: 0,
      spreadMs: 30 * 60_000,
      penaltyMs: 0,
    });
    expect(summarize('arrive-together', D)).toMatchObject({
      rank: 1,
      journeys: { p1: 'd-p1', p2: 'd-p2', p3: 'd-p3' },
      totalDur: 165,
      maxDur: 55,
      totalXfer: 3,
      spreadMs: 10 * 60_000,
      penaltyMs: 0,
    });

    // Fairest reuses fastest journey picks on every candidate.
    const fastest = result.modes.find((entry) => entry.rankingMode === 'fastest-overall')!;
    const fairest = result.modes.find((entry) => entry.rankingMode === 'fairest')!;
    for (const candidateId of [A, B, C, D]) {
      expect(
        fairest.rankings.find((row) => row.candidateId === candidateId)?.selectedJourneys,
      ).toEqual(fastest.rankings.find((row) => row.candidateId === candidateId)?.selectedJourneys);
    }
  });

  it('York beats Berlin under tolerance-aware Arrive together (strict spread-first picks Berlin)', () => {
    /**
     * Product counterexample (London–Edinburgh corridor vs distant hub):
     * York:   durations 120 / 135, arrival spread 20 min
     * Berlin: durations 720 / 760, arrival spread 0 min
     * Strict spread-first would recommend Berlin; tolerance-aware prefers York.
     */
    const york = 'place:york';
    const berlin = 'place:berlin';
    const result = rankAllModes({
      participantIds: ['london', 'edinburgh'],
      candidates: [
        { candidateId: berlin, destinationPlaceId: berlin, ordinal: 0 },
        { candidateId: york, destinationPlaceId: york, ordinal: 1 },
      ],
      routingWork: [
        succeeded('yl', 'london', york, [
          j(
            'york-lon',
            'london',
            york,
            120,
            0,
            '2026-08-10T08:00:00+01:00',
            '2026-08-10T10:00:00+01:00',
          ),
        ]),
        succeeded('ye', 'edinburgh', york, [
          j(
            'york-edi',
            'edinburgh',
            york,
            135,
            0,
            '2026-08-10T08:05:00+01:00',
            '2026-08-10T10:20:00+01:00',
          ),
        ]),
        succeeded('bl', 'london', berlin, [
          j(
            'ber-lon',
            'london',
            berlin,
            720,
            2,
            '2026-08-10T06:00:00+01:00',
            '2026-08-10T20:00:00+02:00',
          ),
        ]),
        succeeded('be', 'edinburgh', berlin, [
          j(
            'ber-edi',
            'edinburgh',
            berlin,
            760,
            2,
            '2026-08-10T05:20:00+01:00',
            '2026-08-10T20:00:00+02:00',
          ),
        ]),
      ],
    });
    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }

    const arrive = result.modes.find((entry) => entry.rankingMode === 'arrive-together')!;
    const yorkRow = arrive.rankings.find((row) => row.candidateId === york)!;
    const berlinRow = arrive.rankings.find((row) => row.candidateId === berlin)!;

    expect(yorkRow.arrivalSpreadMs).toBe(20 * 60_000);
    expect(yorkRow.arrivalPenaltyMs).toBe(0);
    expect(yorkRow.totalDurationMinutes).toBe(255);
    expect(yorkRow.maxDurationMinutes).toBe(135);
    // +01:00 / +02:00 arrivals both normalize to the same UTC instant for Berlin.
    expect(berlinRow.earliestArrivalAt.toISOString()).toBe('2026-08-10T18:00:00.000Z');
    expect(berlinRow.latestArrivalAt.toISOString()).toBe('2026-08-10T18:00:00.000Z');
    expect(berlinRow.arrivalSpreadMs).toBe(0);
    expect(berlinRow.arrivalPenaltyMs).toBe(0);
    expect(berlinRow.totalDurationMinutes).toBe(1480);
    expect(berlinRow.maxDurationMinutes).toBe(760);

    // Legacy strict spread-first ordering (arrivalSpread → …) would pick Berlin.
    const strictOrder = [yorkRow, berlinRow].sort(
      (a, b) =>
        a.arrivalSpreadMs - b.arrivalSpreadMs ||
        a.totalDurationMinutes - b.totalDurationMinutes ||
        a.maxDurationMinutes - b.maxDurationMinutes ||
        a.totalTransfers - b.totalTransfers ||
        a.latestArrivalAt.getTime() - b.latestArrivalAt.getTime() ||
        a.ordinal - b.ordinal ||
        (a.candidateId < b.candidateId ? -1 : a.candidateId > b.candidateId ? 1 : 0),
    );
    expect(strictOrder.map((row) => row.candidateId)).toEqual([berlin, york]);

    // Production tolerance-aware comparator: equal penalties → prefer lower maxDuration → York.
    expect(arrive.rankings.map((row) => row.candidateId)).toEqual([york, berlin]);
    expect(arrive.rankings[0]?.rank).toBe(1);
    expect(yorkRow.selectedJourneys.map((row) => row.journeyId).sort()).toEqual([
      'york-edi',
      'york-lon',
    ]);
  });

  it('selects different journey sets per mode for one multi-journey candidate', () => {
    const dest = 'place:meet';
    const result = rankAllModes({
      participantIds: ['p1', 'p2'],
      candidates: [{ candidateId: dest, destinationPlaceId: dest, ordinal: 0 }],
      routingWork: [
        succeeded('w1', 'p1', dest, [
          j('J1', 'p1', dest, 60, 1, '2026-06-15T09:00:00.000Z', '2026-06-15T10:00:00.000Z'),
          j('J2', 'p1', dest, 75, 0, '2026-06-15T09:15:00.000Z', '2026-06-15T10:30:00.000Z'),
        ]),
        succeeded('w2', 'p2', dest, [
          j('K1', 'p2', dest, 55, 2, '2026-06-15T09:45:00.000Z', '2026-06-15T10:40:00.000Z'),
          j('K2', 'p2', dest, 65, 0, '2026-06-15T09:26:00.000Z', '2026-06-15T10:31:00.000Z'),
        ]),
      ],
    });
    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }

    const pick = (modeName: string) => {
      const row = result.modes.find((entry) => entry.rankingMode === modeName)!.rankings[0]!;
      return {
        journeys: Object.fromEntries(
          row.selectedJourneys.map((selected) => [selected.participantId, selected.journeyId]),
        ),
        totalDur: row.totalDurationMinutes,
        totalXfer: row.totalTransfers,
        earliest: row.earliestArrivalAt.toISOString(),
        latest: row.latestArrivalAt.toISOString(),
        spreadMs: row.arrivalSpreadMs,
      };
    };

    expect(pick('fastest-overall')).toEqual({
      journeys: { p1: 'J1', p2: 'K1' },
      totalDur: 115,
      totalXfer: 3,
      earliest: '2026-06-15T10:00:00.000Z',
      latest: '2026-06-15T10:40:00.000Z',
      spreadMs: 40 * 60_000,
    });
    expect(pick('fairest')).toEqual(pick('fastest-overall'));
    expect(pick('fewest-transfers')).toEqual({
      journeys: { p1: 'J2', p2: 'K2' },
      totalDur: 140,
      totalXfer: 0,
      earliest: '2026-06-15T10:30:00.000Z',
      latest: '2026-06-15T10:31:00.000Z',
      spreadMs: 60_000,
    });
    // Tolerance-aware Arrive together prefers J1+K1 (maxDur 60, spread 40 within 60m)
    // over the near-zero-spread but slower J2+K2 set.
    expect(pick('arrive-together')).toEqual({
      journeys: { p1: 'J1', p2: 'K1' },
      totalDur: 115,
      totalXfer: 3,
      earliest: '2026-06-15T10:00:00.000Z',
      latest: '2026-06-15T10:40:00.000Z',
      spreadMs: 40 * 60_000,
    });
  });

  it('ranks fastest-overall by total duration with deterministic journey picks', () => {
    const result = rankAllModes(buildFixture());
    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    const mode = result.modes.find((entry) => entry.rankingMode === 'fastest-overall')!;
    expect(mode.rankings[0]?.destinationPlaceId).toBe('place:munich');
    expect(mode.rankings.map((row) => row.rank)).toEqual([1, 2, 3]);
    // a picks 30m journey over 90m
    expect(
      mode.rankings[0]?.selectedJourneys.find((row) => row.participantId === 'a')?.journeyId,
    ).toBe('wm-a-0');
    expect(mode.rankings[0]?.totalDurationMinutes).toBe(110);
  });

  it('ranks fairest by max participant duration', () => {
    const result = rankAllModes(buildFixture());
    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    const mode = result.modes.find((entry) => entry.rankingMode === 'fairest')!;
    expect(mode.rankings[0]?.destinationPlaceId).toBe('place:frankfurt');
  });

  it('ranks fewest-transfers by total transfers', () => {
    const result = rankAllModes(buildFixture());
    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    const mode = result.modes.find((entry) => entry.rankingMode === 'fewest-transfers')!;
    expect(mode.rankings[0]?.destinationPlaceId).toBe('place:cologne');
    expect(
      mode.rankings[0]?.selectedJourneys.find((row) => row.participantId === 'b')?.journeyId,
    ).toBe('wc-b-0');
  });

  it('ranks arrive-together by arrival spread', () => {
    const result = rankAllModes(buildFixture());
    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    const mode = result.modes.find((entry) => entry.rankingMode === 'arrive-together')!;
    expect(mode.rankings[0]?.destinationPlaceId).toBe('place:frankfurt');
    expect(mode.rankings[0]?.arrivalSpreadMs).toBeLessThan(
      mode.rankings.find((row) => row.destinationPlaceId === 'place:munich')!.arrivalSpreadMs,
    );
  });

  it('lets different modes select different winners', () => {
    const result = rankAllModes(buildFixture());
    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    const winners = Object.fromEntries(
      result.modes.map((mode) => [mode.rankingMode, mode.rankings[0]?.destinationPlaceId]),
    );
    expect(winners['fastest-overall']).toBe('place:munich');
    expect(winners['fewest-transfers']).toBe('place:cologne');
    expect(winners['fairest']).toBe('place:frankfurt');
    expect(winners['arrive-together']).toBe('place:frankfurt');
    expect(new Set(Object.values(winners)).size).toBeGreaterThan(1);
  });

  it('asserts complete fixture metrics, fairest=fastest journey picks, and arrive-together window picks', () => {
    const result = rankAllModes(buildFixture());
    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }

    const summarize = (modeName: string) => {
      const mode = result.modes.find((entry) => entry.rankingMode === modeName)!;
      return mode.rankings.map((row) => ({
        rank: row.rank,
        dest: row.destinationPlaceId,
        journeys: Object.fromEntries(
          row.selectedJourneys.map((selected) => [selected.participantId, selected.journeyId]),
        ),
        totalDur: row.totalDurationMinutes,
        maxDur: row.maxDurationMinutes,
        range: row.durationRangeMinutes,
        totalXfer: row.totalTransfers,
        maxXfer: row.maxTransfers,
        earliest: row.earliestArrivalAt.toISOString(),
        latest: row.latestArrivalAt.toISOString(),
        spreadMs: row.arrivalSpreadMs,
      }));
    };

    expect(summarize('fastest-overall')).toEqual([
      {
        rank: 1,
        dest: 'place:munich',
        journeys: { a: 'wm-a-0', b: 'wm-b-0' },
        totalDur: 110,
        maxDur: 80,
        range: 50,
        totalXfer: 2,
        maxXfer: 1,
        earliest: '2026-06-15T08:30:00.000Z',
        latest: '2026-06-15T10:00:00.000Z',
        spreadMs: 5_400_000,
      },
      {
        rank: 2,
        dest: 'place:frankfurt',
        journeys: { a: 'wf-a-0', b: 'wf-b-0' },
        totalDur: 145,
        maxDur: 75,
        range: 5,
        totalXfer: 2,
        maxXfer: 1,
        earliest: '2026-06-15T09:10:00.000Z',
        latest: '2026-06-15T09:20:00.000Z',
        spreadMs: 600_000,
      },
      {
        rank: 3,
        dest: 'place:cologne',
        journeys: { a: 'wc-a-1', b: 'wc-b-1' },
        totalDur: 250,
        maxDur: 130,
        range: 10,
        totalXfer: 4,
        maxXfer: 2,
        earliest: '2026-06-15T10:00:00.000Z',
        latest: '2026-06-15T10:10:00.000Z',
        spreadMs: 600_000,
      },
    ]);

    expect(summarize('fairest')).toEqual([
      {
        rank: 1,
        dest: 'place:frankfurt',
        journeys: { a: 'wf-a-0', b: 'wf-b-0' },
        totalDur: 145,
        maxDur: 75,
        range: 5,
        totalXfer: 2,
        maxXfer: 1,
        earliest: '2026-06-15T09:10:00.000Z',
        latest: '2026-06-15T09:20:00.000Z',
        spreadMs: 600_000,
      },
      {
        rank: 2,
        dest: 'place:munich',
        journeys: { a: 'wm-a-0', b: 'wm-b-0' },
        totalDur: 110,
        maxDur: 80,
        range: 50,
        totalXfer: 2,
        maxXfer: 1,
        earliest: '2026-06-15T08:30:00.000Z',
        latest: '2026-06-15T10:00:00.000Z',
        spreadMs: 5_400_000,
      },
      {
        rank: 3,
        dest: 'place:cologne',
        journeys: { a: 'wc-a-1', b: 'wc-b-1' },
        totalDur: 250,
        maxDur: 130,
        range: 10,
        totalXfer: 4,
        maxXfer: 2,
        earliest: '2026-06-15T10:00:00.000Z',
        latest: '2026-06-15T10:10:00.000Z',
        spreadMs: 600_000,
      },
    ]);

    // Fairest uses the same per-participant fastest journey picks as fastest-overall.
    const fastest = result.modes.find((entry) => entry.rankingMode === 'fastest-overall')!;
    const fairest = result.modes.find((entry) => entry.rankingMode === 'fairest')!;
    for (const dest of ['place:munich', 'place:cologne', 'place:frankfurt']) {
      expect(
        fairest.rankings.find((row) => row.destinationPlaceId === dest)?.selectedJourneys,
      ).toEqual(fastest.rankings.find((row) => row.destinationPlaceId === dest)?.selectedJourneys);
    }

    expect(summarize('fewest-transfers')).toEqual([
      {
        rank: 1,
        dest: 'place:cologne',
        journeys: { a: 'wc-a-0', b: 'wc-b-0' },
        totalDur: 310,
        maxDur: 160,
        range: 10,
        totalXfer: 0,
        maxXfer: 0,
        earliest: '2026-06-15T10:30:00.000Z',
        latest: '2026-06-15T11:10:00.000Z',
        spreadMs: 2_400_000,
      },
      {
        rank: 2,
        dest: 'place:munich',
        journeys: { a: 'wm-a-1', b: 'wm-b-0' },
        totalDur: 170,
        maxDur: 90,
        range: 10,
        totalXfer: 1,
        maxXfer: 1,
        earliest: '2026-06-15T09:30:00.000Z',
        latest: '2026-06-15T10:00:00.000Z',
        spreadMs: 1_800_000,
      },
      {
        rank: 3,
        dest: 'place:frankfurt',
        journeys: { a: 'wf-a-0', b: 'wf-b-0' },
        totalDur: 145,
        maxDur: 75,
        range: 5,
        totalXfer: 2,
        maxXfer: 1,
        earliest: '2026-06-15T09:10:00.000Z',
        latest: '2026-06-15T09:20:00.000Z',
        spreadMs: 600_000,
      },
    ]);

    expect(summarize('arrive-together')).toEqual([
      {
        rank: 1,
        dest: 'place:frankfurt',
        journeys: { a: 'wf-a-0', b: 'wf-b-0' },
        totalDur: 145,
        maxDur: 75,
        range: 5,
        totalXfer: 2,
        maxXfer: 1,
        earliest: '2026-06-15T09:10:00.000Z',
        latest: '2026-06-15T09:20:00.000Z',
        spreadMs: 600_000,
      },
      {
        rank: 2,
        dest: 'place:munich',
        journeys: { a: 'wm-a-1', b: 'wm-b-0' },
        totalDur: 170,
        maxDur: 90,
        range: 10,
        totalXfer: 1,
        maxXfer: 1,
        earliest: '2026-06-15T09:30:00.000Z',
        latest: '2026-06-15T10:00:00.000Z',
        spreadMs: 1_800_000,
      },
      {
        rank: 3,
        dest: 'place:cologne',
        journeys: { a: 'wc-a-1', b: 'wc-b-1' },
        totalDur: 250,
        maxDur: 130,
        range: 10,
        totalXfer: 4,
        maxXfer: 2,
        earliest: '2026-06-15T10:00:00.000Z',
        latest: '2026-06-15T10:10:00.000Z',
        spreadMs: 600_000,
      },
    ]);
  });

  it('is independent from input ordering', () => {
    const base = buildFixture();
    const shuffled = {
      participantIds: ['b', 'a'],
      candidates: [...base.candidates].reverse(),
      routingWork: [...base.routingWork].reverse(),
    };
    const a = rankAllModes(base);
    const b = rankAllModes(shuffled);
    expect(a).toEqual(b);
  });

  it('does not leak candidates or rankings across independent search fixtures', () => {
    const searchA = rankAllModes({
      participantIds: ['a', 'b'],
      candidates: [{ candidateId: 'place:berlin', destinationPlaceId: 'place:berlin', ordinal: 0 }],
      routingWork: [
        succeeded('a1', 'a', 'place:berlin', [
          j(
            'ba',
            'a',
            'place:berlin',
            60,
            0,
            '2026-06-15T08:00:00.000Z',
            '2026-06-15T09:00:00.000Z',
          ),
        ]),
        succeeded('a2', 'b', 'place:berlin', [
          j(
            'bb',
            'b',
            'place:berlin',
            60,
            0,
            '2026-06-15T08:00:00.000Z',
            '2026-06-15T09:00:00.000Z',
          ),
        ]),
      ],
    });
    const searchB = rankAllModes({
      participantIds: ['a', 'b'],
      candidates: [{ candidateId: 'place:york', destinationPlaceId: 'place:york', ordinal: 0 }],
      routingWork: [
        succeeded('b1', 'a', 'place:york', [
          j('ya', 'a', 'place:york', 40, 0, '2026-06-15T08:00:00.000Z', '2026-06-15T08:40:00.000Z'),
        ]),
        succeeded('b2', 'b', 'place:york', [
          j('yb', 'b', 'place:york', 40, 0, '2026-06-15T08:00:00.000Z', '2026-06-15T08:40:00.000Z'),
        ]),
      ],
    });
    expect(searchA.ok && searchB.ok).toBe(true);
    if (!searchA.ok || !searchB.ok) {
      return;
    }
    for (const mode of searchA.modes) {
      expect(mode.rankings.map((row) => row.candidateId)).toEqual(['place:berlin']);
      expect(mode.rankings[0]?.selectedJourneys.map((row) => row.journeyId).sort()).toEqual([
        'ba',
        'bb',
      ]);
    }
    for (const mode of searchB.modes) {
      expect(mode.rankings.map((row) => row.candidateId)).toEqual(['place:york']);
      expect(mode.rankings[0]?.selectedJourneys.map((row) => row.journeyId).sort()).toEqual([
        'ya',
        'yb',
      ]);
    }
    // Repeated calculation is byte-equivalent for the same fixture.
    expect(JSON.stringify(searchA)).toBe(
      JSON.stringify(
        rankAllModes({
          participantIds: ['a', 'b'],
          candidates: [
            { candidateId: 'place:berlin', destinationPlaceId: 'place:berlin', ordinal: 0 },
          ],
          routingWork: [
            succeeded('a1', 'a', 'place:berlin', [
              j(
                'ba',
                'a',
                'place:berlin',
                60,
                0,
                '2026-06-15T08:00:00.000Z',
                '2026-06-15T09:00:00.000Z',
              ),
            ]),
            succeeded('a2', 'b', 'place:berlin', [
              j(
                'bb',
                'b',
                'place:berlin',
                60,
                0,
                '2026-06-15T08:00:00.000Z',
                '2026-06-15T09:00:00.000Z',
              ),
            ]),
          ],
        }),
      ),
    );
  });

  it('uses candidateId, not destinationPlaceId, as the final candidate tie-breaker', () => {
    const result = rankAllModes({
      participantIds: ['p'],
      candidates: [
        {
          candidateId: 'cand-b',
          destinationPlaceId: 'place:aaa',
          ordinal: 0,
        },
        {
          candidateId: 'cand-a',
          destinationPlaceId: 'place:zzz',
          ordinal: 0,
        },
      ],
      routingWork: [
        succeeded('wa', 'p', 'place:aaa', [
          j('ja', 'p', 'place:aaa', 60, 0, '2026-06-15T08:00:00.000Z', '2026-06-15T09:00:00.000Z'),
        ]),
        succeeded('wb', 'p', 'place:zzz', [
          j('jb', 'p', 'place:zzz', 60, 0, '2026-06-15T08:00:00.000Z', '2026-06-15T09:00:00.000Z'),
        ]),
      ],
    });
    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    for (const mode of result.modes) {
      // candidateId 'cand-a' < 'cand-b'; destination place 'place:aaa' < 'place:zzz'
      // would invert the winner if destinationPlaceId were used instead.
      expect(mode.rankings[0]?.candidateId).toBe('cand-a');
      expect(mode.rankings[0]?.destinationPlaceId).toBe('place:zzz');
      expect(mode.rankings.map((row) => row.rank)).toEqual([1, 2]);
    }
  });

  it('uses candidate ordinal as a stable tie-break', () => {
    const destinationA = 'place:a';
    const destinationB = 'place:b';
    const result = rankAllModes({
      participantIds: ['p'],
      candidates: [
        { candidateId: destinationB, destinationPlaceId: destinationB, ordinal: 1 },
        { candidateId: destinationA, destinationPlaceId: destinationA, ordinal: 0 },
      ],
      routingWork: [
        succeeded('wa', 'p', destinationA, [
          j('ja', 'p', destinationA, 60, 0, '2026-06-15T08:00:00.000Z', '2026-06-15T09:00:00.000Z'),
        ]),
        succeeded('wb', 'p', destinationB, [
          j('jb', 'p', destinationB, 60, 0, '2026-06-15T08:00:00.000Z', '2026-06-15T09:00:00.000Z'),
        ]),
      ],
    });
    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    for (const mode of result.modes) {
      expect(mode.rankings[0]?.destinationPlaceId).toBe(destinationA);
    }
  });

  it('handles cross-midnight arrivals using instants', () => {
    const result = rankAllModes({
      participantIds: ['a', 'b'],
      candidates: [{ candidateId: 'place:night', destinationPlaceId: 'place:night', ordinal: 0 }],
      routingWork: [
        succeeded('w1', 'a', 'place:night', [
          j(
            'j1',
            'a',
            'place:night',
            180,
            0,
            '2026-06-15T22:00:00.000Z',
            '2026-06-16T01:00:00.000Z',
          ),
        ]),
        succeeded('w2', 'b', 'place:night', [
          j(
            'j2',
            'b',
            'place:night',
            60,
            0,
            '2026-06-15T23:30:00.000Z',
            '2026-06-16T00:30:00.000Z',
          ),
        ]),
      ],
    });
    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    const mode = result.modes.find((entry) => entry.rankingMode === 'arrive-together')!;
    expect(mode.rankings[0]?.arrivalSpreadMs).toBe(30 * 60_000);
  });

  it('treats equivalent instants with different UTC offsets as equal', () => {
    const result = rankAllModes({
      participantIds: ['a', 'b'],
      candidates: [{ candidateId: 'place:x', destinationPlaceId: 'place:x', ordinal: 0 }],
      routingWork: [
        succeeded('w1', 'a', 'place:x', [
          j('j1', 'a', 'place:x', 60, 0, '2026-06-15T10:00:00.000Z', '2026-06-15T12:00:00+02:00'),
        ]),
        succeeded('w2', 'b', 'place:x', [
          j('j2', 'b', 'place:x', 60, 0, '2026-06-15T10:00:00.000Z', '2026-06-15T10:00:00.000Z'),
        ]),
      ],
    });
    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    const mode = result.modes.find((entry) => entry.rankingMode === 'arrive-together')!;
    expect(mode.rankings[0]?.arrivalSpreadMs).toBe(0);
  });

  it('excludes infeasible candidates from rankings and keeps sequential ranks', () => {
    const fixture = buildFixture();
    const routingWork = fixture.routingWork.map((row) =>
      row.destinationPlaceId === 'place:cologne' && row.participantId === 'b'
        ? { ...row, status: 'no_journeys' as const, journeys: [] }
        : row,
    );
    const result = rankAllModes({ ...fixture, routingWork });
    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    for (const mode of result.modes) {
      expect(mode.rankings.every((row) => row.destinationPlaceId !== 'place:cologne')).toBe(true);
      expect(mode.rankings.map((row) => row.rank)).toEqual([1, 2]);
    }
  });

  it('rejects invalid ranking inputs without producing rankings', () => {
    const result = rankAllModes({
      participantIds: ['a'],
      candidates: [{ candidateId: 'place:x', destinationPlaceId: 'place:x', ordinal: 0 }],
      routingWork: [
        succeeded('w', 'a', 'place:x', [
          j('bad', 'a', 'place:x', -1, 0, '2026-06-15T08:00:00.000Z', '2026-06-15T09:00:00.000Z'),
        ]),
      ],
    });
    expect(result.ok).toBe(false);
    if (result.ok) {
      return;
    }
    expect(result.code).toBe('RANKING_INPUT_INVALID');
  });
});

describe('selectArriveTogetherJourneys', () => {
  function journeysByParticipant(
    entries: ReadonlyArray<readonly RankingJourneyInput[]>,
  ): Map<string, readonly RankingJourneyInput[]> {
    const map = new Map<string, readonly RankingJourneyInput[]>();
    for (const journeys of entries) {
      map.set(journeys[0]!.participantId, journeys);
    }
    return map;
  }

  function selectedIdsInParticipantOrder(
    selected: ReturnType<typeof selectArriveTogetherJourneys>,
  ): string[] {
    return [...selected]
      .sort((a, b) =>
        a.participantId === b.participantId ? 0 : a.participantId < b.participantId ? -1 : 1,
      )
      .map((row) => row.journeyId);
  }

  it('selects the lower-duration journey inside a minimal arrival window (C1 not C2)', () => {
    const dest = 'place:meet';
    const selected = selectArriveTogetherJourneys(
      journeysByParticipant([
        [j('A', 'a', dest, 100, 0, '2026-06-15T09:00:00.000Z', '2026-06-15T10:00:00.000Z')],
        [j('B', 'b', dest, 100, 0, '2026-06-15T09:10:00.000Z', '2026-06-15T10:10:00.000Z')],
        [
          j('C1', 'c', dest, 10, 0, '2026-06-15T09:52:00.000Z', '2026-06-15T10:02:00.000Z'),
          j('C2', 'c', dest, 90, 0, '2026-06-15T09:18:00.000Z', '2026-06-15T10:08:00.000Z'),
        ],
      ]),
    );
    expect(selectedIdsInParticipantOrder(selected)).toEqual(['A', 'B', 'C1']);
    expect(selected.find((row) => row.participantId === 'c')?.journeyId).toBe('C1');
    const arrivals = selected.map((row) => row.arrivalAt.getTime());
    expect(Math.max(...arrivals) - Math.min(...arrivals)).toBe(10 * 60_000);
    expect(selected.reduce((sum, row) => sum + row.durationMinutes, 0)).toBe(210);
  });

  it('keeps the C1 selection when participant and journey input order is shuffled', () => {
    const dest = 'place:meet';
    const selected = selectArriveTogetherJourneys(
      new Map([
        [
          'c',
          [
            j('C2', 'c', dest, 90, 0, '2026-06-15T09:18:00.000Z', '2026-06-15T10:08:00.000Z'),
            j('C1', 'c', dest, 10, 0, '2026-06-15T09:52:00.000Z', '2026-06-15T10:02:00.000Z'),
          ],
        ],
        ['b', [j('B', 'b', dest, 100, 0, '2026-06-15T09:10:00.000Z', '2026-06-15T10:10:00.000Z')]],
        ['a', [j('A', 'a', dest, 100, 0, '2026-06-15T09:00:00.000Z', '2026-06-15T10:00:00.000Z')]],
      ]),
    );
    expect(selectedIdsInParticipantOrder(selected)).toEqual(['A', 'B', 'C1']);
  });

  it('uses the journey-ID tuple instead of an uncontracted arrival tie-break inside a minimum-spread window', () => {
    const dest = 'place:meet';
    // Both covering sets share spread/duration/transfers/latest/earliest; only the
    // participant-ordered journey-ID tuple differs. Old local pick preferred earlier
    // arrival (Cz-early); contracted pick uses binary journey ID (C-late < Cz-early).
    const selected = selectArriveTogetherJourneys(
      journeysByParticipant([
        [j('A', 'a', dest, 100, 0, '2026-06-15T09:00:00.000Z', '2026-06-15T10:00:00.000Z')],
        [j('B', 'b', dest, 100, 0, '2026-06-15T09:10:00.000Z', '2026-06-15T10:10:00.000Z')],
        [
          j('Cz-early', 'c', dest, 10, 0, '2026-06-15T09:52:00.000Z', '2026-06-15T10:02:00.000Z'),
          j('C-late', 'c', dest, 10, 0, '2026-06-15T09:58:00.000Z', '2026-06-15T10:08:00.000Z'),
        ],
      ]),
    );
    expect(selected.find((row) => row.participantId === 'c')?.journeyId).toBe('C-late');
    expect(selectedIdsInParticipantOrder(selected)).toEqual(['A', 'B', 'C-late']);
    const earliest = Math.min(...selected.map((row) => row.arrivalAt.getTime()));
    const latest = Math.max(...selected.map((row) => row.arrivalAt.getTime()));
    expect(latest - earliest).toBe(10 * 60_000);
    expect(selected.reduce((sum, row) => sum + row.durationMinutes, 0)).toBe(210);
    expect(selected.reduce((sum, row) => sum + row.transfers, 0)).toBe(0);
    expect(latest).toBe(Date.parse('2026-06-15T10:10:00.000Z'));
    expect(earliest).toBe(Date.parse('2026-06-15T10:00:00.000Z'));
  });

  it('keeps the journey-ID tuple winner when participant and journey input order is shuffled', () => {
    const dest = 'place:meet';
    const selected = selectArriveTogetherJourneys(
      new Map([
        [
          'c',
          [
            j('C-late', 'c', dest, 10, 0, '2026-06-15T09:58:00.000Z', '2026-06-15T10:08:00.000Z'),
            j('Cz-early', 'c', dest, 10, 0, '2026-06-15T09:52:00.000Z', '2026-06-15T10:02:00.000Z'),
          ],
        ],
        ['b', [j('B', 'b', dest, 100, 0, '2026-06-15T09:10:00.000Z', '2026-06-15T10:10:00.000Z')]],
        ['a', [j('A', 'a', dest, 100, 0, '2026-06-15T09:00:00.000Z', '2026-06-15T10:00:00.000Z')]],
      ]),
    );
    expect(selected.find((row) => row.participantId === 'c')?.journeyId).toBe('C-late');
    expect(selectedIdsInParticipantOrder(selected)).toEqual(['A', 'B', 'C-late']);
  });

  it('prefers lower total duration inside the same minimum arrival spread', () => {
    const dest = 'place:meet';
    const selected = selectArriveTogetherJourneys(
      journeysByParticipant([
        [
          j('A-fast', 'a', dest, 40, 0, '2026-06-15T10:00:00.000Z', '2026-06-15T10:40:00.000Z'),
          j('A-slow', 'a', dest, 90, 0, '2026-06-15T10:00:00.000Z', '2026-06-15T10:40:00.000Z'),
        ],
        [j('B', 'b', dest, 40, 0, '2026-06-15T10:05:00.000Z', '2026-06-15T10:45:00.000Z')],
      ]),
    );
    expect(selected.find((row) => row.participantId === 'a')?.journeyId).toBe('A-fast');
    expect(selected.reduce((sum, row) => sum + row.durationMinutes, 0)).toBe(80);
  });

  it('uses total transfers after equal spread and total duration', () => {
    const dest = 'place:meet';
    const selected = selectArriveTogetherJourneys(
      journeysByParticipant([
        [j('A', 'a', dest, 30, 0, '2026-06-15T10:00:00.000Z', '2026-06-15T10:30:00.000Z')],
        [
          j('B-hi', 'b', dest, 30, 2, '2026-06-15T10:00:00.000Z', '2026-06-15T10:30:00.000Z'),
          j('B-lo', 'b', dest, 30, 0, '2026-06-15T10:00:00.000Z', '2026-06-15T10:30:00.000Z'),
        ],
      ]),
    );
    expect(selected.find((row) => row.participantId === 'b')?.journeyId).toBe('B-lo');
    expect(selected.reduce((sum, row) => sum + row.transfers, 0)).toBe(0);
  });

  it('prefers an earlier latest arrival after equal spread, duration, and transfers', () => {
    const dest = 'place:meet';
    const selected = selectArriveTogetherJourneys(
      journeysByParticipant([
        [
          j('A-early', 'a', dest, 30, 0, '2026-06-15T10:00:00.000Z', '2026-06-15T10:20:00.000Z'),
          j('A-late', 'a', dest, 30, 0, '2026-06-15T10:00:00.000Z', '2026-06-15T10:40:00.000Z'),
        ],
        [j('B', 'b', dest, 30, 0, '2026-06-15T10:05:00.000Z', '2026-06-15T10:30:00.000Z')],
      ]),
    );
    expect(selected.find((row) => row.participantId === 'a')?.journeyId).toBe('A-early');
    expect(Math.max(...selected.map((row) => row.arrivalAt.getTime()))).toBe(
      Date.parse('2026-06-15T10:30:00.000Z'),
    );
  });

  it('orders journey-set comparator by arrivalPenalty then maxDuration (not earliestArrival)', async () => {
    const source = await import('node:fs').then((fs) =>
      fs.readFileSync(new URL('./journey-selection.ts', import.meta.url), 'utf8'),
    );
    const penaltyIdx = source.indexOf('candidate.arrivalPenalty < best.arrivalPenalty');
    const maxDurIdx = source.indexOf('candidate.maxDuration < best.maxDuration');
    const spreadIdx = source.indexOf('candidate.spread < best.spread');
    const tupleIdx = source.indexOf(
      'compareJourneyIdTuples(candidate.journeyIds, best.journeyIds)',
    );
    expect(penaltyIdx).toBeGreaterThan(-1);
    expect(maxDurIdx).toBeGreaterThan(penaltyIdx);
    expect(spreadIdx).toBeGreaterThan(maxDurIdx);
    expect(tupleIdx).toBeGreaterThan(spreadIdx);
    expect(source).not.toContain('candidate.earliestArrival < best.earliestArrival');
  });

  it('selects the element-wise journey-ID tuple winner for prefix-related IDs', () => {
    const dest = 'place:meet';
    // Joined with "|" would prefer ["aa","a"] over ["a","z"] (WRONG).
    expect('a|z' < 'aa|a').toBe(false);
    expect(compareJourneyIdTuples(['a', 'z'], ['aa', 'a'])).toBeLessThan(0);

    const selected = selectArriveTogetherJourneys(
      journeysByParticipant([
        [
          j('aa', 'a', dest, 30, 0, '2026-06-15T10:00:00.000Z', '2026-06-15T10:30:00.000Z'),
          j('a', 'a', dest, 30, 0, '2026-06-15T10:00:00.000Z', '2026-06-15T10:30:00.000Z'),
        ],
        [j('z', 'b', dest, 30, 0, '2026-06-15T10:00:00.000Z', '2026-06-15T10:30:00.000Z')],
      ]),
    );
    expect(selectedIdsInParticipantOrder(selected)).toEqual(['a', 'z']);
  });

  it('uses participant-ordered journey-ID tuple when all higher keys tie', () => {
    const dest = 'place:meet';
    const selected = selectArriveTogetherJourneys(
      journeysByParticipant([
        [
          j('a-z', 'a', dest, 30, 0, '2026-06-15T10:00:00.000Z', '2026-06-15T10:30:00.000Z'),
          j('a-a', 'a', dest, 30, 0, '2026-06-15T10:00:00.000Z', '2026-06-15T10:30:00.000Z'),
        ],
        [j('b-1', 'b', dest, 30, 0, '2026-06-15T10:00:00.000Z', '2026-06-15T10:30:00.000Z')],
      ]),
    );
    expect(selectedIdsInParticipantOrder(selected)).toEqual(['a-a', 'b-1']);
  });

  it('does not contain Cartesian combination enumeration', async () => {
    const source = await import('node:fs').then((fs) =>
      fs.readFileSync(new URL('./journey-selection.ts', import.meta.url), 'utf8'),
    );
    expect(source).not.toContain('forEachWindowCombination');
    expect(source).not.toMatch(/walk\s*=\s*\(index/);
    expect(source).toContain('compareJourneyIdTuples');
    expect(source).not.toMatch(/journeyIdsKey|join\(['"]\\0['"]\)/);
  });
});

describe('compareJourneyIdTuples', () => {
  it('orders prefix-related tuples by the first differing element', () => {
    expect(compareJourneyIdTuples(['a', 'z'], ['aa', 'a'])).toBeLessThan(0);
    expect(compareJourneyIdTuples(['aa', 'a'], ['a', 'z'])).toBeGreaterThan(0);
    expect(compareJourneyIdTuples(['a', 'z'], ['a', 'z'])).toBe(0);
  });
});
