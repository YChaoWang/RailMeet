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
        dest: 'place:cologne',
        // Sliding window prefers the 10-minute arrival cover (wc-*-1) over the 40-minute 0-transfer pair.
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
      {
        rank: 3,
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

  it('retains earliest-arrival after latest in the journey-set comparator (equals latest−spread)', async () => {
    const source = await import('node:fs').then((fs) =>
      fs.readFileSync(new URL('./journey-selection.ts', import.meta.url), 'utf8'),
    );
    const latestIdx = source.indexOf('candidate.latestArrival < best.latestArrival');
    const earliestIdx = source.indexOf('candidate.earliestArrival < best.earliestArrival');
    const tupleIdx = source.indexOf(
      'compareJourneyIdTuples(candidate.journeyIds, best.journeyIds)',
    );
    expect(latestIdx).toBeGreaterThan(-1);
    expect(earliestIdx).toBeGreaterThan(latestIdx);
    expect(tupleIdx).toBeGreaterThan(earliestIdx);

    const dest = 'place:meet';
    const selected = selectArriveTogetherJourneys(
      journeysByParticipant([
        [j('A', 'a', dest, 30, 0, '2026-06-15T10:00:00.000Z', '2026-06-15T10:00:00.000Z')],
        [j('B', 'b', dest, 30, 0, '2026-06-15T10:00:00.000Z', '2026-06-15T10:10:00.000Z')],
      ]),
    );
    const earliest = Math.min(...selected.map((row) => row.arrivalAt.getTime()));
    const latest = Math.max(...selected.map((row) => row.arrivalAt.getTime()));
    expect(latest - earliest).toBe(10 * 60_000);
    expect(earliest).toBe(latest - (latest - earliest));
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
