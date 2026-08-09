import { describe, expect, it } from 'vitest';

import { RoutingError } from './errors.js';
import {
  normalizeMotisMapStopsResponse,
  stationImportanceFromScore,
  stationKindFromModes,
} from './motis-map-stops.js';

describe('stationKindFromModes', () => {
  it('maps MOTIS rail-family modes to rail', () => {
    expect(stationKindFromModes(['HIGHSPEED_RAIL'])).toBe('rail');
    expect(stationKindFromModes(['SUBURBAN'])).toBe('rail');
    expect(stationKindFromModes(['REGIONAL_RAIL'])).toBe('rail');
  });

  it('prefers rail over bus when both are present', () => {
    expect(stationKindFromModes(['BUS', 'SUBWAY', 'REGIONAL_RAIL'])).toBe('rail');
    expect(stationKindFromModes(['BUS', 'SUBWAY'])).toBe('metro');
  });

  it('falls back to other for unknown modes', () => {
    expect(stationKindFromModes([])).toBe('other');
    expect(stationKindFromModes(['CABLE_CAR'])).toBe('other');
  });
});

describe('stationImportanceFromScore', () => {
  it('buckets importance scores', () => {
    expect(stationImportanceFromScore(0.04)).toBe('major');
    expect(stationImportanceFromScore(0.01)).toBe('regional');
    expect(stationImportanceFromScore(0.009)).toBe('local');
    expect(stationImportanceFromScore(undefined)).toBe('local');
  });
});

describe('normalizeMotisMapStopsResponse', () => {
  it('normalizes Place arrays into GeoJSON with [lon, lat] coordinates', () => {
    const collection = normalizeMotisMapStopsResponse([
      {
        name: 'Berlin Hbf',
        stopId: 'de:11000:900003200:1:51',
        lat: 52.525,
        lon: 13.369,
        importance: 0.2,
        modes: ['HIGHSPEED_RAIL', 'SUBWAY'],
        parentId: 'de:11000:900003201',
      },
      {
        name: 'Local Bus',
        stopId: 'de:11000:bus1',
        lat: 52.52,
        lon: 13.37,
        importance: 0.002,
        modes: ['BUS'],
      },
    ]);

    expect(collection.type).toBe('FeatureCollection');
    expect(collection.metadata.sourceFeatureCount).toBe(2);
    expect(collection.metadata.truncated).toBe(false);
    expect(collection.features[0]?.properties).toMatchObject({
      stopId: 'de:11000:900003200:1:51',
      name: 'Berlin Hbf',
      kind: 'rail',
      importance: 'major',
      parentId: 'de:11000:900003201',
    });
    expect(collection.features[0]?.geometry.coordinates).toEqual([13.369, 52.525]);
    expect(collection.features[1]?.properties.importance).toBe('local');
    expect(collection.features[1]?.properties.kind).toBe('bus');
  });

  it('deduplicates by stopId preferring higher importance', () => {
    const collection = normalizeMotisMapStopsResponse([
      {
        name: 'Stop A',
        stopId: 'same',
        lat: 1,
        lon: 2,
        importance: 0.01,
        modes: ['BUS'],
      },
      {
        name: 'Stop A preferred',
        stopId: 'same',
        lat: 1.1,
        lon: 2.1,
        importance: 0.05,
        modes: ['TRAM'],
      },
    ]);

    expect(collection.features).toHaveLength(1);
    expect(collection.features[0]?.properties.name).toBe('Stop A preferred');
    expect(collection.features[0]?.properties.kind).toBe('tram');
    expect(collection.features[0]?.geometry.coordinates).toEqual([2.1, 1.1]);
  });

  it('rejects malformed payloads as provider contract failures', () => {
    expect(() => normalizeMotisMapStopsResponse([{ name: 'X' }])).toThrow(RoutingError);
    expect(() => normalizeMotisMapStopsResponse({})).toThrow(RoutingError);
  });
});
