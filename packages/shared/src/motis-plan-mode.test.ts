import { describe, expect, it } from 'vitest';

import {
  MOTIS_PLAN_MODE_LABELS,
  MOTIS_PLAN_MODES,
  UNKNOWN_MOTIS_MODE_LABEL,
  formatJourneyOperatorLabel,
  formatJourneyServiceLabel,
  mapMotisPlanModeToDomain,
  motisPlanModeLabel,
} from './motis-plan-mode.js';

describe('MOTIS v5 plan mode catalog', () => {
  it('covers every OpenAPI enum token with a label and domain mapping', () => {
    expect(MOTIS_PLAN_MODES).toHaveLength(Object.keys(MOTIS_PLAN_MODE_LABELS).length);
    for (const mode of MOTIS_PLAN_MODES) {
      expect(motisPlanModeLabel(mode)).toBe(MOTIS_PLAN_MODE_LABELS[mode]);
      expect(mapMotisPlanModeToDomain(mode)).toBeTruthy();
    }
  });

  it('preserves rail subtypes in labels instead of collapsing to Train', () => {
    expect(motisPlanModeLabel('HIGHSPEED_RAIL')).toBe('High-speed rail');
    expect(motisPlanModeLabel('LONG_DISTANCE')).toBe('Intercity rail');
    expect(motisPlanModeLabel('NIGHT_RAIL')).toBe('Night rail');
    expect(motisPlanModeLabel('REGIONAL_FAST_RAIL')).toBe('Regional express');
    expect(motisPlanModeLabel('REGIONAL_RAIL')).toBe('Regional rail');
    expect(motisPlanModeLabel('SUBURBAN')).toBe('Suburban rail');
    expect(mapMotisPlanModeToDomain('HIGHSPEED_RAIL')).toBe('train');
    expect(mapMotisPlanModeToDomain('SUBURBAN')).toBe('train');
  });

  it('treats deprecated METRO as suburban rail, not subway', () => {
    expect(motisPlanModeLabel('METRO')).toBe('Suburban rail');
    expect(mapMotisPlanModeToDomain('METRO')).toBe('train');
    expect(motisPlanModeLabel('SUBWAY')).toBe('Metro');
    expect(mapMotisPlanModeToDomain('SUBWAY')).toBe('metro');
  });

  it('never labels unknown future modes as Train', () => {
    expect(motisPlanModeLabel('HYPERLOOP')).toBe(UNKNOWN_MOTIS_MODE_LABEL);
    expect(mapMotisPlanModeToDomain('HYPERLOOP')).toBe('other');
    expect(motisPlanModeLabel('HYPERLOOP')).not.toMatch(/train/i);
  });

  it('builds service and operator labels from structured fields only', () => {
    expect(
      formatJourneyServiceLabel({
        motisMode: 'HIGHSPEED_RAIL',
        displayName: 'ICE 612',
        routeShortName: '29',
        tripShortName: 'ICE 612',
        agencyName: 'DB Fernverkehr AG',
      }),
    ).toBe('ICE 612');
    expect(
      formatJourneyOperatorLabel({
        motisMode: 'HIGHSPEED_RAIL',
        agencyName: 'DB Fernverkehr AG',
      }),
    ).toBe('DB Fernverkehr AG');
    expect(
      formatJourneyServiceLabel({
        motisMode: 'REGIONAL_RAIL',
        routeShortName: 'RE1',
      }),
    ).toBe('RE1');
    expect(
      formatJourneyServiceLabel({
        motisMode: 'REGIONAL_RAIL',
        tripShortName: '73728',
      }),
    ).toBe('73728');
    expect(formatJourneyServiceLabel({ motisMode: 'COACH' })).toBe('Coach');
    expect(formatJourneyOperatorLabel({ motisMode: 'REGIONAL_RAIL' })).toBeUndefined();
  });
});
