import { describe, expect, it } from 'vitest';

import { buildPlanCacheKey, PLAN_CACHE_SCHEMA_VERSION } from './plan-cache-key.js';

describe('buildPlanCacheKey', () => {
  it('is stable for identical routing inputs', () => {
    const departureAt = new Date('2026-06-15T08:00:00.000Z');
    const input = {
      origin: { latitude: 52.52, longitude: 13.405 },
      destination: { latitude: 48.8566, longitude: 2.3522 },
      departureAt,
      maxTransfers: 2,
    };
    expect(buildPlanCacheKey(input)).toBe(buildPlanCacheKey(input));
    expect(buildPlanCacheKey(input)).toContain(PLAN_CACHE_SCHEMA_VERSION);
  });

  it('changes when coordinates or time differ', () => {
    const base = {
      origin: { latitude: 52.52, longitude: 13.405 },
      destination: { latitude: 48.8566, longitude: 2.3522 },
      departureAt: new Date('2026-06-15T08:00:00.000Z'),
    };
    const otherTime = {
      ...base,
      departureAt: new Date('2026-06-15T09:00:00.000Z'),
    };
    expect(buildPlanCacheKey(base)).not.toBe(buildPlanCacheKey(otherTime));
  });
});
