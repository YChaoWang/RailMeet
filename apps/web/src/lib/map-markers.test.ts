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
          journeyId: '00000001-aaaa-4aaa-8aaa-000000000001',
          routeSummary: [{ mode: 'RAIL', displayName: 'ICE' }],
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
          journeyId: '00000002-aaaa-4aaa-8aaa-000000000002',
          routeSummary: [{ mode: 'RAIL', displayName: 'ICE' }],
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
          journeyId: '00000003-aaaa-4aaa-8aaa-000000000003',
          routeSummary: [{ mode: 'RAIL', displayName: 'ICE' }],
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
          journeyId: '00000004-aaaa-4aaa-8aaa-000000000004',
          routeSummary: [{ mode: 'RAIL', displayName: 'ICE' }],
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
          journeyId: '00000005-aaaa-4aaa-8aaa-000000000005',
          routeSummary: [{ mode: 'RAIL', displayName: 'ICE' }],
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

const BERLIN: [number, number] = [13.369548, 52.525589];
const ERFURT: [number, number] = [11.038, 50.972];
const NUREMBERG: [number, number] = [11.082, 49.446];
const MUNICH: [number, number] = [11.5583, 48.1402];
const HAMBURG: [number, number] = [10.0068, 53.5528];

function geometry(points: readonly [number, number][]) {
  return { points: encodeEncodedPolyline(points, 6), precision: 6, length: points.length };
}

const transitSummary = {
  ...summary,
  participants: [
    {
      id: 'p1',
      displayName: 'Alex',
      origin: { placeId: 'place:berlin', name: 'Berlin', longitude: BERLIN[0], latitude: BERLIN[1] },
    },
    {
      id: 'p2',
      displayName: 'Blake',
      origin: {
        placeId: 'place:hamburg',
        name: 'Hamburg',
        longitude: HAMBURG[0],
        latitude: HAMBURG[1],
      },
    },
  ],
} as MeetingSearchDetailData;

/**
 * Two travelers meeting in Munich. Alex walks, rides a colored ICE with a named
 * and an unnamed-coordinate intermediate stop, then a colored metro. Blake rides
 * a colored ICE and then a regional train the feed publishes no color for, and
 * transfers at the same station as Alex.
 */
const transitResults = {
  ...results,
  rankings: [
    {
      ...results.rankings[0]!,
      destination: {
        placeId: 'place:munich',
        name: 'Munich',
        longitude: MUNICH[0],
        latitude: MUNICH[1],
      },
      journeys: [
        {
          journeyId: '00000011-aaaa-4aaa-8aaa-000000000011',
          routeSummary: [],
          participantId: 'p1',
          participantDisplayName: 'Alex',
          participantPosition: 0,
          origin: {
            placeId: 'place:berlin',
            name: 'Berlin',
            longitude: BERLIN[0],
            latitude: BERLIN[1],
          },
          destination: {
            placeId: 'place:munich',
            name: 'Munich',
            longitude: MUNICH[0],
            latitude: MUNICH[1],
          },
          departureAt: '2026-06-15T07:50:00.000Z',
          arrivalAt: '2026-06-15T10:40:00.000Z',
          durationMinutes: 170,
          transfers: 1,
          transportModes: ['walk', 'train', 'metro'],
          legs: [
            {
              mode: 'walk',
              motisMode: 'WALK',
              departureAt: '2026-06-15T07:50:00.000Z',
              arrivalAt: '2026-06-15T08:00:00.000Z',
              durationMinutes: 10,
              geometry: geometry([
                [13.37, 52.526],
                BERLIN,
              ]),
              from: { name: 'START', longitude: 13.37, latitude: 52.526 },
              to: { name: 'Berlin Hbf', longitude: BERLIN[0], latitude: BERLIN[1] },
            },
            {
              mode: 'train',
              motisMode: 'HIGHSPEED_RAIL',
              displayName: 'ICE 1007',
              tripShortName: 'ICE 1007',
              agencyName: 'DB Fernverkehr AG',
              headsign: 'München Hbf',
              routeColor: '#09a4ec',
              departureAt: '2026-06-15T08:00:00.000Z',
              arrivalAt: '2026-06-15T10:00:00.000Z',
              durationMinutes: 120,
              geometry: geometry([BERLIN, ERFURT, NUREMBERG]),
              from: { name: 'Berlin Hbf', longitude: BERLIN[0], latitude: BERLIN[1] },
              to: { name: 'Nürnberg Hbf', track: '7', longitude: NUREMBERG[0], latitude: NUREMBERG[1] },
              intermediateStopCount: 2,
              intermediateStops: [
                {
                  name: 'Erfurt Hbf',
                  longitude: ERFURT[0],
                  latitude: ERFURT[1],
                  arrivalAt: '2026-06-15T09:00:00.000Z',
                  departureAt: '2026-06-15T09:02:00.000Z',
                },
                { name: 'Bamberg' },
              ],
            },
            {
              mode: 'metro',
              motisMode: 'SUBWAY',
              displayName: 'U2',
              agencyName: 'VAG',
              routeColor: 'e30613',
              departureAt: '2026-06-15T10:10:00.000Z',
              arrivalAt: '2026-06-15T10:40:00.000Z',
              durationMinutes: 30,
              geometry: geometry([NUREMBERG, MUNICH]),
              from: { name: 'Nürnberg Hbf', longitude: NUREMBERG[0], latitude: NUREMBERG[1] },
              to: { name: 'München Hbf', longitude: MUNICH[0], latitude: MUNICH[1] },
            },
          ],
        },
        {
          journeyId: '00000012-aaaa-4aaa-8aaa-000000000012',
          routeSummary: [],
          participantId: 'p2',
          participantDisplayName: 'Blake',
          participantPosition: 1,
          origin: {
            placeId: 'place:hamburg',
            name: 'Hamburg',
            longitude: HAMBURG[0],
            latitude: HAMBURG[1],
          },
          destination: {
            placeId: 'place:munich',
            name: 'Munich',
            longitude: MUNICH[0],
            latitude: MUNICH[1],
          },
          departureAt: '2026-06-15T07:00:00.000Z',
          arrivalAt: '2026-06-15T10:35:00.000Z',
          durationMinutes: 215,
          transfers: 1,
          transportModes: ['train'],
          legs: [
            {
              mode: 'train',
              motisMode: 'HIGHSPEED_RAIL',
              displayName: 'ICE 599',
              agencyName: 'DB Fernverkehr AG',
              routeColor: '#09a4ec',
              departureAt: '2026-06-15T07:00:00.000Z',
              arrivalAt: '2026-06-15T09:50:00.000Z',
              durationMinutes: 170,
              geometry: geometry([HAMBURG, NUREMBERG]),
              from: { name: 'Hamburg Hbf', longitude: HAMBURG[0], latitude: HAMBURG[1] },
              to: { name: 'Nürnberg Hbf', longitude: NUREMBERG[0], latitude: NUREMBERG[1] },
            },
            {
              mode: 'train',
              motisMode: 'REGIONAL_RAIL',
              displayName: 'RE 1',
              agencyName: 'DB Regio',
              departureAt: '2026-06-15T10:05:00.000Z',
              arrivalAt: '2026-06-15T10:35:00.000Z',
              durationMinutes: 30,
              geometry: geometry([NUREMBERG, MUNICH]),
              from: { name: 'Nürnberg Hbf', longitude: NUREMBERG[0], latitude: NUREMBERG[1] },
              to: { name: 'München Hbf', longitude: MUNICH[0], latitude: MUNICH[1] },
            },
          ],
        },
      ],
    },
  ],
} as MeetingSearchResultsData;

const transitSelectionKey = candidateSelectionKey('fairest', 1, 'place:munich');

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

  it('paints transit legs with the Transitous route color, never the traveler color', () => {
    const scene = buildMapScene({
      summary: transitSummary,
      results: transitResults,
      rankingMode: 'fairest',
      selectedKey: transitSelectionKey,
    });
    const p1 = scene.routeLines.filter((line) => line.participantId === 'p1');
    expect(p1.map((line) => line.color)).toEqual(['#6b7280', '#09a4ec', '#e30613']);
    expect(p1.map((line) => line.colorSource)).toEqual([
      'mode-fallback',
      'provider',
      'provider',
    ]);
    expect(p1.map((line) => line.serviceLabel)).toEqual(['Walk', 'ICE 1007', 'U2']);
    for (const line of scene.routeLines) {
      expect(line.color).not.toBe(travelerColorAt(line.participantPosition));
    }
  });

  it('falls back to the MOTIS mode color and flags it when the feed publishes none', () => {
    const scene = buildMapScene({
      summary: transitSummary,
      results: transitResults,
      rankingMode: 'fairest',
      selectedKey: transitSelectionKey,
    });
    const uncolored = scene.routeLines.find(
      (line) => line.participantId === 'p2' && line.motisMode === 'REGIONAL_RAIL',
    );
    expect(uncolored?.color).toBe('#f44336');
    expect(uncolored?.colorSource).toBe('mode-fallback');
  });

  it('draws walking legs in neutral gray with the walk style', () => {
    const scene = buildMapScene({
      summary: transitSummary,
      results: transitResults,
      rankingMode: 'fairest',
      selectedKey: transitSelectionKey,
    });
    const walks = scene.routeLines.filter((line) => line.style === 'walk');
    expect(walks.length).toBeGreaterThan(0);
    for (const walk of walks) {
      expect(walk.color).toBe('#6b7280');
    }
  });

  it('builds origin-station, intermediate, transfer, and meeting stop markers from provider coords', () => {
    const scene = buildMapScene({
      summary: transitSummary,
      results: transitResults,
      rankingMode: 'fairest',
      selectedKey: transitSelectionKey,
    });
    const stops = scene.markers.filter(
      (marker) => marker.kind === 'stop' && marker.participantId === 'p1',
    );
    expect(stops.map((stop) => (stop.kind === 'stop' ? stop.name : ''))).toEqual([
      'Berlin Hbf',
      'Erfurt Hbf',
      'Nürnberg Hbf',
      'München Hbf',
    ]);
    expect(stops.map((stop) => (stop.kind === 'stop' ? stop.role : ''))).toEqual([
      'origin-station',
      'intermediate',
      'transfer',
      'meeting',
    ]);
    expect(stops.map((stop) => (stop.kind === 'stop' ? stop.labelled : null))).toEqual([
      true,
      false,
      true,
      true,
    ]);
  });

  it('records both services at a train-to-metro transfer', () => {
    const scene = buildMapScene({
      summary: transitSummary,
      results: transitResults,
      rankingMode: 'fairest',
      selectedKey: transitSelectionKey,
    });
    const transfer = scene.markers.find(
      (marker) =>
        marker.kind === 'stop' && marker.participantId === 'p1' && marker.role === 'transfer',
    );
    expect(transfer?.kind === 'stop' && transfer.arrivingService).toBe('ICE 1007');
    expect(transfer?.kind === 'stop' && transfer.departingService).toBe('U2');
    expect(transfer?.kind === 'stop' && transfer.arrivalAt).toBe('2026-06-15T10:00:00.000Z');
    expect(transfer?.kind === 'stop' && transfer.departureAt).toBe('2026-06-15T10:10:00.000Z');
  });

  it('records both services at a train-to-train transfer', () => {
    const scene = buildMapScene({
      summary: transitSummary,
      results: transitResults,
      rankingMode: 'fairest',
      selectedKey: transitSelectionKey,
    });
    const transfer = scene.markers.find(
      (marker) =>
        marker.kind === 'stop' && marker.participantId === 'p2' && marker.role === 'transfer',
    );
    expect(transfer?.kind === 'stop' && transfer.name).toBe('Nürnberg Hbf');
    expect(transfer?.kind === 'stop' && transfer.arrivingService).toBe('ICE 599');
    expect(transfer?.kind === 'stop' && transfer.departingService).toBe('RE 1');
  });

  it('keeps overlapping transfers at one station as distinct per-traveler markers', () => {
    const scene = buildMapScene({
      summary: transitSummary,
      results: transitResults,
      rankingMode: 'fairest',
      selectedKey: transitSelectionKey,
    });
    const nuremberg = scene.markers.filter(
      (marker) => marker.kind === 'stop' && marker.name === 'Nürnberg Hbf',
    );
    expect(nuremberg).toHaveLength(2);
    expect(new Set(nuremberg.map((marker) => marker.id)).size).toBe(2);
    // Both sides of each traveler's transfer collapse into a single marker.
    expect(nuremberg.every((marker) => marker.kind === 'stop' && marker.role === 'transfer')).toBe(
      true,
    );
  });

  it('skips intermediate stops the provider gave no coordinates for', () => {
    const scene = buildMapScene({
      summary: transitSummary,
      results: transitResults,
      rankingMode: 'fairest',
      selectedKey: transitSelectionKey,
    });
    const names = scene.markers
      .filter((marker) => marker.kind === 'stop')
      .map((marker) => (marker.kind === 'stop' ? marker.name : ''));
    expect(names).toContain('Erfurt Hbf');
    expect(names).not.toContain('Bamberg');
    // The count from the provider is still reported on the segment.
    const ice = scene.routeLines.find((line) => line.serviceLabel === 'ICE 1007');
    expect(ice?.intermediateStopCount).toBe(2);
  });

  it('never emits a color the browser would reject', () => {
    const scene = buildMapScene({
      summary: transitSummary,
      results: transitResults,
      rankingMode: 'fairest',
      selectedKey: transitSelectionKey,
    });
    const hex = /^#[0-9a-f]{6}$/;
    for (const line of scene.routeLines) {
      expect(line.color).toMatch(hex);
      expect(line.textColor).toMatch(hex);
    }
    for (const marker of scene.markers) {
      if (marker.kind === 'stop') {
        expect(marker.color).toMatch(hex);
        expect(marker.textColor).toMatch(hex);
      }
    }
    for (const entry of scene.legend) {
      for (const service of entry.services) {
        expect(service.color).toMatch(hex);
        expect(service.textColor).toMatch(hex);
      }
    }
  });

  it('groups one legend chip per distinct transit service under each traveler', () => {
    const scene = buildMapScene({
      summary: transitSummary,
      results: transitResults,
      rankingMode: 'fairest',
      selectedKey: transitSelectionKey,
    });
    const alex = scene.legend.find((entry) => entry.participantId === 'p1');
    expect(alex?.services.map((service) => service.displayName)).toEqual(['ICE 1007', 'U2']);
    expect(alex?.services.map((service) => service.color)).toEqual(['#09a4ec', '#e30613']);
    expect(alex?.services.map((service) => service.mode)).toEqual(['HIGHSPEED_RAIL', 'SUBWAY']);
    const blake = scene.legend.find((entry) => entry.participantId === 'p2');
    expect(blake?.services.map((service) => service.colorSource)).toEqual([
      'provider',
      'mode-fallback',
    ]);
  });

  it('preserves decoded polyline precision for provider geometry', () => {
    const scene = buildMapScene({
      summary: transitSummary,
      results: transitResults,
      rankingMode: 'fairest',
      selectedKey: transitSelectionKey,
    });
    const ice = scene.routeLines.find((line) => line.serviceLabel === 'ICE 1007');
    expect(ice?.coordinates).toEqual([
      [13.369548, 52.525589],
      [11.038, 50.972],
      [11.082, 49.446],
    ]);
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
