import type { PlanJourneyInput } from './types.js';

/**
 * Bump when the cached PlannedJourney payload shape changes.
 * v1 entries lacked providerItinerary / leg identity and must not be reused.
 */
export const PLAN_CACHE_SCHEMA_VERSION = 'motis-plan-itinerary-v1' as const;

function quantizeCoord(value: number): string {
  return value.toFixed(5);
}

/**
 * Stable cache key for identical MOTIS plan inputs (origin, destination, time, constraints).
 */
export function buildPlanCacheKey(input: PlanJourneyInput): string {
  const parts = [
    'plan',
    PLAN_CACHE_SCHEMA_VERSION,
    quantizeCoord(input.origin.latitude),
    quantizeCoord(input.origin.longitude),
    quantizeCoord(input.destination.latitude),
    quantizeCoord(input.destination.longitude),
    input.departureAt.toISOString(),
    input.arriveBy === true ? 'arrive' : 'depart',
    input.maxTransfers === undefined ? 'any' : String(input.maxTransfers),
    input.locale ?? '',
  ];
  return parts.join(':');
}
