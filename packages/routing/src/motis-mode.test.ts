import { describe, expect, it } from 'vitest';

import {
  collectJourneyTransportModes,
  hasUnmappedTransitLegs,
  mapMotisLegMode,
} from './motis-mode.js';
import { normalizeMotisPlanResponse } from './motis-normalize.js';

describe('mapMotisLegMode', () => {
  it.each([
    ['RAIL', 'train'],
    ['TRAIN', 'train'],
    ['HIGHSPEED_RAIL', 'train'],
    ['HIGH_SPEED_RAIL', 'train'],
    ['LONG_DISTANCE', 'train'],
    ['NIGHT_RAIL', 'train'],
    ['REGIONAL_RAIL', 'train'],
    ['REGIONAL_FAST_RAIL', 'train'],
    ['SUBURBAN', 'train'],
    ['INTERCITY', 'train'], // known intercity rail → train
    ['subway', 'metro'],
    ['METRO', 'train'], // deprecated MOTIS alias of SUBURBAN
    ['TRAM', 'tram'],
    ['LIGHT_RAIL', 'tram'],
    ['LIGHTRAIL', 'tram'],
    ['BUS', 'bus'],
    ['COACH', 'bus'],
    ['FERRY', 'ferry'],
    ['BOAT', 'ferry'],
    ['WALK', 'walk'],
    ['FOOT', 'walk'],
    ['AIRPLANE', 'other'],
    ['RENTAL', 'other'],
    ['TELEPORTER', 'other'],
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
        { mode: 'train' },
        { mode: 'metro' },
        { mode: 'train' },
        { mode: 'other' },
      ]),
    ).toEqual(['train', 'metro', 'ferry']);
  });

  it('excludes walk-only access from the transit summary', () => {
    expect(collectJourneyTransportModes([{ mode: 'walk' }, { mode: 'walk' }])).toEqual([]);
  });

  it('keeps train+walk as train', () => {
    expect(collectJourneyTransportModes([{ mode: 'walk' }, { mode: 'train' }])).toEqual(['train']);
  });

  it('keeps train+metro', () => {
    expect(collectJourneyTransportModes([{ mode: 'train' }, { mode: 'metro' }])).toEqual([
      'train',
      'metro',
    ]);
  });

  it('maps bus and tram into the summary', () => {
    expect(collectJourneyTransportModes([{ mode: 'bus' }, { mode: 'tram' }])).toEqual([
      'bus',
      'tram',
    ]);
  });

  it('detects unmapped transit legs without inventing train', () => {
    const legs = [{ mode: 'other' as const }, { mode: 'walk' as const }];
    expect(collectJourneyTransportModes(legs)).toEqual([]);
    expect(hasUnmappedTransitLegs(legs)).toBe(true);
  });
});

describe('normalizeMotisPlanResponse modes', () => {
  it('maps LONG_DISTANCE rail legs to train in a real-shaped itinerary', () => {
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
    expect(journeys[0]?.legs.map((leg) => leg.mode)).toEqual(['walk', 'train']);
    expect(journeys[0]?.legs[1]?.motisMode).toBe('LONG_DISTANCE');
    expect(collectJourneyTransportModes(journeys[0]!.legs)).toEqual(['train']);
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
      'bus',
      'metro',
      'tram',
      'train',
      'tram',
      'ferry',
    ]);
    expect(collectJourneyTransportModes(journeys[0]!.legs)).toEqual([
      'train',
      'bus',
      'tram',
      'metro',
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
    expect(journeys[0]?.legs[0]?.mode).toBe('other');
    expect(journeys[0]?.legs[0]?.motisMode).toBe('TELEPORTER');
    expect(collectJourneyTransportModes(journeys[0]!.legs)).toEqual([]);
    expect(hasUnmappedTransitLegs(journeys[0]!.legs)).toBe(true);
  });

  it('does not treat known MOTIS airplane/rental modes as unmapped', () => {
    expect(hasUnmappedTransitLegs([{ mode: 'other', motisMode: 'AIRPLANE' }])).toBe(false);
    expect(hasUnmappedTransitLegs([{ mode: 'other', motisMode: 'RENTAL' }])).toBe(false);
    expect(hasUnmappedTransitLegs([{ mode: 'other', motisMode: 'HYPERLOOP' }])).toBe(true);
  });
});
