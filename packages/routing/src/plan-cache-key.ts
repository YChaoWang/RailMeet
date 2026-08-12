import type { PlanJourneyInput } from './types.js';

function quantizeCoord(value: number): string {
  return value.toFixed(5);
}

/**
 * Stable cache key for identical MOTIS plan inputs (origin, destination, time, constraints).
 */
export function buildPlanCacheKey(input: PlanJourneyInput): string {
  const parts = [
    'plan',
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
