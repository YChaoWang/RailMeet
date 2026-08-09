import { describe, expect, it } from 'vitest';

import { mapStopsQueryFromBounds } from './map-stops-client';

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
