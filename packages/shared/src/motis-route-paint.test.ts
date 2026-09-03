import { describe, expect, it } from 'vitest';

import {
  contrastTextForBackground,
  getMotisRouteColors,
  resolveMapRoutePaint,
} from './motis-mode-style.js';
import { pickJourneyLegIdentity } from './journey-leg-identity.js';

describe('getMotisRouteColors provider colors', () => {
  it('accepts routeColor with and without a leading #', () => {
    expect(getMotisRouteColors({ mode: 'SUBWAY', routeColor: '0f0d78' })[0]).toBe('#0f0d78');
    expect(getMotisRouteColors({ mode: 'SUBWAY', routeColor: '#0F0D78' })[0]).toBe('#0f0d78');
  });

  it('falls back to the MOTIS mode color when routeColor is missing or invalid', () => {
    expect(getMotisRouteColors({ mode: 'SUBWAY' })).toEqual(['#3f51b5', 'white']);
    expect(getMotisRouteColors({ mode: 'TRAM', routeColor: 'rebeccapurple' })).toEqual([
      '#edce00',
      'white',
    ]);
    expect(getMotisRouteColors({ mode: 'BUS', routeColor: 'fff' })[0]).toBe('#ff9800');
  });

  it('prefers routeTextColor and otherwise contrasts against the route color', () => {
    expect(getMotisRouteColors({ mode: 'BUS', routeColor: '000000', routeTextColor: 'ff0000' })).toEqual([
      '#000000',
      '#ff0000',
    ]);
    // No provider text color: dark background gets white, light gets black —
    // not the mode default, which could be unreadable on the provider color.
    expect(getMotisRouteColors({ mode: 'BUS', routeColor: '0f0d78' })[1]).toBe('#ffffff');
    expect(getMotisRouteColors({ mode: 'BUS', routeColor: 'edce00' })[1]).toBe('#000000');
  });
});

describe('contrastTextForBackground', () => {
  it('splits on relative luminance and rejects unusable input', () => {
    expect(contrastTextForBackground('#ffffff')).toBe('#000000');
    expect(contrastTextForBackground('#000000')).toBe('#ffffff');
    expect(contrastTextForBackground('09a4ec')).toBe('#000000');
    expect(contrastTextForBackground('not-a-color')).toBe('#ffffff');
  });
});

describe('resolveMapRoutePaint', () => {
  it('reports provider colors as authoritative', () => {
    expect(resolveMapRoutePaint({ mode: 'HIGHSPEED_RAIL', routeColor: '09a4ec' })).toEqual({
      color: '#09a4ec',
      textColor: '#000000',
      colorSource: 'provider',
    });
  });

  it('marks mode defaults as a fallback', () => {
    expect(resolveMapRoutePaint({ mode: 'REGIONAL_RAIL' })).toEqual({
      color: '#f44336',
      textColor: '#ffffff',
      colorSource: 'mode-fallback',
    });
    expect(resolveMapRoutePaint({ mode: 'HYPERLOOP' }).colorSource).toBe('mode-fallback');
  });

  it('never emits a CSS custom property for modes styled from theme tokens', () => {
    for (const mode of ['WALK', 'BIKE']) {
      const paint = resolveMapRoutePaint({ mode });
      expect(paint.color).toMatch(/^#[0-9a-f]{6}$/);
      expect(paint.textColor).toMatch(/^#[0-9a-f]{6}$/);
    }
  });
});

describe('pickJourneyLegIdentity stops', () => {
  it('keeps finite from/to coordinates and drops non-finite ones', () => {
    const identity = pickJourneyLegIdentity({
      from: { name: 'Berlin Hbf', latitude: 52.525, longitude: 13.369 },
      to: { name: 'München Hbf', track: '22', latitude: Number.NaN, longitude: 11.558 },
    });
    expect(identity.from).toEqual({ name: 'Berlin Hbf', latitude: 52.525, longitude: 13.369 });
    expect(identity.to).toEqual({ name: 'München Hbf', track: '22', longitude: 11.558 });
  });

  it('passes intermediate stops through and drops unnamed entries', () => {
    const identity = pickJourneyLegIdentity({
      intermediateStops: [
        {
          name: 'Erfurt Hbf',
          latitude: 50.972,
          longitude: 11.038,
          arrivalAt: '2026-09-15T10:00:00Z',
          departureAt: '2026-09-15T10:02:00Z',
          track: '2',
        },
        { name: '', latitude: 1, longitude: 2 },
        { name: 'Bamberg' },
      ],
    });
    expect(identity.intermediateStops).toEqual([
      {
        name: 'Erfurt Hbf',
        latitude: 50.972,
        longitude: 11.038,
        arrivalAt: '2026-09-15T10:00:00Z',
        departureAt: '2026-09-15T10:02:00Z',
        track: '2',
      },
      { name: 'Bamberg' },
    ]);
  });

  it('omits intermediateStops entirely when nothing usable remains', () => {
    expect(pickJourneyLegIdentity({ intermediateStops: [] }).intermediateStops).toBeUndefined();
    expect(
      pickJourneyLegIdentity({ intermediateStops: [{ name: '   '.trim() }] }).intermediateStops,
    ).toBeUndefined();
  });
});
