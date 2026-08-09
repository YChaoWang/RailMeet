import { describe, expect, it } from 'vitest';

import { RoutingError } from './errors.js';
import { normalizeMotisPlanResponse } from './motis-normalize.js';

describe('normalizeMotisPlanResponse legGeometry', () => {
  const baseItinerary = {
    duration: 3600,
    startTime: '2026-09-01T08:00:00Z',
    endTime: '2026-09-01T09:00:00Z',
    transfers: 0,
    legs: [
      {
        mode: 'RAIL',
        startTime: '2026-09-01T08:00:00Z',
        endTime: '2026-09-01T09:00:00Z',
        duration: 3600,
        legGeometry: {
          points: '_p~iF~ps|U_ulLnnqC_mqNvxq`@',
          precision: 6,
          length: 3,
        },
      },
      {
        mode: 'WALK',
        startTime: '2026-09-01T09:00:00Z',
        endTime: '2026-09-01T09:05:00Z',
        duration: 300,
        legGeometry: {
          points: 'a~l~Fjk~uOwHJy@P',
          precision: 6,
          length: 2,
        },
      },
    ],
  };

  it('preserves points, precision, and length exactly for every leg', () => {
    const journeys = normalizeMotisPlanResponse({ itineraries: [baseItinerary] });
    expect(journeys[0]?.legs).toHaveLength(2);
    expect(journeys[0]?.legs[0]?.geometry).toEqual({
      points: '_p~iF~ps|U_ulLnnqC_mqNvxq`@',
      precision: 6,
      length: 3,
    });
    expect(journeys[0]?.legs[1]?.geometry).toEqual({
      points: 'a~l~Fjk~uOwHJy@P',
      precision: 6,
      length: 2,
    });
    expect(journeys[0]?.legs[0]?.geometry?.precision).not.toBe(5);
  });

  it('omits geometry when legGeometry is absent', () => {
    const journeys = normalizeMotisPlanResponse({
      itineraries: [
        {
          ...baseItinerary,
          legs: [
            {
              mode: 'RAIL',
              startTime: '2026-09-01T08:00:00Z',
              endTime: '2026-09-01T09:00:00Z',
              duration: 3600,
            },
          ],
        },
      ],
    });
    expect(journeys[0]?.legs[0]?.geometry).toBeUndefined();
  });

  it('rejects malformed legGeometry as a provider contract failure', () => {
    expect(() =>
      normalizeMotisPlanResponse({
        itineraries: [
          {
            ...baseItinerary,
            legs: [
              {
                mode: 'RAIL',
                startTime: '2026-09-01T08:00:00Z',
                endTime: '2026-09-01T09:00:00Z',
                duration: 3600,
                legGeometry: { points: 'abc', precision: 6 },
              },
            ],
          },
        ],
      }),
    ).toThrow(RoutingError);
  });
});
