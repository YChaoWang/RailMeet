import { describe, expect, it, vi } from 'vitest';

import { RoutingError } from '@railmeet/routing';

import { createPlaceSearchService } from './place-search-service.js';

describe('place search service', () => {
  it('normalizes whitespace and serves a short-lived cache', async () => {
    const geocodePlaces = vi.fn(async () => ({
      suggestions: [
        {
          providerId: 'stop-1',
          name: 'Berlin Hbf',
          type: 'STOP' as const,
          latitude: 52.525,
          longitude: 13.369,
          countryCode: 'DE',
          timezone: 'Europe/Berlin',
          modes: ['RAIL'],
          secondaryLabel: 'Station · Berlin, DE',
        },
      ],
    }));
    const service = createPlaceSearchService({
      geocoder: { geocodePlaces },
      cacheTtlMs: 60_000,
      now: () => 1_000,
    });

    const first = await service.searchPlaces({ query: '  Berlin  ' });
    const second = await service.searchPlaces({ query: 'Berlin' });
    expect(first.ok).toBe(true);
    expect(second.ok).toBe(true);
    expect(geocodePlaces).toHaveBeenCalledTimes(1);
    expect(geocodePlaces.mock.calls[0]?.[0]?.text).toBe('Berlin');
  });

  it('maps upstream timeouts to a safe unavailable error', async () => {
    const service = createPlaceSearchService({
      geocoder: {
        geocodePlaces: async () => {
          throw new RoutingError('TIMEOUT', 'transient', 'timed out');
        },
      },
    });
    const result = await service.searchPlaces({ query: 'Paris' });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.kind).toBe('unavailable');
      expect(result.error.message).not.toMatch(/TIMEOUT|Transitous/i);
    }
  });

  it('rejects short queries before calling Transitous', async () => {
    const geocodePlaces = vi.fn();
    const service = createPlaceSearchService({ geocoder: { geocodePlaces } });
    const result = await service.searchPlaces({ query: 'B' });
    expect(result.ok).toBe(false);
    expect(geocodePlaces).not.toHaveBeenCalled();
  });
});
