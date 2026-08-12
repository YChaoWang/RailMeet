import { describe, expect, it } from 'vitest';

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

  it('omits geometry when provider returns empty polyline points', () => {
    const journeys = normalizeMotisPlanResponse({
      itineraries: [
        {
          ...baseItinerary,
          legs: [
            {
              mode: 'WALK',
              startTime: '2026-09-01T08:00:00Z',
              endTime: '2026-09-01T08:01:00Z',
              duration: 60,
              legGeometry: { points: '', precision: 6, length: 0 },
            },
            {
              mode: 'RAIL',
              startTime: '2026-09-01T08:01:00Z',
              endTime: '2026-09-01T09:00:00Z',
              duration: 3540,
              legGeometry: {
                points: '_p~iF~ps|U_ulLnnqC_mqNvxq`@',
                precision: 6,
                length: 3,
              },
            },
          ],
        },
      ],
    });
    expect(journeys).toHaveLength(1);
    expect(journeys[0]?.legs[0]?.geometry).toBeUndefined();
    expect(journeys[0]?.legs[1]?.geometry?.points).toBe('_p~iF~ps|U_ulLnnqC_mqNvxq`@');
  });

  it('rejects malformed legGeometry as a provider contract failure when it is the only itinerary', () => {
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
    ).not.toThrow();
    // Single malformed itinerary is skipped → empty plan (caller treats as no journeys).
    expect(
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
    ).toEqual([]);
  });

  it('keeps valid sibling itineraries when one itinerary has malformed geometry', () => {
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
              legGeometry: { points: 'abc', precision: 6 },
            },
          ],
        },
        baseItinerary,
      ],
    });
    expect(journeys).toHaveLength(1);
    expect(journeys[0]?.legs[0]?.geometry?.points).toBe('_p~iF~ps|U_ulLnnqC_mqNvxq`@');
  });

  it('treats null legGeometry as absent (valid journey)', () => {
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
              legGeometry: null,
            },
          ],
        },
      ],
    });
    expect(journeys[0]?.legs[0]?.geometry).toBeUndefined();
    expect(journeys[0]?.durationMinutes).toBe(60);
  });
});
