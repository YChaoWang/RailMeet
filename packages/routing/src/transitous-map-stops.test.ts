import { afterEach, describe, expect, it, vi } from 'vitest';

import type { RoutingError } from './errors.js';
import { MOTIS_MAP_STOPS_OPENAPI_PIN } from './motis-map-stops.js';
import { createTransitousMapStopsClient } from './transitous-map-stops.js';

afterEach(() => {
  vi.restoreAllMocks();
});

describe('createTransitousMapStopsClient', () => {
  it('calls MOTIS map/stops with lower-right min and upper-left max', async () => {
    const fetchImpl = vi.fn(async () => {
      return new Response(
        JSON.stringify([
          {
            name: 'Berlin Hbf',
            stopId: 'stop-1',
            lat: 52.525,
            lon: 13.369,
            importance: 0.2,
            modes: ['REGIONAL_RAIL'],
          },
        ]),
        {
          status: 200,
          headers: { 'content-type': 'application/json' },
        },
      );
    });

    const client = createTransitousMapStopsClient({
      baseUrl: 'https://api.transitous.org/api',
      userAgent: 'RailMeet/0.0.0 (+https://example.test)',
      timeoutMs: 5_000,
      maxResponseBytes: 1_048_576,
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    const result = await client.fetchMapStops({
      minLat: 52.5,
      minLon: 13.3,
      maxLat: 52.6,
      maxLon: 13.5,
    });

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const call = fetchImpl.mock.calls[0] as unknown as [URL | string, RequestInit];
    expect(String(call[0])).toBe(
      'https://api.transitous.org/api/v1/map/stops?min=52.5%2C13.5&max=52.6%2C13.3',
    );
    expect(call[1]).toMatchObject({
      method: 'GET',
      headers: {
        Accept: 'application/json',
        'User-Agent': 'RailMeet/0.0.0 (+https://example.test)',
      },
    });
    expect(result.features).toHaveLength(1);
    expect(result.features[0]?.properties.stopId).toBe('stop-1');
  });

  it('pins the OpenAPI path constant', () => {
    expect(MOTIS_MAP_STOPS_OPENAPI_PIN).toBe('motis:/api/v1/map/stops');
  });

  it('rejects oversized responses', async () => {
    const fetchImpl = vi.fn(async () => {
      return new Response('{"too":"big"}', {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    });

    const client = createTransitousMapStopsClient({
      baseUrl: 'https://api.transitous.org/api',
      userAgent: 'RailMeet/0.0.0 (+https://example.test)',
      timeoutMs: 5_000,
      maxResponseBytes: 4,
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    await expect(
      client.fetchMapStops({
        minLat: 52.5,
        minLon: 13.3,
        maxLat: 52.6,
        maxLon: 13.5,
      }),
    ).rejects.toMatchObject({
      code: 'PROVIDER_CONTRACT_FAILURE',
    } satisfies Partial<RoutingError>);
  });

  it('maps HTTP 429 to RATE_LIMITED', async () => {
    const client = createTransitousMapStopsClient({
      baseUrl: 'https://api.transitous.org/api',
      userAgent: 'RailMeet/0.0.0 (+https://example.test)',
      timeoutMs: 5_000,
      maxResponseBytes: 1_048_576,
      fetchImpl: (async () => new Response('nope', { status: 429 })) as unknown as typeof fetch,
    });

    await expect(
      client.fetchMapStops({
        minLat: 52.5,
        minLon: 13.3,
        maxLat: 52.6,
        maxLon: 13.5,
      }),
    ).rejects.toMatchObject({ code: 'RATE_LIMITED' });
  });
});
