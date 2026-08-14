import type { Logger } from '@railmeet/observability';
import { ROUTING_PLAN_CACHE_TTL_MS } from '@railmeet/shared';

import { buildPlanCacheKey } from './plan-cache-key.js';
import type {
  JourneyPlanner,
  PlanJourneyInput,
  PlanJourneyResult,
  PlannedJourney,
} from './types.js';

type CachedPlanPayload = {
  readonly journeys: readonly PlannedJourney[];
};

/** Minimal Redis surface for plan cache (ioredis-compatible). */
export type PlanCacheRedis = {
  get(key: string): Promise<string | null>;
  set(key: string, value: string, mode: 'EX', ttlSeconds: number): Promise<unknown>;
};

export type CachedJourneyPlannerOptions = {
  readonly inner: JourneyPlanner;
  readonly redis?: PlanCacheRedis;
  readonly ttlMs?: number;
  readonly logger?: Logger;
};

function reviveJourney(journey: PlannedJourney): PlannedJourney {
  return {
    ...journey,
    departureAt: new Date(journey.departureAt),
    arrivalAt: new Date(journey.arrivalAt),
    legs: journey.legs.map((leg) => ({
      ...leg,
      departureAt: new Date(leg.departureAt),
      arrivalAt: new Date(leg.arrivalAt),
    })),
  };
}

function serializeResult(result: PlanJourneyResult): string {
  return JSON.stringify({
    journeys: result.journeys.map((journey) => ({
      ...journey,
      departureAt: journey.departureAt.toISOString(),
      arrivalAt: journey.arrivalAt.toISOString(),
      legs: journey.legs.map((leg) => ({
        ...leg,
        departureAt: leg.departureAt.toISOString(),
        arrivalAt: leg.arrivalAt.toISOString(),
      })),
    })),
  });
}

/**
 * Reject pre-providerItinerary cache payloads so stale Redis entries cannot
 * collapse Journey Details back to coarse mode-only ranking legs.
 */
export function isUsableCachedPlanResult(result: PlanJourneyResult): boolean {
  for (const journey of result.journeys) {
    const hasTransit = journey.legs.some((leg) => leg.mode !== 'walk');
    if (!hasTransit) {
      continue;
    }
    if (!journey.providerItinerary?.itinerary?.legs?.length) {
      return false;
    }
    if (journey.providerItinerary.format !== 'motis-plan-itinerary-v1') {
      return false;
    }
    for (const leg of journey.legs) {
      if (leg.mode === 'walk') {
        continue;
      }
      if (!leg.motisMode) {
        return false;
      }
    }
  }
  return true;
}

function deserializeResult(raw: string): PlanJourneyResult {
  const parsed = JSON.parse(raw) as CachedPlanPayload;
  return {
    journeys: (parsed.journeys ?? []).map(reviveJourney),
  };
}

/**
 * Redis-backed plan cache with in-flight request coalescing.
 * Falls back to the inner planner when Redis is unavailable.
 */
export function createCachedJourneyPlanner(options: CachedJourneyPlannerOptions): JourneyPlanner {
  const ttlMs = options.ttlMs ?? ROUTING_PLAN_CACHE_TTL_MS;
  const inFlight = new Map<string, Promise<PlanJourneyResult>>();

  return {
    async planJourney(input: PlanJourneyInput): Promise<PlanJourneyResult> {
      const cacheKey = buildPlanCacheKey(input);
      const existing = inFlight.get(cacheKey);
      if (existing) {
        options.logger?.debug(
          { event: 'routing_plan_coalesced', cacheKey },
          'Coalesced in-flight plan request',
        );
        return existing;
      }

      const run = (async (): Promise<PlanJourneyResult> => {
        if (options.redis) {
          try {
            const cached = await options.redis.get(cacheKey);
            if (cached) {
              const restored = deserializeResult(cached);
              if (isUsableCachedPlanResult(restored)) {
                options.logger?.info(
                  { event: 'routing_plan_cache_hit', cacheKey },
                  'Routing plan cache hit',
                );
                return restored;
              }
              options.logger?.warn(
                {
                  event: 'routing_plan_cache_rejected',
                  cacheKey,
                  reason: 'missing_provider_itinerary_or_identity',
                },
                'Rejected stale routing plan cache entry',
              );
            } else {
              options.logger?.info(
                { event: 'routing_plan_cache_miss', cacheKey },
                'Routing plan cache miss',
              );
            }
          } catch (error) {
            options.logger?.warn(
              { event: 'routing_plan_cache_read_failed', cacheKey, err: error },
              'Routing plan cache read failed; calling provider',
            );
          }
        }

        const result = await options.inner.planJourney(input);

        if (options.redis) {
          try {
            await options.redis.set(
              cacheKey,
              serializeResult(result),
              'EX',
              Math.max(1, Math.ceil(ttlMs / 1000)),
            );
          } catch (error) {
            options.logger?.warn(
              { event: 'routing_plan_cache_write_failed', cacheKey, err: error },
              'Routing plan cache write failed',
            );
          }
        }

        return result;
      })();

      inFlight.set(cacheKey, run);
      try {
        return await run;
      } finally {
        inFlight.delete(cacheKey);
      }
    },
  };
}
