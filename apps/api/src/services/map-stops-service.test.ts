import { RoutingError } from '@railmeet/routing';
import { MAP_STOPS_FEATURE_SOFT_LIMIT } from '@railmeet/shared';
import { describe, expect, it, vi } from 'vitest';

import {
  buildMapStopsCacheKey,
  createMapStopsService,
} from './map-stops-service.js';

function feature(
  stopId: string,
  importance: 'major' | 'regional' | 'local',
): {
  type: 'Feature';
  geometry: { type: 'Point'; coordinates: [number, number] };
  properties: {
    stopId: string;
    name: string;
    kind: 'rail';
    importance: 'major' | 'regional' | 'local';
    modes: string[];
    parentId: null;
  };
} {
  return {
    type: 'Feature',
    geometry: { type: 'Point', coordinates: [13.3, 52.5] },
    properties: {
      stopId,
      name: stopId,
      kind: 'rail',
      importance,
      modes: ['RAIL'],
      parentId: null,
    },
  };
}

describe('buildMapStopsCacheKey', () => {
  it('quantizes bounds for stable cache keys', () => {
    expect(
      buildMapStopsCacheKey({
        minLon: 13.30111,
        minLat: 52.50111,
        maxLon: 13.40999,
        maxLat: 52.60999,
        zoom: 12.8,
      }),
    ).toBe('13.301:52.501:13.410:52.610:12');
  });
});

describe('createMapStopsService', () => {
  it('returns cached collections for identical quantized bounds', async () => {
    const fetchMapStops = vi.fn(async () => ({
      type: 'FeatureCollection' as const,
      features: [feature('a', 'major')],
      metadata: {
        truncated: false,
        aggregated: false,
        minimumDetailZoom: null,
        sourceFeatureCount: 1,
      },
    }));

    const service = createMapStopsService({
      mapStopsClient: { fetchMapStops },
      cacheTtlMs: 60_000,
    });

    const first = await service.getMapStops({
      minLon: 13.3,
      minLat: 52.5,
      maxLon: 13.4,
      maxLat: 52.6,
      zoom: 12,
    });
    const second = await service.getMapStops({
      minLon: 13.3004,
      minLat: 52.5004,
      maxLon: 13.4004,
      maxLat: 52.6004,
      zoom: 12.2,
    });

    expect(first.ok).toBe(true);
    expect(second.ok).toBe(true);
    expect(fetchMapStops).toHaveBeenCalledTimes(1);
  });

  it('truncates oversized collections to major/regional stops', async () => {
    const oversized = Array.from({ length: MAP_STOPS_FEATURE_SOFT_LIMIT + 20 }, (_, index) =>
      feature(`stop-${index}`, index % 3 === 0 ? 'major' : index % 3 === 1 ? 'regional' : 'local'),
    );
    const service = createMapStopsService({
      mapStopsClient: {
        fetchMapStops: async () => ({
          type: 'FeatureCollection',
          features: oversized,
          metadata: {
            truncated: false,
            aggregated: false,
            minimumDetailZoom: null,
            sourceFeatureCount: oversized.length,
          },
        }),
      },
    });

    const result = await service.getMapStops({
      minLon: 13.3,
      minLat: 52.5,
      maxLon: 13.4,
      maxLat: 52.6,
      zoom: 12,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    expect(result.value.metadata.truncated).toBe(true);
    expect(result.value.metadata.aggregated).toBe(true);
    expect(result.value.metadata.minimumDetailZoom).toBe(12);
    expect(result.value.metadata.sourceFeatureCount).toBe(oversized.length);
    expect(result.value.features.length).toBeLessThanOrEqual(MAP_STOPS_FEATURE_SOFT_LIMIT);
    expect(
      result.value.features.every(
        (item) =>
          item.properties.importance === 'major' || item.properties.importance === 'regional',
      ),
    ).toBe(true);
  });

  it('maps provider outages to unavailable', async () => {
    const service = createMapStopsService({
      mapStopsClient: {
        fetchMapStops: async () => {
          throw new RoutingError('PROVIDER_UNAVAILABLE', 'provider_unavailable', 'down');
        },
      },
    });

    const result = await service.getMapStops({
      minLon: 13.3,
      minLat: 52.5,
      maxLon: 13.4,
      maxLat: 52.6,
      zoom: 12,
    });
    expect(result).toEqual({
      ok: false,
      error: {
        kind: 'unavailable',
        message: 'Map stations are temporarily unavailable. Try again.',
      },
    });
  });
});
