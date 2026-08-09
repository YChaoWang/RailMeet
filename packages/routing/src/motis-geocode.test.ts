import { describe, expect, it } from 'vitest';

import { RoutingError } from './errors.js';
import { normalizeMotisGeocodeResponse } from './motis-geocode.js';

describe('normalizeMotisGeocodeResponse', () => {
  it('normalizes stops and places and prioritizes public-transport stops', () => {
    const suggestions = normalizeMotisGeocodeResponse([
      {
        type: 'PLACE',
        name: 'Berlin',
        id: 'node/[240109189]',
        lat: 52.517,
        lon: 13.395,
        country: 'DE',
        tz: 'Europe/Berlin',
        areas: [{ name: 'Berlin', adminLevel: 4, default: true, unique: true, matched: false }],
        score: -20,
      },
      {
        type: 'STOP',
        name: 'Berlin Hbf',
        id: 'de:11000:900003200:1:51',
        lat: 52.525,
        lon: 13.369,
        country: 'DE',
        tz: 'Europe/Berlin',
        areas: [{ name: 'Berlin', adminLevel: 4, default: true, unique: true, matched: false }],
        modes: ['HIGHSPEED_RAIL', 'SUBWAY'],
        score: -19,
        importance: 0.2,
      },
      {
        type: 'STOP',
        name: 'Berlin Ostbf',
        id: 'de:11000:900120005',
        lat: 52.51,
        lon: 13.435,
        country: 'DE',
        tz: 'Europe/Berlin',
        areas: [{ name: 'Berlin', adminLevel: 4, default: true, unique: true, matched: false }],
        modes: ['REGIONAL_RAIL'],
        score: -18,
        importance: 0.07,
      },
    ]);

    expect(suggestions[0]?.type).toBe('STOP');
    expect(suggestions[0]?.name).toBe('Berlin Hbf');
    expect(suggestions[0]?.providerId).toBe('de:11000:900003200:1:51');
    expect(suggestions[0]?.secondaryLabel).toContain('Station');
    expect(suggestions[0]?.secondaryLabel).toContain('Berlin');
    expect(suggestions[0]?.secondaryLabel).toContain('DE');
    expect(suggestions.map((item) => item.name)).toEqual(['Berlin Hbf', 'Berlin Ostbf', 'Berlin']);
    expect(suggestions.find((item) => item.name === 'Berlin')?.secondaryLabel).toContain('City');
  });

  it('rejects malformed geocode payloads as provider contract failures', () => {
    expect(() => normalizeMotisGeocodeResponse([{ type: 'STOP', name: 'X' }])).toThrow(
      RoutingError,
    );
  });

  it('preserves null country/timezone rather than inventing values', () => {
    const [suggestion] = normalizeMotisGeocodeResponse([
      {
        type: 'ADDRESS',
        name: 'Somewhere',
        id: 'way/1',
        lat: 48.1,
        lon: 11.5,
        areas: [],
        score: 1,
      },
    ]);
    expect(suggestion?.countryCode).toBeNull();
    expect(suggestion?.timezone).toBeNull();
    expect(suggestion?.type).toBe('ADDRESS');
  });
});
