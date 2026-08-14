import { describe, expect, it } from 'vitest';

import { getMotisModeStyle, getMotisRouteColors } from './motis-mode-style.js';
import { joinInterlinedMotisLegs } from './motis-itinerary.js';

describe('getMotisModeStyle', () => {
  it('matches Transitous rail subtype colors and never uses train for unknown modes', () => {
    expect(getMotisModeStyle({ mode: 'HIGHSPEED_RAIL' })[0]).toBe('train');
    expect(getMotisModeStyle({ mode: 'SUBWAY' })[0]).toBe('metro');
    expect(getMotisModeStyle({ mode: 'COACH' })).toEqual(['bus', '#9ccc65', 'black']);
    expect(getMotisModeStyle({ mode: 'HYPERLOOP' })[0]).toBe('other');
    expect(getMotisModeStyle({ mode: 'OTHER' })[0]).toBe('other');
    expect(getMotisRouteColors({ mode: 'REGIONAL_RAIL', routeColor: '09a4ec', routeTextColor: '000000' })).toEqual([
      '#09a4ec',
      '#000000',
    ]);
  });
});

describe('joinInterlinedMotisLegs', () => {
  it('merges stay-seated legs and records Continues as via switchTo', () => {
    const joined = joinInterlinedMotisLegs([
      {
        mode: 'LONG_DISTANCE',
        displayName: 'LNER',
        startTime: '2026-09-15T10:00:00Z',
        endTime: '2026-09-15T10:30:00Z',
        duration: 1800,
        from: { name: 'York' },
        to: { name: 'Doncaster', track: '4' },
        intermediateStops: [],
      },
      {
        mode: 'LONG_DISTANCE',
        displayName: 'LNER 2',
        startTime: '2026-09-15T10:30:00Z',
        endTime: '2026-09-15T11:00:00Z',
        duration: 1800,
        from: { name: 'Doncaster', track: '4' },
        to: { name: 'London Kings Cross' },
        intermediateStops: [{ name: 'Newark' }],
        interlineWithPreviousLeg: true,
      },
    ]);
    expect(joined).toHaveLength(1);
    expect(joined[0]?.to?.name).toBe('London Kings Cross');
    expect(joined[0]?.duration).toBe(3600);
    expect(joined[0]?.intermediateStops?.map((stop) => stop.name)).toEqual(['Doncaster', 'Newark']);
    expect(joined[0]?.intermediateStops?.[0]?.switchTo?.displayName).toBe('LNER 2');
  });
});
