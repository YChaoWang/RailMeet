import { describe, expect, it } from 'vitest';

import { mapStopsQuerySchema, stationFeatureCollectionSchema } from './map-stops.js';

describe('mapStopsQuerySchema', () => {
  it('accepts a normal viewport', () => {
    const parsed = mapStopsQuerySchema.parse({
      minLon: '13.3',
      minLat: '52.5',
      maxLon: '13.5',
      maxLat: '52.6',
      zoom: '11',
    });
    expect(parsed).toEqual({
      minLon: 13.3,
      minLat: 52.5,
      maxLon: 13.5,
      maxLat: 52.6,
      zoom: 11,
    });
  });

  it('rejects inverted and oversized detailed bounds', () => {
    expect(
      mapStopsQuerySchema.safeParse({
        minLon: 13.5,
        minLat: 52.5,
        maxLon: 13.3,
        maxLat: 52.6,
        zoom: 10,
      }).success,
    ).toBe(false);

    expect(
      mapStopsQuerySchema.safeParse({
        minLon: 0,
        minLat: 0,
        maxLon: 1,
        maxLat: 1,
        zoom: 12,
      }).success,
    ).toBe(false);
  });
});

describe('stationFeatureCollectionSchema', () => {
  it('accepts a GeoJSON station collection', () => {
    const parsed = stationFeatureCollectionSchema.parse({
      type: 'FeatureCollection',
      features: [
        {
          type: 'Feature',
          geometry: { type: 'Point', coordinates: [13.369, 52.525] },
          properties: {
            stopId: 'stop-1',
            name: 'Berlin Hbf',
            kind: 'rail',
            importance: 'major',
            modes: ['REGIONAL_RAIL'],
            parentId: null,
          },
        },
      ],
      metadata: {
        truncated: false,
        aggregated: false,
        minimumDetailZoom: null,
        sourceFeatureCount: 1,
      },
    });
    expect(parsed.features).toHaveLength(1);
  });
});
