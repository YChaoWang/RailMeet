import { describe, expect, it } from 'vitest';

import { getMotisRouteColors, sanitizeMotisHexColor } from './motis-mode-style.js';
import { buildRouteSummary } from './route-summary.js';

describe('sanitizeMotisHexColor', () => {
  it('accepts RRGGBB and rejects injection / named colors', () => {
    expect(sanitizeMotisHexColor('09a4ec')).toBe('#09a4ec');
    expect(sanitizeMotisHexColor('#0F0D78')).toBe('#0f0d78');
    expect(sanitizeMotisHexColor('red')).toBeUndefined();
    expect(sanitizeMotisHexColor('ffffff;background:url(x)')).toBeUndefined();
  });

  it('falls back to mode style when provider color is invalid', () => {
    expect(getMotisRouteColors({ mode: 'REGIONAL_RAIL', routeColor: 'not-a-color' })[0]).toBe(
      '#f44336',
    );
    expect(
      getMotisRouteColors({ mode: 'REGIONAL_RAIL', routeColor: '09a4ec', routeTextColor: '000000' }),
    ).toEqual(['#09a4ec', '#000000']);
  });
});

describe('buildRouteSummary', () => {
  it('prefers provider displayName segments and bounds length', () => {
    const summary = buildRouteSummary({
      providerItinerary: {
        duration: 100,
        startTime: '2026-09-15T08:00:00Z',
        endTime: '2026-09-15T09:00:00Z',
        transfers: 1,
        legs: [
          {
            mode: 'WALK',
            startTime: '2026-09-15T08:00:00Z',
            endTime: '2026-09-15T08:05:00Z',
            duration: 300,
          },
          {
            mode: 'REGIONAL_RAIL',
            displayName: 'TPE',
            routeColor: '09a4ec',
            routeTextColor: '000000',
            startTime: '2026-09-15T08:05:00Z',
            endTime: '2026-09-15T08:50:00Z',
            duration: 2700,
          },
        ],
      },
      rankingLegs: [{ mode: 'train', displayName: 'ignored' }],
    });
    expect(summary).toEqual([
      {
        mode: 'REGIONAL_RAIL',
        displayName: 'TPE',
        routeColor: '#09a4ec',
        routeTextColor: '#000000',
      },
    ]);
  });

  it('falls back to ranking legs when provider itinerary is absent', () => {
    expect(
      buildRouteSummary({
        rankingLegs: [
          { mode: 'walk' },
          { mode: 'train', motisMode: 'RAIL', displayName: 'ICE 100', routeColor: 'ff0000' },
        ],
      }),
    ).toEqual([
      { mode: 'RAIL', displayName: 'ICE 100', routeColor: '#ff0000' },
    ]);
  });
});
