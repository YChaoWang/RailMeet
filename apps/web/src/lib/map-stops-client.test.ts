import { describe, expect, it } from 'vitest';

import { isMapStopsViewportEligible, mapStopsQueryFromBounds } from './map-stops-client';

describe('mapStopsQueryFromBounds', () => {
  it('passes through west/south/east/north as min/max lon/lat', () => {
    expect(
      mapStopsQueryFromBounds(
        { minLon: 13.3, minLat: 52.5, maxLon: 13.5, maxLat: 52.6 },
        11.4,
      ),
    ).toEqual({
      minLon: 13.3,
      minLat: 52.5,
      maxLon: 13.5,
      maxLat: 52.6,
      zoom: 11.4,
    });
  });
});

describe('isMapStopsViewportEligible', () => {
  it('accepts provider-safe spans and rejects continental boxes', () => {
    expect(
      isMapStopsViewportEligible({
        minLon: 2.2,
        minLat: 48.7,
        maxLon: 2.5,
        maxLat: 49.0,
      }),
    ).toBe(true);
    expect(
      isMapStopsViewportEligible({
        minLon: 2,
        minLat: 47,
        maxLon: 9,
        maxLat: 50,
      }),
    ).toBe(false);
  });
});
