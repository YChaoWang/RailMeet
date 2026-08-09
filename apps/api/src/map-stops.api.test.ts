import { createLogger } from '@railmeet/observability';
import { stationFeatureCollectionSchema } from '@railmeet/validation';
import { describe, expect, it, vi } from 'vitest';

import { buildServer } from './app.js';
import type { MapStopsService } from './services/map-stops-service.js';

const REQUEST_ID = 'req-map-stops-0001';

describe('GET /api/v1/map/stops', () => {
  it('returns a station feature collection envelope', async () => {
    const getMapStops = vi.fn(async () => ({
      ok: true as const,
      value: {
        type: 'FeatureCollection' as const,
        features: [
          {
            type: 'Feature' as const,
            geometry: {
              type: 'Point' as const,
              coordinates: [13.369, 52.525] as [number, number],
            },
            properties: {
              stopId: 'stop-1',
              name: 'Berlin Hbf',
              kind: 'rail' as const,
              importance: 'major' as const,
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
      },
    }));

    const app = await buildServer({
      logger: createLogger({ name: 'map-stops-api-test', level: 'silent', pretty: false }),
      genReqId: () => REQUEST_ID,
      mapStopsService: { getMapStops } satisfies MapStopsService,
    });

    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/map/stops?minLon=13.3&minLat=52.5&maxLon=13.5&maxLat=52.6&zoom=12',
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.meta.requestId).toBe(REQUEST_ID);
    expect(stationFeatureCollectionSchema.parse(body.data).features[0]?.properties.name).toBe(
      'Berlin Hbf',
    );
    expect(getMapStops).toHaveBeenCalledWith(
      expect.objectContaining({
        minLon: 13.3,
        minLat: 52.5,
        maxLon: 13.5,
        maxLat: 52.6,
        zoom: 12,
      }),
    );
    await app.close();
  });

  it('rejects inverted bounds and oversized detailed viewports', async () => {
    const app = await buildServer({
      logger: createLogger({ name: 'map-stops-api-test', level: 'silent', pretty: false }),
      mapStopsService: {
        getMapStops: async () => ({
          ok: true,
          value: {
            type: 'FeatureCollection',
            features: [],
            metadata: {
              truncated: false,
              aggregated: false,
              minimumDetailZoom: null,
              sourceFeatureCount: 0,
            },
          },
        }),
      },
    });

    const inverted = await app.inject({
      method: 'GET',
      url: '/api/v1/map/stops?minLon=13.5&minLat=52.6&maxLon=13.3&maxLat=52.5&zoom=10',
    });
    expect(inverted.statusCode).toBe(400);

    const hugeDetailed = await app.inject({
      method: 'GET',
      url: '/api/v1/map/stops?minLon=0&minLat=0&maxLon=2&maxLat=2&zoom=12',
    });
    expect(hugeDetailed.statusCode).toBe(400);

    await app.close();
  });

  it('maps service unavailable to 503', async () => {
    const app = await buildServer({
      logger: createLogger({ name: 'map-stops-api-test', level: 'silent', pretty: false }),
      mapStopsService: {
        getMapStops: async () => ({
          ok: false,
          error: { kind: 'unavailable', message: 'Map stations are temporarily unavailable.' },
        }),
      },
    });

    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/map/stops?minLon=13.3&minLat=52.5&maxLon=13.5&maxLat=52.6&zoom=11',
    });
    expect(response.statusCode).toBe(503);
    expect(response.json().error.code).toBe('SERVICE_UNAVAILABLE');
    await app.close();
  });
});
