import { describe, expect, it } from 'vitest';

import {
  formatJourneyOperatorLabel,
  formatJourneyServiceLabel,
  motisPlanModeLabel,
} from '@railmeet/shared';

import {
  TRANSITOUS_BERLIN_MAGDEBURG_ODEG_PLAN,
  TRANSITOUS_BERLIN_MUNICH_ICE_PLAN,
} from './fixtures/transitous-berlin-ice.js';
import { collectJourneyTransportModes, mapMotisLegMode } from './motis-mode.js';
import { normalizeMotisPlanResponse } from './motis-normalize.js';

describe('normalizeMotisPlanResponse service identity', () => {
  it('preserves ICE / DB Fernverkehr fields from a real Transitous plan', () => {
    const journeys = normalizeMotisPlanResponse(TRANSITOUS_BERLIN_MUNICH_ICE_PLAN);
    const ice = journeys[0]?.legs.find((leg) => leg.motisMode === 'HIGHSPEED_RAIL');
    expect(ice).toMatchObject({
      mode: 'train',
      motisMode: 'HIGHSPEED_RAIL',
      displayName: 'ICE 1007',
      tripShortName: 'ICE 1007',
      routeShortName: '29',
      agencyName: 'DB Fernverkehr AG',
      agencyId: '12681',
      headsign: 'München Hbf',
      intermediateStopCount: 5,
    });
    expect(ice?.from?.name).toBe('S+U Berlin Hauptbahnhof');
    expect(ice?.to).toEqual({ name: 'München Hbf', track: '22' });
    expect(ice?.agencyUrl).toBeUndefined();
    expect(formatJourneyServiceLabel(ice!)).toBe('ICE 1007');
    expect(formatJourneyOperatorLabel(ice!)).toBe('DB Fernverkehr AG');
    expect(motisPlanModeLabel(ice!.motisMode)).toBe('High-speed rail');
    expect(formatJourneyOperatorLabel(ice!)).not.toBe('Deutsche Bahn');
  });

  it('preserves ODEG regional rail instead of inventing Deutsche Bahn', () => {
    const journeys = normalizeMotisPlanResponse(TRANSITOUS_BERLIN_MAGDEBURG_ODEG_PLAN);
    const suburban = journeys[0]?.legs.find((leg) => leg.motisMode === 'SUBURBAN');
    const regional = journeys[0]?.legs.find((leg) => leg.motisMode === 'REGIONAL_RAIL');
    expect(suburban).toMatchObject({
      mode: 'train',
      motisMode: 'SUBURBAN',
      displayName: 'S3',
      agencyName: 'S-Bahn Berlin GmbH',
      headsign: 'S Spandau Bhf (Berlin)',
    });
    expect(regional).toMatchObject({
      mode: 'train',
      motisMode: 'REGIONAL_RAIL',
      displayName: 'RE1',
      agencyName: 'ODEG Ostdeutsche Eisenbahn GmbH',
      intermediateStopCount: 12,
    });
    expect(formatJourneyOperatorLabel(regional!)).toBe('ODEG Ostdeutsche Eisenbahn GmbH');
    expect(formatJourneyOperatorLabel(regional!)).not.toMatch(/deutsche bahn/i);
    expect(collectJourneyTransportModes(journeys[0]!.legs)).toEqual(['train']);
  });

  it('preserves walk distance and omits operator on walking legs', () => {
    const journeys = normalizeMotisPlanResponse(TRANSITOUS_BERLIN_MUNICH_ICE_PLAN);
    const walk = journeys[0]?.legs.find((leg) => leg.motisMode === 'WALK' && (leg.distanceMeters ?? 0) > 0);
    expect(walk?.mode).toBe('walk');
    expect(walk?.distanceMeters).toBe(173);
    expect(formatJourneyOperatorLabel(walk!)).toBeUndefined();
  });
});

describe('normalizeMotisPlanResponse additional MOTIS modes', () => {
  function oneLeg(mode: string, extra: Record<string, unknown> = {}) {
    return normalizeMotisPlanResponse({
      itineraries: [
        {
          duration: 600,
          startTime: '2026-09-15T08:00:00Z',
          endTime: '2026-09-15T08:10:00Z',
          transfers: 0,
          legs: [
            {
              mode,
              startTime: '2026-09-15T08:00:00Z',
              endTime: '2026-09-15T08:10:00Z',
              duration: 600,
              ...extra,
            },
          ],
        },
      ],
    })[0]!.legs[0]!;
  }

  it('keeps subway, tram, bus, coach, and ferry distinct', () => {
    expect(oneLeg('SUBWAY', { displayName: 'U2', agencyName: 'Wiener Linien' })).toMatchObject({
      mode: 'metro',
      motisMode: 'SUBWAY',
      displayName: 'U2',
      agencyName: 'Wiener Linien',
    });
    expect(oneLeg('TRAM', { displayName: 'M10', agencyName: 'BVG' })).toMatchObject({
      mode: 'tram',
      motisMode: 'TRAM',
    });
    expect(oneLeg('BUS', { displayName: 'Bus 100', agencyName: 'BVG' })).toMatchObject({
      mode: 'bus',
      motisMode: 'BUS',
    });
    expect(oneLeg('COACH', { displayName: 'FlixBus 157', agencyName: 'FlixBus-eu' })).toMatchObject({
      mode: 'bus',
      motisMode: 'COACH',
    });
    expect(motisPlanModeLabel(oneLeg('COACH').motisMode)).toBe('Coach');
    expect(oneLeg('FERRY', { displayName: 'F12', agencyName: 'Hadag' })).toMatchObject({
      mode: 'ferry',
      motisMode: 'FERRY',
    });
  });

  it('does not infer an operator when agencyName is missing', () => {
    const leg = oneLeg('REGIONAL_RAIL', { displayName: 'RE20', from: { name: 'Berlin Hbf' } });
    expect(leg.agencyName).toBeUndefined();
    expect(formatJourneyOperatorLabel(leg)).toBeUndefined();
    expect(formatJourneyServiceLabel(leg)).toBe('RE20');
  });

  it('falls back through short name and trip number when displayName is absent', () => {
    expect(formatJourneyServiceLabel(oneLeg('HIGHSPEED_RAIL', { routeShortName: 'ICE' }))).toBe(
      'ICE',
    );
    expect(formatJourneyServiceLabel(oneLeg('HIGHSPEED_RAIL', { tripShortName: 'ICE 612' }))).toBe(
      'ICE 612',
    );
    expect(formatJourneyServiceLabel(oneLeg('HIGHSPEED_RAIL'))).toBe('High-speed rail');
  });

  it('keeps unknown future MOTIS modes as other transport, not train', () => {
    const leg = oneLeg('HYPERLOOP');
    expect(leg.mode).toBe('other');
    expect(leg.motisMode).toBe('HYPERLOOP');
    expect(motisPlanModeLabel(leg.motisMode)).toBe('Other transport');
    expect(mapMotisLegMode('HYPERLOOP')).not.toBe('train');
  });

  it('maps a mixed-mode international itinerary without collapsing subtypes', () => {
    const journeys = normalizeMotisPlanResponse({
      itineraries: [
        {
          duration: 14400,
          startTime: '2026-09-15T06:00:00Z',
          endTime: '2026-09-15T10:00:00Z',
          transfers: 2,
          legs: [
            {
              mode: 'WALK',
              startTime: '2026-09-15T06:00:00Z',
              endTime: '2026-09-15T06:08:00Z',
              duration: 480,
              distance: 420,
            },
            {
              mode: 'HIGHSPEED_RAIL',
              startTime: '2026-09-15T06:12:00Z',
              endTime: '2026-09-15T08:00:00Z',
              duration: 6480,
              displayName: 'ICE 9592',
              tripShortName: 'ICE 9592',
              agencyName: 'DB Fernverkehr AG',
              headsign: 'Paris Est',
            },
            {
              mode: 'SUBWAY',
              startTime: '2026-09-15T08:20:00Z',
              endTime: '2026-09-15T08:35:00Z',
              duration: 900,
              displayName: 'M4',
              agencyName: 'RATP',
              headsign: "Porte d'Orléans",
            },
            {
              mode: 'HIGHSPEED_RAIL',
              startTime: '2026-09-15T09:00:00Z',
              endTime: '2026-09-15T10:00:00Z',
              duration: 3600,
              displayName: 'TGV 9576',
              tripShortName: 'TGV 9576',
              agencyName: 'SNCF Voyageurs',
              headsign: 'Lyon Part-Dieu',
            },
          ],
        },
      ],
    });
    const legs = journeys[0]!.legs;
    expect(legs.map((leg) => leg.motisMode)).toEqual([
      'WALK',
      'HIGHSPEED_RAIL',
      'SUBWAY',
      'HIGHSPEED_RAIL',
    ]);
    expect(legs.map((leg) => formatJourneyOperatorLabel(leg))).toEqual([
      undefined,
      'DB Fernverkehr AG',
      'RATP',
      'SNCF Voyageurs',
    ]);
    expect(formatJourneyServiceLabel(legs[3]!)).toBe('TGV 9576');
    expect(collectJourneyTransportModes(legs)).toEqual(['train', 'metro']);
  });
});

describe('normalizeMotisPlanResponse lossless MOTIS itinerary', () => {
  it('keeps the Manchester–York itinerary payload instead of a coarse projection', async () => {
    const { readFileSync } = await import('node:fs');
    const { dirname, resolve } = await import('node:path');
    const { fileURLToPath } = await import('node:url');
    const path = resolve(
      dirname(fileURLToPath(import.meta.url)),
      'fixtures/transitous-manchester-york.json',
    );
    const itinerary = JSON.parse(readFileSync(path, 'utf8')) as {
      duration: number;
      startTime: string;
      endTime: string;
      transfers: number;
      id: string;
      legs: unknown[];
    };
    const journeys = normalizeMotisPlanResponse({ itineraries: [itinerary] });
    const stored = journeys[0]?.providerItinerary?.itinerary;
    expect(journeys[0]?.providerReference).toBe('itinerary:fixture:manchester-york:v1');
    expect(journeys[0]?.providerItinerary?.motisPlanApiVersion).toBe('v5');
    expect(stored?.id).toBe('itinerary:fixture:manchester-york:v1');
    expect(stored?.legs).toHaveLength(7);
    const tpe = stored?.legs.find((leg) => leg.displayName === 'TPE');
    expect(tpe?.agencyName).toBe('TransPennine Express');
    expect(tpe?.routeColor).toBe('09a4ec');
    expect(tpe?.intermediateStops).toHaveLength(2);
    expect(tpe?.tripTo?.name).toBe('Hull');
    const walk = stored?.legs.find((leg) => leg.mode === 'WALK' && leg.distance === 285);
    expect(walk?.steps?.length).toBeGreaterThan(0);
    const northern = stored?.legs.find((leg) => leg.displayName === 'Northern');
    expect(northern?.alerts?.[0]?.headerText).toBe('Special Service');
  });
});
