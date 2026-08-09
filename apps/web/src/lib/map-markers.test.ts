import type { MeetingSearchDetailData, MeetingSearchResultsData } from '@railmeet/validation';
import { describe, expect, it } from 'vitest';

import {
  buildDraftOriginScene,
  buildMapScene,
  candidateSelectionKey,
  collectSceneCoordinates,
} from './map-markers';
import { encodeEncodedPolyline } from './polyline';
import { travelerColorAt, travelerLetterAt } from './traveler-identity';

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
    {
      id: 'p3',
      displayName: 'Casey',
      origin: { placeId: 'place:amsterdam', name: 'Amsterdam', longitude: 4.9, latitude: 52.37 },
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

const walkStub = encodeEncodedPolyline(
  [
    [11.58, 48.13],
    [11.581, 48.131],
  ],
  6,
);

const multiResults = {
  ...results,
  rankings: [
    {
      ...results.rankings[0]!,
      journeys: [
        results.rankings[0]!.journeys[0]!,
        {
          participantId: 'p2',
          participantDisplayName: 'Blake',
          participantPosition: 1,
          origin: { placeId: 'place:paris', name: 'Paris', longitude: 2.35, latitude: 48.85 },
          destination: {
            placeId: 'place:munich',
            name: 'Munich',
            longitude: 11.58,
            latitude: 48.13,
          },
          departureAt: '2026-06-15T08:30:00.000Z',
          arrivalAt: '2026-06-15T10:05:00.000Z',
          durationMinutes: 95,
          transfers: 1,
          transportModes: ['train', 'walk'],
          legs: [
            {
              mode: 'train',
              departureAt: '2026-06-15T08:30:00.000Z',
              arrivalAt: '2026-06-15T10:00:00.000Z',
              durationMinutes: 90,
              geometry: { points: parisToMunich, precision: 6, length: 2 },
            },
            {
              mode: 'walk',
              departureAt: '2026-06-15T10:00:00.000Z',
              arrivalAt: '2026-06-15T10:05:00.000Z',
              durationMinutes: 5,
              geometry: { points: walkStub, precision: 6, length: 2 },
            },
          ],
        },
        {
          participantId: 'p3',
          participantDisplayName: 'Casey',
          participantPosition: 2,
          origin: {
            placeId: 'place:amsterdam',
            name: 'Amsterdam',
            longitude: 4.9,
            latitude: 52.37,
          },
          destination: {
            placeId: 'place:munich',
            name: 'Munich',
            longitude: 11.58,
            latitude: 48.13,
          },
          departureAt: '2026-06-15T07:00:00.000Z',
          arrivalAt: '2026-06-15T10:10:00.000Z',
          durationMinutes: 190,
          transfers: 0,
          transportModes: ['train'],
          legs: [
            {
              mode: 'train',
              departureAt: '2026-06-15T07:00:00.000Z',
              arrivalAt: '2026-06-15T10:10:00.000Z',
              durationMinutes: 190,
              geometry: {
                points: encodeEncodedPolyline(
                  [
                    [4.9, 52.37],
                    [11.58, 48.13],
                  ],
                  6,
                ),
                precision: 6,
                length: 2,
              },
            },
          ],
        },
      ],
    },
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

describe('buildDraftOriginScene', () => {
  it('adds one origin marker per selected draft place and never invents routes', () => {
    const scene = buildDraftOriginScene([
      {
        key: 'k1',
        id: 'traveler-1',
        displayName: 'Alex',
        letter: 'A',
        color: travelerColorAt(0),
        originSelected: { name: 'Berlin', latitude: 52.52, longitude: 13.4 },
      },
      {
        key: 'k2',
        id: 'traveler-2',
        displayName: 'Blake',
        letter: 'B',
        color: travelerColorAt(1),
        originSelected: null,
      },
      {
        key: 'k3',
        id: 'traveler-3',
        displayName: 'Casey',
        letter: 'C',
        color: travelerColorAt(2),
        originSelected: { name: 'Paris', latitude: 48.85, longitude: 2.35 },
      },
    ]);

    expect(scene.markers).toHaveLength(2);
    expect(scene.markers.map((marker) => marker.id)).toEqual([
      'draft-origin:k1',
      'draft-origin:k3',
    ]);
    expect(scene.routeLines).toEqual([]);
    expect(scene.markers[0]).toMatchObject({
      kind: 'origin',
      letter: 'A',
      color: travelerColorAt(0),
    });
    expect(scene.markers[1]).toMatchObject({
      kind: 'origin',
      letter: 'C',
      color: travelerColorAt(2),
    });
  });

  it('removes a draft marker when the selection is cleared and updates when replaced', () => {
    const first = buildDraftOriginScene([
      {
        key: 'k1',
        id: 'traveler-1',
        displayName: 'Alex',
        letter: 'A',
        color: travelerColorAt(0),
        originSelected: { name: 'Berlin', latitude: 52.52, longitude: 13.4 },
      },
    ]);
    expect(first.markers).toHaveLength(1);

    const cleared = buildDraftOriginScene([
      {
        key: 'k1',
        id: 'traveler-1',
        displayName: 'Alex',
        letter: 'A',
        color: travelerColorAt(0),
        originSelected: null,
      },
    ]);
    expect(cleared.markers).toHaveLength(0);

    const replaced = buildDraftOriginScene([
      {
        key: 'k1',
        id: 'traveler-1',
        displayName: 'Alex',
        letter: 'A',
        color: travelerColorAt(0),
        originSelected: { name: 'Hamburg', latitude: 53.55, longitude: 9.99 },
      },
    ]);
    expect(replaced.markers).toHaveLength(1);
    expect(replaced.markers[0]).toMatchObject({ longitude: 9.99, latitude: 53.55 });
    expect(replaced.cameraKey).not.toBe(first.cameraKey);
  });

  it('keeps traveler C identity when traveler B is removed from the draft list', () => {
    const withThree = buildDraftOriginScene([
      {
        key: 'ka',
        id: 'a',
        displayName: 'A',
        letter: 'A',
        color: '#0f766e',
        originSelected: { name: 'Paris', latitude: 48.85, longitude: 2.35 },
      },
      {
        key: 'kc',
        id: 'c',
        displayName: 'C',
        letter: 'C',
        color: '#b45309',
        originSelected: { name: 'Berlin', latitude: 52.52, longitude: 13.4 },
      },
    ]);
    expect(
      withThree.markers.map((marker) => (marker.kind === 'origin' ? marker.letter : '')),
    ).toEqual(['A', 'C']);
    const second = withThree.markers[1];
    expect(second?.kind).toBe('origin');
    if (second?.kind === 'origin') {
      expect(second.color).toBe('#b45309');
    }
  });
});

describe('buildMapScene routes', () => {
  it('renders origins, meeting point, and every traveler’s persisted geometry for the selection', () => {
    const selected = candidateSelectionKey('fairest', 1, 'place:munich');
    const scene = buildMapScene({
      summary,
      results: multiResults,
      rankingMode: 'fairest',
      selectedKey: selected,
    });

    expect(scene.markers.filter((marker) => marker.kind === 'origin')).toHaveLength(3);
    expect(scene.markers.some((marker) => marker.kind === 'candidate' && marker.selected)).toBe(
      true,
    );
    expect([...new Set(scene.routeLines.map((line) => line.participantId))].sort()).toEqual([
      'p1',
      'p2',
      'p3',
    ]);
    expect(scene.routeLines.some((line) => line.style === 'walk')).toBe(true);
    expect(scene.routeLines.some((line) => line.style === 'transit')).toBe(true);
    expect(scene.legend.map((entry) => entry.letter)).toEqual(['A', 'B', 'C']);
    expect(scene.legend.map((entry) => entry.displayName)).toEqual(['Alex', 'Blake', 'Casey']);
    expect(scene.legend[0]?.color).toBe(travelerColorAt(0));
    expect(travelerLetterAt(0)).toBe('A');
  });

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
    expect(cologneScene.cameraKey).not.toBe(munichScene.cameraKey);
  });

  it('dims non-emphasized traveler routes without dropping them or changing cameraKey', () => {
    const selected = candidateSelectionKey('fairest', 1, 'place:munich');
    const base = buildMapScene({
      summary,
      results: multiResults,
      rankingMode: 'fairest',
      selectedKey: selected,
    });
    const scene = buildMapScene({
      summary,
      results: multiResults,
      rankingMode: 'fairest',
      selectedKey: selected,
      emphasizedParticipantId: 'p2',
    });
    expect(scene.routeLines.length).toBeGreaterThan(1);
    expect(scene.routeLines.find((line) => line.participantId === 'p2')?.emphasized).toBe(true);
    expect(scene.routeLines.find((line) => line.participantId === 'p1')?.emphasized).toBe(false);
    expect(scene.cameraKey).toBe(base.cameraKey);
  });

  it('restores the same route scene from the same persisted payload (refresh)', () => {
    const selected = candidateSelectionKey('fairest', 1, 'place:munich');
    const first = buildMapScene({
      summary,
      results: multiResults,
      rankingMode: 'fairest',
      selectedKey: selected,
    });
    const second = buildMapScene({
      summary,
      results: structuredClone(multiResults),
      rankingMode: 'fairest',
      selectedKey: selected,
    });
    expect(second.routeLines).toEqual(first.routeLines);
    expect(second.cameraKey).toBe(first.cameraKey);
    expect(second.markers.filter((marker) => marker.kind === 'origin')).toHaveLength(3);
  });

  it('includes every visible marker and route vertex in fitBounds coordinates', () => {
    const selected = candidateSelectionKey('fairest', 1, 'place:munich');
    const scene = buildMapScene({
      summary,
      results: multiResults,
      rankingMode: 'fairest',
      selectedKey: selected,
    });
    const points = collectSceneCoordinates(scene);
    expect(points.some(([lon, lat]) => lon === 13.4 && lat === 52.52)).toBe(true);
    expect(points.some(([lon, lat]) => lon === 2.35 && lat === 48.85)).toBe(true);
    expect(points.some(([lon, lat]) => lon === 4.9 && lat === 52.37)).toBe(true);
    expect(points.some(([lon, lat]) => lon === 11.58 && lat === 48.13)).toBe(true);
    expect(points.length).toBeGreaterThan(scene.markers.length);
  });

  it('attaches traveler and meeting popups for the selected candidate', () => {
    const selected = candidateSelectionKey('fairest', 1, 'place:munich');
    const scene = buildMapScene({
      summary,
      results: multiResults,
      rankingMode: 'fairest',
      selectedKey: selected,
    });
    const origin = scene.markers.find(
      (marker) => marker.kind === 'origin' && marker.participantId === 'p1',
    );
    expect(origin?.kind === 'origin' && origin.popup?.displayName).toBe('Alex');
    expect(origin?.kind === 'origin' && origin.popup?.transfers).toBe(0);
    const meeting = scene.markers.find((marker) => marker.kind === 'candidate' && marker.selected);
    expect(meeting?.kind === 'candidate' && meeting.popup?.name).toBe('Munich');
    expect(meeting?.kind === 'candidate' && meeting.popup?.arrivalSpreadMs).toBe(600_000);
  });
});
