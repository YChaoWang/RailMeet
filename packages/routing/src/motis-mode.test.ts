import { describe, expect, it } from 'vitest';

import {
  collectJourneyTransportModes,
  hasUnmappedTransitLegs,
  mapMotisLegMode,
} from './motis-mode.js';
import { normalizeMotisPlanResponse } from './motis-normalize.js';

describe('mapMotisLegMode', () => {
  it.each([
    ['RAIL', 'regional_rail'],
    ['TRAIN', 'regional_rail'],
    ['HIGHSPEED_RAIL', 'highspeed_rail'],
    ['HIGH_SPEED_RAIL', 'highspeed_rail'],
    ['LONG_DISTANCE', 'long_distance'],
    ['NIGHT_RAIL', 'night_rail'],
    ['REGIONAL_RAIL', 'regional_rail'],
    ['REGIONAL_FAST_RAIL', 'regional_rail'],
    ['SUBURBAN', 'suburban'],
    ['INTERCITY', 'long_distance'],
    ['subway', 'subway'],
    ['METRO', 'suburban'],
    ['TRAM', 'tram'],
    ['LIGHT_RAIL', 'tram'],
    ['LIGHTRAIL', 'tram'],
    ['BUS', 'bus'],
    ['COACH', 'coach'],
    ['FERRY', 'ferry'],
    ['BOAT', 'ferry'],
    ['WALK', 'walk'],
    ['FOOT', 'walk'],
    ['AIRPLANE', 'airplane'],
    ['RENTAL', 'unmapped'],
    ['TELEPORTER', 'unmapped'],
    ['RIDE_SHARING', 'ride_sharing'],
    ['ODM', 'odm'],
    ['FUNICULAR', 'funicular'],
    ['OTHER', 'other'],
  ] as const)('maps %s → %s', (raw, expected) => {
    expect(mapMotisLegMode(raw)).toBe(expected);
  });
});

describe('collectJourneyTransportModes', () => {
  it('deduplicates and orders canonically', () => {
    expect(
      collectJourneyTransportModes([
        { mode: 'ferry' },
        { mode: 'walk' },
        { mode: 'regional_rail' },
        { mode: 'subway' },
        { mode: 'regional_rail' },
        { mode: 'unmapped' },
      ]),
    ).toEqual(['regional_rail', 'subway', 'ferry']);
  });

  it('excludes walk-only access from the transit summary', () => {
    expect(collectJourneyTransportModes([{ mode: 'walk' }, { mode: 'walk' }])).toEqual([]);
  });

  it('keeps regional rail + walk as regional rail', () => {
    expect(collectJourneyTransportModes([{ mode: 'walk' }, { mode: 'regional_rail' }])).toEqual([
      'regional_rail',
    ]);
  });

  it('keeps regional rail + subway', () => {
    expect(
      collectJourneyTransportModes([{ mode: 'regional_rail' }, { mode: 'subway' }]),
    ).toEqual(['regional_rail', 'subway']);
  });

  it('maps bus and tram into the summary', () => {
    expect(collectJourneyTransportModes([{ mode: 'bus' }, { mode: 'tram' }])).toEqual([
      'tram',
      'bus',
    ]);
  });

  it('keeps Transitous filters including other, not street access', () => {
    expect(
      collectJourneyTransportModes([
        { mode: 'airplane' },
        { mode: 'coach' },
        { mode: 'suburban' },
        { mode: 'other' },
        { mode: 'walk' },
        { mode: 'unmapped' },
      ]),
    ).toEqual(['airplane', 'coach', 'suburban', 'other']);
  });

  it('detects unmapped transit legs without inventing train', () => {
    const legs = [{ mode: 'unmapped' as const }, { mode: 'walk' as const }];
    expect(collectJourneyTransportModes(legs)).toEqual([]);
    expect(hasUnmappedTransitLegs(legs)).toBe(true);
  });
});

describe('normalizeMotisPlanResponse modes', () => {
  it('maps LONG_DISTANCE rail legs to intercity rail in a real-shaped itinerary', () => {
    const journeys = normalizeMotisPlanResponse({
      itineraries: [
        {
          duration: 3600,
          startTime: '2026-09-15T08:00:00Z',
          endTime: '2026-09-15T09:00:00Z',
          transfers: 0,
          legs: [
            {
              mode: 'WALK',
              startTime: '2026-09-15T08:00:00Z',
              endTime: '2026-09-15T08:05:00Z',
              duration: 300,
            },
            {
              mode: 'LONG_DISTANCE',
              startTime: '2026-09-15T08:05:00Z',
              endTime: '2026-09-15T09:00:00Z',
              duration: 3300,
            },
          ],
        },
      ],
    });
    expect(journeys[0]?.legs.map((leg) => leg.mode)).toEqual(['walk', 'long_distance']);
    expect(journeys[0]?.legs[1]?.motisMode).toBe('LONG_DISTANCE');
    expect(collectJourneyTransportModes(journeys[0]!.legs)).toEqual(['long_distance']);
  });

  it('maps coach, ferry, metro, tram, suburban, and light rail', () => {
    const journeys = normalizeMotisPlanResponse({
      itineraries: [
        {
          duration: 7200,
          startTime: '2026-09-15T08:00:00Z',
          endTime: '2026-09-15T10:00:00Z',
          transfers: 3,
          legs: [
            {
              mode: 'COACH',
              startTime: '2026-09-15T08:00:00Z',
              endTime: '2026-09-15T08:30:00Z',
              duration: 1800,
            },
            {
              mode: 'SUBWAY',
              startTime: '2026-09-15T08:30:00Z',
              endTime: '2026-09-15T08:50:00Z',
              duration: 1200,
            },
            {
              mode: 'TRAM',
              startTime: '2026-09-15T08:50:00Z',
              endTime: '2026-09-15T09:10:00Z',
              duration: 1200,
            },
            {
              mode: 'SUBURBAN',
              startTime: '2026-09-15T09:10:00Z',
              endTime: '2026-09-15T09:40:00Z',
              duration: 1800,
            },
            {
              mode: 'LIGHT_RAIL',
              startTime: '2026-09-15T09:40:00Z',
              endTime: '2026-09-15T09:50:00Z',
              duration: 600,
            },
            {
              mode: 'FERRY',
              startTime: '2026-09-15T09:50:00Z',
              endTime: '2026-09-15T10:00:00Z',
              duration: 600,
            },
          ],
        },
      ],
    });
    expect(journeys[0]?.legs.map((leg) => leg.motisMode)).toEqual([
      'COACH',
      'SUBWAY',
      'TRAM',
      'SUBURBAN',
      'LIGHT_RAIL',
      'FERRY',
    ]);
    expect(journeys[0]?.legs.map((leg) => leg.mode)).toEqual([
      'coach',
      'subway',
      'tram',
      'suburban',
      'tram',
      'ferry',
    ]);
    expect(collectJourneyTransportModes(journeys[0]!.legs)).toEqual([
      'coach',
      'suburban',
      'subway',
      'tram',
      'ferry',
    ]);
  });

  it('keeps unknown raw modes as other without inventing an empty train journey', () => {
    const journeys = normalizeMotisPlanResponse({
      itineraries: [
        {
          duration: 600,
          startTime: '2026-09-15T08:00:00Z',
          endTime: '2026-09-15T08:10:00Z',
          transfers: 0,
          legs: [
            {
              mode: 'TELEPORTER',
              startTime: '2026-09-15T08:00:00Z',
              endTime: '2026-09-15T08:10:00Z',
              duration: 600,
            },
          ],
        },
      ],
    });
    expect(journeys[0]?.legs[0]?.mode).toBe('unmapped');
    expect(journeys[0]?.legs[0]?.motisMode).toBe('TELEPORTER');
    expect(collectJourneyTransportModes(journeys[0]!.legs)).toEqual([]);
    expect(hasUnmappedTransitLegs(journeys[0]!.legs)).toBe(true);
  });

  it('does not treat known Transitous airplane/rental modes as unmapped', () => {
    expect(hasUnmappedTransitLegs([{ mode: 'airplane', motisMode: 'AIRPLANE' }])).toBe(false);
    expect(hasUnmappedTransitLegs([{ mode: 'unmapped', motisMode: 'RENTAL' }])).toBe(false);
    expect(hasUnmappedTransitLegs([{ mode: 'unmapped', motisMode: 'HYPERLOOP' }])).toBe(true);
  });
});
