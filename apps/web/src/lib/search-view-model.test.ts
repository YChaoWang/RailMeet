import { describe, expect, it } from 'vitest';
import type { MeetingSearchResultsData } from '@railmeet/validation';
import type { SearchStatus } from '@railmeet/shared';

import {
  assertLifecycleHelpersAligned,
  decideSummaryPollAction,
  emptyOutcomeMessage,
  failureMessage,
  isUuid,
  rankingsForMode,
} from './search-view-model';

const sampleResults = {
  searchId: '44444444-4444-4444-8444-444444444444',
  status: 'completed',
  completionOutcome: 'ranked',
  rankingMode: 'fairest',
  recommendedDestination: { placeId: 'place:munich', name: 'Munich' },
  rankings: [
    {
      rankingMode: 'fairest',
      rank: 1,
      destination: { placeId: 'place:munich', name: 'Munich' },
      recommended: true,
      totalDurationMinutes: 100,
      maxDurationMinutes: 60,
      durationRangeMinutes: 20,
      totalTransfers: 1,
      maxTransfers: 1,
      earliestArrivalAt: '2026-06-15T10:00:00.000Z',
      latestArrivalAt: '2026-06-15T10:20:00.000Z',
      arrivalSpreadMs: 1_200_000,
      journeys: [
        {
          participantId: 'a',
          participantDisplayName: 'A',
          participantPosition: 0,
          origin: { placeId: 'place:berlin', name: 'Berlin' },
          destination: { placeId: 'place:munich', name: 'Munich' },
          departureAt: '2026-06-15T08:00:00.000Z',
          arrivalAt: '2026-06-15T10:00:00.000Z',
          durationMinutes: 50,
          transfers: 0,
          transportModes: ['train'],
          legs: [],
        },
        {
          participantId: 'b',
          participantDisplayName: 'B',
          participantPosition: 1,
          origin: { placeId: 'place:paris', name: 'Paris' },
          destination: { placeId: 'place:munich', name: 'Munich' },
          departureAt: '2026-06-15T08:00:00.000Z',
          arrivalAt: '2026-06-15T10:20:00.000Z',
          durationMinutes: 50,
          transfers: 1,
          transportModes: ['train'],
          legs: [
            {
              mode: 'train',
              departureAt: '2026-06-15T08:00:00.000Z',
              arrivalAt: '2026-06-15T10:20:00.000Z',
              durationMinutes: 50,
              geometry: null,
            },
          ],
        },
      ],
    },
    {
      rankingMode: 'fairest',
      rank: 2,
      destination: { placeId: 'place:cologne', name: 'Cologne' },
      recommended: false,
      totalDurationMinutes: 140,
      maxDurationMinutes: 80,
      durationRangeMinutes: 30,
      totalTransfers: 2,
      maxTransfers: 2,
      earliestArrivalAt: '2026-06-15T11:00:00.000Z',
      latestArrivalAt: '2026-06-15T11:30:00.000Z',
      arrivalSpreadMs: 1_800_000,
      journeys: [],
    },
  ],
} as MeetingSearchResultsData;

describe('search view model', () => {
  it('classifies every lifecycle status exhaustively', () => {
    expect(() => assertLifecycleHelpersAligned()).not.toThrow();
    const statuses: SearchStatus[] = [
      'queued',
      'running',
      'partially-completed',
      'completed',
      'failed',
      'cancelling',
      'cancelled',
    ];
    expect(statuses.map((status) => decideSummaryPollAction(status).action)).toEqual([
      'poll',
      'poll',
      'poll',
      'fetch_results',
      'stop_failed',
      'poll',
      'stop_cancelled',
    ]);
  });

  it('keeps server ranking and participant order without client re-sorting', () => {
    const shuffledInput = {
      ...sampleResults,
      rankings: [sampleResults.rankings[1]!, sampleResults.rankings[0]!],
    };
    const fairest = rankingsForMode(shuffledInput, 'fairest');
    expect(fairest.map((row) => row.destination.placeId)).toEqual([
      'place:cologne',
      'place:munich',
    ]);
    expect(fairest.map((row) => row.rank)).toEqual([2, 1]);
    expect(fairest[1]?.journeys.map((journey) => journey.participantId)).toEqual(['a', 'b']);
  });

  it('maps empty outcomes and failure codes safely', () => {
    expect(emptyOutcomeMessage('no_candidates')).toContain('No meeting cities');
    expect(emptyOutcomeMessage('no_feasible_candidates')).toContain('No destination');
    expect(failureMessage('ROUTING_TECHNICAL_FAILURE')).toContain('Journey planning');
    expect(isUuid('44444444-4444-4444-8444-444444444444')).toBe(true);
    expect(isUuid('not-a-uuid')).toBe(false);
  });
});
