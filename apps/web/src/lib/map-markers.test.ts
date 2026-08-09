import type { MeetingSearchDetailData, MeetingSearchResultsData } from '@railmeet/validation';
import { describe, expect, it } from 'vitest';

import { buildMapScene, candidateSelectionKey } from './map-markers';
import { encodeEncodedPolyline } from './polyline';

const summary = {
  searchId: '44444444-4444-4444-8444-444444444444',
  status: 'completed',
  travelDate: '2026-06-15',
  earliestDepartureTime: '08:00',
  latestArrivalTime: '22:00',
  arrivalDayOffset: 0,
  maxJourneyDurationMinutes: 480,
  maxTransfers: 2,
  minTransferDurationMinutes: 5,
  rankingMode: 'fairest',
  participants: [
    {
      id: 'p1',
      displayName: 'Alex',
      origin: { placeId: 'place:berlin', name: 'Berlin', longitude: 13.4, latitude: 52.52 },
    },
    {
      id: 'p2',
      displayName: 'Blake',
      origin: { placeId: 'place:paris', name: 'Paris', longitude: 2.35, latitude: 48.85 },
    },
  ],
  allowedTransportModes: ['train'],
  allowedCountryCodes: [],
  createdAt: '2026-06-01T12:00:00.000Z',
  updatedAt: '2026-06-01T12:00:00.000Z',
  startedAt: null,
  completedAt: '2026-06-01T12:05:00.000Z',
  failedAt: null,
  completionOutcome: 'ranked',
  failureCode: null,
  recommendedDestination: null,
} as MeetingSearchDetailData;

const berlinToMunich = encodeEncodedPolyline(
  [
    [13.4, 52.52],
    [12.0, 50.0],
    [11.58, 48.13],
  ],
  6,
);

const results = {
  searchId: summary.searchId,
  status: 'completed',
  completionOutcome: 'ranked',
  rankingMode: 'fairest',
  recommendedDestination: {
    placeId: 'place:munich',
    name: 'Munich',
    longitude: 11.58,
    latitude: 48.13,
  },
  rankings: [
    {
      rankingMode: 'fairest',
      rank: 1,
      destination: {
        placeId: 'place:munich',
        name: 'Munich',
        longitude: 11.58,
        latitude: 48.13,
      },
      recommended: true,
      totalDurationMinutes: 100,
      maxDurationMinutes: 60,
      durationRangeMinutes: 10,
      totalTransfers: 1,
      maxTransfers: 1,
      earliestArrivalAt: '2026-06-15T10:00:00.000Z',
      latestArrivalAt: '2026-06-15T10:10:00.000Z',
      arrivalSpreadMs: 600_000,
      journeys: [
        {
          participantId: 'p1',
          participantDisplayName: 'Alex',
          participantPosition: 0,
          origin: { placeId: 'place:berlin', name: 'Berlin', longitude: 13.4, latitude: 52.52 },
          destination: {
            placeId: 'place:munich',
            name: 'Munich',
            longitude: 11.58,
            latitude: 48.13,
          },
          departureAt: '2026-06-15T08:00:00.000Z',
          arrivalAt: '2026-06-15T10:00:00.000Z',
          durationMinutes: 120,
          transfers: 0,
          transportModes: ['train'],
          legs: [
            {
              mode: 'train',
              departureAt: '2026-06-15T08:00:00.000Z',
              arrivalAt: '2026-06-15T10:00:00.000Z',
              durationMinutes: 120,
              geometry: { points: berlinToMunich, precision: 6, length: 3 },
            },
            {
              mode: 'walk',
              departureAt: '2026-06-15T10:00:00.000Z',
              arrivalAt: '2026-06-15T10:05:00.000Z',
              durationMinutes: 5,
              geometry: null,
            },
          ],
        },
      ],
    },
  ],
} as MeetingSearchResultsData;

const parisToMunich = encodeEncodedPolyline(
  [
    [2.35, 48.85],
    [11.58, 48.13],
  ],
  6,
);

const multiResults = {
  ...results,
  rankings: [
    results.rankings[0]!,
    {
      rankingMode: 'fairest',
      rank: 2,
      destination: {
        placeId: 'place:cologne',
        name: 'Cologne',
        longitude: 6.96,
        latitude: 50.94,
      },
      recommended: false,
      totalDurationMinutes: 200,
      maxDurationMinutes: 120,
      durationRangeMinutes: 20,
      totalTransfers: 0,
      maxTransfers: 0,
      earliestArrivalAt: '2026-06-15T12:00:00.000Z',
      latestArrivalAt: '2026-06-15T12:00:00.000Z',
      arrivalSpreadMs: 0,
      journeys: [
        {
          participantId: 'p1',
          participantDisplayName: 'Alex',
          participantPosition: 0,
          origin: { placeId: 'place:berlin', name: 'Berlin', longitude: 13.4, latitude: 52.52 },
          destination: {
            placeId: 'place:cologne',
            name: 'Cologne',
            longitude: 6.96,
            latitude: 50.94,
          },
          departureAt: '2026-06-15T08:00:00.000Z',
          arrivalAt: '2026-06-15T12:00:00.000Z',
          durationMinutes: 240,
          transfers: 0,
          transportModes: ['train'],
          legs: [
            {
              mode: 'train',
              departureAt: '2026-06-15T08:00:00.000Z',
              arrivalAt: '2026-06-15T12:00:00.000Z',
              durationMinutes: 240,
              geometry: {
                points: encodeEncodedPolyline(
                  [
                    [13.4, 52.52],
                    [6.96, 50.94],
                  ],
                  6,
                ),
                precision: 6,
                length: 2,
              },
            },
          ],
        },
        {
          participantId: 'p2',
          participantDisplayName: 'Blake',
          participantPosition: 1,
          origin: { placeId: 'place:paris', name: 'Paris', longitude: 2.35, latitude: 48.85 },
          destination: {
            placeId: 'place:cologne',
            name: 'Cologne',
            longitude: 6.96,
            latitude: 50.94,
          },
          departureAt: '2026-06-15T09:00:00.000Z',
          arrivalAt: '2026-06-15T12:00:00.000Z',
          durationMinutes: 180,
          transfers: 0,
          transportModes: ['train'],
          legs: [
            {
              mode: 'train',
              departureAt: '2026-06-15T09:00:00.000Z',
              arrivalAt: '2026-06-15T12:00:00.000Z',
              durationMinutes: 180,
              geometry: { points: parisToMunich, precision: 6, length: 2 },
            },
          ],
        },
      ],
    },
  ],
} as MeetingSearchResultsData;

describe('buildMapScene routes', () => {
  it('renders only the selected candidate’s real geometry and notes missing segments', () => {
    const selected = candidateSelectionKey('fairest', 1, 'place:munich');
    const scene = buildMapScene({
      summary,
      results,
      rankingMode: 'fairest',
      selectedKey: selected,
    });

    expect(scene.routeLines).toHaveLength(1);
    expect(scene.routeLines[0]?.style).toBe('transit');
    expect(scene.routeLines[0]?.coordinates.length).toBeGreaterThanOrEqual(2);
    expect(scene.routeLines[0]?.coordinates[0]?.[0]).toBeCloseTo(13.4, 1);
    expect(scene.missingGeometry).toEqual([{ participantId: 'p1', legIndex: 1, mode: 'walk' }]);
    // No fabricated straight line for the missing walk leg.
    expect(scene.routeLines.some((line) => line.legIndex === 1)).toBe(false);
  });

  it('keeps routeLines empty when no candidate is selected', () => {
    const scene = buildMapScene({
      summary,
      results,
      rankingMode: 'fairest',
      selectedKey: null,
    });
    expect(scene.routeLines).toEqual([]);
  });

  it('switches visible routes with candidate selection and never mixes candidates', () => {
    const munich = candidateSelectionKey('fairest', 1, 'place:munich');
    const cologne = candidateSelectionKey('fairest', 2, 'place:cologne');

    const munichScene = buildMapScene({
      summary,
      results: multiResults,
      rankingMode: 'fairest',
      selectedKey: munich,
    });
    expect(munichScene.routeLines.every((line) => line.id.includes('place:munich'))).toBe(true);
    expect(munichScene.routeLines.some((line) => line.id.includes('place:cologne'))).toBe(false);

    const cologneScene = buildMapScene({
      summary,
      results: multiResults,
      rankingMode: 'fairest',
      selectedKey: cologne,
    });
    expect(cologneScene.routeLines).toHaveLength(2);
    expect(cologneScene.routeLines.map((line) => line.participantId).sort()).toEqual(['p1', 'p2']);
    expect(cologneScene.routeLines.every((line) => line.id.includes('place:cologne'))).toBe(true);
  });

  it('dims non-emphasized traveler routes without dropping them', () => {
    const selected = candidateSelectionKey('fairest', 2, 'place:cologne');
    const scene = buildMapScene({
      summary,
      results: multiResults,
      rankingMode: 'fairest',
      selectedKey: selected,
      emphasizedParticipantId: 'p2',
    });
    expect(scene.routeLines).toHaveLength(2);
    expect(scene.routeLines.find((line) => line.participantId === 'p2')?.emphasized).toBe(true);
    expect(scene.routeLines.find((line) => line.participantId === 'p1')?.emphasized).toBe(false);
  });
});
