import { describe, expect, it } from 'vitest';

import { evaluateCandidateFeasibility } from './feasibility.js';
import type { RankingJourneyInput, RankingRoutingWorkInput } from './ranking-types.js';

function journey(
  overrides: Partial<RankingJourneyInput> &
    Pick<RankingJourneyInput, 'journeyId' | 'participantId' | 'destinationPlaceId'>,
): RankingJourneyInput {
  return {
    durationMinutes: 120,
    transfers: 0,
    departureAt: new Date('2026-06-15T08:00:00.000Z'),
    arrivalAt: new Date('2026-06-15T10:00:00.000Z'),
    ...overrides,
  };
}

function work(
  overrides: Partial<RankingRoutingWorkInput> &
    Pick<RankingRoutingWorkInput, 'routingWorkId' | 'participantId' | 'destinationPlaceId'>,
): RankingRoutingWorkInput {
  return {
    status: 'succeeded',
    journeys: [
      journey({
        journeyId: `${overrides.routingWorkId}-j0`,
        participantId: overrides.participantId,
        destinationPlaceId: overrides.destinationPlaceId,
      }),
    ],
    ...overrides,
  };
}

describe('evaluateCandidateFeasibility', () => {
  it('marks all participants reachable as feasible', () => {
    const result = evaluateCandidateFeasibility({
      participantIds: ['b', 'a'],
      candidates: [{ candidateId: 'place:munich', destinationPlaceId: 'place:munich', ordinal: 0 }],
      routingWork: [
        work({
          routingWorkId: 'w-a',
          participantId: 'a',
          destinationPlaceId: 'place:munich',
        }),
        work({
          routingWorkId: 'w-b',
          participantId: 'b',
          destinationPlaceId: 'place:munich',
        }),
      ],
    });
    expect(result).toEqual([{ destinationPlaceId: 'place:munich', feasibility: 'feasible' }]);
  });

  it('marks one participant with no_journeys as participant_no_journeys', () => {
    const result = evaluateCandidateFeasibility({
      participantIds: ['a', 'b'],
      candidates: [{ candidateId: 'place:munich', destinationPlaceId: 'place:munich', ordinal: 0 }],
      routingWork: [
        work({
          routingWorkId: 'w-a',
          participantId: 'a',
          destinationPlaceId: 'place:munich',
        }),
        work({
          routingWorkId: 'w-b',
          participantId: 'b',
          destinationPlaceId: 'place:munich',
          status: 'no_journeys',
          journeys: [],
        }),
      ],
    });
    expect(result[0]?.feasibility).toBe('participant_no_journeys');
  });

  it('marks missing participant × candidate work as invariant_violation', () => {
    const result = evaluateCandidateFeasibility({
      participantIds: ['a', 'b'],
      candidates: [{ candidateId: 'place:munich', destinationPlaceId: 'place:munich', ordinal: 0 }],
      routingWork: [
        work({
          routingWorkId: 'w-a',
          participantId: 'a',
          destinationPlaceId: 'place:munich',
        }),
      ],
    });
    expect(result[0]?.feasibility).toBe('invariant_violation');
  });

  it('marks succeeded work with zero journeys as invariant_violation', () => {
    const result = evaluateCandidateFeasibility({
      participantIds: ['a'],
      candidates: [{ candidateId: 'place:munich', destinationPlaceId: 'place:munich', ordinal: 0 }],
      routingWork: [
        work({
          routingWorkId: 'w-a',
          participantId: 'a',
          destinationPlaceId: 'place:munich',
          journeys: [],
        }),
      ],
    });
    expect(result[0]?.feasibility).toBe('invariant_violation');
  });

  it('returns an empty evaluation list when there are no candidates', () => {
    const result = evaluateCandidateFeasibility({
      participantIds: ['a', 'b'],
      candidates: [],
      routingWork: [],
    });
    expect(result).toEqual([]);
  });

  it('marks every candidate infeasible when each has a no_journeys participant', () => {
    const result = evaluateCandidateFeasibility({
      participantIds: ['a', 'b'],
      candidates: [
        { candidateId: 'place:munich', destinationPlaceId: 'place:munich', ordinal: 0 },
        { candidateId: 'place:cologne', destinationPlaceId: 'place:cologne', ordinal: 1 },
      ],
      routingWork: [
        work({
          routingWorkId: 'w1',
          participantId: 'a',
          destinationPlaceId: 'place:munich',
        }),
        work({
          routingWorkId: 'w2',
          participantId: 'b',
          destinationPlaceId: 'place:munich',
          status: 'no_journeys',
          journeys: [],
        }),
        work({
          routingWorkId: 'w3',
          participantId: 'a',
          destinationPlaceId: 'place:cologne',
          status: 'no_journeys',
          journeys: [],
        }),
        work({
          routingWorkId: 'w4',
          participantId: 'b',
          destinationPlaceId: 'place:cologne',
        }),
      ],
    });
    expect(result.every((row) => row.feasibility === 'participant_no_journeys')).toBe(true);
  });
});
