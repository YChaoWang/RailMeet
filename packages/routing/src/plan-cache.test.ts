import { describe, expect, it, vi } from 'vitest';

import { createCachedJourneyPlanner, isUsableCachedPlanResult } from './plan-cache.js';
import { buildPlanCacheKey, PLAN_CACHE_SCHEMA_VERSION } from './plan-cache-key.js';
import type { JourneyPlanner, PlanJourneyResult, PlannedJourney } from './types.js';

const richJourney: PlannedJourney = {
  departureAt: new Date('2026-09-15T08:00:00.000Z'),
  arrivalAt: new Date('2026-09-15T10:00:00.000Z'),
  durationMinutes: 120,
  transfers: 0,
  providerReference: 'itinerary:fixture:v1',
  providerItinerary: {
    format: 'motis-plan-itinerary-v1',
    motisPlanApiVersion: 'v5',
    motisOpenApiPin: 'motis@2.10.2:/api/v5/plan',
    itinerary: {
      duration: 7200,
      startTime: '2026-09-15T08:00:00Z',
      endTime: '2026-09-15T10:00:00Z',
      transfers: 0,
      id: 'itinerary:fixture:v1',
      legs: [
        {
          mode: 'HIGHSPEED_RAIL',
          displayName: 'ICE 148',
          agencyName: 'DB Fernverkehr AG',
          startTime: '2026-09-15T08:00:00Z',
          endTime: '2026-09-15T10:00:00Z',
          duration: 7200,
          from: { name: 'Berlin Hbf', track: '1' },
          to: { name: 'Munich Hbf', track: '12' },
          intermediateStops: [{ name: 'Erfurt Hbf', track: '3' }],
        },
      ],
    },
  },
  legs: [
    {
      mode: 'train',
      motisMode: 'HIGHSPEED_RAIL',
      displayName: 'ICE 148',
      agencyName: 'DB Fernverkehr AG',
      departureAt: new Date('2026-09-15T08:00:00.000Z'),
      arrivalAt: new Date('2026-09-15T10:00:00.000Z'),
      durationMinutes: 120,
      providerReference: 'trip:1',
    },
  ],
};

const staleJourney: PlannedJourney = {
  departureAt: new Date('2026-09-15T08:00:00.000Z'),
  arrivalAt: new Date('2026-09-15T10:00:00.000Z'),
  durationMinutes: 120,
  transfers: 0,
  legs: [
    {
      mode: 'train',
      motisMode: 'RAIL',
      departureAt: new Date('2026-09-15T08:00:00.000Z'),
      arrivalAt: new Date('2026-09-15T10:00:00.000Z'),
      durationMinutes: 120,
      providerReference: 'trip:1',
    },
  ],
};

describe('plan cache provider itinerary integrity', () => {
  it('versions cache keys so pre-provider payloads cannot collide', () => {
    const key = buildPlanCacheKey({
      origin: { latitude: 52.52, longitude: 13.405 },
      destination: { latitude: 48.13, longitude: 11.58 },
      departureAt: new Date('2026-09-15T06:00:00.000Z'),
      maxTransfers: 2,
    });
    expect(key.startsWith(`plan:${PLAN_CACHE_SCHEMA_VERSION}:`)).toBe(true);
  });

  it('rejects cached transit journeys that lack providerItinerary', () => {
    expect(isUsableCachedPlanResult({ journeys: [staleJourney] })).toBe(false);
    expect(isUsableCachedPlanResult({ journeys: [richJourney] })).toBe(true);
  });

  it('round-trips providerItinerary through redis and ignores stale entries', async () => {
    const store = new Map<string, string>();
    const redis = {
      get: vi.fn(async (key: string) => store.get(key) ?? null),
      set: vi.fn(async (key: string, value: string) => {
        store.set(key, value);
      }),
    };
    const innerPlan = vi.fn(async (): Promise<PlanJourneyResult> => ({ journeys: [richJourney] }));
    const inner: JourneyPlanner = { planJourney: innerPlan };
    const cached = createCachedJourneyPlanner({ inner, redis, ttlMs: 60_000 });

    const input = {
      origin: { latitude: 52.52, longitude: 13.405 },
      destination: { latitude: 48.13, longitude: 11.58 },
      departureAt: new Date('2026-09-15T06:00:00.000Z'),
      maxTransfers: 2,
    };

    const first = await cached.planJourney(input);
    expect(first.journeys[0]?.providerItinerary?.itinerary.legs[0]?.displayName).toBe('ICE 148');
    expect(innerPlan).toHaveBeenCalledTimes(1);

    const second = await cached.planJourney(input);
    expect(second.journeys[0]?.providerItinerary?.format).toBe('motis-plan-itinerary-v1');
    expect(innerPlan).toHaveBeenCalledTimes(1);

    // Poison the current key with a legacy shape — must refetch.
    const key = buildPlanCacheKey(input);
    store.set(
      key,
      JSON.stringify({
        journeys: [
          {
            ...staleJourney,
            departureAt: staleJourney.departureAt.toISOString(),
            arrivalAt: staleJourney.arrivalAt.toISOString(),
            legs: staleJourney.legs.map((leg) => ({
              ...leg,
              departureAt: leg.departureAt.toISOString(),
              arrivalAt: leg.arrivalAt.toISOString(),
            })),
          },
        ],
      }),
    );
    const recovered = await cached.planJourney(input);
    expect(innerPlan).toHaveBeenCalledTimes(2);
    expect(recovered.journeys[0]?.providerItinerary?.itinerary.legs[0]?.displayName).toBe('ICE 148');
  });
});
