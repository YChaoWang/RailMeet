import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import type { MotisItineraryJson, MotisLegJson } from '@railmeet/shared';
import { describe, expect, it } from 'vitest';

import {
  buildStopTimePresentation,
  buildTimelineItems,
  computeTransferBreakdown,
  formatMotisDateRange,
  journeyOverviewHeader,
  motisDayOffset,
} from './journey-itinerary-presentation';

const fixtureDir = resolve(dirname(fileURLToPath(import.meta.url)), '../../../../packages/routing/src/fixtures');

function loadBerlinYork(): MotisItineraryJson {
  return JSON.parse(readFileSync(resolve(fixtureDir, 'transitous-berlin-york.json'), 'utf8')) as MotisItineraryJson;
}

describe('motisDayOffset', () => {
  it('returns 0 for same local calendar day', () => {
    expect(
      motisDayOffset(
        '2026-08-09T20:00:00Z',
        '2026-08-09T10:00:00Z',
        'Europe/Berlin',
      ),
    ).toBe(0);
  });

  it('returns 1 for next local day in same timezone', () => {
    expect(
      motisDayOffset(
        '2026-08-10T06:00:00Z',
        '2026-08-09T10:00:00Z',
        'Europe/Berlin',
      ),
    ).toBe(1);
  });

  it('handles next local calendar day across timezones', () => {
    expect(
      motisDayOffset(
        '2026-08-10T07:00:00+01:00',
        '2026-08-09T23:00:00+01:00',
        'Europe/London',
      ),
    ).toBe(1);
  });
});

describe('formatMotisDateRange', () => {
  it('shows a single date when start and end share a local day', () => {
    const label = formatMotisDateRange(
      '2026-08-09T10:00:00Z',
      '2026-08-09T18:00:00Z',
      'Europe/Berlin',
      'Europe/Berlin',
    );
    expect(label).toMatch(/Sunday/);
    expect(label).not.toContain('–');
  });

  it('shows both dates when the journey crosses midnight locally', () => {
    const label = formatMotisDateRange(
      '2026-08-09T10:00:00Z',
      '2026-08-10T08:00:00Z',
      'Europe/Berlin',
      'Europe/London',
    );
    expect(label).toContain('–');
  });
});

describe('computeTransferBreakdown', () => {
  it('separates connection window, walking, and waiting time', () => {
    const prev: MotisLegJson = {
      mode: 'HIGHSPEED_RAIL',
      displayName: 'ICE 858',
      startTime: '2026-08-09T12:00:00Z',
      endTime: '2026-08-09T12:20:00Z',
      duration: 1200,
      from: { name: 'Berlin Hbf', track: '8', tz: 'Europe/Berlin' },
      to: { name: 'Frankfurt Hbf', track: '6', tz: 'Europe/Berlin' },
    };
    const next: MotisLegJson = {
      mode: 'HIGHSPEED_RAIL',
      displayName: 'ICE 10',
      startTime: '2026-08-09T12:40:00Z',
      endTime: '2026-08-09T14:00:00Z',
      duration: 4800,
      from: { name: 'Frankfurt Hbf', track: '7', tz: 'Europe/Berlin' },
      to: { name: 'Bruxelles-Midi', tz: 'Europe/Brussels' },
    };
    const walk: MotisLegJson = {
      mode: 'WALK',
      startTime: '2026-08-09T12:20:00Z',
      endTime: '2026-08-09T12:26:00Z',
      duration: 360,
      distance: 420,
      from: { name: 'Frankfurt Hbf', tz: 'Europe/Berlin' },
      to: { name: 'Frankfurt Hbf', tz: 'Europe/Berlin' },
    };
    const breakdown = computeTransferBreakdown(prev, next, walk);
    expect(breakdown.connectionSeconds).toBe(1200);
    expect(breakdown.walkSeconds).toBe(360);
    expect(breakdown.waitingSeconds).toBe(840);
    expect(breakdown.stationChange).toBe(false);
  });

  it('flags station-changing transfers', () => {
    const prev: MotisLegJson = {
      mode: 'COACH',
      displayName: 'FlixBus N814',
      startTime: '2026-08-09T18:00:00Z',
      endTime: '2026-08-09T22:00:00Z',
      duration: 14_400,
      from: { name: 'London Victoria Coach Station', tz: 'Europe/London' },
      to: { name: 'London Victoria Coach Station', tz: 'Europe/London' },
    };
    const next: MotisLegJson = {
      mode: 'REGIONAL_RAIL',
      displayName: 'Southeastern',
      startTime: '2026-08-09T22:30:00Z',
      endTime: '2026-08-10T00:00:00Z',
      duration: 5400,
      from: { name: 'London St Pancras International', tz: 'Europe/London' },
      to: { name: 'London Bridge', tz: 'Europe/London' },
    };
    const breakdown = computeTransferBreakdown(prev, next, null);
    expect(breakdown.stationChange).toBe(true);
    expect(breakdown.walkSeconds).toBeNull();
  });
});

describe('buildStopTimePresentation', () => {
  it('shows delay text when live time differs from scheduled', () => {
    const presentation = buildStopTimePresentation({
      place: { name: 'Frankfurt Hbf', track: '9', tz: 'Europe/Berlin' },
      timestamp: '2026-08-09T16:41:00+02:00',
      scheduledTimestamp: '2026-08-09T16:34:00+02:00',
      realTime: true,
      mode: 'HIGHSPEED_RAIL',
      journeyStartIso: '2026-08-09T12:00:00+02:00',
      previousTimestamp: null,
      previousTimeZone: undefined,
    });
    expect(presentation?.live).toBe('16:41');
    expect(presentation?.scheduled).toBe('16:34');
    expect(presentation?.delayMinutes).toBe(7);
    expect(presentation?.platform).toBe('Track 9');
  });

  it('inserts a date separator when the local day changes', () => {
    const presentation = buildStopTimePresentation({
      place: { name: 'York', tz: 'Europe/London' },
      timestamp: '2026-08-10T08:04:00+01:00',
      scheduledTimestamp: '2026-08-10T08:04:00+01:00',
      realTime: false,
      mode: 'LONG_DISTANCE',
      journeyStartIso: '2026-08-09T13:44:00+02:00',
      previousTimestamp: '2026-08-09T23:00:00+01:00',
      previousTimeZone: 'Europe/London',
    });
    expect(presentation?.dateSeparator).toMatch(/Monday/);
    expect(presentation?.dayOffsetLabel).toMatch(/\+1 day/);
  });
});

describe('Berlin → York fixture', () => {
  it('lists distinct service identities in overview pills', () => {
    const itinerary = loadBerlinYork();
    const overview = journeyOverviewHeader(itinerary, {
      originLabel: 'Berlin Hbf',
      destinationLabel: 'York',
    });
    const labels = overview.routePills.map((pill) => pill.label);
    expect(labels).toEqual(
      expect.arrayContaining([
        'ICE 858',
        'ICE 10',
        'IC 2843',
        'FlixBus N814',
        'Southeastern',
        'Thameslink',
        'LNER',
      ]),
    );
    expect(labels).not.toContain('Rail');
    expect(labels).not.toContain('Train');
    expect(overview.timeRange).toMatch(/\+1 day/);
    expect(overview.dateRange).toContain('–');
  });

  it('builds transit timeline items for each public transport service', () => {
    const items = buildTimelineItems(loadBerlinYork());
    const transit = items.filter((item) => item.kind === 'transit');
    expect(transit.length).toBeGreaterThanOrEqual(7);
    expect(items.some((item) => item.kind === 'transfer' || item.kind === 'walk')).toBe(true);
  });
});
